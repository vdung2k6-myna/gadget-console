/**
 * The agent voice-conversion validator. Pure: no database and no runtime.
 *
 *   npx tsx --test test/agent-voice-conversion.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { validateAgentVoiceConversion } from "../src/lib/agent-voice-conversion";

describe("validateAgentVoiceConversion", () => {
  it("treats absent and null as inherit", () => {
    assert.deepEqual(validateAgentVoiceConversion(undefined), { ok: true, value: null });
    assert.deepEqual(validateAgentVoiceConversion(null), { ok: true, value: null });
  });

  it("accepts the explicit opt-out", () => {
    assert.deepEqual(validateAgentVoiceConversion({ enabled: false }), {
      ok: true,
      value: { enabled: false },
    });
  });

  it("accepts a valid custom config and normalizes the method", () => {
    const result = validateAgentVoiceConversion({
      pitchShift: 12,
      formantShift: 10,
      f0Method: "RMVPE",
      indexRate: 0.5,
      protect: 0.4,
      rmsMixRate: 0.2,
      filterRadius: 3,
      crepeHopLength: 160,
      effects: { reverb: { enabled: true, size: 0.3 } },
    });

    assert.equal(result.ok, true);
    assert.deepEqual((result as { value: unknown }).value, {
      pitchShift: 12,
      formantShift: 10,
      f0Method: "rmvpe",
      indexRate: 0.5,
      protect: 0.4,
      rmsMixRate: 0.2,
      filterRadius: 3,
      crepeHopLength: 160,
      effects: { reverb: { enabled: true, size: 0.3 } },
    });
  });

  it("refuses a shift outside the service's range, naming the field", () => {
    const result = validateAgentVoiceConversion({ pitchShift: 30 });
    assert.equal(result.ok, false);
    assert.match((result as { errors: string[] }).errors[0], /pitchShift/);
  });

  it("refuses an F0 method the service does not offer", () => {
    const result = validateAgentVoiceConversion({ f0Method: "bogus" });
    assert.equal(result.ok, false);
    assert.match((result as { errors: string[] }).errors[0], /f0Method/);
  });

  it("refuses a numeric knob outside its range and a fractional whole number", () => {
    const range = validateAgentVoiceConversion({ indexRate: 2 });
    assert.equal(range.ok, false);
    assert.match((range as { errors: string[] }).errors[0], /indexRate/);

    const whole = validateAgentVoiceConversion({ filterRadius: 2.5 });
    assert.equal(whole.ok, false);
    assert.match((whole as { errors: string[] }).errors[0], /whole number/);
  });

  it("refuses effects that are not an object", () => {
    const result = validateAgentVoiceConversion({ effects: [] });
    assert.equal(result.ok, false);
    assert.match((result as { errors: string[] }).errors[0], /effects/);
  });
});
