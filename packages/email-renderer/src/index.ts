import sanitizeHtml from "sanitize-html";
import juice from "juice";
import { convert } from "html-to-text";
import { createHash } from "node:crypto";
// No network resolver is called here. Imported resources are never fetched by the server.
function cleanCss(css: string) {
  return css
    .replace(/@import[^;]*(?:;|$)/gi, "")
    .replace(/[^{};]*[\\<>][^{};]*(?:;|(?=\}))/g, "")
    .replace(
      /[^{};]*(?:expression\s*\(|javascript\s*:|vbscript\s*:|behavior\s*:|-moz-binding)[^{};]*(?:;|(?=\}))/gi,
      "",
    )
    .replace(/url\(\s*(['"]?)(?!https:\/\/)[^)]*\)/gi, "none");
}
export function normalizeEmail(raw: string, preheader = "") {
  if (Buffer.byteLength(raw, "utf8") > 512000)
    throw new Error("Email HTML must be under 512 KB.");
  const warnings: string[] = [];
  if (/<!--\s*\[if/i.test(raw))
    warnings.push(
      "Outlook conditional blocks were removed for safe rendering. Review the resulting layout.",
    );
  if (/<script|\son\w+=|<iframe|<form|@import|<link/i.test(raw))
    warnings.push("Active content or external stylesheets were removed.");
  const styles: string[] = [];
  const withoutStyles = raw.replace(
    /<style\b[^>]*>([\s\S]*?)<\/style>/gi,
    (_, css: string) => {
      styles.push(cleanCss(css));
      return "";
    },
  );
  const safe = sanitizeHtml(withoutStyles, {
    allowedTags: [
      "html",
      "head",
      "body",
      "title",
      "meta",
      "table",
      "thead",
      "tbody",
      "tfoot",
      "tr",
      "td",
      "th",
      "colgroup",
      "col",
      "div",
      "span",
      "p",
      "br",
      "hr",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "blockquote",
      "ul",
      "ol",
      "li",
      "a",
      "img",
      "sup",
      "sub",
      "pre",
      "code",
      "center",
    ],
    allowedAttributes: {
      "*": [
        "style",
        "class",
        "id",
        "align",
        "valign",
        "width",
        "height",
        "bgcolor",
        "role",
        "dir",
        "lang",
      ],
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "width", "height", "title"],
      table: ["cellpadding", "cellspacing", "border", "width", "align", "role"],
      td: [
        "colspan",
        "rowspan",
        "width",
        "height",
        "align",
        "valign",
        "bgcolor",
        "style",
      ],
      th: ["colspan", "rowspan", "scope", "style"],
      meta: ["name", "content", "charset"],
    },
    allowedSchemes: ["https", "http", "mailto", "tel"],
    allowedSchemesByTag: { img: ["https", "http", "cid"] },
    allowProtocolRelative: false,
    transformTags: {
      "*": (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          ...(attribs.style ? { style: cleanCss(attribs.style) } : {}),
        },
      }),
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, rel: "noopener noreferrer", target: "_blank" },
      }),
    },
    nonTextTags: [
      "script",
      "style",
      "textarea",
      "option",
      "noscript",
      "iframe",
      "object",
      "svg",
      "math",
    ],
  });
  const withStyles = `<style>${styles.join("\n")}</style>${safe}`;
  const inlined = juice(withStyles, {
    applyStyleTags: true,
    removeStyleTags: true,
    preserveMediaQueries: true,
    preserveImportant: true,
    applyWidthAttributes: true,
    applyAttributesTableElements: true,
  });
  const text = convert(inlined, {
    wordwrap: 80,
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "a", options: { hideLinkHrefIfSameAsText: true } },
    ],
  });
  const hidden = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${sanitizeHtml(preheader, { allowedTags: [], allowedAttributes: {} })}</div>`
    : "";
  const html = inlined.includes("<body")
    ? inlined.replace(/(<body\b[^>]*>)/i, `$1${hidden}`)
    : `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${hidden}${inlined}</body></html>`;
  return {
    html,
    text,
    warnings,
    hash: createHash("sha256").update(html).digest("hex"),
  };
}
export function renderSnapshot(html: string, unsubscribeUrl: string) {
  const safe = sanitizeHtml(unsubscribeUrl, {
    allowedTags: [],
    allowedAttributes: {},
  }).replaceAll('"', "&quot;");
  const footer = `<div style="font-family:Arial,sans-serif;font-size:12px;line-height:1.5;padding:24px;text-align:center;color:#667085"><a href="${safe}" style="color:#667085">Unsubscribe from these emails</a></div>`;
  return /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, footer + "</body>")
    : html + footer;
}
export const previewCsp =
  "default-src 'none'; style-src 'unsafe-inline'; img-src https: http: data: cid:; font-src https:; form-action 'none'; base-uri 'none'; script-src 'none'; connect-src 'none'";
