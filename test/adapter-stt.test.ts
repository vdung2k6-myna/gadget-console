import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

import {
  parseAdapterSttResponse,
  transcribeWithAdapter,
} from "../src/lib/adapter-stt";

/** A stub adapter: it records every request and answers what the test set. */
let server: Server;
let url: string;
let answer: { status: number; body: string; contentType: string };
let requests: Array<{
  url: string;
  headers: IncomingMessage["headers"];
  form: FormData;
}>;

/** A 16 kHz mono 16-bit WAV, which is the contract's preferred recording. */
function wav(samples = 1600): Buffer {
  const sampleRate = 16_000;
  const dataBytes = samples * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

before(async () => {
  requests = [];
  answer = { status: 200, body: "{}", contentType: "application/json" };
  server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", async () => {
      const body = Buffer.concat(chunks);
      const form = await new Request("http://stub.test", {
        method: "POST",
        headers: { "content-type": req.headers["content-type"] ?? "" },
        body,
      }).formData();
      requests.push({ url: req.url ?? "", headers: req.headers, form });
      res.writeHead(answer.status, { "content-type": answer.contentType });
      res.end(answer.body);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function reset(): void {
  requests = [];
  answer = { status: 200, body: "{}", contentType: "application/json" };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    endpoint: url,
    token: "adp_test",
    adapterId: "adapter-1",
    tenantId: "tenant-1",
    audio: wav(),
    ...overrides,
  };
}

describe("the STT adapter client", () => {
  it("sends a 16 kHz mono WAV with its fields and reads text, language and confidence", async () => {
    reset();
    answer = {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        text: "xin chào",
        language: "vi",
        confidence: 0.92,
        segments: [{ startMs: 0, endMs: 1200, text: "xin chào" }],
      }),
    };

    const result = await transcribeWithAdapter(
      input({
        language: "vi",
        model: "stt-vi",
        timestamps: true,
        config: { model: "stt-vi", region: "vn" },
      })
    );

    assert.deepEqual(result, {
      ok: true,
      text: "xin chào",
      language: "vi",
      confidence: 0.92,
      segments: [{ startMs: 0, endMs: 1200, text: "xin chào" }],
    });

    assert.equal(requests.length, 1);
    const request = requests[0]!;
    assert.equal(request.url, "/v1/stt/transcribe");
    assert.equal(request.headers.authorization, "Bearer adp_test");
    assert.equal(request.headers["x-adapter-id"], "adapter-1");
    assert.equal(request.headers["x-tenant-id"], "tenant-1");
    assert.equal(request.headers["x-contract-version"], "1");
    assert.equal(typeof request.headers["x-request-id"], "string");
    assert.match(request.headers["content-type"] ?? "", /^multipart\/form-data; boundary=/);

    assert.equal(request.form.get("language"), "vi");
    assert.equal(request.form.get("model"), "stt-vi");
    assert.equal(request.form.get("timestamps"), "true");
    assert.equal(
      request.form.get("config"),
      JSON.stringify({ model: "stt-vi", region: "vn" })
    );

    const audio = request.form.get("audio");
    assert.ok(audio instanceof File, "the recording arrives as a file");
    assert.equal(audio.name, "audio.wav");
    assert.equal(audio.type, "audio/wav");
    assert.equal(audio.size, wav().length);
  });

  it("omits the fields a caller did not set", async () => {
    reset();
    answer = { status: 200, contentType: "application/json", body: JSON.stringify({ text: "hi" }) };

    const result = await transcribeWithAdapter(input());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.text, "hi");
    assert.equal(result.language, undefined);
    assert.equal(result.confidence, undefined);
    assert.deepEqual(result.segments, []);

    const form = requests[0]!.form;
    for (const name of ["language", "model", "timestamps", "config"]) {
      assert.equal(form.has(name), false, `${name} is left out, not sent empty`);
    }
  });

  it("reports audio the adapter refuses as unsupported, without retrying", async () => {
    reset();
    answer = { status: 422, contentType: "application/json", body: "{}" };

    const result = await transcribeWithAdapter(input());
    assert.deepEqual(result, {
      ok: false,
      reason: "unsupported",
      detail: "the adapter refused the audio as unsupported",
    });
    assert.equal(requests.length, 1, "a refusal about the input is not retried");
  });
});

describe("an adapter's declared audio limits", () => {
  it("refuses a format the adapter does not declare, before calling it", async () => {
    reset();

    const result = await transcribeWithAdapter(input({ declared: { formats: ["opus"] } }));

    assert.deepEqual(result, {
      ok: false,
      reason: "unsupported",
      detail: "the adapter does not accept wav audio",
    });
    assert.equal(requests.length, 0, "the recording never reaches the adapter");
  });

  it("refuses a recording larger than the declared request limit, before calling it", async () => {
    reset();

    const result = await transcribeWithAdapter(input({ declared: { maxRequestBytes: 100 } }));

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "unsupported");
    assert.match(result.detail, /larger than the adapter allows/);
    assert.equal(requests.length, 0);
  });

  it("refuses a recording longer than the declared audio limit, before calling it", async () => {
    reset();

    // The fixture is 0.1 s of 16 kHz mono audio.
    const result = await transcribeWithAdapter(
      input({ declared: { maxAudioSeconds: 0.05 } })
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "unsupported");
    assert.match(result.detail, /longer than the adapter allows/);
    assert.equal(requests.length, 0);
  });

  it("sends a recording that fits its declaration", async () => {
    reset();
    answer = {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ text: "hello" }),
    };

    const result = await transcribeWithAdapter(
      input({
        declared: {
          formats: ["wav"],
          maxRequestBytes: 64 * 1024,
          maxAudioSeconds: 1,
        },
      })
    );

    assert.equal(result.ok, true);
    assert.equal(requests.length, 1);
  });
});

describe("reading an adapter's transcription", () => {
  it("refuses an answer that is not the contract's shape", () => {
    for (const bad of [
      {},
      { text: 1 },
      { text: "x", language: 2 },
      { text: "x", confidence: 2 },
      { text: "x", confidence: "high" },
      { text: "x", segments: "none" },
      { text: "x", segments: [{ startMs: 5, endMs: 1, text: "x" }] },
      { text: "x", segments: [{ startMs: 0, endMs: 1 }] },
    ]) {
      const result = parseAdapterSttResponse(bad);
      assert.equal(result.ok, false, JSON.stringify(bad));
      if (result.ok) continue;
      assert.equal(result.reason, "malformed-response", JSON.stringify(bad));
    }
  });

  it("accepts an answer without the optional fields", () => {
    assert.deepEqual(parseAdapterSttResponse({ text: "hi" }), {
      ok: true,
      text: "hi",
      segments: [],
    });
  });
});
