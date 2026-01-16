# Food Log Enrichment

This val pulls the last week of food log entries from Notion, estimates macros with OpenAI, and writes them back to the same database.

## Notion Database Setup

Create a Notion database with these properties (exact names expected):

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

## Required Environment Variables

Collector val (`collectors/food_report.cron.tsx`):

- `NOTION_TOKEN`
- `NOTION_FOOD_DB_ID`

## OpenAI Notes

The val uses `gpt-5-nano` via Val Town's `std/openai` proxy, so no API key is required.
