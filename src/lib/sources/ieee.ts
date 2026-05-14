import type { SourceAdapter, SourcePaper } from "./types";
import { cleanText, fetchJson, isRecent, parseDate } from "./utils";

type IeeeArticle = {
  article_number?: string;
  title?: string;
  abstract?: string;
  authors?: {
    authors?: Array<{ full_name?: string }>;
  };
  publication_title?: string;
  publication_year?: string;
  html_url?: string;
  pdf_url?: string;
  doi?: string;
};

type IeeeResponse = {
  articles?: IeeeArticle[];
};

export const ieeeAdapter: SourceAdapter = {
  name: "ieee_xplore",
  label: "IEEE Xplore",
  async search(keyword, options) {
    const apiKey = process.env.IEEE_API_KEY;

    if (!apiKey) {
      return [];
    }

    const params = new URLSearchParams({
      apikey: apiKey,
      querytext: keyword,
      max_records: String(options.limit),
      sort_order: "desc",
      sort_field: "publication_year",
      format: "json",
    });

    const response = await fetchJson<IeeeResponse>(
      `https://ieeexploreapi.ieee.org/api/v1/search/articles?${params.toString()}`,
    );

    return (response.articles ?? []).map(toPaper).filter((paper): paper is SourcePaper => {
      return Boolean(paper?.title) && isRecent(paper?.publishedAt, options.daysBack);
    });
  },
};

function toPaper(article: IeeeArticle): SourcePaper | undefined {
  const title = cleanText(article.title);
  const sourceId = cleanText(article.article_number ?? article.doi);

  if (!title || !sourceId) {
    return undefined;
  }

  const yearDate = article.publication_year ? new Date(Date.UTC(Number(article.publication_year), 0, 1)) : undefined;

  return {
    source: "ieee_xplore",
    sourceId,
    title,
    abstract: cleanText(article.abstract),
    authors: article.authors?.authors
      ?.map((author) => cleanText(author.full_name))
      .filter((author): author is string => Boolean(author)),
    venue: cleanText(article.publication_title),
    publishedAt: parseDate(yearDate?.toISOString()),
    url: cleanText(article.html_url),
    pdfUrl: cleanText(article.pdf_url),
    doi: cleanText(article.doi),
  };
}
