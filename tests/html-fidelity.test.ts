import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Parser } from "htmlparser2";
import {
  normalizeEmail,
  mapEmailLinks,
  emailLinks,
  destination,
} from "@emailsystem/email";

const fixture = (name: string) =>
  readFileSync(
    new URL(`./fixtures/html/${name}.html`, import.meta.url),
    "utf8",
  );
function structure(html: string) {
  const elements: unknown[] = [],
    stack: string[] = [];
  const parser = new Parser({
    onopentag(name, attrs) {
      stack.push(name);
      if (["table", "tr", "td", "a", "img", "h1", "h2"].includes(name))
        elements.push({
          name,
          path: stack.filter((t) => t !== "tbody").join("/"),
          href: attrs.href,
          src: attrs.src,
          width: attrs.width,
          height: attrs.height,
          colspan: attrs.colspan,
        });
    },
    onclosetag() {
      stack.pop();
    },
  });
  parser.end(html);
  return elements;
}
for (const name of ["newsletter", "announcement"])
  test(`${name}: normalizing preserves semantic hierarchy, content, placements, widths and responsive CSS`, () => {
    const raw = fixture(name),
      normalized = normalizeEmail(raw);
    assert.deepEqual(structure(normalized.html), structure(raw));
    assert.match(normalized.html, /^<!doctype html><html/i);
    assert.match(normalized.html, /@media/);
    assert.match(normalized.html, /padding: ?32px/);
    assert.match(normalized.html, /border-radius: ?6px/);
    assert.match(normalized.html, /mso-table-lspace/);
    assert.match(normalized.text, /A little more possibility/);
    assert.match(normalized.text, /Explore the collection/);
    assert.deepEqual(normalized.warnings, []);
    assert.equal(normalizeEmail(raw).hash, normalized.hash);
  });
test("supported Outlook ghost tables, VML buttons and revealed fallback visibility survive", () => {
  const result = normalizeEmail(fixture("newsletter"));
  assert.match(
    result.html,
    /<!--\[if mso\]><table[^>]+><tr><td><!\[endif\]-->/,
  );
  assert.match(
    result.html,
    /<!--\[if mso\]><\/td><\/tr><\/table><!\[endif\]-->/,
  );
  assert.match(
    result.html,
    /<v:roundrect[^>]+href="https:\/\/example.com\/collection\?edition=fall&amp;source=email"/,
  );
  assert.match(result.html, /<w:anchorlock\s*\/>/);
  assert.match(result.html, /<!--\[if !mso\]><!-->/);
  assert.match(result.html, /<!--<!\[endif\]-->/);
});
test("fallback active content, handlers and unsafe CSS cannot bypass sanitization", () => {
  const result = normalizeEmail(
    '<!--[if mso]><script>alert(1)</script><v:roundrect href="javascript:alert(2)" onclick="steal()" style="width:200px;behavior:url(https://evil.example/a.htc)"><center>Keep this label</center></v:roundrect><![endif]--><p>Keep this copy</p>',
  );
  assert(!/script|onclick|behavior|alert|steal\(/i.test(result.html));
  assert.match(result.html, /Keep this label/);
  assert.match(result.html, /Keep this copy/);
  assert(result.warnings.some((w) => /Review/i.test(w)));
});
test("only selected href attributes change; VML matches CTA and visible destinations stay visible", () => {
  const raw = normalizeEmail(fixture("newsletter")).html;
  const url = "https://click.example.com/r/opaque-$&";
  const mapped = mapEmailLinks(raw, (href) =>
    href.startsWith("https://example.com/collection") ? url : href,
  );
  assert.equal(emailLinks(mapped).filter((href) => href === url).length, 1);
  assert.equal((mapped.match(/opaque-\$&amp;/g) ?? []).length, 2);
  assert.match(mapped, /Explore the collection/);
  assert.equal(
    mapEmailLinks(raw, (href) => href),
    raw,
  );
  for (const value of [
    "javascript:alert(1)",
    "https://user:pass@example.com",
    "https://example.com/\nnext",
    "https:\\example.com",
    "//example.com",
  ])
    assert.equal(destination(value), null);
  assert.equal(
    destination("https://example.com/a?x=1&y=2#part")?.href,
    "https://example.com/a?x=1&y=2#part",
  );
});
