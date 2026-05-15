import type { SourceAdapter, SourcePaper } from "./types";
import { cleanText, fetchText, isRecent } from "./utils";
import { decodeHtml, stripTags } from "./html";

export const aclAnthologyAdapter: SourceAdapter = {
  name: "acl_anthology",
  label: "ACL Anthology",
  async search(keyword, options) {
    const params = new URLSearchParams({
      q: keyword,
    });
    const html = await fetchText(`https://aclanthology.org/search/?${params.toString()}`);

    return parseSearchResults(html, options.limit).filter(
      (paper) => isRecent(paper.publishedAt, options.daysBack),
    );
  },
};

// ACL Anthology URL prefix → 规范化的 venue 名称。
const VENUE_PREFIXES: Array<[RegExp, string]> = [
  [/^acl(?:-(?:long|short|main|industry|demo|srw|tutorials))?$/i, "ACL"],
  [/^emnlp(?:-(?:main|industry|demo|findings))?$/i, "EMNLP"],
  [/^naacl(?:-(?:long|short|main|industry|demo|srw))?$/i, "NAACL"],
  [/^findings-acl$/i, "Findings of ACL"],
  [/^findings-emnlp$/i, "Findings of EMNLP"],
  [/^findings-naacl$/i, "Findings of NAACL"],
  [/^eacl(?:-(?:main|long|short|demo|srw))?$/i, "EACL"],
  [/^coling$/i, "COLING"],
  [/^lrec(?:-main)?$/i, "LREC"],
  [/^tacl$/i, "TACL"],
  [/^cl$/i, "Computational Linguistics"],
  [/^conll$/i, "CoNLL"],
  [/^wmt$/i, "WMT"],
  [/^semeval$/i, "SemEval"],
];

function inferVenue(href: string): { venue?: string; year?: number } {
  // href 形如 "/2024.acl-long.123/" 或 "/W19-1234/"
  const cleaned = href.replace(/^\/+/, "").replace(/\/+$/, "");
  const yearMatch = cleaned.match(/^(\d{4})\./);

  if (yearMatch) {
    const year = Number(yearMatch[1]);
    const rest = cleaned.slice(yearMatch[0].length);
    const venueSlug = rest.split(".")[0] ?? "";

    for (const [pattern, name] of VENUE_PREFIXES) {
      if (pattern.test(venueSlug)) {
        return { venue: `${name} ${year}`, year };
      }
    }

    return { venue: `${venueSlug.toUpperCase()} ${year}`, year };
  }

  // 旧格式 "W19-1234"，第一个字母段表示场合，YY 是两位年。
  const legacy = cleaned.match(/^([A-Z])(\d{2})-/);
  if (legacy) {
    const year = 2000 + Number(legacy[2]);
    return { venue: undefined, year };
  }

  return {};
}

function parseSearchResults(html: string, limit: number): SourcePaper[] {
  const papers: SourcePaper[] = [];
  const pattern =
    /<p class="d-sm-flex[^"]*">[\s\S]*?<strong><a href="(\/[^"]+)">([\s\S]*?)<\/a><\/strong>[\s\S]*?<span class="d-block">([\s\S]*?)<\/span>/g;

  for (const match of html.matchAll(pattern)) {
    const href = match[1];
    const title = cleanText(stripTags(decodeHtml(match[2] ?? "")));

    if (!href || !title) {
      continue;
    }

    const authorText = cleanText(stripTags(decodeHtml(match[3] ?? "")));
    const sourceId = href.replace(/\//g, "");
    const { venue, year } = inferVenue(href);

    papers.push({
      source: "acl_anthology",
      sourceId,
      title,
      authors: authorText?.split(",").map((author) => author.trim()).filter(Boolean),
      venue,
      // 只精确到年份，1月1日仅用于排序。
      publishedAt: year ? new Date(Date.UTC(year, 0, 1)) : undefined,
      url: `https://aclanthology.org${href}`,
    });

    if (papers.length >= limit) {
      break;
    }
  }

  return papers;
}
