/**
 * Edge entry point for MWL Timesheet.
 *
 * Serves the pre-rendered SPA (dist/, built by scripts/render-static.mjs) from
 * Cloudflare's network, and proxies /api/* to the on-prem Flask origin.
 *
 * Everything is on ONE hostname, so the browser stays same-origin: no CORS
 * headers, no `credentials: 'include'`, no SameSite=None. static/app/core.js
 * `api()` keeps using relative /api/... paths unchanged.
 *
 * The Python backend is NOT hosted here — it cannot be. Workers reach MSSQL
 * through neither Hyperdrive (PostgreSQL/MySQL only) nor pyodbc (a C extension
 * Pyodide can't load). See CLAUDE.md §9a.
 */

interface Env {
  /** Static assets from dist/ (see wrangler.jsonc `assets`). */
  ASSETS: Fetcher;
  /** VPC Service bound to the Cloudflare Tunnel that fronts Flask. Production. */
  ORIGIN?: Fetcher;
  /** Plain-fetch origin for `wrangler dev` against a local Flask. Dev only. */
  ORIGIN_URL?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    // Flask's CSRF check (app/__init__.py verify_api_csrf_origin) reconstructs
    // the public origin from these two headers, because behind the tunnel the
    // raw Host is always localhost:5050. Derive the scheme from the incoming
    // request rather than hardcoding https, so `wrangler dev` over plain HTTP
    // still produces a matching origin.
    const headers = new Headers(request.headers);
    headers.set('X-Forwarded-Host', url.host);
    headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));
    const proxied = new Request(request, { headers });

    if (env.ORIGIN) {
      // A VPC Service ignores the URL's host and port for routing (the binding
      // decides where it lands) but does use the host for the Host header, so
      // Flask still sees the public hostname and request.host_url is unchanged.
      //
      // The *scheme* is NOT ignored: it selects which of the service's ports to
      // use. Ours is registered with an http_port only (Waitress speaks
      // plaintext on 5050), so forwarding the browser's original https:// URL
      // fails with `port_not_open`. Rewrite it to http:// — the Worker→tunnel
      // hop is encrypted regardless of scheme.
      //
      // Consequence, and the reason WORKER_DOMAIN is REQUIRED here: the rewrite
      // happens before the headers are read back, so Flask receives
      // `X-Forwarded-Proto: http` and reconstructs `http://<host>/`. Its
      // _is_same_origin() compares schemes strictly, so the browser's
      // `https://<host>` Origin does NOT match and every non-GET /api/* would
      // 403. WORKER_DOMAIN trusts both schemes for that host and closes the gap.
      // See CLAUDE.md §9a.
      const originUrl = new URL(url);
      originUrl.protocol = 'http:';
      originUrl.port = '';
      return env.ORIGIN.fetch(new Request(originUrl, proxied));
    }

    if (env.ORIGIN_URL) {
      const target = new URL(url.pathname + url.search, env.ORIGIN_URL);
      return fetch(new Request(target, proxied));
    }

    return Response.json(
      { error: 'No origin configured for this Worker environment.' },
      { status: 503 },
    );
  },
} satisfies ExportedHandler<Env>;
