# Field Atlas

Private manufacturing outreach map for planning stops across the Central Valley and nearby counties. The app loads `../data/plants.json` and `../data/coverage.json`; no library credentials are stored or required by the UI. The parent project hosts it at `/outreach-map/ui/index.html` through a development-only route. Keep licensed source data within the private workspace.

## Plan a day of outreach

1. Open the private **HTTPS** map URL on your phone. The phone and host Mac must be connected to the same Tailscale network, and the Mac and development server must be running.
2. On mobile, tap **Locations** to reach search, filters, and your shortlist. Search for a business, city, county, ZIP, industry, or reported person's name. Multiple search words must all match the record.
3. Open the filter button beside search. Choose a county, staffing band, industry, owner/contact availability, or source dataset, then tap **Show locations**. Filters combine; a source selection does not clear the evidence filter.
4. Tap **Map** to inspect nearby clusters. Pin colors identify employee bands; tap a size in the legend to filter, tap it again or choose **All sizes** to clear that staffing filter. Tap a cluster to zoom in, or select a named location from the list. **Search this map area** restricts list results to mapped records inside the visible area; turn it off to include address-only records and results elsewhere.
5. Use the target button to sort from **your location**, or the pin button to sort from the **map center**. Tap again after moving to refresh your starting point. Distances are straight line, not driving miles or a suggested route order.
6. Open a location, check its source status, address, staffing scope, and reported owner/contact. **Add to shortlist** collects candidates. Google Maps and Apple Maps links use a physical street address when available, otherwise usable coordinates. PO Box and PMB addresses are not driving destinations. Without a usable street address or coordinates, the card says **Street address needed for directions**.
7. After a stop, use **Mark visited** and add field notes. This records your outreach history; it does not change the source's operating-status claim.

The list initially renders 80 results for speed. **Show more locations** reveals the next batch; the map and CSV include all matching records. **Shortlist** and **Visited** retain your active filters. If a saved location seems missing, clear search and the map-area restriction, and check the Evidence filter.

## What the records mean

The default **Current-source leads** filter includes facility evidence and directory leads. It describes the source category, not a promise that a plant is operating or that an owner is onsite. **Historical / unverified** registry records are hidden at startup and after resetting filters. Choose **All records, including historical** or **Historical / unverified** in the Evidence filter to see them. Removing the Current-source leads filter chip also exposes the full inventory.

| Field | Interpretation |
| --- | --- |
| Facility evidence | A facility-oriented source identifies the location. Regulatory inclusion or an active permit is not independent confirmation of present production. |
| Directory lead | A directory or licensing record suggests a manufacturing business. Some addresses are offices, home businesses, shared production sites, or other prospects needing verification. |
| Historical / unverified | A registry includes the facility, but current activity has not been established. |
| Employees | A reported value or range, with its scope shown below it. OSHA figures are annual average workers for the stated reporting year; Data Axle location counts may be estimates. Some reports cover multiple addresses or buildings; those totals are explicitly labeled and have an Uncertain size band. They are not necessarily today's staff count. Missing values mean not reported, not zero. |
| Staffing filters | A range matches a size band only if the whole range fits. Ranges crossing bands remain discoverable under **Uncertain band** or **Known headcount or range**. “Most employees” sorts a range by its lower bound. Company-level counts should not be treated as plant-level counts. |
| Reported owner | A source explicitly reports ownership. The name may be a legal entity rather than an individual. A president, manager, or other contact is not automatically considered an owner. |
| Reported business contact | A named source contact and role, when available. This person may not own the business or still hold the role. |
| Source status | The source's stated status. A directory verification, reporting year, active permit, or production license does not certify current occupancy. |
| Location precision | Provider coordinates and Census street interpolations are not verified entrances. Approximate pins need particular care; directions prefer the listed address. |
| Dataset date | The source dataset's snapshot date (`sources[].snapshot_date`), distinct from retrieval or an individual record update. None of these dates represents a physical visit. |

**About the data** describes the assembled inventory, source coverage, county counts, and limitations. Map and list totals reflect your current filters; county/industry option counts cover the full inventory. A merged location can belong to more than one source, so source counts are not additive.

This is a broad prospecting inventory, not an exhaustive census of operating plants. Small or unregulated manufacturers can be missing, directory coverage can be partial, and conservative deduplication can leave ambiguous or colocated records separate. Check a candidate's source details before committing to a long drive.

## Read the employee colors

| Employee size | Map and list treatment |
| --- | --- |
| 1–9 | Blue; smallest solid pin |
| 10–49 | Teal; medium solid pin |
| 50–249 | Orange; larger solid pin |
| 250+ | Purple; largest solid pin |
| Unknown | Gray diamond; headcount was not reported |
| Uncertain | Striped dark pin; a range crosses size bands, does not fit one band, or the reported total covers multiple addresses |
| 0 reported | Hollow gray pin; the source explicitly reported zero |

The same colors appear in list headcount chips and location details. Individual pin tooltips include the business name, reported count or range, and a text evidence label. Evidence categories remain separate neutral labels and filters; they do not determine pin color. The Uncertain and 0 reported legend buttons appear only when the inventory contains those categories.

An actual reported employee number takes precedence over a range, except when the source explicitly says that number covers multiple addresses. For example, **50 reported across multiple addresses** remains numeric in exports but is Uncertain on the map: it is not a known headcount for the individual building. A range such as **10–499** is Uncertain; **500+** belongs to 250+. A qualitative designation such as “Very Small” without a usable headcount stays Unknown. Missing data never becomes zero.

A cluster's center is the **number of locations**. Its ring shows the proportion of those locations in each employee band, including Unknown and Uncertain records. For example, two small plants, one large plant, and one unknown each contribute one location: their shares are 50%, 25%, and 25%. The ring does not add employee totals or calculate average staffing. Hover a cluster for the band counts; its accessible label provides the same breakdown. On a phone, tap the cluster to zoom in and use the legend to isolate a size.

Employee band filters and legend buttons follow the same boundaries, and preserve county, evidence, source, and other active filters. Exported CSVs include a derived `employee_band` alongside the original employee count/range, scope, and `headcount_multiple_addresses` flag. About the data reports numeric employee-count coverage and additional range-only coverage separately.

## Keep and move your notes

Shortlists, visit dates, and field notes save automatically to this browser's local storage. They are not synchronized between phones, computers, browsers, or private browsing sessions. HTTP and HTTPS addresses, different hostnames, and different ports also have separate storage.

To move or protect your work:

1. Open **About the data → Back up notes** on the device containing your notes and save the JSON file.
2. Transfer that file to the other device, open its map, and choose **About the data → Restore notes**.
3. Select the JSON backup. Restore merges records by stable location ID, keeping the more recently edited record when both devices contain the same ID. It does not combine the text of two independently edited notes.

**Export results** downloads a CSV of every currently matching location, including your notes and visit/shortlist flags. CSV is useful for reviewing or sharing a filtered list; the JSON notes backup is the format the app can restore. Back up before clearing browser data, switching map URLs, or replacing a device. If a rebuilt dataset changes a location's ID, existing notes may need to be reconciled with that record.

## Location and connectivity

Live phone location requires HTTPS and browser permission. The map-center pin remains usable when location is denied, unavailable, or the page is opened over HTTP. Location is refreshed on request rather than tracked continuously.

Map tiles need an internet connection. Once the page has loaded, its in-memory records and local notes can remain usable during a connection interruption, but this is not an offline map app: reloading requires the private server. Opening navigation sends the chosen destination to Google Maps or Apple Maps.

## Data contract

`plants.json` accepts an array (or `{plants: [...]}`). Each record should use:

```json
{
  "id": "stable-source-or-merged-id",
  "name": "Business name",
  "address": "Street address",
  "city": "City",
  "county": "County without suffix",
  "state": "CA",
  "zip": "90000",
  "latitude": null,
  "longitude": null,
  "industry": "Industry description",
  "naics": "31-33",
  "employees": null,
  "employee_range": null,
  "employee_scope": "plant, location, company, or source-qualified scope",
  "headcount_multiple_addresses": false,
  "owner_name": null,
  "owner_role": null,
  "contact_name": null,
  "contact_role": null,
  "phone": null,
  "website": null,
  "evidence_type": "facility_evidence",
  "operating_status": "unknown",
  "geocode_quality": "provider",
  "geocode_provider": "Source of coordinates",
  "source_name": "Dataset name",
  "source_url": "https://example.com/",
  "sources": [{"name": "Dataset name", "url": "https://example.com/", "record_id": "123", "snapshot_date": "2026-09-01", "retrieved_at": "2026-09-22"}],
  "dataset_date": null,
  "updated_at": null,
  "notes": null
}
```

Evidence types: `facility_evidence`, `directory_lead`, `historical_registry`. The UI's default `current` filter includes the first two types. Source filtering matches individual names in `sources[]`, including every source attached to merged records. `dataset_date` is retained as source metadata; the visible source date uses `sources[].snapshot_date`. `updated_at` is reserved for an actual record update when the source provides one.

Coordinates are optional; address-only records remain searchable and can open directions. Geocoding quality values should reflect the evidence: `rooftop`, `parcel`, `street`, `zip`, `city`, `provider`, or `unknown`. Do not guess owner identity from an executive title.

`coverage.json` accepts:

```json
{
  "generated_at": "2026-09-22T00:00:00Z",
  "description": "Actual scope and coverage of the assembled data.",
  "sources": [{"name": "Dataset", "url": "https://example.com/", "description": "Scope", "records": 0, "retrieved_at": "2026-09-22"}],
  "limitations": ["Explicit coverage, recency, and precision limits."]
}
```

Counts displayed in the UI are calculated from the loaded dataset, including county coverage and evidence categories. Dataset filenames remain relative, so the whole directory can be served at any private URL prefix.

## Map libraries

Leaflet 1.9.4 (BSD-2-Clause) and Leaflet.markercluster 1.5.3 (MIT) are vendored locally; see their license files in `vendor/`. Basemap tiles are provided by OpenStreetMap, with attribution displayed on the map. Marker updates use cancellable application-owned batches of 500 records so changing a filter cannot leave older batches on the map.

## Verification

From the repository root:

```sh
node --check research/plant-outreach-map/ui/app.js
node research/plant-outreach-map/qa/map-ui.test.cjs
```

The focused regression checks cover cancellation of old marker batches, complete rendering, selection filtering, safe contact links, source date precision, and driveable direction destinations. Employee-color tests cover exact boundaries, en-dash ranges, cross-band uncertainty, actual-value precedence, unknown versus zero, location-count cluster proportions, text labels, and contrast of the shared color tokens.

Check the actual dataset in a browser at desktop and mobile sizes before handoff. Key flows: current versus historical records; source, county, owner/contact, and staffing filters; a mapped and an address-only detail; nearest sorting; directions; shortlist/visited/notes after reload; CSV; and backup/restore. Browser QA also needs to cover rapid filter changes while markers load and text entry with the mobile keyboard open.
