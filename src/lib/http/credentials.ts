/**
 * Reads the two fields a sign-in or registration carries, without trusting the
 * shape of the body: anything that is not a JSON object with two non-empty
 * strings is missing credentials rather than a server error.
 */
export async function readCredentials(
  request: Request
): Promise<{ email: string; password: string } | undefined> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return undefined;
  }
  if (typeof body !== "object" || body === null) return undefined;

  const { email, password } = body as { email?: unknown; password?: unknown };
  if (typeof email !== "string" || typeof password !== "string") return undefined;
  if (email.trim() === "" || password === "") return undefined;
  return { email, password };
}
