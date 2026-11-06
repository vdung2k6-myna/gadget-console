import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_TTS_ENGINE,
  defaultNameFor,
  defaultPromptFor,
  defaultVoiceFor,
  rehearsalTextFor,
  VOICE_STYLE_PRESETS,
  voiceStyleFor,
} from "../src/lib/voice-defaults";

describe("the voice defaults", () => {
  it("names the deployment's engine and the voice for each language", () => {
    assert.equal(DEFAULT_TTS_ENGINE, "piper");
    assert.equal(defaultVoiceFor("english"), "bryce");
    assert.equal(defaultVoiceFor("vietnamese"), "vi_VN-vais1000-medium");
    assert.equal(defaultVoiceFor("anything else"), "bryce", "an unknown language falls back to English");
  });

  it("speaks the rehearsal in the language chosen", () => {
    assert.match(rehearsalTextFor("english"), /Hello/);
    assert.match(rehearsalTextFor("vietnamese"), /Xin chào/);
    assert.notEqual(rehearsalTextFor("english"), rehearsalTextFor("vietnamese"));
  });

  it("recognizes the voice style a personality carries", () => {
    assert.equal(voiceStyleFor(null), "inherit");
    assert.equal(voiceStyleFor({ enabled: false }), "off");
    assert.equal(voiceStyleFor(VOICE_STYLE_PRESETS.monster), "monster");
    assert.equal(voiceStyleFor({ pitchShift: 3 }), "custom");
  });

  it("has a name and a prompt for each language", () => {
    for (const language of ["english", "vietnamese"]) {
      assert.ok(defaultNameFor(language).trim() !== "", `${language} has a name`);
      assert.ok(defaultPromptFor(language).trim().length > 20, `${language} has a prompt`);
    }
  });
});
