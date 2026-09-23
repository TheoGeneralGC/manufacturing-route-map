const {test}=require('node:test'),assert=require('node:assert/strict');
const {compact,query,encoder,decodeIndex,statesForQuery}=require('../deploy/query.cjs');
const fixture=(id,fields={})=>compact({id,name:'Example Manufacturing',address:'10 Main St',city:'Tracy',state:'CA',zip:'95376',county:'San Joaquin',latitude:37.739,longitude:-121.425,industry:'Fabricated metals',industry_detail:'Precision metal fabrication',evidence_type:'facility_evidence',employees:20,...fields},0);
const rows=[fixture('ca'),fixture('mn',{city:'Tracy',state:'MN',county:'Lyon',latitude:44.232,longitude:-95.618}),fixture('address',{latitude:null,longitude:null,name:'Address-only Shop'}),fixture('old',{evidence_type:'historical_registry'}),fixture('near',{latitude:37.742}),fixture('far',{latitude:37.79}),fixture('alias',{merged_ids:['legacy-id'],owner_name:'Actual Owner',headcount_multiple_addresses:true})];
const run=(q)=>query(rows,new URLSearchParams(q));
test('national search is state-aware, preserves address-only leads, and hides history by default',()=>{
  assert.equal(run('').total,6);assert.equal(run('evidence=').total,7);
  assert.equal(run('q=Tracy%2C+CA').total,5);assert.equal(run('q=Tracy%2C+MN').total,1);
  assert.equal(run('q=Tracy%2C+California').total,5);assert.equal(run('q=California').total,5);assert.equal(run('q=MN').total,1);
  assert.equal(run('q=95376').total,6);assert.equal(run('q=95376-1111').total,6);
  assert.equal(run('state=MN&county=MN%7CLyon').total,1);
  assert.equal(run('county=mn%7CLYON+COUNTY').total,1);
  assert.equal(run('q=precision+metal').total,6);
  assert.equal(run('quality=unmapped').rows[0].id,'address');
  assert.equal(run('ids=legacy-id').rows[0].id,'alias');
  assert.equal(run('exclude=legacy-id').total,5);
  assert.equal(run('owner=known').rows[0].id,'alias');
});
test('nearby radii use miles and never include address-only or far sites',()=>{
  const r=run('lat=37.739&lon=-121.425&radius=.5&sort=distance');
  assert.deepEqual(r.rows.map(x=>x.id).sort(),['alias','ca','near']);
  assert.ok(r.rows.every(x=>x.distance<=.5));
  assert.equal(run('employee=uncertain').rows[0].id,'alias');
  assert.equal(run('employee=known').total,6);
});
test('compact staffing retains reporting year and source scope',()=>{
  const r=fixture('dated',{employees:72,employees_year:2025,employee_scope:'2025 OSHA annual average establishment employees'});
  const p=query([r],new URLSearchParams()).rows[0];assert.equal(p.employees_year,2025);assert.match(p.employee_scope,/annual average/);
});
test('packed index preserves search/filter facts and shares repeated dictionary values',()=>{
  const p=encoder(),encoded=rows.map(r=>p.encode(r)),decoded=encoded.map(r=>decodeIndex(r,p.dictionaries));
  assert.equal(p.dictionaries.state.length,2);assert.equal(p.dictionaries.industry.length,1);
  for(const q of ['', 'q=Tracy%2C+CA','quality=unmapped','employee=uncertain','owner=known','ids=legacy-id'])assert.deepEqual(query(decoded,new URLSearchParams(q)),query(rows,new URLSearchParams(q)));
});
test('geographic state selection preserves national fallback and does not truncate local counts',()=>{
  const c={states:{CA:{bounds:[-124,32,-114,42]},MN:{bounds:[-97,43,-89,49]},TX:{bounds:[-107,25,-93,36]}},cities:{tracy:['CA','MN'],austin:['TX']},counties:{lyon:['MN']},zips:{95376:['CA']}};
  const choose=s=>statesForQuery(c,new URLSearchParams(s));
  assert.deepEqual(choose('q=Tracy%2C+CA'),['CA']);assert.deepEqual(choose('q=Tracy'),['CA','MN']);assert.deepEqual(choose('q=Austin%2C+Texas'),['TX']);
  assert.deepEqual(choose('q=95376'),['CA']);assert.deepEqual(choose('inView=1&bbox=-122,37,-121,38'),['CA']);
  assert.deepEqual(choose('lat=37.7&lon=-121.4&radius=.5'),['CA']);assert.deepEqual(choose('q=Machine+Shop'),['CA','MN','TX']);assert.deepEqual(choose('q=Company%2C+Inc'),['CA','MN','TX']);
  const polar={states:{AK:{bounds:[172,60,179,71]}},cities:{},counties:{},zips:{}};
  assert.deepEqual(statesForQuery(polar,new URLSearchParams('lat=70&lon=-150&radius=1000')),['AK']);
});
test('response pages and map features remain bounded without losing cluster counts',()=>{
  const many=Array.from({length:10000},(_,i)=>fixture('row-'+i,{latitude:25+(i%100)*.22,longitude:-124+Math.floor(i/100)*.5}));
  const result=query(many,new URLSearchParams('evidence=&bbox=-180,-85,180,85&zoom=19&limit=99999'));
  assert.equal(result.total,10000);assert.equal(result.rows.length,100);assert.ok(result.features.length<=1200);
  assert.equal(result.features.reduce((n,f)=>n+(f.count||1),0),10000);
  assert.ok(result.rows.every(p=>!('_search'in p)&&!('_detail'in p)&&p._summary));
  const page=query(many,new URLSearchParams('offset=80&limit=80'));
  assert.equal(page.rows.length,80);assert.ok(!page.rows.some(p=>result.rows.slice(0,80).some(r=>r.id===p.id)));
});
test('antimeridian view and malformed coordinates do not leak unrelated points',()=>{
  const points=[fixture('west',{state:'AK',latitude:52,longitude:-175}),fixture('east',{state:'AK',latitude:52,longitude:175}),fixture('bad',{latitude:99,longitude:0})];
  const r=query(points,new URLSearchParams('bbox=170,40,-170,65&inView=1'));
  assert.equal(r.total,2);assert.equal(r.viewport_mapped,2);
});
