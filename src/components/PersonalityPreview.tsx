"use client";

import { useEffect, useState } from "react";

import { useStrings } from "./LocaleProvider";

/**
 * Play a personality's voice through the same server-side audition a turn's
 * synthesis uses. The provider's key and the runtime's token stay on the server.
 */
export function PersonalityPreview({
  runtimeId,
  ttsProfileId,
  voice,
  language,
}: {
  runtimeId: string;
  ttsProfileId: string | null;
  voice: string | null;
  language: string;
}) {
  const strings = useStrings();
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    return () => {
      if (url !== "") URL.revokeObjectURL(url);
    };
  }, [url]);

  async function play(): Promise<void> {
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/agents/voice-conversion/audition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runtimeId,
          ...(ttsProfileId === null ? {} : { ttsProfileId }),
          ...(voice === null || voice.trim() === "" ? {} : { voice }),
          text:
            language === "vietnamese"
              ? "Xin chào, đây là giọng nói của tôi."
              : "Hello, this is how I sound.",
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      setUrl(URL.createObjectURL(await response.blob()));
    } catch (caught) {
      setError(caught instanceof Error && caught.message !== "" ? caught.message : strings.personality.previewFailed);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-2">
      <button type="button" className="text-xs underline" disabled={pending} onClick={() => void play()}>
        {pending ? strings.personality.previewing : strings.personality.preview}
      </button>
      {url !== "" && (
        <audio className="mt-2 w-full" controls autoPlay src={url}>
          <track kind="captions" />
        </audio>
      )}
      {error !== "" && <p className="mt-1 text-xs text-red-700 dark:text-red-300">{error}</p>}
    </div>
  );
}
