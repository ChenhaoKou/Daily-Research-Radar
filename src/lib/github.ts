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
  try {
    const query = `"${paper.title}" in:name,description`;
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
  } catch {
    return emptyDetection;
  }
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

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "paper-tracker/0.1 (+https://localhost)",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

async function fetchGitHubJson<T>(url: string): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "paper-tracker/0.1 (+https://localhost)",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}
