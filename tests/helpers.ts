/**
 * Test helpers.
 *
 * - `after()` from next/server throws outside a Next.js request, so test files
 *   mock next/server with `vi.mock("next/server", () => import("./helpers"))`.
 *   The mock queues the callbacks; `flushAfter()` runs them.
 * - `memoryCache()` is a Map-backed Runtime Cache with TTLs that records
 *   every call, so tests can check keys, names and TTLs.
 */
import type { RuntimeCache } from "@vercel/functions";

const pending: Promise<unknown>[] = [];

export function after(task: (() => unknown) | Promise<unknown>) {
  pending.push(Promise.resolve().then(() => (typeof task === "function" ? task() : task)));
}

export async function flushAfter() {
  while (pending.length) await Promise.all(pending.splice(0));
}

export type CacheCall = { op: "get" | "set" | "delete"; key: string; ttl?: number; name?: string };

export function memoryCache(opts: { failing?: boolean } = {}) {
  const data = new Map<string, { value: unknown; expires: number }>();
  const calls: CacheCall[] = [];
  const cache: RuntimeCache = {
    async get(key) {
      calls.push({ op: "get", key });
      if (opts.failing) return null;
      const hit = data.get(key);
      if (!hit || hit.expires < Date.now()) return null;
      return structuredClone(hit.value);
    },
    async set(key, value, o) {
      calls.push({ op: "set", key, ttl: o?.ttl, name: o?.name });
      if (opts.failing) return;
      data.set(key, { value: structuredClone(value), expires: Date.now() + (o?.ttl ?? 3600) * 1000 });
    },
    async delete(key) {
      calls.push({ op: "delete", key });
      data.delete(key);
    },
    async expireTag() {},
  };
  return { cache, data, calls };
}
