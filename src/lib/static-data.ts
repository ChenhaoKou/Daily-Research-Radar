export const FIVE_YEARS_DAYS = 365 * 5;

export type StaticTopic = {
  id: string;
  name: string;
  description?: string;
  terms: string[];
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
  /**
   * 是否对这篇论文跑过开源检索。为 false 时 openSourceStatus 必为 "none"，
   * 但含义是"未检查"而不是"未发现"。
   */
  repositoryChecked: boolean;
  repositoryUrl?: string;
  repositoryConfidence?: number;
  repositorySource?: string;
  qualityVenue?: {
    name: string;
    type: "conference" | "journal";
    rank: "top" | "sci-q1";
    matchedAlias: string;
  };
  topics: StaticTopic[];
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
  topics: StaticTopic[];
  qualityVenues: Array<{
    name: string;
    type: "conference" | "journal";
    rank: "top" | "sci-q1";
  }>;
  papers: StaticPaper[];
  warnings: StaticSyncWarning[];
};

export const emptyStaticPaperData: StaticPaperData = {
  generatedAt: new Date(0).toISOString(),
  daysBack: FIVE_YEARS_DAYS,
  topics: [],
  qualityVenues: [],
  papers: [],
  warnings: [],
};

export function makeTopicId(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
