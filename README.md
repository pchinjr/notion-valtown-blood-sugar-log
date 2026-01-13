# Notion Blood Sugar Weekly Rollup (Val Town)

This repo contains a Val Town-ready script that:
- queries a Notion database for the last 7 days of blood sugar entries (UTC date range)
- computes simple stats (avg/min/max, count, missing entries, expected 2 per day)
- emails a weekly rollup to your Val Town account (free tier friendly)

## 1) Create the Notion database

Create a new database in Notion (table view is easiest) with these properties:

- **Entry** (Title)
- **Created Time** (Created time) or **Created Time** (Text)
- **Measurement Date** (Date) (e.g., `January 13, 2026`)
- **Blood Sugar Level** (Number)
- **Notes** (Text) (optional)

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
- `REPORT_TO` (optional; only set on Val Town Pro)

Free tier note: `REPORT_TO` must be omitted unless you are on Val Town Pro.

## 4) Schedule the report

In Val Town, schedule the Val to run weekly at 9:30am on Tuesdays (EST).

Suggested cron (set Val Town timezone to EST):
```
30 9 * * 2
```

## 5) Customize

- Adjust the stats, date range, or email formatting in `notion_weekly_report.ts`.
- If you prefer different property names, update them in the script.
