/**
 * The one way a form talks to the console's own routes.
 *
 * Every write goes through `/api`, with the session cookie, and comes back as
 * the route's own status and words — the same contract the bridge is built
 * against. A `401` is handled here rather than in each form: the session ended
 * while the page was open, and the only useful thing to do is sign in again.
 */

export interface Answer {
  ok: boolean;
  status: number;
  /** The route's message, whichever shape it used. */
  message: string;
  /** The route's JSON, when it answered with some and the caller needs it (a test sample, a list). */
  data?: unknown;
}

export async function sendJson(
  path: string,
  body: unknown,
  method: "POST" | "PUT" | "PATCH" | "DELETE" = "POST"
): Promise<Answer> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, message: "Không kết nối được tới console." };
  }

  if (response.status === 401) {
    window.location.assign("/");
    return { ok: false, status: 401, message: "Phiên đã hết hạn." };
  }

  const payload = await readPayload(response);
  return {
    ok: response.ok,
    status: response.status,
    message: payload.message,
    ...(payload.data === undefined ? {} : { data: payload.data }),
  };
}

async function readPayload(response: Response): Promise<{ message: string; data?: unknown }> {
  if (response.status === 204) return { message: "" };
  try {
    const body = (await response.json()) as { error?: unknown; errors?: unknown };
    if (typeof body.error === "string") return { message: body.error, data: body };
    if (Array.isArray(body.errors)) {
      return {
        message: body.errors.filter((entry): entry is string => typeof entry === "string").join("; "),
        data: body,
      };
    }
    return { message: "", data: body };
  } catch {
    // A body that is not JSON has nothing to say that the status does not.
    return { message: "" };
  }
}
