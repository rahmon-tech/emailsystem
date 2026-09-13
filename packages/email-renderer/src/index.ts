import sanitizeHtml from "sanitize-html";
import juice from "juice";
import { convert } from "html-to-text";
import { createHash } from "node:crypto";
import { cleanCss, htmlOptions, protectOutlook } from "./safety";
export { emailLinks, mapEmailLinks, destination } from "./links";
// Normalization is deterministic and never fetches remote resources.
export function normalizeEmail(raw: string, preheader = "") {
  if (Buffer.byteLength(raw, "utf8") > 512000)
    throw new Error("Email HTML must be under 512 KB.");
  const warnings: string[] = [];
  if (
    /<(?:script|iframe|form|object|embed|input|svg|math|link)\b|\son\w+\s*=|(?:javascript|vbscript)\s*:/i.test(
      raw,
    )
  )
    warnings.push(
      "Active content was removed. Review any visible changes in the preview.",
    );
  const conditional = protectOutlook(raw, warnings);
  const styles: string[] = [];
  const withoutStyles = conditional.html.replace(
    /<style\b[^>]*>([\s\S]*?)<\/style>/gi,
    (_, css: string) => {
      styles.push(cleanCss(css, warnings));
      return "";
    },
  );
  const options = htmlOptions(warnings);
  const safe = sanitizeHtml(withoutStyles, {
    ...options,
    allowedTags: [...(options.allowedTags as string[]), "esoutlook"],
    allowedAttributes: {
      ...options.allowedAttributes,
      esoutlook: ["data-key"],
    },
  });
  const styleBlock = `<style>${styles.join("\n")}</style>`;
  const withStyles = /<head\b[^>]*>/i.test(safe)
    ? safe.replace(/<head\b[^>]*>/i, (tag) => tag + styleBlock)
    : styleBlock + safe;
  const inlined = conditional.restore(
    juice(withStyles, {
      applyStyleTags: true,
      removeStyleTags: true,
      preserveMediaQueries: true,
      preserveImportant: true,
      applyWidthAttributes: true,
      applyAttributesTableElements: true,
      preserveFontFaces: true,
    }),
  );
  const text = convert(inlined, {
    wordwrap: 80,
    selectors: [
      ...["h1", "h2", "h3", "h4", "h5", "h6"].map((selector) => ({
        selector,
        options: { uppercase: false },
      })),
      { selector: "img", format: "skip" },
      { selector: "a", options: { hideLinkHrefIfSameAsText: true } },
    ],
  });
  const hidden = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${sanitizeHtml(preheader, { allowedTags: [], allowedAttributes: {} })}</div>`
    : "";
  const html = inlined.includes("<body")
    ? "<!doctype html>" +
      inlined.replace(/(<body\b[^>]*>)/i, (tag) => tag + hidden)
    : `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${hidden}${inlined}</body></html>`;
  return {
    html,
    text,
    warnings: [...new Set(warnings)],
    hash: createHash("sha256").update(html).digest("hex"),
  };
}
export function renderSnapshot(html: string, unsubscribeUrl: string) {
  const safe = sanitizeHtml(unsubscribeUrl, {
    allowedTags: [],
    allowedAttributes: {},
  }).replaceAll('"', "&quot;");
  const placeholder = "{{unsubscribe_url}}";
  return html.includes(placeholder) ? html.replaceAll(placeholder, safe) : html;
}
export const previewCsp =
  "default-src 'none'; style-src 'unsafe-inline'; img-src https: http: data: cid:; font-src https:; form-action 'none'; base-uri 'none'; script-src 'none'; connect-src 'none'";
