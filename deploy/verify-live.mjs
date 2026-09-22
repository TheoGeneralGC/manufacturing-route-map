import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const here=path.dirname(fileURLToPath(import.meta.url));
const base='https://manufacturing-route-map.vercel.app';
const checks=[];
const expected=JSON.parse(fs.readFileSync(path.join(here,'build-manifest.json')));
const bundle=path.join(here,'.vercel/output/functions/atlas.func');
const assets=JSON.parse(fs.readFileSync(path.join(bundle,'assets.json')));
assert.equal(expected.access,'public');
async function request(url,options={}){const r=await fetch(base+url,{redirect:'manual',headers:{'Accept-Encoding':'gzip'},...options});assert.equal(r.headers.get('set-cookie'),null,'No cookies: '+url);assert.match(r.headers.get('cache-control'),/no-store/);return r;}
for(const method of ['GET','HEAD']){const r=await request('/',{method});assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/outreach-map/ui/index.html#');}
checks.push('Public root redirects directly to map without login or cookies');
for(const [url,asset] of Object.entries(assets))for(const method of ['GET','HEAD']){
  const r=await request(url,{method});assert.equal(r.status,200,method+' '+url);
  assert.equal(r.headers.get('referrer-policy'),url.endsWith('/ui/index.html')?'strict-origin':'no-referrer');
  const actual=Buffer.from(await r.arrayBuffer());
  if(method==='HEAD')assert.equal(actual.length,0);
  else {const stored=fs.readFileSync(path.join(bundle,asset.file));const local=asset.gzip?gunzipSync(stored):stored;assert.equal(createHash('sha256').update(actual).digest('hex'),createHash('sha256').update(local).digest('hex'),'Live asset matches build: '+url);}
}
checks.push('Cookie-less GET/HEAD succeeds for all '+Object.keys(assets).length+' assets; every GET matches local build bytes');
const manifest=await (await request('/outreach-map/data/manifest.json')).json();assert.equal(manifest.sha256,expected.data_sha256);
let records=0;for(const chunk of manifest.chunks){const r=await request('/outreach-map/data/'+chunk.path);assert.equal(r.status,200,chunk.path);const rows=await r.json();assert.equal(rows.length,chunk.records);records+=rows.length;}
assert.equal(records,30784);assert.equal(records,manifest.total_records);assert.equal(records,expected.records);checks.push('Public data SHA and all chunks verified: '+records+' records');
for(const name of ['index.html','app.js','styles.css']){const r=await request('/outreach-map/ui/'+name);const actual=Buffer.from(await r.arrayBuffer());const local=fs.readFileSync(path.join(here,'../ui',name));assert.equal(createHash('sha256').update(actual).digest('hex'),createHash('sha256').update(local).digest('hex'),'Live UI matches source: '+name);checks.push('Live UI matches source: '+name);}
for(const url of ['/assets.json','/assets/0000','/serve.cjs','/.access-key','/.share-link','/.env','/.vercel/project.json','/access','/access.js','/access.html','/sources/export.csv','/outreach-map/data/plants.json','/manufacturing-outreach.xlsx'])for(const method of ['GET','HEAD'])assert.equal((await request(url,{method})).status,404,method+' '+url);
for(const url of ['/','/access','/outreach-map/data/manifest.json'])assert.equal((await request(url,{method:'POST'})).status,405,'POST '+url);
checks.push('Internal files and raw exports unavailable; POST denied; no Set-Cookie');
const report={passed:true,access:'public',base,records,chunks:manifest.chunks.length,data_sha256:manifest.sha256,checks,verified_at:new Date().toISOString()};
fs.mkdirSync(path.join(here,'../qa'),{recursive:true});
fs.writeFileSync(path.join(here,'../qa/live-deployment-verification.json'),JSON.stringify(report,null,2));
fs.writeFileSync(path.join(here,'.share-link'),base+'\n',{mode:0o600});
console.log(JSON.stringify(report,null,2));
