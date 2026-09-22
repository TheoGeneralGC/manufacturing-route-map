# Manufacturing route map

Public map: https://manufacturing-route-map.vercel.app

Mobile map for finding manufacturers by business, city, county or ZIP. Includes current-location centering, employee-size colors, plant details, directions and short route planning. No login or private link is required.

The September 22, 2026 snapshot contains 31,284 manufacturing prospect records across 39 Central Valley and surrounding California counties. Current-source and historical leads are distinguished. Coverage, headcounts, ownership and locations can be incomplete or uncertain; see each record's source details. This is not a complete census of operating plants.

The Tracy-region update covers 1,724 current-source leads across 13 towns: 1,003 have a reported plant employee count or range, 405 have a reported owner (including corporate owners), and 28 have direct owner-photo links. Tracy itself has 215 current-source leads, 133 with staffing, 57 with an owner, and five identified portrait links across four businesses. Supplemental company-wide counts are displayed separately. Photo links point to the original public sources.

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
