import type { SourceAdapter, SourcePaper } from "./types";
import { cleanText, fetchJson, isRecent, parseDate } from "./utils";

type OpenReviewField<T> = T | { value?: T };

type OpenReviewNote = {
  id?: string;
  forum?: string;
  cdate?: number;
  mdate?: number;
  pdate?: number;
  content?: {
    title?: OpenReviewField<string>;
    abstract?: OpenReviewField<string>;
    authors?: OpenReviewField<string[]>;
    venue?: OpenReviewField<string>;
    pdf?: OpenReviewField<string>;
  };
};

type OpenReviewResponse = {
  notes?: OpenReviewNote[];
};

export const openReviewAdapter: SourceAdapter = {
  name: "openreview",
  label: "OpenReview",
  async search(keyword, options) {
    const params = new URLSearchParams({
      term: keyword,
      limit: String(options.limit),
    });

    const response = await fetchJson<OpenReviewResponse>(`https://api2.openreview.net/notes/search?${params.toString()}`);

    return (response.notes ?? []).map(toPaper).filter((paper): paper is SourcePaper => {
      return Boolean(paper?.title) && isRecent(paper?.publishedAt, options.daysBack);
    });
  },
};

function readField<T>(field: OpenReviewField<T> | undefined): T | undefined {
  if (field && typeof field === "object" && "value" in field) {
    return field.value;
  }

  return field as T | undefined;
}

function toPaper(note: OpenReviewNote): SourcePaper | undefined {
  const title = cleanText(readField(note.content?.title));
  const sourceId = cleanText(note.id);

  if (!title || !sourceId) {
    return undefined;
  }

  const timestamp = note.pdate ?? note.cdate ?? note.mdate;
  const publishedAt = timestamp ? new Date(timestamp) : undefined;
  const pdfPath = cleanText(readField(note.content?.pdf));
  const forum = cleanText(note.forum) ?? sourceId;

  return {
    source: "openreview",
    sourceId,
    title,
    abstract: cleanText(readField(note.content?.abstract)),
    authors: readField(note.content?.authors),
    venue: cleanText(readField(note.content?.venue)),
    publishedAt: parseDate(publishedAt?.toISOString()),
    url: `https://openreview.net/forum?id=${forum}`,
    pdfUrl: pdfPath?.startsWith("http") ? pdfPath : pdfPath ? `https://openreview.net${pdfPath}` : undefined,
  };
}
