# Notion Life Tracker (Val Town)

This repo contains Val Town-ready scripts that:
- fetch Notion entries for the last 7 days (UTC)
- send a weekly blood sugar rollup via email
- enrich food log entries with estimated macros and write them back to Notion

## What this does (plain language)

Think of this as two simple helpers:
- You write down blood sugar readings in Notion.
- Once a week, the script looks at the last 7 days and emails you a summary.
- You write down foods you ate in another Notion database.
- The food script estimates macros and fills them in.

## A tiny bit of computer science (friendly version)

Even though this feels simple, it uses a few classic CS ideas:
- **Data modeling:** you define what a “reading” is (date, time, value).
- **Filtering:** you only look at a specific window of time (last 7 days).
- **Aggregation:** you summarize many values into a few stats (avg/min/max).
- **Automation:** a scheduled job runs the same steps every week.

If you can build or understand this, you’re already practicing real CS thinking—just without the scary jargon.

## Praise Cage mode

This project includes playful, Praise Cage-themed badges:
- “Mandy-Mode Consistency”
- “Cage Match: Full Week”
- “Cage Match: Double-Check Champion”
- “National Treasure: Healthy Average”

You can rename or swap these in `collectors/blood_sugar_report.cron.tsx`.

## Medical disclaimer

This report is for informational purposes only and is not medical advice.
Healthy blood sugar ranges referenced here come from:
https://www.ynhhs.org/articles/what-is-healthy-blood-sugar

## 1) Create the Notion databases

### Blood Sugar Log

Create a new database in Notion (table view is easiest) with these properties:

- **Entry** (Title)
- **Created Time** (Created time) or **Created Time** (Text)
- **Measurement Date** (Date) (e.g., `January 13, 2026`)
- **Blood Sugar Level** (Number)

You can name the database anything (e.g., "Blood Sugar Log").

### Food Log (Macro Enrichment)

Create another Notion database with these properties (exact names expected):

- `food` (Title or Text)
- `Created time` (Created time)
- `calories` (Number)
- `protein` (Number)
- `carbs` (Number)
- `fats` (Number)
- `fiber` (Number)
- `sugar` (Number)
- `sodium` (Number)

Only `food` and `Created time` are required for reading. The rest are written by the val.

## 2) Create a Notion integration

1. Go to https://www.notion.so/my-integrations and create a new integration.
2. Copy the **Internal Integration Token**.
3. Open your database in Notion, click **Share**, and invite the integration.

### Database IDs
Open each database in the browser and copy the 32‑character ID in the URL.

## 3) Configure Val Town (CLI)

Create new Vals with the `vt` CLI, then sync from this repo:

```
vt create blood_sugar_report
vt create food_report
```

Replace each generated Val file with the corresponding script from this repo:
- `collectors/blood_sugar_report.cron.tsx`
- `collectors/food_report.cron.tsx`

Then push each Val:

```
vt push
```

### Secrets

Shared:
- `NOTION_TOKEN`

Blood sugar val:
- `NOTION_BLOOD_SUGAR_DB_ID`
- `REPORT_FROM_EMAIL` (optional, must be `your_username.valname@valtown.email`)
- `REPORT_FROM_NAME` (optional)
- `REPORT_REPLY_TO` (optional)

Food log val:
- `NOTION_FOOD_DB_ID`

Free tier note: the blood sugar val emails the account owner by default.

The food val uses Val Town's `std/openai` proxy with `gpt-5-nano`, so no OpenAI API key is required.

## 4) Schedule the report

In Val Town, schedule the Val to run weekly at 9:30am on Tuesdays (EST).

Suggested cron (set Val Town timezone to EST):
```
30 9 * * 2
```

### What the cron line means

Cron is a simple way to say “run this on a schedule.” It has five fields:

```
minute hour day-of-month month day-of-week
```

So `30 9 * * 2` means:
- minute = 30
- hour = 9
- day-of-month = * (every day of the month)
- month = * (every month)
- day-of-week = 2 (Tuesday)

In other words: every Tuesday at 9:30am.

## 5) Customize

- Adjust the stats, date range, or email formatting in `collectors/blood_sugar_report.cron.tsx`.
- If you prefer different property names, update them in the script.
- Weekly rollups for both categories are persisted to Val Town SQLite for monthly/quarterly summaries.

## Development

Run tests:
```
deno test --allow-import --reporter=dot
```

Run lint:
```
deno lint
```

Made with 🖖 by Paul Chin Jr. and Markal.
