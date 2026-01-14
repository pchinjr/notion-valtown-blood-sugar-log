# Notion Blood Sugar Weekly Rollup (Val Town)

This repo contains a Val Town-ready script that:
- queries a Notion database for the last 7 days of blood sugar entries (UTC date range)
- computes stats, streaks, XP, and badges (expected 2 per day)
- emails a friendly weekly rollup to your Val Town account (free tier friendly)

## What this does (plain language)

Think of this as a simple weekly helper:
- You write down blood sugar readings in Notion.
- Once a week, the script looks at the last 7 days of entries.
- It adds up your numbers to give you a quick summary.
- Then it emails that summary to you automatically.

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

You can rename or swap these in `notion_weekly_report.ts`.

## Medical disclaimer

This report is for informational purposes only and is not medical advice.
Healthy blood sugar ranges referenced here come from:
https://www.ynhhs.org/articles/what-is-healthy-blood-sugar

## 1) Create the Notion database

Create a new database in Notion (table view is easiest) with these properties:

- **Entry** (Title)
- **Created Time** (Created time) or **Created Time** (Text)
- **Measurement Date** (Date) (e.g., `January 13, 2026`)
- **Blood Sugar Level** (Number)

You can name the database anything (e.g., "Blood Sugar Log").

## 2) Create a Notion integration

1. Go to https://www.notion.so/my-integrations and create a new integration.
2. Copy the **Internal Integration Token**.
3. Open your database in Notion, click **Share**, and invite the integration.

### Database ID
Open the database in the browser and copy the 32‑character ID in the URL.

## 3) Configure Val Town

Create a new Val in Val Town and paste `notion_weekly_report.ts`.

Add these secrets in Val Town (Settings → Secrets):
- `NOTION_TOKEN`
- `NOTION_DATABASE_ID`
- `REPORT_FROM_EMAIL` (optional, must be `your_username.valname@valtown.email`)
- `REPORT_FROM_NAME` (optional)
- `REPORT_REPLY_TO` (optional)
 
Free tier note: this val emails the account owner by default.

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

- Adjust the stats, date range, or email formatting in `notion_weekly_report.ts`.
- If you prefer different property names, update them in the script.

Made with 🖖 by Paul Chin Jr. and Markal.
