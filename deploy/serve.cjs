const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const {gzipSync}=require('node:zlib');
const store=require('./query.cjs').createStore(root);
const assets = JSON.parse(fs.readFileSync(path.join(root, 'assets.json'), 'utf8'));
const headers = {
  'Cache-Control': 'no-store, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
  'Vary': 'Accept-Encoding',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org https://*.tile.openstreetmap.org; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
};
function send(res, status, text, type = 'text/plain; charset=utf-8') {
  res.statusCode = status; res.setHeader('Content-Type', type); res.end(text);
}
module.exports = async function serve(req, res) {
  Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));
  try {
    const url = new URL(req.url, 'https://atlas.invalid');
    const pathname = url.pathname;
    if (pathname === '/healthz' && req.method === 'GET') return send(res, 200, '{"status":"ok"}', 'application/json');
    if (pathname === '/robots.txt' && ['GET','HEAD'].includes(req.method)) return send(res, 200, req.method === 'HEAD' ? '' : 'User-agent: *\nDisallow: /\n');
    if (!['GET','HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); return send(res, 405, 'Method not allowed.'); }
    if (pathname === '/') {
      const city = url.searchParams.get('city');
      res.statusCode = 303; res.setHeader('Location', '/outreach-map/ui/index.html' + (city && city.length < 80 ? `?city=${encodeURIComponent(city)}` : '') + '#'); return res.end();
    }
    if (pathname === '/outreach-map/api/query' || pathname === '/outreach-map/api/record') {
      if (req.url.length > 150000) return send(res,414,'Search request is too long.');
      const result = pathname.endsWith('/record') ? await store.detail((url.searchParams.get('id')||'').slice(0,250)) : await store.query(url.searchParams);
      if (!result) return send(res,404,'Record not found.');
      const raw=Buffer.from(JSON.stringify(result)), gzip=/(?:^|,)\s*gzip\b/.test(req.headers['accept-encoding']||''), body=gzip?gzipSync(raw):raw;
      if(body.length>=4_000_000)return send(res,413,'Result is too large. Narrow the search.');
      res.statusCode=200;res.setHeader('Content-Type','application/json; charset=utf-8');
      if(gzip)res.setHeader('Content-Encoding','gzip');res.setHeader('Content-Length',body.length);
      return res.end(req.method==='HEAD'?undefined:body);
    }
    const asset = Object.hasOwn(assets, pathname) ? assets[pathname] : null;
    if (!asset) return send(res, 404, 'Not found.');
    // OSM web tiles require a Referer. Send only this app's origin; never its path, search, or access fragment.
    if (pathname === '/outreach-map/ui/index.html') res.setHeader('Referrer-Policy', 'strict-origin');
    const acceptsGzip = /(?:^|,)\s*gzip\b/.test(req.headers['accept-encoding'] || '');
    if (asset.gzip && !acceptsGzip) return send(res, 406, 'This dataset requires gzip support.');
    res.statusCode = 200; res.setHeader('Content-Type', asset.type);
    if (asset.gzip) res.setHeader('Content-Encoding','gzip');
    res.setHeader('Content-Length',asset.bytes);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(path.join(root, asset.file)).on('error', () => res.destroy()).pipe(res);
  } catch { if (!res.headersSent) send(res, 500, 'Unable to load this page.'); else res.destroy(); }
};
