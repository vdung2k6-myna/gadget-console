import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PERSONALITY_TEMPLATES,
  findPersonalityTemplate,
} from "../src/lib/personality-templates";

describe("the personality templates", () => {
  it("carries every field a simple save needs", () => {
    assert.ok(PERSONALITY_TEMPLATES.length >= 3, "a picker needs a few choices");

    for (const template of PERSONALITY_TEMPLATES) {
      assert.match(template.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${template.id} is kebab-case`);
      assert.ok(template.name.trim() !== "", `${template.id} names itself`);
      assert.ok(template.description.trim() !== "", `${template.id} describes itself`);
      assert.ok(template.prompt.trim().length >= 40, `${template.id} has a real prompt`);
      assert.ok(
        template.language === "english" || template.language === "vietnamese",
        `${template.id} names a language the console offers`
      );
      assert.ok(template.voice.trim() !== "", `${template.id} names a voice`);
      assert.ok(template.runtimeName.trim() !== "", `${template.id} names a runtime`);
    }
  });

  it("does not repeat an identifier", () => {
    const ids = PERSONALITY_TEMPLATES.map((template) => template.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("finds a template by its identifier, and nothing for an unknown one", () => {
    const first = PERSONALITY_TEMPLATES[0]!;
    assert.equal(findPersonalityTemplate(first.id)?.name, first.name);
    assert.equal(findPersonalityTemplate("no-such-template"), undefined);
  });
});
