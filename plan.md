# Notion Life Tracker Plan

## What we've built so far

- A Notion database for blood sugar readings
- A Val Town script that pulls the last 7 days of entries
- Weekly stats with streaks, XP, and Praise Cage-themed badges
- A friendly email report sent on a schedule (free tier friendly)
- Tests for core logic (streaks, badges, XP)
- A SQLite rollup module stub for future storage
- A food log enricher that reads Notion entries, estimates macros with OpenAI, and writes them back
- Food enrichment now normalizes entries with OpenAI, infers serving sizes, and uses FatSecret's detailed nutrition
- Weekly rollups persisted to SQLite for blood sugar and food
- Monthly rollup report page with a month selector (Memphis-styled)

## Why this works well

- We only query Notion for a small time window (fast even as Notion grows)
- We compute the rollup once per week and send it as a summary
- We can reuse the same pattern for other life areas (exercise, meals, goals)

## Next step: extend rollup reporting

We store weekly rollups (badges, streaks, XP) in Val Town’s SQLite so we can:
- build monthly and yearly summaries without re-reading Notion
- compare across categories (e.g., blood sugar vs exercise)
- keep a long-term history even if we rename Notion pages

## Proposed storage shape

- `weekly_rollups`: one row per category per week
- `badge_events`: a history of badges earned

Each rollup stores:
- category (e.g., `blood_sugar`)
- period start/end (YYYY-MM-DD)
- streak, completion rate, XP
- badges as JSON
- summary stats as JSON

## How new trackers fit in

For each new Notion database:
1) Add a small “collector” val that maps entries into a shared event format.
2) Reuse the rollup logic and write weekly results to SQLite.
3) Generate emails or dashboards from the stored rollups.

This keeps the system simple while still scaling to many life areas.

## What's left to do

- Define XP/badge rule config so new trackers can reuse it
- Add yearly rollup report (from SQLite, not Notion)
- Add a sample “collector” val for another Notion database (e.g., exercise)
 - Add run_id generation strategy (UUID or deterministic) and document it
 - Validate email layout on Gmail mobile and adjust spacing if needed
- Add serving-size overrides and caching for food enrichment

## New feature: Val-scoped rollup workspace

The new **val-scoped SQLite databases** (see “Every val gets a database!”, Jan 23, 2026) let each val persist its own data with a built-in browser and forkable state. We can lean into this by turning every collector into a self-serve insights workspace that ships with its data. Key ideas:

- **Goal:** capture raw Notion snapshots + derived rollups inside the val-scoped DB so maintainers can inspect/patch rows via Val Town’s new DB UI and forks inherit the historical data.
- **Why now:** previously we used a shared `stevekrouse/sqlite` database, so tables mixed across vals and forks lost history. Scoped DBs fix isolation, give us point-in-time forks, and expose schema editing + CSV export without extra tooling.

### User stories
- As a maintainer, I can open the Val Town DB browser for `blood_sugar_report` and see weekly rollups + the raw Notion entries that fed them.
- When I fork the val, I can choose to fork the database so I get a sample dataset (perfect for demos/tests).
- I can alter or backfill rows right from the UI if a Notion entry was missing, then re-run the val and it reuses those edits.

### Technical plan
1. **Adopt the new client**
   - Introduce `storage/sqlite.ts` that re-exports `std/sqlite` so every module uses the scoped DB (no more `stevekrouse/sqlite` import).
   - Update `storage/rollups.ts`, `collectors/*.ts(x)`, and `services/monthly_report_page.http.tsx` to consume the new helper.
2. **Expand schema per val**
   - Add tables: `notion_entries` (raw JSON per sync run), `collector_runs` (metadata + errors), and keep the existing `weekly_rollups` / `badge_events`.
   - Ensure schema setup runs on every execution (idempotent `CREATE TABLE IF NOT EXISTS`).
3. **Persist richer data**
   - In collectors, before building reports, upsert `collector_runs` + `notion_entries` with the fetched payload, keyed by `run_id`.
   - Store derived stats/badges in `weekly_rollups` referencing the same `run_id`.
4. **Ship a DB-backed UI**
   - Add a new HTTP val (e.g., `services/rollup_workspace.http.tsx`) that queries the scoped DB and renders:
     - latest sync runs with status + row counts
     - raw entry drill-down (JSON pretty print) and weekly rollups
   - Provide download links that hit lightweight CSV/JSON routes backed by SQL queries (can reuse Val Town DB UI exports too).
5. **Migration + docs**
   - Write a one-off `scripts/migrate_shared_db.ts` to copy data from the legacy shared database into the val-scoped DB (optional but documented).
   - Update `readme.md` with “Using the val-scoped database” instructions (link to DB UI, how to fork with data, etc.).

### Open questions
- Do we need to keep writing to the old shared database for compatibility with the existing monthly report? (Probably no once UI + service switch to the scoped DB.)
- Should food + blood sugar share one val (single DB) or live in separate vals with their own scoped DBs? (Decide before migrating.)
- How much sample data should we ship when people fork the val—full history or a trimmed seed week?
