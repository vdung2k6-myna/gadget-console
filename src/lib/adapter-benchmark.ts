import { eq } from "drizzle-orm";

import { createAdapterClient } from "@/lib/adapter-client";
import type { AdapterRow } from "@/lib/adapters";
import { getDb } from "@/lib/db/client";
import { providerAdapters } from "@/lib/db/schema";

/**
 * The Vietnamese benchmark: word error rate from supplied fixtures, TTS
 * naturalness supplied by the reviewer (a machine cannot judge it), and the
 * latency distribution the platform observed. The result is persisted on the
 * adapter so a manifest change can require a re-run.
 */

export interface BenchmarkFixture {
  audio: Uint8Array;
  expected: string;
}

export interface BenchmarkOptions {
  fetchImpl?: typeof fetch;
  fixtures: BenchmarkFixture[];
  ttsNaturalness?: number | null;
  ttsSample?: { voice?: string } | null;
}

export interface BenchmarkReport {
  wer: number | null;
  ttsNaturalness: number | null;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  samples: number;
}

function words(text: string): string[] {
  return text.trim().toLowerCase().split(/\s+/).filter((word) => word !== "");
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}

export async function runVietnameseBenchmark(
  adapter: AdapterRow,
  token: string,
  options: BenchmarkOptions
): Promise<BenchmarkReport> {
  if (adapter.tenantId === null) throw new Error("a benchmark needs a tenant adapter");
  if (options.fixtures.length === 0) throw new Error("at least one STT fixture is required");

  const client = createAdapterClient({
    endpoint: adapter.endpoint,
    token,
    adapterId: adapter.id,
    tenantId: adapter.tenantId,
    fetchImpl: options.fetchImpl,
    maxRetries: 0,
  });

  const latencies: number[] = [];
  let errors = 0;
  let total = 0;
  for (const fixture of options.fixtures) {
    const form = new FormData();
    form.append("language", "vi");
    form.append("audio", new Blob([Buffer.from(fixture.audio)], { type: "audio/wav" }), "fixture.wav");
    const started = Date.now();
    const response = await options.fetchImpl?.(
      `${adapter.endpoint.replace(/\/+$/, "")}/stt/transcribe`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "x-adapter-id": adapter.id,
          "x-tenant-id": adapter.tenantId,
          "x-contract-version": "1",
        },
        body: form,
      }
    );
    latencies.push(Date.now() - started);
    if (response === undefined || response.status !== 200) throw new Error("STT benchmark failed");
    const body = (await response.json()) as { text?: unknown };
    const actual = typeof body.text === "string" ? body.text : "";
    const expectedWords = words(fixture.expected);
    const actualWords = words(actual);
    total += expectedWords.length;
    errors += expectedWords.filter((word, index) => actualWords[index] !== word).length;
  }

  const naturalness = options.ttsNaturalness ?? null;
  if (naturalness === null && adapter.kinds.includes("tts") && options.ttsSample !== null) {
    const started = Date.now();
    await client.postJson("/tts/synthesize", { text: "xin chào", voice: options.ttsSample?.voice ?? "default", format: "wav" });
    latencies.push(Date.now() - started);
  }

  const report: BenchmarkReport = {
    wer: total === 0 ? null : errors / total,
    ttsNaturalness: naturalness,
    latencyP50Ms: percentile(latencies, 0.5),
    latencyP95Ms: percentile(latencies, 0.95),
    samples: options.fixtures.length,
  };

  await getDb()
    .update(providerAdapters)
    .set({
      quality: {
        wer: report.wer ?? undefined,
        ttsNaturalness: report.ttsNaturalness ?? undefined,
        latencyP50Ms: report.latencyP50Ms ?? undefined,
      },
      verification: {
        benchmark: report,
        manifestVersion: adapter.manifestVersion,
        benchmarkedAt: new Date().toISOString(),
      },
      updatedAt: new Date(),
    })
    .where(eq(providerAdapters.id, adapter.id));

  return report;
}
