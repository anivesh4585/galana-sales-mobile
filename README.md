# Galana Sales – Offline Sales Reporting Prototype

CSV → snapshot builder (validate + reconcile) → SQLite snapshot → React app (login, role/location scope in SQL,
dashboard, locations, products, customers, report, snapshot import with rollback) → automated tests.

## Run (Node 20+)
    npm install
    npm run snapshot     # validates sample-data/*.csv, builds public/galana_snapshot.sqlite
    npm test             # 19 automated tests (screenshot = test evidence)
    npm run dev          # open http://localhost:5173

## Demo users
| User | Password | Access |
|---|---|---|
| EXEC01 | exec123 | Executive – all data |
| MBA01 | mba123 | Depot manager – Mombasa Depot only |
| NBO01 | nbo123 | Regional manager – Nairobi region (2 stations) |
| OLD01 | old123 | Inactive – login denied |

## Layout
- sample-data/   CSV inputs (change them, run `npm run snapshot`, restart/reset snapshot in Data tab)
- scripts/       build-snapshot.ts – validation, SQLite build, reconciliation
- src/repo.ts    repository layer: scope predicate built into every SQL query, login, Location 360
- src/db.ts      snapshot open/validate/import (integrity_check, tables, schema version)
- src/App.tsx    screens (Galana brand UI: red #EA1C26 / blue #1A25AB, logo in public/galana-logo.png)
- src/repo.test.ts  golden totals, authorization, reconciliation, login, validation tests

## Golden numbers (workbook sample, 1-2 Sep 2026)
All 4,095,000 · Mombasa 3,935,000 · Nairobi West 160,000 · Fuel 3,935,000 · Lubricants 160,000.
Full sample: Sep total 7,013,000 · Mombasa Sep 4,022,000.

## SAP mapping
| App object | S/4HANA source |
|---|---|
| fact_sales | VBRK/VBRP or I_BillingDocumentItem |
| net_value / discount | VBRP-NETWR, pricing conditions (PRCD_ELEMENTS) |
| dim_location | T001W (plant), region via T005U |
| dim_product | MARA, MAKT, category via MATKL/PRODH |
| dim_customer | KNA1 / KNVV (I_Customer) |
| user / scope | PFCG role + auth object ZGAL_LOC (WERKS) |

CDS: ZI_GalanaSalesItem, ZI_GalanaLocation, ZI_GalanaProduct, ZI_GalanaCustomer, ZC_GalanaSalesCube (#CUBE)
with a DCL role on ZGAL_LOC/WERKS. DCL == the scope() function in src/repo.ts.

## Screenshots checklist
1. `npm test` all passing  2. EXEC01 Home vs MBA01 Home  3. MBA01 Locations (Mombasa only)
4. NBO01 Locations (2 Nairobi stations)  5. Products / Customers / Report with PASS line
6. Data tab: import a non-snapshot file renamed .sqlite -> "IMPORT REJECTED… previous snapshot still active"

## Not in scope
Native React Native build, cloud AI, encrypted SQLite (repository/SQL code is reusable in React Native).
