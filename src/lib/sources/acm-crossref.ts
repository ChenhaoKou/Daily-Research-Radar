import type { SourceAdapter, SourcePaper } from "./types";
import { cleanText, cutoffDate, fetchJson, isRecent } from "./utils";

type CrossrefWork = {
  DOI?: string;
  title?: string[];
  abstract?: string;
  author?: Array<{ given?: string; family?: string }>;
  "container-title"?: string[];
  URL?: string;
  published?: {
    "date-parts"?: number[][];
  };
};

type CrossrefResponse = {
  message?: {
    items?: CrossrefWork[];
  };
};

export const acmCrossrefAdapter: SourceAdapter = {
  name: "acm_crossref",
  label: "ACM Digital Library",
  async search(keyword, options) {
    const fromDate = cutoffDate(options.daysBack).toISOString().slice(0, 10);
    const params = new URLSearchParams({
      "query.bibliographic": keyword,
      filter: `from-pub-date:${fromDate},member:320`,
      rows: String(options.limit),
      sort: "published",
      order: "desc",
    });

    const response = await fetchJson<CrossrefResponse>(`https://api.crossref.org/works?${params.toString()}`);

    return (response.message?.items ?? []).map(toPaper).filter((paper): paper is SourcePaper => {
      return Boolean(paper?.title) && isRecent(paper?.publishedAt, options.daysBack);
    });
  },
};

function toPaper(work: CrossrefWork): SourcePaper | undefined {
  const title = cleanText(work.title?.[0]);
  const doi = cleanText(work.DOI);

  if (!title || !doi) {
    return undefined;
  }

  return {
    source: "acm_crossref",
    sourceId: doi,
    title,
    abstract: cleanText(stripXml(work.abstract)),
    authors: work.author
      ?.map((author) => cleanText(`${author.given ?? ""} ${author.family ?? ""}`))
      .filter((author): author is string => Boolean(author)),
    venue: cleanText(work["container-title"]?.[0]),
    publishedAt: parseDateParts(work.published?.["date-parts"]?.[0]),
    url: cleanText(work.URL),
    doi,
  };
}

function parseDateParts(parts: number[] | undefined): Date | undefined {
  if (!parts?.[0]) {
    return undefined;
  }

  return new Date(Date.UTC(parts[0], (parts[1] ?? 1) - 1, parts[2] ?? 1));
}

function stripXml(value: string | undefined): string | undefined {
  return value?.replace(/<[^>]+>/g, " ");
}
