import type { MacroKey } from "./food_enrich.ts";
import { roundNumber } from "./food_enrich.ts";

export type FatSecretConfig = {
  clientId: string;
  clientSecret: string;
};

const TOKEN_URL = "https://oauth.fatsecret.com/connect/token";
const SEARCH_URL = "https://platform.fatsecret.com/rest/foods/search/v1";
const FOOD_GET_URL = "https://platform.fatsecret.com/rest/food/v2";

export function getFatSecretConfig(): FatSecretConfig | null {
  const clientId = Deno.env.get("FATSECRET_CLIENT_ID");
  const clientSecret = Deno.env.get("FATSECRET_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export async function requestAccessToken(config: FatSecretConfig): Promise<string> {
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  const basic = btoa(`${config.clientId}:${config.clientSecret}`);
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!resp.ok) {
    throw new Error(`FatSecret token request failed: ${resp.status} ${resp.statusText}`);
  }

  const payload = await resp.json() as Record<string, unknown>;
  const token = payload.access_token;
  if (typeof token !== "string") {
    throw new Error(`FatSecret token response missing access_token.`);
  }
  return token;
}

export async function fetchFoodMacros(
  term: string,
  token: string,
): Promise<Partial<Record<MacroKey, number>> | null> {
  const foodId = await fetchFoodId(term, token);
  if (foodId) {
    const detailed = await fetchFoodDetails(foodId, token);
    if (detailed && Object.keys(detailed).length) return detailed;
  }

  const params = new URLSearchParams({
    search_expression: term,
    max_results: "1",
    format: "json",
  });
  const resp = await fetch(`${SEARCH_URL}?${params.toString()}`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`FatSecret search failed: ${resp.status} ${resp.statusText} ${text}`);
  }
  const payload = text ? JSON.parse(text) as Record<string, unknown> : {};
  const foods = payload.foods as Record<string, unknown> | undefined;
  const list = foods?.food;
  const first = Array.isArray(list) ? list[0] : list;
  if (!first || typeof first !== "object") return null;

  const food = first as Record<string, string>;
  const nutrition = parseFoodDescription(food.food_description);
  if (!nutrition) return null;

  const macros: Partial<Record<MacroKey, number>> = {};
  if (nutrition.calories !== undefined) macros.calories = roundNumber(nutrition.calories);
  if (nutrition.protein !== undefined) macros.protein = roundNumber(nutrition.protein);
  if (nutrition.carbs !== undefined) macros.carbs = roundNumber(nutrition.carbs);
  if (nutrition.fat !== undefined) macros.fat = roundNumber(nutrition.fat);
  if (nutrition.fiber !== undefined) macros.fiber = roundNumber(nutrition.fiber);
  if (nutrition.sugar !== undefined) macros.sugar = roundNumber(nutrition.sugar);
  if (nutrition.sodium !== undefined) macros.sodium = roundNumber(nutrition.sodium);
  return Object.keys(macros).length ? macros : null;
}

export function sumIfComplete(values: Array<number | undefined>): number | undefined {
  if (!values.length) return undefined;
  if (values.some((value) => typeof value !== "number")) return undefined;
  const total = values.reduce((acc, value) => acc + (value ?? 0), 0);
  return roundNumber(total);
}

async function fetchFoodId(term: string, token: string): Promise<string | null> {
  const params = new URLSearchParams({
    search_expression: term,
    max_results: "1",
    format: "json",
  });
  const resp = await fetch(`${SEARCH_URL}?${params.toString()}`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`FatSecret search failed: ${resp.status} ${resp.statusText} ${text}`);
  }
  const payload = text ? JSON.parse(text) as Record<string, unknown> : {};
  const foods = payload.foods as Record<string, unknown> | undefined;
  const list = foods?.food;
  const first = Array.isArray(list) ? list[0] : list;
  if (!first || typeof first !== "object") return null;
  const food = first as Record<string, string>;
  return typeof food.food_id === "string" ? food.food_id : null;
}

async function fetchFoodDetails(foodId: string, token: string): Promise<Partial<Record<MacroKey, number>> | null> {
  const params = new URLSearchParams({
    food_id: foodId,
    format: "json",
  });
  const resp = await fetch(`${FOOD_GET_URL}?${params.toString()}`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`FatSecret food.get failed: ${resp.status} ${resp.statusText} ${text}`);
  }
  const payload = text ? JSON.parse(text) as Record<string, unknown> : {};
  const food = payload.food as Record<string, unknown> | undefined;
  if (!food) return null;
  const servings = (food.servings as Record<string, unknown> | undefined)?.serving;
  const serving = Array.isArray(servings) ? servings[0] : servings;
  if (!serving || typeof serving !== "object") return null;

  const macros: Partial<Record<MacroKey, number>> = {};
  const record = serving as Record<string, unknown>;
  const calories = toNumber(record.calories);
  const protein = toNumber(record.protein);
  const carbs = toNumber(record.carbohydrate);
  const fat = toNumber(record.fat);
  const fiber = toNumber(record.fiber);
  const sugar = toNumber(record.sugar);
  const sodium = toNumber(record.sodium);

  if (calories !== undefined) macros.calories = roundNumber(calories);
  if (protein !== undefined) macros.protein = roundNumber(protein);
  if (carbs !== undefined) macros.carbs = roundNumber(carbs);
  if (fat !== undefined) macros.fat = roundNumber(fat);
  if (fiber !== undefined) macros.fiber = roundNumber(fiber);
  if (sugar !== undefined) macros.sugar = roundNumber(sugar);
  if (sodium !== undefined) macros.sodium = roundNumber(sodium);

  return Object.keys(macros).length ? macros : null;
}

function parseFoodDescription(desc?: string): {
  calories?: number;
  fat?: number;
  carbs?: number;
  protein?: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
} | null {
  if (!desc) return null;
  const caloriesMatch = desc.match(/Calories:\s*([0-9.]+)kcal/i);
  const fatMatch = desc.match(/Fat:\s*([0-9.]+)g/i);
  const carbsMatch = desc.match(/Carbs:\s*([0-9.]+)g/i);
  const proteinMatch = desc.match(/Protein:\s*([0-9.]+)g/i);
  const fiberMatch = desc.match(/(?:Dietary\s+)?Fiber:\s*([0-9.]+)g/i);
  const sugarMatch = desc.match(/Sugar[s]?:\s*([0-9.]+)g/i);
  const sodiumMatch = desc.match(/Sodium:\s*([0-9.]+)mg/i);

  return {
    calories: caloriesMatch ? Number(caloriesMatch[1]) : undefined,
    fat: fatMatch ? Number(fatMatch[1]) : undefined,
    carbs: carbsMatch ? Number(carbsMatch[1]) : undefined,
    protein: proteinMatch ? Number(proteinMatch[1]) : undefined,
    fiber: fiberMatch ? Number(fiberMatch[1]) : undefined,
    sugar: sugarMatch ? Number(sugarMatch[1]) : undefined,
    sodium: sodiumMatch ? Number(sodiumMatch[1]) : undefined,
  };
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}
