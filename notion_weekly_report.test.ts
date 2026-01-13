import {
  buildBadges,
  buildEncouragement,
  calculateCurrentStreak,
  countEntriesByDate,
  listDateRange,
  type Entry,
} from "./notion_weekly_report.ts";
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("listDateRange returns inclusive dates", () => {
  const dates = listDateRange("2026-01-01", "2026-01-03");
  assertEquals(dates, ["2026-01-01", "2026-01-02", "2026-01-03"]);
});

Deno.test("calculateCurrentStreak counts trailing days with entries", () => {
  const range = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"];
  const counts = { "2026-01-02": 1, "2026-01-03": 2, "2026-01-04": 1 };
  const streak = calculateCurrentStreak(range, counts);
  assertEquals(streak, 3);
});

Deno.test("calculateCurrentStreak stops at first missing day", () => {
  const range = ["2026-01-01", "2026-01-02", "2026-01-03"];
  const counts = { "2026-01-01": 1, "2026-01-03": 1 };
  const streak = calculateCurrentStreak(range, counts);
  assertEquals(streak, 1);
});

Deno.test("countEntriesByDate aggregates by date", () => {
  const entries: Entry[] = [
    { date: "2026-01-01", createdTime: null, value: 90, notes: null },
    { date: "2026-01-01", createdTime: null, value: 95, notes: null },
    { date: "2026-01-02", createdTime: null, value: 100, notes: null },
  ];
  assertEquals(countEntriesByDate(entries), { "2026-01-01": 2, "2026-01-02": 1 });
});

Deno.test("buildBadges awards consistency and healthy average", () => {
  const range = ["2026-01-01", "2026-01-02", "2026-01-03"];
  const counts = { "2026-01-01": 2, "2026-01-02": 2, "2026-01-03": 2 };
  const badges = buildBadges(range, counts, 6, 95);
  assertEquals(badges.includes("Twice a Day Champ"), true);
  assertEquals(badges.includes("Healthy Average (≤ 99 mg/dL)"), true);
});

Deno.test("buildEncouragement returns positive message", () => {
  const message = buildEncouragement(85, 2);
  assertStringIncludes(message, "Great");
});
