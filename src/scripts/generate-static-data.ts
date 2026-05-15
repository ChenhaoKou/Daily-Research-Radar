import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { detectRepository, type RepositoryDetection } from "../lib/github";
import { normalizeTitle, searchAllSources, type SourcePaper, type SourceResult } from "../lib/sources";
import {
  FIVE_YEARS_DAYS,
  makeTopicId,
  type StaticPaper,
  type StaticPaperData,
  type StaticTopic,
} from "../lib/static-data";

type TopicConfig = {
  topics?: Array<{
    name: string;
    description?: string;
    terms: string[];
    excludeTerms?: string[];
  }>;
  keywords?: string[];
};

type VenueConfigEntry = {
  name: string;
  aliases: string[];
};

type VenueConfig = {
  topConferences: VenueConfigEntry[];
  topJournals: VenueConfigEntry[];
};

type RuntimeTopic = StaticTopic & {
  excludeTerms: string[];
  includeMatchers: TermMatcher[];
  excludeMatchers: TermMatcher[];
};

type TermMatcher = {
  term: string;
  test: (text: string) => boolean;
};

type QualityVenue = NonNullable<StaticPaper["qualityVenue"]>;

type RuntimeQualityVenue = QualityVenue & {
  aliases: string[];
  aliasMatchers: Array<{ alias: string; test: (text: string) => boolean }>;
};

const rootDir = process.cwd();
const configPath = path.join(rootDir, "config", "keywords.json");
const venuesPath = path.join(rootDir, "config", "venues.json");
const outputPath = path.join(rootDir, "public", "data", "papers.json");
const daysBack = Number(process.env.SYNC_DAYS_BACK ?? FIVE_YEARS_DAYS);
const limitPerSource = Number(process.env.SYNC_LIMIT_PER_SOURCE ?? 50);
const repositoryCheckLimit = Number(process.env.REPOSITORY_CHECK_LIMIT ?? 80);
const repositoryConcurrency = Number(process.env.REPOSITORY_CHECK_CONCURRENCY ?? 4);
const termLimit = Number(process.env.SYNC_TERM_LIMIT ?? 0); // 0 表示不限

async function main() {
  const topics = await loadTopics();
  const qualityVenues = await loadQualityVenues();
  const paperMap = new Map<string, StaticPaper>();
  // 多键索引：同一篇论文从不同源回来可能只有 doi/arxivId/title 之一，
  // 这里把每一个可用 key 都映射到 paperMap 的主 key，避免重复入库。
  const keyIndex = new Map<string, string>();
  const repositoryQueue: Array<{ key: string; paper: SourcePaper }> = [];
  const repoSeen = new Set<string>();
  const warnings: StaticPaperData["warnings"] = [];

  // 合并所有 topic 的 term，跨 topic 共用一次抓取（cache 在 sources/index.ts 里）。
  const termToTopics = new Map<string, RuntimeTopic[]>();
  for (const topic of topics) {
    for (const term of topic.terms) {
      const list = termToTopics.get(term) ?? [];
      list.push(topic);
      termToTopics.set(term, list);
    }
  }

  const allTerms = Array.from(termToTopics.entries());
  const plannedTerms = termLimit > 0 ? allTerms.slice(0, termLimit) : allTerms;
  console.log(
    `[paper-tracker] fetching ${plannedTerms.length}` +
      (termLimit > 0 && termLimit < allTerms.length ? `/${allTerms.length}` : "") +
      ` unique terms across ${topics.length} topics ` +
      `(daysBack=${daysBack}, limitPerSource=${limitPerSource})`,
  );

  let termIndex = 0;
  for (const [term, topicsForTerm] of plannedTerms) {
    termIndex += 1;
    const startedAt = Date.now();
    const sourceResults = await searchAllSources(term, { daysBack, limit: limitPerSource });
    collectWarnings(sourceResults, warnings, term);

    const perSourceCounts: number[] = [];
    let kept = 0;
    for (let i = 0; i < sourceResults.length; i += 1) {
      perSourceCounts[i] = sourceResults[i].papers.length;
    }
    const totalFetched = perSourceCounts.reduce((sum, n) => sum + n, 0);

    for (const sourcePaper of sourceResults.flatMap((result) => result.papers)) {
      const matchedTopics = topicsForTerm.filter((topic) => matchesTopic(sourcePaper, topic));
      if (matchedTopics.length === 0) {
        continue;
      }

      const canonicalKey = findOrAssignKey(sourcePaper, keyIndex);
      const existing = paperMap.get(canonicalKey);
      const qualityVenue = matchQualityVenue(sourcePaper, qualityVenues);

      if (existing) {
        for (const topic of matchedTopics) {
          addTopic(existing, topic);
        }
        addSource(existing, sourcePaper);
        upgradeQualityVenue(existing, qualityVenue);
        upgradeMetadata(existing, sourcePaper);
        continue;
      }

      const paper = toStaticPaper(canonicalKey, sourcePaper, matchedTopics, qualityVenue);
      paperMap.set(canonicalKey, paper);
      kept += 1;

      if (!repoSeen.has(canonicalKey)) {
        repoSeen.add(canonicalKey);
        repositoryQueue.push({ key: canonicalKey, paper: sourcePaper });
      }
    }

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    const padIndex = String(termIndex).padStart(String(plannedTerms.length).length, " ");
    console.log(
      `[paper-tracker] [${padIndex}/${plannedTerms.length}] ${elapsed}s ${term} → ` +
        `fetched ${totalFetched}, +${kept} new (total=${paperMap.size}, warn=${warnings.length})`,
    );
  }

  await applyRepositoryDetections(paperMap, repositoryQueue.slice(0, repositoryCheckLimit), warnings);

  const papers = Array.from(paperMap.values()).sort(sortNewestFirst);
  recomputeTopicCounts(topics, papers);

  const data: StaticPaperData = {
    generatedAt: new Date().toISOString(),
    daysBack,
    topics: topics.map(toPublicTopic),
    qualityVenues: qualityVenues.map(toPublicQualityVenue),
    papers,
    warnings,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");

  const topVenueCount = papers.filter((paper) => paper.qualityVenue).length;
  const checkedCount = papers.filter((paper) => paper.repositoryChecked).length;
  console.log(
    `[paper-tracker] generated ${papers.length} papers (${topVenueCount} from top venues, ` +
      `${checkedCount} checked for open-source) → ${outputPath}`,
  );

  if (warnings.length > 0) {
    console.warn(`[paper-tracker] ${warnings.length} warnings:`);
    for (const warning of warnings.slice(0, 20)) {
      console.warn(`  ${warning.source}: ${warning.message}`);
    }
    if (warnings.length > 20) {
      console.warn(`  …${warnings.length - 20} more`);
    }
  }
}

async function loadTopics(): Promise<RuntimeTopic[]> {
  const raw = await readFile(configPath, "utf8");
  const config = JSON.parse(raw) as TopicConfig;

  if (config.topics?.length) {
    return config.topics.map((topic) => makeRuntimeTopic({
      name: topic.name,
      description: topic.description,
      terms: topic.terms,
      excludeTerms: topic.excludeTerms ?? [],
    }));
  }

  return (config.keywords ?? []).map((keyword) =>
    makeRuntimeTopic({ name: keyword, terms: [keyword], excludeTerms: [] }),
  );
}

function makeRuntimeTopic(input: {
  name: string;
  description?: string;
  terms: string[];
  excludeTerms: string[];
}): RuntimeTopic {
  const terms = Array.from(new Set(input.terms.map((term) => term.trim()).filter(Boolean)));
  return {
    id: makeTopicId(input.name),
    name: input.name,
    description: input.description,
    terms,
    excludeTerms: input.excludeTerms,
    enabled: true,
    paperCount: 0,
    includeMatchers: terms.map((term) => ({ term, test: makeTermMatcher(term) })),
    excludeMatchers: input.excludeTerms.map((term) => ({ term, test: makeTermMatcher(term) })),
  };
}

async function loadQualityVenues(): Promise<RuntimeQualityVenue[]> {
  const raw = await readFile(venuesPath, "utf8");
  const config = JSON.parse(raw) as VenueConfig;
  const conferences = config.topConferences.map((venue) => makeRuntimeQualityVenue(venue, "conference", "top"));
  const journals = config.topJournals.map((venue) => makeRuntimeQualityVenue(venue, "journal", "sci-q1"));

  return [...conferences, ...journals];
}

function makeRuntimeQualityVenue(
  venue: VenueConfigEntry,
  type: QualityVenue["type"],
  rank: QualityVenue["rank"],
): RuntimeQualityVenue {
  return {
    name: venue.name,
    aliases: venue.aliases,
    type,
    rank,
    matchedAlias: venue.name,
    aliasMatchers: venue.aliases.map((alias) => ({ alias, test: makeTermMatcher(alias) })),
  };
}

function collectWarnings(sourceResults: SourceResult[], warnings: StaticPaperData["warnings"], term: string) {
  for (const result of sourceResults) {
    const message = result.error ?? result.warning;

    if (message) {
      warnings.push({
        source: result.source,
        message: `${term}: ${message}`,
      });
    }
  }
}

/**
 * 区分大小写不敏感的"词级"匹配。
 * 把 term 当成一段不可拆分的字符串，要求左右是非字母数字（或字符串端点）。
 * 这样 "SAM" 不会命中 "Sample"/"Samsung"，但 "vision-language" 仍然能命中
 * "vision-language model" 这种带连字符的写法。
 */
function makeTermMatcher(term: string): (text: string) => boolean {
  const escaped = term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i");
  return (text) => regex.test(text);
}

function matchesTopic(paper: SourcePaper, topic: RuntimeTopic): boolean {
  const text = [paper.title, paper.abstract, paper.authors?.join(" "), paper.venue]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!topic.includeMatchers.some((matcher) => matcher.test(text))) {
    return false;
  }

  return !topic.excludeMatchers.some((matcher) => matcher.test(text));
}

function matchQualityVenue(
  paper: SourcePaper,
  qualityVenues: RuntimeQualityVenue[],
): QualityVenue | undefined {
  const venue = paper.venue;
  if (!venue) {
    return undefined;
  }

  for (const qualityVenue of qualityVenues) {
    const matched = qualityVenue.aliasMatchers.find((entry) => entry.test(venue));

    if (matched) {
      return {
        name: qualityVenue.name,
        type: qualityVenue.type,
        rank: qualityVenue.rank,
        matchedAlias: matched.alias,
      };
    }
  }

  return undefined;
}

async function applyRepositoryDetections(
  paperMap: Map<string, StaticPaper>,
  targets: Array<{ key: string; paper: SourcePaper }>,
  warnings: StaticPaperData["warnings"],
) {
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < targets.length) {
      const i = nextIndex;
      nextIndex += 1;
      const target = targets[i];

      try {
        const repository = await detectRepository(target.paper);
        const staticPaper = paperMap.get(target.key);
        if (staticPaper) {
          applyRepository(staticPaper, repository);
        }
      } catch (error) {
        warnings.push({
          source: "github_search",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(repositoryConcurrency, targets.length)) }, () => worker()),
  );
}

function paperCandidateKeys(paper: SourcePaper): string[] {
  const keys: string[] = [];
  if (paper.doi) keys.push(`doi:${paper.doi.toLowerCase()}`);
  if (paper.arxivId) keys.push(`arxiv:${paper.arxivId.toLowerCase()}`);
  if (paper.semanticScholarId) keys.push(`s2:${paper.semanticScholarId.toLowerCase()}`);
  const normalized = normalizeTitle(paper.title);
  if (normalized) keys.push(`title:${normalized}`);
  return keys;
}

function findOrAssignKey(paper: SourcePaper, keyIndex: Map<string, string>): string {
  const keys = paperCandidateKeys(paper);
  for (const key of keys) {
    const existing = keyIndex.get(key);
    if (existing) {
      // 把这次见到的其他 key 都映射到同一个 canonical key，下一次见就能合并。
      for (const k of keys) keyIndex.set(k, existing);
      return existing;
    }
  }

  const canonical = keys[0] ?? `paper:${paper.source}:${paper.sourceId}`;
  for (const key of keys) keyIndex.set(key, canonical);
  return canonical;
}

function toStaticPaper(
  canonicalKey: string,
  paper: SourcePaper,
  matchedTopics: RuntimeTopic[],
  qualityVenue: QualityVenue | undefined,
): StaticPaper {
  return {
    id: canonicalKey,
    title: paper.title,
    abstract: paper.abstract,
    authors: paper.authors?.join(", "),
    venue: paper.venue,
    publishedAt: paper.publishedAt?.toISOString(),
    url: paper.url,
    pdfUrl: paper.pdfUrl,
    sourcePrimary: paper.source,
    openSourceStatus: "none",
    repositoryChecked: false,
    qualityVenue,
    topics: matchedTopics.map(toPublicTopic),
    sources: [
      {
        source: paper.source,
        sourceId: paper.sourceId,
        url: paper.url,
      },
    ],
    repositories: [],
  };
}

function addTopic(paper: StaticPaper, topic: RuntimeTopic) {
  if (!paper.topics.some((item) => item.id === topic.id)) {
    paper.topics.push(toPublicTopic(topic));
  }
}

function addSource(paper: StaticPaper, sourcePaper: SourcePaper) {
  if (!paper.sources.some((source) => source.source === sourcePaper.source && source.sourceId === sourcePaper.sourceId)) {
    paper.sources.push({
      source: sourcePaper.source,
      sourceId: sourcePaper.sourceId,
      url: sourcePaper.url,
    });
  }
}

function upgradeQualityVenue(paper: StaticPaper, candidate: QualityVenue | undefined) {
  if (candidate && !paper.qualityVenue) {
    paper.qualityVenue = candidate;
  }
}

function upgradeMetadata(paper: StaticPaper, source: SourcePaper) {
  // 后来到达的源可能补全摘要、PDF 链接、venue、日期等信息。
  if (!paper.abstract && source.abstract) paper.abstract = source.abstract;
  if (!paper.authors && source.authors?.length) paper.authors = source.authors.join(", ");
  if (!paper.venue && source.venue) paper.venue = source.venue;
  if (!paper.pdfUrl && source.pdfUrl) paper.pdfUrl = source.pdfUrl;
  if (!paper.url && source.url) paper.url = source.url;
  if (!paper.publishedAt && source.publishedAt) paper.publishedAt = source.publishedAt.toISOString();
}

function applyRepository(paper: StaticPaper, repository: RepositoryDetection) {
  paper.repositoryChecked = true;
  paper.openSourceStatus = repository.status;
  paper.repositoryUrl = repository.url;
  paper.repositoryConfidence = repository.confidence;
  paper.repositorySource = repository.source;
  paper.repositories = repository.url
    ? [
        {
          url: repository.url,
          status: repository.status,
          confidence: repository.confidence,
          stars: repository.stars,
          source: repository.source,
        },
      ]
    : [];
}

function recomputeTopicCounts(topics: RuntimeTopic[], papers: StaticPaper[]) {
  const counts = new Map<string, number>();
  for (const paper of papers) {
    for (const topic of paper.topics) {
      counts.set(topic.id, (counts.get(topic.id) ?? 0) + 1);
    }
  }
  for (const topic of topics) {
    topic.paperCount = counts.get(topic.id) ?? 0;
  }
}

function toPublicTopic(topic: RuntimeTopic): StaticTopic {
  return {
    id: topic.id,
    name: topic.name,
    description: topic.description,
    terms: topic.terms,
    enabled: topic.enabled,
    paperCount: topic.paperCount,
  };
}

function toPublicQualityVenue(venue: RuntimeQualityVenue) {
  return {
    name: venue.name,
    type: venue.type,
    rank: venue.rank,
  };
}

function sortNewestFirst(left: StaticPaper, right: StaticPaper) {
  const leftTime = left.publishedAt ? new Date(left.publishedAt).getTime() : 0;
  const rightTime = right.publishedAt ? new Date(right.publishedAt).getTime() : 0;

  return rightTime - leftTime;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
