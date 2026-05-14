import type { SourceAdapter, SourcePaper } from "./types";
import { cleanText, fetchJson, isRecent, parseDate } from "./utils";

type PapersWithCodePaper = {
  id?: string;
  title?: string;
  abstract?: string;
  authors?: string[];
  published?: string;
  arxiv_id?: string;
  url_abs?: string;
  url_pdf?: string;
};

type PapersWithCodeResponse = {
  results?: PapersWithCodePaper[];
};

export const papersWithCodeAdapter: SourceAdapter = {
  name: "papers_with_code",
  label: "Papers with Code",
  async search(keyword, options) {
    const params = new URLSearchParams({
      q: keyword,
      items_per_page: String(options.limit),
    });

    let response: PapersWithCodeResponse;

    try {
      response = await fetchJson<PapersWithCodeResponse>(
        `https://paperswithcode.com/api/v1/papers/?${params.toString()}`,
      );
    } catch {
      return [];
    }

    return (response.results ?? []).map(toPaper).filter((paper): paper is SourcePaper => {
      return Boolean(paper?.title) && isRecent(paper?.publishedAt, options.daysBack);
    });
  },
};

function toPaper(paper: PapersWithCodePaper): SourcePaper | undefined {
  const title = cleanText(paper.title);
  const sourceId = cleanText(paper.id);

  if (!title || !sourceId) {
    return undefined;
  }

  return {
    source: "papers_with_code",
    sourceId,
    title,
    abstract: cleanText(paper.abstract),
    authors: paper.authors,
    publishedAt: parseDate(paper.published),
    url: cleanText(paper.url_abs),
    pdfUrl: cleanText(paper.url_pdf),
    arxivId: cleanText(paper.arxiv_id),
  };
}
