import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

import { listAdapterVoices, synthesizeWithAdapter } from "../src/lib/adapter-tts";

let server: Server;
let url: string;
let answer: {
  status: number;
  body: Buffer | string;
  contentType: string;
  headers?: Record<string, string>;
};
let requests: Array<{
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}>;

function wav(): Buffer {
  const buffer = Buffer.alloc(44 + 320);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + 320, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(24_000, 24);
  buffer.writeUInt32LE(48_000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(320, 40);
  return buffer;
}

before(async () => {
  requests = [];
  answer = { status: 200, body: wav(), contentType: "audio/wav" };
  server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      requests.push({
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      res.writeHead(answer.status, {
        "content-type": answer.contentType,
        ...(answer.headers ?? {}),
      });
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
  answer = { status: 200, body: wav(), contentType: "audio/wav" };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    endpoint: url,
    token: "adp_tts",
    adapterId: "tts-1",
    tenantId: "tenant-1",
    text: "Xin chào",
    ...overrides,
  };
}

describe("the TTS adapter client", () => {
  it("synthesizes text and returns the declared WAV", async () => {
    reset();
    answer = {
      status: 200,
      body: wav(),
      contentType: "audio/wav",
      headers: { "x-audio-format": "wav", "x-sample-rate": "24000" },
    };

    const result = await synthesizeWithAdapter(
      input({
        voice: "vi-female-1",
        language: "vi",
        format: "wav",
        sampleRate: 24_000,
        rate: 1.0,
        config: { model: "tts-vi" },
      })
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.contentType, "audio/wav");
    assert.equal(result.format, "wav");
    assert.equal(result.sampleRate, 24_000);
    assert.equal(result.audio.subarray(0, 4).toString("ascii"), "RIFF");

    assert.equal(requests.length, 1);
    const request = requests[0]!;
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/v1/tts/synthesize");
    assert.equal(request.headers.authorization, "Bearer adp_tts");
    assert.equal(request.headers["x-adapter-id"], "tts-1");
    assert.equal(request.headers["x-tenant-id"], "tenant-1");
    assert.equal(request.headers["x-contract-version"], "1");
    assert.deepEqual(JSON.parse(request.body), {
      text: "Xin chào",
      voice: "vi-female-1",
      language: "vi",
      format: "wav",
      sampleRate: 24_000,
      rate: 1,
      config: { model: "tts-vi" },
    });
  });

  it("refuses an answer that is not the WAV it asked for", async () => {
    reset();
    answer = { status: 200, body: "not audio", contentType: "audio/wav" };

    const result = await synthesizeWithAdapter(input());
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "malformed-response");
  });

  it("reports a 422 as unsupported", async () => {
    reset();
    answer = { status: 422, body: "{}", contentType: "application/json" };

    const result = await synthesizeWithAdapter(input());
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "unsupported");
  });

  it("refuses an empty audio answer", async () => {
    reset();
    answer = { status: 200, body: Buffer.alloc(0), contentType: "audio/wav" };

    const result = await synthesizeWithAdapter(input());
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "empty-audio");
  });

  it("lists the adapter's voices", async () => {
    reset();
    answer = {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        voices: [
          { id: "vi-female-1", name: "Linh", languages: ["vi"], gender: "female", styles: ["neutral"] },
        ],
      }),
    };

    const result = await listAdapterVoices(input());
    assert.deepEqual(result, {
      ok: true,
      voices: [
        { id: "vi-female-1", name: "Linh", languages: ["vi"], gender: "female", styles: ["neutral"] },
      ],
    });
    assert.equal(requests[0]!.method, "GET");
    assert.equal(requests[0]!.url, "/v1/tts/voices");
  });

  it("refuses a malformed voice list", async () => {
    reset();
    answer = { status: 200, contentType: "application/json", body: JSON.stringify({ voices: [{}] }) };

    const result = await listAdapterVoices(input());
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "malformed-response");
  });
});
