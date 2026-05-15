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

type PapersWithCodePaper = {
  id?: string;
  title?: string;
  arxiv_id?: string;
};

type PapersWithCodeSearchResponse = {
  results?: PapersWithCodePaper[];
};

type PapersWithCodeRepository = {
  url?: string;
  stars?: number;
};

type PapersWithCodeRepositoryResponse = {
  results?: PapersWithCodeRepository[];
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
  const papersWithCode = await detectViaPapersWithCode(paper);

  if (papersWithCode.status === "confirmed") {
    return papersWithCode;
  }

  const github = await detectViaGitHubSearch(paper);

  if (github.status !== "none") {
    return github;
  }

  return papersWithCode.status === "possible" ? papersWithCode : emptyDetection;
}

async function detectViaPapersWithCode(paper: SourcePaper): Promise<RepositoryDetection> {
  try {
    const params = new URLSearchParams({
      q: paper.arxivId ?? paper.title,
      items_per_page: "5",
    });
    const search = await fetchJson<PapersWithCodeSearchResponse>(
      `https://paperswithcode.com/api/v1/papers/?${params.toString()}`,
    );
    const match = (search.results ?? []).find((candidate) => isPapersWithCodeMatch(paper, candidate));

    if (!match?.id) {
      return emptyDetection;
    }

    const repositories = await fetchJson<PapersWithCodeRepositoryResponse>(
      `https://paperswithcode.com/api/v1/papers/${encodeURIComponent(match.id)}/repositories/`,
    );
    const repository = (repositories.results ?? []).find((repo) => repo.url?.includes("github.com"));

    if (!repository?.url) {
      return {
        status: "possible",
        source: "papers_with_code",
        confidence: 0.55,
      };
    }

    return {
      status: "confirmed",
      url: repository.url,
      source: "papers_with_code",
      confidence: 0.95,
      stars: repository.stars,
    };
  } catch {
    // PWC 经常 5xx；让 GitHub 路径继续尝试。
    return emptyDetection;
  }
}

function isPapersWithCodeMatch(paper: SourcePaper, candidate: PapersWithCodePaper): boolean {
  if (paper.arxivId && candidate.arxiv_id && paper.arxivId.toLowerCase() === candidate.arxiv_id.toLowerCase()) {
    return true;
  }

  return normalizeTitle(paper.title) === normalizeTitle(candidate.title ?? "");
}

async function detectViaGitHubSearch(paper: SourcePaper): Promise<RepositoryDetection> {
  const query = buildGitHubQuery(paper.title);
  if (!query) {
    return emptyDetection;
  }

  const params = new URLSearchParams({
    q: query,
    sort: "stars",
    order: "desc",
    per_page: "5",
  });
  const response = await fetchGitHubJson<GitHubSearchResponse>(
    `https://api.github.com/search/repositories?${params.toString()}`,
  );
  const candidates = (response.items ?? [])
    .map((item) => scoreGitHubCandidate(paper, item))
    .filter((item): item is RepositoryDetection => item.status !== "none")
    .sort((a, b) => b.confidence - a.confidence);

  return candidates[0] ?? emptyDetection;
}

/**
 * 把论文标题打包成一段安全的 GitHub Search 查询。
 * - 短标题：用引号短语匹配。
 * - 长标题：拆词后挑长度 > 3 的关键 token 拼接，直到接近 256 字符上限。
 */
function buildGitHubQuery(title: string): string | undefined {
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
