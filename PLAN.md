# Notion Life Tracker Plan

## What we've built so far

- A Notion database for blood sugar readings
- A Val Town script that pulls the last 7 days of entries
- Weekly stats with streaks, XP, and Praise Cage-themed badges
- A friendly email report sent on a schedule (free tier friendly)
- Tests for core logic (streaks, badges, XP)
- A SQLite rollup module stub for future storage

## Why this works well

- We only query Notion for a small time window (fast even as Notion grows)
- We compute the rollup once per week and send it as a summary
- We can reuse the same pattern for other life areas (exercise, meals, goals)

## Next step: store rollups in SQLite

We’ll store weekly rollups (badges, streaks, XP) in Val Town’s SQLite so we can:
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

## What’s left to do

- Wire the weekly report to write rollups into SQLite after each run
- Define XP/badge rule config so new trackers can reuse it
- Add monthly and yearly rollup reports (from SQLite, not Notion)
- Add a sample “collector” val for another Notion database (e.g., exercise)
 - Add run_id generation strategy (UUID or deterministic) and document it
 - Validate email layout on Gmail mobile and adjust spacing if needed
