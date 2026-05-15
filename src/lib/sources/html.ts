export function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

export function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function htmlToText(value: string): string {
  return decodeHtml(stripTags(value)).replace(/\s+/g, " ").trim();
}

export function absoluteUrl(baseUrl: string, href: string | undefined): string | undefined {
  if (!href) {
    return undefined;
  }

  return new URL(href, baseUrl).toString();
}
