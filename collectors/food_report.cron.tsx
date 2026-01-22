import { getWeeklyRange } from "../shared/date.ts";
import { OpenAI } from "https://esm.town/v/std/openai";
import { fetchNotionPages, type NotionPage, updateNotionPage } from "../shared/notion.ts";
import { fetchFoodMacros, getFatSecretConfig, requestAccessToken, sumIfComplete } from "../shared/fatsecret.ts";
import {
  buildNutritionProperties,
  buildFoodRollup,
  type Entry,
  type MacroKey,
  parseEntry,
  PROPERTY_NAMES,
  roundNumber,
  safeParseJson,
  shouldEnrich,
} from "../shared/food_enrich.ts";
import { initRollupSchema, upsertWeeklyRollup } from "../storage/rollups.ts";

type NotionConfig = {
  token: string;
  databaseId: string;
};

export default async function () {
  // Resolve configs and hydrate external clients first to fail fast.
  const notionConfig = getNotionConfig();
  if (!notionConfig) {
    return new Response("Missing Notion secrets.", { status: 500 });
  }
  const openai = new OpenAI();
  const fatSecretConfig = getFatSecretConfig();
  const fatSecretToken = fatSecretConfig ? await requestAccessToken(fatSecretConfig) : null;

  const { start, end } = getWeeklyRange();
  const entries = await fetchEntries(start, end, notionConfig);
  console.log(`Food entries ${start} to ${end}:`, entries);

  let enriched = 0;
  for (const entry of entries) {
    // Only enrich entries missing core macros to avoid overwriting manual edits.
    if (!shouldEnrich(entry)) continue;
    if (!entry.food || entry.food === "Unknown") continue;
    const enrichment = await fetchNutrition(entry.food, openai, fatSecretConfig, fatSecretToken);
    if (!enrichment) continue;
    const properties = buildNutritionProperties(enrichment.macros);
    if (!Object.keys(properties).length) continue;
    console.log("Enriching entry", {
      pageId: entry.pageId,
      food: entry.food,
      loggedAt: entry.loggedAt,
      macros: enrichment.macros,
    });
    console.log("Notion update properties", {
      pageId: entry.pageId,
      properties,
    });
    await updateNotionPage(entry.pageId, notionConfig.token, properties);
    entry.macros = { ...entry.macros, ...enrichment.macros };
    enriched += 1;
  }

  await initRollupSchema();
  const rollup = buildFoodRollup(entries, start, end);
  await upsertWeeklyRollup(rollup);

  return new Response(`Weekly food entries logged. Enriched ${enriched}.`, { status: 200 });
}

function getNotionConfig(): NotionConfig | null {
  const token = Deno.env.get("NOTION_TOKEN");
  const databaseId = Deno.env.get("NOTION_FOOD_DB_ID");
  if (!token || !databaseId) return null;
  return { token, databaseId };
}

async function fetchEntries(start: string, end: string, config: NotionConfig): Promise<Entry[]> {
  // Pull just the last-week window to keep the Notion query fast.
  const pages = await fetchNotionPages<NotionPage>(config.databaseId, config.token, (cursor) => ({
      filter: {
        and: [
          { property: PROPERTY_NAMES.loggedAt, date: { on_or_after: start } },
          { property: PROPERTY_NAMES.loggedAt, date: { on_or_before: end } },
        ],
      },
      sorts: [{ property: PROPERTY_NAMES.loggedAt, direction: "ascending" }],
      ...(cursor ? { start_cursor: cursor } : {}),
    }));

  const entries: Entry[] = [];
  for (const page of pages) {
    const entry = parseEntry(page);
    if (entry) entries.push(entry);
  }

  return entries;
}

async function fetchNutrition(
  foodName: string,
  openai: OpenAI,
  config: ReturnType<typeof getFatSecretConfig>,
  token: string | null,
): Promise<{
  macros: Partial<Record<MacroKey, number>>;
} | null> {
  if (!config || !token) return null;
  const items = await parseFoodItems(foodName, openai);
  const macros = await fetchFatSecretTotals(items, foodName, token, config);
  if (!macros || !Object.keys(macros).length) return null;
  return { macros };
}

type FoodItem = {
  name: string;
  servings: number;
};

async function parseFoodItems(foodName: string, openai: OpenAI): Promise<FoodItem[]> {
  // Keep the OpenAI request compact to control costs.
  const completion = await openai.chat.completions.create({
    model: "gpt-5-nano",
    messages: [
      {
        role: "system",
        content:
          "You normalize food log entries. " +
          "Return a single JSON object: {\"items\":[{\"name\":\"...\",\"servings\":1}]}. " +
          "Correct spelling, keep names short, and split sides when phrased as \"with\" or \"and\". " +
          "Infer servings for a regular meal: default to 1 per item; if explicit quantities are given, " +
          "convert to a servings multiplier. Keep brands and key ingredients. No extra text.",
      },
      {
        role: "user",
        content: `Food entry: "${foodName}".`,
      },
    ],
    max_tokens: 160,
  });

  const text = completion.choices[0]?.message?.content?.trim();
  if (!text) return [{ name: foodName, servings: 1 }];
  const parsed = safeParseJson(text);
  if (!parsed || typeof parsed !== "object") return [{ name: foodName, servings: 1 }];
  const items = (parsed as Record<string, unknown>).items;
  if (!Array.isArray(items)) return [{ name: foodName, servings: 1 }];
  const cleaned = items
    .map((item) => coerceFoodItem(item))
    .filter((item): item is FoodItem => !!item)
    .map((item) => ({
      name: item.name.trim(),
      servings: sanitizeServings(item.servings),
    }))
    .filter((item) => item.name.length > 0);
  return cleaned.length ? cleaned : [{ name: foodName, servings: 1 }];
}

async function fetchFatSecretTotals(
  items: FoodItem[],
  original: string,
  token: string,
  config: ReturnType<typeof getFatSecretConfig>,
): Promise<Partial<Record<MacroKey, number>> | null> {
  if (!config) return null;
  const components: Array<Partial<Record<MacroKey, number>> | null> = [];
  for (const item of items) {
    const macros = await fetchFoodMacros(item.name, token);
    components.push(macros ? scaleMacros(macros, item.servings) : null);
  }

  if (components.length === 1 && components[0]) return components[0];
  const totals = sumComponentMacros(components);
  if (totals && hasCoreMacros(totals)) return totals;
  const fallback = await fetchFoodMacros(original, token);
  return fallback ?? null;
}

const CORE_MACROS: MacroKey[] = ["calories", "protein", "carbs", "fat"];
const SUM_MACROS: MacroKey[] = ["calories", "protein", "carbs", "fat", "fiber", "sugar", "sodium"];

function hasCoreMacros(macros: Partial<Record<MacroKey, number>>): boolean {
  return CORE_MACROS.every((key) => typeof macros[key] === "number");
}

function sumComponentMacros(
  components: Array<Partial<Record<MacroKey, number>> | null>,
): Partial<Record<MacroKey, number>> | null {
  if (!components.length) return null;
  if (components.some((component) => !component)) return null;
  const entries = components as Array<Partial<Record<MacroKey, number>>>;
  const totals: Partial<Record<MacroKey, number>> = {};
  for (const key of SUM_MACROS) {
    const value = sumIfComplete(entries.map((entry) => entry[key]));
    if (value !== undefined) totals[key] = value;
  }
  return totals;
}

function coerceFoodItem(item: unknown): FoodItem | null {
  if (typeof item === "string") {
    return { name: item, servings: 1 };
  }
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  const name = record.name;
  if (typeof name !== "string") return null;
  const servings = record.servings;
  if (typeof servings === "number" && Number.isFinite(servings)) {
    return { name, servings };
  }
  if (typeof servings === "string") {
    const parsed = Number(servings.trim());
    if (Number.isFinite(parsed)) return { name, servings: parsed };
  }
  return { name, servings: 1 };
}

function sanitizeServings(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return roundNumber(value);
}

function scaleMacros(
  macros: Partial<Record<MacroKey, number>>,
  servings: number,
): Partial<Record<MacroKey, number>> {
  const scaled: Partial<Record<MacroKey, number>> = {};
  for (const [key, value] of Object.entries(macros) as Array<[MacroKey, number]>) {
    if (typeof value !== "number") continue;
    scaled[key] = roundNumber(value * servings);
  }
  return scaled;
}
