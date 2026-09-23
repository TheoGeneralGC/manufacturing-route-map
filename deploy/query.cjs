// Read-only national search. Full records load only for a selected location.
const fs=require('node:fs'),path=require('node:path');
const {gunzipSync}=require('node:zlib');
const BAND_KEYS=['1-9','10-49','50-249','250+','unknown','uncertain','zero'];
const STATE_NAMES={alabama:'AL',alaska:'AK',arizona:'AZ',arkansas:'AR',california:'CA',colorado:'CO',connecticut:'CT',delaware:'DE','district of columbia':'DC',florida:'FL',georgia:'GA',hawaii:'HI',idaho:'ID',illinois:'IL',indiana:'IN',iowa:'IA',kansas:'KS',kentucky:'KY',louisiana:'LA',maine:'ME',maryland:'MD',massachusetts:'MA',michigan:'MI',minnesota:'MN',mississippi:'MS',missouri:'MO',montana:'MT',nebraska:'NE',nevada:'NV','new hampshire':'NH','new jersey':'NJ','new mexico':'NM','new york':'NY','north carolina':'NC','north dakota':'ND',ohio:'OH',oklahoma:'OK',oregon:'OR',pennsylvania:'PA','rhode island':'RI','south carolina':'SC','south dakota':'SD',tennessee:'TN',texas:'TX',utah:'UT',vermont:'VT',virginia:'VA',washington:'WA','west virginia':'WV',wisconsin:'WI',wyoming:'WY'};
const text=v=>Array.isArray(v)?v.join(', '):String(v??'');
const INDEX_FIELDS=['id','name','address','city','state','county','zip','latitude','longitude','employees','employee_range','employees_year','employee_scope','industry','industry_detail','evidence_type','geocode_quality','operating_status','headcount_multiple_addresses','location_requires_access_review','location_status','dedup_review_group','sourceNames','owner_name','contact_name','employee_band','_low','_quality','_status','_detail','merged_ids','_search','_sort'];
const DICTIONARY_FIELDS=['city','state','county','zip','employee_range','employees_year','employee_scope','industry','industry_detail','evidence_type','geocode_quality','operating_status','location_status','sourceNames','employee_band','_quality','_status'];
function encoder(){const dictionaries=Object.fromEntries(DICTIONARY_FIELDS.map(k=>[k,[]])),maps=Object.fromEntries(DICTIONARY_FIELDS.map(k=>[k,new Map()]));return {dictionaries,encode(row){return INDEX_FIELDS.map(k=>{const v=row[k]??null;if(v===null||!maps[k])return v;const key=Array.isArray(v)?JSON.stringify(v):v;let index=maps[k].get(key);if(index===undefined){index=dictionaries[k].length;maps[k].set(key,index);dictionaries[k].push(v);}return index;});}};}
function decodeIndex(row,dictionaries){const v=row.map((x,i)=>x===null?null:dictionaries[INDEX_FIELDS[i]]?dictionaries[INDEX_FIELDS[i]][x]:x);return {id:v[0],name:v[1],address:v[2],city:v[3],state:v[4],county:v[5],zip:v[6],latitude:v[7],longitude:v[8],employees:v[9],employee_range:v[10],employees_year:v[11],employee_scope:v[12],industry:v[13],industry_detail:v[14],evidence_type:v[15],geocode_quality:v[16],operating_status:v[17],headcount_multiple_addresses:v[18],location_requires_access_review:v[19],location_status:v[20],dedup_review_group:v[21],sourceNames:v[22],owner_name:v[23],contact_name:v[24],employee_band:v[25],_low:v[26],_quality:v[27],_status:v[28],_detail:v[29],merged_ids:v[30],_search:v[31],_sort:v[32]};}
function lookupBucket(id){let hash=2166136261;for(let i=0;i<id.length;i++)hash=Math.imul(hash^id.charCodeAt(i),16777619);return (hash>>>0)%64;}
function employeeBounds(p){
  if(p.employees!==null&&p.employees!==undefined&&p.employees!==''&&Number(p.employees)>=0)return [Number(p.employees),Number(p.employees)];
  const range=text(p.employee_range),nums=range.replaceAll(',','').match(/\d+/g)?.map(Number);
  if(!nums||/unknown|unavailable|not reported|^n\/a$/i.test(range))return null;
  return nums.length>1?[nums[0],nums[1]]:/less|under|</i.test(range)?[0,nums[0]-1]:[nums[0],/\+|more|over/i.test(range)?Infinity:nums[0]];
}
function band(p){const b=employeeBounds(p);if(!b)return 'unknown';if(p.headcount_multiple_addresses)return 'uncertain';const [a,z]=b;if(a===0&&z===0)return 'zero';if(a<0||z<a)return 'uncertain';if(a>=1&&z<=9)return '1-9';if(a>=10&&z<=49)return '10-49';if(a>=50&&z<=249)return '50-249';if(a>=250)return '250+';return 'uncertain';}
function status(p){const v=text(p.operating_status).toLowerCase();return /inactive|closed|out of business|terminated|ceased|historical/.test(v)?'inactive':/active|operating|open|current/.test(v)&&!/unknown|unverified/.test(v)?'active':'unknown';}
function mapped(p){return Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180&&!(p.latitude===0&&p.longitude===0);}
function quality(p){if(!mapped(p))return 'unmapped';const v=p.geocode_quality||'';return /rooftop|parcel|street|address|entrance/.test(v)?'precise':/zip|postal|city|county|centroid|approx|coarse/.test(v)?'approximate':'unknown';}
function compact(p,detail){
  const keys=['id','name','address','city','state','county','zip','latitude','longitude','employees','employee_range','employees_year','employee_scope','industry','industry_detail','evidence_type','geocode_quality','operating_status','headcount_multiple_addresses','location_requires_access_review','location_status','dedup_review_group'];
  const r=Object.fromEntries(keys.filter(k=>p[k]!==undefined&&p[k]!==null&&p[k]!=='').map(k=>[k,p[k]]));
  for(const key of ['name','address','city','state','county','zip','industry','industry_detail'])r[key]=text(r[key]);
  r.state=r.state.toUpperCase();r.county=r.county.replace(/ county$/i,'').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
  r.sourceNames=[...new Set((Array.isArray(p.sources)?p.sources:[]).map(s=>typeof s==='string'?s:s?.name||s?.source_name).filter(Boolean))];
  if(!r.sourceNames.length)r.sourceNames=text(p.source_name).split(';').map(s=>s.trim()).filter(Boolean);
  r.owner_name=Boolean(p.owner_name);r.contact_name=Boolean(p.contact_name);r.employee_band=band(p);r._low=employeeBounds(p)?.[0]??-1;
  r._quality=quality(r);r._status=status(r);r._detail=detail;
  r.merged_ids=Array.isArray(p.merged_ids)?p.merged_ids:[];
  r._search=[p.name,p.legal_name,text(p.aliases),p.address,p.city,p.state,p.county,p.zip,p.industry,p.industry_detail].map(text).join(' ').normalize('NFKD').toLowerCase();
  r._sort=r.name.normalize('NFKD').toLowerCase();
  return r;
}
function distance(a,b,c,d){const r=Math.PI/180,x=Math.min(1,Math.sin((c-a)*r/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin((d-b)*r/2)**2);return 3958.7613*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}
function inside(p,b){return mapped(p)&&p.latitude>=b[1]&&p.latitude<=b[3]&&(b[0]<=b[2]?p.longitude>=b[0]&&p.longitude<=b[2]:p.longitude>=b[0]||p.longitude<=b[2]);}
function publicRow(r,origin){const out={};for(const [k,v]of Object.entries(r))if(!k.startsWith('_')&&v!==null)out[k]=v;out._summary=true;if(origin&&mapped(r))out.distance=distance(...origin,r.latitude,r.longitude);return out;}
function parse(params){
  const number=(key,fallback)=>{const s=params.get(key);return s!==null&&s!==''&&Number.isFinite(Number(s))?Number(s):fallback;};
  const raw=params.get('bbox')?.split(',').map(Number);const bbox=raw?.length===4&&raw.every(Number.isFinite)&&Math.abs(raw[0])<=180&&Math.abs(raw[2])<=180&&raw[1]>=-90&&raw[3]<=90&&raw[1]<=raw[3]?raw:[-180,-85,180,85];
  const lat=number('lat',null),lon=number('lon',null),origin=lat!==null&&lon!==null&&Math.abs(lat)<=90&&Math.abs(lon)<=180?[lat,lon]:null;
  const f=Object.fromEntries(['state','county','industry','employee','evidence','quality','operating','owner','contact','source','city'].map(k=>[k,(params.get(k)||'').slice(0,200)]));
  if(!params.has('evidence'))f.evidence='current';
  return {q:(params.get('q')||'').slice(0,200).trim().normalize('NFKD').toLowerCase(),f,bbox,origin,radius:origin?Math.max(.1,Math.min(1000,number('radius',15))):null,zoom:Math.max(1,Math.min(20,number('zoom',7))),offset:Math.max(0,Math.min(1_000_000,Math.floor(number('offset',0)))),limit:Math.max(1,Math.min(100,Math.floor(number('limit',80)))),sort:params.get('sort')||'name',inView:params.get('inView')==='1',ids:params.has('ids')?new Set((params.get('ids')||'').split(',').slice(0,3000)):null,exclude:new Set((params.get('exclude')||'').split(',').slice(0,3000))};
}
function query(rows,params){
  const o=parse(params),f=o.f,terms=o.q.split(/[\s,]+/).filter(Boolean),matches=[];let totalMapped=0,west=180,east=-180,south=90,north=-90;
  const [qcity,rawState]=o.q.split(',').map(x=>x?.trim()),qstate=rawState?(STATE_NAMES[rawState]||rawState).toLowerCase():null;
  const zip=o.q.match(/^(\d{5})(?:-\d{4})?$/)?.[1];
  const exactState=STATE_NAMES[o.q]||(Object.values(STATE_NAMES).includes(o.q.toUpperCase())?o.q.toUpperCase():null);
  const locality=zip?{field:'zip',value:zip}:exactState?{field:'state',value:exactState.toLowerCase()}:o.q&&rows.some(p=>p.city.toLowerCase()===qcity&&(!qstate||p.state.toLowerCase()===qstate))?{field:'city',value:qcity,state:qstate}:o.q&&rows.some(p=>p.county.toLowerCase()===qcity.replace(/ county$/,'')&&(!qstate||p.state.toLowerCase()===qstate))?{field:'county',value:qcity.replace(/ county$/,''),state:qstate}:null;
  for(const p of rows){
    if(f.state&&p.state!==f.state||f.city&&p.city.toLowerCase()!==f.city.toLowerCase())continue;
    if(locality?((locality.field==='zip'?p.zip.slice(0,5):p[locality.field].toLowerCase())!==locality.value||locality.state&&p.state.toLowerCase()!==locality.state):terms.some(t=>!p._search.includes(t)))continue;
    if(o.ids&&!o.ids.has(p.id)&&!p.merged_ids.some(id=>o.ids.has(id))||o.exclude.has(p.id)||p.merged_ids.some(id=>o.exclude.has(id)))continue;
    if(f.county&&`${p.state}|${p.county}`.toLowerCase()!==f.county.toLowerCase().replace(/ county$/,'')&&p.county.toLowerCase()!==f.county.toLowerCase().replace(/ county$/,'')||f.industry&&p.industry!==f.industry)continue;
    if(f.evidence==='current'&&p.evidence_type==='historical_registry'||f.evidence&&f.evidence!=='current'&&p.evidence_type!==f.evidence)continue;
    if(f.source&&!p.sourceNames.includes(f.source)||f.operating&&p._status!==f.operating)continue;
    if(f.owner&&p.owner_name!==(f.owner==='known')||f.contact&&p.contact_name!==(f.contact==='known'))continue;
    if(f.quality&&(f.quality==='mapped'?!mapped(p):p._quality!==f.quality))continue;
    if(f.employee&&(f.employee==='known'?p.employee_band==='unknown':p.employee_band!==f.employee))continue;
    if(o.origin&&(!mapped(p)||distance(...o.origin,p.latitude,p.longitude)>o.radius))continue;
    if(o.inView&&!inside(p,o.bbox))continue;
    matches.push(p);if(mapped(p)){totalMapped++;west=Math.min(west,p.longitude);east=Math.max(east,p.longitude);south=Math.min(south,p.latitude);north=Math.max(north,p.latitude);}
  }
  const compareName=(a,b)=>a._sort<b._sort?-1:a._sort>b._sort?1:0;
  matches.sort((a,b)=>o.sort==='distance'&&o.origin?(mapped(a)?distance(...o.origin,a.latitude,a.longitude):Infinity)-(mapped(b)?distance(...o.origin,b.latitude,b.longitude):Infinity)||compareName(a,b):o.sort==='employees'?b._low-a._low||compareName(a,b):compareName(a,b));
  const visible=matches.filter(p=>inside(p,o.bbox));let grid=new Map(),cell=64;
  do{
    grid=new Map();const scale=256*2**o.zoom/cell;
    for(const p of visible){const lat=Math.max(-85,Math.min(85,p.latitude)),s=Math.sin(lat*Math.PI/180),x=Math.floor((p.longitude+180)/360*scale),y=Math.floor((.5-Math.log((1+s)/(1-s))/(4*Math.PI))*scale),key=`${x},${y}`;
      let g=grid.get(key);if(!g){g={count:0,lat:0,lng:0,counts:Object.fromEntries(BAND_KEYS.map(k=>[k,0])),bounds:[p.longitude,p.latitude,p.longitude,p.latitude],row:p};grid.set(key,g);}g.count++;g.lat+=p.latitude;g.lng+=p.longitude;g.counts[p.employee_band]++;g.bounds=[Math.min(g.bounds[0],p.longitude),Math.min(g.bounds[1],p.latitude),Math.max(g.bounds[2],p.longitude),Math.max(g.bounds[3],p.latitude)];}
    cell*=2;
  }while(grid.size>1200);
  const features=[...grid.values()].map(g=>g.count===1?{type:'point',row:publicRow(g.row,o.origin)}:{type:'cluster',count:g.count,latitude:g.lat/g.count,longitude:g.lng/g.count,counts:g.counts,bounds:g.bounds});
  return {total:matches.length,mapped:totalMapped,viewport_mapped:visible.length,rows:matches.slice(o.offset,o.offset+o.limit).map(p=>publicRow(p,o.origin)),offset:o.offset,limit:o.limit,has_more:o.offset+o.limit<matches.length,features,bounds:totalMapped?[west,south,east,north]:null};
}
function intersects(a,b){if(!a||!b||a[3]<b[1]||a[1]>b[3])return false;if(b[0]>b[2])return intersects(a,[b[0],b[1],180,b[3]])||intersects(a,[-180,b[1],b[2],b[3]]);return a[2]>=b[0]&&a[0]<=b[2];}
function statesForQuery(catalog,params){const o=parse(params),all=Object.keys(catalog.states),from=(map,key)=>Object.hasOwn(map,key)?map[key]:null;
  let selected=all;
  const [city,stateHint]=o.q.split(',').map(s=>s.trim()),hint=stateHint?(STATE_NAMES[stateHint]||stateHint.toUpperCase()):null,state=o.f.state||STATE_NAMES[o.q]||(all.includes(o.q.toUpperCase())?o.q.toUpperCase():null)||(all.includes(hint)?hint:null),zip=o.q.match(/^(\d{5})(?:-\d{4})?$/)?.[1];
  if(state)selected=all.filter(s=>s===state);
  else if(zip)selected=from(catalog.zips,zip)||[];
  else if(o.f.city)selected=from(catalog.cities,o.f.city.toLowerCase())||[];
  else if(o.q&&from(catalog.cities,city))selected=from(catalog.cities,city);
  else if(o.q&&from(catalog.counties,city.replace(/ county$/,'')))selected=from(catalog.counties,city.replace(/ county$/,''));
  if(o.f.county.includes('|'))selected=selected.filter(s=>s.toLowerCase()===o.f.county.split('|')[0].toLowerCase());
  if(o.inView)selected=selected.filter(s=>intersects(catalog.states[s].bounds,o.bbox));
  if(o.origin){const [lat,lng]=o.origin,angular=o.radius/3958.7613,dlat=angular*180/Math.PI,dlng=Math.abs(lat)+dlat>=90?180:Math.asin(Math.min(1,Math.sin(angular)/Math.cos(lat*Math.PI/180)))*180/Math.PI,wrap=x=>((x+180)%360+360)%360-180,bbox=[dlng>=180?-180:wrap(lng-dlng),Math.max(-90,lat-dlat),dlng>=180?180:wrap(lng+dlng),Math.min(90,lat+dlat)];selected=selected.filter(s=>intersects(catalog.states[s].bounds,bbox));}
  return selected;
}
function createStore(root){let catalogPromise;const states=new Map(),detailCache=new Map(),lookups=new Map();
  async function catalog(){return catalogPromise||=(async()=>JSON.parse(gunzipSync(await fs.promises.readFile(path.join(root,'index-catalog.json.gz')))))();}
  async function loadState(code,c){if(!states.has(code))states.set(code,(async()=>{const rows=[];for(const filename of c.states[code].files){const part=JSON.parse(gunzipSync(await fs.promises.readFile(path.join(root,filename))));for(const row of part)rows.push(decodeIndex(row,c.dictionaries));}return rows;})());return states.get(code);}
  return {async query(params){const c=await catalog(),selected=statesForQuery(c,params),rows=[];for(const code of selected)for(const row of await loadState(code,c))rows.push(row);return query(rows,params);},async detail(id){const bucket=lookupBucket(id);let entries=lookups.get(bucket);if(!entries){entries=JSON.parse(gunzipSync(await fs.promises.readFile(path.join(root,'lookup',`${bucket}.json.gz`))));lookups.set(bucket,entries);if(lookups.size>8)lookups.delete(lookups.keys().next().value);}if(!Object.hasOwn(entries,id))return null;const number=entries[id];let batch=detailCache.get(number);if(!batch){batch=JSON.parse(gunzipSync(await fs.promises.readFile(path.join(root,'records',`${number}.json.gz`))));detailCache.set(number,batch);if(detailCache.size>8)detailCache.delete(detailCache.keys().next().value);}return batch.find(p=>p.id===id)||null;}};
}
module.exports={compact,query,createStore,band,employeeBounds,mapped,parse,encoder,decodeIndex,lookupBucket,statesForQuery,INDEX_FIELDS};
