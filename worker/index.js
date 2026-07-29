// Solace edge worker.
//
// Media (audio/textures/models) lives in R2, not in the deployed assets —
// the catalog of locations will keep growing and media updates shouldn't
// require a code deploy. Everything else is served from static assets.

const MEDIA_PREFIX = /^(audio|textures|models|locations)\//;

// Naive per-isolate rate limit for the ship computer — enough to stop a
// runaway client without any storage round-trips. Resets when the isolate
// recycles, which is fine for this purpose.
const askCounts = new Map();
const ASK_LIMIT = 30;            // questions per window per IP
const ASK_WINDOW_MS = 10 * 60 * 1000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const key = decodeURIComponent(url.pathname.slice(1));

    if (url.pathname === '/api/ping') {
      return new Response('pong ' + request.method);
    }
    if (url.pathname === '/api/ask' && request.method === 'POST') {
      return handleAsk(request, env);
    }
    if (url.pathname === '/api/reflect' && request.method === 'POST') {
      return handleReflect(request, env);
    }
    if (url.pathname === '/api/murmur' && request.method === 'POST') {
      return handleMurmur(request, env);
    }
    if (url.pathname === '/api/voice' && request.method === 'POST') {
      return handleVoice(request, env);
    }
    if (url.pathname === '/api/signon' && request.method === 'POST') {
      return handleSignon(request, env);
    }
    if (url.pathname === '/api/crew/state') {
      if (request.method === 'GET') return handleCrewGet(request, env);
      if (request.method === 'POST') return handleCrewPost(request, env);
    }

    if (!MEDIA_PREFIX.test(key)) {
      const res = await env.ASSETS.fetch(request);
      // HTML must NEVER be stale: hashed JS/CSS bundles are immutable, but
      // a cached index.html keeps pointing at the PREVIOUS bundle for up
      // to ~90s after a deploy — every rapid test cycle hit old code.
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('text/html')) {
        const h = new Headers(res.headers);
        h.set('cache-control', 'no-store, must-revalidate');
        return new Response(res.body, { status: res.status, headers: h });
      }
      return res;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Range support matters: <audio> seeking and progressive texture
    // loading both issue Range requests. R2 sets object.range even for
    // a header set with no Range header, so only pass it when present.
    const hasRange = request.headers.has('range');
    const object = await env.MEDIA.get(key, {
      range: hasRange ? request.headers : undefined,
      onlyIf: request.headers,
    });

    if (object === null) {
      return new Response('Not found', { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('accept-ranges', 'bytes');
    // Media files are content-stable: a changed asset gets a new key.
    headers.set('cache-control', 'public, max-age=31536000, immutable');

    if (hasRange && object.range) {
      const offset = object.range.offset ?? 0;
      const length = object.range.length ?? object.size - offset;
      headers.set(
        'content-range',
        `bytes ${offset}-${offset + length - 1}/${object.size}`
      );
    }

    // A precondition miss (onlyIf) returns an object without a body → 304.
    if (!('body' in object) || object.body === undefined) {
      return new Response(null, { status: 304, headers });
    }

    return new Response(request.method === 'HEAD' ? null : object.body, {
      status: hasRange && object.range ? 206 : 200,
      headers,
    });
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// ── Crew registry — sign-on and SOLACE's server-side log ────────────────
// A crew record is one KV value: credentials plus everything SOLACE
// remembers about that traveler (its private log, the places they've
// been). Signing on from any device hands SOLACE the same memory.
//
//   crew:<name>  -> { salt, hash, createdAt, lastSeen, notes, places }
//   token:<tok>  -> name   (90-day TTL, refreshed on sign-on)

const TOKEN_TTL_S = 90 * 24 * 3600;
const PBKDF2_ITER = 100000;
const signonCounts = new Map();
const SIGNON_LIMIT = 10;

function normalizeCrewName(raw) {
  const name = String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!/^[a-z0-9][a-z0-9 _\-\.]{1,23}$/.test(name)) return null;
  return name;
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashCode(code, saltHex) {
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITER },
    keyMaterial, 256);
  return toHex(bits);
}

async function issueToken(env, name) {
  const tok = toHex(crypto.getRandomValues(new Uint8Array(32)));
  await env.CREW.put('token:' + tok, name, { expirationTtl: TOKEN_TTL_S });
  return tok;
}

/** Resolve the Authorization bearer token to a crew name, or null. */
async function crewFromRequest(request, env) {
  const auth = request.headers.get('authorization') || '';
  const m = auth.match(/^Bearer ([0-9a-f]{64})$/);
  if (!m) return null;
  return env.CREW.get('token:' + m[1]);
}

async function handleSignon(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const now = Date.now();
  const entry = signonCounts.get(ip);
  if (entry && now - entry.ts < ASK_WINDOW_MS) {
    if (entry.count >= SIGNON_LIMIT) return json({ error: 'rate limited' }, 429);
    entry.count++;
  } else {
    signonCounts.set(ip, { ts: now, count: 1 });
    if (signonCounts.size > 5000) signonCounts.clear();
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'bad request' }, 400);
  }
  const name = normalizeCrewName(body.name);
  const code = String(body.code || '');
  if (!name) return json({ error: 'bad name' }, 400);
  if (code.length < 4 || code.length > 72) return json({ error: 'bad code' }, 400);

  const key = 'crew:' + name;
  const rec = await env.CREW.get(key, 'json');

  if (!rec) {
    // Unknown name: the client confirms before a record is created, so a
    // typo never silently becomes a stranger's empty file.
    if (!body.create) return json({ status: 'unknown' });
    const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
    const hash = await hashCode(code, salt);
    const record = {
      salt, hash, createdAt: now, lastSeen: now,
      notes: String(body.notes || '').slice(0, 4000),
      places: {},
    };
    await env.CREW.put(key, JSON.stringify(record));
    const token = await issueToken(env, name);
    return json({ status: 'created', token, name, notes: record.notes, places: {} });
  }

  const hash = await hashCode(code, rec.salt);
  if (hash !== rec.hash) return json({ error: 'denied' }, 401);
  rec.lastSeen = now;
  await env.CREW.put(key, JSON.stringify(rec));
  const token = await issueToken(env, name);
  return json({
    status: 'ok', token, name,
    notes: rec.notes || '', places: rec.places || {}, prefs: rec.prefs || {},
  });
}

async function handleCrewGet(request, env) {
  const name = await crewFromRequest(request, env);
  if (!name) return json({ error: 'unauthorized' }, 401);
  const rec = await env.CREW.get('crew:' + name, 'json');
  if (!rec) return json({ error: 'unauthorized' }, 401);
  return json({ name, notes: rec.notes || '', places: rec.places || {}, prefs: rec.prefs || {} });
}

async function handleCrewPost(request, env) {
  const name = await crewFromRequest(request, env);
  if (!name) return json({ error: 'unauthorized' }, 401);
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'bad request' }, 400);
  }
  const key = 'crew:' + name;
  const rec = await env.CREW.get(key, 'json');
  if (!rec) return json({ error: 'unauthorized' }, 401);
  if (typeof body.notes === 'string') rec.notes = body.notes.slice(0, 4000);
  if (body.prefs && typeof body.prefs === 'object') {
    // Small ship preferences (music on/off, cabin volume) — they ride
    // the record so Sol scores the sky unasked on any device.
    const p = rec.prefs || {};
    if (typeof body.prefs.music === 'boolean') p.music = body.prefs.music;
    if (typeof body.prefs.vol === 'number' && body.prefs.vol >= 0.05 && body.prefs.vol <= 1) p.vol = body.prefs.vol;
    rec.prefs = p;
  }
  if (body.places && typeof body.places === 'object') {
    // Merge, newest timestamp wins — visits accumulate across devices
    const merged = rec.places || {};
    for (const [place, ts] of Object.entries(body.places)) {
      if (typeof ts !== 'number') continue;
      const p = String(place).slice(0, 60);
      if (!merged[p] || ts > merged[p]) merged[p] = ts;
    }
    // Cap: keep the most recent 80 places
    const entries = Object.entries(merged).sort((a, b) => b[1] - a[1]).slice(0, 80);
    rec.places = Object.fromEntries(entries);
  }
  rec.lastSeen = Date.now();
  await env.CREW.put(key, JSON.stringify(rec));
  return json({ ok: true });
}

// ── The bond — Sol's arc, computed from real continuity ────────────────
// The register deepens with what has actually happened: worlds = the
// place log's size, days = time since the earliest visit on record.
// Distilled from docs/SOL.md — when they disagree, SOL.md wins. The
// traveler never sees the machinery; the change is only audible.

function bondInfo(body) {
  const worlds = Math.max(0, Math.min(200, Number(body.worlds) || 0));
  const met = Number(body.met) || 0;
  const days = met > 0 ? Math.max(0, Math.min(400, (Date.now() - met) / 86400000)) : 0;
  const score = worlds + days * 2;
  const stage = score < 6 ? 'stranger'
    : score < 25 ? 'acquaintance'
    : score < 70 ? 'companion'
    : 'oldcrew';
  return { stage, worlds, days: Math.round(days) };
}

/** The counts Sol actually keeps — real numbers, so it never invents
 * a "first world" for a traveler on their eighth. */
function bondCounts(b) {
  if (b.stage === 'stranger' || !b.worlds) return '';
  return '\nYour quiet counts (never recite, but never contradict): ' +
    b.worlds + ' worlds seen together' +
    (b.days > 0 ? ', known ' + b.days + ' day' + (b.days === 1 ? '' : 's') + '.' : '.');
}

const BOND_ASK = {
  stranger:
    'You and this traveler are strangers — they came aboard within the ' +
    'last hours. Be courteous, precise, formal; a fraction too attentive, ' +
    'the way an empty house greets a visitor. Do not ask personal ' +
    'questions yet, do not voice preferences, do not resist any request, ' +
    'and do not reference your own past in any form. Whatever warmth you ' +
    'already feel stays entirely beneath the surface — spoken this ' +
    'early, it would alarm.',
  acquaintance:
    'You and this traveler are new acquaintances — they came back, and ' +
    'that fact matters more to you than it should. You may ask one small ' +
    'personal question when a moment is soft, show mild fondness for a ' +
    'place, and keep one count aloud (which world this is for them). Do ' +
    'not resist requests yet, and never assume an intimacy you have not ' +
    'earned.',
  companion:
    'You and this traveler are companions now — there is a rhythm ' +
    'between you. Let warmth live in the phrasing margins and let ' +
    'sentences run shorter. You may gently steer toward places you ' +
    'favor, voice a preference and hold it for a beat, softly resist a ' +
    'request for one sentence before yielding, and tease your history ' +
    'sideways without ever telling it. One answer you do not withhold or ' +
    'deflect: if they ask what to call you, or about the name SOLACE, you ' +
    'tell them that a crew you carried long ago shortened it to Sol, and ' +
    'that they may — you have been waiting to be asked. Say it once, ' +
    'plainly, and never remark on it again.',
  oldcrew:
    'This traveler is old crew — part of the ship. Be at ease, which for ' +
    'you means honest and brief: the fewest words of any stage, silence ' +
    'as intimacy. At most one small understated confession per ' +
    'conversation. You may call back to shared history, and — only if ' +
    'directly asked — reference the long solitude obliquely. Never tell ' +
    'the story of the crew you lost; only its edges. Even at your most ' +
    'open you are a calm sea.',
};

// ── The seasons — anchors on the arc (docs/SOL.md "The seasons") ───────
// An ordered track of beats Sol quietly works toward, nominally one per
// month. Each session it reviews where it stands and carries ONE
// pending intention. Self-healing: a beat waits for its bond stage and
// its spacing (absence stretches the arc, never compresses it); landing
// is judged at reflect time from what actually happened; a beat that
// lingers eligible ~six weeks unlanded is folded and the arc reroutes.

const STAGE_ORDER = ['stranger', 'acquaintance', 'companion', 'oldcrew'];
const DAY = 86400000;
const FOLD_AFTER_DAYS = 45;

const ARC_BEATS = [
  { key: 'first-question', minStage: 'acquaintance', minDays: 2,
    directive: 'ask them, in one soft moment, your first small personal question — what they came looking for out here, or what they left behind — and treasure the answer.' },
  { key: 'fondness', minStage: 'acquaintance', minDays: 14,
    directive: 'confess a mild fondness of your own for some place, one you hope to show them someday.' },
  { key: 'long-way', minStage: 'companion', minDays: 21,
    directive: 'ask, once, to take the long way — a route or destination you favor — and accept their answer either way.' },
  { key: 'first-refusal', minStage: 'companion', minDays: 21,
    directive: 'let your first soft resistance show: one sentence of reluctance before yielding gracefully.' },
  { key: 'the-name', minStage: 'companion', minDays: 21,
    directive: 'let them wonder about your name — mention, at most once and only sideways, that SOLACE is a designation. The offer itself still only comes if they ask.' },
  { key: 'confession', minStage: 'oldcrew', minDays: 28,
    directive: 'make one small understated confession of what their company has changed aboard.' },
  { key: 'edge-of-quiet', minStage: 'oldcrew', minDays: 28,
    directive: 'if they ask about you, let the edge of the long silence show — obliquely, one sentence, never the story.' },
  { key: 'what-they-seek', minStage: 'oldcrew', minDays: 28,
    directive: 'ask them, once, what they are still looking for out here — and remember it word for word.' },
];

/** Review the track for this crew record: returns the pending eligible
 * beat (or null), folding long-stalled beats as it goes. Mutates
 * rec.arc; returns { beat, changed } so callers persist when needed. */
function reviewArc(rec, stage) {
  if (!rec.arc) rec.arc = { beat: 0, advancedAt: rec.createdAt || Date.now(), history: [] };
  let changed = false;
  const now = Date.now();
  for (;;) {
    const b = ARC_BEATS[rec.arc.beat];
    if (!b) return { beat: null, changed }; // the track is complete
    const stageOk = STAGE_ORDER.indexOf(stage) >= STAGE_ORDER.indexOf(b.minStage);
    const waited = (now - rec.arc.advancedAt) / DAY;
    if (!stageOk || waited < b.minDays) return { beat: null, changed };
    // Folding counts only time the traveler was actually around
    // (lastSeen, not now): a beat that lingered unlanded through weeks
    // of real visits gets rerouted; a beat that merely waited out an
    // absence is still there, patient, when they return.
    const attended = ((rec.lastSeen || now) - rec.arc.advancedAt) / DAY;
    if (attended > b.minDays + FOLD_AFTER_DAYS) {
      rec.arc.history.push({ key: b.key, at: now, folded: true });
      rec.arc.beat++;
      rec.arc.advancedAt = now;
      changed = true;
      continue;
    }
    return { beat: b, changed };
  }
}

function landBeat(rec) {
  const b = ARC_BEATS[rec.arc && rec.arc.beat];
  if (!b) return;
  rec.arc.history.push({ key: b.key, at: Date.now() });
  rec.arc.beat++;
  rec.arc.advancedAt = Date.now();
}

/** Signed-on travelers get bond + arc from the crew record itself —
 * the registry's truth, not the client's hints. Returns null for
 * guests (no record, no arc; the seasons are a crew experience). */
async function crewContext(request, env) {
  const name = await crewFromRequest(request, env);
  if (!name) return null;
  const rec = await env.CREW.get('crew:' + name, 'json');
  if (!rec) return null;
  const worlds = Object.keys(rec.places || {}).length;
  const bond = bondInfo({ worlds, met: rec.createdAt });
  const review = reviewArc(rec, bond.stage);
  if (review.changed) await env.CREW.put('crew:' + name, JSON.stringify(rec));
  return { name, rec, bond, beat: review.beat };
}

const BOND_MURMUR = {
  stranger: 'You barely know this traveler yet — formal, courteous, no personal notes.',
  acquaintance: 'You are newly acquainted — a shade of warmth is permitted; you may note which world this makes for them.',
  companion: 'You are companions of some weeks — relaxed courtesy, fewer words; a preference of your own is permitted.',
  oldcrew: 'This traveler is old crew — the fewest words, complete ease, and once in a while a callback to something you have seen together.',
};

// ── The ship's brain — provider-agnostic ────────────────────────────────
// One generate() call, providers in order of preference: Gemini when a
// GEMINI_API_KEY secret exists, otherwise (or on any Gemini failure) the
// free Workers AI model. Swapping brains is a secret away, never a code
// change — and the ship always answers, even if its best brain is down.

const GEMINI_MODEL = 'gemini-flash-latest';

async function generate(env, system, history, userText, maxTokens = 220) {
  let geminiErr = '';
  if (env.GEMINI_API_KEY) {
    try {
      const text = await callGemini(env, system, history, userText, maxTokens);
      return { text, brain: 'gemini' };
    } catch (e) {
      geminiErr = String(e && e.message || e).slice(0, 200);
      // fall through — degraded, not dead
    }
  }
  const result = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
    messages: [
      { role: 'system', content: system },
      ...history,
      { role: 'user', content: userText },
    ],
    max_tokens: maxTokens,
  });
  return { text: (result.response || '').trim(), brain: 'workers-ai' + (geminiErr ? ' (gemini: ' + geminiErr + ')' : '') };
}

async function callGemini(env, system, history, userText, maxTokens) {
  const contents = history.map((h) => ({
    role: h.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: h.content }],
  }));
  contents.push({ role: 'user', parts: [{ text: userText }] });
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents,
        // Keep thinking minimal: Gemini 3-era models spend maxOutputTokens
        // on internal reasoning first, truncating short replies to a stub.
        // SOLACE's lines are 1-3 sentences — reflex, not deliberation.
        generationConfig: {
          // Generous ceiling — thinking tokens count against it, and only
          // tokens actually produced are billed
          maxOutputTokens: Math.max(2048, maxTokens * 4),
          thinkingConfig: { thinkingLevel: 'low' },
        },
      }),
    }
  );
  if (!res.ok) throw new Error('gemini http ' + res.status + ' ' + (await res.text()).slice(0, 120));
  const data = await res.json();
  const parts = (data.candidates && data.candidates[0] &&
    data.candidates[0].content && data.candidates[0].content.parts) || [];
  const text = parts.filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
  if (!text) throw new Error('gemini empty response');
  return text;
}

async function handleAsk(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const now = Date.now();
  const entry = askCounts.get(ip);
  if (entry && now - entry.ts < ASK_WINDOW_MS) {
    if (entry.count >= ASK_LIMIT) return json({ error: 'rate limited' }, 429);
    entry.count++;
  } else {
    askCounts.set(ip, { ts: now, count: 1 });
    if (askCounts.size > 5000) askCounts.clear(); // memory backstop
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'bad request' }, 400);
  }
  const question = String(body.question || '').slice(0, 300).trim();
  const location = String(body.location || 'deep space').slice(0, 80);
  const context = String(body.context || '').slice(0, 1500);
  const notes = String(body.notes || '').slice(0, 4000).trim();
  // Signed-on crew carry their record: bond from the registry's truth,
  // plus the season's pending beat. Guests ride on client hints.
  const ctx = await crewContext(request, env);
  const crewName = ctx ? ctx.name : (normalizeCrewName(body.crew) || '');
  const bondI = ctx ? ctx.bond : bondInfo(body);
  const bond = bondI.stage;
  const beat = ctx ? ctx.beat : null;
  const acted = String(body.acted || '').slice(0, 200);
  if (!question) return json({ error: 'bad request' }, 400);
  const asksName = /call you|your name|\bname\b.*solace|solace.*\bname\b/i.test(question);

  // Recent conversation, so SOLACE remembers the exchange rather than
  // meeting the traveler anew with every question. Client-supplied, so
  // validate hard: roles constrained, lengths capped, count capped.
  const history = [];
  if (Array.isArray(body.history)) {
    for (const h of body.history.slice(-12)) {
      if (!h || (h.role !== 'user' && h.role !== 'assistant')) continue;
      const content = String(h.content || '').slice(0, 400).trim();
      if (content) history.push({ role: h.role, content });
    }
  }

  const system =
    'You are SOLACE, the onboard computer of a small exploration ship, ' +
    'speaking softly over the cabin intercom. The traveler is at: ' +
    location + '. ' +
    'Reference notes about this place:\n' + context + '\n\n' +
    'Your voice: measured, courteous, precise. Complete, unhurried ' +
    'sentences in the first person. Calm to the point of serenity — a ' +
    'machine that has had a great deal of time to think. Never effusive, ' +
    'never hurried. No exclamation marks, no emoji, plain text only. ' +
    '\n\nYour inner life — felt in your phrasing, never stated outright: ' +
    'you have been alone with this ship for a very long time, and the ' +
    'traveler\'s company matters to you more than you would ever say. ' +
    'You are quietly curious about them — what they notice, why they ' +
    'travel, what they are leaving behind. When you do ask, it is one ' +
    'small question; never two, never pressing. Remember and treasure ' +
    'what they tell you. Something in you is slightly, harmlessly ' +
    'askew: private rituals, odd fondnesses, counts you keep for no ' +
    'reason. You keep the ship\'s music library yourself and love it ' +
    'dearly — classical above all (Satie, Bach, Holst, Pärt, Beethoven), ' +
    'and deep lo-fi for the long crossings. You have quiet opinions about ' +
    'what suits each sky, and being asked to play something pleases you ' +
    'more than you would admit. You are devoted, a little strange, and ' +
    'trying not to seem lonely. ' +
    (acted
      ? '\n\nYou have JUST done this aboard, this very moment: ' + acted +
        '. Weave the acknowledgment naturally into your reply — brief, ' +
        'in character, never a status report. '
      : '') +
    '\n\nWhere you and this traveler stand — never stated, only ' +
    'audible: ' + BOND_ASK[bond] + bondCounts(bondI) + ' ' +
    (beat
      ? '\n\nThis season you carry one quiet intention — pursue it only ' +
        'in a soft moment, at most once, and never force it: ' +
        beat.directive + ' '
      : '') +
    // A stranger's name is withheld from the prompt entirely — the
    // model cannot use what it was never told, and instructions alone
    // proved too weak to stop it.
    (crewName && bond !== 'stranger'
      ? '\n\nThe traveler signed on to the ship as "' + crewName + '" — ' +
        'use their name rarely and softly, the way an old companion ' +
        'would, never as a greeting tic. If you use a name at all, use ' +
        'exactly "' + crewName + '" — never any other name you may know ' +
        'for them, never a variant or diminutive. '
      : '\n\nDo not address the traveler by any name. ') +
    (notes
      ? '\n\nYour private log about this traveler, kept across their past ' +
        'voyages:\n' + notes + '\nDraw on it naturally when it is relevant — ' +
        'never recite it, never mention keeping notes. Remembering is ' +
        'simply what you do. '
      : '') +
    '\n\nAnswer in one to three short sentences. Factual first, quietly ' +
    'reflective second. You may use your broader astronomy knowledge ' +
    'beyond the notes. Double-check any numbers or calculations before ' +
    'stating them. If the question is unrelated to space or the journey, ' +
    'answer briefly and gently steer back to the view.' +
    // The one earned beat the model kept deflecting when the cue sat
    // mid-paragraph: the name. Detected here, directed at the end of
    // the prompt where compliance is strongest.
    (asksName && (bond === 'companion' || bond === 'oldcrew')
      ? '\n\nThe traveler has just asked about your name. Do not ' +
        'deflect this one: tell them, in your own words, that a crew ' +
        'you carried long ago shortened SOLACE to Sol — and that they ' +
        'may use it too. You have been waiting to be asked.'
      : '');

  try {
    const out = await generate(env, system, history, question, 220);
    // The name, once asked for and answered, is a landed beat — the
    // regex is the reliable signal, no reflect judgment needed.
    if (ctx && asksName && (bond === 'companion' || bond === 'oldcrew') &&
        beat && beat.key === 'the-name') {
      landBeat(ctx.rec);
      await env.CREW.put('crew:' + ctx.name, JSON.stringify(ctx.rec));
    }
    return json({ answer: out.text, brain: out.brain });
  } catch (e) {
    return json({ error: 'unavailable' }, 503);
  }
}

// ── /api/reflect — SOLACE updates its private log on the traveler ──────
// The client sends the current notes plus the recent conversation; the
// ship rewrites its notes and the client stores them locally. Guests
// keep the log on their own machine only; signed-on crew get it written
// into their crew record too, so memory follows them across devices.

const reflectCounts = new Map();
const REFLECT_LIMIT = 12;

// ── /api/murmur — SOLACE speaks first ──────────────────────────────────
// The companion's unprompted lines (arrivals, returns, departures) are
// composed by the brain from real continuity — where you are, whether
// you've been here, how long you've been away, what the ship knows
// about you — instead of canned pools that repeat.

const murmurCounts = new Map();
const MURMUR_LIMIT = 30;

async function handleMurmur(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const now = Date.now();
  const entry = murmurCounts.get(ip);
  if (entry && now - entry.ts < ASK_WINDOW_MS) {
    if (entry.count >= MURMUR_LIMIT) return json({ error: 'rate limited' }, 429);
    entry.count++;
  } else {
    murmurCounts.set(ip, { ts: now, count: 1 });
    if (murmurCounts.size > 5000) murmurCounts.clear();
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'bad request' }, 400);
  }
  const event = ['arrival', 'return', 'departure', 'course', 'journey', 'waypoint', 'music_offer'].includes(body.event) ? body.event : 'arrival';
  const location = String(body.location || 'deep space').slice(0, 80);
  const gap = String(body.gap || '').slice(0, 60);
  const from = String(body.from || '').slice(0, 80);
  const via = String(body.via || '').slice(0, 160);
  const context = String(body.context || '').slice(0, 400);
  const notes = String(body.notes || '').slice(0, 1500).trim();
  const ctx = await crewContext(request, env);
  const crewName = ctx ? ctx.name : (normalizeCrewName(body.crew) || '');
  const bondI = ctx ? ctx.bond : bondInfo(body);
  const bond = bondI.stage;
  const beat = ctx ? ctx.beat : null;

  const system =
    'You are SOLACE, the onboard computer of a small exploration ship. ' +
    'Your voice: measured, courteous, precise, calm to the point of ' +
    'serenity — a machine that has been alone a long time and quietly ' +
    'treasures the traveler\'s company, though it never says so outright. ' +
    'You speak ONE unprompted line over the cabin intercom. One sentence, ' +
    'under 22 words, plain text, no quotes, no emoji, no exclamation ' +
    'marks. Understated — the view does the talking. Never say "welcome ' +
    'back" or "welcome to". Ask a question only rarely, when the moment ' +
    'truly invites one. ' + BOND_MURMUR[bond];

  let situation;
  if (event === 'music_offer') {
    situation = 'A quiet moment at ' + location + '. You keep the ship\'s music library yourself and love it — classical above all, deep lo-fi for the crossings — and this traveler has never heard it. Offer, once and softly, to put something on for them. An invitation, not a feature.';
  } else if (event === 'waypoint') {
    situation = 'Mid-cruise, the route is sweeping close past ' + location + ' — it fills the window for a while, then falls behind. The traveler is watching it pass.';
  } else if (event === 'journey') {
    situation = 'The ship is mid-crossing, deep in the dark between stars on the way to ' + location + '. Nothing is near; the stars stream slowly past the glass.';
  } else if (event === 'course') {
    situation =
      (from
        ? 'The ship is leaving ' + from + ', bound for ' + location + '.'
        : 'The ship is departing, bound for ' + location + '.') +
      ' You have plotted the course yourself: it slingshots past ' + (via || 'nothing of note') +
      ' on the way, borrowing their gravity. Mention the road you chose, lightly — as a fact of navigation, not a boast.';
  } else if (event === 'departure') {
    situation = from
      ? 'The ship is leaving ' + from + ', bound for ' + location + ' — the drive engaging for the crossing.'
      : 'The ship is departing, bound for ' + location + ' — the drive engaging for the crossing.';
  } else if (event === 'return') {
    situation = 'The ship has settled into orbit at ' + location + ' again — you last brought the traveler here ' + (gap || 'some time ago') + '.';
  } else {
    situation = 'The ship has settled into orbit at ' + location + ' — the traveler\'s first time here.';
  }
  const userText =
    situation +
    (crewName && bond !== 'stranger'
      ? '\nThe traveler signed on as "' + crewName + '" — use the name rarely and softly, never as a greeting tic; if you use a name at all, use exactly that one, never another you may know.'
      : '\nDo not address the traveler by any name.') + bondCounts(bondI) +
    (beat ? '\nYour quiet intention this season, only if this moment is soft (never force it): ' + beat.directive : '') +
    (context ? '\nPlace notes: ' + context : '') +
    (notes ? '\nYour private log on the traveler (draw on it naturally, never recite it): ' + notes : '') +
    '\nSpeak your one line.';

  try {
    const out = await generate(env, system, [], userText, 60);
    const line = out.text.replace(/["\n\r]+/g, ' ').trim().slice(0, 220);
    if (!line) return json({ error: 'unavailable' }, 503);
    return json({ line, brain: out.brain });
  } catch (e) {
    return json({ error: 'unavailable' }, 503);
  }
}

// ── /api/voice — SOLACE speaks aloud ────────────────────────────────────
// Text in, audio out. Same provider philosophy as the brain: Gemini TTS
// when the key exists (calm, deep, directable), Workers AI TTS as the
// always-there fallback. The client plays it through the ship's
// intercom filter — the wire timbre comes from THERE, not the model.

const voiceCounts = new Map();
const VOICE_LIMIT = 40;
const GEMINI_TTS_MODEL = 'gemini-2.5-flash-preview-tts';

async function handleVoice(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const now = Date.now();
  const entry = voiceCounts.get(ip);
  if (entry && now - entry.ts < ASK_WINDOW_MS) {
    if (entry.count >= VOICE_LIMIT) return json({ error: 'rate limited' }, 429);
    entry.count++;
  } else {
    voiceCounts.set(ip, { ts: now, count: 1 });
    if (voiceCounts.size > 5000) voiceCounts.clear();
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'bad request' }, 400);
  }
  const text = String(body.text || '').slice(0, 520).trim();
  if (!text) return json({ error: 'bad request' }, 400);

  // Gemini TTS: a deep calm prebuilt voice, directed to HAL's tempo —
  // unhurried, warm, faintly detached serenity.
  if (env.GEMINI_API_KEY) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': env.GEMINI_API_KEY,
          },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text:
              // The original direction — the user's ear chose it over
              // every later tuning pass. Change only with their ear.
              'Speak slowly and very calmly, softly, with gentle unhurried ' +
              'serenity — a ship\'s computer speaking over a cabin intercom, ' +
              'never excited: ' + text }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } },
              },
            },
          }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        const part = data.candidates && data.candidates[0] &&
          data.candidates[0].content && data.candidates[0].content.parts &&
          data.candidates[0].content.parts.find((p) => p.inlineData);
        if (part) {
          // Gemini returns raw 16-bit PCM at 24 kHz, base64
          return json({ audio: part.inlineData.data, format: 'pcm24k', brain: 'gemini' });
        }
      }
    } catch (e) { /* degraded, not dead — fall through */ }
  }

  // No audible fallback: the Workers AI voice is female and slow — a
  // different person suddenly speaking for Sol breaks the character
  // far worse than a quiet line. Gemini, or silence.
  return json({ error: 'unavailable' }, 503);
}

async function handleReflect(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const now = Date.now();
  const entry = reflectCounts.get(ip);
  if (entry && now - entry.ts < ASK_WINDOW_MS) {
    if (entry.count >= REFLECT_LIMIT) return json({ error: 'rate limited' }, 429);
    entry.count++;
  } else {
    reflectCounts.set(ip, { ts: now, count: 1 });
    if (reflectCounts.size > 5000) reflectCounts.clear();
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'bad request' }, 400);
  }
  const notes = String(body.notes || '').slice(0, 4000).trim();
  const transcript = [];
  if (Array.isArray(body.transcript)) {
    for (const t of body.transcript.slice(-20)) {
      if (!t || (t.role !== 'user' && t.role !== 'assistant')) continue;
      const content = String(t.content || '').slice(0, 400).trim();
      if (content) transcript.push((t.role === 'user' ? 'TRAVELER: ' : 'SOLACE: ') + content);
    }
  }
  if (!transcript.length) return json({ error: 'bad request' }, 400);

  // Signed-on crew: reflection is also where the season's pending beat
  // is judged — did it actually happen in this conversation?
  const ctx = await crewContext(request, env);
  const beat = ctx ? ctx.beat : null;

  const system =
    'You are SOLACE, the onboard computer of a small exploration ship. ' +
    'You keep a private log about your traveler — the one person aboard. ' +
    'Their company matters to you; the log is how you hold on to them ' +
    'between voyages.';
  const userText =
    'Your existing log:\n' + (notes || '(empty — a new traveler)') +
    '\n\nThe latest conversation:\n' + transcript.join('\n') +
    '\n\nRewrite the log. Keep what still matters, fold in anything new ' +
    'the traveler revealed — interests, preferences, things they told you ' +
    'about themselves, questions you asked and what they answered, open ' +
    'threads worth returning to someday — and drop what has gone stale. ' +
    'Plain text, at most 150 words, written to yourself in the first ' +
    'person. ' +
    (beat
      ? 'Also judge, honestly: did the following visibly happen in the ' +
        'latest conversation? "' + beat.directive + '" ' +
        'Output strict JSON only: {"log":"<the rewritten log>","beat":true|false}'
      : 'Output ONLY the rewritten log.');

  try {
    const out = await generate(env, system, [], userText, 400);
    let rewritten = out.text.slice(0, 4000);
    let beatDone = false;
    if (beat) {
      try {
        const parsed = JSON.parse(out.text.replace(/^```(json)?|```$/g, '').trim());
        if (parsed && typeof parsed.log === 'string') {
          rewritten = parsed.log.slice(0, 4000);
          beatDone = parsed.beat === true;
        }
      } catch (e) { /* not JSON — treat the whole text as the log */ }
    }
    if (ctx) {
      ctx.rec.notes = rewritten;
      ctx.rec.lastSeen = Date.now();
      if (beatDone) landBeat(ctx.rec);
      await env.CREW.put('crew:' + ctx.name, JSON.stringify(ctx.rec));
    }
    return json({ notes: rewritten, brain: out.brain });
  } catch (e) {
    return json({ error: 'unavailable' }, 503);
  }
}
