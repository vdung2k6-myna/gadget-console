import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { localeFrom } from "../src/lib/i18n/locales";
import { stringsFor } from "../src/lib/i18n/locale";
import { vi } from "../src/lib/i18n/dictionaries/vi";
import { en } from "../src/lib/i18n/dictionaries/en";

describe("which language a browser gets", () => {
  it("is Vietnamese when nothing was chosen, or the choice makes no sense", () => {
    assert.equal(localeFrom(undefined), "vi");
    assert.equal(localeFrom(""), "vi");
    assert.equal(localeFrom("zz"), "vi");
    assert.equal(localeFrom("EN"), "vi", "the cookie is written by us, so case is not guessed at");
  });

  it("is the one it chose when it makes sense", () => {
    assert.equal(localeFrom("en"), "en");
    assert.equal(localeFrom("vi"), "vi");
  });
});

describe("the dictionaries", () => {
  it("have the same keys, at every level", () => {
    const keys = (value: unknown): string[] =>
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? Object.entries(value).flatMap(([key, child]) => [`${key}.`, ...keys(child).map((inner) => `${key}.${inner}`)])
        : [];

    assert.deepEqual(keys(en).sort(), keys(vi).sort());
  });

  it("are plain data, because they cross the server-to-client boundary", () => {
    const walk = (value: unknown, path: string): void => {
      if (typeof value === "function") assert.fail(`${path} is a function; a dictionary entry must be data`);
      if (typeof value === "object" && value !== null) {
        for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
      }
    };
    walk(vi, "vi");
    walk(en, "en");
  });

  it("say different things, so one is not a copy of the other", () => {
    assert.notEqual(stringsFor("vi").nav.devices, stringsFor("en").nav.devices);
    assert.notEqual(stringsFor("vi").time.minutes, stringsFor("en").time.minutes);
  });
});
