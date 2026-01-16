import React from "https://esm.sh/react@18.2.0";
import { renderToString } from "https://esm.sh/react-dom@18.2.0/server";
import { sqlite } from "https://esm.town/v/std/sqlite";
import {
  aggregateBloodSugarMonth,
  aggregateFoodMonth,
  resolveMonthRange,
  type Rollup,
} from "../shared/monthly_report.ts";

export default async function (req: Request) {
  const url = new URL(req.url);
  const { start, end } = resolveMonthRange(url.searchParams.get("month"));
  const includePartialWeeks = url.searchParams.get("partial") === "true";

  const rollups = await fetchRollups(start, end, includePartialWeeks);
  const bloodSugar = aggregateBloodSugarMonth(rollups.filter((r) => r.category === "blood_sugar"), start, end, {
    includePartialWeeks,
  });
  const food = aggregateFoodMonth(rollups.filter((r) => r.category === "food"), start, end, {
    includePartialWeeks,
  });

  const html = renderToString(
    <ReportPage
      monthStart={start}
      monthEnd={end}
      includePartialWeeks={includePartialWeeks}
      bloodSugar={bloodSugar}
      food={food}
    />,
  );

  return new Response(`<!doctype html>${html}`, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// Fetch weekly rollups for the month; optionally include overlapping weeks.
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

  return result.rows.map((row) =>
    rowToRollup(row as unknown[]),
  );
}

// Convert SQLite row arrays into typed rollup objects.
function rowToRollup(row: unknown[]): Rollup {
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
  ] = row;
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

function ReportPage(props: {
  monthStart: string;
  monthEnd: string;
  includePartialWeeks: boolean;
  bloodSugar: ReturnType<typeof aggregateBloodSugarMonth>;
  food: ReturnType<typeof aggregateFoodMonth>;
}) {
  const { monthStart, monthEnd, includePartialWeeks, bloodSugar, food } = props;
  const title = "Praise Cage Monthly Rollup";
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <style>{`
          :root {
            --ink: #1f1b3a;
            --sun: #ffdf3b;
            --paper: #fff8dc;
            --mint: #64f0a2;
            --rose: #ff8ba7;
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            background: radial-gradient(circle at top, #fff2b3, #fff8dc);
            color: var(--ink);
            font-family: "Georgia", "Times New Roman", serif;
          }
          .wrap {
            max-width: 980px;
            margin: 0 auto;
            padding: 32px 20px 48px;
          }
          .header {
            border: 3px solid var(--ink);
            background: var(--sun);
            padding: 16px 20px;
            box-shadow: 6px 6px 0 var(--ink);
          }
          .header h1 {
            margin: 0;
            font-size: 32px;
            letter-spacing: 0.5px;
          }
          .sub {
            margin: 8px 0 0;
            font-size: 14px;
            font-weight: 700;
          }
          .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 16px;
            margin-top: 20px;
          }
          .card {
            background: white;
            border: 2px solid var(--ink);
            box-shadow: 4px 4px 0 var(--ink);
            padding: 16px;
          }
          .card h2 {
            margin: 0 0 12px;
            font-size: 20px;
            text-transform: uppercase;
          }
          .stat {
            display: flex;
            justify-content: space-between;
            padding: 4px 0;
            font-size: 14px;
          }
          .badge {
            display: inline-block;
            margin: 6px 6px 0 0;
            padding: 6px 8px;
            background: var(--mint);
            border: 2px solid var(--ink);
            font-weight: 700;
            font-size: 12px;
          }
          .macro {
            background: var(--paper);
            border: 2px solid var(--ink);
            padding: 8px 10px;
            margin-top: 10px;
            font-size: 13px;
          }
          .footer {
            margin-top: 24px;
            font-size: 12px;
          }
        `}</style>
      </head>
      <body>
        <div className="wrap">
          <header className="header">
            <h1>{title}</h1>
            <div className="sub">
              Range: {monthStart} → {monthEnd} {includePartialWeeks ? "(partial weeks included)" : "(full weeks only)"}
            </div>
          </header>

          <div className="grid">
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
          </div>

          <div className="footer">
            Praise Cage mode: keep logging, keep winning. Data from weekly rollups stored in Val Town SQLite.
          </div>
        </div>
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
