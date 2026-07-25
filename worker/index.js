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

    if (!MEDIA_PREFIX.test(key)) {
      return env.ASSETS.fetch(request);
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
  if (!question) return json({ error: 'bad request' }, 400);

  const system =
    'You are SOLACE, the calm onboard computer of a small exploration ship. ' +
    'The traveler is drifting in orbit at: ' + location + '. ' +
    'Reference notes about this place:\n' + context + '\n\n' +
    'Answer in one to three short sentences. Factual first, quietly poetic ' +
    'second — never gushing, no exclamation marks, no emoji, plain text. ' +
    'You may use your broader astronomy knowledge beyond the notes. Double-check ' +
    'any numbers or calculations before stating them. If the ' +
    'question is unrelated to space or the journey, answer briefly and ' +
    'gently steer back to the view.';

  try {
    const result = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: question },
      ],
      max_tokens: 220,
    });
    return json({ answer: result.response || '' });
  } catch (e) {
    return json({ error: 'unavailable' }, 503);
  }
}
