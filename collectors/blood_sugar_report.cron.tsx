import { email } from "https://esm.town/v/std/email";
import { getWeeklyRange, listDateRange } from "../shared/date.ts";
import { fetchNotionPages } from "../shared/notion.ts";
import { initRollupSchema, upsertWeeklyRollup } from "../storage/rollups.ts";
import {
  buildEncouragement,
  buildBloodSugarRollup,
  formatGroupedEntryLine,
  groupEntriesByDate,
  parseEntry,
  type GroupedEntries,
  type BloodSugarNotionPage,
  type Entry,
} from "../shared/blood_sugar_logic.ts";

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

  await initRollupSchema();
  await upsertWeeklyRollup(report.rollup);

  return new Response("Weekly report sent.", { status: 200 });
}

function buildFrom(email?: string | null, name?: string | null) {
  if (!email) return null;
  return {
    from: name ? { email, name } : { email },
  };
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
  const databaseId = Deno.env.get("NOTION_BLOOD_SUGAR_DB_ID");
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
  const pages = await fetchNotionPages<BloodSugarNotionPage>(notionConfig.databaseId, notionConfig.token, (cursor) => ({
      filter: {
        and: [
          { property: "Measurement Date", date: { on_or_after: start } },
          { property: "Measurement Date", date: { on_or_before: end } },
        ],
      },
      sorts: [{ property: "Measurement Date", direction: "ascending" }],
      ...(cursor ? { start_cursor: cursor } : {}),
    }));

  const entries: Entry[] = [];
  for (const page of pages) {
    const entry = parseEntry(page);
    if (entry) entries.push(entry);
  }

  return entries;
}

export function buildReport(entries: Entry[], start: string, end: string) {
  // Compute summary stats and derive copy for email-friendly output.
  // Summary stats for the weekly rollup.
  const rollup = buildBloodSugarRollup(entries, start, end);
  const subject = `Blood Sugar Weekly Rollup (${start} → ${end})`;
  const dateRange = listDateRange(start, end);
  const groupedEntries = groupEntriesByDate(entries, dateRange);
  const encouragement = buildEncouragement(rollup.completionRate, rollup.streak);
  const disclaimer =
    "Not medical advice. Educational info only. Source: https://www.ynhhs.org/articles/what-is-healthy-blood-sugar";

  const lines = [
    `Range: ${start} to ${end}`,
    `Entries: ${rollup.stats.totalEntries} (expected ${rollup.stats.expected}, missing ${rollup.stats.missing})`,
    `Average: ${rollup.stats.avg}`,
    `Min: ${rollup.stats.min}`,
    `Max: ${rollup.stats.max}`,
    `Completion: ${rollup.completionRate}%`,
    `Current streak: ${rollup.streak} day${rollup.streak === 1 ? "" : "s"}`,
    `Perfect week streak: ${hasPerfectWeekStreak(dateRange, rollup.stats.entriesByDate) ? "Yes" : "No"}`,
    `XP earned: ${rollup.xp}`,
    `Badges: ${rollup.badges.length ? rollup.badges.join(", ") : "No badges yet"}`,
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
    count: rollup.stats.totalEntries,
    expected: rollup.stats.expected,
    missing: rollup.stats.missing,
    avg: rollup.stats.avg,
    min: rollup.stats.min,
    max: rollup.stats.max,
    completionRate: rollup.completionRate,
    currentStreak: rollup.streak,
    badges: rollup.badges,
    encouragement,
    disclaimer,
    xp: rollup.xp,
    perfectWeekStreak: hasPerfectWeekStreak(dateRange, rollup.stats.entriesByDate),
  });

  return { subject, text, html, rollup };
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
            🔺 🔷 〰️ 🟢 〰️ 🔶 〰️ 🟡 〰️ 🟣 🔺 🔵 〰️
          </td>
        </tr>
        <tr>
          <td style="padding: 16px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px;">
                  <div style="background: #ff7a59; color: #1f1b3a; font-weight: 800; border: 2px solid #1f1b3a; border-radius: 14px; padding: 10px;">
                    <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px;">Avg</div>
                    <div style="font-size: 18px;">${stats.avg}</div>
                  </div>
                </td>
                <td style="padding: 8px;">
                  <div style="background: #7dd3fc; color: #1f1b3a; font-weight: 800; border: 2px solid #1f1b3a; border-radius: 14px; padding: 10px;">
                    <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px;">Min</div>
                    <div style="font-size: 18px;">${stats.min}</div>
                  </div>
                </td>
                <td style="padding: 8px;">
                  <div style="background: #a7f3d0; color: #1f1b3a; font-weight: 800; border: 2px solid #1f1b3a; border-radius: 14px; padding: 10px;">
                    <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px;">Max</div>
                    <div style="font-size: 18px;">${stats.max}</div>
                  </div>
                </td>
              </tr>
            </table>
            <table style="width: 100%; border-collapse: collapse; margin-top: 4px;">
              <tr>
                <td style="padding: 8px;">
                  <div style="background: #f472b6; color: #1f1b3a; font-weight: 800; border: 2px solid #1f1b3a; border-radius: 999px; padding: 10px 12px;">
                    <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px;">Entries</div>
                    <div style="font-size: 16px;">${stats.count}/${stats.expected}</div>
                  </div>
                </td>
                <td style="padding: 8px;">
                  <div style="background: #fde047; color: #1f1b3a; font-weight: 800; border: 2px solid #1f1b3a; border-radius: 999px; padding: 10px 12px;">
                    <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px;">Completion</div>
                    <div style="font-size: 16px;">${stats.completionRate}%</div>
                  </div>
                </td>
              </tr>
              <tr>
                <td style="padding: 8px;">
                  <div style="background: #c4b5fd; color: #1f1b3a; font-weight: 800; border: 2px solid #1f1b3a; border-radius: 22px; padding: 10px 12px;">
                    <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px;">Streak</div>
                    <div style="font-size: 16px;">${stats.currentStreak} day${stats.currentStreak === 1 ? "" : "s"}</div>
                  </div>
                </td>
                <td style="padding: 8px;">
                  <div style="background: #f9a8d4; color: #1f1b3a; font-weight: 800; border: 2px solid #1f1b3a; border-radius: 22px; padding: 10px 12px;">
                    <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px;">XP</div>
                    <div style="font-size: 16px;">${stats.xp}</div>
                  </div>
                </td>
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
