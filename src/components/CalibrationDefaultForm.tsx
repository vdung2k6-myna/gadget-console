"use client";

import { useState } from "react";

/** The deployment default: what a device without its own pair uses. */
export function CalibrationDefaultForm({ initial }: { initial: { threshold: number; minFrames: number } }) {
  const [threshold, setThreshold] = useState(String(initial.threshold));
  const [minFrames, setMinFrames] = useState(String(initial.minFrames));
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/calibration/default", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threshold: Number(threshold), minFrames: Number(minFrames) }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        default?: { threshold: number; minFrames: number };
        errors?: string[];
      };
      if (!response.ok || body.default === undefined) {
        setMessage((body.errors ?? ["the request failed"]).join("; "));
        return;
      }
      setThreshold(String(body.default.threshold));
      setMinFrames(String(body.default.minFrames));
      setMessage("Saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-3 text-sm">
      <p>
        Devices without their own pair use <strong>{initial.threshold}</strong> with{" "}
        <strong>{initial.minFrames}</strong> frame(s).
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500 dark:text-zinc-400">Threshold (0–1)</span>
          <input
            className="w-28 rounded border border-zinc-300 bg-transparent px-2 py-1 font-mono dark:border-zinc-700"
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500 dark:text-zinc-400">Frames</span>
          <input
            className="w-24 rounded border border-zinc-300 bg-transparent px-2 py-1 font-mono dark:border-zinc-700"
            value={minFrames}
            onChange={(event) => setMinFrames(event.target.value)}
          />
        </label>
        <button
          className="rounded bg-zinc-900 px-3 py-1.5 text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          disabled={busy}
          onClick={() => void save()}
        >
          Save default
        </button>
      </div>
      {message !== null && <p className="text-zinc-600 dark:text-zinc-400">{message}</p>}
    </div>
  );
}
