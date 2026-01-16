import { initRollupSchema, insertBadgeEvents, upsertWeeklyRollup, type BadgeEvent, type WeeklyRollup } from "../storage/rollups.ts";

type PersistPayload = {
  rollup: WeeklyRollup;
  badgeEvents?: BadgeEvent[];
};

export default async function (req: Request) {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const authError = checkAuth(req);
  if (authError) {
    return new Response(authError, { status: 401 });
  }

  const data = (await req.json()) as unknown;
  if (!isPersistPayload(data)) {
    return new Response("Invalid payload.", { status: 400 });
  }

  await initRollupSchema();
  await upsertWeeklyRollup(data.rollup);
  if (data.badgeEvents?.length) {
    await insertBadgeEvents(data.badgeEvents);
  }

  return new Response("Persisted.", { status: 200 });
}

function checkAuth(req: Request): string | null {
  const token = Deno.env.get("ROLLUP_PERSIST_TOKEN");
  if (!token) return null;
  const header = req.headers.get("Authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match || match[1] !== token) return "Unauthorized.";
  return null;
}

function isPersistPayload(value: unknown): value is PersistPayload {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (!isWeeklyRollup(record.rollup)) return false;
  if (record.badgeEvents === undefined) return true;
  return Array.isArray(record.badgeEvents) && record.badgeEvents.every(isBadgeEvent);
}

function isWeeklyRollup(value: unknown): value is WeeklyRollup {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.category === "string" &&
    typeof record.periodStart === "string" &&
    typeof record.periodEnd === "string" &&
    typeof record.streak === "number" &&
    typeof record.completionRate === "number" &&
    typeof record.xp === "number" &&
    Array.isArray(record.badges) &&
    typeof record.stats === "object" &&
    record.stats !== null &&
    typeof record.runId === "string"
  );
}

function isBadgeEvent(value: unknown): value is BadgeEvent {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.category === "string" &&
    typeof record.badge === "string" &&
    typeof record.periodStart === "string" &&
    typeof record.periodEnd === "string" &&
    typeof record.awardedAt === "string"
  );
}
