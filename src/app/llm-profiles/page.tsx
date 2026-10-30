import { redirect } from "next/navigation";

// The LLM connection page is the `llm` kind of a provider profile now. One page
// for all three kinds is the point of the change, so this path forwards rather
// than keeping a second place to add a model that an agent cannot select.
export const instant = false;

export default function LlmProfilesPage() {
  redirect("/provider-profiles");
}
