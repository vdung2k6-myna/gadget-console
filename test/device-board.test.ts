import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { boardView, firmwareView, sizeText, type BoardView } from "../src/lib/device-board";
import { stringsFor } from "../src/lib/i18n/locale";

const en = stringsFor("en");
const vi = stringsFor("vi");

const REPORT = {
  board: { type: "esp-box-3", name: "ESP32-S3-BOX-3", manufacturer: "espressif" },
  chip: "esp32s3",
  flashSize: 16_777_216,
  psramSize: 8_388_608,
  display: { width: 320, height: 240, monochrome: false },
  application: { name: "xiaozhi", version: "1.2.3" },
  language: "vi",
};

function value(view: BoardView, key: string): string | undefined {
  if (view.kind !== "reported") throw new Error("expected a reported view");
  return view.facts.find((fact) => fact.key === key)?.value;
}

describe("the board section", () => {
  it("shows every fact the firmware sent", () => {
    const view = boardView(REPORT, en);
    assert.equal(view.kind, "reported");
    assert.equal(value(view, "type"), "esp-box-3");
    assert.equal(value(view, "name"), "ESP32-S3-BOX-3");
    assert.equal(value(view, "manufacturer"), "espressif");
    assert.equal(value(view, "chip"), "esp32s3");
    assert.equal(value(view, "flash"), "16 MB");
    assert.equal(value(view, "psram"), "8 MB");
    assert.equal(value(view, "display"), "320 × 240, colour");
    assert.equal(value(view, "firmware"), "xiaozhi 1.2.3");
    assert.equal(value(view, "language"), "vi");
  });

  it("omits the fields the report did not carry", () => {
    const view = boardView({ board: { type: "bread-compact-wifi-lcd" }, chip: "esp32s3" }, en);
    assert.equal(view.kind, "reported");
    assert.equal(value(view, "type"), "bread-compact-wifi-lcd");
    assert.equal(value(view, "chip"), "esp32s3");
    for (const key of ["name", "manufacturer", "flash", "psram", "display", "firmware", "language"]) {
      assert.equal(value(view, key), undefined, key);
    }
  });

  it("does not call a report without a display a missing report", () => {
    const view = boardView({ chip: "esp32s3" }, en);
    assert.equal(view.kind, "reported");
    assert.equal(value(view, "display"), undefined);
    assert.equal(value(view, "chip"), "esp32s3");
  });

  it("says a monochrome screen is monochrome", () => {
    const view = boardView({ display: { width: 128, height: 64, monochrome: true } }, en);
    assert.equal(value(view, "display"), "128 × 64, monochrome");
  });

  it("shows a firmware name or a version alone when that is all there is", () => {
    assert.equal(value(boardView({ application: { version: "1.2.3" } }, en), "firmware"), "1.2.3");
    assert.equal(value(boardView({ application: { name: "xiaozhi" } }, en), "firmware"), "xiaozhi");
  });

  it("is its own state when the device has never reported", () => {
    assert.deepEqual(boardView(null, en), { kind: "not-reported" });
    assert.deepEqual(boardView(undefined, en), { kind: "not-reported" });
    assert.deepEqual(boardView({}, en), { kind: "not-reported" });
  });

  it("labels a fact in the language the person chose", () => {
    assert.equal(boardView(REPORT, vi).kind, "reported");
    const viView = boardView(REPORT, vi);
    const enView = boardView(REPORT, en);
    if (viView.kind !== "reported" || enView.kind !== "reported") return;
    assert.equal(viView.facts[0]?.label, "Loại bo");
    assert.equal(enView.facts[0]?.label, "Board type");
  });
});

describe("the firmware target on a device page", () => {
  it("is different when the reported version is not the target", () => {
    assert.deepEqual(firmwareView(REPORT, "1.2.4"), {
      reported: "1.2.3",
      target: "1.2.4",
      different: true,
    });
  });

  it("is not different when the device already runs the target", () => {
    assert.deepEqual(firmwareView(REPORT, "1.2.3"), {
      reported: "1.2.3",
      target: "1.2.3",
      different: false,
    });
  });

  it("has no target when none is chosen", () => {
    assert.deepEqual(firmwareView(REPORT, undefined), {
      reported: "1.2.3",
      target: null,
      different: false,
    });
  });

  it("cannot compare when the device reported no version", () => {
    assert.deepEqual(firmwareView({ board: { type: "esp-box-3" } }, "1.2.4"), {
      reported: null,
      target: "1.2.4",
      different: false,
    });
    assert.deepEqual(firmwareView(null, "1.2.4"), {
      reported: null,
      target: "1.2.4",
      different: false,
    });
  });
});

describe("a size, as a person reads it", () => {
  it("uses the largest whole unit, and keeps a fraction when there is one", () => {
    assert.equal(sizeText(16_777_216), "16 MB");
    assert.equal(sizeText(8_388_608), "8 MB");
    assert.equal(sizeText(1024), "1 KB");
    assert.equal(sizeText(1536), "1.5 KB");
    assert.equal(sizeText(0), "0 B");
    assert.equal(sizeText(undefined), undefined);
  });
});
