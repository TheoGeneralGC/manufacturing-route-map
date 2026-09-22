# Manufacturing route map

Public map: https://manufacturing-route-map.vercel.app

Mobile map for finding manufacturers by business, city, county or ZIP. Includes current-location centering, employee-size colors, plant details, directions and short route planning. No login or private link is required.

The September 22, 2026 snapshot contains 31,310 manufacturing prospect records across 39 Central Valley and surrounding California counties. Current-source and historical leads are distinguished. Coverage, headcounts, ownership and locations can be incomplete or uncertain; see each record's source details. This is not a complete census of operating plants.

The Tracy region contains 1,745 current-source location leads across Tracy, Stockton, Livermore, Manteca, Lathrop, Brentwood, Ripon, Escalon, French Camp, Byron, Vernalis, Discovery Bay and Mountain House. Tracy itself has 224 current-source leads. These include both facility evidence and unverified directory leads. Current totals, employee coverage and separately classified owner/portrait coverage are in `data/coverage.json`. Missing information remains blank; photo links point to identified public sources.

The latest expansion added 28 locations (27 in the region plus Tiger Precision's current Lodi site), enriched 28 existing records, merged two same-site duplicates and moved five former manufacturing records to the historical layer. It screened USDA/CDPH processor batches, chambers and industry directories, then checked company production descriptions. Conflicting addresses, phased production starts and uncertain staffing remain labeled in the individual records.

The regional pass reviewed all 930 profiles returned by 344 EDD county/industry searches, then corrected duplicate and non-manufacturing records. It is not independent confirmation of every directory listing. See `data/tracy-region-audit.json` for measured coverage and acquisition checks.

## Run checks and deploy

Requires Node.js 22+ and a Vercel account with access to `generalgc/manufacturing-route-map`.

```sh
npm run build
npm test
npx vercel@59.23.2 link --cwd deploy --project manufacturing-route-map --scope generalgc
npm run deploy
npm run verify
```

The build expands the compressed dataset into 13 bounded gzip response chunks and packages the UI for a Node.js Vercel function. Only allowlisted UI/data paths are served. The repository excludes library credentials, environment files, deployment tokens, raw source exports, browser notes and Excel workbooks. Visit notes and shortlists stay in the user's browser.

`ui/` contains the app and bundled Leaflet dependencies. `data/` contains the compressed normalized snapshot and coverage report. `deploy/` contains the build, server, checks and deployment scripts. `qa/` contains map behavior regression tests.

Map tiles are supplied by OpenStreetMap and require an internet connection. Source-specific attribution remains in the app and records. No additional license to the underlying datasets is granted by this repository.
