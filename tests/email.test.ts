import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeEmail,
  renderSnapshot,
} from "../packages/email-renderer/src/index";
test("HTML import removes active content while keeping responsive tables and media queries", () => {
  const result = normalizeEmail(
    '<html><head><style>@media(max-width:600px){.card{width:100%!important}} .card{color:red}</style></head><body><table width="600" class="card"><tr><td onclick="bad()">Hello<img src="https://example.com/a.png"></td></tr></table><script>alert(1)</script><iframe src="https://evil.test"></iframe><form><input></form><a href="javascript:alert(1)">x</a></body></html>',
  );
  assert(result.html.includes("<table"));
  assert(result.html.includes("@media"));
  assert(result.html.includes("https://example.com/a.png"));
  assert(!/script|onclick|javascript:|<iframe|<form|<input/.test(result.html));
  assert(result.text.includes("Hello"));
});
test("email pipeline does not fetch remote CSS or resources and warns about unsafe conditional content", () => {
  const result = normalizeEmail(
    '<link rel="stylesheet" href="http://localhost/private"><style>@import "http://localhost/private";p{background:url(javascript:bad())}</style><!--[if mso]><script>bad()</script><![endif]--><p>Hello</p>',
  );
  assert(!result.html.includes("@import"));
  assert(!result.html.includes("localhost"));
  assert(!result.html.includes("javascript"));
  assert(result.warnings.length > 0);
});
test("preview and per-recipient sending add an isolated unsubscribe fallback below stored HTML", () => {
  const snapshot = normalizeEmail("<p>Hello</p>");
  const html = renderSnapshot(snapshot.html, "https://example.com/u/token");
  assert(html.includes("https://example.com/u/token"));
  assert(html.includes("Hello"));
  assert(html.includes('role="presentation"'));
  assert(html.includes(">Unsubscribe</a>"));
  assert(html.indexOf("Hello") < html.indexOf(">Unsubscribe</a>"));
});
test("template unsubscribe placeholder controls placement without adding a second footer", () => {
  const snapshot = normalizeEmail(
    '<table><tr><td>Message</td></tr><tr><td><a href="{{unsubscribe_url}}">Manage email preferences</a></td></tr></table>',
  );
  const url = "https://example.com/u/token";
  const html = renderSnapshot(snapshot.html, url);
  assert(html.includes(`href="${url}"`));
  assert(html.includes("Manage email preferences"));
  assert.equal(html.split(url).length - 1, 1);
  assert(!html.includes(">Unsubscribe</a>"));
});
