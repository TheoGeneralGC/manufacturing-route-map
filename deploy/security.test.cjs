const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
test('public map serves only allowlisted files without credentials or cookies',async()=>{
  const bundle=path.join(__dirname,'.vercel/output/functions/atlas.func');
  const assets=JSON.parse(fs.readFileSync(path.join(bundle,'assets.json')));
  const expected=JSON.parse(fs.readFileSync(path.join(__dirname,'build-manifest.json')));
  assert.equal(expected.access,'public');
  assert.deepEqual(fs.readdirSync(bundle).sort(),['.vc-config.json','assets','assets.json','serve.cjs']);
  const server=http.createServer(require(path.join(bundle,'serve.cjs')));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function request(url,options={}){const r=await fetch(base+url,{redirect:'manual',headers:{'Accept-Encoding':'gzip'},...options});assert.equal(r.headers.get('set-cookie'),null,url);assert.match(r.headers.get('cache-control'),/no-store/);return r;}
  try{
    for(const method of ['GET','HEAD']){
      const r=await request('/',{method});assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/outreach-map/ui/index.html#');
      const city=await request('/?city=Tracy',{method});assert.equal(city.status,303);assert.equal(city.headers.get('location'),'/outreach-map/ui/index.html?city=Tracy#');
    }
    for(const [url,asset] of Object.entries(assets))for(const method of ['GET','HEAD']){
      assert.match(url,/^\/outreach-map\/(ui|data)\//);
      const r=await request(url,{method});assert.equal(r.status,200,method+' '+url);assert.equal(r.headers.get('content-type'),asset.type);assert.equal(Number(r.headers.get('content-length')),asset.bytes);assert.ok(asset.bytes<4_000_000);
      assert.equal(r.headers.get('referrer-policy'),url.endsWith('/ui/index.html')?'strict-origin':'no-referrer');
      if(asset.gzip)assert.equal(r.headers.get('content-encoding'),'gzip');
      const body=await r.arrayBuffer();if(method==='HEAD')assert.equal(body.byteLength,0);else assert.ok(body.byteLength>0);
    }
    const manifest=await (await request('/outreach-map/data/manifest.json')).json();assert.equal(manifest.sha256,expected.data_sha256);
    let records=0;for(const chunk of manifest.chunks){const rows=await (await request('/outreach-map/data/'+chunk.path)).json();assert.equal(rows.length,chunk.records);records+=rows.length;}
    assert.equal(records,30784);assert.equal(records,manifest.total_records);assert.equal(records,expected.records);
    for(const url of ['/assets.json','/assets/0000','/serve.cjs','/.access-key','/.share-link','/.env','/.vercel/project.json','/access','/access.js','/access.html','/sources/export.csv','/outreach-map/data/plants.json','/manufacturing-outreach.xlsx','/outreach-map/data/%2e%2e/%2e%2e/assets.json'])for(const method of ['GET','HEAD'])assert.equal((await request(url,{method})).status,404,method+' '+url);
    for(const url of ['/','/access','/outreach-map/ui/index.html','/outreach-map/data/manifest.json']){const r=await request(url,{method:'POST'});assert.equal(r.status,405,url);assert.equal(r.headers.get('allow'),'GET, HEAD');}
    assert.equal((await request('/outreach-map/data/manifest.json',{headers:{Cookie:'__Host-field_atlas=obsolete'}})).status,200);
    assert.equal((await request('/healthz')).status,200);assert.equal((await request('/robots.txt')).status,200);
    console.log(`Verified ${records} public rows, ${Object.keys(assets).length} GET/HEAD assets, no cookies, redirects, POST and internal-file denial.`);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
