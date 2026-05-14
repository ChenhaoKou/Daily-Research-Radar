import type { SourceAdapter, SourcePaper } from "./types";
import { cleanText, fetchText } from "./utils";

export const aclAnthologyAdapter: SourceAdapter = {
  name: "acl_anthology",
  label: "ACL Anthology",
  async search(keyword, options) {
    const params = new URLSearchParams({
      q: keyword,
    });
    const html = await fetchText(`https://aclanthology.org/search/?${params.toString()}`);

    return parseSearchResults(html, options.limit);
  },
};

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

    papers.push({
      source: "acl_anthology",
      sourceId,
      title,
      authors: authorText?.split(",").map((author) => author.trim()).filter(Boolean),
      url: `https://aclanthology.org${href}`,
    });

    if (papers.length >= limit) {
      break;
    }
  }

  return papers;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
