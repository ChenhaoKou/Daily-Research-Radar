"use client";

import { useEffect, useMemo, useState } from "react";
import { emptyStaticPaperData, FIVE_YEARS_DAYS, type StaticPaper, type StaticPaperData } from "@/lib/static-data";
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

const fiveYears = String(FIVE_YEARS_DAYS);

export function PaperDashboard() {
  const [data, setData] = useState<StaticPaperData>(emptyStaticPaperData);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [venue, setVenue] = useState("all");
  const [topicId, setTopicId] = useState("all");
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

  const venueOptions = useMemo(() => getVenueOptions(data), [data]);

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

        if (venue !== "all" && !matchesQualityVenue(paper, venue)) {
          return false;
        }

        if (topicId !== "all" && !paper.topics.some((topic) => topic.id === topicId)) {
          return false;
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
  }, [data.papers, days, query, sort, source, status, topicId, venue]);

  const confirmedCount = useMemo(
    () => papers.filter((paper) => paper.openSourceStatus === "confirmed").length,
    [papers],
  );

  return (
    <main className={styles.shell}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Daily Research Radar</p>
          <h1>论文追踪与开源实现监控</h1>
          <p className={styles.heroText}>
            静态公网日报站：GitHub Actions 按主题分类配置每天生成论文数据，页面可按主题、来源、会议、日期和开源状态筛选。
          </p>
        </div>
        <a className={styles.primaryButton} href="https://github.com/" rel="noreferrer" target="_blank">
          GitHub Pages
        </a>
      </section>

      <section className={styles.metrics}>
        <Metric label="主题分类" value={data.topics.length} />
        <Metric label="当前结果" value={papers.length} />
        <Metric label="确认开源" value={confirmedCount} />
        <Metric label="最后更新" value={formatDate(data.generatedAt)} />
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2>主题分类</h2>
            <p>主题来自仓库配置，每个主题包含多个相关检索词，用于扩大召回并自动归类。</p>
          </div>
        </div>
        <div className={styles.keywordList}>
          {data.topics.length === 0 ? (
            <p className={styles.emptyText}>还没有主题。请先在 `config/keywords.json` 中配置 topics。</p>
          ) : (
            data.topics.map((topic) => (
              <button
                className={`${styles.keywordPill} ${topicId === topic.id ? styles.activePill : ""}`}
                key={topic.id}
                onClick={() => setTopicId(topicId === topic.id ? "all" : topic.id)}
                type="button"
              >
                <span className={styles.enabledDot} />
                <span>{topic.name}</span>
                <small>{topic.paperCount} 篇</small>
              </button>
            ))
          )}
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2>论文列表</h2>
            <p>按主题、来源、会议/期刊、日期、开源状态和发布时间排序筛选。</p>
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
            <option value="all">全部会议/期刊</option>
            {venueOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <select value={topicId} onChange={(event) => setTopicId(event.target.value)}>
            <option value="all">全部主题</option>
            {data.topics.map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.name}
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
                {paper.qualityVenue ? <span>{paper.qualityVenue.name}</span> : null}
                <span>{formatDate(paper.publishedAt)}</span>
                <span className={styles[paper.openSourceStatus]}>{statusLabels[paper.openSourceStatus]}</span>
              </div>
              <h3>{paper.title}</h3>
              {paper.authors ? <p className={styles.authors}>{paper.authors}</p> : null}
              {paper.abstract ? <p className={styles.abstract}>{paper.abstract}</p> : null}
              <div className={styles.tags}>
                {paper.topics.map((topic) => (
                  <span key={topic.id}>{topic.name}</span>
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
  const searchText = [
    paper.title,
    paper.abstract,
    paper.authors,
    paper.venue,
    paper.qualityVenue?.name,
    paper.qualityVenue?.matchedAlias,
    sourceLabels[paper.sourcePrimary] ?? paper.sourcePrimary,
    ...paper.topics.flatMap((topic) => [topic.name, topic.description, topic.terms.join(" ")]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return searchText.includes(normalized);
}

function matchesQualityVenue(paper: StaticPaper, venue: string) {
  return paper.qualityVenue?.name === venue || paper.venue?.toLowerCase().includes(venue.toLowerCase());
}

function getVenueOptions(data: StaticPaperData) {
  const venues = new Set<string>();

  for (const venue of data.qualityVenues) {
    venues.add(venue.name);
  }

  for (const paper of data.papers) {
    if (paper.qualityVenue?.name) {
      venues.add(paper.qualityVenue.name);
    }
  }

  return Array.from(venues).sort((left, right) => left.localeCompare(right));
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
