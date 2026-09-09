import { Parser } from "htmlparser2";

export function escapeAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// Parse links without serializing the document: only an explicitly selected
// href changes. Tables, CSS, copy, VML and conditional delimiters stay intact.
export function mapEmailLinks(
  html: string,
  map: (href: string) => string,
): string {
  const edits: { start: number; end: number; value: string }[] = [];
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (
          !["a", "area", "v:roundrect", "v:rect"].includes(name) ||
          !attrs.href
        )
          return;
        const mapped = map(attrs.href);
        if (mapped === attrs.href) return;
        const tag = html.slice(parser.startIndex, parser.endIndex + 1);
        const value = tag.replace(
          /(\s)href\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i,
          (_, space: string) => `${space}href="${escapeAttribute(mapped)}"`,
        );
        edits.push({
          start: parser.startIndex,
          end: parser.endIndex + 1,
          value,
        });
      },
      oncomment(data) {
        const m = data.match(/^(\[if [^\]]+\]>)([\s\S]*?)(<!\[endif\])$/i);
        if (!m) return;
        const inner = mapEmailLinks(m[2], map);
        if (inner !== m[2])
          edits.push({
            start: parser.startIndex,
            end: parser.endIndex + 1,
            value: `<!--${m[1]}${inner}${m[3]}-->`,
          });
      },
    },
    { decodeEntities: true },
  );
  parser.end(html);
  for (const e of edits.sort((a, b) => b.start - a.start))
    html = html.slice(0, e.start) + e.value + html.slice(e.end);
  return html;
}

export function emailLinks(html: string) {
  const found = new Set<string>();
  mapEmailLinks(html, (href) => {
    found.add(href);
    return href;
  });
  return [...found];
}

export function destination(href: string): URL | null {
  // Leave non-web links direct; reject ambiguous controls and embedded credentials.
  if (!/^https?:\/\//i.test(href) || /[\x00-\x20\x7f\\]/.test(href))
    return null;
  try {
    const url = new URL(href);
    if (!url.hostname || url.username || url.password || url.href.length > 4096)
      return null;
    return url;
  } catch {
    return null;
  }
}
