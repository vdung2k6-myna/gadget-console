"use client";

import { useRouter } from "next/navigation";
import { useStrings } from "./LocaleProvider";

export function SignOutButton() {
  const strings = useStrings();
  const router = useRouter();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    router.push("/");
    router.refresh();
  }

  return (
    <button onClick={signOut} className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
      {strings.nav.signOut}
    </button>
  );
}
