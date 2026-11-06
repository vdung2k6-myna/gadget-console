"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { sendJson } from "@/lib/ui/client";
import { useStrings } from "./LocaleProvider";

const field =
  "mt-1 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

/**
 * The gadget's one active personality, changed from its card.
 *
 * The switch posts the bind the device page already uses; the card then shows
 * what the console stored, not what was clicked.
 */
export function DevicePersonality({
  deviceId,
  agentId,
  agents,
}: {
  deviceId: string;
  agentId: string | null;
  agents: { id: string; name: string }[];
}) {
  const strings = useStrings();
  const router = useRouter();
  const [value, setValue] = useState(agentId ?? "");
  const [pending, setPending] = useState(false);

  async function change(next: string): Promise<void> {
    setValue(next);
    setPending(true);
    const answer = await sendJson(
      `/api/devices/${deviceId}`,
      { agentId: next === "" ? null : next },
      "PATCH"
    );
    setPending(false);
    if (answer.ok) router.refresh();
  }

  return (
    <label className="mt-2 block text-xs text-zinc-600 dark:text-zinc-400">
      {strings.personality.change}
      <select
        className={field}
        value={value}
        disabled={pending}
        onChange={(event) => void change(event.target.value)}
      >
        <option value="">{strings.personality.none}</option>
        {agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name}
          </option>
        ))}
      </select>
    </label>
  );
}
