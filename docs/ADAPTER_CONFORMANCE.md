# Adapter conformance and the Vietnamese benchmark

An adapter moves from `pending` to `verified` only after the conformance suite
passes and the Vietnamese benchmark is recorded. A manifest version change means
both run again.

## Conformance checklist

`runConformance` names each case; one failure does not hide the others.

| Case | Expected |
| --- | --- |
| `manifest-requires-auth` | `GET /v1/manifest` without a token answers 401 |
| `manifest-refuses-tenant-mismatch` | another `X-Tenant-Id` answers 403 |
| `manifest` | contract 1, id, version, kinds, capabilities for each kind, privacy |
| `health` | `GET /v1/health` answers 200 with `status: "ok"` |
| `llm-chat` | `POST /v1/llm/chat` is `text/event-stream` and includes a `done` event |
| `llm-tools` | the same call with `tools` is accepted |
| `llm-cancel` | aborting the request rejects with `AbortError` |
| `error-mapping` | a malformed request answers 400 with `error.code` |
| `stt-transcribe` | multipart WAV answers text and language |
| `tts-voices` | `GET /v1/tts/voices` answers a voices array |
| `tts-audio` | `POST /v1/tts/speech` answers a non-empty audio body |

## Vietnamese benchmark

`runVietnameseBenchmark` takes STT fixtures (`audio`, `expected`), a reviewed
TTS naturalness score, and measures latency around each call. It persists:

- `quality.wer`, `quality.ttsNaturalness`, `quality.latencyP50Ms`;
- `verification.benchmark` with WER, naturalness, p50/p95 latency, sample count,
  the manifest version and the timestamp.

A human supplies TTS naturalness; the runner does not pretend to judge it.

## Hard floor

| Kind | Floor |
| --- | --- |
| STT | WER ≤ `0.15` |
| TTS | naturalness ≥ `3.0` |

`speechAdapterAllowed(adapter, language)` requires `verified`, `ok` health and a
recorded score. Below the floor, or with no score, the adapter is not selected for
Vietnamese; it may serve other languages. Platform speech remains the default.
