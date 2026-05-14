import { XMLParser } from "fast-xml-parser";
import type { SourceAdapter, SourcePaper } from "./types";
import { asArray, cleanText, fetchText, isRecent, parseDate } from "./utils";

type ArxivAuthor = {
  name?: string;
};

type ArxivEntry = {
  id?: string;
  title?: string;
  summary?: string;
  published?: string;
  updated?: string;
  author?: ArxivAuthor | ArxivAuthor[];
  "arxiv:doi"?: string;
  link?: Array<{ href?: string; title?: string; type?: string }> | { href?: string; title?: string; type?: string };
};

type ArxivFeed = {
  feed?: {
    entry?: ArxivEntry | ArxivEntry[];
  };
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
});

export const arxivAdapter: SourceAdapter = {
  name: "arxiv",
  label: "arXiv",
  async search(keyword, options) {
    const params = new URLSearchParams({
      search_query: `all:${keyword}`,
      start: "0",
      max_results: String(options.limit),
      sortBy: "submittedDate",
      sortOrder: "descending",
    });

    const xml = await fetchText(`https://export.arxiv.org/api/query?${params.toString()}`);
    const feed = parser.parse(xml) as ArxivFeed;
    const entries = asArray(feed.feed?.entry);

    return entries.map(toPaper).filter((paper): paper is SourcePaper => {
      return Boolean(paper?.title) && isRecent(paper?.publishedAt, options.daysBack);
    });
  },
};

function toPaper(entry: ArxivEntry): SourcePaper | undefined {
  const title = cleanText(entry.title);
  const id = cleanText(entry.id);

  if (!title || !id) {
    return undefined;
  }

  const arxivId = id.split("/abs/").at(-1);
  const links = asArray(entry.link);
  const pdfUrl = links.find((link) => link.title === "pdf" || link.type === "application/pdf")?.href;
  const url = links.find((link) => link.title !== "pdf")?.href ?? id;
  const authors = asArray(entry.author)
    .map((author) => cleanText(author.name))
    .filter((author): author is string => Boolean(author));

  return {
    source: "arxiv",
    sourceId: arxivId ?? id,
    title,
    abstract: cleanText(entry.summary),
    authors,
    publishedAt: parseDate(entry.published ?? entry.updated),
    url,
    pdfUrl,
    doi: cleanText(entry["arxiv:doi"]),
    arxivId,
  };
}
