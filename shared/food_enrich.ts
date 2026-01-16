import {
  type NotionCreatedTimeProperty,
  type NotionDateProperty,
  type NotionNumberProperty,
  type NotionPage,
  type NotionTextProperty,
  type NotionTitleProperty,
} from "./notion.ts";

export type MacroKey = "calories" | "protein" | "carbs" | "fat" | "fiber" | "sugar" | "sodium";

export type Entry = {
  pageId: string;
  date: string;
  loggedAt: string;
  food: string;
  macros: Partial<Record<MacroKey, number>>;
};

export const PROPERTY_NAMES = {
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

export function parseEntry(page: NotionPage): Entry | null {
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

export function extractFoodName(
  prop:
    | NotionTitleProperty
    | NotionTextProperty
    | undefined,
): string | null {
  // Normalize Notion title/rich_text into a single plain string.
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

export function extractMacros(
  props: Record<string, NotionDateProperty | NotionNumberProperty | NotionTextProperty | NotionTitleProperty | unknown>,
): Partial<Record<MacroKey, number>> {
  const macros: Partial<Record<MacroKey, number>> = {};
  for (const key of Object.keys(PROPERTY_NAMES.macros) as MacroKey[]) {
    const propName = PROPERTY_NAMES.macros[key];
    const value = (props[propName] as NotionNumberProperty | undefined)?.number;
    if (typeof value === "number") macros[key] = value;
  }
  return macros;
}

export function shouldEnrich(entry: Entry): boolean {
  return (
    entry.macros.calories === undefined ||
    entry.macros.protein === undefined ||
    entry.macros.carbs === undefined ||
    entry.macros.fat === undefined
  );
}

export function buildNutritionProperties(macros: Partial<Record<MacroKey, number>>): Record<string, unknown> {
  // Shape Notion property updates for numeric columns only.
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

export function roundNumber(value: number): number {
  return Number(value.toFixed(2));
}

export function buildNutritionPrompt(food: string): string {
  return `Estimate macros for: "${food}". Assume a typical single serving.`;
}

export function safeParseJson(value: string): unknown {
  // Guard against non-JSON responses from the model.
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function coerceMacros(value: Record<string, unknown>): Partial<Record<MacroKey, number>> {
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

export function coerceNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return roundNumber(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return roundNumber(parsed);
  }
  return undefined;
}
