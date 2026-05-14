export const FIVE_YEARS_DAYS = 365 * 5;

export type StaticKeyword = {
  id: string;
  term: string;
  enabled: boolean;
  paperCount: number;
};

export type StaticPaper = {
  id: string;
  title: string;
  abstract?: string;
  authors?: string;
  venue?: string;
  publishedAt?: string;
  url?: string;
  pdfUrl?: string;
  sourcePrimary: string;
  openSourceStatus: "confirmed" | "possible" | "none";
  repositoryUrl?: string;
  repositoryConfidence?: number;
  repositorySource?: string;
  keywords: StaticKeyword[];
  sources: Array<{
    source: string;
    sourceId: string;
    url?: string;
  }>;
  repositories: Array<{
    url: string;
    status: "confirmed" | "possible" | "none";
    confidence: number;
    stars?: number;
    source?: string;
  }>;
};

export type StaticSyncWarning = {
  source: string;
  message: string;
};

export type StaticPaperData = {
  generatedAt: string;
  daysBack: number;
  keywords: StaticKeyword[];
  papers: StaticPaper[];
  warnings: StaticSyncWarning[];
};

export const emptyStaticPaperData: StaticPaperData = {
  generatedAt: new Date(0).toISOString(),
  daysBack: FIVE_YEARS_DAYS,
  keywords: [],
  papers: [],
  warnings: [],
};

export function makeKeywordId(term: string) {
  return term
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
