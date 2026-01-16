export function getWeeklyRange(): { start: string; end: string } {
  const today = new Date();
  const end = toDateOnly(today);
  const startDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  startDate.setUTCDate(startDate.getUTCDate() - 6);
  const start = toDateOnly(startDate);
  return { start, end };
}

export function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function daysBetweenInclusive(start: string, end: string): number {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  const ms = endDate.getTime() - startDate.getTime();
  return Math.floor(ms / 86400000) + 1;
}

export function listDateRange(start: string, end: string): string[] {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  const dates: string[] = [];
  const cursor = new Date(startDate.getTime());
  while (cursor <= endDate) {
    dates.push(toDateOnly(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function countEntriesByDate<T extends { date: string }>(entries: T[]): Record<string, number> {
  return entries.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.date] = (acc[entry.date] ?? 0) + 1;
    return acc;
  }, {});
}

export function calculateCurrentStreak(dateRange: string[], dateCounts: Record<string, number>): number {
  let streak = 0;
  for (let i = dateRange.length - 1; i >= 0; i -= 1) {
    const date = dateRange[i];
    if ((dateCounts[date] ?? 0) > 0) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}
