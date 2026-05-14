import { aclAnthologyAdapter } from "./acl-anthology";
import { acmCrossrefAdapter } from "./acm-crossref";
import { arxivAdapter } from "./arxiv";
import { ieeeAdapter } from "./ieee";
import { openReviewAdapter } from "./openreview";
import { papersWithCodeAdapter } from "./papers-with-code";
import { semanticScholarAdapter } from "./semantic-scholar";
import type { SourceAdapter, SourceResult, SourceSearchOptions } from "./types";

export const sourceAdapters: SourceAdapter[] = [
  arxivAdapter,
  openReviewAdapter,
  semanticScholarAdapter,
  papersWithCodeAdapter,
  aclAnthologyAdapter,
  ieeeAdapter,
  acmCrossrefAdapter,
];

export async function searchAllSources(keyword: string, options: SourceSearchOptions): Promise<SourceResult[]> {
  const results = await Promise.allSettled(sourceAdapters.map((adapter) => adapter.search(keyword, options)));

  return results.map((result, index) => {
    const source = sourceAdapters[index].name;

    if (result.status === "fulfilled") {
      return {
        source,
        papers: result.value,
      };
    }

    return {
      source,
      papers: [],
      [isTransientSourceError(result.reason) ? "warning" : "error"]:
        result.reason instanceof Error ? result.reason.message : String(result.reason),
    };
  });
}

function isTransientSourceError(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason);

  return (
    message.includes("429") ||
    message.includes("503") ||
    message.includes("504") ||
    message.toLowerCase().includes("timeout") ||
    message.toLowerCase().includes("rate limit")
  );
}

export type { PaperSourceName, SourcePaper, SourceResult, SourceSearchOptions } from "./types";
export { normalizeTitle } from "./utils";
