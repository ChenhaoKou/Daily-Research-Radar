"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  emptyStaticPaperData,
  FIVE_YEARS_DAYS,
  makeKeywordId,
  type StaticKeyword,
  type StaticPaper,
  type StaticPaperData,
} from "@/lib/static-data";
import styles from "../page.module.css";

const sourceLabels: Record<string, string> = {
  arxiv: "arXiv",
  openreview: "OpenReview",
  semantic_scholar: "Semantic Scholar",
  papers_with_code: "Papers with Code",
  dblp: "DBLP",
  acl_anthology: "ACL Anthology",
  ieee_xplore: "IEEE Xplore",
  acm_crossref: "ACM Digital Library",
};

const statusLabels: Record<StaticPaper["openSourceStatus"], string> = {
  confirmed: "已确认开源",
  possible: "疑似开源",
  none: "未发现开源",
};

const venuePatterns = [
  "CVPR",
  "ICCV",
  "ECCV",
  "WACV",
  "NeurIPS",
  "ICML",
  "ICLR",
  "AAAI",
  "IJCAI",
  "ACL",
  "EMNLP",
  "NAACL",
  "KDD",
  "SIGGRAPH",
  "SIGIR",
  "WWW",
  "ICRA",
  "IROS",
  "AISTATS",
  "UAI",
];

const localKeywordsKey = "paper-tracker-local-keywords";
const fiveYears = String(FIVE_YEARS_DAYS);

export function PaperDashboard() {
  const [data, setData] = useState<StaticPaperData>(emptyStaticPaperData);
  const [localKeywords, setLocalKeywords] = useState<StaticKeyword[]>(readLocalKeywords);
  const [newKeyword, setNewKeyword] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [venue, setVenue] = useState("all");
  const [keywordId, setKeywordId] = useState("all");
  const [days, setDays] = useState(fiveYears);
  const [sort, setSort] = useState<"desc" | "asc">("desc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/data/papers.json`, {
      cache: "no-store",
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("静态论文数据还未生成，请先运行 npm run generate:data。");
        }

        return response.json() as Promise<StaticPaperData>;
      })
      .then(setData)
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "加载静态数据失败。");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    window.localStorage.setItem(localKeywordsKey, JSON.stringify(localKeywords));
  }, [localKeywords]);

  const allKeywords = useMemo(() => mergeKeywords(data.keywords, localKeywords), [data.keywords, localKeywords]);
  const venueOptions = useMemo(() => getVenueOptions(data.papers), [data.papers]);

  const papers = useMemo(() => {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - Number(days));

    return data.papers
      .filter((paper) => {
        if (query && !matchesQuery(paper, query)) {
          return false;
        }

        if (status !== "all") {
          const matchesStatus =
            status === "with_code"
              ? paper.openSourceStatus === "confirmed" || paper.openSourceStatus === "possible"
              : paper.openSourceStatus === status;

          if (!matchesStatus) {
            return false;
          }
        }

        if (source !== "all" && paper.sourcePrimary !== source) {
          return false;
        }

        if (venue !== "all" && !matchesVenue(paper, venue)) {
          return false;
        }

        if (keywordId !== "all") {
          const keyword = allKeywords.find((item) => item.id === keywordId);
          if (!keyword || !matchesKeyword(paper, keyword.term)) {
            return false;
          }
        }

        if (Number.isFinite(Number(days)) && Number(days) > 0 && paper.publishedAt) {
          return new Date(paper.publishedAt) >= cutoff;
        }

        return true;
      })
      .sort((left, right) => {
        const leftTime = left.publishedAt ? new Date(left.publishedAt).getTime() : 0;
        const rightTime = right.publishedAt ? new Date(right.publishedAt).getTime() : 0;

        return sort === "desc" ? rightTime - leftTime : leftTime - rightTime;
      });
  }, [allKeywords, data.papers, days, keywordId, query, sort, source, status, venue]);

  const confirmedCount = useMemo(
    () => papers.filter((paper) => paper.openSourceStatus === "confirmed").length,
    [papers],
  );

  function addKeyword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = newKeyword.trim();

    if (!term) {
      return;
    }

    const keyword: StaticKeyword = {
      id: makeKeywordId(term),
      term,
      enabled: true,
      paperCount: data.papers.filter((paper) => matchesKeyword(paper, term)).length,
    };

    setLocalKeywords((current) => mergeKeywords(current, [keyword]));
    setNewKeyword("");
  }

  function deleteLocalKeyword(keyword: StaticKeyword) {
    setLocalKeywords((current) => current.filter((item) => item.id !== keyword.id));

    if (keywordId === keyword.id) {
      setKeywordId("all");
    }
  }

  return (
    <main className={styles.shell}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Daily Research Radar</p>
          <h1>论文追踪与开源实现监控</h1>
          <p className={styles.heroText}>
            静态公网日报站：GitHub Actions 每天生成论文数据，页面可按本地关键词、来源、日期和开源状态筛选。
          </p>
        </div>
        <a className={styles.primaryButton} href="https://github.com/" rel="noreferrer" target="_blank">
          GitHub Pages
        </a>
      </section>

      <section className={styles.metrics}>
        <Metric label="公共关键词" value={data.keywords.length} />
        <Metric label="当前结果" value={papers.length} />
        <Metric label="确认开源" value={confirmedCount} />
        <Metric label="最后更新" value={formatDate(data.generatedAt)} />
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2>关键词筛选</h2>
            <p>公共关键词来自仓库配置；你在页面添加的关键词只保存在当前浏览器，用于筛选已生成的数据。</p>
          </div>
        </div>
        <form className={styles.keywordForm} onSubmit={addKeyword}>
          <input
            aria-label="本地关键词"
            placeholder="例如：large language model, diffusion policy, graph neural network"
            value={newKeyword}
            onChange={(event) => setNewKeyword(event.target.value)}
          />
          <button type="submit">添加本地筛选</button>
        </form>
        <div className={styles.keywordList}>
          {allKeywords.length === 0 ? (
            <p className={styles.emptyText}>还没有关键词。请先在 `config/keywords.json` 中配置公共关键词。</p>
          ) : (
            allKeywords.map((keyword) => {
              const isLocal = localKeywords.some((item) => item.id === keyword.id);

              return (
                <div className={styles.keywordPill} key={keyword.id}>
                  <span className={styles.enabledDot} />
                  <span>{keyword.term}</span>
                  <small>{keyword.paperCount} 篇</small>
                  <small>{isLocal ? "本地" : "公共"}</small>
                  {isLocal ? (
                    <button className={styles.textButton} onClick={() => deleteLocalKeyword(keyword)} type="button">
                      删除
                    </button>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2>论文列表</h2>
            <p>按关键词、来源、会议、日期、开源状态和发布时间排序筛选。</p>
          </div>
        </div>
        <div className={styles.filters}>
          <input placeholder="搜索标题、摘要、作者" value={query} onChange={(event) => setQuery(event.target.value)} />
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">全部开源状态</option>
            <option value="with_code">有开源线索</option>
            <option value="confirmed">确认开源</option>
            <option value="possible">疑似开源</option>
            <option value="none">未发现开源</option>
          </select>
          <select value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="all">全部来源</option>
            {Object.entries(sourceLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select value={venue} onChange={(event) => setVenue(event.target.value)}>
            <option value="all">全部会议</option>
            {venueOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <select value={keywordId} onChange={(event) => setKeywordId(event.target.value)}>
            <option value="all">全部关键词</option>
            {allKeywords.map((keyword) => (
              <option key={keyword.id} value={keyword.id}>
                {keyword.term}
              </option>
            ))}
          </select>
          <select value={days} onChange={(event) => setDays(event.target.value)}>
            <option value="7">最近 7 天</option>
            <option value="30">最近 30 天</option>
            <option value="90">最近 90 天</option>
            <option value="365">最近 1 年</option>
            <option value={fiveYears}>最近 5 年</option>
          </select>
          <select value={sort} onChange={(event) => setSort(event.target.value === "asc" ? "asc" : "desc")}>
            <option value="desc">发布时间：最新优先</option>
            <option value="asc">发布时间：最旧优先</option>
          </select>
        </div>

        {error ? <p className={styles.error}>{error}</p> : null}
        {loading ? <p className={styles.emptyText}>正在加载静态论文数据...</p> : null}
        {!loading && papers.length === 0 ? <p className={styles.emptyText}>暂无匹配论文。</p> : null}
        {data.warnings.length > 0 ? (
          <p className={styles.emptyText}>最近生成有 {data.warnings.length} 条来源 warning，通常是外部接口限流。</p>
        ) : null}

        <div className={styles.paperList}>
          {papers.map((paper) => (
            <article className={styles.paperCard} key={paper.id}>
              <div className={styles.paperMeta}>
                <span>{sourceLabels[paper.sourcePrimary] ?? paper.sourcePrimary}</span>
                <span>{formatDate(paper.publishedAt)}</span>
                <span className={styles[paper.openSourceStatus]}>{statusLabels[paper.openSourceStatus]}</span>
              </div>
              <h3>{paper.title}</h3>
              {paper.authors ? <p className={styles.authors}>{paper.authors}</p> : null}
              {paper.abstract ? <p className={styles.abstract}>{paper.abstract}</p> : null}
              <div className={styles.tags}>
                {paper.keywords.map((keyword) => (
                  <span key={keyword.id}>{keyword.term}</span>
                ))}
              </div>
              <div className={styles.links}>
                {paper.url ? (
                  <a href={paper.url} rel="noreferrer" target="_blank">
                    论文页面
                  </a>
                ) : null}
                {paper.pdfUrl ? (
                  <a href={paper.pdfUrl} rel="noreferrer" target="_blank">
                    PDF
                  </a>
                ) : null}
                {paper.repositoryUrl ? (
                  <a href={paper.repositoryUrl} rel="noreferrer" target="_blank">
                    GitHub {paper.repositoryConfidence ? `${Math.round(paper.repositoryConfidence * 100)}%` : ""}
                  </a>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className={styles.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function matchesQuery(paper: StaticPaper, query: string) {
  const normalized = query.toLowerCase();
  return [paper.title, paper.abstract, paper.authors, paper.venue].some((value) => value?.toLowerCase().includes(normalized));
}

function matchesKeyword(paper: StaticPaper, keyword: string) {
  const normalized = keyword.toLowerCase();
  return [paper.title, paper.abstract, paper.authors, paper.venue].some((value) => value?.toLowerCase().includes(normalized));
}

function matchesVenue(paper: StaticPaper, venue: string) {
  const normalizedVenue = normalizeVenue(paper.venue);
  return normalizedVenue === venue || paper.venue?.toLowerCase().includes(venue.toLowerCase());
}

function getVenueOptions(papers: StaticPaper[]) {
  const venues = new Set<string>();

  for (const paper of papers) {
    const venue = normalizeVenue(paper.venue);

    if (venue) {
      venues.add(venue);
    }
  }

  return Array.from(venues).sort((left, right) => left.localeCompare(right));
}

function normalizeVenue(venue?: string) {
  if (!venue) {
    return undefined;
  }

  const upperVenue = venue.toUpperCase();
  const matched = venuePatterns.find((pattern) => upperVenue.includes(pattern.toUpperCase()));

  return matched ?? venue.replace(/\s*\d{4}\s*$/, "").trim();
}

function mergeKeywords(primary: StaticKeyword[], secondary: StaticKeyword[]) {
  const byId = new Map<string, StaticKeyword>();

  for (const keyword of [...primary, ...secondary]) {
    byId.set(keyword.id, keyword);
  }

  return Array.from(byId.values());
}

function readLocalKeywords() {
  if (typeof window === "undefined") {
    return [];
  }

  const saved = window.localStorage.getItem(localKeywordsKey);
  return saved ? (JSON.parse(saved) as StaticKeyword[]) : [];
}

function formatDate(value?: string | null) {
  if (!value || value === new Date(0).toISOString()) {
    return "日期未知";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}
