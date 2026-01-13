import { email } from "https://esm.town/v/std/email";

const NOTION_VERSION = "2022-06-28";
const XP_PER_ENTRY = 12;
const STREAK_BONUS_MULTIPLIER = 1.2;
const HEALTHY_AVG_BONUS_MULTIPLIER = 1.2;
const HEALTHY_AVG_THRESHOLD = 100;

export type NotionRichText = { plain_text: string };
export type NotionDateProperty = { date: { start: string } | null };
export type NotionNumberProperty = { number: number | null };
export type NotionTextProperty = { rich_text: NotionRichText[] };
export type NotionCreatedTimeProperty = { created_time: string };

export type NotionPage = {
  properties: {
    "Measurement Date"?: NotionDateProperty;
    "Blood Sugar Level"?: NotionNumberProperty;
    "Created Time"?: NotionCreatedTimeProperty | NotionTextProperty;
  };
};

export type NotionQueryResponse = {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
};

export type Entry = {
  date: string;
  createdTime: string | null;
  value: number;
};

export default async function handler(): Promise<Response> {
  const notionConfig = getNotionConfig();
  const emailConfig = getEmailConfig();

  if (!notionConfig) {
    return new Response("Missing required secrets.", { status: 500 });
  }

  // Use a fixed 7-day range ending today (UTC) for weekly rollups.
  const { start, end } = getWeeklyRange();
  console.log(`Weekly range: ${start} to ${end}`);
  const entries = await fetchEntries(start, end, notionConfig);
  console.log(`Fetched ${entries.length} entries from Notion`);
  const report = buildReport(entries, start, end);
  console.log("Report subject:", report.subject);
  console.log("Sending email to Val Town account owner (free tier default).");

  // Build the payload to match Val Town's std/email expectations.
  const emailPayload = {
    subject: report.subject,
    text: report.text,
    html: report.html,
    ...(buildFrom(emailConfig?.fromEmail, emailConfig?.fromName) ?? {}),
    ...(emailConfig?.replyTo ? { replyTo: emailConfig.replyTo } : {}),
  };

  await email(emailPayload);
  console.log("Email sent.");

  return new Response("Weekly report sent.", { status: 200 });
}

function buildFrom(email?: string | null, name?: string | null) {
  if (!email) return null;
  return {
    from: name ? { email, name } : { email },
  };
}

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

type NotionConfig = {
  token: string;
  databaseId: string;
};

type EmailConfig = {
  fromEmail?: string;
  fromName?: string;
  replyTo?: string;
};

function getNotionConfig(): NotionConfig | null {
  const token = Deno.env.get("NOTION_TOKEN");
  const databaseId = Deno.env.get("NOTION_DATABASE_ID");
  if (!token || !databaseId) return null;
  return { token, databaseId };
}

function getEmailConfig(): EmailConfig | null {
  const fromEmail = Deno.env.get("REPORT_FROM_EMAIL") ?? undefined;
  const fromName = Deno.env.get("REPORT_FROM_NAME") ?? undefined;
  const replyTo = Deno.env.get("REPORT_REPLY_TO") ?? undefined;
  if (!fromEmail && !fromName && !replyTo) return null;
  return { fromEmail, fromName, replyTo };
}

export async function fetchEntries(
  start: string,
  end: string,
  notionConfig: NotionConfig,
): Promise<Entry[]> {
  const url = `https://api.notion.com/v1/databases/${notionConfig.databaseId}/query`;
  const headers = {
    Authorization: `Bearer ${notionConfig.token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };

  const entries: Entry[] = [];
  let cursor: string | null | undefined;

  do {
    // Query by Measurement Date in the selected range, sorted ascending.
    const body = {
      filter: {
        and: [
          { property: "Measurement Date", date: { on_or_after: start } },
          { property: "Measurement Date", date: { on_or_before: end } },
        ],
      },
      sorts: [{ property: "Measurement Date", direction: "ascending" }],
      start_cursor: cursor,
    };

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Notion query failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as unknown;
    if (!isNotionQueryResponse(data)) {
      throw new Error("Notion query returned unexpected shape.");
    }
    for (const page of data.results) {
      const entry = parseEntry(page);
      if (entry) entries.push(entry);
    }

    cursor = data.has_more && data.next_cursor ? data.next_cursor : undefined;
  } while (cursor);

  return entries;
}

export function parseEntry(page: NotionPage): Entry | null {
  const props = page.properties ?? {};
  const date = props["Measurement Date"]?.date?.start ?? null;
  const value = props["Blood Sugar Level"]?.number ?? null;
  if (!date || typeof value !== "number") return null;

  // "Created Time" can be a Created time field or a text property.
  const createdProp = props["Created Time"];
  const createdTimeRaw = isCreatedTimeProperty(createdProp)
    ? createdProp.created_time
    : isTextProperty(createdProp)
    ? createdProp.rich_text?.[0]?.plain_text ?? null
    : null;
  const createdTime = formatCreatedTime(createdTimeRaw);
  return { date: date.slice(0, 10), createdTime, value };
}

export function buildReport(entries: Entry[], start: string, end: string) {
  // Summary stats for the weekly rollup.
  const values = entries.map((entry) => entry.value);
  const count = values.length;
  const avg = count ? Math.round((values.reduce((a, b) => a + b, 0) / count) * 10) / 10 : 0;
  const min = count ? Math.min(...values) : 0;
  const max = count ? Math.max(...values) : 0;

  // Expect 2 entries per day unless you decide otherwise.
  const days = daysBetweenInclusive(start, end);
  const expected = days * 2;
  const missing = Math.max(0, expected - count);
  const dateCounts = countEntriesByDate(entries);
  const dateRange = listDateRange(start, end);
  const currentStreak = calculateCurrentStreak(dateRange, dateCounts);
  const perfectWeekStreak = hasPerfectWeekStreak(dateRange, dateCounts);
  const completionRate = expected ? Math.round((count / expected) * 100) : 0;
  const badges = buildBadges(dateRange, dateCounts, count, avg, perfectWeekStreak);
  const encouragement = buildEncouragement(completionRate, currentStreak);
  const disclaimer =
    "Not medical advice. Educational info only. Source: https://www.ynhhs.org/articles/what-is-healthy-blood-sugar";
  const xp = calculateXp(count, avg, perfectWeekStreak);

  const subject = `Blood Sugar Weekly Rollup (${start} → ${end})`;

  const lines = [
    `Range: ${start} to ${end}`,
    `Entries: ${count} (expected ${expected}, missing ${missing})`,
    `Average: ${avg}`,
    `Min: ${min}`,
    `Max: ${max}`,
    `Completion: ${completionRate}%`,
    `Current streak: ${currentStreak} day${currentStreak === 1 ? "" : "s"}`,
    `Perfect week streak: ${perfectWeekStreak ? "Yes" : "No"}`,
    `XP earned: ${xp}`,
    `Badges: ${badges.length ? badges.join(", ") : "No badges yet"}`,
    `Encouragement: ${encouragement}`,
    `Disclaimer: ${disclaimer}`,
    "",
    "Entries:",
    ...entries.map(formatEntryLine),
  ];

  const text = lines.join("\n");
  const html = renderHtmlReport(entries, {
    start,
    end,
    count,
    expected,
    missing,
    avg,
    min,
    max,
    completionRate,
    currentStreak,
    badges,
    encouragement,
    disclaimer,
    xp,
    perfectWeekStreak,
  });

  return { subject, text, html };
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

export function countEntriesByDate(entries: Entry[]): Record<string, number> {
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
  dateRange: string[],
  dateCounts: Record<string, number>,
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

export function formatEntryLine(entry: Entry): string {
  const time = entry.createdTime ? ` (${entry.createdTime})` : "";
  return `${entry.date}${time}: ${entry.value}`;
}

export function renderHtmlReport(
  entries: Entry[],
  stats: {
    start: string;
    end: string;
    count: number;
    expected: number;
    missing: number;
    avg: number;
    min: number;
    max: number;
    completionRate: number;
    currentStreak: number;
    badges: string[];
    encouragement: string;
    disclaimer: string;
    xp: number;
    perfectWeekStreak: boolean;
  },
): string {
  // Simple HTML table for quick scanning in email clients.
  const rows = entries
    .map((entry) => {
      const time = entry.createdTime ?? "";
      return `<tr><td>${entry.date}</td><td>${time}</td><td>${entry.value}</td></tr>`;
    })
    .join("");

  return `
    <div style="font-family: ui-sans-serif, system-ui; line-height: 1.5;">
      <h2>Blood Sugar Weekly Rollup</h2>
      <p><strong>Range:</strong> ${stats.start} → ${stats.end}</p>
      <ul>
        <li><strong>Entries:</strong> ${stats.count} (expected ${stats.expected}, missing ${stats.missing})</li>
        <li><strong>Average:</strong> ${stats.avg}</li>
        <li><strong>Min:</strong> ${stats.min}</li>
        <li><strong>Max:</strong> ${stats.max}</li>
        <li><strong>Completion:</strong> ${stats.completionRate}%</li>
        <li><strong>Current streak:</strong> ${stats.currentStreak} day${stats.currentStreak === 1 ? "" : "s"}</li>
        <li><strong>Perfect week streak:</strong> ${stats.perfectWeekStreak ? "Yes" : "No"}</li>
        <li><strong>XP earned:</strong> ${stats.xp}</li>
        <li><strong>Badges:</strong> ${stats.badges.length ? stats.badges.join(", ") : "No badges yet"}</li>
        <li><strong>Encouragement:</strong> ${escapeHtml(stats.encouragement)}</li>
        <li><strong>Disclaimer:</strong> ${escapeHtml(stats.disclaimer)}</li>
      </ul>
      <table style="border-collapse: collapse; width: 100%;">
        <thead>
          <tr>
            <th style="text-align: left; border-bottom: 1px solid #ddd; padding: 6px;">Date</th>
            <th style="text-align: left; border-bottom: 1px solid #ddd; padding: 6px;">Time</th>
            <th style="text-align: left; border-bottom: 1px solid #ddd; padding: 6px;">Value</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="3" style="padding: 6px;">No entries</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function isNotionQueryResponse(value: unknown): value is NotionQueryResponse {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.results) &&
    typeof record.has_more === "boolean" &&
    (typeof record.next_cursor === "string" || record.next_cursor === null)
  );
}

export function isCreatedTimeProperty(value: unknown): value is NotionCreatedTimeProperty {
  if (!value || typeof value !== "object") return false;
  return "created_time" in (value as Record<string, unknown>);
}

export function isTextProperty(value: unknown): value is NotionTextProperty {
  if (!value || typeof value !== "object") return false;
  return "rich_text" in (value as Record<string, unknown>);
}
