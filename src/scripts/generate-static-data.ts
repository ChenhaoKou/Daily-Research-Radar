import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { detectRepository, type RepositoryDetection } from "../lib/github";
import { normalizeTitle, searchAllSources, type SourcePaper, type SourceResult } from "../lib/sources";
import { FIVE_YEARS_DAYS, makeKeywordId, type StaticKeyword, type StaticPaper, type StaticPaperData } from "../lib/static-data";

type KeywordConfig = {
  keywords: string[];
};

const rootDir = process.cwd();
const configPath = path.join(rootDir, "config", "keywords.json");
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
  const keywords = await loadKeywords();
  const paperMap = new Map<string, StaticPaper>();
  const keywordMap = new Map<string, StaticKeyword>();
  const repositoryTargets: Array<{ key: string; paper: SourcePaper }> = [];
  const warnings: StaticPaperData["warnings"] = [];

  for (const term of keywords) {
    const keyword = {
      id: makeKeywordId(term),
      term,
      enabled: true,
      paperCount: 0,
    };
    keywordMap.set(keyword.id, keyword);

    const sourceResults = await searchAllSources(term, {
      daysBack,
      limit: limitPerSource,
    });
    collectWarnings(sourceResults, warnings);

    for (const sourcePaper of sourceResults.flatMap((result) => result.papers)) {
      const key = getPaperKey(sourcePaper);
      const existing = paperMap.get(key);

      if (existing) {
        addKeyword(existing, keyword);
        addSource(existing, sourcePaper);
        continue;
      }

      const paper = toStaticPaper(sourcePaper, keyword, emptyRepository);
      paperMap.set(key, paper);
      repositoryTargets.push({ key, paper: sourcePaper });
    }
  }

  await applyRepositoryDetections(paperMap, repositoryTargets.slice(0, repositoryCheckLimit), warnings);

  const papers = Array.from(paperMap.values()).sort(sortNewestFirst);
  for (const keyword of keywordMap.values()) {
    keyword.paperCount = papers.filter((paper) => paper.keywords.some((item) => item.id === keyword.id)).length;
  }

  const data: StaticPaperData = {
    generatedAt: new Date().toISOString(),
    daysBack,
    keywords: Array.from(keywordMap.values()),
    papers,
    warnings,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log(`[paper-tracker] generated ${papers.length} papers for ${keywords.length} keywords at ${outputPath}`);

  if (warnings.length > 0) {
    console.warn(warnings.map((warning) => `warning: ${warning.source}: ${warning.message}`).join("\n"));
  }
}

async function loadKeywords() {
  const raw = await readFile(configPath, "utf8");
  const config = JSON.parse(raw) as KeywordConfig;

  return Array.from(new Set(config.keywords.map((keyword) => keyword.trim()).filter(Boolean)));
}

function collectWarnings(sourceResults: SourceResult[], warnings: StaticPaperData["warnings"]) {
  for (const result of sourceResults) {
    const message = result.error ?? result.warning;

    if (message) {
      warnings.push({
        source: result.source,
        message,
      });
    }
  }
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
  keyword: StaticKeyword,
  repository: Awaited<ReturnType<typeof detectRepository>>,
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
    keywords: [keyword],
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

function addKeyword(paper: StaticPaper, keyword: StaticKeyword) {
  if (!paper.keywords.some((item) => item.id === keyword.id)) {
    paper.keywords.push(keyword);
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

function sortNewestFirst(left: StaticPaper, right: StaticPaper) {
  const leftTime = left.publishedAt ? new Date(left.publishedAt).getTime() : 0;
  const rightTime = right.publishedAt ? new Date(right.publishedAt).getTime() : 0;

  return rightTime - leftTime;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
