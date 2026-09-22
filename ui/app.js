/* Manufacturing map. Outreach notes stay in this browser. */
'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = (name, className = '') => `<svg class="${esc(className)}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const format = (value) => new Intl.NumberFormat('en-US').format(value);
  const safeUrl = (value) => { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } };
  const textValue = (value) => Array.isArray(value) ? value.filter(Boolean).join(', ') : String(value ?? '');
  function websiteUrl(value) {
    const raw = textValue(value).trim();
    if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return '';
    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
    const url = safeUrl(hasScheme ? raw : `${raw.startsWith('//') ? 'https:' : 'https://'}${raw}`);
    if (!url) return '';
    const parsed = new URL(url);
    return parsed.username || parsed.password || !parsed.hostname.includes('.') ? '' : url;
  }
  function phoneHref(value) {
    const raw = textValue(value).trim().replace(/^tel:/i,'');
    const extension = raw.match(/(?:;\s*ext\s*=\s*|(?:ext(?:ension|n)?\.?|x|#)\s*)(\d+)\s*$/i);
    const base = (extension ? raw.slice(0,extension.index) : raw).trim();
    const digits = base.replace(/\D/g,'');
    if (digits.length < 7 || digits.length > 15) return '';
    return `tel:${base.startsWith('+') ? '+' : ''}${digits}${extension ? `;ext=${extension[1]}` : ''}`;
  }
  const number = (value) => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
  const storageKey = 'field-atlas-outreach-v1';
  const evidenceLabels = {facility_evidence:'Facility evidence',directory_lead:'Directory lead',historical_registry:'Historical / unverified'};
  const employeeBands = [
    {key:'1-9',label:'1–9',description:'1–9 employees',className:'staff-xs',color:'var(--employee-xs)'},
    {key:'10-49',label:'10–49',description:'10–49 employees',className:'staff-sm',color:'var(--employee-sm)'},
    {key:'50-249',label:'50–249',description:'50–249 employees',className:'staff-md',color:'var(--employee-md)'},
    {key:'250+',label:'250+',description:'250+ employees',className:'staff-lg',color:'var(--employee-lg)'},
    {key:'unknown',label:'Unknown',description:'Headcount unavailable',className:'staff-unknown',color:'var(--employee-unknown)'},
    {key:'uncertain',label:'Uncertain',description:'A reliable employee band is unavailable for this individual location',className:'staff-uncertain',color:'var(--employee-uncertain)',optional:true},
    {key:'zero',label:'0 reported',description:'Source reports zero employees',className:'staff-zero',color:'var(--employee-zero)',optional:true},
  ];
  const employeeBandsByKey = Object.fromEntries(employeeBands.map((band) => [band.key,band]));
  const filterIds = ['county', 'industry', 'employee', 'evidence', 'quality', 'operating', 'owner', 'contact', 'source'];
  const state = {plants:[],filtered:[],coverage:{},selected:null,status:'all',origin:null,radius:null,locating:false,locationRequest:0,routeIds:[],inView:false,limit:80,markers:new Map(),notes:{},map:null,cluster:null,originMarker:null,accuracyCircle:null,selectedMarker:null,filters:{evidence:'current'},mapRenderGeneration:0,mapRenderTimer:null,loaded:false};
  let toastTimer, searchTimer, saveTimer;

  function toast(message, duration = 6500) {
    $('toast').textContent = message; $('toast').hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, duration);
  }
  function loadNotes() {
    try { const value = JSON.parse(localStorage.getItem(storageKey) || '{}'); if (value && typeof value === 'object' && !Array.isArray(value)) state.notes = value; }
    catch { toast('This browser could not load saved outreach notes.'); }
  }
  function saveNotes() {
    try { localStorage.setItem(storageKey, JSON.stringify(state.notes)); return true; }
    catch { toast('This browser could not save your notes. Use About the data → Back up notes to keep a copy.', 10000); return false; }
  }
  function employeeBounds(value, range) {
    if (value !== null && value >= 0) return [value, value];
    if (!range || /unknown|unavailable|not reported|^n\/a$/i.test(range)) return null;
    const numbers = String(range).replace(/,/g, '').match(/\d+/g)?.map(Number);
    if (!numbers?.length) return null;
    if (numbers.length >= 2) return [numbers[0],numbers[1]];
    if (/\+|more|over/i.test(range)) return [numbers[0], Infinity];
    if (/less|under|</i.test(range)) return [0,numbers[0] - 1];
    return [numbers[0],numbers[0]];
  }
  function employeeBand(p) {
    const bounds = p.bounds ?? employeeBounds(p.employees ?? null,p.employee_range);
    if (!bounds) return 'unknown';
    if (p.headcount_multiple_addresses === true) return 'uncertain';
    const [low,high] = bounds;
    if (low === 0 && high === 0) return 'zero';
    if (!Number.isFinite(low) || low < 0 || high < low) return 'uncertain';
    if (low >= 1 && high <= 9) return '1-9';
    if (low >= 10 && high <= 49) return '10-49';
    if (low >= 50 && high <= 249) return '50-249';
    if (low >= 250) return '250+';
    return 'uncertain';
  }
  function normalize(p, index) {
    const lat = number(p.latitude ?? p.lat), lng = number(p.longitude ?? p.lon ?? p.lng);
    const reportedEmployees = number(p.employees ?? p.employee_count ?? p.employeeCount);
    const employees = reportedEmployees !== null && reportedEmployees >= 0 ? reportedEmployees : null;
    const employeeRange = textValue(p.employee_range ?? p.employeeRange);
    const evidence = Object.hasOwn(evidenceLabels, p.evidence_type) ? p.evidence_type : 'directory_lead';
    const plant = {...p,id:String(p.id ?? `record-${index}`),name:textValue(p.name ?? p.business_name ?? p.company_name ?? 'Unnamed business'),address:textValue(p.address ?? p.street_address ?? p.street),city:textValue(p.city),county:textValue(p.county).replace(/ County$/i,''),state:textValue(p.state || 'CA'),zip:textValue(p.zip ?? p.zip_code ?? p.postal_code),latitude:lat,longitude:lng,employees,employee_range:employeeRange,employee_scope:textValue(p.employee_scope),industry:textValue(p.industry ?? p.industry_description ?? p.naics_description) || 'Industry not specified',naics:textValue(p.naics ?? p.naics_code),owner_name:textValue(p.owner_name),owner_role:textValue(p.owner_role),contact_name:textValue(p.contact_name),contact_role:textValue(p.contact_role),phone:textValue(p.phone),website:textValue(p.website),evidence_type:evidence,geocode_quality:textValue(p.geocode_quality || 'unknown').toLowerCase(),operating_status:textValue(p.operating_status || 'unknown'),source_name:textValue(p.source_name),source_url:textValue(p.source_url)};
    plant.mapped = lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0);
    plant.owner_name = plant.owner_name.trim();
    plant.contact_name = plant.contact_name.trim();
    const sourceNames = (Array.isArray(p.sources) ? p.sources : []).map((source) => typeof source === 'string' ? source : source?.name || source?.source_name).filter(Boolean);
    plant.sourceNames = [...new Set((sourceNames.length ? sourceNames : plant.source_name.split(';')).map((name) => String(name).trim()).filter(Boolean))];
    plant.bounds = employeeBounds(employees,employeeRange);
    plant.headcount_multiple_addresses = p.headcount_multiple_addresses === true;
    plant.employee_band = employeeBand(plant);
    plant.search = [plant.name,textValue(p.legal_name),textValue(p.aliases),plant.address,plant.city,plant.county,plant.zip].join(' ').toLocaleLowerCase();
    plant.distance = null;
    return plant;
  }
  function fullAddress(p) { return p.address || p.city || p.zip ? [p.address,[p.city,p.state,p.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') : ''; }
  function employeeLabel(p) { return p.employees !== null ? format(p.employees) : p.employee_range || 'Not reported'; }
  function employeeShort(p) { return p.bounds ? `${employeeLabel(p)}${p.headcount_multiple_addresses ? ' reported across multiple addresses' : ' employees'}` : 'Headcount unavailable'; }
  function employeeBandInfo(p) { return employeeBandsByKey[p.employee_band || employeeBand(p)] || employeeBandsByKey.unknown; }
  function markerDescription(p) { return `${p.name} · ${employeeShort(p)} · ${evidenceLabels[p.evidence_type]}`; }
  function employeeChip(p) {
    const band = employeeBandInfo(p);
    return `<span class="employee-chip ${band.className}" title="${esc(band.description)}"><i class="employee-swatch" aria-hidden="true"></i>${esc(employeeShort(p))}${band.key === 'uncertain' ? '<small>Uncertain band</small>' : ''}</span>`;
  }
  function dateLabel(value) {
    const raw = String(value), monthOnly = /^\d{4}-\d{2}$/.test(raw);
    const date = monthOnly ? new Date(`${raw}-15T12:00:00`) : /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T12:00:00`) : new Date(value);
    return Number.isFinite(+date) ? date.toLocaleDateString('en-US',monthOnly ? {month:'short',year:'numeric'} : {month:'short',day:'numeric',year:'numeric'}) : '';
  }
  function statusClass(p) {
    const value = p.operating_status.toLowerCase();
    if (/inactive|closed|out of business|terminated|ceased|historical/.test(value)) return 'inactive';
    if (/active|operating|open|current/.test(value) && !/unknown|unverified/.test(value)) return 'active';
    return 'unknown';
  }
  function qualityClass(p) {
    if (!p.mapped) return 'unmapped';
    if (/rooftop|parcel|street|address|entrance/.test(p.geocode_quality)) return 'precise';
    if (/zip|postal|city|county|centroid|approx/.test(p.geocode_quality)) return 'approximate';
    return 'unknown';
  }
  function distanceMiles(lat1,lon1,lat2,lon2) {
    const rad = Math.PI / 180, dLat = (lat2-lat1)*rad, dLon=(lon2-lon1)*rad;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin(dLon/2)**2;
    return 3958.7613 * 2 * Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  }
  function distanceLabel(p) { return p.distance === null ? '' : `${p.distance < 10 ? p.distance.toFixed(1) : Math.round(p.distance)} mi`; }
  function createMarker(p, selected = false) {
    const visited = Boolean(state.notes[p.id]?.visited);
    const band = employeeBandInfo(p);
    return L.divIcon({className:`plant-marker${selected ? ' selected' : ''}${visited ? ' visited' : ''}`,html:`<span class="employee-pin ${band.className}" aria-hidden="true"></span>`,iconSize:[selected ? 36 : 28,selected ? 36 : 28],iconAnchor:[selected ? 18 : 14,selected ? 18 : 14]});
  }
  function clusterComposition(markers) {
    const counts = Object.fromEntries(employeeBands.map((band) => [band.key,0]));
    for (const marker of markers) {
      const key = marker.options?.employeeBand;
      counts[Object.hasOwn(counts,key) ? key : 'unknown']++;
    }
    const total = markers.length;
    let cumulative = 0;
    const segments = employeeBands.filter((band) => counts[band.key]).map((band) => {
      const from = total ? cumulative / total * 100 : 0;
      cumulative += counts[band.key];
      const to = total ? cumulative / total * 100 : 100;
      return `${band.color} ${from.toFixed(4)}% ${to.toFixed(4)}%`;
    });
    const breakdown = employeeBands.filter((band) => counts[band.key]).map((band) => `${band.label}: ${format(counts[band.key])}`).join('; ');
    return {counts,total,gradient:segments.length ? `conic-gradient(${segments.join(', ')})` : employeeBandsByKey.unknown.color,description:`${format(total)} locations. Employee-size distribution by number of locations: ${breakdown || 'none'}. The center counts locations, not employees.`};
  }
  function createClusterIcon(cluster) {
    const composition = clusterComposition(cluster.getAllChildMarkers());
    const size = composition.total > 999 ? 60 : composition.total > 99 ? 52 : 44;
    const tooltip = `<div class="cluster-tooltip"><strong>${format(composition.total)} locations</strong><small>Employee bands · location counts</small>${employeeBands.filter((band) => composition.counts[band.key]).map((band) => `<span class="cluster-band ${band.className}"><i class="employee-swatch" aria-hidden="true"></i>${esc(band.label)}<b>${format(composition.counts[band.key])}</b></span>`).join('')}</div>`;
    cluster.options.title = composition.description;
    if (cluster.getTooltip?.()) cluster.setTooltipContent(tooltip);
    else cluster.bindTooltip?.(tooltip,{direction:'top',offset:[0,-10]});
    return L.divIcon({html:`<div class="cluster-distribution" style="background:${composition.gradient}" role="img" aria-label="${esc(composition.description)}" title="${esc(composition.description)}"><span class="cluster-count" aria-hidden="true">${format(composition.total)}</span></div>`,className:'map-cluster',iconSize:L.point(size,size)});
  }
  function setupMap() {
    if (!window.L) throw new Error('The map library could not load. Refresh this page to try again.');
    state.map = L.map('map',{zoomControl:false,preferCanvas:true}).setView([37.67,-120.9],7);
    L.control.zoom({position:'bottomright'}).addTo(state.map);
    let failedTiles = 0;
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',maxZoom:19}).addTo(state.map);
    tiles.on('tileerror',() => { if (++failedTiles >= 5) { $('map-notice').textContent = 'Map tiles need an internet connection. Your location list and saved notes are still available while this page stays open.'; $('map-notice').hidden = false; }});
    tiles.on('tileload',() => { if (failedTiles) { failedTiles = 0; $('map-notice').hidden = true; }});
    state.cluster = L.markerClusterGroup({showCoverageOnHover:false,maxClusterRadius:48,disableClusteringAtZoom:17,chunkedLoading:false,animate:false,spiderfyOnMaxZoom:true,iconCreateFunction:createClusterIcon}).addTo(state.map);
    state.map.on('moveend',() => { if (state.inView && state.loaded) filterResults(false); });
    state.map.on('click',() => { if (state.selected) closeDetail(); });
  }
  function populateFilters() {
    for (const type of ['county','industry']) {
      const counts = new Map();
      for (const p of state.plants) { const value = p[type] || 'Unknown'; counts.set(value,(counts.get(value)||0)+1); }
      for (const [value,count] of [...counts].sort((a,b) => a[0].localeCompare(b[0]))) {
        const option = document.createElement('option'); option.value = value; option.textContent = `${value} (${format(count)})`; $(`${type}-filter`).append(option);
      }
    }
    const sourceNames = [...new Set(state.plants.flatMap((p) => p.sourceNames))].sort((a,b) => a.localeCompare(b));
    for (const name of sourceNames) {
      const option = document.createElement('option'); option.value = name; option.textContent = name; $('source-filter').append(option);
    }
  }
  const localityKey = (value) => String(value || '').trim().toLocaleLowerCase().replace(/\s+/g,' ');
  function searchLocality(query) {
    const key = localityKey(query);
    if (!key) return null;
    const zip = key.match(/^(\d{5})(?:-\d{4})?$/)?.[1];
    if (zip && state.plants.some((p) => p.zip.slice(0,5) === zip)) return {field:'zip',value:zip};
    const county = key.replace(/ county$/,'');
    // An explicit County suffix disambiguates counties that share a city's name.
    if (county !== key && state.plants.some((p) => localityKey(p.county) === county)) return {field:'county',value:county};
    if (state.plants.some((p) => localityKey(p.city) === key)) return {field:'city',value:key};
    if (state.plants.some((p) => localityKey(p.county) === county)) return {field:'county',value:county};
    return null;
  }
  function matches(p,terms,mapBounds,locality = null) {
    const f = state.filters, note = state.notes[p.id] || {};
    if (state.origin && state.radius !== null && (p.distance === null || p.distance > state.radius)) return false;
    if (f.city && p.city.toLocaleLowerCase() !== f.city.toLocaleLowerCase()) return false;
    if (locality ? (locality.field === 'zip' ? p.zip.slice(0,5) : localityKey(p[locality.field])) !== locality.value : terms.some((term) => !p.search.includes(term))) return false;
    if (state.status === 'saved' && !note.saved || state.status === 'visited' && !note.visited) return false;
    if (f.unvisited && note.visited) return false;
    if (f.county && (p.county || 'Unknown') !== f.county) return false;
    if (f.industry && p.industry !== f.industry) return false;
    if (f.evidence === 'current' && p.evidence_type === 'historical_registry') return false;
    if (f.evidence && f.evidence !== 'current' && p.evidence_type !== f.evidence) return false;
    if (f.source && !p.sourceNames.includes(f.source)) return false;
    if (f.operating && statusClass(p) !== f.operating) return false;
    if (f.owner && Boolean(p.owner_name) !== (f.owner === 'known')) return false;
    if (f.contact && Boolean(p.contact_name) !== (f.contact === 'known')) return false;
    if (f.quality && (f.quality === 'mapped' ? !p.mapped : qualityClass(p) !== f.quality)) return false;
    if (f.employee) {
      if (f.employee === 'known' && !p.bounds || f.employee === 'unknown' && p.bounds) return false;
      if (!['known','unknown'].includes(f.employee) && p.employee_band !== f.employee) return false;
    }
    if (mapBounds && (!p.mapped || !mapBounds.contains([p.latitude,p.longitude]))) return false;
    return true;
  }
  function filterResults(updateMap = true) {
    if (!state.loaded) return;
    const query = $('search').value, locality = searchLocality(query);
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const mapBounds = state.inView ? state.map.getBounds() : null;
    state.filtered = state.plants.filter((p) => matches(p,terms,mapBounds,locality));
    if (state.selected && !matches(state.selected,terms,null,locality)) closeDetail();
    sortResults(); state.limit = 80; renderList(); renderCounts(); renderChips(); renderEmployeeLegend();
    if (updateMap) renderMap();
  }
  function sortResults() {
    const sort = $('sort').value;
    state.filtered.sort((a,b) => {
      if (sort === 'distance') { const d = (a.distance ?? Infinity) - (b.distance ?? Infinity); if (Number.isFinite(d) && d || d === Infinity || d === -Infinity) return d; }
      if (sort === 'employees') { const d = (b.bounds?.[0] ?? -1) - (a.bounds?.[0] ?? -1); if (d) return d; }
      return a.name.localeCompare(b.name);
    });
  }
  function renderCounts() {
    const mapped = state.filtered.reduce((count,p) => count+Number(p.mapped),0);
    $('result-count').textContent = `${format(state.filtered.length)} matching locations`;
    $('result-subtitle').textContent = `${format(mapped)} on map${mapped < state.filtered.length ? ` · ${format(state.filtered.length-mapped)} address only` : ''}${state.radius !== null ? ` · within ${state.radius} mi straight line` : state.inView ? ' · in this area' : ''}`;
    $('mobile-count').textContent = format(state.filtered.length);
    if (state.origin?.label === 'Your location' && state.radius !== null && state.locationMessage === 'Your location') {
      $('location-status').textContent = `${format(state.filtered.length)} ${state.filtered.length === 1 ? 'manufacturer' : 'manufacturers'} within ${state.radius} miles of you`;
    }
    const validNotes = state.plants.map((p) => state.notes[p.id]).filter(Boolean);
    $('saved-count').textContent = format(validNotes.filter((n) => n.saved).length);
    $('visited-count').textContent = format(validNotes.filter((n) => n.visited).length);
  }
  function renderList() {
    if (!state.filtered.length) {
      $('result-list').innerHTML = `<div class="empty-state">${icon('search')}<h3>${state.radius !== null ? `No matches within ${state.radius} miles.` : 'No locations here yet.'}</h3><p>${state.status === 'saved' ? 'Shortlist locations from their detail cards to plan your next stops.' : state.status === 'visited' ? 'Mark a location visited after your conversation. It will appear here.' : state.radius !== null ? 'Choose a wider radius or Turn off location. This guide covers the Central Valley and surrounding counties; locations without coordinates cannot appear nearby.' : 'Try another search, widen the map, or adjust your filters.'}</p><button class="button" id="empty-reset">Reset search & filters</button></div>`;
      $('empty-reset').addEventListener('click',resetAll); return;
    }
    $('result-list').innerHTML = state.filtered.slice(0,state.limit).map((p) => {
      const note = state.notes[p.id] || {};
      return `<button class="result-card${state.selected?.id === p.id ? ' active' : ''}" data-plant="${esc(p.id)}" aria-label="View ${esc([p.name,p.city,employeeShort(p),evidenceLabels[p.evidence_type]].filter(Boolean).join(', '))}"><div class="card-topline"><i class="evidence-dot"></i><span>${esc(p.county ? `${p.county} County` : p.city || 'County unavailable')}</span><span class="evidence-label">${esc(evidenceLabels[p.evidence_type])}</span><span class="card-status">${note.saved ? icon('star','saved-icon') : ''}${note.visited ? icon('check') : ''}</span></div><div class="card-name">${esc(p.name)}</div><div class="card-address">${esc([p.address,p.city].filter(Boolean).join(', ') || 'Address not reported')}</div><div class="card-meta">${employeeChip(p)}${!p.mapped ? '<span class="meta-separator"></span><span>Address only</span>' : ''}${p.distance !== null ? `<span class="distance">${distanceLabel(p)}</span>` : ''}</div></button>`;
    }).join('') + (state.filtered.length > state.limit ? `<button class="button show-more" id="show-more">Show ${format(Math.min(80,state.filtered.length-state.limit))} more locations</button>` : '');
    $('result-list').querySelectorAll('[data-plant]').forEach((button) => button.addEventListener('click',() => openDetail(state.plantsById.get(button.dataset.plant),true)));
    $('show-more')?.addEventListener('click',() => { const position = $('result-list').scrollTop; state.limit += 80; renderList(); $('result-list').scrollTop = position; });
  }
  function renderMap() {
    if (!state.cluster) return;
    const generation = ++state.mapRenderGeneration;
    clearTimeout(state.mapRenderTimer);
    state.mapRenderTimer = null;
    state.cluster.clearLayers();
    // With viewport filtering, keep the broader filtered markers visible so panning can discover new results.
    const plants = state.inView ? state.plants.filter((p) => matches(p,$('search').value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean),null)) : state.filtered;
    let offset = 0;
    // Own the scheduling: MarkerCluster's internal chunks cannot be cancelled by clearLayers().
    function addChunk() {
      if (generation !== state.mapRenderGeneration) return;
      const markers = [], end = Math.min(offset + 500,plants.length);
      for (; offset < end; offset++) {
        const p = plants[offset];
        if (!p.mapped) continue;
        let marker = state.markers.get(p.id);
        if (!marker) {
          marker = L.marker([p.latitude,p.longitude],{icon:createMarker(p),title:markerDescription(p),alt:markerDescription(p),employeeBand:p.employee_band,keyboard:true});
          marker.bindTooltip(`<strong>${esc(p.name)}</strong><br>${esc(employeeShort(p))}${p.employee_band === 'uncertain' ? ' · Uncertain band' : ''}<br><span class="marker-evidence">${esc(evidenceLabels[p.evidence_type])}</span>`,{direction:'top',offset:[0,-7]});
          marker.on('click',() => openDetail(p,false));
          state.markers.set(p.id,marker);
        } else marker.setIcon(createMarker(p));
        markers.push(marker);
      }
      state.cluster.addLayers(markers);
      state.mapRenderTimer = offset < plants.length ? setTimeout(addChunk,0) : null;
    }
    addChunk();
  }
  function renderChips() {
    const active = Object.entries(state.filters).filter(([key,value]) => value && !(key === 'evidence' && value === 'current'));
    $('filter-count').hidden = !active.length; $('filter-count').textContent = active.length;
    $('active-filters').hidden = !active.length;
    $('active-filters').innerHTML = active.map(([key,value]) => {
      const label = key === 'unvisited' ? 'Not visited' : key === 'city' ? `City: ${value}` : $(`${key}-filter`).selectedOptions[0]?.textContent.replace(/ \([\d,]+\)$/,'') || value;
      return `<button class="filter-chip" data-remove-filter="${key}" aria-label="Remove ${esc(label)} filter">${esc(label)}${icon('close')}</button>`;
    }).join('');
    $('active-filters').querySelectorAll('button').forEach((button) => button.addEventListener('click',() => { const key = button.dataset.removeFilter; state.filters[key] = ''; if (key === 'unvisited') $('unvisited-filter').checked = false; else if (key === 'city') $('search').value = ''; else $(`${key}-filter`).value = ''; filterResults(); }));
  }
  function renderEmployeeLegend() {
    document.querySelectorAll('[data-employee-band]').forEach((button) => {
      const key = button.dataset.employeeBand, band = employeeBandsByKey[key];
      const active = (state.filters.employee || '') === key;
      button.classList.toggle('active',active); button.setAttribute('aria-pressed',String(active));
      if (band?.optional) button.hidden = !state.plants.some((p) => p.employee_band === key);
    });
  }
  function showView(view) {
    document.body.classList.toggle('view-list',view === 'list');
    $('results-panel').hidden = view !== 'list';
    document.querySelectorAll('[data-view]').forEach((button) => { const active = button.dataset.view === view; button.classList.toggle('active',active); button.setAttribute('aria-pressed',String(active)); });
    if (view === 'map') setTimeout(() => state.map?.invalidateSize(),50);
    if (view === 'list') closeDetail();
  }
  function hasUsableStreet(p) {
    return Boolean(p.address.trim()) && !p.location_requires_access_review && !/\bP\s*\.?\s*O\s*\.?\s*BOX\b|\bP\s*\.?\s*M\s*\.?\s*B\b|\bMAILBOX\b/i.test(p.address);
  }
  function directionsUrl(p, apple = false) {
    const destination = hasUsableStreet(p) ? fullAddress(p) : p.mapped ? `${p.latitude},${p.longitude}` : '';
    if (!destination) return '';
    return apple ? `https://maps.apple.com/?daddr=${encodeURIComponent(destination)}&dirflg=d` : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
  }
  function sourceList(p) {
    const records = Array.isArray(p.sources) ? p.sources : [];
    const sources = records.map((source) => typeof source === 'string' ? {name:source} : source);
    if (!sources.length && p.source_name) sources.push({name:p.source_name,url:p.source_url});
    return sources.map((s) => {
      const url = safeUrl(s.url ?? s.source_url), name = s.name || s.source_name || 'Source record';
      return `<div class="detail-source">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(name)} ↗</a>` : `<span>${esc(name)}</span>`}${s.record_id ? `<small>Record ${esc(s.record_id)}</small>` : ''}${s.snapshot_date || s.updated_at || s.retrieved_at ? `<small>${esc(s.snapshot_date ? 'Dataset date' : s.updated_at ? 'Updated' : 'Retrieved')} ${esc(dateLabel(s.snapshot_date || s.updated_at || s.retrieved_at))}</small>` : ''}</div>`;
    }).join('') || '<p>No source link provided.</p>';
  }
  function additionalStaffing(p) {
    const evidence = Array.isArray(p.headcount_evidence) ? p.headcount_evidence : [];
    return evidence.map((item) => {
      const label = item.employees !== null && item.employees !== undefined ? format(item.employees) : item.employee_range || '';
      const url = safeUrl(item.source_url);
      if (!label || !url) return '';
      return `<p class="staff-evidence">${esc(label)} · ${esc(item.scope || 'Scope unspecified')}${item.source_date && item.source_date !== 'unknown' ? ` · ${esc(item.source_date)}` : ''} <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Source ↗</a></p>`;
    }).join('');
  }
  function ownerDetails(p) {
    const profiles = Array.isArray(p.owner_profiles) ? p.owner_profiles : [];
    const source = safeUrl(p.owner_source_url);
    const fallback = p.owner_photo_source_url || p.owner_photo_url ? [{name:p.owner_name,role:p.owner_role,source_url:p.owner_source_url,photo_url:p.owner_photo_url,photo_source_url:p.owner_photo_source_url}] : [];
    const cards = (profiles.length ? profiles : fallback).filter((person) => person && person.name).map((person) => {
      const photo = safeUrl(person.photo_url), photoSource = safeUrl(person.photo_source_url), ownershipSource = safeUrl(person.source_url);
      return `<div class="owner-profile"><strong>${esc(person.name)}</strong>${person.role ? `<small>${esc(person.role)}</small>` : ''}<div class="owner-links">${photo || photoSource ? `<a href="${esc(photo || photoSource)}" target="_blank" rel="noopener noreferrer">${String(person.photo_use || '').includes('unlabeled') ? 'Owner article' : 'Owner photo'} ↗</a>` : ''}${ownershipSource ? `<a href="${esc(ownershipSource)}" target="_blank" rel="noopener noreferrer">Ownership source ↗</a>` : ''}</div>${person.photo_caption ? `<small>${esc(person.photo_caption)}</small>` : ''}</div>`;
    }).join('');
    return cards || `${p.owner_name && p.owner_role ? `<small>${esc(p.owner_role)}</small>` : ''}${source ? `<a href="${esc(source)}" target="_blank" rel="noopener noreferrer">Ownership source ↗</a>` : ''}`;
  }
  function openDetail(p, pan) {
    if (!p) return;
    state.selected = p;
    showView('map');
    if (state.selectedMarker) state.map.removeLayer(state.selectedMarker);
    if (p.mapped) {
      state.selectedMarker = L.marker([p.latitude,p.longitude],{icon:createMarker(p,true),interactive:false,zIndexOffset:1000}).addTo(state.map);
      if (pan) state.map.setView([p.latitude,p.longitude],Math.max(state.map.getZoom(),14),{animate:false});
    } else state.selectedMarker = null;
    renderDetail(); renderList();
    $('detail-panel').scrollTop = 0;
    $('detail-panel').focus({preventScroll:true});
  }
  function renderDetail() {
    const p = state.selected; if (!p) return;
    const focusedControl = $('detail-panel').contains(document.activeElement) ? document.activeElement.id : '';
    const note = state.notes[p.id] || {}, website = websiteUrl(p.website);
    const phone = phoneHref(p.phone);
    const googleDirections = directionsUrl(p), appleDirections = googleDirections ? directionsUrl(p,true) : '';
    const quality = qualityClass(p);
    const warning = !googleDirections ? 'A physical street address is needed before directions can be provided. This record has no usable map coordinates.' : !hasUsableStreet(p) ? 'No usable street address is listed. Directions use the map coordinates; confirm they point to the plant.' : !p.mapped ? 'This record has no usable coordinates. Directions use the listed address.' : quality === 'approximate' ? 'This map pin is approximate. Directions use the listed street address when available.' : p.evidence_type === 'historical_registry' ? 'This is a historical / unverified registry record. Confirm present activity and the address before visiting.' : '';
    $('detail-panel').innerHTML = `<button class="button square detail-close" id="detail-close" aria-label="Close location details">${icon('close')}</button><div class="detail-category"><i class="evidence-dot"></i>${esc(evidenceLabels[p.evidence_type])}</div><h2 class="detail-name">${esc(p.name)}</h2><p class="detail-address">${esc(fullAddress(p) || 'Street address not reported')}${p.legal_name && p.legal_name.toLocaleLowerCase() !== p.name.toLocaleLowerCase() ? `<br>Reported business: ${esc(p.legal_name)}` : ''}${p.county ? `<br>${esc(p.county)} County` : ''}${p.distance !== null ? `<br>${distanceLabel(p)} from your selected starting point (straight line)` : ''}</p>
      <div class="detail-actions">${googleDirections ? `<a class="button button-primary directions" href="${esc(googleDirections)}" target="_blank" rel="noopener noreferrer">${icon('route')}Get directions in Google Maps</a>` : `<button type="button" class="button directions" disabled>${icon('route')}Street address needed for directions</button>`}<button class="button${note.saved ? ' is-active' : ''}" id="detail-save" aria-pressed="${Boolean(note.saved)}">${icon('star','star')}${note.saved ? 'Shortlisted' : 'Add to shortlist'}</button><button class="button${note.visited ? ' is-active' : ''}" id="detail-visited" aria-pressed="${Boolean(note.visited)}">${icon('check')}${note.visited ? 'Visited' : 'Mark visited'}</button></div>${appleDirections ? `<a class="apple-directions" href="${esc(appleDirections)}" target="_blank" rel="noopener noreferrer">Open in Apple Maps ↗</a>` : ''}
      <dl class="detail-facts"><div><dt>EMPLOYEES</dt><dd class="employee-detail-value ${employeeBandInfo(p).className}"><i class="employee-swatch" aria-hidden="true"></i><span class="${p.bounds ? 'large-value' : ''}">${esc(employeeLabel(p))}</span></dd>${p.headcount_multiple_addresses ? `<small class="employee-scope-warning">${esc(employeeLabel(p))} reported across multiple addresses. Individual building counts are unavailable.</small>` : ''}<small>${esc(p.employee_scope || (p.bounds ? 'Scope not specified by source' : 'No reported headcount'))}</small></div><div><dt>SOURCE STATUS</dt><dd>${esc(p.operating_status === 'unknown' ? 'Not verified' : p.operating_status)}</dd>${note.visited_at ? `<small>Visited ${esc(dateLabel(note.visited_at))}</small>` : ''}</div><div class="full"><dt>INDUSTRY</dt><dd>${esc(p.industry_detail || p.industry)}</dd>${p.naics ? `<small>NAICS ${esc(p.naics)}</small>` : ''}</div><div class="full"><dt>REPORTED OWNER</dt><dd>${esc(p.owner_name || 'Not reported')}</dd>${ownerDetails(p)}</div>${p.headcount_evidence?.length ? `<div class="full"><dt>ADDITIONAL STAFFING SOURCES</dt><dd>${additionalStaffing(p)}</dd></div>` : ''}${p.contact_name ? `<div class="full"><dt>REPORTED BUSINESS CONTACT</dt><dd>${esc(p.contact_name)}</dd><small>${esc(p.contact_role || 'Role not specified')} · Not necessarily the owner</small></div>` : ''}${website || phone ? `<div class="full contact-links">${phone ? `<a href="${esc(phone)}">${esc(p.phone)}</a>` : ''}${website ? `<a href="${esc(website)}" target="_blank" rel="noopener noreferrer">Business website ↗</a>` : ''}</div>` : ''}</dl>
      ${warning ? `<div class="detail-warning">${esc(warning)}</div>` : ''}<section class="detail-section"><label class="notes-label" for="visit-notes">Your field notes <span id="notes-status">Saved on this device</span></label><textarea id="visit-notes" placeholder="Who you met, best time to return, what to follow up on…" maxlength="12000">${esc(note.notes || '')}</textarea><p class="detail-footnote">Notes and visit history stay in this browser. Back them up from About the data before switching devices.</p></section>
      <section class="detail-section"><h3>Location & source</h3><p>${p.mapped ? `Coordinates: ${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}<br>` : ''}Location precision: ${esc(p.geocode_quality || 'Not reported')}${p.geocode_provider ? `<br>Coordinate provider: ${esc(p.geocode_provider)}` : ''}${p.headcount_multiple_addresses && p.employee_source_address ? `<br>Employee reporting addresses: ${esc(p.employee_source_address)}` : ''}${p.updated_at ? `<br>Record date: ${esc(dateLabel(p.updated_at) || p.updated_at)}` : ''}</p>${sourceList(p)}${p.notes ? `<p>${esc(textValue(p.notes))}</p>` : ''}</section>`;
    $('detail-panel').hidden = false;
    if (focusedControl && $(focusedControl)) $(focusedControl).focus({preventScroll:true});
    $('detail-close').addEventListener('click',closeDetail);
    $('detail-save').addEventListener('click',() => updateOutreach(p.id,'saved'));
    $('detail-visited').addEventListener('click',() => updateOutreach(p.id,'visited'));
    $('visit-notes').addEventListener('input',(event) => {
      const record = state.notes[p.id] ||= {}; record.notes = event.target.value; record.updated_at = new Date().toISOString();
      $('notes-status').textContent = 'Saving…'; clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { const saved = saveNotes(); if ($('notes-status')) $('notes-status').textContent = saved ? 'Saved on this device' : 'Could not save'; },250);
    });
  }
  function closeDetail() {
    const wasFocused = $('detail-panel').contains(document.activeElement);
    state.selected = null; $('detail-panel').hidden = true;
    if (state.selectedMarker) { state.map?.removeLayer(state.selectedMarker); state.selectedMarker = null; }
    document.querySelectorAll('.result-card.active').forEach((card) => card.classList.remove('active'));
    if (wasFocused) $('location-button').focus({preventScroll:true});
  }
  function updateOutreach(id,key) {
    const record = state.notes[id] ||= {}; record[key] = !record[key]; record.updated_at = new Date().toISOString();
    if (key === 'visited') record.visited_at = record.visited ? record.updated_at : null;
    saveNotes(); renderDetail(); filterResults();
  }
  function setOrigin(lat,lng,label,accuracy = null) {
    state.origin = {lat,lng,label,accuracy,updatedAt:Date.now()};
    if (state.radius === null) state.radius = Number($('radius-filter').value) || 15;
    for (const p of state.plants) p.distance = p.mapped ? distanceMiles(lat,lng,p.latitude,p.longitude) : null;
    if (state.originMarker) state.map.removeLayer(state.originMarker);
    if (state.accuracyCircle) state.map.removeLayer(state.accuracyCircle);
    state.accuracyCircle = Number.isFinite(accuracy) && accuracy > 0 ? L.circle([lat,lng],{radius:accuracy,color:'#347caf',weight:1,fillOpacity:.12,interactive:false}).addTo(state.map) : null;
    state.originMarker = L.marker([lat,lng],{icon:L.divIcon({className:'origin-marker',iconSize:[15,15],iconAnchor:[7.5,7.5]}),title:label}).addTo(state.map).bindTooltip(esc(label));
    $('origin-label').textContent = `${label} · distances are straight line`; $('origin-label').hidden = false;
    updateLocationStatus(label,accuracy);
    $('sort').value = 'distance'; filterResults(); if (state.selected) renderDetail();
  }
  function updateLocationStatus(message,accuracy = null) {
    state.locationMessage = message;
    $('nearby-controls').hidden = false; document.body.classList.add('nearby-active');
    $('location-status').textContent = message;
    $('location-accuracy').textContent = Number.isFinite(accuracy) ? `GPS ±${format(Math.round(accuracy))} m · ${new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}. Straight-line distances.` : 'Straight-line distances. Plan your stops while parked.';
    $('radius-filter').disabled = !state.origin;
    state.map?.invalidateSize();
  }
  function clearNearby(update = true) {
    state.origin = null; state.radius = null; state.locationRequest++; state.locating = false;
    state.locationMessage = '';
    $('near-me-button').disabled = false; $('location-button').disabled = false;
    for (const p of state.plants) p.distance = null;
    for (const key of ['originMarker','accuracyCircle']) { if (state[key]) state.map?.removeLayer(state[key]); state[key] = null; }
    $('nearby-controls').hidden = true; $('origin-label').hidden = true;
    document.body.classList.remove('nearby-active'); $('sort').value = 'name';
    state.map?.invalidateSize(); if (update) filterResults();
  }
  function clearSearchFilters() {
    clearTimeout(searchTimer); $('search').value = ''; state.filters = {evidence:'current'}; state.status = 'all'; state.inView = false; $('in-view').checked = false;
    for (const id of filterIds) $(`${id}-filter`).value = id === 'evidence' ? 'current' : '';
    $('unvisited-filter').checked = false;
    document.querySelectorAll('[data-status]').forEach((button) => { const active = button.dataset.status === 'all'; button.classList.toggle('active',active); button.setAttribute('aria-pressed',String(active)); });
  }
  function useLocation() {
    if (!state.loaded) { toast('The location list is still loading. Try My location again in a moment.'); return; }
    if (state.locating) return;
    if (!window.isSecureContext) { updateLocationStatus('Location requires an HTTPS connection.'); toast('Open the secure map link to use My location. You can also sort from the map center.',10000); return; }
    if (!navigator.geolocation) { updateLocationStatus('Location is unavailable in this browser.'); return; }
    const request = ++state.locationRequest;
    state.locating = true; $('near-me-button').disabled = true; $('location-button').disabled = true;
    updateLocationStatus('Finding your location…');
    const finish = () => { state.locating = false; $('near-me-button').disabled = false; $('location-button').disabled = false; };
    navigator.geolocation.getCurrentPosition((position) => {
      if (request !== state.locationRequest) return;
      finish(); const {latitude,longitude,accuracy} = position.coords;
      if (![latitude,longitude].every(Number.isFinite) || Math.abs(latitude)>90 || Math.abs(longitude)>180) { updateLocationStatus('The browser returned an invalid location. Tap My location to retry.'); return; }
      clearSearchFilters(); state.radius = Number($('radius-filter').value) || 15;
      setOrigin(latitude,longitude,'Your location',Number.isFinite(accuracy) ? accuracy : null);
      const zoom = state.radius <= 5 ? 12 : state.radius <= 15 ? 11 : state.radius <= 30 ? 10 : 9;
      state.map.setView([latitude,longitude],zoom,{animate:false});
      const url = new URL(location.href); url.searchParams.delete('city'); window.history?.replaceState(null,'',url);
      showView('map'); $('result-list').scrollTop = 0;
      toast(accuracy > 1000 ? 'Your GPS position is approximate. Nearby distances may be off; tap My location to refresh.' : 'Nearest locations across the full guide. Tap a location for directions or add it to your shortlist.');
    },(error) => {
      if (request !== state.locationRequest) return;
      finish(); const message = error.code === 1 ? 'Location permission denied. Allow location for this site in browser settings, then tap My location.' : error.code === 3 ? 'Location timed out. Tap My location to retry outdoors or near a window.' : 'Location unavailable. Check device location services and tap My location to retry.';
      updateLocationStatus(message + (state.origin ? ' Previous location is still selected.' : '')); toast('You can still search a city or sort from the map center.',9000);
    },{enableHighAccuracy:true,timeout:15000,maximumAge:30000});
  }
  function shortestStopOrder(plants,origin) {
    // At most four stops: check all permutations, measuring straight-line segments only.
    if (!origin || plants.length < 2 || plants.some((p) => !p.mapped)) return plants.slice();
    let best = plants.slice(), bestDistance = Infinity;
    function visit(remaining,path,lat,lng,total) {
      if (!remaining.length) { if (total < bestDistance) { bestDistance = total; best = path; } return; }
      for (let i=0;i<remaining.length;i++) {
        const p = remaining[i], next = total+distanceMiles(lat,lng,p.latitude,p.longitude);
        if (next < bestDistance) visit(remaining.filter((_,j) => i!==j),[...path,p],p.latitude,p.longitude,next);
      }
    }
    visit(plants.slice(0,4),[],origin.lat,origin.lng,0); return best;
  }
  function routeUrl(plants,origin = state.origin) {
    if (!plants.length || plants.length > 4) return '';
    const destinations = plants.map((p) => hasUsableStreet(p) ? fullAddress(p) : p.mapped ? `${p.latitude},${p.longitude}` : '');
    if (destinations.some((destination) => !destination)) return '';
    const url = new URL('https://www.google.com/maps/dir/');
    url.searchParams.set('api','1'); url.searchParams.set('travelmode','driving');
    url.searchParams.set('destination',destinations.at(-1));
    if (destinations.length > 1) url.searchParams.set('waypoints',destinations.slice(0,-1).join('|'));
    if (origin && [origin.lat,origin.lng].every(Number.isFinite)) url.searchParams.set('origin',`${origin.lat},${origin.lng}`);
    return url.href.length <= 2048 ? url.href : '';
  }
  function renderRoute() {
    const saved = state.plants.filter((p) => state.notes[p.id]?.saved).sort((a,b) => (a.distance ?? Infinity)-(b.distance ?? Infinity) || a.name.localeCompare(b.name));
    const eligible = saved.filter((p) => p.mapped && directionsUrl(p));
    state.routeIds = state.routeIds.filter((id) => eligible.some((p) => p.id===id)).slice(0,4);
    const stops = state.routeIds.map((id) => state.plantsById.get(id));
    $('route-origin').textContent = state.origin ? `Start: ${state.origin.label}${state.origin.label === 'Your location' ? `, captured ${new Date(state.origin.updatedAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}` : ''}. Refresh My location if you have moved.` : 'Google Maps will choose your starting location. Use My location first to order stops from your GPS position.';
    $('route-order-button').disabled = !state.origin || stops.length<2;
    $('route-stops').innerHTML = stops.map((p,i) => `<li><span class="route-number">${i+1}</span><div><strong>${esc(p.name)}</strong><small>${esc(fullAddress(p))}</small></div><div class="route-reorder"><button class="button square" data-route-move="${i}" data-step="-1" ${i===0?'disabled':''} aria-label="Move ${esc(p.name)} earlier">↑</button><button class="button square" data-route-move="${i}" data-step="1" ${i===stops.length-1?'disabled':''} aria-label="Move ${esc(p.name)} later">↓</button></div></li>`).join('');
    $('route-stops').querySelectorAll('[data-route-move]').forEach((button) => button.addEventListener('click',() => { const i=Number(button.dataset.routeMove), j=i+Number(button.dataset.step); [state.routeIds[i],state.routeIds[j]]=[state.routeIds[j],state.routeIds[i]]; renderRoute(); }));
    $('route-options').innerHTML = saved.length ? `<h3>Your shortlist</h3>${saved.map((p) => { const selected=state.routeIds.includes(p.id), available=p.mapped && directionsUrl(p); return `<label class="route-option"><input type="checkbox" data-route-id="${esc(p.id)}" ${selected?'checked':''} ${!available || !selected && stops.length>=4?'disabled':''}><span><strong>${esc(p.name)}</strong><small>${esc(!available?'Needs a map location for route planning':p.distance!==null?`${distanceLabel(p)} straight line · ${p.city}`:p.city)}${p.evidence_type==='historical_registry'?' · Historical / unverified':''}</small></span></label>`; }).join('')}` : '<p>No shortlisted locations yet. Open a location and tap “Add to shortlist,” then return here.</p>';
    $('route-options').querySelectorAll('[data-route-id]').forEach((input) => input.addEventListener('change',() => { const id=input.dataset.routeId; if (input.checked && state.routeIds.length<4) state.routeIds.push(id); else state.routeIds=state.routeIds.filter((value) => value!==id); renderRoute(); }));
    const url=routeUrl(stops); $('route-open').hidden=!url;
    if (url) $('route-open').href=url; else $('route-open').removeAttribute('href');
    $('route-summary').textContent=`${stops.length} of 4 stops selected. ${state.origin?'Ordering uses straight-line distance, not roads or traffic.':'Selected order is preserved.'}${stops.length && !url?' The route link is too long; choose fewer stops.':''}`;
  }
  function openRoute() {
    if (!state.loaded) { toast('Wait for the location list to finish loading.'); return; }
    if (!state.routeIds.length) {
      const candidates=state.plants.filter((p) => state.notes[p.id]?.saved && p.mapped && directionsUrl(p)).sort((a,b) => (a.distance ?? Infinity)-(b.distance ?? Infinity) || a.name.localeCompare(b.name)).slice(0,4);
      state.routeIds=shortestStopOrder(candidates,state.origin).map((p) => p.id);
    }
    renderRoute(); $('route-dialog').showModal();
  }
  function fitResults() {
    const points = state.filtered.filter((p) => p.mapped).map((p) => [p.latitude,p.longitude]);
    if (!points.length) { toast('These results have no map coordinates. Open a location to get directions from its address.'); return; }
    closeDetail(); state.map.fitBounds(points,{padding:[55,70],maxZoom:14,animate:false}); showView('map');
  }
  function resetAll() {
    clearSearchFilters(); clearNearby(false); filterResults();
  }
  function download(name,content,type) {
    const url = URL.createObjectURL(new Blob([content],{type})), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  function exportCsv() {
    const fields = ['id','name','address','city','county','state','zip','latitude','longitude','industry','industry_detail','naics','employees','employee_range','employee_band','employees_year','employee_source_url','headcount_evidence','employee_scope','headcount_multiple_addresses','employee_source_address','owner_name','owner_role','owner_source_url','owner_photo_url','owner_photo_source_url','owner_profiles','contact_name','contact_role','phone','website','operating_status','evidence_type','geocode_quality','geocode_provider','source_name','source_url','updated_at','shortlisted','visited','visited_at','field_notes'];
    // Neutralize spreadsheet formula prefixes in any imported text, preserving the source in JSON.
    const cell = (value) => { let str = value && typeof value === 'object' ? JSON.stringify(value) : textValue(value); if (/^[\s]*[=+@-]/.test(str) && typeof value !== 'number') str = `'${str}`; return `"${str.replace(/"/g,'""')}"`; };
    const rows = state.filtered.map((p) => { const n = state.notes[p.id] || {}; const row = {...p,shortlisted:Boolean(n.saved),visited:Boolean(n.visited),visited_at:n.visited_at || '',field_notes:n.notes || ''}; return fields.map((field) => cell(row[field])).join(','); });
    download(`manufacturing-outreach-${new Date().toISOString().slice(0,10)}.csv`,'\ufeff'+[fields.join(','),...rows].join('\r\n'),'text/csv;charset=utf-8'); toast(`Exported ${format(rows.length)} filtered locations, including your field notes.`);
  }
  function renderCoverage() {
    const c = state.coverage, mapped = state.plants.filter((p) => p.mapped).length;
    const counts = new Map(); for (const p of state.plants) counts.set(p.county || 'Unknown',(counts.get(p.county || 'Unknown')||0)+1);
    const limits = Array.isArray(c.limitations) ? c.limitations : [];
    const sources = Array.isArray(c.sources) ? c.sources : [];
    const evidenceCounts = Object.fromEntries(Object.keys(evidenceLabels).map((key) => [key,state.plants.filter((p) => p.evidence_type === key).length]));
    const currentFieldCounts = [c.current_source_employee_records,c.current_source_owner_records,c.current_source_contact_records].map(number);
    const rangeOnlyCount = number(c.current_source_employee_range_only_records);
    const fieldCoverage = currentFieldCounts.every((count) => count !== null) ? `<p>Among current-source leads, ${format(currentFieldCounts[0])} have a reported employee count, ${format(currentFieldCounts[1])} have a reported owner, and ${format(currentFieldCounts[2])} have a named business contact.${rangeOnlyCount !== null ? ` An additional ${format(rangeOnlyCount)} report an employee range only.` : ''} Owners can include legal entities. Missing fields mean the source did not report the information.</p>` : '';
    $('coverage-content').innerHTML = `<div class="coverage-stats"><div><strong>${format(evidenceCounts.facility_evidence + evidenceCounts.directory_lead)}</strong><small>Current-source leads</small></div><div><strong>${format(evidenceCounts.historical_registry)}</strong><small>Historical / unverified</small></div><div><strong>${format(state.plants.length)}</strong><small>Total location records</small></div></div>${fieldCoverage}<p>${esc(c.description || 'A combined field guide to manufacturing locations across the Central Valley and surrounding areas. Source records vary in age, precision, and completeness.')}</p>${c.generated_at ? `<p>Dataset assembled ${esc(dateLabel(c.generated_at))}.</p>` : ''}<p>${format(mapped)} records have coordinates across ${format(counts.size)} counties. The map and list show counts for your current filters. Historical / unverified records are excluded at startup and when filters are reset.</p><h3>Employee-size colors</h3><p>Map pins and headcount chips use the same employee bands: blue 1–9, teal 10–49, orange 50–249, and purple 250+. Gray diamonds mean headcount unavailable. Striped pins mean a reported range spans bands or the headcount covers multiple addresses; hollow pins indicate an explicitly reported zero. Missing information is never treated as zero. Tap a legend size to filter. A cluster ring shows how many locations belong to each band, including unknowns; its center is a location count, not a staff total or average.</p><h3>Evidence labels</h3><ul><li><strong>Facility evidence (${format(evidenceCounts.facility_evidence)}):</strong> a source identifies a manufacturing facility at this location. This does not by itself establish current occupancy.</li><li><strong>Directory lead (${format(evidenceCounts.directory_lead)}):</strong> a directory or licensing source lists a business associated with manufacturing. The address may be a headquarters, office, or small operation.</li><li><strong>Historical / unverified (${format(evidenceCounts.historical_registry)}):</strong> a facility appears in a registry but its present activity is unverified. These records are available through the Evidence filter and hidden by default.</li></ul><h3>Coverage limits</h3><ul>${limits.map((limit) => `<li>${esc(typeof limit === 'string' ? limit : JSON.stringify(limit))}</li>`).join('')}<li>No combined public dataset can certify every operating plant. Treat the map as a prospecting inventory and use source details to assess a stop.</li><li>Missing employee and owner fields mean the source did not report them. A business contact is not automatically an owner.</li><li>Map pins may reflect provider coordinates or approximate locations. Directions prefer the listed street address.</li><li>Nearby sorting uses straight line distances. Live phone location requires HTTPS and browser permission.</li></ul><h3>Source datasets</h3>${sources.length ? sources.map((source) => { const url = safeUrl(source.url); return `<div class="source-item">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(source.name || 'Dataset')} ↗</a>` : `<strong>${esc(source.name || 'Dataset')}</strong>`}${source.description ? `<p>${esc(source.description)}</p>` : ''}<small>${source.records !== undefined ? `${format(source.records)} source records` : ''}${source.retrieved_at ? ` · Retrieved ${esc(dateLabel(source.retrieved_at))}` : ''}</small></div>`; }).join('') : '<p>See the individual location records for available source information.</p>'}<h3>Locations by county</h3><div class="county-breakdown">${[...counts].sort((a,b) => a[0].localeCompare(b[0])).map(([county,count]) => `<div><span>${esc(county)}</span><strong>${format(count)}</strong></div>`).join('')}</div><h3>Your outreach notes</h3><p>Shortlists, visit history, and notes are stored in this browser on this device. They are not automatically synchronized. Export a backup here to move them to another device. Map tiles require an internet connection; dataset records are loaded from this field guide.</p>`;
  }
  function setupEvents() {
    $('search').addEventListener('input',() => {
      if (state.filters.city && $('search').value.trim().toLocaleLowerCase() !== state.filters.city.toLocaleLowerCase()) delete state.filters.city;
      // A typed destination searches the full coverage area, even after a nearby search.
      if (state.radius !== null || state.locating) clearNearby(false);
      clearTimeout(searchTimer); searchTimer = setTimeout(() => { filterResults(); if ($('search').value.trim()) { const points=state.filtered.filter((p) => p.mapped).map((p) => [p.latitude,p.longitude]); if (points.length) state.map.fitBounds(points,{padding:[60,120],maxZoom:14,animate:false}); showView('list'); } else showView('map'); },200);
    });
    document.querySelectorAll('[data-employee-band]').forEach((button) => button.addEventListener('click',() => {
      const key = button.dataset.employeeBand;
      state.filters.employee = state.filters.employee === key ? '' : key;
      $('employee-filter').value = state.filters.employee;
      filterResults();
    }));
    $('sort').addEventListener('change',() => { if ($('sort').value === 'distance' && !state.origin) { const center = state.map.getCenter(); setOrigin(center.lat,center.lng,'Map center'); toast('Sorted from the current map center. Use the location button to start from where you are.'); } else { sortResults(); renderList(); } });
    document.querySelectorAll('[data-status]').forEach((button) => button.addEventListener('click',() => { state.status = button.dataset.status; document.querySelectorAll('[data-status]').forEach((b) => { const active = b === button; b.classList.toggle('active',active); b.setAttribute('aria-pressed',String(active)); }); filterResults(); }));
    document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click',() => showView(button.dataset.view === 'list' && !$('results-panel').hidden ? 'map' : button.dataset.view)));
    $('in-view').addEventListener('change',() => { state.inView = $('in-view').checked; filterResults(); });
    $('legend-toggle').addEventListener('click',() => { const collapsed=document.body.classList.toggle('legend-collapsed'); $('legend-toggle').setAttribute('aria-expanded',String(!collapsed)); });
    $('filter-button').addEventListener('click',() => $('filter-dialog').showModal());
    $('coverage-button').addEventListener('click',() => { renderCoverage(); $('coverage-dialog').showModal(); });
    document.querySelectorAll('.close-dialog').forEach((button) => button.addEventListener('click',() => button.closest('dialog').close()));
    document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('click',(event) => { if (event.target === dialog) { const rect=dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } }));
    $('filter-form').addEventListener('submit',(event) => { event.preventDefault(); for (const id of filterIds) state.filters[id] = $(`${id}-filter`).value; state.filters.unvisited = $('unvisited-filter').checked; $('filter-dialog').close(); filterResults(); });
    $('reset-filters').addEventListener('click',() => { for (const id of filterIds) $(`${id}-filter`).value = id === 'evidence' ? 'current' : ''; $('unvisited-filter').checked = false; state.filters = {evidence:'current'}; filterResults(); });
    $('location-button').addEventListener('click',useLocation);
    $('near-me-button').addEventListener('click',useLocation);
    $('clear-location').addEventListener('click',() => {
      resetAll();
      const url = new URL(location.href); url.searchParams.delete('city'); window.history?.replaceState(null,'',url);
      fitResults();
    });
    $('radius-filter').addEventListener('change',() => { if (!state.origin) return; state.radius=Number($('radius-filter').value); filterResults(); state.map.setView([state.origin.lat,state.origin.lng],state.radius<=5?12:state.radius<=15?11:state.radius<=30?10:9,{animate:false}); $('result-list').scrollTop=0; });
    $('plan-route-button').addEventListener('click',openRoute);
    $('mobile-route-button').addEventListener('click',openRoute);
    $('route-clear-button').addEventListener('click',() => { state.routeIds=[]; renderRoute(); });
    $('route-order-button').addEventListener('click',() => { state.routeIds=shortestStopOrder(state.routeIds.map((id) => state.plantsById.get(id)),state.origin).map((p) => p.id); renderRoute(); });
    $('route-find-button').addEventListener('click',() => { $('route-dialog').close(); showView('list'); });
    $('center-button').addEventListener('click',() => { const center = state.map.getCenter(); setOrigin(center.lat,center.lng,'Map center'); toast('Locations sorted from the map center. Move the map and tap again to choose a new starting point.'); });
    $('fit-button').addEventListener('click',fitResults);
    $('export-button').addEventListener('click',exportCsv);
    $('backup-button').addEventListener('click',() => { download(`manufacturing-map-notes-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify({format:'field-atlas-notes',version:1,exported_at:new Date().toISOString(),notes:state.notes},null,2),'application/json'); toast('Your notes backup is ready. Keep it somewhere you can access from your other device.'); });
    $('restore-input').addEventListener('change',async(event) => {
      const file = event.target.files[0]; if (!file) return;
      try {
        if (file.size > 10000000) throw new Error('This file is too large to be a notes backup.');
        const data = JSON.parse(await file.text());
        if (data.format !== 'field-atlas-notes' || data.version !== 1 || !data.notes || typeof data.notes !== 'object' || Array.isArray(data.notes)) throw new Error('Choose a manufacturing-map notes backup.');
        let restored = 0;
        for (const [id,note] of Object.entries(data.notes)) {
          if (['__proto__','constructor','prototype'].includes(id) || !note || typeof note !== 'object') continue;
          const existing = state.notes[id];
          if (existing?.updated_at && String(existing.updated_at) > String(note.updated_at || '')) continue;
          state.notes[id] = {saved:Boolean(note.saved),visited:Boolean(note.visited),notes:String(note.notes || '').slice(0,12000),visited_at:typeof note.visited_at === 'string' ? note.visited_at : null,updated_at:typeof note.updated_at === 'string' ? note.updated_at : new Date().toISOString()}; restored++;
        }
        saveNotes(); filterResults(); if (state.selected) renderDetail(); toast(`Restored ${format(restored)} outreach records. More recent notes on this device were kept.`);
      } catch(error) { toast(error.message || 'This notes file could not be restored.'); }
      event.target.value = '';
    });
    document.addEventListener('keydown',(event) => { if (event.key === 'Escape') closeDetail(); });
    window.addEventListener('pagehide',saveNotes);
    window.addEventListener('storage',(event) => { if (event.key === storageKey) { loadNotes(); filterResults(); if (state.selected) renderDetail(); } });
  }
  async function loadPlants() {
    const manifestURL=new URL('../data/manifest.json',location.href);
    const response=await fetch(manifestURL,{cache:'no-cache'});
    if (response.status===404) {
      const fallback=await fetch(new URL('plants.json',manifestURL),{cache:'no-cache'});
      if (!fallback.ok) throw new Error(`The location dataset could not load (HTTP ${fallback.status}). Reload to try again.`);
      return fallback.json();
    }
    if (!response.ok) throw new Error(`The location manifest could not load (HTTP ${response.status}). Reload to sign in or retry.`);
    const manifest=await response.json();
    if (manifest.version!==1 || !Number.isInteger(manifest.total_records) || manifest.total_records<0 || !Array.isArray(manifest.chunks) || manifest.chunks.length>1000 || manifest.chunks.some((chunk) => !/^plants-\d+\.json$/.test(chunk.path) || !Number.isInteger(chunk.records) || chunk.records<0)) throw new Error('The location manifest is invalid. Reload after the dataset is updated.');
    if (new Set(manifest.chunks.map((chunk) => chunk.path)).size!==manifest.chunks.length) throw new Error('The location manifest contains duplicate chunks.');
    const results=new Array(manifest.chunks.length); let cursor=0;
    async function worker() {
      while (cursor<manifest.chunks.length) {
        const index=cursor++, chunk=manifest.chunks[index];
        const r=await fetch(new URL(chunk.path,manifestURL),{cache:'no-cache'});
        if (!r.ok) throw new Error(`Part of the location dataset could not load (HTTP ${r.status}). Reload to try again.`);
        const rows=await r.json();
        if (!Array.isArray(rows) || rows.length!==chunk.records) throw new Error('A location dataset part is incomplete. Reload to try again.');
        results[index]=rows;
      }
    }
    await Promise.all(Array.from({length:Math.min(4,manifest.chunks.length)},worker));
    const rows=results.flat();
    if (rows.length!==manifest.total_records) throw new Error('The location dataset is incomplete. Reload to try again.');
    return rows;
  }
  async function start() {
    loadNotes(); setupEvents();
    try {
      setupMap();
      const [payload,coverageResponse] = await Promise.all([loadPlants(),fetch('../data/coverage.json',{cache:'no-cache'}).catch(() => null)]);
      const records = Array.isArray(payload) ? payload : payload.plants || payload.records || payload.features?.map((f) => ({...f.properties,longitude:f.geometry?.coordinates?.[0],latitude:f.geometry?.coordinates?.[1]}));
      if (!Array.isArray(records)) throw new Error('The dataset does not contain a recognized location list.');
      state.plants = records.map(normalize);
      state.plantsById = new Map(state.plants.map((p) => [p.id,p]));
      if (coverageResponse?.ok) { try { state.coverage = await coverageResponse.json(); } catch { /* optional metadata */ } }
      populateFilters();
      const requestedCity = new URLSearchParams(location.search).get('city');
      if (requestedCity) { state.filters.city = requestedCity; $('search').value = requestedCity; }
      state.loaded = true; filterResults(); fitResults();
      const date = dateLabel(state.coverage.generated_at); if (date) $('data-date').textContent = `Assembled ${date}`;
      if (!state.plants.length) toast('The dataset is empty. Add source records to begin planning outreach.');
    } catch(error) {
      showView('list');
      $('result-count').textContent = 'Data unavailable';
      $('result-list').innerHTML = `<div class="empty-state">${icon('info')}<h3>Your guide is getting ready.</h3><p>${esc(error.message)}</p><button class="button" id="reload-button">Reload dataset</button></div>`;
      $('reload-button').addEventListener('click',() => location.reload());
      console.error('Manufacturing map could not start:',error);
    }
  }
  start();
})();
