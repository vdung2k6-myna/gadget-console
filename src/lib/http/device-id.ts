/** The one field every bridge call names, read without trusting the body's shape. */
export async function deviceIdFrom(request: Request): Promise<string | undefined> {
  try {
    const body = (await request.json()) as { deviceId?: unknown };
    return typeof body.deviceId === "string" && body.deviceId.trim() !== ""
      ? body.deviceId
      : undefined;
  } catch {
    return undefined;
  }
}
