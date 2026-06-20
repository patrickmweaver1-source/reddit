// Netlify serverless function — server-side proxy for the Reddit Signal Scanner.
// Runs on Netlify's servers, so there is NO CORS problem: the browser calls
// this function on your own domain, and the function fetches the data source.
//
// Endpoints:
//   /.netlify/functions/proxy?source=apewisdom&filter=all-stocks&page=1
//   /.netlify/functions/proxy?source=reddit&ticker=NVDA&sub=all
//
// No API keys required. No third-party CORS proxies involved.

export default async (req) => {
  const url = new URL(req.url);
  const source = url.searchParams.get('source');

  // CORS headers so your own page can call it from anywhere
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: cors });
  }

  try {
    let targetUrl;

    if (source === 'apewisdom') {
      const filter = (url.searchParams.get('filter') || 'all-stocks').replace(/[^a-zA-Z0-9_-]/g, '');
      const page = parseInt(url.searchParams.get('page') || '1', 10) || 1;
      targetUrl = `https://apewisdom.io/api/v1.0/filter/${filter}/page/${page}`;

    } else if (source === 'reddit') {
      const ticker = (url.searchParams.get('ticker') || '').replace(/[^a-zA-Z0-9.]/g, '');
      const sub = (url.searchParams.get('sub') || 'all').replace(/[^a-zA-Z0-9_]/g, '');
      const q = encodeURIComponent(`$${ticker} OR "${ticker}"`);
      const subPath = sub === 'all' ? '' : `r/${sub}/`;
      targetUrl = `https://www.reddit.com/${subPath}search.json?q=${q}&sort=top&t=day&limit=10&restrict_sr=false`;

    } else {
      return new Response(JSON.stringify({ error: 'Unknown source. Use source=apewisdom or source=reddit' }),
        { status: 400, headers: cors });
    }

    // Server-side fetch — a real User-Agent is allowed here (not a browser)
    const upstream = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'RedditSignalScanner/1.0 (+netlify-function)',
        'Accept': 'application/json',
      },
    });

    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: `Upstream ${source} returned HTTP ${upstream.status}` }),
        { status: 502, headers: cors });
    }

    const text = await upstream.text();
    // Pass through as-is (already JSON); validate it parses
    try { JSON.parse(text); } catch {
      return new Response(JSON.stringify({ error: `Upstream ${source} returned non-JSON` }),
        { status: 502, headers: cors });
    }

    return new Response(text, { status: 200, headers: cors });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
};
