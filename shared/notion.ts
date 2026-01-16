export const NOTION_VERSION = "2022-06-28";

// Minimal Notion types used by the collectors.
export type NotionRichText = { plain_text: string };
export type NotionDateProperty = { date: { start: string } | null };
export type NotionNumberProperty = { number: number | null };
export type NotionTextProperty = { rich_text: NotionRichText[] };
export type NotionCreatedTimeProperty = { created_time: string };
export type NotionTitleProperty = { title: NotionRichText[] };

export type NotionPage = {
  id: string;
  properties: Record<string, unknown>;
};

export type NotionQueryResponse = {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
};

// Fetch all pages from a Notion database (handles pagination).
export async function fetchNotionPages<T extends NotionPage>(
  databaseId: string,
  token: string,
  buildBody: (cursor?: string) => Record<string, unknown>,
): Promise<T[]> {
  const url = `https://api.notion.com/v1/databases/${databaseId}/query`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };

  const pages: T[] = [];
  let cursor: string | null | undefined;

  do {
    const body = buildBody(cursor ?? undefined);
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Notion query failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as unknown;
    if (!isNotionQueryResponse(data)) {
      throw new Error("Notion query returned unexpected shape.");
    }

    pages.push(...(data.results as T[]));
    cursor = data.has_more && data.next_cursor ? data.next_cursor : undefined;
  } while (cursor);

  return pages;
}

// Update a Notion page's properties.
export async function updateNotionPage(
  pageId: string,
  token: string,
  properties: Record<string, unknown>,
): Promise<void> {
  const url = `https://api.notion.com/v1/pages/${pageId}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };

  const response = await fetch(url, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ properties }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Notion update failed: ${response.status} ${text}`);
  }
}

// Runtime guard for Notion query responses.
function isNotionQueryResponse(value: unknown): value is NotionQueryResponse {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.results) &&
    typeof record.has_more === "boolean" &&
    (typeof record.next_cursor === "string" || record.next_cursor === null)
  );
}
