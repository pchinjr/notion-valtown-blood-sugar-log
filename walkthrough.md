# Project Walkthrough (Step by Step)

This walkthrough summarizes how the Notion Life Tracker was built, in the order the pieces were added and refined.

## 1) Define the data model in Notion
- Created two databases: Blood Sugar Log and Food Log.
- Blood sugar properties: `Entry` (Title), `Created time` (Created time), `Blood Sugar Level` (Number).
- Food properties: `food` (Title/Text), `Created time` (Created time), plus macro fields like `calories`, `protein`, `carbs`, `fats`, `fiber`, `sugar`, `sodium`.

## 2) Add Notion integration and secrets
- Created a Notion integration, shared it with both databases.
- Stored secrets for Val Town:
  - `NOTION_TOKEN`
  - `NOTION_BLOOD_SUGAR_DB_ID`
  - `NOTION_FOOD_DB_ID`

## 3) Build Notion API helpers
- Implemented `shared/notion.ts` to query pages and update page properties.
- Added minimal Notion types and error handling for invalid responses.

## 4) Implement shared date utilities
- Implemented `shared/date.ts` for weekly ranges, date lists, and streak counts.
- Centralized UTC date logic for consistent weekly rollups.

## 5) Build blood sugar parsing + rollup logic
- Implemented `shared/blood_sugar_logic.ts`:
  - Parse Notion pages into normalized entries.
  - Group by date and compute weekly stats (avg/min/max, completion rate, streaks).
  - Render email-friendly summaries.
- Added XP and badge logic for motivational feedback.

## 6) Create the blood sugar weekly report
- Implemented `collectors/blood_sugar_report.cron.tsx`:
  - Query the last 7 days from Notion.
  - Build a summary report and send it via Val Town email.
  - Persist weekly rollups to SQLite.

## 7) Adjust date handling for local time
- Added timezone-aware date extraction for blood sugar entries (America/New_York).
- Prevented late-night readings from rolling into the next UTC day.

## 8) Build food parsing + enrichment core
- Implemented `shared/food_enrich.ts`:
  - Parse food entries and read existing macros from Notion.
  - Only enrich entries missing core macros.
  - Build update payloads for Notion.
  - Compute weekly food rollups and macro summaries.

## 9) Integrate FatSecret for nutrition data
- Implemented `shared/fatsecret.ts`:
  - OAuth token retrieval.
  - Food search and macro parsing from FatSecret responses.

## 10) Add the food report job
- Implemented `collectors/food_report.cron.tsx`:
  - Fetch weekly food entries.
  - Normalize food names with OpenAI.
  - Fetch nutrition data and write macros back to Notion.
  - Persist weekly rollups to SQLite.

## 11) Expand nutrition coverage
- Added fiber, sugar, and sodium parsing from FatSecret.
- Summed those fields across multi-item meals when all items provide values.

## 12) Improve FatSecret detail quality
- Added a `food.get` call to pull detailed nutrition data when available.
- Kept `food_description` parsing as a fallback.

## 13) Add serving size inference
- Updated OpenAI normalization to emit `{ name, servings }` per item.
- Scaled FatSecret macros by the inferred servings.
- Defaulted to one serving for typical meals (e.g., "shrimp lo mein").

## 14) Tighten type safety + linting
- Fixed TypeScript inference edge cases and unused params.
- Verified `deno lint` passes across the codebase.

## 15) Update documentation
- Clarified required Notion fields.
- Documented the OpenAI normalization + FatSecret detail workflow.
- Added serving size examples for clarity.
