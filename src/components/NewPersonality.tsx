"use client";

import { useState } from "react";

import { AgentForm, type AgentValue, type ProfileOption, type RuntimeOption } from "./AgentForm";
import {
  PersonalityForm,
  type GadgetOption,
  type PersonalityDefaults,
} from "./PersonalityForm";
import { useStrings } from "./LocaleProvider";

interface Props {
  runtimes: RuntimeOption[];
  profiles: ProfileOption[];
  defaults: PersonalityDefaults;
  gadgets: GadgetOption[];
  initialGadgetId?: string;
  showGadgets?: boolean;
  showAdvanced?: boolean;
  showName?: boolean;
  agent?: AgentValue;
  isAdmin: boolean;
}

/**
 * The simple form first, the full form behind "Advanced".
 *
 * Both write the same agent through the same route; the toggle only decides
 * which fields are offered. Nothing here decides what an owner may name — the
 * agent route does that, so hiding the advanced button would not be the
 * boundary.
 */
export function NewPersonality({
  runtimes,
  profiles,
  defaults,
  gadgets,
  initialGadgetId,
  showGadgets,
  showAdvanced = true,
  showName,
  agent,
  isAdmin,
}: Props) {
  const strings = useStrings();
  const [advanced, setAdvanced] = useState(false);

  /**
   * Switch between the personality form and the full form as two screens, and
   * start the chosen one at its top. Without this, "Advanced settings" pressed
   * at the bottom of the form leaves you at the bottom of a long form, with the
   * way back to the personality out of sight.
   */
  function show(next: boolean): void {
    setAdvanced(next);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0 }));
  }

  if (advanced) {
    return (
      <div className="mt-4">
        <button type="button" className="text-sm underline" onClick={() => show(false)}>
          {strings.personality.simple}
        </button>
        <AgentForm runtimes={runtimes} profiles={profiles} agent={agent} isAdmin={isAdmin} />
      </div>
    );
  }

  return (
    <PersonalityForm
      runtimes={runtimes}
      defaults={defaults}
      gadgets={gadgets}
      initialGadgetId={initialGadgetId}
      showGadgets={showGadgets}
      showAdvanced={showAdvanced}
      showName={showName}
      agent={agent}
      isAdmin={isAdmin}
      onAdvanced={showAdvanced ? () => show(true) : undefined}
    />
  );
}
