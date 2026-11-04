"use client";

import { useState } from "react";

interface Pair {
  threshold: number;
  minFrames: number;
}

export interface CalibrationView {
  effective: Pair;
  source: "device" | "default";
  device: Pair | null;
  default: Pair;
}

/**
 * A device's calibration: the pair it uses, where it came from, and the pair it owns.
 *
 * A change takes effect when the gadget next connects — the bridge resolves a device once per
 * socket — and the page says so, because an operator who changes a number and hears no difference
 * should not conclude the write failed.
 */
export function CalibrationForm({ id, initial }: { id: string; initial: CalibrationView }) {
  const [view, setView] = useState(initial);
  const [threshold, setThreshold] = useState(String(initial.effective.threshold));
  const [minFrames, setMinFrames] = useState(String(initial.effective.minFrames));
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(method: "PUT" | "DELETE"): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/devices/${id}/calibration`, {
        method,
        ...(method === "PUT"
          ? {
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ threshold: Number(threshold), minFrames: Number(minFrames) }),
            }
          : {}),
      });
      const body = (await response.json().catch(() => ({}))) as CalibrationView & {
        errors?: string[];
        error?: string;
      };
      if (!response.ok) {
        setMessage((body.errors ?? [body.error ?? "the request failed"]).join("; "));
        return;
      }
      setView(body);
      setThreshold(String(body.effective.threshold));
      setMinFrames(String(body.effective.minFrames));
      setMessage(method === "DELETE" ? "Reset to the deployment default." : "Saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-3 text-sm">
      <p>
        Using <strong>{view.effective.threshold}</strong> with <strong>{view.effective.minFrames}</strong>{" "}
        frame(s) — from {view.source === "device" ? "this device" : "the deployment default"}.
        {view.source === "device" && (
          <>
            {" "}Default: {view.default.threshold} / {view.default.minFrames}.
          </>
        )}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500 dark:text-zinc-400">Threshold (0–1)</span>
          <input
            className="w-28 rounded border border-zinc-300 bg-transparent px-2 py-1 font-mono dark:border-zinc-700"
            inputMode="decimal"
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500 dark:text-zinc-400">Frames</span>
          <input
            className="w-24 rounded border border-zinc-300 bg-transparent px-2 py-1 font-mono dark:border-zinc-700"
            inputMode="numeric"
            value={minFrames}
            onChange={(event) => setMinFrames(event.target.value)}
          />
        </label>
        <button
          className="rounded bg-zinc-900 px-3 py-1.5 text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          disabled={busy}
          onClick={() => void send("PUT")}
        >
          Save
        </button>
        <button
          className="rounded border border-zinc-300 px-3 py-1.5 disabled:opacity-50 dark:border-zinc-700"
          disabled={busy || view.device === null}
          onClick={() => void send("DELETE")}
        >
          Reset to default
        </button>
      </div>
      {message !== null && <p className="text-zinc-600 dark:text-zinc-400">{message}</p>}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        A change applies when the gadget next connects.
      </p>
    </div>
  );
}
