// Run the production UI functions with deterministic network and DOM boundaries.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const testable = source.replace(/  start\(\);\n\}\)\(\);\s*$/, '  globalThis.qa = {state,refreshRemote,remoteParameters,setupEvents};\n})();');
assert.notEqual(testable, source, 'Replace startup without running the browser application.');

function classes() {
  const values = new Set();
  return {add(v){values.add(v);},remove(v){values.delete(v);},toggle(v,force){const active=force??!values.has(v);active?values.add(v):values.delete(v);return active;}};
}

function harness() {
  const elements = new Map(), requests = [], fits = [], timers = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: id==='sort'?'name':id==='evidence-filter'?'current':'', checked:false, hidden:false, textContent:'', innerHTML:'',
      classList:classes(), listeners:{}, selectedOptions:[{textContent:'Selected filter'}],
      addEventListener(type,fn){this.listeners[type]=fn;},querySelectorAll(){return [];},contains(){return false;},
      setAttribute(){},focus(){},close(){},
    });
    return elements.get(id);
  };
  const layer = () => ({addTo(){return this;},clearLayers(){}});
  let nextTimer = 0;
  const context = vm.createContext({
    Intl, URL, URLSearchParams, AbortController, console,
    window:{history:{replaceState(_state,_title,url){context.location.href=String(url);}},addEventListener(){}},
    location:{href:'https://example.test/ui/index.html?city=Tracy',search:'?city=Tracy'},navigator:{},
    document:{getElementById:element,querySelectorAll(){return [];},addEventListener(){},activeElement:null,body:{classList:classes()}},
    setTimeout(fn){const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},
    L:{layerGroup:layer},
    fetch:async url => {
      const params = new URL(url,'https://example.test').searchParams;
      requests.push(params);
      return {ok:true,json:async()=>({
        offset:Number(params.get('offset')),limit:80,total:160,mapped:160,has_more:Number(params.get('offset'))===0,
        rows:[{id:`page-${params.get('offset')}`,name:'Example Manufacturer',state:'CA',city:'Tracy',evidence_type:'facility_evidence'}],
        features:[],bounds:[-74,42,-73,43],
      })};
    },
  });
  vm.runInContext(testable,context);
  const {state,setupEvents} = context.qa;
  state.remote={api:'/outreach-map/api',employee_bands:[]};
  state.loaded=true;state.plantsById=new Map();state.cluster=layer();
  state.map={getBounds:()=>({getWest:()=>-123,getEast:()=>-119,getSouth:()=>36,getNorth:()=>40}),getZoom:()=>7,getCenter:()=>({lat:38,lng:-121}),fitBounds:b=>fits.push(b),removeLayer(){},invalidateSize(){}};
  setupEvents();
  return {context,state,element,requests,fits,...context.qa};
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('map refresh preserves a later result page when map bounds do not filter the list',async()=>{
  const h=harness();
  await h.refreshRemote({offset:80});
  await h.refreshRemote({mapOnly:true});
  assert.equal(h.requests.at(-1).get('offset'),'80');
  assert.equal(h.state.remoteResult.offset,80);
  assert.equal(h.state.filtered[0].id,'page-80');
  // Moving a viewport that actually filters the list starts the new area at page one.
  h.state.inView=true;
  await h.refreshRemote({mapOnly:true});
  assert.equal(h.requests.at(-1).get('offset'),'0');
});

test('failed map refresh invalidates old rows and all visible result counts, then retries the page',async()=>{
  const h=harness();
  h.state.origin={lat:38,lng:-121,label:'Your location'};h.state.radius=.5;
  await h.refreshRemote({offset:80});
  assert.equal(h.element('mobile-count').textContent,'160');
  const successfulFetch=h.context.fetch;
  h.context.fetch=async()=>{throw new Error('offline');};
  await h.refreshRemote({mapOnly:true});
  assert.equal(h.state.remoteResult,null);
  assert.equal(h.state.filtered.length,0,'Export and automatic route selection must not reuse the prior area.');
  assert.equal(h.state.plants.length,0);
  assert.equal(h.element('mobile-count').textContent,'—');
  assert.doesNotMatch(h.element('result-subtitle').textContent,/160/);
  assert.match(h.element('result-count').textContent,/Unable/);
  assert.match(h.element('location-status').textContent,/unavailable/i);
  h.context.fetch=successfulFetch;
  h.element('retry-query').listeners.click();
  await settle();
  assert.equal(h.requests.at(-1).get('offset'),'80');
  assert.equal(h.state.remoteResult.offset,80);
});

test('HTTP query failure clears stale counts after a normal filter change',async()=>{
  const h=harness();await h.refreshRemote();
  h.context.fetch=async()=>({ok:false,status:503});
  await h.refreshRemote();
  assert.equal(h.state.filtered.length,0);
  assert.equal(h.element('mobile-count').textContent,'—');
  assert.match(h.element('result-list').innerHTML,/Retry search/);
});

test('county-only selection searches and fits the chosen county beyond startup map bounds',async()=>{
  const h=harness();h.state.inView=true;h.element('in-view').checked=true;
  h.element('county-filter').value='NY|Albany';
  h.element('filter-form').listeners.submit({preventDefault(){}});
  await settle();
  const params=h.requests.at(-1);
  assert.equal(params.get('county'),'NY|Albany');
  assert.equal(params.has('state'),false);
  assert.equal(params.has('inView'),false);
  assert.equal(h.state.inView,false);
  assert.equal(h.element('in-view').checked,false);
  assert.equal(h.fits.length,1);
});

test('half-mile and one-mile selection preserve units, and turning location off removes geographic restrictions',async()=>{
  const h=harness();
  h.state.origin={lat:38,lng:-121,label:'Your location'};
  for(const radius of [.5,1]){
    h.state.radius=radius;
    assert.equal(h.remoteParameters().get('radius'),String(radius));
  }
  h.state.filters={evidence:'historical_registry',state:'CA',county:'CA|San Joaquin',city:'Tracy'};
  h.state.inView=true;h.element('search').value='Tracy';
  h.element('clear-location').listeners.click();
  await settle();
  const params=h.requests.at(-1);
  for(const key of ['lat','lon','radius','state','county','city','inView'])assert.equal(params.has(key),false,key);
  assert.equal(params.get('evidence'),'current');
  assert.equal(params.get('q'),'');
  assert.equal(h.state.origin,null);assert.equal(h.state.radius,null);
  assert.equal(new URL(h.context.location.href).searchParams.has('city'),false);
});
