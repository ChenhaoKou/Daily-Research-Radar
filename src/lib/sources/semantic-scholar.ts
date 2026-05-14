import type { SourceAdapter, SourcePaper } from "./types";
import { cleanText, fetchJson, isRecent, parseDate } from "./utils";

type SemanticPaper = {
  paperId?: string;
  title?: string;
  abstract?: string;
  authors?: Array<{ name?: string }>;
  venue?: string;
  publicationDate?: string;
  year?: number;
  url?: string;
  externalIds?: {
    DOI?: string;
    ArXiv?: string;
  };
  openAccessPdf?: {
    url?: string;
  };
};

type SemanticResponse = {
  data?: SemanticPaper[];
};

export const semanticScholarAdapter: SourceAdapter = {
  name: "semantic_scholar",
  label: "Semantic Scholar",
  async search(keyword, options) {
    const params = new URLSearchParams({
      query: keyword,
      limit: String(options.limit),
      fields: [
        "title",
        "abstract",
        "authors",
        "venue",
        "publicationDate",
        "year",
        "url",
        "externalIds",
        "openAccessPdf",
      ].join(","),
    });

    const response = await fetchJson<SemanticResponse>(
      `https://api.semanticscholar.org/graph/v1/paper/search?${params.toString()}`,
    );

    return (response.data ?? []).map(toPaper).filter((paper): paper is SourcePaper => {
      return Boolean(paper?.title) && isRecent(paper?.publishedAt, options.daysBack);
    });
  },
};

function toPaper(paper: SemanticPaper): SourcePaper | undefined {
  const title = cleanText(paper.title);
  const sourceId = cleanText(paper.paperId);

  if (!title || !sourceId) {
    return undefined;
  }

  const yearDate = paper.year ? new Date(Date.UTC(paper.year, 0, 1)) : undefined;

  return {
    source: "semantic_scholar",
    sourceId,
    title,
    abstract: cleanText(paper.abstract),
    authors: paper.authors?.map((author) => cleanText(author.name)).filter((name): name is string => Boolean(name)),
    venue: cleanText(paper.venue),
    publishedAt: parseDate(paper.publicationDate) ?? yearDate,
    url: cleanText(paper.url),
    pdfUrl: cleanText(paper.openAccessPdf?.url),
    doi: cleanText(paper.externalIds?.DOI),
    arxivId: cleanText(paper.externalIds?.ArXiv),
    semanticScholarId: sourceId,
  };
}
