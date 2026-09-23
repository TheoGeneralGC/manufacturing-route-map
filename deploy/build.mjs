import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {fileURLToPath} from 'node:url';
import {gzipSync,gunzipSync,createGunzip} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {compact,encoder,lookupBucket,mapped}=require('./query.cjs');
const here=path.dirname(fileURLToPath(import.meta.url)), source=path.dirname(here);
const output=path.join(here,'.vercel/output'), func=path.join(output,'functions/atlas.func');
fs.rmSync(path.join(here,'build-manifest.json'),{force:true});
fs.rmSync(output,{recursive:true,force:true});
for(const dir of ['assets','records','index','lookup'])fs.mkdirSync(path.join(func,dir),{recursive:true});
const assets={}; let counter=0, total=0, detailNumber=0, indexNumber=0, detailRows=[], storageBytes=0;
const hash=createHash('sha256'), counts={state:new Map(),county:new Map(),industry:new Map(),source:new Map()}, bands=new Set(), indexFiles=[];
const packed=encoder(),indexBuffers=new Map(),states=new Map(),cities=new Map(),counties=new Map(),zips=new Map(),lookup=Array.from({length:64},()=>Object.create(null));
function write(relative,bytes){fs.writeFileSync(path.join(func,relative),bytes);storageBytes+=bytes.length;}
function add(url,bytes,type,gzip=false) {
  if(bytes.length>=4_000_000)throw Error(`Asset exceeds bounded function payload: ${url}`);
  const file=`assets/${String(counter++).padStart(4,'0')}`;write(file,bytes);assets[url]={file,type,bytes:bytes.length,gzip};
}
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
function walk(dir,prefix='') {for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const rel=path.join(prefix,entry.name);if(entry.isDirectory())walk(path.join(dir,entry.name),rel);else if(mime[path.extname(entry.name)])add('/outreach-map/ui/'+rel.split(path.sep).join('/'),fs.readFileSync(path.join(dir,entry.name)),mime[path.extname(entry.name)]);}}
walk(path.join(source,'ui'));
function flushDetails(){if(!detailRows.length)return;write(`records/${detailNumber++}.json.gz`,gzipSync(JSON.stringify(detailRows)));detailRows=[];}
function flushIndex(code){const rows=indexBuffers.get(code);if(!rows?.length)return;const filename=`index/${code}-${indexNumber++}.json.gz`;write(filename,gzipSync(JSON.stringify(rows)));indexFiles.push(filename);states.get(code).files.push(filename);indexBuffers.set(code,[]);}
function count(type,value){if(value)counts[type].set(value,(counts[type].get(value)||0)+1);}
function locality(map,key,code){if(!key)return;let set=map.get(key);if(!set){set=new Set();map.set(key,set);}set.add(code);}
function consume(row){
  if(!row.id || !row.state)throw Error('Every national record needs an explicit stable ID and state');
  const r=compact(row,detailNumber);if(!/^[A-Z]{2}$/.test(r.state))throw Error('Invalid state in national data');
  if(!states.has(r.state))states.set(r.state,{files:[],bounds:null});
  const s=states.get(r.state);if(mapped(r))s.bounds=s.bounds?[Math.min(s.bounds[0],r.longitude),Math.min(s.bounds[1],r.latitude),Math.max(s.bounds[2],r.longitude),Math.max(s.bounds[3],r.latitude)]:[r.longitude,r.latitude,r.longitude,r.latitude];
  locality(cities,r.city.toLowerCase(),r.state);locality(counties,r.county.toLowerCase(),r.state);locality(zips,r.zip.slice(0,5),r.state);
  if(!indexBuffers.has(r.state))indexBuffers.set(r.state,[]);indexBuffers.get(r.state).push(packed.encode(r));
  const ids=lookup[lookupBucket(r.id)];if(Object.hasOwn(ids,r.id))throw Error(`Duplicate canonical ID: ${r.id}`);
  ids[r.id]=detailNumber;detailRows.push(row);total++;
  if(total%100000===0)console.log(`Indexed ${total.toLocaleString('en-US')} locations…`);
  count('state',r.state);count('county',r.county?`${r.state}|${r.county}`:'');count('industry',r.industry);
  for(const name of r.sourceNames)count('source',name);bands.add(r.employee_band);
  if(detailRows.length>=250)flushDetails();
  if(indexBuffers.get(r.state).length>=2500)flushIndex(r.state);
}
const jsonl=path.join(source,'data/plants.jsonl.gz');
const nationalDir=path.join(source,'data/national'),nationalManifest=path.join(nationalDir,'manifest.json');
let expectedInput;
async function consumeJSONL(filename,expected){
  const before=total,compressedHash=createHash('sha256'),input=fs.createReadStream(filename),stream=createGunzip();
  input.on('data',bytes=>compressedHash.update(bytes));input.on('error',error=>stream.destroy(error));input.pipe(stream);
  stream.on('data',bytes=>hash.update(bytes));
  for await(const line of readline.createInterface({input:stream,crlfDelay:Infinity}))if(line.trim())consume(JSON.parse(line));
  const digest=compressedHash.digest('hex');
  if(expected&&(digest!==expected.sha256||total-before!==expected.records))throw Error(`Input part integrity mismatch: ${path.basename(filename)}`);
}
if(fs.existsSync(nationalManifest)){
  expectedInput=JSON.parse(fs.readFileSync(nationalManifest,'utf8'));
  if(!Array.isArray(expectedInput.parts)||!expectedInput.parts.length||!Number.isSafeInteger(expectedInput.total_records)||!/^[a-f0-9]{64}$/.test(expectedInput.data_sha256))throw Error('Invalid national input manifest');
  const names=new Set();
  for(const part of expectedInput.parts){
    if(!/^[A-Za-z0-9_-]+\.jsonl\.gz$/.test(part.name)||names.has(part.name)||!Number.isSafeInteger(part.records)||part.records<0||!/^[a-f0-9]{64}$/.test(part.sha256))throw Error('Invalid or duplicate national input part');
    names.add(part.name);await consumeJSONL(path.join(nationalDir,part.name),part);
  }
}else if(fs.existsSync(jsonl)){
  await consumeJSONL(jsonl);
}else{
  const raw=gunzipSync(fs.readFileSync(path.join(source,'data/plants.json.gz')));hash.update(raw);
  for(const row of JSON.parse(raw))consume(row);
}
flushDetails();for(const code of indexBuffers.keys())flushIndex(code);
const digest=hash.digest('hex');
if(expectedInput&&(expectedInput.total_records!==total||expectedInput.data_sha256!==digest))throw Error('National input total or decompressed SHA mismatch');
const metadata={version:2,total_records:total,sha256:digest,api:'/outreach-map/api',employee_bands:[...bands],filters:Object.fromEntries(Object.entries(counts).map(([name,map])=>[name,[...map].sort((a,b)=>a[0].localeCompare(b[0]))]))};
add('/outreach-map/data/manifest.json',Buffer.from(JSON.stringify(metadata)),'application/json; charset=utf-8');
add('/outreach-map/data/coverage.json',fs.readFileSync(path.join(source,'data/coverage.json')),'application/json; charset=utf-8');
write('index-files.json',Buffer.from(JSON.stringify(indexFiles)));
const sets=map=>Object.fromEntries([...map].map(([key,set])=>[key,[...set]]));
write('index-catalog.json.gz',gzipSync(JSON.stringify({version:1,states:Object.fromEntries(states),dictionaries:packed.dictionaries,cities:sets(cities),counties:sets(counties),zips:sets(zips)})));
for(let i=0;i<lookup.length;i++)write(`lookup/${i}.json.gz`,gzipSync(JSON.stringify(lookup[i])));
write('assets.json',Buffer.from(JSON.stringify(assets)));
for(const file of ['serve.cjs','query.cjs'])write(file,fs.readFileSync(path.join(here,file)));
if(storageBytes>230_000_000)throw Error(`Compressed deployment storage ${storageBytes} exceeds the 230MB safety budget`);
fs.writeFileSync(path.join(func,'.vc-config.json'),JSON.stringify({runtime:'nodejs22.x',handler:'serve.cjs',launcherType:'Nodejs',shouldAddHelpers:true,maxDuration:60,memory:2048}));
fs.writeFileSync(path.join(output,'config.json'),JSON.stringify({version:3,routes:[{src:'/.*',dest:'/atlas'}]}));
fs.writeFileSync(path.join(here,'build-manifest.json'),JSON.stringify({records:total,chunks:detailNumber,index_chunks:indexNumber,data_sha256:metadata.sha256,asset_count:Object.keys(assets).length,storage_bytes:storageBytes,max_response_bytes:Math.max(...Object.values(assets).map(a=>a.bytes)),public_static_files:0,access:'public',auth:'None — public access requested by user',built_at:new Date().toISOString()},null,2));
console.log(`Prepared public national map: ${total} records, ${detailNumber} detail batches, ${indexNumber} search shards, ${(storageBytes/1e6).toFixed(1)}MB compressed storage.`);
