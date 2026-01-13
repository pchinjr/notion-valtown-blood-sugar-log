import {
  buildBadges,
  buildEncouragement,
  calculateXp,
  calculateCurrentStreak,
  countEntriesByDate,
  formatCreatedTime,
  hasPerfectWeekStreak,
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
    { date: "2026-01-01", createdTime: null, value: 90 },
    { date: "2026-01-01", createdTime: null, value: 95 },
    { date: "2026-01-02", createdTime: null, value: 100 },
  ];
  assertEquals(countEntriesByDate(entries), { "2026-01-01": 2, "2026-01-02": 1 });
});

Deno.test("buildBadges awards consistency and healthy average", () => {
  const range = [
    "2026-01-01",
    "2026-01-02",
    "2026-01-03",
    "2026-01-04",
    "2026-01-05",
    "2026-01-06",
    "2026-01-07",
  ];
  const counts = {
    "2026-01-01": 2,
    "2026-01-02": 2,
    "2026-01-03": 2,
    "2026-01-04": 2,
    "2026-01-05": 2,
    "2026-01-06": 2,
    "2026-01-07": 2,
  };
  const badges = buildBadges(range, counts, 14, 95, true);
  assertEquals(badges.includes("Cage Match: Double-Check Champion"), true);
  assertEquals(badges.includes("National Treasure: Healthy Average"), true);
});

Deno.test("buildEncouragement returns positive message", () => {
  const message = buildEncouragement(85, 2);
  assertStringIncludes(message, "Great");
});

Deno.test("hasPerfectWeekStreak requires two entries per day", () => {
  const range = [
    "2026-01-01",
    "2026-01-02",
    "2026-01-03",
    "2026-01-04",
    "2026-01-05",
    "2026-01-06",
    "2026-01-07",
  ];
  const counts = {
    "2026-01-01": 2,
    "2026-01-02": 2,
    "2026-01-03": 2,
    "2026-01-04": 2,
    "2026-01-05": 2,
    "2026-01-06": 2,
    "2026-01-07": 1,
  };
  assertEquals(hasPerfectWeekStreak(range, counts), false);
});

Deno.test("calculateXp applies streak and healthy average bonuses", () => {
  const xp = calculateXp(14, 95, true);
  assertEquals(xp, 242);
});

Deno.test("formatCreatedTime extracts time from Notion-style string", () => {
  const formatted = formatCreatedTime("January 13, 2026 6:33 PM");
  assertEquals(formatted, "6:33 PM");
});

Deno.test("formatCreatedTime formats ISO timestamps", () => {
  const formatted = formatCreatedTime("2026-01-13T18:33:00.000Z");
  assertEquals(formatted, "6:33 PM");
});
