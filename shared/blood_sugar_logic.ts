import {
  type NotionCreatedTimeProperty,
  type NotionDateProperty,
  type NotionNumberProperty,
  type NotionTextProperty,
} from "./notion.ts";

const XP_PER_ENTRY = 12;
const STREAK_BONUS_MULTIPLIER = 1.2;
const HEALTHY_AVG_BONUS_MULTIPLIER = 1.2;
const HEALTHY_AVG_THRESHOLD = 100;

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

export type GroupedEntries = {
  date: string;
  am: Entry[];
  pm: Entry[];
};

export function parseEntry(page: BloodSugarNotionPage): Entry | null {
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

export function hasPerfectWeekStreak(dateRange: string[], dateCounts: Record<string, number>): boolean {
  return dateRange.length >= 7 && dateRange.every((date) => (dateCounts[date] ?? 0) >= 2);
}

export function calculateXp(totalCount: number, avg: number, perfectWeekStreak: boolean): number {
  const baseXp = totalCount * XP_PER_ENTRY;
  if (baseXp === 0) return 0;
  const streakBonus = perfectWeekStreak ? STREAK_BONUS_MULTIPLIER : 1;
  const healthyAvgBonus = avg > 0 && avg < HEALTHY_AVG_THRESHOLD ? HEALTHY_AVG_BONUS_MULTIPLIER : 1;
  return Math.round(baseXp * streakBonus * healthyAvgBonus);
}

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

export function buildEncouragement(completionRate: number, streak: number): string {
  if (completionRate >= 90) return "Amazing work — you kept a near-perfect log this week.";
  if (completionRate >= 70) return "Great consistency — you’re building a strong habit.";
  if (completionRate >= 40) return "Nice progress — a few more check-ins will make this even stronger.";
  if (streak >= 3) return "You’re on a streak — keep it going!";
  return "Every entry helps — you’ve got this.";
}

export function groupEntriesByDate(entries: Entry[], dateRange: string[]): GroupedEntries[] {
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

export function formatGroupedEntryLine(group: GroupedEntries): string {
  const [first, second] = formatFirstSecondText(group);
  return `${group.date} | 1st: ${first} | 2nd: ${second}`;
}

export function isCreatedTimeProperty(value: unknown): value is NotionCreatedTimeProperty {
  return (
    !!value &&
    typeof value === "object" &&
    "created_time" in value &&
    typeof (value as { created_time?: unknown }).created_time === "string"
  );
}

export function isTextProperty(value: unknown): value is NotionTextProperty {
  return (
    !!value &&
    typeof value === "object" &&
    "rich_text" in value &&
    Array.isArray((value as { rich_text?: unknown }).rich_text)
  );
}

function getMeridiem(value: string | null): "AM" | "PM" | null {
  if (!value) return null;
  const match = value.match(/\b(AM|PM)\b/i);
  if (!match) return null;
  return match[1].toUpperCase() as "AM" | "PM";
}

function formatFirstSecondText(group: GroupedEntries): [string, string] {
  const ordered = orderEntries(group);
  if (!ordered.length) return ["—", "—"];
  const first = String(ordered[0].value);
  if (ordered.length === 1) return [first, "—"];
  const secondValue = String(ordered[1].value);
  const overflow = ordered.length > 2 ? ` (+${ordered.length - 2})` : "";
  return [first, `${secondValue}${overflow}`];
}

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
