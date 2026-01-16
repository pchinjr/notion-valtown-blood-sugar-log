import { calculateCurrentStreak, listDateRange } from "./date.ts";

export type Rollup = {
  category: string;
  periodStart: string;
  periodEnd: string;
  streak: number;
  completionRate: number;
  xp: number;
  badges: string[];
  stats: Record<string, unknown>;
  runId: string;
};

export type MonthlySummary = {
  monthStart: string;
  monthEnd: string;
  rollupsIncluded: number;
};

export type BloodSugarMonthlySummary = MonthlySummary & {
  totalEntries: number;
  average: number;
  min: number;
  max: number;
  completionRate: number;
  streak: number;
  xp: number;
  badges: string[];
  entriesByDate: Record<string, number>;
};

export type FoodMacroStats = {
  count: number;
  total: number;
  avg: number;
};

export type FoodMonthlySummary = MonthlySummary & {
  totalEntries: number;
  uniqueDays: number;
  avgEntriesPerDay: number;
  minEntriesPerDay: number;
  maxEntriesPerDay: number;
  completionRate: number;
  streak: number;
  macroSummary: Record<string, FoodMacroStats>;
  entriesByDate: Record<string, number>;
};

type FoodStatsShape = {
  entriesByDate?: Record<string, number>;
  macroSummary?: Record<string, FoodMacroStats>;
  totalEntries?: number;
};

type BloodSugarStatsShape = {
  entriesByDate?: Record<string, number>;
  avg?: number;
  min?: number;
  max?: number;
  totalEntries?: number;
};

export function aggregateBloodSugarMonth(
  rollups: Rollup[],
  monthStart: string,
  monthEnd: string,
  options: { includePartialWeeks?: boolean } = {},
): BloodSugarMonthlySummary {
  // Default to full-week rollups to avoid double counting across overlaps.
  const dateRange = listDateRange(monthStart, monthEnd);
  const filtered = filterRollups(rollups, monthStart, monthEnd, options.includePartialWeeks ?? false);
  const entriesByDate = mergeEntriesByDate(filtered, monthStart, monthEnd);
  const totalEntries = sumValues(entriesByDate);

  // Use weighted average and min/max across weeks that are fully included.
  let weightedSum = 0;
  let weightedCount = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let xp = 0;
  const badgeSet = new Set<string>();

  for (const rollup of filtered) {
    const stats = (rollup.stats ?? {}) as BloodSugarStatsShape;
    const count = stats.totalEntries ?? 0;
    if (typeof stats.avg === "number" && count > 0) {
      weightedSum += stats.avg * count;
      weightedCount += count;
    }
    if (typeof stats.min === "number") min = Math.min(min, stats.min);
    if (typeof stats.max === "number") max = Math.max(max, stats.max);
    xp += rollup.xp;
    for (const badge of rollup.badges ?? []) badgeSet.add(badge);
  }

  const average = weightedCount ? Number((weightedSum / weightedCount).toFixed(1)) : 0;
  const resolvedMin = Number.isFinite(min) ? min : 0;
  const resolvedMax = Number.isFinite(max) ? max : 0;
  const expected = dateRange.length * 2;
  const completionRate = expected ? Math.round((totalEntries / expected) * 100) : 0;
  const streak = calculateCurrentStreak(dateRange, entriesByDate);

  return {
    monthStart,
    monthEnd,
    rollupsIncluded: filtered.length,
    totalEntries,
    average,
    min: resolvedMin,
    max: resolvedMax,
    completionRate,
    streak,
    xp,
    badges: Array.from(badgeSet),
    entriesByDate,
  };
}

export function aggregateFoodMonth(
  rollups: Rollup[],
  monthStart: string,
  monthEnd: string,
  options: { includePartialWeeks?: boolean } = {},
): FoodMonthlySummary {
  const dateRange = listDateRange(monthStart, monthEnd);
  const filtered = filterRollups(rollups, monthStart, monthEnd, options.includePartialWeeks ?? false);
  const entriesByDate = mergeEntriesByDate(filtered, monthStart, monthEnd);
  const totalEntries = sumValues(entriesByDate);
  const uniqueDays = Object.values(entriesByDate).filter((count) => count > 0).length;
  const avgEntriesPerDay = dateRange.length ? Number((totalEntries / dateRange.length).toFixed(2)) : 0;
  const minEntriesPerDay = dateRange.length
    ? Math.min(...dateRange.map((date) => entriesByDate[date] ?? 0))
    : 0;
  const maxEntriesPerDay = dateRange.length
    ? Math.max(...dateRange.map((date) => entriesByDate[date] ?? 0))
    : 0;
  const completionRate = dateRange.length ? Math.round((uniqueDays / dateRange.length) * 100) : 0;
  const streak = calculateCurrentStreak(dateRange, entriesByDate);
  const macroSummary = aggregateMacroSummary(filtered);

  return {
    monthStart,
    monthEnd,
    rollupsIncluded: filtered.length,
    totalEntries,
    uniqueDays,
    avgEntriesPerDay,
    minEntriesPerDay,
    maxEntriesPerDay,
    completionRate,
    streak,
    macroSummary,
    entriesByDate,
  };
}

export function resolveMonthRange(monthParam?: string | null, now = new Date()) {
  if (monthParam) {
    const match = monthParam.match(/^(\d{4})-(\d{2})$/);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]) - 1;
      const start = new Date(Date.UTC(year, month, 1));
      const end = new Date(Date.UTC(year, month + 1, 0));
      return { start: formatDate(start), end: formatDate(end) };
    }
  }
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return { start: formatDate(start), end: formatDate(end) };
}

function filterRollups(
  rollups: Rollup[],
  monthStart: string,
  monthEnd: string,
  includePartialWeeks: boolean,
) {
  return rollups.filter((rollup) => {
    if (includePartialWeeks) {
      return rollup.periodStart <= monthEnd && rollup.periodEnd >= monthStart;
    }
    return rollup.periodStart >= monthStart && rollup.periodEnd <= monthEnd;
  });
}

function mergeEntriesByDate(rollups: Rollup[], monthStart: string, monthEnd: string) {
  const entriesByDate: Record<string, number> = {};
  for (const rollup of rollups) {
    const stats = rollup.stats as FoodStatsShape | BloodSugarStatsShape;
    const entries = stats.entriesByDate ?? {};
    for (const [date, count] of Object.entries(entries)) {
      if (date < monthStart || date > monthEnd) continue;
      const current = entriesByDate[date];
      // When rollups overlap, prefer the larger count for a given day.
      entriesByDate[date] = current === undefined ? count : Math.max(current, count);
    }
  }
  return entriesByDate;
}

function aggregateMacroSummary(rollups: Rollup[]) {
  const summary: Record<string, FoodMacroStats> = {};
  for (const rollup of rollups) {
    const stats = rollup.stats as FoodStatsShape;
    const macroSummary = stats.macroSummary ?? {};
    for (const [key, value] of Object.entries(macroSummary)) {
      const existing = summary[key] ?? { count: 0, total: 0, avg: 0 };
      existing.count += value.count ?? 0;
      existing.total += value.total ?? 0;
      existing.avg = existing.count ? Number((existing.total / existing.count).toFixed(2)) : 0;
      summary[key] = existing;
    }
  }
  return summary;
}

function sumValues(record: Record<string, number>) {
  return Object.values(record).reduce((sum, value) => sum + value, 0);
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}
