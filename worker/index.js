// Solace edge worker.
//
// Media (audio/textures/models) lives in R2, not in the deployed assets —
// the catalog of locations will keep growing and media updates shouldn't
// require a code deploy. Everything else is served from static assets.

const MEDIA_PREFIX = /^(audio|textures|models|locations)\//;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const key = decodeURIComponent(url.pathname.slice(1));

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
