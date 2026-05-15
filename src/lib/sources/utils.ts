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
    // 抓取阶段宽松放行无日期的论文；展示层会再按日期过滤。
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

export function compact<T>(items: Array<T | undefined | null>): T[] {
  return items.filter((item): item is T => item !== undefined && item !== null);
}

const USER_AGENT = "paper-tracker/0.2 (+https://github.com/)";

/**
 * Per-host minimum gap in ms. Tuned to avoid the 429s/timeouts we observed
 * in the first generation run (arXiv and Semantic Scholar were the worst).
 */
const HOST_MIN_GAP_MS: Record<string, number> = {
  "export.arxiv.org": 3500,
  // Semantic Scholar 没有 key 时全网共享 1 req/sec 的全局配额，
  // 多卡几秒能显著降 429。
  "api.semanticscholar.org": 3500,
  "api2.openreview.net": 800,
  "dblp.org": 1500,
  "api.crossref.org": 1000,
  "paperswithcode.com": 1500,
  "aclanthology.org": 1500,
  "ieeexploreapi.ieee.org": 1000,
  "api.github.com": 800,
};

const DEFAULT_HOST_GAP_MS = 500;
const hostQueues = new Map<string, Promise<void>>();

function hostGap(host: string): number {
  return HOST_MIN_GAP_MS[host] ?? DEFAULT_HOST_GAP_MS;
}

function schedule(host: string): Promise<void> {
  const gap = hostGap(host);
  const previous = hostQueues.get(host) ?? Promise.resolve();

  let release!: () => void;
  const slot = new Promise<void>((resolve) => {
    release = resolve;
  });

  const next = previous.then(() => slot);
  hostQueues.set(host, next);

  return previous.then(() => {
    setTimeout(release, gap);
  });
}

export type FetchOptions = {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxAttempts?: number;
};

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const response = await fetchWithRetry(url, options);
  await assertOk(url, response);
  return response.text();
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const response = await fetchWithRetry(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers ?? {}),
    },
  });
  await assertOk(url, response);

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json") && !contentType.includes("text/json")) {
    const snippet = (await response.text()).slice(0, 120);
    throw new Error(`Expected JSON from ${url} but got ${contentType || "unknown"}: ${snippet}`);
  }

  return response.json() as Promise<T>;
}

async function assertOk(url: string, response: Response): Promise<void> {
  if (response.ok) {
    return;
  }

  let body = "";
  try {
    body = (await response.text()).slice(0, 120);
  } catch {
    // ignore
  }

  const statusText = response.statusText || "request failed";
  const detail = body ? ` (${body.replace(/\s+/g, " ").trim()})` : "";
  throw new Error(`${response.status} ${statusText} for ${shortUrl(url)}${detail}`);
}

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

async function fetchWithRetry(url: string, options: FetchOptions): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 20000;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 4);
  const headers = {
    "User-Agent": USER_AGENT,
    ...(options.headers ?? {}),
  };

  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    host = "unknown";
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await schedule(host);

    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.status !== 429 && response.status < 500) {
        return response;
      }

      lastError = new Error(`${response.status} ${response.statusText}`);

      if (attempt < maxAttempts) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const backoff = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(15000, 1000 * 2 ** attempt);
        await delay(backoff);
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;

      if (attempt >= maxAttempts) {
        throw error;
      }

      await delay(Math.min(15000, 1000 * 2 ** attempt));
    }
  }

  throw lastError ?? new Error(`fetchWithRetry: exhausted retries for ${shortUrl(url)}`);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
