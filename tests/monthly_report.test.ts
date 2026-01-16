import {
  aggregateBloodSugarMonth,
  aggregateFoodMonth,
  resolveMonthRange,
  type Rollup,
} from "../shared/monthly_report.ts";
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Overlapping rollups should not double-count entries by date.
Deno.test("aggregateFoodMonth de-dupes overlapping entriesByDate", () => {
  const rollups: Rollup[] = [
    {
      category: "food",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-07",
      streak: 2,
      completionRate: 50,
      xp: 0,
      badges: [],
      stats: { entriesByDate: { "2026-01-02": 1 } },
      runId: "food-2026-01-01-2026-01-07",
    },
    {
      category: "food",
      periodStart: "2026-01-05",
      periodEnd: "2026-01-11",
      streak: 1,
      completionRate: 40,
      xp: 0,
      badges: [],
      stats: { entriesByDate: { "2026-01-02": 1, "2026-01-06": 2 } },
      runId: "food-2026-01-05-2026-01-11",
    },
  ];
  const summary = aggregateFoodMonth(rollups, "2026-01-01", "2026-01-31", {
    includePartialWeeks: true,
  });
  assertEquals(summary.entriesByDate["2026-01-02"], 1);
  assertEquals(summary.entriesByDate["2026-01-06"], 2);
  assertEquals(summary.totalEntries, 3);
});

// Monthly aggregation should compute weighted averages and totals.
Deno.test("aggregateBloodSugarMonth computes weighted average and totals", () => {
  const rollups: Rollup[] = [
    {
      category: "blood_sugar",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-07",
      streak: 3,
      completionRate: 70,
      xp: 120,
      badges: ["A"],
      stats: {
        entriesByDate: { "2026-01-01": 2 },
        avg: 90,
        min: 80,
        max: 110,
        totalEntries: 2,
      },
      runId: "blood_sugar-2026-01-01-2026-01-07",
    },
    {
      category: "blood_sugar",
      periodStart: "2026-01-08",
      periodEnd: "2026-01-14",
      streak: 1,
      completionRate: 50,
      xp: 60,
      badges: ["B"],
      stats: {
        entriesByDate: { "2026-01-08": 2 },
        avg: 110,
        min: 85,
        max: 130,
        totalEntries: 2,
      },
      runId: "blood_sugar-2026-01-08-2026-01-14",
    },
  ];
  const summary = aggregateBloodSugarMonth(rollups, "2026-01-01", "2026-01-31");
  assertEquals(summary.totalEntries, 4);
  assertEquals(summary.average, 100);
  assertEquals(summary.min, 80);
  assertEquals(summary.max, 130);
  assertEquals(summary.xp, 180);
});

Deno.test("resolveMonthRange defaults to previous month", () => {
  const now = new Date("2026-02-15T10:00:00.000Z");
  const range = resolveMonthRange(null, now);
  assertEquals(range.start, "2026-01-01");
  assertEquals(range.end, "2026-01-31");
});
