import "dotenv/config";
import { closeDb } from "../src/lib/db/client";
import { setRole } from "../src/lib/users";

/**
 * Grants or takes away the admin role. The only writer of `users.role` — there
 * is deliberately no route that reaches it.
 *
 *   npm run role -- someone@example.com admin
 */
async function main(): Promise<void> {
  const [email, role] = process.argv.slice(2);
  if (email === undefined || role === undefined) {
    console.error("usage: npm run role -- <email> <user|admin>");
    process.exitCode = 1;
    return;
  }

  const result = await setRole(email, role);
  if (!result.ok) {
    console.error(
      result.reason === "unknown-role"
        ? `unknown role ${JSON.stringify(role)}: the roles are user and admin`
        : result.reason === "protected"
          ? `${JSON.stringify(email)} is a protected admin and cannot be returned to a user`
          : `no account with the address ${JSON.stringify(email)}`
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    result.previous === result.role
      ? `${result.email} is already ${result.role}`
      : `${result.email}: ${result.previous} -> ${result.role}`
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => closeDb());
