import { NextResponse } from "next/server";

import { currentPlatformAdmin } from "@/lib/auth/admin";
import { findTenant } from "@/lib/tenants";
import {
  listTenantDomains,
  registerTenantDomain,
  type DomainFailure,
} from "@/lib/tenancy/domains";

type Params = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

const FAILURES: Record<DomainFailure, { status: number; error: string }> = {
  "invalid-domain": { status: 400, error: "a hostname is required" },
  "invalid-kind": { status: 400, error: "kind must be console or gateway" },
  "tenant-not-found": { status: 404, error: "not found" },
  "domain-taken": { status: 409, error: "that host is already registered" },
  "kind-taken": { status: 409, error: "the tenant already has a host of that kind" },
};

/** The white-label hosts of one tenant, on the platform admin surface. */
export async function GET(_request: Request, { params }: Params) {
  const admin = await currentPlatformAdmin();
  if (admin === undefined) return notFound();

  const { id } = await params;
  const tenant = await findTenant(id);
  if (tenant === undefined) return notFound();

  return NextResponse.json({ domains: await listTenantDomains(id) });
}

export async function POST(request: Request, { params }: Params) {
  const admin = await currentPlatformAdmin();
  if (admin === undefined) return notFound();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "the body must be JSON" }, { status: 400 });
  }

  const { id } = await params;
  const registered = await registerTenantDomain(id, body);
  if (!registered.ok) {
    const failure = FAILURES[registered.reason];
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }
  return NextResponse.json({ domain: registered.domain }, { status: 201 });
}
