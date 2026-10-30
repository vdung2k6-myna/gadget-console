import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

import { testSpeechProvider } from "../src/lib/provider-profiles";

/** A stub provider: it records every request and answers with whatever the test set. */
let server: Server;
let url: string;
let answer: { status: number; body: string; contentType: string };
let requests: Array<{ url: string; authorization?: string; body: Record<string, unknown> }>;

before(async () => {
  requests = [];
  answer = { status: 200, body: "RIFF....WAVE", contentType: "audio/wav" };
  server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      requests.push({
        url: req.url ?? "",
        authorization: req.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
      });
      res.writeHead(answer.status, { "content-type": answer.contentType });
      res.end(answer.body);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function reset(): void {
  requests = [];
  answer = { status: 200, body: "RIFF....WAVE", contentType: "audio/wav" };
}

describe("the speech settings test", () => {
  it("calls the endpoint in the form, with the OpenAI speech contract", async () => {
    reset();

    const result = await testSpeechProvider({
      baseUrl: `${url}/`,
      model: "engine-a",
      voice: "example_voice",
    });

    assert.equal(result.ok, true);
    assert.equal(requests.length, 1, "only the endpoint in the form is called");
    assert.equal(requests[0]?.url, "/v1/audio/speech");
    assert.deepEqual(requests[0]?.body, {
      model: "engine-a",
      input: "Xin chào, đây là giọng đọc thử.",
      voice: "example_voice",
      response_format: "wav",
    });
    assert.equal(requests[0]?.authorization, undefined, "a local provider needs no key");
  });

  it("sends a key when one is given, to that endpoint alone", async () => {
    reset();

    await testSpeechProvider({ baseUrl: url, model: "tts-1", voice: "alloy", apiKey: "sk-test" });

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.authorization, "Bearer sk-test");
  });

  it("reports a provider's refusal without throwing", async () => {
    reset();
    answer = {
      status: 502,
      contentType: "application/json",
      body: '{"detail":"Voice \'bryce\' not found"}',
    };

    const result = await testSpeechProvider({ baseUrl: url, model: "engine-a", voice: "bryce" });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /502/);
    assert.match(result.error, /not found/);
  });

  it("refuses an endpoint that is not an absolute http(s) URL", async () => {
    reset();

    const result = await testSpeechProvider({ baseUrl: "localhost:8082", model: "engine-a", voice: "x" });

    assert.equal(result.ok, false);
    assert.equal(requests.length, 0, "nothing is called for an invalid endpoint");
  });

  it("refuses an empty model or voice before calling anything", async () => {
    reset();

    assert.equal((await testSpeechProvider({ baseUrl: url, model: "", voice: "x" })).ok, false);
    assert.equal((await testSpeechProvider({ baseUrl: url, model: "engine-a", voice: "" })).ok, false);
    assert.equal(requests.length, 0);
  });
});
