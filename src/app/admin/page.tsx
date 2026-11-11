import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/admin";
import { isPlatformAdmin } from "@/lib/auth/roles";

export const instant = false;

export default async function AdminPage() {
  const admin = await requireAdmin();
  redirect(isPlatformAdmin(admin.role) ? "/admin/platform" : "/admin/devices");
}
