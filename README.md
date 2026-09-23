# Manufacturing route map

Public map: https://manufacturing-route-map.vercel.app

Mobile map for finding manufacturers by business, city, county, state or ZIP. Includes current-location centering, nearby-distance filters, employee-size colors, plant details, directions and short route planning. No login or private link is required.

The national inventory combines the existing California research with the supplied September 22, 2026 file of 542,407 manufacturing-classified facility candidates across all 50 states and Washington, DC. Current-source signals and historical records are distinguished. Historical records are hidden by default. This is not a complete census or independent verification of operating factories.

Current totals and coverage are in `data/coverage.json`; the national integration audit is in `data/national-import-audit.json`. The separately tracked Tracy region includes Tracy, Stockton, Livermore, Manteca, Lathrop, Brentwood, Ripon, Escalon, French Camp, Byron, Vernalis, Discovery Bay and Mountain House. Missing information remains unavailable. Owner portraits link to identified public sources, and regulatory contacts or legal entities are not assumed to be personal owners.

Strong same-site/source matches are consolidated while separate plants and contradictory suites are preserved. Uncertain duplicates remain flagged. Original observations and earlier business research are retained in each record's evidence. Existing location IDs and merge aliases preserve browser notes. Reviewed closures and relocations take precedence over incoming regulatory status flags.

Source coordinates that are administrative/postal centroids, outside broad state bounds, or explicitly less accurate than 1 km are withheld. Bulk Census address matching recovers usable points where possible. Interpolated locations are approximate and do not identify visitor entrances. Unresolved addresses remain searchable. Headcounts retain their source and reporting year; OSHA counts are annual establishment averages.

## Run checks and deploy

Requires Node.js 22+ and a Vercel account with access to `generalgc/manufacturing-route-map`.

```sh
npm run build
npm test
npx vercel@59.23.2 link --cwd deploy --project manufacturing-route-map --scope generalgc
npm run deploy
npm run verify
```

The build streams the ordered, hashed JSONL parts in `data/national/manifest.json`. It creates a server-side search index and on-demand detail batches. Phones receive bounded result pages and viewport clusters. Only allowlisted UI/metadata and read-only search/detail endpoints are served; internal index/batch paths are not public. See `deploy/NATIONAL.md` for the data contract and verification. The former `data/plants.json.gz` is retained only as a legacy fixture and is not the active national source.

The repository excludes library credentials, environment files, deployment tokens, raw acquisition archives, browser notes and Excel workbooks. Source evidence included in the public normalized records remains accessible through business details. Visit notes and shortlists stay in the user's browser.

`ui/` contains the app and bundled Leaflet dependencies. `data/` contains the compressed normalized snapshot and coverage report. `deploy/` contains the build, server, checks and deployment scripts. `qa/` contains map behavior regression tests.

Map tiles are supplied by OpenStreetMap and require an internet connection. Source-specific attribution remains in the app and records. No additional license to the underlying datasets is granted by this repository.
