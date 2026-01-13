import { sqlite } from "https://esm.town/v/stevekrouse/sqlite";

const WEEKLY_ROLLUPS_TABLE = "weekly_rollups_1";
const BADGE_EVENTS_TABLE = "badge_events_1";

export type WeeklyRollup = {
  category: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  streak: number;
  completionRate: number;
  xp: number;
  badges: string[];
  stats: Record<string, unknown>;
};

export type BadgeEvent = {
  category: string;
  badge: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  awardedAt: string; // ISO timestamp
  reason?: string;
};

export async function initRollupSchema() {
  await sqlite.execute(`CREATE TABLE IF NOT EXISTS ${WEEKLY_ROLLUPS_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    streak INTEGER NOT NULL,
    completion_rate REAL NOT NULL,
    xp INTEGER NOT NULL,
    badges_json TEXT NOT NULL,
    stats_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(category, period_start)
  )`);

  await sqlite.execute(`CREATE TABLE IF NOT EXISTS ${BADGE_EVENTS_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    badge TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    awarded_at TEXT NOT NULL,
    reason TEXT
  )`);
}

export async function upsertWeeklyRollup(rollup: WeeklyRollup) {
  const createdAt = new Date().toISOString();
  await sqlite.execute(
    `INSERT OR REPLACE INTO ${WEEKLY_ROLLUPS_TABLE} (
      category,
      period_start,
      period_end,
      streak,
      completion_rate,
      xp,
      badges_json,
      stats_json,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      rollup.category,
      rollup.periodStart,
      rollup.periodEnd,
      rollup.streak,
      rollup.completionRate,
      rollup.xp,
      JSON.stringify(rollup.badges),
      JSON.stringify(rollup.stats),
      createdAt,
    ],
  );
}

export async function insertBadgeEvents(events: BadgeEvent[]) {
  for (const event of events) {
    await sqlite.execute(
      `INSERT INTO ${BADGE_EVENTS_TABLE} (
        category,
        badge,
        period_start,
        period_end,
        awarded_at,
        reason
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        event.category,
        event.badge,
        event.periodStart,
        event.periodEnd,
        event.awardedAt,
        event.reason ?? null,
      ],
    );
  }
}

export async function getWeeklyRollups(category: string, start: string, end: string) {
  const result = await sqlite.execute(
    `SELECT * FROM ${WEEKLY_ROLLUPS_TABLE}
     WHERE category = ?
     AND period_start >= ?
     AND period_end <= ?
     ORDER BY period_start ASC`,
    [category, start, end],
  );
  return result.rows;
}
