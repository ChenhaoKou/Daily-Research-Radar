import { aclAnthologyAdapter } from "./acl-anthology";
import { acmCrossrefAdapter } from "./acm-crossref";
import { arxivAdapter } from "./arxiv";
import { dblpAdapter } from "./dblp";
import { ieeeAdapter } from "./ieee";
import { openReviewAdapter } from "./openreview";
import { papersWithCodeAdapter } from "./papers-with-code";
import { semanticScholarAdapter } from "./semantic-scholar";
import type { SourceAdapter, SourceResult, SourceSearchOptions } from "./types";

/**
 * 默认启用的论文数据源。
 *
 * Papers with Code 和 ACL Anthology 不在默认列表里：
 * - paperswithcode.com 已经下线公开 JSON API，所有 /api/v1/papers/
 *   等端点都返回 SPA 的 HTML（验证日期 2026-05）。
 *   `detectViaPapersWithCode` 仍保留作为开源识别的兜底，但找不到也不影响主流程。
 * - aclanthology.org/search 改成了纯前端 Google Custom Search，
 *   服务端 HTML 已经没有论文列表可解析。
 *   实际的 ACL/EMNLP/NAACL 论文 DBLP 已经覆盖了。
 *
 * 想强行加回去可以设 `INCLUDE_OPTIONAL_SOURCES=1`。
 */
const defaultSources: SourceAdapter[] = [
  arxivAdapter,
  openReviewAdapter,
  semanticScholarAdapter,
  dblpAdapter,
  ieeeAdapter,
  acmCrossrefAdapter,
];

const optionalSources: SourceAdapter[] = [papersWithCodeAdapter, aclAnthologyAdapter];

export const sourceAdapters: SourceAdapter[] =
  process.env.INCLUDE_OPTIONAL_SOURCES === "1" ? [...defaultSources, ...optionalSources] : defaultSources;

const searchCache = new Map<string, Promise<SourceResult[]>>();

/**
 * 跨 topic 共享同一个 (keyword, options) 的抓取结果，避免对
 * arXiv / Semantic Scholar 这类带速率限制的接口重复发请求。
 */
export function searchAllSources(keyword: string, options: SourceSearchOptions): Promise<SourceResult[]> {
  const cacheKey = `${keyword.toLowerCase()}::${options.daysBack}::${options.limit}`;
  const cached = searchCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pending = runAllSources(keyword, options);
  searchCache.set(cacheKey, pending);
  return pending;
}

export function clearSearchCache() {
  searchCache.clear();
}

async function runAllSources(keyword: string, options: SourceSearchOptions): Promise<SourceResult[]> {
  const results = await Promise.allSettled(
    sourceAdapters.map((adapter) => adapter.search(keyword, options)),
  );

  return results.map((result, index) => {
    const source = sourceAdapters[index].name;

    if (result.status === "fulfilled") {
      return {
        source,
        papers: result.value,
      };
    }

    const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
    return {
      source,
      papers: [],
      [isTransientSourceError(message) ? "warning" : "error"]: message,
    };
  });
}

function isTransientSourceError(message: string): boolean {
  return (
    message.includes("429") ||
    message.includes("503") ||
    message.includes("504") ||
    message.toLowerCase().includes("timeout") ||
    message.toLowerCase().includes("aborted") ||
    message.toLowerCase().includes("rate limit") ||
    message.toLowerCase().includes("econnreset")
  );
}

export type { PaperSourceName, SourcePaper, SourceResult, SourceSearchOptions } from "./types";
export { normalizeTitle } from "./utils";
