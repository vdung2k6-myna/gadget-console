import { redirect } from "next/navigation";

export const instant = false;

export default function NewLlmProfilePage() {
  redirect("/provider-profiles/new");
}
