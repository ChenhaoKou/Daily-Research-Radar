import type { SourceAdapter, SourcePaper } from "./types";
import { asArray, cleanText, fetchJson, isRecent } from "./utils";

type DblpPerson = string | { text?: string };

type DblpHit = {
  "@id"?: string;
  info?: {
    title?: string;
    authors?: {
      author?: DblpPerson | DblpPerson[];
    };
    venue?: string;
    year?: string;
    type?: string;
    doi?: string;
    ee?: string;
    url?: string;
  };
};

type DblpResponse = {
  result?: {
    hits?: {
      hit?: DblpHit | DblpHit[];
    };
  };
};

export const dblpAdapter: SourceAdapter = {
  name: "dblp",
  label: "DBLP",
  async search(keyword, options) {
    const params = new URLSearchParams({
      q: keyword,
      format: "json",
      h: String(Math.min(options.limit * 3, 100)),
    });
    const response = await fetchJson<DblpResponse>(`https://dblp.org/search/publ/api?${params.toString()}`);

    return asArray(response.result?.hits?.hit)
      .map(toPaper)
      .filter((paper): paper is SourcePaper => Boolean(paper?.title) && isRecent(paper?.publishedAt, options.daysBack))
      .slice(0, options.limit);
  },
};

function toPaper(hit: DblpHit): SourcePaper | undefined {
  const title = cleanText(hit.info?.title?.replace(/\.$/, ""));
  const sourceId = cleanText(hit["@id"] ?? hit.info?.doi ?? hit.info?.url);

  if (!title || !sourceId) {
    return undefined;
  }

  return {
    source: "dblp",
    sourceId,
    title,
    authors: asArray(hit.info?.authors?.author)
      .map((author) => cleanText(typeof author === "string" ? author : author.text))
      .filter((author): author is string => Boolean(author)),
    venue: cleanText(hit.info?.venue),
    publishedAt: parseYear(hit.info?.year),
    url: cleanText(hit.info?.ee ?? hit.info?.url),
    doi: cleanText(hit.info?.doi),
  };
}

function parseYear(year: string | undefined): Date | undefined {
  const parsed = Number(year);

  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return new Date(Date.UTC(parsed, 0, 1));
}
