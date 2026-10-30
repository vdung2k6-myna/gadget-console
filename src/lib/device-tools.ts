import { eq } from "drizzle-orm";
import { normalizeDeviceId } from "@/lib/claims";
import { getDb } from "@/lib/db/client";
import { devices } from "@/lib/db/schema";

/**
 * What a gadget's firmware says it can do.
 *
 * The catalogue comes from the gadget, through the bridge, once per session. It is
 * shown to the owner and used for nothing else: a reported tool is never an
 * authorisation, because the gadget's own refusal is what decides a call.
 *
 * The bounds are the console's, not the firmware's. A report beyond them is
 * refused whole rather than truncated — a shortened description would be a
 * sentence the firmware did not write.
 */

export interface ReportedTool {
  name: string;
  description: string;
}

export const TOOL_LIMITS = {
  maxTools: 64,
  maxName: 120,
  // A description is the firmware's own instruction to a model, not a one-line
  // summary: the XIAOZHI.VN build ships several past 600 characters and two past
  // 4000 — usage notes with examples — and refusing one refused the whole
  // catalogue, leaving a device page that listed nothing. The page wraps text, so
  // length costs it nothing; 20000 is still a bound, and a report past it is refused
  // whole rather than stored as something no page could show.
  maxDescription: 20000,
} as const;

export type ToolValidation =
  | { ok: true; tools: ReportedTool[] }
  | { ok: false; errors: string[] };

export function validateToolReport(input: unknown): ToolValidation {
  if (typeof input !== "object" || input === null) {
    return { ok: false, errors: ["a tool report must be an object"] };
  }
  const body = input as { tools?: unknown };
  if (!Array.isArray(body.tools)) {
    return { ok: false, errors: ["tools must be an array"] };
  }
  if (body.tools.length > TOOL_LIMITS.maxTools) {
    return { ok: false, errors: [`at most ${TOOL_LIMITS.maxTools} tools, got ${body.tools.length}`] };
  }

  const tools: ReportedTool[] = [];
  const errors: string[] = [];

  body.tools.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      errors.push(`tool ${index} is not an object`);
      return;
    }
    const { name, description } = entry as { name?: unknown; description?: unknown };
    if (typeof name !== "string" || name.trim() === "") {
      errors.push(`tool ${index} has no name`);
      return;
    }
    if (name.length > TOOL_LIMITS.maxName) {
      errors.push(`tool ${index}'s name is longer than ${TOOL_LIMITS.maxName} characters`);
      return;
    }
    if (typeof description !== "string") {
      errors.push(`tool ${index} has no description`);
      return;
    }
    if (description.length > TOOL_LIMITS.maxDescription) {
      errors.push(`tool ${index}'s description is longer than ${TOOL_LIMITS.maxDescription} characters`);
      return;
    }
    tools.push({ name: name.trim(), description });
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, tools };
}

/** Records a catalogue for a device the bridge knows, and says whether it knew it. */
export async function recordDeviceTools(
  rawDeviceId: string,
  tools: readonly ReportedTool[]
): Promise<boolean> {
  const rows = await getDb()
    .update(devices)
    .set({ tools: [...tools], toolsReportedAt: new Date() })
    .where(eq(devices.deviceId, normalizeDeviceId(rawDeviceId)))
    .returning({ id: devices.id });
  return rows.length > 0;
}
