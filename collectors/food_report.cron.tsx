import { getWeeklyRange } from "../shared/date.ts";
import { OpenAI } from "https://esm.town/v/std/openai";
import {
  type NotionCreatedTimeProperty,
  fetchNotionPages,
  type NotionDateProperty,
  type NotionNumberProperty,
  type NotionPage,
  type NotionTextProperty,
  type NotionTitleProperty,
  updateNotionPage,
} from "../shared/notion.ts";

type MacroKey = "calories" | "protein" | "carbs" | "fat" | "fiber" | "sugar" | "sodium";

type Entry = {
  pageId: string;
  date: string;
  loggedAt: string;
  food: string;
  macros: Partial<Record<MacroKey, number>>;
};

type NotionConfig = {
  token: string;
  databaseId: string;
};

const PROPERTY_NAMES = {
  title: "food",
  loggedAt: "Created time",
  macros: {
    calories: "calories",
    protein: "protein",
    carbs: "carbs",
    fat: "fats",
    fiber: "fiber",
    sugar: "sugar",
    sodium: "sodium",
  },
};

export default async function () {
  const notionConfig = getNotionConfig();
  if (!notionConfig) {
    return new Response("Missing Notion secrets.", { status: 500 });
  }
  const openai = new OpenAI();

  const { start, end } = getWeeklyRange();
  const entries = await fetchEntries(start, end, notionConfig);
  console.log(`Food entries ${start} to ${end}:`, entries);

  let enriched = 0;
  for (const entry of entries) {
    if (!shouldEnrich(entry)) continue;
    if (!entry.food || entry.food === "Unknown") continue;
    const enrichment = await fetchNutrition(entry.food, openai);
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
    enriched += 1;
  }

  return new Response(`Weekly food entries logged. Enriched ${enriched}.`, { status: 200 });
}

function getNotionConfig(): NotionConfig | null {
  const token = Deno.env.get("NOTION_TOKEN");
  const databaseId = Deno.env.get("NOTION_FOOD_DB_ID");
  if (!token || !databaseId) return null;
  return { token, databaseId };
}

async function fetchEntries(start: string, end: string, config: NotionConfig): Promise<Entry[]> {
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

function parseEntry(page: NotionPage): Entry | null {
  const props = page.properties ?? {};
  const loggedAtProp = props[PROPERTY_NAMES.loggedAt] as
    | NotionDateProperty
    | NotionCreatedTimeProperty
    | undefined;
  let loggedAt: string | null = null;
  if (loggedAtProp) {
    if ("date" in loggedAtProp) loggedAt = loggedAtProp.date?.start ?? null;
    if ("created_time" in loggedAtProp) loggedAt = loggedAtProp.created_time ?? null;
  }
  if (!loggedAt) return null;

  const foodProp = props[PROPERTY_NAMES.title] as NotionTitleProperty | NotionTextProperty | undefined;
  const food = extractFoodName(foodProp) ?? "Unknown";
  const macros = extractMacros(props);

  return {
    pageId: page.id,
    date: loggedAt.slice(0, 10),
    loggedAt,
    food,
    macros,
  };
}

function extractFoodName(
  prop: NotionTitleProperty | NotionTextProperty | undefined,
): string | null {
  if (!prop) return null;
  if ("title" in prop) {
    const value = prop.title?.map((item) => item.plain_text).join("").trim();
    return value ? value : null;
  }
  if ("rich_text" in prop) {
    const value = prop.rich_text?.map((item) => item.plain_text).join("").trim();
    return value ? value : null;
  }
  return null;
}

function extractMacros(
  props: Record<
    string,
    NotionDateProperty | NotionNumberProperty | NotionTextProperty | NotionTitleProperty | unknown
  >,
): Partial<Record<MacroKey, number>> {
  const macros: Partial<Record<MacroKey, number>> = {};
  for (const key of Object.keys(PROPERTY_NAMES.macros) as MacroKey[]) {
    const propName = PROPERTY_NAMES.macros[key];
    const value = (props[propName] as NotionNumberProperty | undefined)?.number;
    if (typeof value === "number") macros[key] = value;
  }
  return macros;
}

function shouldEnrich(entry: Entry): boolean {
  return (
    entry.macros.calories === undefined ||
    entry.macros.protein === undefined ||
    entry.macros.carbs === undefined ||
    entry.macros.fat === undefined
  );
}

async function fetchNutrition(
  foodName: string,
  openai: OpenAI,
): Promise<{
  macros: Partial<Record<MacroKey, number>>;
} | null> {
  const prompt = buildNutritionPrompt(foodName);

  const completion = await openai.chat.completions.create({
    model: "gpt-5-nano",
    messages: [
      {
        role: "system",
        content:
          "You estimate nutrition macros from short food descriptions. " +
          "Respond with a single JSON object with numeric fields: " +
          "calories, protein, carbs, fat, fiber, sugar, sodium. " +
          "Use grams for macros and milligrams for sodium. " +
          "If unsure, make a reasonable estimate. No extra text.",
      },
      { role: "user", content: prompt },
    ],
    max_tokens: 120,
  });

  const text = completion.choices[0]?.message?.content?.trim();
  if (!text) return null;
  const parsed = safeParseJson(text);
  if (!parsed || typeof parsed !== "object") return null;
  const macros = coerceMacros(parsed as Record<string, unknown>);
  if (!Object.keys(macros).length) return null;
  return { macros };
}

function buildNutritionProperties(macros: Partial<Record<MacroKey, number>>): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  if (macros.calories !== undefined) props[PROPERTY_NAMES.macros.calories] = { number: macros.calories };
  if (macros.protein !== undefined) props[PROPERTY_NAMES.macros.protein] = { number: macros.protein };
  if (macros.carbs !== undefined) props[PROPERTY_NAMES.macros.carbs] = { number: macros.carbs };
  if (macros.fat !== undefined) props[PROPERTY_NAMES.macros.fat] = { number: macros.fat };
  if (macros.fiber !== undefined) props[PROPERTY_NAMES.macros.fiber] = { number: macros.fiber };
  if (macros.sugar !== undefined) props[PROPERTY_NAMES.macros.sugar] = { number: macros.sugar };
  if (macros.sodium !== undefined) props[PROPERTY_NAMES.macros.sodium] = { number: macros.sodium };
  return props;
}

function roundNumber(value: number): number {
  return Number(value.toFixed(2));
}

function buildNutritionPrompt(food: string): string {
  return `Estimate macros for: "${food}". Assume a typical single serving.`;
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function coerceMacros(value: Record<string, unknown>): Partial<Record<MacroKey, number>> {
  const macros: Partial<Record<MacroKey, number>> = {};
  macros.calories = coerceNumber(value.calories);
  macros.protein = coerceNumber(value.protein);
  macros.carbs = coerceNumber(value.carbs);
  macros.fat = coerceNumber(value.fat);
  macros.fiber = coerceNumber(value.fiber);
  macros.sugar = coerceNumber(value.sugar);
  macros.sodium = coerceNumber(value.sodium);
  return Object.fromEntries(
    Object.entries(macros).filter(([, v]) => typeof v === "number" && Number.isFinite(v)),
  ) as Partial<Record<MacroKey, number>>;
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return roundNumber(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return roundNumber(parsed);
  }
  return undefined;
}
