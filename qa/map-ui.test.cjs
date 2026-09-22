// Focused regressions for map updates while a large dataset is still loading.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const elements = new Map();
function classList() { const values=new Set(); return {add(value){values.add(value);},remove(value){values.delete(value);},contains(value){return values.has(value);},toggle(value,force){const enable=force===undefined?!values.has(value):force; enable?values.add(value):values.delete(value); return enable;}}; }

function element(id) {
  if (!elements.has(id)) elements.set(id, {
    id, value: id === 'sort' ? 'name' : id === 'radius-filter' ? '15' : '', hidden: id === 'results-panel', textContent: '', classList:classList(), listeners:{},
    selectedOptions: [{textContent: 'Current-source leads'}],
    addEventListener(type,fn) { this.listeners[type]=fn; }, querySelectorAll() { return []; }, contains() { return false; }, setAttribute(key,value){this[key]=value;},removeAttribute(key){delete this[key];},focus(){this.focused=true;},select(){this.selected=true;},showModal(){this.open=true;},close(){this.open=false;},
  });
  return elements.get(id);
}
const timers = new Map();
let nextTimer = 0;
const markersOnMap = [];
const addedBatchSizes = [];
let removedSelection = 0;
const context = vm.createContext({
  Intl, URL, URLSearchParams, console,
  window:{isSecureContext:true,history:{replaceState(){}},addEventListener(){}}, navigator:{}, location:{href:'https://example.test/ui/index.html?city=Tracy',search:'?city=Tracy'},
  document: {getElementById: element, querySelectorAll: () => [], activeElement: null,body:{classList:classList()},addEventListener(){}},
  setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
  clearTimeout(id) { timers.delete(id); },
  L: {
    divIcon(options) { return options; },
    point(x,y) { return {x,y}; },
    circle(coordinates,options){return {coordinates,options,addTo(){return this;}};},
    marker(coordinates, options) {
      return {coordinates, options, title: options.title, bindTooltip(value) { this.tooltip = value; return this; }, addTo(){return this;}, on() {}, setIcon() {}};
    },
  },
});
const source = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const testable = source.replace(/  start\(\);\n\}\)\(\);\s*$/, '  globalThis.qa = {state,normalize,renderMap,filterResults,websiteUrl,phoneHref,dateLabel,directionsUrl,renderDetail,renderCoverage,employeeBand,clusterComposition,createClusterIcon,matches,employeeShort,employeeChip,useLocation,clearNearby,shortestStopOrder,routeUrl,loadPlants,setupEvents,businessBrief,openGemini,copyAndOpenGemini,renderRoute};\n})();');
assert.notEqual(testable, source, 'Test harness must replace initialization, not start a browser app.');
vm.runInContext(testable, context);
const {state, normalize, renderMap, filterResults, websiteUrl, phoneHref, dateLabel, directionsUrl, renderDetail, renderCoverage, employeeBand, clusterComposition, createClusterIcon, matches, employeeShort, employeeChip} = context.qa;
state.selected=normalize({id:'owner-photo',name:'Shop',owner_name:'Example Owner',owner_profiles:[{name:'Example Owner',role:'Co-owner',source_url:'https://example.com/about',photo_url:'https://example.com/owner.jpg',photo_source_url:'https://example.com/about',photo_caption:'Named company portrait'}],headcount_evidence:[{employee_range:'11–50',scope:'Company-wide; plant staffing unavailable',source_url:'https://example.com/company'}]},0);
renderDetail();
assert.match(element('detail-panel').innerHTML,/https:\/\/example.com\/owner.jpg/);
assert.match(element('detail-panel').innerHTML,/Ownership source/);
assert.match(element('detail-panel').innerHTML,/Company-wide; plant staffing unavailable/);
assert.equal(employeeBand(state.selected),'unknown','Company-wide supplemental evidence never assigns a plant employee color.');
state.selected=normalize({id:'unsafe-owner',owner_name:'<img src=x onerror=alert(1)>',owner_profiles:[{name:'<script>bad</script>',source_url:'javascript:alert(1)',photo_url:'data:text/html,bad',photo_source_url:'https://example.com/story',photo_use:'article_link_only_unlabeled_group_photo'}]},0);
renderDetail();
assert.doesNotMatch(element('detail-panel').innerHTML,/<script>|href="(?:javascript|data):/);
assert.match(element('detail-panel').innerHTML,/Owner article/,'Unlabeled group photographs are not presented as identified portraits.');
state.selected=null;
state.cluster = {
  clearLayers() { markersOnMap.length = 0; },
  addLayers(markers) { addedBatchSizes.push(markers.length); markersOnMap.push(...markers); },
};
state.map = {
  getBounds() { return {contains: () => false}; },
  removeLayer() { removedSelection++; }, invalidateSize(){}, setView(coordinates,zoom){this.center=coordinates;this.zoom=zoom;},fitBounds(points){this.points=points;},
};
const plants = Array.from({length: 1201}, (_, i) => normalize({
  id: `plant-${i}`, name: `Plant ${i}`, latitude: 36 + i / 100000, longitude: -120,
  evidence_type: 'facility_evidence',
}, i));

state.filtered = plants;
renderMap();
assert.equal(markersOnMap.length, 500, 'First batch is bounded so the browser can process input.');
assert.equal(timers.size, 1);
const staleCallback = [...timers.values()][0];

state.filtered = plants.slice(800, 802);
renderMap();
assert.equal(timers.size, 0, 'Changing a filter cancels the older scheduled chunk.');
assert.equal(markersOnMap.length, 2);
staleCallback();
assert.deepEqual(markersOnMap.map(marker => marker.title), ['Plant 800 · Headcount unavailable · Facility evidence', 'Plant 801 · Headcount unavailable · Facility evidence'],
  'Even a stale callback that fires cannot re-add locations excluded by the new filter.');

state.filtered = plants;
renderMap();
while (timers.size) {
  const [id, callback] = timers.entries().next().value;
  timers.delete(id);
  callback();
}
assert.equal(markersOnMap.length, plants.length, 'The final chunk renders every matching mapped location.');
assert.equal(new Set(markersOnMap.map(marker => marker.title)).size, plants.length);
assert.ok(addedBatchSizes.every(count => count <= 500));
assert.equal(state.mapRenderTimer, null);

const current = plants[0];
assert.match(normalize({name:'Building 123',legal_name:'Example Manufacturing LLC',aliases:['Old Plant Name']},0).search,/example manufacturing llc old plant name/,'Building identifiers remain searchable by their reported business name.');
const historical = normalize({id:'old',name:'Old record',latitude:36,longitude:-120,evidence_type:'historical_registry'},1201);
state.plants = [current, historical];
state.loaded = true;
state.filters = {evidence:'current'};
state.selected = historical;
state.selectedMarker = {};
filterResults(false);
assert.equal(state.selected, null, 'Switching to current-source leads closes historical details.');
assert.equal(state.selectedMarker, null);
assert.equal(removedSelection, 1, 'The excluded highlighted marker is removed too.');
assert.equal(element('detail-panel').hidden, true);

state.selected = current;
state.inView = true;
filterResults(false);
assert.equal(state.filtered.length, 0);
assert.equal(state.selected, current, 'Panning outside a selected location does not dismiss its details.');

state.inView = false;
element('search').value = 'does not exist';
filterResults(false);
assert.equal(state.selected, null, 'A search that excludes the selected record closes its details.');
assert.equal(websiteUrl('Ju.St'), 'https://ju.st/');
assert.equal(websiteUrl('  Alamedaislandbrewing.Com  '), 'https://alamedaislandbrewing.com/');
assert.equal(websiteUrl('WWW.Example.com/contact'), 'https://www.example.com/contact');
assert.equal(websiteUrl('http://example.com/contact?from=map'), 'http://example.com/contact?from=map');
assert.equal(websiteUrl('//example.com'), 'https://example.com/');
for (const invalid of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'ftp://example.com', 'mailto:owner@example.com', 'file:///tmp/example.com', 'person@example.com', '', null]) {
  assert.equal(websiteUrl(invalid), '', `Reject non-web or malformed website: ${invalid}`);
}
assert.equal(phoneHref('925-479-0625 x13'), 'tel:9254790625;ext=13');
assert.equal(phoneHref('5106239400X312'), 'tel:5106239400;ext=312');
assert.equal(phoneHref('+1 (510) 623-9400 ext. 312'), 'tel:+15106239400;ext=312');
assert.equal(phoneHref('510-623-9400 extension 312'), 'tel:5106239400;ext=312');
assert.equal(phoneHref('tel:+15106239400;ext=312'), 'tel:+15106239400;ext=312');
assert.equal(phoneHref('(510) 623-9400'), 'tel:5106239400');
assert.equal(phoneHref('510-623-9400 / 925-479-0625'), '', 'Do not merge two numbers into a dial destination.');
assert.equal(phoneHref('not reported'), '');
assert.equal(dateLabel('2026-09'), 'Sep 2026', 'Month-only source dates must not imply a particular day.');
assert.equal(dateLabel('2026-09-01'), 'Sep 1, 2026', 'Day-specific dates retain their source precision.');
assert.equal(dateLabel('2026-13'), '');
assert.equal(dateLabel('not a date'), '');
for (const address of ['', '  ', 'PO BOX 123', 'P.O. Box 123', 'POBOX 123', '123 Main St PMB 4', 'P.M.B. 42', '123 Main St Mailbox #123']) {
  const record = normalize({name:'Example Manufacturing',address,city:'Fresno'},0);
  assert.equal(directionsUrl(record), '', `No driving directions for an unmapped mailing or missing address: ${address}`);
  assert.equal(directionsUrl(record,true), '', 'Apple directions follow the same destination requirements.');
}
const ruralStreet = normalize({name:'Rural Manufacturing',address:'Flag City Boulevard',city:'Lodi'},0);
assert.equal(new URL(directionsUrl(ruralStreet)).searchParams.get('destination'), 'Flag City Boulevard, Lodi CA',
  'Physical street addresses remain usable without coordinates or a house number.');
const coordinatesOnly = normalize({name:'Example Manufacturing',city:'Fresno',latitude:36.7,longitude:-119.7},0);
assert.equal(new URL(directionsUrl(coordinatesOnly)).searchParams.get('destination'), '36.7,-119.7');
const sourceCoordinates = normalize({name:'Mine reporting point',address:'Source DMS notation',latitude:36.7,longitude:-119.7,location_requires_access_review:true},0);
assert.equal(new URL(directionsUrl(sourceCoordinates)).searchParams.get('destination'), '36.7,-119.7','Unusual coordinate-only source addresses use their recovered point.');
const mappedMailbox = normalize({name:'Example Manufacturing',address:'PO Box 12',latitude:36.7,longitude:-119.7},0);
assert.equal(new URL(directionsUrl(mappedMailbox)).searchParams.get('destination'), '36.7,-119.7',
  'A mailing address is never preferred over usable coordinates.');
state.selected = normalize({name:'Mail-only lead',address:'PO Box 12',city:'Fresno'},0);
renderDetail();
assert.match(element('detail-panel').innerHTML, /<button[^>]*disabled[^>]*>.*Street address needed for directions<\/button>/);
assert.doesNotMatch(element('detail-panel').innerHTML, /maps\.apple\.com|www\.google\.com\/maps\/dir/);
state.selected = ruralStreet;
renderDetail();
assert.match(element('detail-panel').innerHTML, /Get directions in Google Maps/);
assert.match(element('detail-panel').innerHTML, /Open in Apple Maps/);
state.coverage = {current_source_employee_records:12,current_source_owner_records:3,current_source_contact_records:7,current_source_employee_range_only_records:5};
renderCoverage();
assert.match(element('coverage-content').innerHTML, /12 have a reported employee count, 3 have a reported owner, and 7 have a named business contact/);
assert.match(element('coverage-content').innerHTML, /Owners can include legal entities/);
assert.match(element('coverage-content').innerHTML, /An additional 5 report an employee range only/);
const bandFixtures = [
  [{employees:1},'1-9'], [{employees:9},'1-9'], [{employees:10},'10-49'],
  [{employees:49},'10-49'], [{employees:50},'50-249'], [{employees:249},'50-249'],
  [{employees:250},'250+'], [{employees:50000},'250+'], [{employees:0},'zero'],
  [{employees:null},'unknown'], [{employees:''},'unknown'], [{},'unknown'],
  [{employees:-1},'unknown'], [{employee_range:'Unknown'},'unknown'],
  [{employee_range:'Very Small'},'unknown'], [{employee_range:'1–9'},'1-9'],
  [{employee_range:'10–49'},'10-49'], [{employee_range:'50–249'},'50-249'],
  [{employee_range:'500+'},'250+'], [{employee_range:'1,000–4,999'},'250+'],
  [{employee_range:'10–499'},'uncertain'], [{employee_range:'1–49'},'uncertain'],
  [{employee_range:'0–9'},'uncertain'], [{employee_range:'499–10'},'uncertain'],
  [{employees:15,employee_range:'250+'},'10-49'], [{employees:0,employee_range:'1–9'},'zero'],
  [{employees:50,headcount_multiple_addresses:true},'uncertain'],
  [{employees:null,headcount_multiple_addresses:true},'unknown'],
];
for (const [fields,expected] of bandFixtures) {
  const plant = normalize({id:'fixture',...fields},0);
  assert.equal(plant.employee_band,expected,`Classify ${JSON.stringify(fields)} without inventing a headcount.`);
  assert.equal(employeeBand(plant),expected);
}
const crossBand = normalize({id:'range',employee_range:'10–499'},0);
state.status = 'all'; state.filters = {employee:'10-49'};
assert.equal(matches(crossBand,[],null),false,'A mixed range must not be claimed as a definite 10–49 location.');
state.filters = {employee:'uncertain'};
assert.equal(matches(crossBand,[],null),true);
state.filters = {employee:'known'};
assert.equal(matches(crossBand,[],null),true,'Known ranges remain discoverable even when their size band is uncertain.');
state.filters = {employee:'unknown'};
assert.equal(matches(normalize({employees:0},0),[],null),false,'Reported zero is different from missing data.');
const multipleAddresses = normalize({id:'multi',name:'Multi-address employer',employees:50,headcount_multiple_addresses:true},0);
assert.equal(multipleAddresses.employees,50,'Retain the numeric source value for export.');
assert.equal(multipleAddresses.headcount_multiple_addresses,true);
assert.equal(employeeShort(multipleAddresses),'50 reported across multiple addresses');
assert.match(employeeChip(multipleAddresses),/50 reported across multiple addresses/);
state.selected = multipleAddresses;
renderDetail();
assert.match(element('detail-panel').innerHTML,/50 reported across multiple addresses/);
assert.match(element('detail-panel').innerHTML,/Individual building counts are unavailable/);
state.filters = {employee:'50-249'};
assert.equal(matches(multipleAddresses,[],null),false,'An aggregate across addresses is not a single-location 50–249 headcount.');
state.filters = {employee:'uncertain'};
assert.equal(matches(multipleAddresses,[],null),true);
const clusterMarkers = [
  {options:{employeeBand:'1-9',employees:1}},
  {options:{employeeBand:'1-9',employees:9}},
  {options:{employeeBand:'250+',employees:50000}},
  {options:{employeeBand:'unknown'}},
];
const composition = clusterComposition(clusterMarkers);
assert.equal(composition.total,4,'The cluster counts locations, never sums their employees.');
assert.equal(composition.counts['1-9'],2);
assert.equal(composition.counts['250+'],1);
assert.equal(composition.counts.unknown,1);
assert.equal(Object.values(composition.counts).reduce((total,count)=>total+count,0),4);
assert.match(composition.gradient,/--employee-xs\) 0\.0000% 50\.0000%/);
assert.match(composition.gradient,/--employee-lg\) 50\.0000% 75\.0000%/);
assert.match(composition.gradient,/--employee-unknown\) 75\.0000% 100\.0000%/);
const uncertainComposition = clusterComposition([{options:{employeeBand:'uncertain'}},{options:{employeeBand:'zero'}},{options:{employeeBand:'invalid'}}]);
assert.equal(uncertainComposition.counts.uncertain,1);
assert.equal(uncertainComposition.counts.zero,1);
assert.equal(uncertainComposition.counts.unknown,1);
const cluster = {options:{},getAllChildMarkers:()=>clusterMarkers,bindTooltip(value){this.tooltip=value;}};
const clusterIcon = createClusterIcon(cluster);
assert.match(clusterIcon.html,/aria-label="4 locations/);
assert.match(clusterIcon.html,/class="cluster-count" aria-hidden="true">4<\/span>/);
assert.match(cluster.options.title,/Unknown: 1/);
assert.match(cluster.tooltip,/Employee bands · location counts/);
assert.match(cluster.tooltip,/Unknown<b>1<\/b>/);

function luminance(hex) {
  const rgb=hex.match(/[a-f\d]{2}/gi).map(value=>parseInt(value,16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);
  return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
}
function contrast(a,b) { const x=luminance(a),y=luminance(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); }
const css=fs.readFileSync(path.join(__dirname,'../ui/styles.css'),'utf8');
const colorContrasts={};
for (const role of ['xs','sm','md','lg','unknown','uncertain','zero']) {
  const color=css.match(new RegExp(`--employee-${role}:(#[a-f\\d]{6})`,'i'))?.[1];
  assert.ok(color,`Employee ${role} has a shared semantic color token.`);
  colorContrasts[role]=Number(contrast(color,'#ffffff').toFixed(2));
  assert.ok(contrast(color,'#ffffff')>=3,`${role} marker exceeds 3:1 non-text contrast against its white surround.`);
}
assert.ok(contrast('#24332a','#ffffff')>=4.5,'Employee-chip text retains normal-text contrast.');
assert.ok(contrast('#203228','#ffffff')>=4.5,'Cluster count text retains normal-text contrast.');
console.log('Passed map UI regressions, including employee boundaries, ambiguous ranges, unknowns, plant-count cluster proportions, accessible labels, and color contrast.',colorContrasts);


// Locality queries take precedence over unrelated business/address substrings.
state.filters={evidence:'current'};state.status='all';state.inView=false;state.selected=null;state.origin=null;state.radius=null;
state.plants=[
  normalize({id:'city',name:'Local Works',city:'Tracy',county:'San Joaquin',zip:'95376-1234',evidence_type:'facility_evidence'},0),
  normalize({id:'contact',name:'Other Fabrication',city:'Fresno',county:'Fresno',zip:'93701',contact_name:'Tracy Contactonly',owner_name:'Secretowner',source_name:'Secretsource',industry:'Secretindustry',evidence_type:'facility_evidence'},1),
  normalize({id:'business',name:'Tracy Fab',city:'Fresno',county:'Fresno',zip:'93701',address:'95376 San Joaquin Street',evidence_type:'facility_evidence'},2),
  normalize({id:'county',name:'Stockton Works',city:'Stockton',county:'San Joaquin',zip:'95202',evidence_type:'facility_evidence'},3),
];
function searchIds(query){element('search').value=query;filterResults(false);return Array.from(state.filtered,p=>p.id).sort();}
assert.deepEqual(searchIds('  TRACY  '),['city'],'Exact city search excludes people, businesses, and street names containing Tracy elsewhere.');
assert.deepEqual(searchIds('San Joaquin'),['city','county'],'Known county names match county fields.');
assert.deepEqual(searchIds('San Joaquin County'),['city','county'],'Explicit County suffix is supported.');
assert.deepEqual(searchIds('95376'),['city'],'ZIP search excludes a street number equal to that ZIP elsewhere.');
assert.deepEqual(searchIds('95376-1234'),['city'],'ZIP+4 query resolves the five-digit locality.');
assert.deepEqual(searchIds('Tracy Fab'),['business'],'Non-locality queries still find business names.');
for(const query of ['Contactonly','Secretowner','Secretsource','Secretindustry']) assert.deepEqual(searchIds(query),[],`Unadvertised field ${query} does not affect search.`);

async function testMobileAndProductionLoading() {
  const {useLocation,clearNearby,shortestStopOrder,routeUrl,loadPlants,setupEvents}=context.qa;
  let requested=0, success, failure, gpsOptions;
  context.navigator.geolocation={getCurrentPosition(onSuccess,onFailure,options){requested++;success=onSuccess;failure=onFailure;gpsOptions=options;}};
  setupEvents();
  assert.equal(requested,0,'Opening the map and binding controls never requests location permission.');
  const near=normalize({id:'near',name:'San Jose Plant',city:'San Jose',address:'100 First St',state:'CA',zip:'95113',latitude:37.331,longitude:-121.891,evidence_type:'facility_evidence'},0);
  const tracy=normalize({id:'tracy',name:'Tracy Plant',city:'Tracy',latitude:37.739,longitude:-121.425,evidence_type:'facility_evidence'},1);
  const old=normalize({id:'old-near',name:'Old San Jose Plant',latitude:37.332,longitude:-121.892,evidence_type:'historical_registry'},2);
  const unmapped=normalize({id:'unmapped',name:'Address-only Plant',evidence_type:'facility_evidence'},3);
  state.plants=[near,tracy,old,unmapped];state.plantsById=new Map(state.plants.map(p=>[p.id,p]));state.loaded=true;state.selected=null;
  state.filters={evidence:'historical_registry',city:'Tracy',employee:'250+'};state.inView=true;state.status='saved';element('search').value='Tracy';
  useLocation();
  assert.equal(requested,1);assert.equal(state.locating,true);assert.equal(element('near-me-button').disabled,true);
  assert.equal(gpsOptions.enableHighAccuracy,true);assert.equal(gpsOptions.timeout,15000);
  success({coords:{latitude:37.33,longitude:-121.89,accuracy:18}});
  assert.equal(state.locating,false);assert.equal(element('near-me-button').disabled,false);
  assert.equal(state.origin.label,'Your location');assert.equal(state.origin.accuracy,18);assert.equal(state.radius,15);
  assert.equal(state.filters.evidence,'current');assert.equal(state.filters.city,undefined);assert.equal(state.filters.employee,undefined);
  assert.equal(state.status,'all');assert.equal(state.inView,false);assert.equal(element('search').value,'');
  assert.deepEqual(Array.from(state.filtered,p=>p.id),['near'],'GPS clears Tracy and saved/employee filters, limits to current mapped nearby records.');
  assert.deepEqual(Array.from(state.map.center),[37.33,-121.89]);assert.equal(element('results-panel').hidden,true,'GPS centers the unobscured full-screen map.');
  assert.match(element('location-accuracy').textContent,/±18 m/);
  assert.equal(element('location-status').textContent,'1 manufacturer within 15 miles of you','Successful GPS shows the nearby result count without opening a panel.');
  state.filters.employee='250+';filterResults();
  assert.equal(element('location-status').textContent,'0 manufacturers within 15 miles of you','The nearby count follows active result filters, including zero matches.');
  state.filters.employee='';filterResults();
  const quarter=normalize({id:'quarter-mile',name:'Quarter Mile',latitude:37.33+0.25/69.0934,longitude:-121.89,evidence_type:'facility_evidence'},4);
  const threeQuarter=normalize({id:'three-quarter-mile',name:'Three Quarter Mile',latitude:37.33+0.75/69.0934,longitude:-121.89,evidence_type:'facility_evidence'},5);
  const outside=normalize({id:'over-one-mile',name:'Over One Mile',latitude:37.33+1.1/69.0934,longitude:-121.89,evidence_type:'facility_evidence'},6);
  const previousPlants=state.plants;state.plants=[quarter,threeQuarter,outside];
  element('radius-filter').value='0.5';useLocation();success({coords:{latitude:37.33,longitude:-121.89,accuracy:18}});
  assert.equal(state.radius,0.5);assert.equal(state.map.zoom,16);assert.deepEqual(Array.from(state.filtered,p=>p.id),['quarter-mile']);
  element('radius-filter').value='1';element('radius-filter').listeners.change();
  assert.equal(state.radius,1);assert.equal(state.map.zoom,15);assert.deepEqual(Array.from(state.filtered,p=>p.id),['quarter-mile','three-quarter-mile']);
  assert.equal(element('location-status').textContent,'2 manufacturers within 1 mile of you');
  state.plants=previousPlants;state.plantsById=new Map(state.plants.map(p=>[p.id,p]));
  element('radius-filter').value='60';element('radius-filter').listeners.change();
  assert.equal(state.radius,60);assert.equal(state.filtered.length,2,'Widening the radius includes farther current-source plants.');
  assert.equal(element('location-status').textContent,'2 manufacturers within 60 miles of you','Changing the radius updates both the count and distance label.');
  element('search').value='Tracy';element('search').listeners.input();
  assert.equal(state.origin,null,'A typed destination removes the previous GPS radius restriction.');
  assert.equal(state.radius,null);
  for (const [id,callback] of [...timers]) {timers.delete(id);callback();}
  assert.equal(element('results-panel').hidden,false,'Typing opens an optional result sheet.');
  assert.deepEqual(Array.from(state.filtered,p=>p.id),['tracy']);
  assert.ok(state.map.points.length===1,'Destination search centers its matching map points.');
  useLocation();success({coords:{latitude:37.33,longitude:-121.89,accuracy:18}});
  state.filters.employee='250+';state.inView=true;state.status='saved';
  state.notes.near={saved:true,notes:'Keep this note'};
  element('clear-location').listeners.click();
  assert.equal(state.origin,null);assert.equal(state.radius,null);assert.equal(state.locating,false);
  assert.equal(state.originMarker,null);assert.equal(state.accuracyCircle,null);
  assert.equal(element('nearby-controls').hidden,true);assert.equal(element('results-panel').hidden,true);
  assert.equal(state.inView,false);assert.equal(state.status,'all');assert.equal(element('search').value,'');
  assert.deepEqual(Array.from(state.filtered,p=>p.id).sort(),['near','tracy','unmapped'],'Turning location off restores all current-source results, including address-only entries.');
  assert.deepEqual(Array.from(state.map.points,p=>Array.from(p)),[[near.latitude,near.longitude],[tracy.latitude,tracy.longitude]],'Turning location off zooms out to every mapped current-source location.');
  assert.ok(state.plants.every(p=>p.distance===null));
  assert.equal(state.notes.near.notes,'Keep this note');assert.equal(state.notes.near.saved,true);
  for (const [code,pattern] of [[1,/permission denied/],[2,/Location unavailable/],[3,/timed out/]]) {
    useLocation();failure({code});assert.match(element('location-status').textContent,pattern);assert.equal(state.locating,false);assert.equal(element('near-me-button').disabled,false);
  }
  const before=requested;context.window.isSecureContext=false;useLocation();assert.equal(requested,before);assert.match(element('location-status').textContent,/HTTPS/);context.window.isSecureContext=true;
  const geolocation=context.navigator.geolocation;delete context.navigator.geolocation;useLocation();assert.match(element('location-status').textContent,/unavailable in this browser/);context.navigator.geolocation=geolocation;
  useLocation();const staleSuccess=success;element('clear-location').listeners.click();staleSuccess({coords:{latitude:38,longitude:-121,accuracy:12}});assert.equal(state.origin,null,'A pending GPS callback cannot undo Turn off location.');
  useLocation();success({coords:{latitude:NaN,longitude:-121,accuracy:12}});assert.equal(state.origin,null);assert.match(element('location-status').textContent,/invalid location/);
  clearNearby();

  const origin={lat:37,lng:-121};
  const stops=[.03,.01,.02].map((offset,i)=>normalize({id:`stop-${i}`,name:`Stop ${i}`,latitude:37+offset,longitude:-121,address:`${i+1} Main St`,city:'Tracy',state:'CA',zip:'95376'},i));
  const ordered=shortestStopOrder(stops,origin);
  assert.deepEqual(Array.from(ordered,p=>p.id),['stop-1','stop-2','stop-0'],'Route ordering checks straight-line distance from the selected origin.');
  const route=new URL(routeUrl(ordered,origin));
  assert.equal(route.searchParams.get('api'),'1');assert.equal(route.searchParams.get('origin'),'37,-121');assert.equal(route.searchParams.get('travelmode'),'driving');
  assert.equal(route.searchParams.get('waypoints').split('|').length,2);assert.match(route.searchParams.get('destination'),/1 Main St/);
  assert.equal(routeUrl([],origin),'');assert.equal(routeUrl([...stops,...stops],origin),'','Mobile directions never exceed 4 destinations / 3 waypoints.');
  assert.equal(new URL(routeUrl(ordered,null)).searchParams.has('origin'),false,'Without GPS, Google Maps can select the user’s own start.');
  assert.equal(routeUrl([{...near,address:'x'.repeat(3000)}],origin),'','Overlong Google Maps links are not opened.');

  const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
  let calls=[];
  context.fetch=async url=>{calls.push(String(url));return String(url).endsWith('manifest.json')?response(null,404):response([{id:'legacy'}]);};
  assert.equal((await loadPlants())[0].id,'legacy');assert.equal(calls.length,2);assert.match(calls[1],/\/data\/plants.json$/);
  calls=[];context.fetch=async url=>{calls.push(String(url));return response(null,401);};
  await assert.rejects(loadPlants(),/HTTP 401/);assert.equal(calls.length,1,'Unauthorized production requests never fall back to a different dataset.');
  const manifest={version:1,total_records:6,chunks:Array.from({length:6},(_,i)=>({path:`plants-${String(i).padStart(3,'0')}.json`,records:1}))};
  let active=0,maxActive=0;
  context.fetch=async url=>{
    const value=String(url);if(value.endsWith('manifest.json'))return response(manifest);
    active++;maxActive=Math.max(active,maxActive);await new Promise(resolve=>setImmediate(resolve));active--;
    return response([{id:value.match(/plants-(\d+)/)[1]}]);
  };
  const loaded=await loadPlants();assert.deepEqual(Array.from(loaded,p=>p.id),['000','001','002','003','004','005']);assert.equal(maxActive,4,'At most four chunk requests run concurrently.');
  const originalPlants=state.plants;
  context.fetch=async url=>String(url).endsWith('manifest.json')?response(manifest):response(null,503);
  await assert.rejects(loadPlants(),/HTTP 503/);assert.equal(state.plants,originalPlants,'A partial chunk failure cannot replace the inventory with partial results.');
  context.fetch=async url=>String(url).endsWith('manifest.json')?response({...manifest,total_records:1,chunks:[{path:'../private.json',records:1}]}):response([]);
  await assert.rejects(loadPlants(),/manifest is invalid/);
  context.fetch=async url=>String(url).endsWith('manifest.json')?response({...manifest,total_records:1,chunks:[{path:'plants-000.json',records:1}]}):response([]);
  await assert.rejects(loadPlants(),/part is incomplete/);
  context.fetch=async url=>String(url).endsWith('manifest.json')?response({...manifest,total_records:2,chunks:[{path:'plants-000.json',records:1}]}):response([{id:'one'}]);
  await assert.rejects(loadPlants(),/dataset is incomplete/);
  const {businessBrief,openGemini,copyAndOpenGemini,renderRoute}=context.qa;
  const company=normalize({id:'brief-plant',name:'Accentra Health Inc',address:'18520 Stanford Rd',city:'Tracy',zip:'95377',industry:'Medical device manufacturing',employees:24,employee_scope:'Company-wide; plant count unknown',owner_name:'Reported Owner',owner_role:'Reported sole owner',owner_source_url:'https://example.com/ownership',owner_profiles:[null,{name:'Reported Owner',photo_source_url:'https://example.com/bio'}],source_name:'Business directory',sources:[{name:'Directory',url:'https://example.com/facility',snapshot_date:'2026-09-01'}],field_notes:'PRIVATE FIELD NOTE',notes:'UNREVIEWED FREE TEXT'},0);
  state.notes[company.id]={notes:'PRIVATE FIELD NOTE',visited:true};state.origin={lat:12.3456789,lng:98.7654321};
  const brief=businessBrief(company);
  for(const fact of ['Accentra Health Inc','18520 Stanford Rd','95377','Medical device manufacturing','Company-wide; plant count unknown','Reported Owner','https://example.com/ownership','https://example.com/facility','2026-09-01','https://example.com/bio'])assert.ok(brief.includes(fact),fact);
  assert.doesNotMatch(brief,/PRIVATE FIELD NOTE|UNREVIEWED FREE TEXT|12\.3456789|98\.7654321/,'Gemini receives business fields, never GPS or personal notes.');
  assert.match(brief,/not verified truth/);assert.match(brief,/Distinguish owners from founders/);
  state.selected=company;renderDetail();assert.match(element('detail-panel').innerHTML,/id="detail-gemini"/);assert.doesNotMatch(element('detail-panel').innerHTML,/Add to shortlist/);
  element('detail-gemini').listeners.click();assert.equal(element('gemini-dialog').open,true);assert.equal(element('gemini-brief').value,brief);
  let copied='',destination='';context.navigator.clipboard={async writeText(value){copied=value;}};context.window.open=()=>({opener:{},location:{replace(url){destination=url;}},close(){}});
  await copyAndOpenGemini();assert.equal(copied,brief);assert.equal(destination,'https://gemini.google.com/app');assert.equal(element('gemini-copy-open').disabled,false);
  destination='';context.window.open=()=>null;await copyAndOpenGemini();assert.equal(destination,'');assert.match(element('gemini-status').textContent,/Tap Open Gemini/,'A blocked popup retains the map and offers an explicit open link.');
  context.navigator.clipboard={async writeText(){throw Error('denied');}};
  await copyAndOpenGemini();assert.equal(destination,'');assert.equal(element('gemini-brief').selected,true);assert.match(element('gemini-status').textContent,/manually/);
  delete context.navigator.clipboard;await copyAndOpenGemini();assert.equal(destination,'');assert.match(element('gemini-status').textContent,/manually/);
  // Route selection remains available after removing the shortlist action.
  state.selected=null;state.origin=null;state.plants=[near,tracy];state.plantsById=new Map(state.plants.map(p=>[p.id,p]));state.filtered=[tracy];state.notes={};state.routeIds=[];
  renderRoute();assert.match(element('route-options').innerHTML,/Tracy Plant/);assert.doesNotMatch(element('route-options').innerHTML,/Add to shortlist/);
  const html=fs.readFileSync(path.join(__dirname,'../ui/index.html'),'utf8');
  for(const radius of ['0.5','1','2','5','15','30','60'])assert.ok(html.includes(`value="${radius}"`));
  assert.match(html,/placeholder="Business, city, county or ZIP"/);assert.doesNotMatch(html,/Field Atlas|class="sidebar"|class="brand"/,'No visible branding or left drawer remains.');
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length,'Each UI control has a unique ID.');
  console.log('Passed GPS success/permission/timeout/unavailable/insecure/cancellation, nearby reset and search, route ordering/mobile limits, and atomic production chunk loading regressions.');
}
testMobileAndProductionLoading().catch(error=>{console.error(error);process.exitCode=1;});
