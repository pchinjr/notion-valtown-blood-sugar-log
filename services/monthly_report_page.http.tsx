import React from "https://esm.sh/react@18.2.0";
import { renderToString } from "https://esm.sh/react-dom@18.2.0/server";
import { sqlite } from "../storage/sqlite.ts";
import {
  aggregateBloodSugarMonth,
  aggregateFoodMonth,
  resolveMonthRange,
  type Rollup,
} from "../shared/monthly_report.ts";

// HTTP val that renders a monthly dashboard directly from the val-scoped DB.
export default async function (req: Request) {
  const url = new URL(req.url);
  const monthParam = url.searchParams.get("month");
  const now = new Date();
  // Keep defaults aligned with the dropdown so the first render has data.
  const startYear = 2026;
  const selectedMonth = resolveSelectedMonth(monthParam, now, startYear);
  const { start, end } = resolveMonthRange(selectedMonth, now);
  const includePartialWeeks = url.searchParams.get("partial") === "true";
  const monthOptions = buildMonthOptions(startYear, now);

  // Pull all rollups for the requested month window, then split by category.
  const rollups = await fetchRollups(start, end, includePartialWeeks);
  const bloodSugar = aggregateBloodSugarMonth(rollups.filter((r) => r.category === "blood_sugar"), start, end, {
    includePartialWeeks,
  });
  const food = aggregateFoodMonth(rollups.filter((r) => r.category === "food"), start, end, {
    includePartialWeeks,
  });

  // Render a full HTML page as a string (server-side React).
  const html = renderToString(
    <ReportPage
      monthStart={start}
      monthEnd={end}
      includePartialWeeks={includePartialWeeks}
      selectedMonth={selectedMonth}
      monthOptions={monthOptions}
      bloodSugar={bloodSugar}
      food={food}
    />,
  );

  return new Response(`<!doctype html>${html}`, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// Fetch weekly rollups for the month; optionally include overlapping weeks.
// Query weekly rollups that overlap the selected month.
async function fetchRollups(start: string, end: string, includePartialWeeks: boolean): Promise<Rollup[]> {
  const where = includePartialWeeks
    ? "period_start <= ? AND period_end >= ?"
    : "period_start >= ? AND period_end <= ?";
  const args = includePartialWeeks ? [end, start] : [start, end];
  const result = await sqlite.execute({
    sql: `
      SELECT
        category,
        period_start,
        period_end,
        streak,
        completion_rate,
        xp,
        badges_json,
        stats_json,
        run_id
      FROM weekly_rollups_1
      WHERE ${where}
      ORDER BY period_start ASC
    `,
    args,
  });

  return result.rows.map((row) => rowToRollup(row as Record<string, unknown> | unknown[]));
}

// Convert SQLite array or object rows into typed rollup objects.
// (The SQLite client can return either shape depending on context.)
function rowToRollup(row: Record<string, unknown> | unknown[]): Rollup {
  const values = Array.isArray(row) ? row : [
    row.category,
    row.period_start,
    row.period_end,
    row.streak,
    row.completion_rate,
    row.xp,
    row.badges_json,
    row.stats_json,
    row.run_id,
  ];
  const [
    category,
    periodStart,
    periodEnd,
    streak,
    completionRate,
    xp,
    badgesJson,
    statsJson,
    runId,
  ] = values;
  return {
    category: String(category),
    periodStart: String(periodStart),
    periodEnd: String(periodEnd),
    streak: Number(streak ?? 0),
    completionRate: Number(completionRate ?? 0),
    xp: Number(xp ?? 0),
    badges: safeParseJsonArray(badgesJson),
    stats: safeParseJsonObject(statsJson),
    runId: String(runId),
  };
}

function safeParseJsonArray(value: unknown): string[] {
  const parsed = safeParseJson(value);
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

function safeParseJsonObject(value: unknown): Record<string, unknown> {
  const parsed = safeParseJson(value);
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

// Guard against invalid JSON in stored rollup columns.
function safeParseJson(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// Present the monthly report as a static HTML page.
function ReportPage(props: {
  monthStart: string;
  monthEnd: string;
  includePartialWeeks: boolean;
  selectedMonth: string;
  monthOptions: string[];
  bloodSugar: ReturnType<typeof aggregateBloodSugarMonth>;
  food: ReturnType<typeof aggregateFoodMonth>;
}) {
  const { monthStart, monthEnd, includePartialWeeks, selectedMonth, monthOptions, bloodSugar, food } = props;
  const title = "Praise Cage Monthly Rollup";
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <style>{`
          :root {
            --ink: #1b1b1f;
            --sun: #ffd84d;
            --paper: #fff4d6;
            --mint: #52e3b6;
            --rose: #ff8aa1;
            --sky: #6cc6ff;
            --cobalt: #2f3cff;
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            background: linear-gradient(135deg, #fff1b8, #ffe4ef 35%, #dff6ff 75%);
            color: var(--ink);
            font-family: "Futura", "Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif;
          }
          .bg-shapes {
            position: fixed;
            inset: 0;
            z-index: 0;
            pointer-events: none;
            background:
              radial-gradient(circle at 6% 10%, var(--sun) 0 12px, transparent 13px),
              radial-gradient(circle at 18% 30%, var(--mint) 0 10px, transparent 11px),
              radial-gradient(circle at 28% 70%, var(--rose) 0 11px, transparent 12px),
              radial-gradient(circle at 42% 12%, var(--sky) 0 9px, transparent 10px),
              radial-gradient(circle at 60% 20%, var(--cobalt) 0 8px, transparent 9px),
              radial-gradient(circle at 70% 75%, var(--sun) 0 14px, transparent 15px),
              radial-gradient(circle at 82% 40%, var(--mint) 0 10px, transparent 11px),
              radial-gradient(circle at 92% 18%, var(--rose) 0 9px, transparent 10px),
              radial-gradient(circle at 95% 60%, var(--sky) 0 12px, transparent 13px),
              linear-gradient(25deg, transparent 0 60%, rgba(47, 60, 255, 0.25) 60% 62%, transparent 62% 100%),
              linear-gradient(-18deg, transparent 0 72%, rgba(82, 227, 182, 0.25) 72% 74%, transparent 74% 100%),
              linear-gradient(90deg, transparent 0 12%, rgba(255, 138, 161, 0.25) 12% 14%, transparent 14% 100%);
            background-repeat: no-repeat;
          }
          .shape {
            position: fixed;
            z-index: 0;
            pointer-events: none;
          }
          .shape svg {
            display: block;
          }
          .wrap {
            max-width: 980px;
            margin: 0 auto;
            padding: 32px 20px 48px;
            position: relative;
          }
          .wrap::before,
          .wrap::after {
            content: "";
            position: absolute;
            z-index: 0;
            border: 3px solid var(--ink);
            background: var(--sky);
            opacity: 0.9;
          }
          .wrap::before {
            width: 120px;
            height: 120px;
            top: 10px;
            right: -30px;
            transform: rotate(12deg);
          }
          .wrap::after {
            width: 80px;
            height: 80px;
            bottom: 10px;
            left: -20px;
            background: var(--rose);
            transform: rotate(-8deg);
          }
          .header {
            border: 4px solid var(--ink);
            background: var(--sun);
            padding: 18px 22px;
            box-shadow: 8px 8px 0 var(--ink);
            position: relative;
            z-index: 1;
          }
          .header h1 {
            margin: 0;
            font-size: 34px;
            letter-spacing: 1px;
            text-transform: uppercase;
          }
          .sub {
            margin: 8px 0 0;
            font-size: 13px;
            font-weight: 800;
          }
          .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 16px;
            margin-top: 20px;
            position: relative;
            z-index: 1;
          }
          .controls {
            margin-top: 18px;
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            align-items: center;
            font-size: 14px;
            font-weight: 800;
          }
          .controls label {
            display: inline-flex;
            align-items: center;
            gap: 6px;
          }
          .controls select,
          .controls input[type="checkbox"],
          .controls button {
            font-family: inherit;
            font-size: 14px;
            border: 2px solid var(--ink);
            padding: 4px 8px;
            background: white;
          }
          .controls button {
            background: var(--cobalt);
            color: white;
            box-shadow: 3px 3px 0 var(--ink);
            cursor: pointer;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          .card {
            background: white;
            border: 3px solid var(--ink);
            box-shadow: 6px 6px 0 var(--ink);
            padding: 16px 18px;
            position: relative;
            overflow: hidden;
          }
          .card::after {
            content: "";
            position: absolute;
            width: 140px;
            height: 12px;
            background: var(--sun);
            border: 2px solid var(--ink);
            bottom: 16px;
            right: -18px;
            transform: rotate(-6deg);
          }
          .card h2 {
            margin: 0 0 12px;
            font-size: 20px;
            text-transform: uppercase;
            border-bottom: 3px solid var(--ink);
            padding-bottom: 6px;
          }
          .stat {
            display: flex;
            justify-content: space-between;
            padding: 4px 0;
            font-size: 15px;
            font-weight: 700;
          }
          .stat span:last-child {
            font-size: 16px;
            font-weight: 800;
          }
          .badge {
            display: inline-block;
            margin: 6px 6px 0 0;
            padding: 6px 8px;
            background: var(--rose);
            border: 2px solid var(--ink);
            font-weight: 800;
            font-size: 12px;
            text-transform: uppercase;
          }
          .macro {
            background: var(--paper);
            border: 3px solid var(--ink);
            padding: 8px 10px;
            margin-top: 10px;
            font-size: 13px;
          }
          .footer {
            margin-top: 24px;
            font-size: 12px;
            font-weight: 700;
            position: relative;
            z-index: 1;
          }
        `}</style>
      </head>
      <body>
        {/* Decorative background layers */}
        <div className="bg-shapes" aria-hidden="true"></div>
        <div className="shape" style={{ top: "6%", left: "6%", transform: "rotate(-6deg)" }} aria-hidden="true">
          <svg width="110" height="110" viewBox="0 0 110 110" role="presentation">
            <polygon points="5,105 105,105 55,5" fill="#ffd84d" stroke="#1b1b1f" strokeWidth="4" />
          </svg>
        </div>
        <div className="shape" style={{ top: "18%", right: "8%", transform: "rotate(10deg)" }} aria-hidden="true">
          <svg width="150" height="70" viewBox="0 0 150 70" role="presentation">
            <path
              d="M5 45 C25 10, 45 10, 65 45 S110 80, 145 45"
              fill="none"
              stroke="#2f3cff"
              strokeWidth="6"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <div className="shape" style={{ bottom: "8%", right: "6%", transform: "rotate(-12deg)" }} aria-hidden="true">
          <svg width="130" height="130" viewBox="0 0 130 130" role="presentation">
            <polygon points="10,10 120,65 10,120" fill="#6cc6ff" stroke="#1b1b1f" strokeWidth="4" />
          </svg>
        </div>
        <div className="shape" style={{ bottom: "18%", left: "10%" }} aria-hidden="true">
          <svg width="170" height="80" viewBox="0 0 170 80" role="presentation">
            <path
              d="M5 40 C30 5, 55 5, 80 40 S130 75, 165 40"
              fill="none"
              stroke="#ff8aa1"
              strokeWidth="6"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <div className="wrap">
          <header className="header">
            <h1>{title}</h1>
            <div className="sub">
              Range: {monthStart} → {monthEnd} {includePartialWeeks ? "(partial weeks included)" : "(full weeks only)"}
            </div>
            {/* Month navigation is query-string driven for shareable URLs. */}
            <form className="controls" method="get" id="report-controls">
              <label>
                Month
                <select name="month" defaultValue={selectedMonth} id="month-select">
                  {monthOptions.map((month) => (
                    <option key={month} value={month}>
                      {month}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  name="partial"
                  value="true"
                  defaultChecked={includePartialWeeks}
                  id="partial-weeks"
                />
                Include partial weeks
              </label>
            </form>
          </header>

          {/* Main content: two summary cards */}
          <main className="grid" aria-label="Monthly report summary">
            <section className="card">
              <h2>Blood Sugar</h2>
              <Stat label="Entries" value={bloodSugar.totalEntries} />
              <Stat label="Average" value={bloodSugar.average} />
              <Stat label="Min" value={bloodSugar.min} />
              <Stat label="Max" value={bloodSugar.max} />
              <Stat label="Completion" value={`${bloodSugar.completionRate}%`} />
              <Stat label="Streak" value={`${bloodSugar.streak} day${bloodSugar.streak === 1 ? "" : "s"}`} />
              <Stat label="XP" value={bloodSugar.xp} />
              <div>
                {(bloodSugar.badges.length ? bloodSugar.badges : ["No badges yet"]).map((badge) => (
                  <span className="badge" key={badge}>
                    {badge}
                  </span>
                ))}
              </div>
            </section>

            <section className="card">
              <h2>Food Log</h2>
              <Stat label="Entries" value={food.totalEntries} />
              <Stat label="Unique days" value={food.uniqueDays} />
              <Stat label="Avg/day" value={food.avgEntriesPerDay} />
              <Stat label="Min/day" value={food.minEntriesPerDay} />
              <Stat label="Max/day" value={food.maxEntriesPerDay} />
              <Stat label="Completion" value={`${food.completionRate}%`} />
              <Stat label="Streak" value={`${food.streak} day${food.streak === 1 ? "" : "s"}`} />
              <div className="macro">
                <strong>Macro averages (per entry)</strong>
                {Object.keys(food.macroSummary).length === 0 && <div>No macro data yet.</div>}
                {Object.entries(food.macroSummary).map(([key, value]) => (
                  <div key={key} className="stat">
                    <span>{key}</span>
                    <span>{value.avg}</span>
                  </div>
                ))}
              </div>
            </section>
          </main>

          <div className="footer">
            Praise Cage mode: keep logging, keep winning. Data from weekly rollups stored in Val Town SQLite.
          </div>
        </div>
        <script>{`
          (function () {
            var form = document.getElementById("report-controls");
            if (!form) return;
            var submitForm = function () {
              if (typeof form.requestSubmit === "function") {
                form.requestSubmit();
              } else {
                form.submit();
              }
            };
            form.addEventListener("change", function (event) {
              var target = event.target;
              if (!target) return;
              if (target.id === "month-select" || target.id === "partial-weeks") {
                // Auto-refresh when controls change.
                submitForm();
              }
            });
          })();
        `}</script>
      </body>
    </html>
  );
}

function Stat(props: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <span>{props.label}</span>
      <span>{props.value}</span>
    </div>
  );
}

// Build the month dropdown from the first data year through the current month.
function buildMonthOptions(startYear: number, now: Date): string[] {
  const options: string[] = [];
  const start = new Date(Date.UTC(startYear, 0, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (end < start) {
    return [formatMonth(start)];
  }
  for (let cursor = start; cursor <= end; cursor = addMonths(cursor, 1)) {
    options.push(formatMonth(cursor));
  }
  return options;
}

// Use the query string if valid, otherwise default to last month.
function resolveSelectedMonth(monthParam: string | null, now: Date, startYear: number): string {
  const minMonth = `${startYear}-01`;
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    return monthParam < minMonth ? minMonth : monthParam;
  }
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const previous = new Date(Date.UTC(year, month - 1, 1));
  const fallback = formatMonth(previous);
  return fallback < minMonth ? minMonth : fallback;
}

// Format a Date as YYYY-MM for query params and dropdown values.
function formatMonth(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

// Date helper for iterating month-by-month.
function addMonths(date: Date, amount: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1));
}
