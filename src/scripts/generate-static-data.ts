import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { detectRepository, type RepositoryDetection } from "../lib/github";
import { normalizeTitle, searchAllSources, type SourcePaper, type SourceResult } from "../lib/sources";
import { FIVE_YEARS_DAYS, makeTopicId, type StaticPaper, type StaticPaperData, type StaticTopic } from "../lib/static-data";

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
};

type QualityVenue = NonNullable<StaticPaper["qualityVenue"]>;

type RuntimeQualityVenue = QualityVenue & {
  aliases: string[];
};

const rootDir = process.cwd();
const configPath = path.join(rootDir, "config", "keywords.json");
const venuesPath = path.join(rootDir, "config", "venues.json");
const outputPath = path.join(rootDir, "public", "data", "papers.json");
const daysBack = Number(process.env.SYNC_DAYS_BACK ?? FIVE_YEARS_DAYS);
const limitPerSource = Number(process.env.SYNC_LIMIT_PER_SOURCE ?? 50);
const repositoryCheckLimit = Number(process.env.REPOSITORY_CHECK_LIMIT ?? 80);
const repositoryConcurrency = Number(process.env.REPOSITORY_CHECK_CONCURRENCY ?? 6);
const emptyRepository: RepositoryDetection = {
  status: "none",
  confidence: 0,
};

async function main() {
  const topics = await loadTopics();
  const qualityVenues = await loadQualityVenues();
  const paperMap = new Map<string, StaticPaper>();
  const topicMap = new Map<string, RuntimeTopic>();
  const repositoryTargets: Array<{ key: string; paper: SourcePaper }> = [];
  const warnings: StaticPaperData["warnings"] = [];

  for (const topic of topics) {
    topicMap.set(topic.id, topic);

    for (const term of topic.terms) {
      const sourceResults = await searchAllSources(term, {
        daysBack,
        limit: limitPerSource,
      });
      collectWarnings(sourceResults, warnings, term);

      for (const sourcePaper of sourceResults.flatMap((result) => result.papers)) {
        if (!matchesTopic(sourcePaper, topic)) {
          continue;
        }

        const qualityVenue = matchQualityVenue(sourcePaper, qualityVenues);
        if (!qualityVenue) {
          continue;
        }

        const key = getPaperKey(sourcePaper);
        const existing = paperMap.get(key);

        if (existing) {
          addTopic(existing, topic);
          addSource(existing, sourcePaper);
          continue;
        }

        const paper = toStaticPaper(sourcePaper, topic, emptyRepository, qualityVenue);
        paperMap.set(key, paper);
        repositoryTargets.push({ key, paper: sourcePaper });
      }
    }
  }

  await applyRepositoryDetections(paperMap, repositoryTargets.slice(0, repositoryCheckLimit), warnings);

  const papers = Array.from(paperMap.values()).sort(sortNewestFirst);
  for (const topic of topicMap.values()) {
    topic.paperCount = papers.filter((paper) => paper.topics.some((item) => item.id === topic.id)).length;
  }

  const data: StaticPaperData = {
    generatedAt: new Date().toISOString(),
    daysBack,
    topics: Array.from(topicMap.values()).map(toPublicTopic),
    qualityVenues: qualityVenues.map(toPublicQualityVenue),
    papers,
    warnings,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log(`[paper-tracker] generated ${papers.length} papers for ${topics.length} topics at ${outputPath}`);

  if (warnings.length > 0) {
    console.warn(warnings.map((warning) => `warning: ${warning.source}: ${warning.message}`).join("\n"));
  }
}

async function loadTopics(): Promise<RuntimeTopic[]> {
  const raw = await readFile(configPath, "utf8");
  const config = JSON.parse(raw) as TopicConfig;

  if (config.topics?.length) {
    return config.topics.map((topic) => ({
      id: makeTopicId(topic.name),
      name: topic.name,
      description: topic.description,
      terms: Array.from(new Set(topic.terms.map((term) => term.trim()).filter(Boolean))),
      excludeTerms: topic.excludeTerms ?? [],
      enabled: true,
      paperCount: 0,
    }));
  }

  return (config.keywords ?? []).map((keyword) => ({
    id: makeTopicId(keyword),
    name: keyword,
    terms: [keyword],
    excludeTerms: [],
    enabled: true,
    paperCount: 0,
  }));
}

async function loadQualityVenues(): Promise<RuntimeQualityVenue[]> {
  const raw = await readFile(venuesPath, "utf8");
  const config = JSON.parse(raw) as VenueConfig;
  const conferences = config.topConferences.map((venue) => ({
    name: venue.name,
    aliases: venue.aliases,
    type: "conference" as const,
    rank: "top" as const,
    matchedAlias: venue.name,
  }));
  const journals = config.topJournals.map((venue) => ({
    name: venue.name,
    aliases: venue.aliases,
    type: "journal" as const,
    rank: "sci-q1" as const,
    matchedAlias: venue.name,
  }));

  return [...conferences, ...journals];
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

function matchesTopic(paper: SourcePaper, topic: RuntimeTopic) {
  const text = [paper.title, paper.abstract, paper.authors?.join(" "), paper.venue].filter(Boolean).join(" ").toLowerCase();
  const hasIncludedTerm = topic.terms.some((term) => text.includes(term.toLowerCase()));
  const hasExcludedTerm = topic.excludeTerms.some((term) => text.includes(term.toLowerCase()));

  return hasIncludedTerm && !hasExcludedTerm;
}

function matchQualityVenue(paper: SourcePaper, qualityVenues: RuntimeQualityVenue[]): QualityVenue | undefined {
  const venue = paper.venue?.toLowerCase();

  if (!venue) {
    return undefined;
  }

  for (const qualityVenue of qualityVenues) {
    const matchedAlias = qualityVenue.aliases.find((alias) => venue.includes(alias.toLowerCase()));

    if (matchedAlias) {
      return {
        name: qualityVenue.name,
        type: qualityVenue.type,
        rank: qualityVenue.rank,
        matchedAlias,
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
      const target = targets[nextIndex];
      nextIndex += 1;

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

  await Promise.all(Array.from({ length: Math.min(repositoryConcurrency, targets.length) }, () => worker()));
}

function getPaperKey(paper: SourcePaper) {
  return paper.doi ?? paper.arxivId ?? paper.semanticScholarId ?? normalizeTitle(paper.title);
}

function toStaticPaper(
  paper: SourcePaper,
  topic: RuntimeTopic,
  repository: RepositoryDetection,
  qualityVenue: QualityVenue,
): StaticPaper {
  return {
    id: getPaperKey(paper),
    title: paper.title,
    abstract: paper.abstract,
    authors: paper.authors?.join(", "),
    venue: paper.venue,
    publishedAt: paper.publishedAt?.toISOString(),
    url: paper.url,
    pdfUrl: paper.pdfUrl,
    sourcePrimary: paper.source,
    openSourceStatus: repository.status,
    repositoryUrl: repository.url,
    repositoryConfidence: repository.confidence,
    repositorySource: repository.source,
    qualityVenue,
    topics: [toPublicTopic(topic)],
    sources: [
      {
        source: paper.source,
        sourceId: paper.sourceId,
        url: paper.url,
      },
    ],
    repositories: repository.url
      ? [
          {
            url: repository.url,
            status: repository.status,
            confidence: repository.confidence,
            stars: repository.stars,
            source: repository.source,
          },
        ]
      : [],
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

function applyRepository(paper: StaticPaper, repository: RepositoryDetection) {
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
