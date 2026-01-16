import { getWeeklyRange } from "../shared/date.ts";
import { OpenAI } from "https://esm.town/v/std/openai";
import { fetchNotionPages, type NotionPage, updateNotionPage } from "../shared/notion.ts";
import {
  buildNutritionPrompt,
  buildNutritionProperties,
  coerceMacros,
  type Entry,
  type MacroKey,
  parseEntry,
  PROPERTY_NAMES,
  safeParseJson,
  shouldEnrich,
} from "../shared/food_enrich.ts";

type NotionConfig = {
  token: string;
  databaseId: string;
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
