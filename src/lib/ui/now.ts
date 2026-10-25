import { connection } from "next/server";

/**
 * The clock a page is rendered against, read once per request.
 *
 * Next refuses a current-time read during prerender, and rightly: a page that
 * says "2 minutes ago" is a page whose answer is true only at the moment it is
 * sent. `connection()` marks the render as one that has to happen at request
 * time, so the value is real rather than baked into a static shell — and one
 * clock for the whole page keeps two rows from disagreeing about "now".
 */
export async function requestNow(): Promise<Date> {
  await connection();
  return new Date();
}
