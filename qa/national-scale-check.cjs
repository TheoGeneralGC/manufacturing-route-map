// Local cold-store capacity check; does not modify source data or deploy anything.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {gzipSync}=require('node:zlib');
const bundle=path.resolve(__dirname,'../deploy/.vercel/output/functions/atlas.func');
const {createStore}=require(path.join(bundle,'query.cjs'));
(async()=>{
  const store=createStore(bundle),build=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../deploy/build-manifest.json'))),checks=[];
  let last;
  for(const [name,params] of [
    ['cold_initial_map','inView=1&bbox=-123.8,35.3,-118,40.1&zoom=7'],
    ['warm_tracy','q=Tracy%2C+CA&bbox=-122,37,-121,38&zoom=12'],
    ['nearby_1_mile','lat=37.739&lon=-121.425&radius=1&sort=distance&bbox=-122,37,-121,38&zoom=14'],
    ['austin_texas','q=Austin%2C+TX&bbox=-98,29,-97,31&zoom=10'],
    ['first_national_all','evidence=&bbox=-180,-85,180,85&zoom=3'],
    ['warm_national_current','bbox=-180,-85,180,85&zoom=3'],
  ]){
    const started=performance.now();last=await store.query(new URLSearchParams(params));const ms=Math.round(performance.now()-started);
    const raw=Buffer.from(JSON.stringify(last));
    assert.ok(last.rows.length<=80);assert.ok(last.features.length<=1200);assert.ok(raw.length<4_000_000);
    assert.equal(last.features.reduce((n,f)=>n+(f.count||1),0),last.viewport_mapped);
    if(name==='first_national_all')assert.equal(last.total,build.records);
    checks.push({name,ms,total:last.total,mapped:last.mapped,page:last.rows.length,features:last.features.length,raw_bytes:raw.length,gzip_bytes:gzipSync(raw).length});
  }
  const started=performance.now(),detail=await store.detail(last.rows[0].id);assert.ok(detail?.id);
  checks.push({name:'selected_detail',ms:Math.round(performance.now()-started),fields:Object.keys(detail).length});
  const memory=process.memoryUsage(),report={records:build.records,storage_bytes:build.storage_bytes,data_sha256:build.data_sha256,node:process.version,checks,heap_mb:memory.heapUsed/1e6,rss_mb:memory.rss/1e6,checked_at:new Date().toISOString()};
  const target=path.resolve(__dirname,'../../plant-outreach-map/sources/us-manufacturing-import/map-final-scale-check.json');
  fs.writeFileSync(target,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
