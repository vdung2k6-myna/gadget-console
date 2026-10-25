"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStrings } from "./LocaleProvider";

const field =
  "mt-1 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const submit =
  "mt-3 rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";

/**
 * Both ways in, on one page, because the first thing a person needs is to know
 * which of the two they are doing. The two failures read differently on purpose:
 * a sign-in says one thing whether the password or the address was wrong, since
 * the route does; registration says what is wrong with what was typed.
 */
export function SignInPanel() {
  return (
    <div className="grid gap-8 sm:grid-cols-2">
      <SignIn />
      <SignUp />
    </div>
  );
}

function SignIn() {
  const strings = useStrings();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submitForm(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (response.ok) {
      router.push("/devices");
      router.refresh();
      return;
    }
    setPending(false);
    setError(strings.signIn.failed);
  }

  return (
    <form onSubmit={submitForm} className="rounded border border-zinc-200 p-5 dark:border-zinc-800">
      <h2 className="text-base font-semibold">{strings.signIn.heading}</h2>
      <label className="mt-3 block text-sm">
        {strings.signIn.email}
        <input
          className={field}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </label>
      <label className="mt-3 block text-sm">
        {strings.signIn.password}
        <input
          className={field}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </label>
      <button className={submit} disabled={pending}>
        {strings.signIn.submit}
      </button>
      {error !== "" && (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </form>
  );
}

function SignUp() {
  const strings = useStrings();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submitForm(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch("/api/auth/register", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (response.ok) {
      router.push("/devices");
      router.refresh();
      return;
    }
    setPending(false);
    const body = (await response.json().catch(() => ({}))) as { error?: unknown };
    setError(typeof body.error === "string" ? body.error : strings.signUp.failed);
  }

  return (
    <form onSubmit={submitForm} className="rounded border border-zinc-200 p-5 dark:border-zinc-800">
      <h2 className="text-base font-semibold">{strings.signUp.heading}</h2>
      <label className="mt-3 block text-sm">
        {strings.signUp.email}
        <input
          className={field}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </label>
      <label className="mt-3 block text-sm">
        {strings.signUp.password}
        <input
          className={field}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </label>
      <button className={submit} disabled={pending}>
        {strings.signUp.submit}
      </button>
      {error !== "" && (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </form>
  );
}
