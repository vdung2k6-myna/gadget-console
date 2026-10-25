import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { claimErrorKey, deviceLabel, elapsed, elapsedText, turnTimeText } from "../src/lib/ui/format";
import { vi } from "../src/lib/i18n/dictionaries/vi";
import { en } from "../src/lib/i18n/dictionaries/en";

describe("a device's label", () => {
  it("is its name when it has one", () => {
    assert.equal(deviceLabel({ name: "Phòng khách", deviceId: "b81f3f4a9b01" }), "Phòng khách");
  });

  it("is its identifier when the name is empty or blank", () => {
    assert.equal(deviceLabel({ name: "", deviceId: "b81f3f4a9b01" }), "b81f3f4a9b01");
    assert.equal(deviceLabel({ name: "   ", deviceId: "b81f3f4a9b01" }), "b81f3f4a9b01");
  });
});

describe("how long ago a device was seen", () => {
  const now = new Date("2026-10-25T12:00:00Z");

  it("answers what kind of time passed, without any words", () => {
    assert.deepEqual(elapsed(null, now), { kind: "never" });
    assert.deepEqual(elapsed(undefined, now), { kind: "never" });
    assert.deepEqual(elapsed(new Date("2026-10-25T11:59:40Z"), now), { kind: "justNow" });
    assert.deepEqual(elapsed(new Date("2026-10-25T11:55:00Z"), now), { kind: "minutes", value: 5 });
    assert.deepEqual(elapsed(new Date("2026-10-25T09:00:00Z"), now), { kind: "hours", value: 3 });
    assert.deepEqual(elapsed(new Date("2026-10-23T12:00:00Z"), now), { kind: "days", value: 2 });
    assert.deepEqual(elapsed(new Date("2026-08-01T12:00:00Z"), now), {
      kind: "date",
      at: new Date("2026-08-01T12:00:00Z"),
    });
  });

  it("is phrased by the dictionary, in either language", () => {
    const five = elapsed(new Date("2026-10-25T11:55:00Z"), now);
    assert.equal(elapsedText(five, vi, "vi"), "5 phút trước");
    assert.equal(elapsedText(five, en, "en"), "5 minutes ago");

    const one = elapsed(new Date("2026-10-25T11:59:00Z"), now);
    assert.equal(elapsedText(one, en, "en"), "1 minute ago", "the plural is the dictionary's business");

    assert.equal(elapsedText({ kind: "never" }, vi, "vi"), vi.time.never);
    assert.equal(elapsedText({ kind: "never" }, en, "en"), en.time.never);
    assert.equal(elapsedText({ kind: "justNow" }, vi, "vi"), vi.time.justNow);
  });

  it("falls back to a locale-formatted date once days stop being useful", () => {
    const old = elapsed(new Date("2026-08-01T12:00:00Z"), now);
    assert.match(elapsedText(old, en, "en"), /2026/);
    assert.match(elapsedText(old, vi, "vi"), /2026/);
  });
});

describe("a turn's time", () => {
  it("is a local date and time in the chosen language", () => {
    const at = new Date("2026-10-25T05:30:00Z");
    assert.match(turnTimeText(at, "vi"), /2026/);
    assert.match(turnTimeText(at, "en"), /2026/);
    assert.match(turnTimeText(at, "en"), /\d{1,2}:\d{2}/);
  });
});

describe("a refused claim", () => {
  it("names which of the three refusals it was", () => {
    assert.equal(claimErrorKey(404), "claimUnknown");
    assert.equal(claimErrorKey(410), "claimExpired");
    assert.equal(claimErrorKey(409), "claimTaken");
    assert.equal(claimErrorKey(400), null, "anything else is the route's own words");
  });

  it("has words for each, in both languages", () => {
    for (const key of ["claimUnknown", "claimExpired", "claimTaken"] as const) {
      assert.ok(vi.devices[key].length > 0, `vi ${key}`);
      assert.ok(en.devices[key].length > 0, `en ${key}`);
      assert.notEqual(vi.devices[key], en.devices[key], `${key} must not alias the two languages`);
    }
  });
});
