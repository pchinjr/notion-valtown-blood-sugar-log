import { email } from "https://esm.town/v/std/email";

const NOTION_VERSION = "2022-06-28";
const NOTION_TOKEN = Deno.env.get("NOTION_TOKEN");
const NOTION_DATABASE_ID = Deno.env.get("NOTION_DATABASE_ID");
const REPORT_TO = Deno.env.get("REPORT_TO");
const REPORT_FROM_EMAIL = Deno.env.get("REPORT_FROM_EMAIL");
const REPORT_FROM_NAME = Deno.env.get("REPORT_FROM_NAME");
const REPORT_REPLY_TO = Deno.env.get("REPORT_REPLY_TO");

type NotionPage = {
  properties: Record<string, any>;
};

type Entry = {
  date: string;
  createdTime: string | null;
  value: number;
  notes: string | null;
};

export default async function handler(): Promise<Response> {
  if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
    return new Response("Missing required secrets.", { status: 500 });
  }

  const { start, end } = getWeeklyRange();
  console.log(`Weekly range: ${start} to ${end}`);
  const entries = await fetchEntries(start, end);
  console.log(`Fetched ${entries.length} entries from Notion`);
  const report = buildReport(entries, start, end);
  console.log("Report subject:", report.subject);

  const emailPayload = {
    subject: report.subject,
    text: report.text,
    html: report.html,
    ...(buildFrom(REPORT_FROM_EMAIL, REPORT_FROM_NAME) ?? {}),
    ...(REPORT_REPLY_TO ? { replyTo: REPORT_REPLY_TO } : {}),
    ...(REPORT_TO ? { to: REPORT_TO } : {}),
  };

  await email(emailPayload);
  console.log(`Email sent to ${REPORT_TO}`);

  return new Response("Weekly report sent.", { status: 200 });
}

function buildFrom(email?: string | null, name?: string | null) {
  if (!email) return null;
  return {
    from: name ? { email, name } : { email },
  };
}

function getWeeklyRange(): { start: string; end: string } {
  const today = new Date();
  const end = toDateOnly(today);
  const startDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  startDate.setUTCDate(startDate.getUTCDate() - 6);
  const start = toDateOnly(startDate);
  return { start, end };
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function fetchEntries(start: string, end: string): Promise<Entry[]> {
  const url = `https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`;
  const headers = {
    Authorization: `Bearer ${NOTION_TOKEN}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };

  const entries: Entry[] = [];
  let cursor: string | undefined;

  do {
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

    const data = await response.json();
    for (const page of data.results as NotionPage[]) {
      const entry = parseEntry(page);
      if (entry) entries.push(entry);
    }

    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return entries;
}

function parseEntry(page: NotionPage): Entry | null {
  const props = page.properties ?? {};
  const date = props["Measurement Date"]?.date?.start;
  const value = props["Blood Sugar Level"]?.number;
  if (!date || typeof value !== "number") return null;

  const createdTime =
    props["Created Time"]?.created_time ??
    props["Created Time"]?.rich_text?.[0]?.plain_text ??
    null;
  const notes = props["Notes"]?.rich_text?.[0]?.plain_text ?? null;

  return { date: date.slice(0, 10), createdTime, value, notes };
}

function buildReport(entries: Entry[], start: string, end: string) {
  const values = entries.map((entry) => entry.value);
  const count = values.length;
  const avg = count ? Math.round((values.reduce((a, b) => a + b, 0) / count) * 10) / 10 : 0;
  const min = count ? Math.min(...values) : 0;
  const max = count ? Math.max(...values) : 0;

  const days = daysBetweenInclusive(start, end);
  const expected = days * 2;
  const missing = Math.max(0, expected - count);

  const subject = `Blood Sugar Weekly Rollup (${start} → ${end})`;

  const lines = [
    `Range: ${start} to ${end}`,
    `Entries: ${count} (expected ${expected}, missing ${missing})`,
    `Average: ${avg}`,
    `Min: ${min}`,
    `Max: ${max}`,
    "",
    "Entries:",
    ...entries.map(formatEntryLine),
  ];

  const text = lines.join("\n");
  const html = renderHtmlReport(entries, { start, end, count, expected, missing, avg, min, max });

  return { subject, text, html };
}

function daysBetweenInclusive(start: string, end: string): number {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  const ms = endDate.getTime() - startDate.getTime();
  return Math.floor(ms / 86400000) + 1;
}

function formatEntryLine(entry: Entry): string {
  const time = entry.createdTime ? ` (${entry.createdTime})` : "";
  const notes = entry.notes ? ` — ${entry.notes}` : "";
  return `${entry.date}${time}: ${entry.value}${notes}`;
}

function renderHtmlReport(
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
  },
): string {
  const rows = entries
    .map((entry) => {
      const notes = entry.notes ? escapeHtml(entry.notes) : "";
      const time = entry.createdTime ?? "";
      return `<tr><td>${entry.date}</td><td>${time}</td><td>${entry.value}</td><td>${notes}</td></tr>`;
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
      </ul>
      <table style="border-collapse: collapse; width: 100%;">
        <thead>
          <tr>
            <th style="text-align: left; border-bottom: 1px solid #ddd; padding: 6px;">Date</th>
            <th style="text-align: left; border-bottom: 1px solid #ddd; padding: 6px;">Time</th>
            <th style="text-align: left; border-bottom: 1px solid #ddd; padding: 6px;">Value</th>
            <th style="text-align: left; border-bottom: 1px solid #ddd; padding: 6px;">Notes</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="4" style="padding: 6px;">No entries</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
