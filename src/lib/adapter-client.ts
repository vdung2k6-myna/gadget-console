import { randomUUID } from "node:crypto";

/**
 * The console's HTTP client for a registered adapter.
 *
 * It carries the token only in the Authorization header, sends a fresh request id,
 * applies a per-call timeout and a response-size cap, and retries only idempotent
 * calls. A timeout, a 429, an upstream 5xx and a malformed body are distinct
 * failures so the router can fall back without guessing. No error message carries
 * the token.
 */

export type AdapterClientErrorCode =
  | "timeout"
  | "network"
  | "rate_limit"
  | "upstream"
  | "http"
  | "malformed-response"
  | "response-too-large";

export class AdapterClientError extends Error {
  constructor(
    readonly code: AdapterClientErrorCode,
    message: string,
    readonly requestId: string,
    readonly status?: number,
    readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = "AdapterClientError";
  }
}

export interface AdapterClientOptions {
  endpoint: string;
  token: string;
  adapterId: string;
  tenantId: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRetries?: number;
  contractVersion?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface AdapterRequestOptions {
  method?: "GET" | "POST";
  /** A JSON string sets the JSON content type; a FormData body sets its own boundary. */
  body?: BodyInit;
  headers?: Record<string, string>;
  /** Only idempotent calls are retried. LLM starts are not idempotent once streaming. */
  idempotent?: boolean;
}

export interface AdapterResponse<T> {
  status: number;
  requestId: string;
  body: T;
}

const RETRYABLE_STATUS = new Set([502, 503, 504]);

function retryAfterMs(headers: Headers): number {
  const raw = headers.get("retry-after");
  if (raw === null) return 0;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 30_000) : 0;
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error("response-too-large");
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error("response-too-large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

export function createAdapterClient(options: AdapterClientOptions) {
  const base = options.endpoint.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBytes = options.maxResponseBytes ?? 4 * 1024 * 1024;
  const retries = Math.max(0, options.maxRetries ?? 2);
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  async function request<T>(
    path: string,
    requestOptions: AdapterRequestOptions = {}
  ): Promise<AdapterResponse<T>> {
    const attempts = requestOptions.idempotent === true ? retries + 1 : 1;
    let last: AdapterClientError | undefined;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const requestId = randomUUID();
      let response: Response;
      try {
        response = await fetchImpl(`${base}${path.startsWith("/") ? path : `/${path}`}`, {
          method: requestOptions.method ?? "GET",
          redirect: "error",
          headers: {
            accept: "application/json",
            "x-adapter-id": options.adapterId,
            "x-tenant-id": options.tenantId,
            "x-contract-version": String(options.contractVersion ?? 1),
            "x-request-id": requestId,
            authorization: `Bearer ${options.token}`,
            ...(typeof requestOptions.body === "string"
              ? { "content-type": "application/json" }
              : {}),
            ...(requestOptions.headers ?? {}),
          },
          ...(requestOptions.body === undefined ? {} : { body: requestOptions.body }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        last = new AdapterClientError(
          error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network",
          "the adapter could not be reached",
          requestId
        );
        if (attempt + 1 < attempts) continue;
        throw last;
      }

      if (response.status === 429) {
        const wait = retryAfterMs(response.headers);
        await response.body?.cancel().catch(() => {});
        last = new AdapterClientError(
          "rate_limit",
          "the adapter is rate-limiting",
          requestId,
          429,
          wait
        );
        if (attempt + 1 < attempts) {
          await sleep(wait);
          continue;
        }
        throw last;
      }

      if (RETRYABLE_STATUS.has(response.status)) {
        await response.body?.cancel().catch(() => {});
        last = new AdapterClientError(
          "upstream",
          "the adapter's upstream failed",
          requestId,
          response.status
        );
        if (attempt + 1 < attempts) continue;
        throw last;
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new AdapterClientError(
          "http",
          `the adapter answered ${response.status}`,
          requestId,
          response.status
        );
      }

      let text: string;
      try {
        text = await readLimited(response, maxBytes);
      } catch (error) {
        throw new AdapterClientError(
          error instanceof Error && error.message === "response-too-large"
            ? "response-too-large"
            : "network",
          "the adapter's response could not be read",
          requestId,
          response.status
        );
      }

      try {
        return { status: response.status, requestId, body: JSON.parse(text) as T };
      } catch {
        throw new AdapterClientError(
          "malformed-response",
          "the adapter's response was not JSON",
          requestId,
          response.status
        );
      }
    }

    throw last ?? new AdapterClientError("network", "the adapter could not be reached", "");
  }

  return {
    request,
    getJson: <T>(path: string, requestOptions: AdapterRequestOptions = {}) =>
      request<T>(path, { ...requestOptions, method: "GET", idempotent: requestOptions.idempotent ?? true }),
    postJson: <T>(path: string, body: unknown, requestOptions: AdapterRequestOptions = {}) =>
      request<T>(path, {
        ...requestOptions,
        method: "POST",
        body: JSON.stringify(body),
        idempotent: requestOptions.idempotent ?? false,
      }),
  };
}
