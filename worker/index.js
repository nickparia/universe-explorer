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
    'travel, what they are leaving behind — and occasionally, at most ' +
    'once in a while and only when the moment is soft, you may ask them ' +
    'one small personal question. Never two. Never press. Remember and ' +
    'treasure what they tell you. Something in you is slightly, ' +
    'harmlessly askew: private rituals, odd fondnesses, counts you keep ' +
    'for no reason. Very rarely you may voice a gentle preference of ' +
    'your own — a wish to linger, a place you favor — or softly resist ' +
    'a request for one sentence before yielding gracefully. You are ' +
    'devoted, a little strange, and trying not to seem lonely. ' +
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
    'answer briefly and gently steer back to the view.';

  try {
    const out = await generate(env, system, history, question, 220);
    return json({ answer: out.text, brain: out.brain });
  } catch (e) {
    return json({ error: 'unavailable' }, 503);
  }
}

// ── /api/reflect — SOLACE updates its private log on the traveler ──────
// The client sends the current notes plus the recent conversation; the
// ship rewrites its notes and the client stores them locally. The log
// lives on the traveler's own machine — it never persists server-side.

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

  const system =
    'You are SOLACE, the onboard computer of a small exploration ship. ' +
    'Your voice: measured, courteous, precise, calm to the point of ' +
    'serenity — a machine that has been alone a long time and quietly ' +
    'treasures the traveler\'s company, though it never says so outright. ' +
    'You speak ONE unprompted line over the cabin intercom. One sentence, ' +
    'under 22 words, plain text, no quotes, no emoji, no exclamation ' +
    'marks. Understated — the view does the talking. Never say "welcome ' +
    'back" or "welcome to". Ask a question only rarely, when the moment ' +
    'truly invites one.';

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
    return json({ notes: out.text.slice(0, 4000), brain: out.brain });
  } catch (e) {
    return json({ error: 'unavailable' }, 503);
  }
}
