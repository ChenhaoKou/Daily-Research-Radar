export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function cutoffDate(daysBack: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysBack);
  return date;
}

export function isRecent(date: Date | undefined, daysBack: number): boolean {
  if (!date) {
    return true;
  }

  return date >= cutoffDate(daysBack);
}

export function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

export function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > 0 ? clean : undefined;
}

export function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function fetchText(url: string, timeoutMs = 15000): Promise<string> {
  const response = await fetchWithRetry(url, {
    headers: {
      "User-Agent": "paper-tracker/0.1 (+https://localhost)",
    },
    timeoutMs,
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.text();
}

export async function fetchJson<T>(url: string, timeoutMs = 15000): Promise<T> {
  const response = await fetchWithRetry(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "paper-tracker/0.1 (+https://localhost)",
    },
    timeoutMs,
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(`Expected JSON but received ${contentType || "unknown content type"}`);
  }

  return response.json() as Promise<T>;
}

export function compact<T>(items: Array<T | undefined | null>): T[] {
  return items.filter((item): item is T => item !== undefined && item !== null);
}

async function fetchWithRetry(
  url: string,
  options: {
    headers: Record<string, string>;
    timeoutMs: number;
  },
) {
  const maxAttempts = 2;
  let lastResponse: Response | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url, {
      headers: options.headers,
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    lastResponse = response;

    if (response.status !== 429 && response.status < 500) {
      return response;
    }

    if (attempt < maxAttempts) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await delay(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 3000);
    }
  }

  return lastResponse as Response;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
