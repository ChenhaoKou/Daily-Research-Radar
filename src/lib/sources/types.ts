export type PaperSourceName =
  | "arxiv"
  | "openreview"
  | "semantic_scholar"
  | "papers_with_code"
  | "acl_anthology"
  | "ieee_xplore"
  | "acm_crossref";

export type SourcePaper = {
  source: PaperSourceName;
  sourceId: string;
  title: string;
  abstract?: string;
  authors?: string[];
  venue?: string;
  publishedAt?: Date;
  url?: string;
  pdfUrl?: string;
  doi?: string;
  arxivId?: string;
  semanticScholarId?: string;
};

export type SourceAdapter = {
  name: PaperSourceName;
  label: string;
  search(keyword: string, options: SourceSearchOptions): Promise<SourcePaper[]>;
};

export type SourceSearchOptions = {
  daysBack: number;
  limit: number;
};

export type SourceResult = {
  source: PaperSourceName;
  papers: SourcePaper[];
  error?: string;
  warning?: string;
};
