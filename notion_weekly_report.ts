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
  const groupedEntries = groupEntriesByDate(entries, dateRange);

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
    ...groupedEntries.map(formatGroupedEntryLine),
  ];

  const text = lines.join("\n");
  const html = renderHtmlReport(groupedEntries, {
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

function getMeridiem(value: string | null): "AM" | "PM" | null {
  if (!value) return null;
  const match = value.match(/\b(AM|PM)\b/i);
  if (!match) return null;
  return match[1].toUpperCase() as "AM" | "PM";
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

type GroupedEntries = {
  date: string;
  am: Entry[];
  pm: Entry[];
};

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

function formatFirstSecondText(group: GroupedEntries): [string, string] {
  const ordered = orderEntries(group);
  if (!ordered.length) return ["—", "—"];
  const first = String(ordered[0].value);
  if (ordered.length === 1) return [first, "—"];
  const secondValue = String(ordered[1].value);
  const overflow = ordered.length > 2 ? ` (+${ordered.length - 2})` : "";
  return [first, `${secondValue}${overflow}`];
}

function formatFirstSecondHtml(group: GroupedEntries): [string, string] {
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

export function renderHtmlReport(
  groupedEntries: GroupedEntries[],
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
  const rows = groupedEntries
    .map((group) => {
      const [first, second] = formatFirstSecondHtml(group);
      return `<tr>
        <td style="padding: 6px; border-bottom: 1px solid #1f1b3a; font-size: 12px; word-break: break-word;">${group.date}</td>
        <td style="padding: 6px; border-bottom: 1px solid #1f1b3a; font-size: 12px; word-break: break-word;">${escapeHtml(first)}</td>
        <td style="padding: 6px; border-bottom: 1px solid #1f1b3a; font-size: 12px; word-break: break-word;">${escapeHtml(second)}</td>
      </tr>`;
    })
    .join("");

  return `
    <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.4; background: #f7f5ff; padding: 16px;">
      <table style="width: 100%; border-collapse: collapse; background: #ffffff; border: 3px solid #1f1b3a; table-layout: fixed;">
        <tr>
          <td style="padding: 14px 16px; background: #ffdf3b; border-bottom: 3px solid #1f1b3a;">
            <div style="font-size: 20px; font-weight: 800; letter-spacing: 0.5px;">Blood Sugar Weekly Rollup</div>
            <div style="font-size: 12px; margin-top: 4px;">${stats.start} to ${stats.end}</div>
          </td>
        </tr>
        <tr>
          <td style="padding: 8px 16px; background: #1f1b3a; color: #ffffff; font-size: 12px; letter-spacing: 1px;">
            OOOO //// OOOO //// OOOO //// OOOO
          </td>
        </tr>
        <tr>
          <td style="padding: 16px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 10px; background: #ff7a59; color: #1f1b3a; font-weight: 700; border: 2px solid #1f1b3a;">Avg ${stats.avg}</td>
                <td style="padding: 10px; background: #7dd3fc; color: #1f1b3a; font-weight: 700; border: 2px solid #1f1b3a;">Min ${stats.min}</td>
                <td style="padding: 10px; background: #a7f3d0; color: #1f1b3a; font-weight: 700; border: 2px solid #1f1b3a;">Max ${stats.max}</td>
              </tr>
            </table>
            <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
              <tr>
                <td style="padding: 10px; background: #f472b6; color: #1f1b3a; font-weight: 700; border: 2px solid #1f1b3a;">Entries ${stats.count}/${stats.expected}</td>
                <td style="padding: 10px; background: #fde047; color: #1f1b3a; font-weight: 700; border: 2px solid #1f1b3a;">Completion ${stats.completionRate}%</td>
              </tr>
              <tr>
                <td style="padding: 10px; background: #c4b5fd; color: #1f1b3a; font-weight: 700; border: 2px solid #1f1b3a;">Streak ${stats.currentStreak} day${stats.currentStreak === 1 ? "" : "s"}</td>
                <td style="padding: 10px; background: #f9a8d4; color: #1f1b3a; font-weight: 700; border: 2px solid #1f1b3a;">XP ${stats.xp}</td>
              </tr>
            </table>
            <div style="margin-top: 12px; padding: 10px; background: #e2e8f0; border: 2px dashed #1f1b3a;">
              <strong>Perfect Week Streak:</strong> ${stats.perfectWeekStreak ? "Yes" : "No"}
            </div>
            <div style="margin-top: 10px;">
              <strong>Badges:</strong>
              <div style="margin-top: 6px;">
                ${
                  stats.badges.length
                    ? stats.badges
                        .map(
                          (badge) =>
                            `<span style="display: inline-block; margin: 4px 6px 0 0; padding: 6px 8px; background: #ffffff; border: 2px solid #1f1b3a; font-weight: 700;">${escapeHtml(badge)}</span>`,
                        )
                        .join("")
                    : `<span style="display: inline-block; margin-top: 4px;">No badges yet</span>`
                }
              </div>
            </div>
            <div style="margin-top: 12px; padding: 10px; background: #1f1b3a; color: #ffffff;">
              ${escapeHtml(stats.encouragement)}
            </div>
            <div style="margin-top: 8px; font-size: 12px; color: #444444;">
              ${escapeHtml(stats.disclaimer)}
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding: 12px 16px; background: #1f1b3a; color: #ffffff; font-weight: 700;">
            Entries
          </td>
        </tr>
        <tr>
          <td style="padding: 0 16px 16px 16px;">
            <table style="border-collapse: collapse; width: 100%; border: 2px solid #1f1b3a; table-layout: fixed;">
              <thead>
                <tr style="background: #ffdf3b;">
                  <th style="text-align: left; border-bottom: 2px solid #1f1b3a; padding: 6px; font-size: 12px;">Date</th>
                  <th style="text-align: left; border-bottom: 2px solid #1f1b3a; padding: 6px; font-size: 12px;">1st</th>
                  <th style="text-align: left; border-bottom: 2px solid #1f1b3a; padding: 6px; font-size: 12px;">2nd</th>
                </tr>
              </thead>
              <tbody>
                ${rows || `<tr><td colspan="3" style="padding: 8px; font-size: 12px;">No entries</td></tr>`}
              </tbody>
            </table>
          </td>
        </tr>
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
