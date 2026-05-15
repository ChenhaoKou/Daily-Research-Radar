import { XMLParser } from "fast-xml-parser";
import type { SourceAdapter, SourcePaper } from "./types";
import { asArray, cleanText, fetchText, isRecent, parseDate } from "./utils";

type ArxivAuthor = {
  name?: string;
};

type ArxivLink = {
  href?: string;
  title?: string;
  type?: string;
  rel?: string;
};

type ArxivEntry = {
  id?: string;
  title?: string;
  summary?: string;
  published?: string;
  updated?: string;
  author?: ArxivAuthor | ArxivAuthor[];
  "arxiv:doi"?: string;
  "arxiv:journal_ref"?: string;
  "arxiv:comment"?: string;
  link?: ArxivLink | ArxivLink[];
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
    // 多词 keyword 必须包成短语，否则 arXiv 把它当 AND，召回质量很差。
    const phrase = keyword.includes(" ") ? `"${keyword}"` : keyword;
    const params = new URLSearchParams({
      search_query: `all:${phrase}`,
      start: "0",
      max_results: String(options.limit),
      sortBy: "submittedDate",
      sortOrder: "descending",
    });

    const xml = await fetchText(`https://export.arxiv.org/api/query?${params.toString()}`);
    const feed = parser.parse(xml) as ArxivFeed;
    const entries = asArray(feed.feed?.entry);

    return entries
      .map(toPaper)
      .filter((paper): paper is SourcePaper => Boolean(paper?.title) && isRecent(paper?.publishedAt, options.daysBack));
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
  const url = links.find((link) => link.title !== "pdf" && link.rel !== "related")?.href ?? id;
  const authors = asArray(entry.author)
    .map((author) => cleanText(author.name))
    .filter((author): author is string => Boolean(author));

  // arXiv 自报 journal_ref / comment 里常常带"To appear in CVPR 2024"之类的会议线索。
  // 抓出来给后续 quality-venue 匹配用。
  const venue = inferVenue(entry);

  return {
    source: "arxiv",
    sourceId: arxivId ?? id,
    title,
    abstract: cleanText(entry.summary),
    authors,
    venue,
    publishedAt: parseDate(entry.published ?? entry.updated),
    url,
    pdfUrl,
    doi: cleanText(entry["arxiv:doi"]),
    arxivId,
  };
}

function inferVenue(entry: ArxivEntry): string | undefined {
  const journalRef = cleanText(entry["arxiv:journal_ref"]);
  if (journalRef) {
    return journalRef;
  }

  const comment = cleanText(entry["arxiv:comment"]);
  if (!comment) {
    return undefined;
  }

  // e.g. "Accepted by CVPR 2024", "To appear in NeurIPS 2023 (oral)"
  const match = comment.match(
    /(?:accepted (?:by|at|to)|to appear (?:in|at)|published (?:in|at)|appeared (?:in|at))\s+([^.;()]+)/i,
  );
  return match?.[1]?.trim();
}
