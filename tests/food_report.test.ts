import {
  buildNutritionProperties,
  buildNutritionPrompt,
  coerceMacros,
  coerceNumber,
  extractFoodName,
  extractMacros,
  parseEntry,
  PROPERTY_NAMES,
  roundNumber,
  safeParseJson,
  shouldEnrich,
  type Entry,
  buildFoodRollup,
} from "../shared/food_enrich.ts";
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("extractFoodName handles title and rich text", () => {
  const titleName = extractFoodName({
    title: [{ plain_text: "cheese omelette" }],
  });
  assertEquals(titleName, "cheese omelette");

  const richTextName = extractFoodName({
    rich_text: [{ plain_text: "  tofu bowl  " }],
  });
  assertEquals(richTextName, "tofu bowl");

  const missingName = extractFoodName(undefined);
  assertEquals(missingName, null);
});

Deno.test("parseEntry uses Created time and extracts food/macros", () => {
  const page = {
    id: "page-1",
    properties: {
      [PROPERTY_NAMES.loggedAt]: { created_time: "2026-01-16T14:12:00.000Z" },
      [PROPERTY_NAMES.title]: { title: [{ plain_text: "cheese omelette" }] },
      [PROPERTY_NAMES.macros.calories]: { number: 320 },
      [PROPERTY_NAMES.macros.protein]: { number: 18 },
      [PROPERTY_NAMES.macros.carbs]: { number: null },
    },
  };
  const entry = parseEntry(page);
  assert(entry);
  assertEquals(entry.pageId, "page-1");
  assertEquals(entry.date, "2026-01-16");
  assertEquals(entry.food, "cheese omelette");
  assertEquals(entry.macros, { calories: 320, protein: 18 });
});

Deno.test("parseEntry ignores pages without a timestamp", () => {
  const page = {
    id: "page-2",
    properties: {
      [PROPERTY_NAMES.title]: { title: [{ plain_text: "missing time" }] },
    },
  };
  const entry = parseEntry(page);
  assertEquals(entry, null);
});

Deno.test("extractMacros only returns numeric values", () => {
  const macros = extractMacros({
    [PROPERTY_NAMES.macros.calories]: { number: 300 },
    [PROPERTY_NAMES.macros.protein]: { number: null },
    [PROPERTY_NAMES.macros.carbs]: { number: 12 },
    [PROPERTY_NAMES.macros.fat]: { number: "10" },
  });
  assertEquals(macros, { calories: 300, carbs: 12 });
});

Deno.test("shouldEnrich returns true if any core macros are missing", () => {
  const base: Entry = {
    pageId: "page-3",
    date: "2026-01-16",
    loggedAt: "2026-01-16T10:00:00.000Z",
    food: "toast",
    macros: { calories: 200, protein: 8, carbs: 20, fat: 4 },
  };
  assertEquals(shouldEnrich(base), false);
  assertEquals(shouldEnrich({ ...base, macros: { ...base.macros, fat: undefined } }), true);
});

Deno.test("buildNutritionProperties maps to Notion property names", () => {
  const props = buildNutritionProperties({
    calories: 120,
    protein: 6,
    carbs: 10,
    fat: 4,
    fiber: 2,
    sugar: 1,
    sodium: 300,
  });
  assertEquals(props, {
    [PROPERTY_NAMES.macros.calories]: { number: 120 },
    [PROPERTY_NAMES.macros.protein]: { number: 6 },
    [PROPERTY_NAMES.macros.carbs]: { number: 10 },
    [PROPERTY_NAMES.macros.fat]: { number: 4 },
    [PROPERTY_NAMES.macros.fiber]: { number: 2 },
    [PROPERTY_NAMES.macros.sugar]: { number: 1 },
    [PROPERTY_NAMES.macros.sodium]: { number: 300 },
  });
});

Deno.test("buildNutritionPrompt includes the food text", () => {
  const prompt = buildNutritionPrompt("cheese omelette");
  assertStringIncludes(prompt, "cheese omelette");
});

Deno.test("safeParseJson returns null for invalid JSON", () => {
  assertEquals(safeParseJson("{oops}"), null);
  assertEquals(safeParseJson(""), null);
  assertEquals(safeParseJson('{"ok":true}'), { ok: true });
});

Deno.test("coerceNumber handles strings and rounds", () => {
  assertEquals(coerceNumber(2.345), 2.35);
  assertEquals(coerceNumber("12.1"), 12.1);
  assertEquals(coerceNumber("bad"), undefined);
});

Deno.test("coerceMacros filters invalid fields", () => {
  const macros = coerceMacros({
    calories: "100.4",
    protein: 12,
    carbs: "bad",
    fat: null,
    fiber: 3.333,
    sugar: "4.2",
    sodium: "350",
  });
  assertEquals(macros, {
    calories: 100.4,
    protein: 12,
    fiber: 3.33,
    sugar: 4.2,
    sodium: 350,
  });
});

Deno.test("roundNumber rounds to two decimals", () => {
  assertEquals(roundNumber(3.14159), 3.14);
});

Deno.test("buildFoodRollup aggregates weekly stats", () => {
  const entries: Entry[] = [
    {
      pageId: "page-1",
      date: "2026-01-01",
      loggedAt: "2026-01-01T12:00:00.000Z",
      food: "toast",
      macros: { calories: 100, protein: 4 },
    },
    {
      pageId: "page-2",
      date: "2026-01-02",
      loggedAt: "2026-01-02T12:00:00.000Z",
      food: "eggs",
      macros: { calories: 200, protein: 12 },
    },
  ];
  const rollup = buildFoodRollup(entries, "2026-01-01", "2026-01-07");
  assertEquals(rollup.category, "food");
  assertEquals(rollup.stats.totalEntries, 2);
  assertEquals(rollup.stats.uniqueDays, 2);
  assertEquals(rollup.stats.entriesByDate["2026-01-01"], 1);
  assertEquals(rollup.stats.entriesByDate["2026-01-02"], 1);
  assertEquals(rollup.runId, "food-2026-01-01-2026-01-07");
});
