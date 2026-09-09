import sanitizeHtml from "sanitize-html";
import postcss from "postcss";
import { Parser } from "htmlparser2";
import { createHash } from "node:crypto";
import { escapeAttribute } from "./links";

export function cleanCss(css: string, warnings: string[]) {
  try {
    const root = postcss.parse(css);
    let changed = false;
    root.walkAtRules((rule) => {
      if (
        !/^(media|supports|font-face|keyframes|-webkit-keyframes)$/i.test(
          rule.name,
        ) ||
        /[\\<>]/.test(rule.params)
      ) {
        rule.remove();
        changed = true;
      }
    });
    root.walkDecls((decl) => {
      const value = decl.value.replace(/\/\*[\s\S]*?\*\//g, "");
      if (
        /[\\<>]/.test(decl.prop + value) ||
        /^(behavior|-moz-binding)$/i.test(decl.prop) ||
        /expression\s*\(|(?:java|vb)script\s*:/i.test(value) ||
        [...value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)].some(
          (m) => !/^(https?:\/\/|cid:)/i.test(m[2]),
        )
      ) {
        decl.remove();
        changed = true;
      }
    });
    if (changed)
      warnings.push(
        "Unsafe CSS or external stylesheet imports were removed. Review spacing and backgrounds in the preview.",
      );
    return root.toString();
  } catch {
    warnings.push("Invalid CSS was removed. Review the resulting layout.");
    return "";
  }
}

export const tags = [
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
];
const vml = [
  "v:roundrect",
  "v:rect",
  "v:fill",
  "v:textbox",
  "v:stroke",
  "w:anchorlock",
  "o:officedocumentsettings",
  "o:allowpng",
  "o:pixelsperinch",
];
const attributes: Record<string, string[]> = {
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
    "background",
    "aria-label",
  ],
  a: ["href", "title", "target", "rel"],
  img: ["src", "alt", "width", "height", "title"],
  table: ["cellpadding", "cellspacing", "border", "width", "align", "role"],
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan", "scope"],
  meta: ["name", "content", "charset"],
  html: ["xmlns", "xmlns:v", "xmlns:o"],
};
for (const tag of vml)
  attributes[tag] = [
    "xmlns:v",
    "xmlns:w",
    "xmlns:o",
    "href",
    "src",
    "fillcolor",
    "strokecolor",
    "arcsize",
    "strokeweight",
    "inset",
    "type",
    "color",
    "opacity",
    "stroke",
    "fill",
    "coordsize",
    "origin",
    "position",
    "size",
    "aspect",
    "v-text-anchor",
  ];

export function htmlOptions(warnings: string[]): sanitizeHtml.IOptions {
  return {
    allowedTags: tags,
    allowedAttributes: attributes,
    allowedSchemes: ["https", "http", "mailto", "tel"],
    allowedSchemesByTag: { img: ["https", "http", "cid"] },
    allowedSchemesAppliedToAttributes: ["href", "src", "background"],
    allowProtocolRelative: false,
    transformTags: {
      "*": (tagName, attribs) => {
        if (Object.keys(attribs).some((k) => /^on/i.test(k)))
          warnings.push("Active event handlers were removed.");
        const style = attribs.style
          ? cleanCss(attribs.style, warnings)
          : undefined;
        return {
          tagName,
          attribs: {
            ...attribs,
            ...(style !== undefined ? { style } : {}),
            ...(tagName === "a"
              ? { rel: "noopener noreferrer", target: "_blank" }
              : {}),
          },
        };
      },
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
      "xmp",
    ],
  };
}

// Outlook ghost tables can open in one conditional and close in another.
// Sanitize individual tokens so fragment parsing never invents closing tables.
function outlookFragment(raw: string, warnings: string[]) {
  if (/^(?:\s*<\/(?:table|tr|td|th|div|center)>)+\s*$/i.test(raw)) return raw;
  let out = "",
    blocked = 0,
    style = false,
    css = "";
  const allowed = new Set([...tags, ...vml, "style"]);
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (blocked) {
          blocked++;
          return;
        }
        if (!allowed.has(name)) {
          blocked = 1;
          warnings.push(
            "Unsupported active or Outlook markup was removed. Review the fallback layout.",
          );
          return;
        }
        if (name === "style") {
          style = true;
          css = "";
          return;
        }
        const serialized = `<${name}${Object.entries(attrs)
          .map(([k, v]) => ` ${k}="${escapeAttribute(v)}"`)
          .join("")}/>`;
        const cleaned = sanitizeHtml(serialized, {
          ...htmlOptions(warnings),
          allowedTags: [...tags, ...vml],
          selfClosing: [name],
          parser: {
            xmlMode: true,
            lowerCaseTags: true,
            lowerCaseAttributeNames: true,
          },
        });
        const selfClosing = raw
          .slice(parser.startIndex, parser.endIndex + 1)
          .endsWith("/>");
        out += selfClosing ? cleaned : cleaned.replace(/\s*\/>$/, ">");
      },
      ontext(text) {
        if (blocked) return;
        if (style) css += text;
        else out += escapeAttribute(text);
      },
      onclosetag(name, implied) {
        if (blocked) {
          blocked--;
          return;
        }
        if (name === "style") {
          style = false;
          out += `<style>${cleanCss(css, warnings)}</style>`;
          return;
        }
        if (
          !implied &&
          allowed.has(name) &&
          ![
            "img",
            "br",
            "hr",
            "meta",
            "col",
            "w:anchorlock",
            "v:fill",
            "v:stroke",
          ].includes(name)
        )
          out += `</${name}>`;
      },
      oncomment() {
        warnings.push("Nested comments in an Outlook fallback were removed.");
      },
    },
    {
      xmlMode: true,
      decodeEntities: true,
      lowerCaseTags: true,
      lowerCaseAttributeNames: true,
    },
  );
  parser.end(raw);
  return out;
}

export function protectOutlook(raw: string, warnings: string[]) {
  const fragments: string[] = [];
  const key = createHash("sha256").update(raw).digest("hex").slice(0, 24);
  const valid = (condition: string) =>
    /^(?:\s|\(|\)|!|\||&|mso|IE|gte|gt|lte|lt|[0-9])+$/i.test(condition) &&
    /mso|IE/i.test(condition);
  const html = raw.replace(/<!--([\s\S]*?)-->/g, (_, data: string) => {
    const hidden = data.match(/^\[if ([^\]]+)\]>([\s\S]*?)<!\[endif\]$/i);
    const revealed = data.match(/^\[if ([^\]]+)\]><!$/i);
    let safe: string | undefined;
    if (hidden && valid(hidden[1]))
      safe = `<!--[if ${hidden[1]}]>${outlookFragment(hidden[2], warnings)}<![endif]-->`;
    else if (revealed && valid(revealed[1])) safe = `<!--${data}-->`;
    else if (data === "<![endif]") safe = `<!--${data}-->`;
    else if (/\[if|\[endif/i.test(data))
      warnings.push(
        "An unsupported conditional block was removed. Review the resulting layout.",
      );
    if (!safe) return "";
    const index = fragments.push(safe) - 1;
    return `<esoutlook data-key="${key}-${index}"></esoutlook>`;
  });
  return {
    html,
    restore: (value: string) =>
      value.replace(
        new RegExp(
          `<esoutlook\\b[^>]*data-key="${key}-(\\d+)"[^>]*><\\/esoutlook>`,
          "g",
        ),
        (_, i: string) => fragments[Number(i)] ?? "",
      ),
  };
}
