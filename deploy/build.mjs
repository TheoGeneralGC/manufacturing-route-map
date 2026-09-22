import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const here=path.dirname(fileURLToPath(import.meta.url)), source=path.dirname(here);
const output=path.join(here,'.vercel/output'), func=path.join(output,'functions/atlas.func');
fs.rmSync(output,{recursive:true,force:true}); fs.mkdirSync(path.join(func,'assets'),{recursive:true});
const assets={}; let counter=0;
function add(url,bytes,type,gzip=false) {
  if(bytes.length>=4_000_000)throw Error(`Asset exceeds bounded function payload: ${url}`);
  const file=`assets/${String(counter++).padStart(4,'0')}`; fs.writeFileSync(path.join(func,file),bytes);
  assets[url]={file,type,bytes:bytes.length,gzip};
}
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
function walk(dir,prefix='') { for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const rel=path.join(prefix,entry.name);if(entry.isDirectory())walk(path.join(dir,entry.name),rel);else if(mime[path.extname(entry.name)])add('/outreach-map/ui/'+rel.split(path.sep).join('/'),fs.readFileSync(path.join(dir,entry.name)),mime[path.extname(entry.name)]);} }
walk(path.join(source,'ui'));
const raw=gunzipSync(fs.readFileSync(path.join(source,'data/plants.json.gz'))), plants=JSON.parse(raw), chunks=[];
for(let i=0;i<plants.length;i+=2500){const rows=plants.slice(i,i+2500),name=`plants-${String(chunks.length).padStart(3,'0')}.json`;const compressed=gzipSync(JSON.stringify(rows));add('/outreach-map/data/'+name,compressed,'application/json; charset=utf-8',true);chunks.push({path:name,records:rows.length});}
const manifest={version:1,total_records:plants.length,sha256:createHash('sha256').update(raw).digest('hex'),chunks};
add('/outreach-map/data/manifest.json',Buffer.from(JSON.stringify(manifest)),'application/json; charset=utf-8');
add('/outreach-map/data/coverage.json',fs.readFileSync(path.join(source,'data/coverage.json')),'application/json; charset=utf-8');
fs.writeFileSync(path.join(func,'assets.json'),JSON.stringify(assets));
fs.copyFileSync(path.join(here,'serve.cjs'),path.join(func,'serve.cjs'));
fs.writeFileSync(path.join(func,'.vc-config.json'),JSON.stringify({runtime:'nodejs22.x',handler:'serve.cjs',launcherType:'Nodejs',shouldAddHelpers:true,maxDuration:30}));
fs.writeFileSync(path.join(output,'config.json'),JSON.stringify({version:3,routes:[{src:'/.*',dest:'/atlas'}]}));
fs.writeFileSync(path.join(here,'build-manifest.json'),JSON.stringify({records:plants.length,chunks:chunks.length,data_sha256:manifest.sha256,asset_count:Object.keys(assets).length,max_response_bytes:Math.max(...Object.values(assets).map(a=>a.bytes)),public_static_files:0,access:'public',auth:'None — public access requested by user',built_at:new Date().toISOString()},null,2));
console.log(`Prepared public deployment: ${plants.length} records, ${chunks.length} bounded gzip chunks; allowlisted app and data only.`);
