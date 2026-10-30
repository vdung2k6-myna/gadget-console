import { redirect } from "next/navigation";

export const instant = false;

export default function EditLlmProfilePage() {
  redirect("/provider-profiles");
}
