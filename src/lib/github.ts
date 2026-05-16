import { fetchJson } from "./sources/utils";
import type { SourcePaper } from "./sources";
import { normalizeTitle } from "./sources";

export type RepositoryDetection = {
  status: "confirmed" | "possible" | "none";
  url?: string;
  source?: "papers_with_code" | "github_search";
  confidence: number;
  stars?: number;
};

type GitHubSearchResponse = {
  items?: Array<{
    html_url?: string;
    full_name?: string;
    description?: string;
    stargazers_count?: number;
  }>;
};

const emptyDetection: RepositoryDetection = {
  status: "none",
  confidence: 0,
};

// GitHub Search API 的 q 参数限制 256 字符。留出 in:name,description 和引号、限定词的余量。
const GITHUB_QUERY_BUDGET = 200;

export async function detectRepository(paper: SourcePaper): Promise<RepositoryDetection> {
  // 1. arXiv ID 在 README 里出现 → 几乎一定是这篇论文的代码仓库（最强信号）。
  if (paper.arxivId) {
    const byArxiv = await safeSearch(() => searchByArxivId(paper.arxivId!));
    if (byArxiv.status !== "none") {
      return byArxiv;
    }
  }

  // 2. DOI 同理。
  if (paper.doi) {
    const byDoi = await safeSearch(() => searchByDoi(paper.doi!));
    if (byDoi.status !== "none") {
      return byDoi;
    }
  }

  // 3. 退化到 name/description 里的标题匹配。
  return safeSearch(() => searchByTitle(paper));
}

async function safeSearch(
  run: () => Promise<RepositoryDetection>,
): Promise<RepositoryDetection> {
  try {
    return await run();
  } catch {
    return emptyDetection;
  }
}

async function searchByArxivId(arxivId: string): Promise<RepositoryDetection> {
  const cleanId = arxivId.replace(/^arxiv:/i, "").trim();
  if (!cleanId) return emptyDetection;

  // arxiv.org/abs/<id> 是论文页 URL，绝大多数复刻代码的 README 都直接贴这一段。
  const queries = [
    `"arxiv.org/abs/${cleanId}" in:readme`,
    `"arxiv:${cleanId}" in:readme`,
  ];

  for (const q of queries) {
    const response = await searchRepositories(q);
    const top = pickBestRepoCandidate(response);
    if (top) {
      return {
        status: "confirmed",
        url: top.html_url,
        source: "github_search",
        confidence: 0.9,
        stars: top.stargazers_count,
      };
    }
  }

  return emptyDetection;
}

async function searchByDoi(doi: string): Promise<RepositoryDetection> {
  const trimmed = doi.trim();
  if (!trimmed) return emptyDetection;

  const response = await searchRepositories(`"${trimmed}" in:readme`);
  const top = pickBestRepoCandidate(response);
  if (top) {
    return {
      status: "confirmed",
      url: top.html_url,
      source: "github_search",
      confidence: 0.88,
      stars: top.stargazers_count,
    };
  }

  return emptyDetection;
}

async function searchByTitle(paper: SourcePaper): Promise<RepositoryDetection> {
  const query = buildTitleQuery(paper.title);
  if (!query) {
    return emptyDetection;
  }

  const response = await searchRepositories(query);
  const candidates = (response.items ?? [])
    .map((item) => scoreGitHubCandidate(paper, item))
    .filter((item): item is RepositoryDetection => item.status !== "none")
    .sort((a, b) => b.confidence - a.confidence);

  return candidates[0] ?? emptyDetection;
}

async function searchRepositories(q: string): Promise<GitHubSearchResponse> {
  const params = new URLSearchParams({
    q,
    sort: "stars",
    order: "desc",
    per_page: "5",
  });
  return fetchGitHubJson<GitHubSearchResponse>(
    `https://api.github.com/search/repositories?${params.toString()}`,
  );
}

function pickBestRepoCandidate(
  response: GitHubSearchResponse,
): { html_url: string; stargazers_count?: number } | undefined {
  const items = response.items ?? [];
  for (const item of items) {
    if (item.html_url) {
      return { html_url: item.html_url, stargazers_count: item.stargazers_count };
    }
  }
  return undefined;
}

/**
 * 把论文标题打包成一段安全的 GitHub Search 查询。
 * - 短标题：用引号短语匹配。
 * - 长标题：拆词后挑长度 > 3 的关键 token 拼接，直到接近 256 字符上限。
 */
function buildTitleQuery(title: string): string | undefined {
  const cleaned = title.trim();
  if (!cleaned) {
    return undefined;
  }

  const suffix = " in:name,description";
  const quoted = `"${cleaned}"${suffix}`;
  if (quoted.length <= GITHUB_QUERY_BUDGET) {
    return quoted;
  }

  const tokens = normalizeTitle(cleaned)
    .split(" ")
    .filter((token) => token.length > 3);

  let q = "";
  for (const token of tokens) {
    const next = q ? `${q} ${token}` : token;
    if (`${next}${suffix}`.length > GITHUB_QUERY_BUDGET) break;
    q = next;
  }

  if (!q) {
    // 整个标题没有长 token，退而求其次截断引号查询。
    const truncated = cleaned.slice(0, GITHUB_QUERY_BUDGET - suffix.length - 2);
    return `"${truncated}"${suffix}`;
  }

  return `${q}${suffix}`;
}

function scoreGitHubCandidate(
  paper: SourcePaper,
  candidate: NonNullable<GitHubSearchResponse["items"]>[number],
): RepositoryDetection {
  if (!candidate.html_url) {
    return emptyDetection;
  }

  const title = normalizeTitle(paper.title);
  const haystack = normalizeTitle(`${candidate.full_name ?? ""} ${candidate.description ?? ""}`);
  const titleTokens = title.split(" ").filter((token) => token.length > 3);
  const matchedTokens = titleTokens.filter((token) => haystack.includes(token)).length;
  const tokenScore = titleTokens.length > 0 ? matchedTokens / titleTokens.length : 0;
  const exactTitle = haystack.includes(title);
  const confidence = exactTitle ? 0.82 : Math.min(0.72, tokenScore * 0.75);

  if (confidence < 0.45) {
    return emptyDetection;
  }

  return {
    status: exactTitle ? "confirmed" : "possible",
    url: candidate.html_url,
    source: "github_search",
    confidence,
    stars: candidate.stargazers_count,
  };
}

async function fetchGitHubJson<T>(url: string): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  return fetchJson<T>(url, { headers });
}
