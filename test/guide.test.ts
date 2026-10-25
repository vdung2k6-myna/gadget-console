import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { guideFor } from "../src/lib/i18n/guide";
import type { Block } from "../src/lib/i18n/guide";

function texts(block: Block): string[] {
  switch (block.kind) {
    case "p":
      return [block.text];
    case "note":
      return [block.text];
    case "steps":
      return block.items;
    case "error":
      return [block.symptom, block.cause, block.fix];
  }
}

describe("the guide", () => {
  it("has the same sections, in the same order, in both languages", () => {
    const vi = guideFor("vi").sections.map((section) => section.id);
    const en = guideFor("en").sections.map((section) => section.id);
    assert.deepEqual(en, vi);
  });

  it("uses each anchor once", () => {
    for (const locale of ["vi", "en"] as const) {
      const ids = guideFor(locale).sections.map((section) => section.id);
      assert.equal(new Set(ids).size, ids.length, `${locale} repeats an id`);
    }
  });

  it("gives every section a title and at least one block, with no empty text", () => {
    for (const locale of ["vi", "en"] as const) {
      const guide = guideFor(locale);
      assert.ok(guide.title.length > 0);
      assert.ok(guide.intro.length > 0);
      for (const section of guide.sections) {
        assert.ok(section.title.trim().length > 0, `${locale}/${section.id} has no title`);
        assert.ok(section.blocks.length > 0, `${locale}/${section.id} has no blocks`);
        for (const block of section.blocks) {
          for (const text of texts(block)) {
            assert.ok(text.trim().length > 0, `${locale}/${section.id} has an empty ${block.kind}`);
          }
        }
      }
    }
  });

  it("explains the failures a person actually meets", () => {
    for (const locale of ["vi", "en"] as const) {
      const errors = guideFor(locale).sections
        .flatMap((section) => section.blocks)
        .filter((block): block is Extract<Block, { kind: "error" }> => block.kind === "error");
      assert.ok(errors.length >= 4, `${locale} documents too few failures`);
    }
  });
});
