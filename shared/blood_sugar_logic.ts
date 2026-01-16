import { calculateCurrentStreak, countEntriesByDate, listDateRange } from "./date.ts";
import {
  type NotionCreatedTimeProperty,
  type NotionDateProperty,
  type NotionNumberProperty,
  type NotionTextProperty,
} from "./notion.ts";

// Scoring constants for XP and bonuses.
const XP_PER_ENTRY = 12;
const STREAK_BONUS_MULTIPLIER = 1.2;
const HEALTHY_AVG_BONUS_MULTIPLIER = 1.2;
const HEALTHY_AVG_THRESHOLD = 100;

// Notion page shape and normalized entry types.
export type BloodSugarNotionPage = {
  id: string;
  properties: {
    "Measurement Date"?: NotionDateProperty;
    "Blood Sugar Level"?: NotionNumberProperty;
    "Created Time"?: NotionCreatedTimeProperty | NotionTextProperty;
  };
};

export type Entry = {
  date: string;
  createdTime: string | null;
  value: number;
};

export type BloodSugarRollup = {
  category: string;
  periodStart: string;
  periodEnd: string;
  streak: number;
  completionRate: number;
  xp: number;
  badges: string[];
  stats: {
    totalEntries: number;
    avg: number;
    min: number;
    max: number;
    entriesByDate: Record<string, number>;
    expected: number;
    missing: number;
  };
  runId: string;
};

export type GroupedEntries = {
  date: string;
  am: Entry[];
  pm: Entry[];
};

// Parse a Notion page into a normalized entry.
export function parseEntry(page: BloodSugarNotionPage): Entry | null {
  // Normalize a Notion page into the minimal shape used by the report.
  const props = page.properties ?? {};
  const date = props["Measurement Date"]?.date?.start ?? null;
  const value = props["Blood Sugar Level"]?.number ?? null;
  if (!date || typeof value !== "number") return null;

  const createdProp = props["Created Time"];
  const createdTimeRaw = isCreatedTimeProperty(createdProp)
    ? createdProp.created_time
    : isTextProperty(createdProp)
    ? createdProp.rich_text?.[0]?.plain_text ?? null
    : null;
  const createdTime = formatCreatedTime(createdTimeRaw);
  return { date: date.slice(0, 10), createdTime, value };
}

// Normalize various Notion "created time" formats into readable time strings.
export function formatCreatedTime(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const timeMatch = trimmed.match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
  if (timeMatch) {
    return timeMatch[1].toUpperCase().replace(/\s+/, " ");
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed;
  return parsed.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  });
}

// Perfect streak means 2+ readings per day for a full week.
export function hasPerfectWeekStreak(dateRange: string[], dateCounts: Record<string, number>): boolean {
  return dateRange.length >= 7 && dateRange.every((date) => (dateCounts[date] ?? 0) >= 2);
}

// XP is weighted by streak and healthy average bonuses.
export function calculateXp(totalCount: number, avg: number, perfectWeekStreak: boolean): number {
  const baseXp = totalCount * XP_PER_ENTRY;
  if (baseXp === 0) return 0;
  const streakBonus = perfectWeekStreak ? STREAK_BONUS_MULTIPLIER : 1;
  const healthyAvgBonus = avg > 0 && avg < HEALTHY_AVG_THRESHOLD ? HEALTHY_AVG_BONUS_MULTIPLIER : 1;
  return Math.round(baseXp * streakBonus * healthyAvgBonus);
}

// Build the weekly rollup stored in SQLite.
export function buildBloodSugarRollup(entries: Entry[], start: string, end: string): BloodSugarRollup {
  const values = entries.map((entry) => entry.value);
  const count = values.length;
  const avg = count ? Math.round((values.reduce((a, b) => a + b, 0) / count) * 10) / 10 : 0;
  const min = count ? Math.min(...values) : 0;
  const max = count ? Math.max(...values) : 0;

  const dateCounts = countEntriesByDate(entries);
  const dateRange = listDateRange(start, end);
  const expected = dateRange.length * 2;
  const missing = Math.max(0, expected - count);
  const completionRate = expected ? Math.round((count / expected) * 100) : 0;
  const currentStreak = calculateCurrentStreak(dateRange, dateCounts);
  const perfectWeekStreak = hasPerfectWeekStreak(dateRange, dateCounts);
  const badges = buildBadges(dateRange, dateCounts, count, avg, perfectWeekStreak);
  const xp = calculateXp(count, avg, perfectWeekStreak);

  return {
    category: "blood_sugar",
    periodStart: start,
    periodEnd: end,
    streak: currentStreak,
    completionRate,
    xp,
    badges,
    stats: {
      totalEntries: count,
      avg,
      min,
      max,
      entriesByDate: dateCounts,
      expected,
      missing,
    },
    runId: `blood_sugar-${start}-${end}`,
  };
}

// Decide which badges to award for the week.
export function buildBadges(
  _dateRange: string[],
  _dateCounts: Record<string, number>,
  totalCount: number,
  avg: number,
  perfectWeekStreak: boolean,
): string[] {
  const badges: string[] = [];
  if (totalCount >= 7) badges.push("Mandy-Mode Consistency");
  if (totalCount >= 14) badges.push("Cage Match: Full Week");
  if (perfectWeekStreak) badges.push("Cage Match: Double-Check Champion");
  if (avg > 0 && avg < HEALTHY_AVG_THRESHOLD) badges.push("National Treasure: Healthy Average");
  return badges;
}

// Short motivational copy for emails.
export function buildEncouragement(completionRate: number, streak: number): string {
  if (completionRate >= 90) return "Amazing work — you kept a near-perfect log this week.";
  if (completionRate >= 70) return "Great consistency — you’re building a strong habit.";
  if (completionRate >= 40) return "Nice progress — a few more check-ins will make this even stronger.";
  if (streak >= 3) return "You’re on a streak — keep it going!";
  return "Every entry helps — you’ve got this.";
}

// Group entries into a per-day AM/PM structure for reports.
export function groupEntriesByDate(entries: Entry[], dateRange: string[]): GroupedEntries[] {
  // Bucket entries by date and AM/PM for consistent report formatting.
  const buckets: Record<string, { am: Entry[]; pm: Entry[] }> = {};
  for (const date of dateRange) {
    buckets[date] = { am: [], pm: [] };
  }
  for (const entry of entries) {
    if (!buckets[entry.date]) {
      buckets[entry.date] = { am: [], pm: [] };
    }
    const meridiem = getMeridiem(entry.createdTime);
    if (meridiem === "AM") {
      buckets[entry.date].am.push(entry);
    } else if (meridiem === "PM") {
      buckets[entry.date].pm.push(entry);
    } else {
      buckets[entry.date].pm.push(entry);
    }
  }
  return dateRange.map((date) => ({
    date,
    am: buckets[date]?.am ?? [],
    pm: buckets[date]?.pm ?? [],
  }));
}

// Format a single line of the daily summary table.
export function formatGroupedEntryLine(group: GroupedEntries): string {
  const [first, second] = formatFirstSecondText(group);
  return `${group.date} | 1st: ${first} | 2nd: ${second}`;
}

// Type guard for Notion created_time fields.
export function isCreatedTimeProperty(value: unknown): value is NotionCreatedTimeProperty {
  return (
    !!value &&
    typeof value === "object" &&
    "created_time" in value &&
    typeof (value as { created_time?: unknown }).created_time === "string"
  );
}

// Type guard for Notion rich_text fields.
export function isTextProperty(value: unknown): value is NotionTextProperty {
  return (
    !!value &&
    typeof value === "object" &&
    "rich_text" in value &&
    Array.isArray((value as { rich_text?: unknown }).rich_text)
  );
}

// Extract AM/PM from a time string if possible.
function getMeridiem(value: string | null): "AM" | "PM" | null {
  if (!value) return null;
  const match = value.match(/\b(AM|PM)\b/i);
  if (!match) return null;
  return match[1].toUpperCase() as "AM" | "PM";
}

// Pick the first two readings (with an overflow indicator).
function formatFirstSecondText(group: GroupedEntries): [string, string] {
  const ordered = orderEntries(group);
  if (!ordered.length) return ["—", "—"];
  const first = String(ordered[0].value);
  if (ordered.length === 1) return [first, "—"];
  const secondValue = String(ordered[1].value);
  const overflow = ordered.length > 2 ? ` (+${ordered.length - 2})` : "";
  return [first, `${secondValue}${overflow}`];
}

// Order entries by time when present (unknown times go last).
function orderEntries(group: GroupedEntries): Entry[] {
  const combined = [...group.am, ...group.pm];
  return combined.sort((a, b) => {
    const aMinutes = parseTimeToMinutes(a.createdTime);
    const bMinutes = parseTimeToMinutes(b.createdTime);
    if (aMinutes === null && bMinutes === null) return 0;
    if (aMinutes === null) return 1;
    if (bMinutes === null) return -1;
    return aMinutes - bMinutes;
  });
}

// Convert "h:mm AM/PM" into minutes since midnight.
function parseTimeToMinutes(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3].toUpperCase();
  if (meridiem === "PM" && hours < 12) hours += 12;
  if (meridiem === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}
