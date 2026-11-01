import path from "node:path";

import type { OpsConfig } from "./config";

/**
 * The three Node services the pilot host runs, in one declaration: where each
 * repository sits by default, its unit, its tree, and how to know it is up.
 * The console is the only one with a build step.
 */
export const SERVICE_NAMES = ["console", "bridge", "runtime"] as const;

export type ServiceName = (typeof SERVICE_NAMES)[number];

export interface ServiceDefinition {
  name: ServiceName;
  /** Directory name to look for beside the console checkout. */
  repository: string;
  unit: string;
  remoteDir: string;
  /** Reached from the host itself, over loopback. */
  healthUrl: string;
  /** `null` for a service that runs `tsx` directly. */
  build: string[] | null;
}

export const SERVICES: Record<ServiceName, ServiceDefinition> = {
  console: {
    name: "console",
    repository: "gadget-console",
    unit: "gadget-console",
    remoteDir: "/srv/gadget-console",
    healthUrl: "http://127.0.0.1:3001/health",
    build: ["npm", "run", "build"],
  },
  bridge: {
    name: "bridge",
    repository: "gadget-bridge",
    unit: "gadget-bridge",
    remoteDir: "/srv/gadget-bridge",
    healthUrl: "http://127.0.0.1:8003/",
    build: null,
  },
  runtime: {
    name: "runtime",
    repository: "adaptive-interview-api",
    unit: "gadget-api",
    remoteDir: "/srv/adaptive-interview-api",
    healthUrl: "http://127.0.0.1:4000/health",
    build: null,
  },
};

export function parseServiceName(value: string): ServiceName {
  if ((SERVICE_NAMES as readonly string[]).includes(value)) return value as ServiceName;
  throw new Error(`unknown service ${JSON.stringify(value)}: the services are ${SERVICE_NAMES.join(", ")}`);
}

/**
 * The console is this checkout. The other two default to siblings of it, and
 * either can be named in the operator configuration.
 */
export function resolveRepository(config: OpsConfig, service: ServiceName): string {
  const configured = config.repositories?.[service];
  if (configured !== undefined) return path.resolve(configured);
  if (service === "console") return process.cwd();
  return path.resolve("..", SERVICES[service].repository);
}
