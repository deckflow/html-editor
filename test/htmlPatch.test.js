import test from "node:test";
import assert from "node:assert/strict";
import { patchElementInHtml } from "../htmlPatch.js";
import * as htmlPatchModule from "../htmlPatch.js";

test("patches text content by id without touching sibling text", () => {
  const source = '<main><h1 id="hero">Old</h1><p id="body">Keep</p></main>';

  const result = patchElementInHtml(source, { id: "hero" }, [
    { type: "text-content", value: "New" },
  ]);

  assert.equal(result.matched, true);
  assert.equal(result.changed, true);
  assert.equal(result.html, '<main><h1 id="hero">New</h1><p id="body">Keep</p></main>');
});

test("patches the requested selector index", () => {
  const source = '<ul><li class="item">One</li><li class="item">Two</li></ul>';

  const result = patchElementInHtml(source, { selector: ".item", selectorIndex: 1 }, [
    { type: "text-content", value: "Changed" },
  ]);

  assert.equal(result.matched, true);
  assert.equal(result.html, '<ul><li class="item">One</li><li class="item">Changed</li></ul>');
});

test("prefers selector index over a duplicated id with identical text", () => {
  const source = '<main><p id="dup">Same</p><p id="dup">Same</p></main>';

  const result = patchElementInHtml(
    source,
    { id: "dup", selector: "#dup", selectorIndex: 1, domPath: [0, 1], originalText: "Same" },
    [{ type: "text-content", value: "Second" }],
  );

  assert.equal(result.matched, true);
  assert.equal(result.html, '<main><p id="dup">Same</p><p id="dup">Second</p></main>');
});

test("uses a DOM path when an arbitrary element has no id or usable selector", () => {
  const source = '<html><body><main><p>First</p><p>Second</p></main></body></html>';

  const result = patchElementInHtml(
    source,
    { domPath: [0, 1], originalText: "Second" },
    [{ type: "text-content", value: "Changed" }],
  );

  assert.equal(result.matched, true);
  assert.equal(
    result.html,
    '<html><body><main><p>First</p><p>Changed</p></main></body></html>',
  );
});

test("falls back to the DOM path when a selector candidate fails the text fingerprint", () => {
  const source = '<html><body><p>First</p><p>Second</p></body></html>';

  const result = patchElementInHtml(
    source,
    {
      selector: "p",
      selectorIndex: 0,
      domPath: [1],
      originalText: "Second",
    },
    [{ type: "text-content", value: "Changed" }],
  );

  assert.equal(result.matched, true);
  assert.equal(result.html, '<html><body><p>First</p><p>Changed</p></body></html>');
});

test("refuses to patch when no candidate matches the original text fingerprint", () => {
  const source = '<html><body><p>Source changed elsewhere</p></body></html>';

  const result = patchElementInHtml(
    source,
    {
      selector: "p",
      selectorIndex: 0,
      domPath: [0],
      originalText: "Text selected in the preview",
    },
    [{ type: "text-content", value: "Unsafe overwrite" }],
  );

  assert.equal(result.matched, false);
  assert.equal(result.changed, false);
  assert.equal(result.html, source);
});

test("compares browser text with decoded HTML entities", () => {
  const source = '<html><body><p>A &amp; B</p></body></html>';

  const result = patchElementInHtml(
    source,
    { selector: "p", selectorIndex: 0, originalText: "A & B" },
    [{ type: "text-content", value: "C & D" }],
  );

  assert.equal(result.matched, true);
  assert.equal(result.html, '<html><body><p>C &amp; D</p></body></html>');
});

test("uses a unique tag and text fingerprint when the browser inserted wrapper elements", () => {
  const source = '<p>Standalone fragment</p>';

  const result = patchElementInHtml(
    source,
    {
      selector: "body > p",
      selectorIndex: 0,
      domPath: [0],
      tagName: "p",
      originalText: "Standalone fragment",
    },
    [{ type: "text-content", value: "Changed" }],
  );

  assert.equal(result.matched, true);
  assert.equal(result.html, "<p>Changed</p>");
});

test("refuses fingerprint fallback when multiple source elements are identical", () => {
  const source = '<p>Same</p><p>Same</p>';

  const result = patchElementInHtml(
    source,
    {
      selector: "body > p",
      selectorIndex: 1,
      domPath: [1],
      tagName: "p",
      originalText: "Same",
    },
    [{ type: "text-content", value: "Ambiguous" }],
  );

  assert.equal(result.matched, false);
  assert.equal(result.html, source);
});

test("adds an inline font-size style when style is missing", () => {
  const source = '<h1 id="hero">Title</h1>';

  const result = patchElementInHtml(source, { id: "hero" }, [
    { type: "inline-style", property: "font-size", value: "72px" },
  ]);

  assert.equal(result.matched, true);
  assert.equal(result.html, '<h1 id="hero" style="font-size: 72px">Title</h1>');
});

test("adds an inline text color while preserving existing styles", () => {
  const source = '<p id="copy" style="font-size: 18px">Text</p>';

  const result = patchElementInHtml(source, { id: "copy" }, [
    { type: "inline-style", property: "color", value: "#c2413a" },
  ]);

  assert.equal(result.matched, true);
  assert.equal(
    result.html,
    '<p id="copy" style="font-size: 18px; color: #c2413a">Text</p>',
  );
});

test("patches safe inline rich text inside one target element", () => {
  const source = '<p id="copy">Hello world</p>';
  const result = patchElementInHtml(source, { id: "copy", originalText: "Hello world" }, [
    {
      type: "inner-html",
      value: 'Hello <span style="color: #c2413a; font-weight: 700">world</span>',
    },
  ]);

  assert.equal(result.matched, true);
  assert.equal(
    result.html,
    '<p id="copy">Hello <span style="color: #c2413a; font-weight: 700">world</span></p>',
  );
});

test("patches mixed direct text while preserving semantic inline markup", () => {
  const source = '<div class="speaker-notes"><strong>讲法提示：</strong>旧文案</div>';
  const result = patchElementInHtml(source, {
    selector: ".speaker-notes",
    selectorIndex: 0,
    originalText: "讲法提示：旧文案",
  }, [
    {
      type: "inner-html",
      value: '<strong>讲法提示：</strong>新文案',
    },
  ]);

  assert.equal(result.matched, true);
  assert.equal(
    result.html,
    '<div class="speaker-notes"><strong>讲法提示：</strong>新文案</div>',
  );
});

test("rejects unsafe inline rich text tags and style values", () => {
  const source = '<p id="copy">Hello world</p>';
  const script = patchElementInHtml(source, { id: "copy" }, [
    { type: "inner-html", value: 'Hello <script>alert(1)</script>' },
  ]);
  const cssInjection = patchElementInHtml(source, { id: "copy" }, [
    { type: "inner-html", value: '<span style="color: url(javascript:alert(1))">Hello</span>' },
  ]);

  assert.equal(script.matched, false);
  assert.equal(cssInjection.matched, false);
  assert.equal(script.html, source);
  assert.equal(cssInjection.html, source);
});

test("persists flat text fields with stable local keys", () => {
  const source = '<h1 id="headline">Make</h1>';
  const result = patchElementInHtml(source, { id: "headline" }, [
    {
      type: "inner-html",
      value: '<span data-local-text-key="title-m" style="text-decoration-line: none">M</span>'
        + '<span data-local-text-key="title-rest">ake</span>',
    },
  ]);

  assert.equal(result.matched, true);
  assert.equal(
    result.html,
    '<h1 id="headline"><span data-local-text-key="title-m" style="text-decoration-line: none">M</span>'
      + '<span data-local-text-key="title-rest">ake</span></h1>',
  );
});

test("rejects unrecognized attributes on text fields", () => {
  const source = '<p id="copy">Hello</p>';
  const result = patchElementInHtml(source, { id: "copy" }, [
    { type: "inner-html", value: '<span data-onclick="alert(1)">Hello</span>' },
  ]);

  assert.equal(result.matched, false);
  assert.equal(result.html, source);
});

test("style patch preserves greater-than characters inside quoted attributes", () => {
  const source = '<p id="copy" title="a > b">Text</p>';

  const result = patchElementInHtml(source, { id: "copy" }, [
    { type: "inline-style", property: "color", value: "red" },
  ]);

  assert.equal(result.matched, true);
  assert.equal(result.html, '<p id="copy" title="a > b" style="color: red">Text</p>');
});

test("text patch preserves greater-than characters inside quoted attributes", () => {
  const source = '<p id="copy" title="a > b">Text</p>';

  const result = patchElementInHtml(source, { id: "copy" }, [
    { type: "text-content", value: "Changed" },
  ]);

  assert.equal(result.matched, true);
  assert.equal(result.html, '<p id="copy" title="a > b">Changed</p>');
});

test("updates an existing inline style while preserving other declarations", () => {
  const source = '<h1 id="hero" style="color: red; font-size: 32px; line-height: 1">Title</h1>';

  const result = patchElementInHtml(source, { id: "hero" }, [
    { type: "inline-style", property: "font-size", value: "96px" },
  ]);

  assert.equal(result.matched, true);
  assert.equal(
    result.html,
    '<h1 id="hero" style="color: red; font-size: 96px; line-height: 1">Title</h1>',
  );
});

test("merges multiple inline style operations on the same element", () => {
  const source = '<h1 id="hero">Title</h1>';

  const result = patchElementInHtml(source, { id: "hero" }, [
    { type: "inline-style", property: "position", value: "relative" },
    { type: "inline-style", property: "left", value: "12px" },
    { type: "inline-style", property: "top", value: "8px" },
  ]);

  assert.equal(result.matched, true);
  assert.equal(
    result.html,
    '<h1 id="hero" style="position: relative; left: 12px; top: 8px">Title</h1>',
  );
});

test("patches all text toolbar and width styles", () => {
  const source = '<p id="copy">Text</p>';

  const result = patchElementInHtml(source, { id: "copy" }, [
    { type: "inline-style", property: "font-weight", value: "700" },
    { type: "inline-style", property: "font-style", value: "italic" },
    { type: "inline-style", property: "text-decoration-line", value: "underline line-through" },
    { type: "inline-style", property: "text-align", value: "center" },
    { type: "inline-style", property: "letter-spacing", value: "2px" },
    { type: "inline-style", property: "line-height", value: "1.4" },
    { type: "inline-style", property: "width", value: "320px" },
    { type: "inline-style", property: "max-width", value: "none" },
    { type: "inline-style", property: "box-sizing", value: "border-box" },
    { type: "inline-style", property: "display", value: "inline-block" },
    { type: "inline-style", property: "overflow-wrap", value: "anywhere" },
  ]);

  assert.equal(result.matched, true);
  assert.match(result.html, /font-weight: 700/);
  assert.match(result.html, /font-style: italic/);
  assert.match(result.html, /text-decoration-line: underline line-through/);
  assert.match(result.html, /text-align: center/);
  assert.match(result.html, /letter-spacing: 2px/);
  assert.match(result.html, /line-height: 1.4/);
  assert.match(result.html, /width: 320px/);
  assert.match(result.html, /max-width: none/);
  assert.match(result.html, /box-sizing: border-box/);
  assert.match(result.html, /display: inline-block/);
  assert.match(result.html, /overflow-wrap: anywhere/);
});

test("duplicates a target element with the supplied unique id", () => {
  const source = '<main><p class="copy">Text</p><span>Keep</span></main>';

  const result = patchElementInHtml(
    source,
    { selector: ".copy", selectorIndex: 0 },
    [{ type: "duplicate-element", newId: "copy-2" }],
  );

  assert.equal(result.matched, true);
  assert.equal(
    result.html,
    '<main><p class="copy">Text</p><p class="copy" id="copy-2">Text</p><span>Keep</span></main>',
  );
});

test("duplicate patch preserves greater-than characters inside quoted attributes", () => {
  const source = '<p id="copy" title="a > b">Text</p>';

  const result = patchElementInHtml(source, { id: "copy" }, [
    { type: "duplicate-element", newId: "copy-2" },
  ]);

  assert.equal(result.matched, true);
  assert.equal(
    result.html,
    '<p id="copy" title="a > b">Text</p><p id="copy-2" title="a > b">Text</p>',
  );
});

test("replaces the cloned id when duplicating an element that already has one", () => {
  const source = '<h1 id="hero">Title</h1>';

  const result = patchElementInHtml(source, { id: "hero" }, [
    { type: "duplicate-element", newId: "hero-copy" },
  ]);

  assert.equal(result.matched, true);
  assert.equal(result.html, '<h1 id="hero">Title</h1><h1 id="hero-copy">Title</h1>');
});

test("rejects duplicate operations whose new id already exists", () => {
  const source = '<main><h1 id="hero">Title</h1><p id="hero-copy">Existing</p></main>';

  const result = patchElementInHtml(source, { id: "hero" }, [
    { type: "duplicate-element", newId: "hero-copy" },
  ]);

  assert.equal(result.matched, false);
  assert.equal(result.changed, false);
  assert.equal(result.html, source);
});

test("applies an ordered patch batch entirely in memory", () => {
  assert.equal(typeof htmlPatchModule.patchElementsInHtml, "function");
  const source = '<h1 id="hero">Title</h1>';

  const result = htmlPatchModule.patchElementsInHtml(source, [
    {
      target: { id: "hero" },
      operations: [{ type: "inline-style", property: "color", value: "red" }],
    },
    {
      target: { id: "hero" },
      operations: [{ type: "duplicate-element", newId: "hero-copy" }],
    },
    {
      target: { id: "hero-copy" },
      operations: [{ type: "inline-style", property: "color", value: "blue" }],
    },
  ]);

  assert.equal(result.matched, true);
  assert.equal(
    result.html,
    '<h1 id="hero" style="color: red">Title</h1><h1 id="hero-copy" style="color: blue">Title</h1>',
  );
});

test("returns the original HTML when any patch in a batch fails", () => {
  assert.equal(typeof htmlPatchModule.patchElementsInHtml, "function");
  const source = '<h1 id="hero">Title</h1>';

  const result = htmlPatchModule.patchElementsInHtml(source, [
    {
      target: { id: "hero" },
      operations: [{ type: "duplicate-element", newId: "hero-copy" }],
    },
    {
      target: { id: "missing" },
      operations: [{ type: "delete-element" }],
    },
  ]);

  assert.equal(result.matched, false);
  assert.equal(result.changed, false);
  assert.equal(result.failedIndex, 1);
  assert.equal(result.html, source);
});

test("deletes only the resolved target element", () => {
  const source = '<main><p id="remove">Delete me</p><p>Keep me</p></main>';

  const result = patchElementInHtml(source, { id: "remove" }, [
    { type: "delete-element" },
  ]);

  assert.equal(result.matched, true);
  assert.equal(result.html, '<main><p>Keep me</p></main>');
});

test("returns unmatched without modifying source when target cannot be found", () => {
  const source = '<h1 id="hero">Title</h1>';

  const result = patchElementInHtml(source, { id: "missing" }, [
    { type: "inline-style", property: "font-size", value: "96px" },
  ]);

  assert.equal(result.matched, false);
  assert.equal(result.changed, false);
  assert.equal(result.html, source);
});

test("escapes text content instead of injecting markup", () => {
  const source = '<p id="copy">Safe</p>';

  const result = patchElementInHtml(source, { id: "copy" }, [
    { type: "text-content", value: '<script>alert("x")</script>&' },
  ]);

  assert.equal(result.matched, true);
  assert.equal(
    result.html,
    '<p id="copy">&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;</p>',
  );
});

test("rejects text patches for complex rich text nodes", () => {
  const source = '<p id="copy">Hello <strong>world</strong></p>';

  const result = patchElementInHtml(source, { id: "copy" }, [
    { type: "text-content", value: "Flattened" },
  ]);

  assert.equal(result.matched, false);
  assert.equal(result.changed, false);
  assert.equal(result.html, source);
});
