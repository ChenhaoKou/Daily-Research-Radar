import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { detectRepository, type RepositoryDetection } from "../lib/github";
import {
  normalizeTitle,
  searchAllSources,
  type PaperSourceName,
  type SourcePaper,
  type SourceResult,
} from "../lib/sources";
import {
  FIVE_YEARS_DAYS,
  makeTopicId,
  type StaticPaper,
  type StaticPaperData,
  type StaticTopic,
} from "../lib/static-data";

type SyncMode = "full" | "incremental";

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
// retentionDaysBack：保留窗口（默认 3 年），超过窗口的旧论文会从输出里淘汰。
const retentionDaysBack = Number(process.env.SYNC_DAYS_BACK ?? FIVE_YEARS_DAYS);
// 增量模式下每次实际向各源请求的时间窗口，默认 7 天。
const incrementalDaysBack = Number(process.env.SYNC_INCREMENTAL_DAYS_BACK ?? 7);
const requestedMode: SyncMode = process.env.SYNC_MODE === "incremental" ? "incremental" : "full";
const limitPerSource = Number(process.env.SYNC_LIMIT_PER_SOURCE ?? 50);
const repositoryCheckLimit = Number(process.env.REPOSITORY_CHECK_LIMIT ?? 600);
const repositoryConcurrency = Number(process.env.REPOSITORY_CHECK_CONCURRENCY ?? 4);
const termLimit = Number(process.env.SYNC_TERM_LIMIT ?? 0); // 0 表示不限
// 每个 topic 最多保留多少篇论文。429 个 term 合起来可能产出几万篇，
// 一次性塞进浏览器加载的 JSON 既慢又卡，先裁剪到一个合理量级。
const maxPapersPerTopic = Number(process.env.MAX_PAPERS_PER_TOPIC ?? 400);

async function main() {
  const topics = await loadTopics();
  const qualityVenues = await loadQualityVenues();
  const paperMap = new Map<string, StaticPaper>();
  // 多键索引：同一篇论文从不同源回来可能只有 doi/arxivId/title 之一，
  // 这里把每一个可用 key 都映射到 paperMap 的主 key，避免重复入库。
  const keyIndex = new Map<string, string>();
  const warnings: StaticPaperData["warnings"] = [];

  // 决定本次跑 full 还是 incremental。incremental 模式下要求能读到上次的输出，
  // 否则自动回退到 full（避免第一次部署就只抓最近 7 天）。
  let mode: SyncMode = requestedMode;
  let seeded = 0;
  if (mode === "incremental") {
    const existing = await loadExistingData();
    if (existing) {
      seeded = seedExistingPapers(existing, paperMap, keyIndex, topics, qualityVenues);
      console.log(
        `[paper-tracker] mode=incremental, seeded ${seeded} papers from previous run ` +
          `(generatedAt=${existing.generatedAt})`,
      );
    } else {
      console.log("[paper-tracker] mode=incremental requested but no previous papers.json found; running full fetch");
      mode = "full";
    }
  }

  const fetchDaysBack = mode === "incremental" ? incrementalDaysBack : retentionDaysBack;

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
      `(mode=${mode}, fetchDaysBack=${fetchDaysBack}, retentionDaysBack=${retentionDaysBack}, ` +
      `limitPerSource=${limitPerSource})`,
  );

  let termIndex = 0;
  for (const [term, topicsForTerm] of plannedTerms) {
    termIndex += 1;
    const startedAt = Date.now();
    const sourceResults = await searchAllSources(term, { daysBack: fetchDaysBack, limit: limitPerSource });
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
    }

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    const padIndex = String(termIndex).padStart(String(plannedTerms.length).length, " ");
    console.log(
      `[paper-tracker] [${padIndex}/${plannedTerms.length}] ${elapsed}s ${term} → ` +
        `fetched ${totalFetched}, +${kept} new (total=${paperMap.size}, warn=${warnings.length})`,
    );
  }

  let allPapers = Array.from(paperMap.values()).sort(sortNewestFirst);
  const beforeRetention = allPapers.length;
  allPapers = pruneByRetention(allPapers, retentionDaysBack);
  if (allPapers.length < beforeRetention) {
    console.log(
      `[paper-tracker] pruned ${beforeRetention - allPapers.length} papers older than ` +
        `${retentionDaysBack} days (kept ${allPapers.length})`,
    );
  }
  const papers = capPapersPerTopic(allPapers, topics, maxPapersPerTopic);

  if (papers.length < allPapers.length) {
    console.log(
      `[paper-tracker] capped ${allPapers.length} → ${papers.length} papers ` +
        `(MAX_PAPERS_PER_TOPIC=${maxPapersPerTopic})`,
    );
  }

  // 仓库检测：从被保留下来的论文里挑还没检测过的，按发布时间从新到旧。
  // 这样 seed 进来但之前因为 limit 没轮到的旧论文，下一轮会接着补检。
  const repositoryTargets = papers
    .filter((paper) => !paper.repositoryChecked)
    .slice(0, repositoryCheckLimit)
    .map((paper) => ({ key: paper.id, paper: rebuildSourcePaper(paper) }));
  console.log(
    `[paper-tracker] repository check: ${repositoryTargets.length} candidates ` +
      `(limit=${repositoryCheckLimit}, already-checked=${papers.length - papers.filter((p) => !p.repositoryChecked).length})`,
  );
  await applyRepositoryDetections(paperMap, repositoryTargets, warnings);
  const checkedNow = papers.filter((p) => p.repositoryChecked && (p.repositoryUrl || p.openSourceStatus !== "none")).length;
  const confirmedTotal = papers.filter((p) => p.openSourceStatus === "confirmed").length;
  const possibleTotal = papers.filter((p) => p.openSourceStatus === "possible").length;
  console.log(
    `[paper-tracker] repository results: confirmed=${confirmedTotal}, possible=${possibleTotal}, ` +
      `with-url-this-run=${checkedNow}`,
  );

  recomputeTopicCounts(topics, papers);

  const data: StaticPaperData = {
    generatedAt: new Date().toISOString(),
    daysBack: retentionDaysBack,
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
  return matchesTopicByText(buildSearchText(paper), topic);
}

function buildSearchText(
  paper: { title?: string; abstract?: string; authors?: string[] | string; venue?: string },
): string {
  const authors = Array.isArray(paper.authors) ? paper.authors.join(" ") : paper.authors;
  return [paper.title, paper.abstract, authors, paper.venue]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesTopicByText(text: string, topic: RuntimeTopic): boolean {
  if (!topic.includeMatchers.some((matcher) => matcher.test(text))) {
    return false;
  }
  return !topic.excludeMatchers.some((matcher) => matcher.test(text));
}

function matchQualityVenue(
  paper: SourcePaper,
  qualityVenues: RuntimeQualityVenue[],
): QualityVenue | undefined {
  return paper.venue ? matchQualityVenueByString(paper.venue, qualityVenues) : undefined;
}

function matchQualityVenueByString(
  venue: string,
  qualityVenues: RuntimeQualityVenue[],
): QualityVenue | undefined {
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

/**
 * 给每个 topic 限定最多保留多少篇论文，按发布时间倒序优先保留最新的。
 * 没有日期的论文排最后。一篇论文同时属于多个 topic，只要被任一 topic 选中就保留。
 */
function capPapersPerTopic(
  papers: StaticPaper[],
  topics: RuntimeTopic[],
  perTopicLimit: number,
): StaticPaper[] {
  if (!Number.isFinite(perTopicLimit) || perTopicLimit <= 0) {
    return papers;
  }

  const score = (paper: StaticPaper): number => {
    return paper.publishedAt ? new Date(paper.publishedAt).getTime() : 0;
  };

  const keep = new Set<string>();
  const sorted = [...papers].sort((a, b) => score(b) - score(a));

  for (const topic of topics) {
    let kept = 0;
    for (const paper of sorted) {
      if (kept >= perTopicLimit) break;
      if (paper.topics.some((item) => item.id === topic.id)) {
        keep.add(paper.id);
        kept += 1;
      }
    }
  }

  // 不属于任何 runtime topic 的孤儿（理论上不会出现）也保留。
  return papers.filter((paper) => keep.has(paper.id) || paper.topics.length === 0);
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

async function loadExistingData(): Promise<StaticPaperData | undefined> {
  try {
    const raw = await readFile(outputPath, "utf8");
    const parsed = JSON.parse(raw) as StaticPaperData;
    if (!Array.isArray(parsed?.papers)) {
      return undefined;
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    console.warn(`[paper-tracker] failed to read previous papers.json: ${(error as Error).message}`);
    return undefined;
  }
}

/**
 * 把上次生成的论文塞进 paperMap / keyIndex，作为 incremental 模式的种子。
 * 同时按当前的 topics / qualityVenues 配置重新评估，因为 keywords.json
 * 或 venues.json 可能在两次运行之间被修改。
 */
function seedExistingPapers(
  data: StaticPaperData,
  paperMap: Map<string, StaticPaper>,
  keyIndex: Map<string, string>,
  topics: RuntimeTopic[],
  qualityVenues: RuntimeQualityVenue[],
): number {
  const cutoff = Date.now() - retentionDaysBack * 86_400_000;
  let kept = 0;

  for (const paper of data.papers) {
    if (paper.publishedAt) {
      const t = new Date(paper.publishedAt).getTime();
      if (Number.isFinite(t) && t < cutoff) continue;
    }

    const text = buildSearchText({
      title: paper.title,
      abstract: paper.abstract,
      authors: paper.authors,
      venue: paper.venue,
    });
    const refreshedTopics = topics.filter((topic) => matchesTopicByText(text, topic));
    if (refreshedTopics.length === 0) {
      continue;
    }

    paper.topics = refreshedTopics.map(toPublicTopic);
    paper.qualityVenue = paper.venue ? matchQualityVenueByString(paper.venue, qualityVenues) : undefined;

    paperMap.set(paper.id, paper);
    for (const key of staticPaperKeys(paper)) {
      if (!keyIndex.has(key)) keyIndex.set(key, paper.id);
    }
    kept += 1;
  }

  return kept;
}

function staticPaperKeys(paper: StaticPaper): string[] {
  const keys = new Set<string>([paper.id]);

  const title = normalizeTitle(paper.title);
  if (title) keys.add(`title:${title}`);

  for (const source of paper.sources ?? []) {
    const id = source.sourceId?.toLowerCase();
    if (!id) continue;
    if (source.source === "arxiv") keys.add(`arxiv:${id}`);
    else if (source.source === "semantic_scholar") keys.add(`s2:${id}`);
    else if (source.source === "acm_crossref") keys.add(`doi:${id}`);
    else if (source.source === "ieee_xplore" && id.includes("/")) keys.add(`doi:${id}`);
  }

  return Array.from(keys);
}

/**
 * 把一个 StaticPaper 还原成 detectRepository 需要的最小 SourcePaper 形状。
 * 主要用 arxivId / doi / title 三件套来驱动 GitHub 搜索。
 */
function rebuildSourcePaper(paper: StaticPaper): SourcePaper {
  const arxivSource = paper.sources?.find((s) => s.source === "arxiv");
  const doiSource = paper.sources?.find(
    (s) => s.source === "acm_crossref" || (s.source === "ieee_xplore" && s.sourceId.includes("/")),
  );
  const primarySource = paper.sources?.[0];

  return {
    source: ((primarySource?.source ?? paper.sourcePrimary) as PaperSourceName) ?? "arxiv",
    sourceId: primarySource?.sourceId ?? paper.id,
    title: paper.title,
    abstract: paper.abstract,
    venue: paper.venue,
    url: paper.url,
    pdfUrl: paper.pdfUrl,
    arxivId: arxivSource?.sourceId,
    doi: doiSource?.sourceId,
  };
}

function pruneByRetention(papers: StaticPaper[], days: number): StaticPaper[] {
  if (!Number.isFinite(days) || days <= 0) {
    return papers;
  }
  const cutoff = Date.now() - days * 86_400_000;
  return papers.filter((paper) => {
    if (!paper.publishedAt) return true; // 未知日期暂时保留，由前端决定是否显示
    const t = new Date(paper.publishedAt).getTime();
    if (!Number.isFinite(t)) return true;
    return t >= cutoff;
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
