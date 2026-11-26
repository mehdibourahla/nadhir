import { beforeEach, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as { table: string; ops: unknown[][] }[]);
function recorder(table: string) {
  const call = { table, ops: [] as unknown[][] };
  calls.push(call);
  const query: Record<string, unknown> = {};
  for (const op of [
    "select",
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "in",
    "is",
    "not",
    "or",
    "order",
    "limit",
    "range",
  ])
    query[op] = (...args: unknown[]) => {
      call.ops.push([op, ...args]);
      return query;
    };
  query["single"] = async () => ({ data: { enabled: true }, error: null });
  query["maybeSingle"] = async () => ({ data: null, error: null });
  query["then"] = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(resolve);
  return query;
}
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: recorder,
    rpc: async () => ({ data: null, error: null }),
  },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: recorder },
}));
import { publishBroadcasts } from "@/lib/ingest/broadcast.server";
import { onmVigilanceQuery } from "@/lib/nadhir";

const onmReads = () => calls.filter((call) => call.table === "onm_vigilance");

beforeEach(() => {
  calls.length = 0;
});

it("never relays a warning ONM already replaced or cancelled", async () => {
  await publishBroadcasts();
  expect(onmReads()).toHaveLength(1);
  expect(onmReads()[0]!.ops).toContainEqual(["is", "superseded_at", null]);
  expect(onmReads()[0]!.ops).toContainEqual(["is", "cancelled_at", null]);
  expect(onmReads()[0]!.ops).toContainEqual(["is", "superseded_by", null]);
  expect(onmReads()[0]!.ops).toContainEqual(["neq", "msg_type", "Cancel"]);
});

it("keeps replaced and cancelled warnings off the map", async () => {
  await onmVigilanceQuery.queryFn!({} as never);
  expect(onmReads()[0]!.ops).toContainEqual(["is", "superseded_at", null]);
  expect(onmReads()[0]!.ops).toContainEqual(["is", "cancelled_at", null]);
  expect(onmReads()[0]!.ops).toContainEqual(["is", "superseded_by", null]);
  expect(onmReads()[0]!.ops).toContainEqual(["neq", "msg_type", "Cancel"]);
});
