import { buildUpsertWeeklyRollupQuery, type WeeklyRollup } from "../storage/rollups.ts";
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Ensures persistence overwrites by runId instead of inserting duplicates.
Deno.test("buildUpsertWeeklyRollupQuery uses INSERT OR REPLACE with runId", () => {
  const rollup: WeeklyRollup = {
    category: "food",
    periodStart: "2026-01-01",
    periodEnd: "2026-01-07",
    streak: 3,
    completionRate: 57,
    xp: 12,
    badges: ["A"],
    stats: { totalEntries: 4 },
    runId: "food-2026-01-01-2026-01-07",
  };
  const createdAt = "2026-01-08T00:00:00.000Z";
  const query = buildUpsertWeeklyRollupQuery(rollup, createdAt);
  assertEquals(query.sql.startsWith("INSERT OR REPLACE"), true);
  assertEquals(query.args[8], rollup.runId);
  assertEquals(query.args[9], createdAt);
});
