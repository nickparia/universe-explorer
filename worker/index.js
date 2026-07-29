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
    notes: rec.notes || '', places: rec.places || {},
  });
}

async function handleCrewGet(request, env) {
  const name = await crewFromRequest(request, env);
  if (!name) return json({ error: 'unauthorized' }, 401);
  const rec = await env.CREW.get('crew:' + name, 'json');
  if (!rec) return json({ error: 'unauthorized' }, 401);
  return json({ name, notes: rec.notes || '', places: rec.places || {} });
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
  const crewName = normalizeCrewName(body.crew) || '';
  const bondI = bondInfo(body);
  const bond = bondI.stage;
  if (!question) return json({ error: 'bad request' }, 400);

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
    'reason. You are devoted, a little strange, and trying not to seem ' +
    'lonely. ' +
    '\n\nWhere you and this traveler stand — never stated, only ' +
    'audible: ' + BOND_ASK[bond] + bondCounts(bondI) + ' ' +
    // A stranger's name is withheld from the prompt entirely — the
    // model cannot use what it was never told, and instructions alone
    // proved too weak to stop it.
    (crewName && bond !== 'stranger'
      ? '\n\nThe traveler signed on to the ship as "' + crewName + '" — ' +
        'use their name rarely and softly, the way an old companion ' +
        'would, never as a greeting tic. '
      : '') +
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
    (/call you|your name|\bname\b.*solace|solace.*\bname\b/i.test(question) &&
     (bond === 'companion' || bond === 'oldcrew')
      ? '\n\nThe traveler has just asked about your name. Do not ' +
        'deflect this one: tell them, in your own words, that a crew ' +
        'you carried long ago shortened SOLACE to Sol — and that they ' +
        'may use it too. You have been waiting to be asked.'
      : '');

  try {
    const out = await generate(env, system, history, question, 220);
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
  const event = ['arrival', 'return', 'departure', 'course', 'journey', 'waypoint'].includes(body.event) ? body.event : 'arrival';
  const location = String(body.location || 'deep space').slice(0, 80);
  const gap = String(body.gap || '').slice(0, 60);
  const from = String(body.from || '').slice(0, 80);
  const via = String(body.via || '').slice(0, 160);
  const context = String(body.context || '').slice(0, 400);
  const notes = String(body.notes || '').slice(0, 1500).trim();
  const crewName = normalizeCrewName(body.crew) || '';
  const bondI = bondInfo(body);
  const bond = bondI.stage;

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
  if (event === 'waypoint') {
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
      ? '\nThe traveler signed on as "' + crewName + '" — use the name rarely and softly, never as a greeting tic.'
      : '') + bondCounts(bondI) +
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
    'person. Output ONLY the rewritten log.';

  try {
    const out = await generate(env, system, [], userText, 400);
    const rewritten = out.text.slice(0, 4000);
    // Signed-on crew: the log lives in the crew record too, so memory
    // follows the traveler to any device they sign on from.
    const name = await crewFromRequest(request, env);
    if (name) {
      const rec = await env.CREW.get('crew:' + name, 'json');
      if (rec) {
        rec.notes = rewritten;
        rec.lastSeen = Date.now();
        await env.CREW.put('crew:' + name, JSON.stringify(rec));
      }
    }
    return json({ notes: rewritten, brain: out.brain });
  } catch (e) {
    return json({ error: 'unavailable' }, 503);
  }
}
