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
  // PWC 给会议论文返回的 proceeding URL，比如
  //   "https://paperswithcode.com/proceeding/cvpr-2024" 或 "neurips-2023"
  // 也可能是 null。
  proceeding?: string;
  conference?: string;
  conference_url_abs?: string;
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
      // PWC 经常 5xx，安静地跳过，不要让整次抓取失败。
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
    venue: inferVenue(paper),
    publishedAt: parseDate(paper.published),
    url: cleanText(paper.url_abs),
    pdfUrl: cleanText(paper.url_pdf),
    arxivId: cleanText(paper.arxiv_id),
  };
}

function inferVenue(paper: PapersWithCodePaper): string | undefined {
  const direct = cleanText(paper.conference);
  if (direct) {
    return direct;
  }

  const proceeding = cleanText(paper.proceeding);
  if (!proceeding) {
    return undefined;
  }

  // proceeding 形如 "https://paperswithcode.com/proceeding/cvpr-2024" 或 "cvpr-2024"
  const slug = proceeding.split("/").filter(Boolean).pop();
  if (!slug) {
    return undefined;
  }

  return slug.toUpperCase().replace(/-/g, " ");
}
