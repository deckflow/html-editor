import assert from "node:assert/strict";
import test from "node:test";

const formatting = await import("../public/textFieldFormatting.js").catch(() => ({}));

test("splits a character selection into stable flat text fields", () => {
  assert.equal(typeof formatting.splitTextFieldsForStyle, "function");
  let sequence = 0;
  const result = formatting.splitTextFieldsForStyle(
    [{ key: "self:0:h1", value: "Make", inlineStyles: {} }],
    0,
    1,
    [{ property: "text-decoration-line", value: "underline" }],
    () => `generated-${++sequence}`,
  );

  assert.deepEqual(result.fields, [
    {
      key: "self:0:h1",
      value: "M",
      inlineStyles: { "text-decoration-line": "underline" },
    },
    { key: "generated-1", value: "ake", inlineStyles: {} },
  ]);
  assert.deepEqual(result.selectedKeys, ["self:0:h1"]);
});

test("toggling an existing field updates it without nesting another span", () => {
  const result = formatting.splitTextFieldsForStyle(
    [
      {
        key: "self:0:h1",
        value: "M",
        inlineStyles: { "text-decoration-line": "underline" },
      },
      { key: "generated-1", value: "ake", inlineStyles: {} },
    ],
    0,
    1,
    [{ property: "text-decoration-line", value: "none" }],
  );

  assert.equal(result.fields.length, 2);
  assert.equal(result.fields[0].key, "self:0:h1");
  assert.equal(result.fields[0].inlineStyles["text-decoration-line"], "none");
  assert.equal(
    formatting.serializeTextFields(result.fields),
    '<span data-local-text-key="self:0:h1" style="text-decoration-line: none">M</span>'
      + '<span data-local-text-key="generated-1">ake</span>',
  );
});

test("style splits preserve the other authored inline styles", () => {
  const result = formatting.splitTextFieldsForStyle(
    [{ key: "field", value: "word", inlineStyles: { color: "#112233" } }],
    1,
    3,
    [{ property: "font-style", value: "italic" }],
    (() => {
      let sequence = 0;
      return () => `piece-${++sequence}`;
    })(),
  );

  assert.deepEqual(result.fields.map((field) => field.value), ["w", "or", "d"]);
  assert.deepEqual(result.fields[1].inlineStyles, { color: "#112233", "font-style": "italic" });
  assert.deepEqual(result.selectedKeys, ["field"]);
});

test("serializer escapes text, keys, and style values", () => {
  assert.equal(
    formatting.serializeTextFields([
      { key: 'field"1', value: "<M&", inlineStyles: { color: 'red"blue' } },
    ]),
    '<span data-local-text-key="field&quot;1" style="color: red&quot;blue">&lt;M&amp;</span>',
  );
});

test("serializer preserves semantic wrappers around styled text fields", () => {
  assert.equal(
    formatting.serializeTextFields([
      {
        key: "speaker-label",
        value: "讲法提示：",
        inlineStyles: {},
        semanticWrappers: [{ tagName: "strong", attributes: [] }],
      },
      { key: "speaker-copy", value: "说明层像制作手册。", inlineStyles: {} },
    ]),
    '<strong><span data-local-text-key="speaker-label">讲法提示：</span></strong>'
      + '<span data-local-text-key="speaker-copy">说明层像制作手册。</span>',
  );
});
