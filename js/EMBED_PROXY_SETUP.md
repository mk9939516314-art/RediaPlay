# Permanent fix for the YouTube embed proxy

Every free public CORS proxy (corsproxy.io, allorigins, corsfix, etc.) is
someone else's free service — they all eventually add auth, rate-limit, or
shut down. That's not a flaw in any one of them, it's true of all of them.
The only genuinely permanent fix is one you own. Cloudflare Workers has a
free tier (100,000 requests/day, no credit card) run by a major cloud
provider that isn't going anywhere — this takes about 5 minutes, one time.

## Setup

1. Go to https://dash.cloudflare.com/ and sign up (free).
2. In the left sidebar: **Workers & Pages** → **Create** → **Create Worker**.
3. Give it any name (e.g. `redia-proxy`) → **Deploy** (it deploys a hello-world
   template first, that's fine).
4. Click **Edit code**, delete everything in the editor, and paste this:

```js
export default {
  async fetch(request) {
    const targetUrl = new URL(request.url).search.slice(1); // everything after the first "?", raw — matches the same convention as the default corsfix.com proxy, so switching EMBED_PROXY needs no other code changes
    if (!targetUrl) {
      return new Response('Missing target URL', { status: 400 });
    }
    const upstream = await fetch(targetUrl, {
      headers: { 'Referer': 'https://www.youtube.com/', 'Origin': 'https://www.youtube.com' }
    });
    const body = await upstream.arrayBuffer();
    const headers = new Headers(upstream.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.delete('X-Frame-Options');
    headers.delete('Content-Security-Policy');
    return new Response(body, { status: upstream.status, headers });
  }
};
```

5. Click **Deploy** (top right).
6. Copy the Worker's URL — it looks like `https://redia-proxy.YOUR-SUBDOMAIN.workers.dev`.

## Wire it into the app

Open `js/app.js`, find this line near the top of the `detectEmbed` section:

```js
const EMBED_PROXY = 'https://proxy.corsfix.com/?';
```

Replace it with your Worker's URL (same `?` convention, nothing else changes):

```js
const EMBED_PROXY = 'https://redia-proxy.YOUR-SUBDOMAIN.workers.dev/?';
```

That's it — nothing else in the app changes. This is now fully under your
own control: no one else's rate limit, no one else's shutdown, no API key
prompts.
