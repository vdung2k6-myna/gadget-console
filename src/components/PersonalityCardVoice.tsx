"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import type { AgentValue } from "./AgentForm";
import type { GadgetOption } from "./PersonalityForm";
import { rehearsalTextFor } from "@/lib/voice-defaults";
import { sendJson } from "@/lib/ui/client";
import { useStrings } from "./LocaleProvider";

const field =
  "mt-1 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const secondary =
  "rounded border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";
const primary =
  "rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";

/**
 * The voice a chosen gadget has now, and this personality being assigned to it.
 *
 * Choosing a gadget loads that gadget's active personality, so “Hear it” plays
 * the settings voice of that gadget — not the card's own voice. “Use this
 * personality” then binds the card's personality to it.
 */
export function PersonalityCardVoice({
  agent,
  gadgets,
}: {
  agent: AgentValue;
  gadgets: GadgetOption[];
}) {
  const strings = useStrings();
  const router = useRouter();

  const initial = gadgets.find((entry) => entry.agentId === agent.id) ?? gadgets[0];
  const [gadgetId, setGadgetId] = useState(initial?.id ?? "");
  const [url, setUrl] = useState("");
  const [previewPending, setPreviewPending] = useState(false);
  const [bindPending, setBindPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  const gadget = gadgets.find((entry) => entry.id === gadgetId);
  // The chosen gadget's own voice, or this personality when the gadget has none.
  const source = gadget?.agent ?? agent;

  useEffect(() => {
    return () => {
      if (url !== "") URL.revokeObjectURL(url);
    };
  }, [url]);

  async function preview(): Promise<void> {
    setPreviewPending(true);
    setError("");
    try {
      const response = await fetch("/api/agents/voice-conversion/audition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runtimeId: source.runtimeId,
          ...(source.ttsProfileId === null ? {} : { ttsProfileId: source.ttsProfileId }),
          ...(source.voice === null || source.voice.trim() === "" ? {} : { voice: source.voice }),
          ...(source.ovcConfig === null ? {} : { ovc: source.ovcConfig }),
          text: rehearsalTextFor(source.language),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      setUrl(URL.createObjectURL(await response.blob()));
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message !== ""
          ? caught.message
          : strings.personality.previewFailed
      );
    } finally {
      setPreviewPending(false);
    }
  }

  async function bind(): Promise<void> {
    if (gadget === undefined) return;
    setBindPending(true);
    setMessage("");
    setFailed(false);
    const answer = await sendJson(`/api/devices/${gadget.id}`, { agentId: agent.id }, "PATCH");
    setBindPending(false);
    setFailed(!answer.ok);
    setMessage(answer.ok ? strings.personality.saved : answer.message || strings.common.unexpected);
    if (answer.ok) router.refresh();
  }

  return (
    <div className="mt-3">
      <label className="block text-xs text-zinc-600 dark:text-zinc-400">
        {strings.personality.useOnGadget}
        <select className={field} value={gadgetId} onChange={(event) => setGadgetId(event.target.value)}>
          {gadgets.length === 0 ? (
            <option value="">{strings.personality.answersNone}</option>
          ) : (
            gadgets.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))
          )}
        </select>
      </label>

      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {gadget === undefined
          ? strings.personality.answersNone
          : gadget.agent === null
            ? `${gadget.label}: ${strings.personality.noSavedVoice}`
            : `${gadget.label}: ${source.language} · ${source.voice ?? strings.personality.none}`}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className={secondary} disabled={previewPending} onClick={() => void preview()}>
          {previewPending ? strings.personality.previewing : strings.personality.preview}
        </button>
        <button type="button" className={primary} disabled={bindPending || gadget === undefined} onClick={() => void bind()}>
          {strings.personality.switchTo}
        </button>
      </div>

      {url !== "" && (
        <audio className="mt-2 w-full" controls autoPlay src={url}>
          <track kind="captions" />
        </audio>
      )}
      {error !== "" && <p className="mt-1 text-xs text-red-700 dark:text-red-300">{error}</p>}
      {message !== "" && (
        <>
          <p className={`mt-1 text-xs ${failed ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}`}>
            {message}
          </p>
          {!failed && (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {strings.personality.appliesOnReconnect}
            </p>
          )}
        </>
      )}
    </div>
  );
}
