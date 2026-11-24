import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OnmVigilance } from "@/lib/nadhir";
import { weatherOnmQuery } from "@/lib/weather-onm";

const source = vi.hoisted(() => ({
  rows: [] as OnmVigilance[],
  calls: [] as {
    filters: [string, string, string][];
    range: number[];
    order: string[];
  }[],
  historyError: false,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      expect(table).toBe("onm_vigilance");
      const call = {
        filters: [] as [string, string, string][],
        range: [] as number[],
        order: [] as string[],
      };
      source.calls.push(call);
      return {
        select(fields: string) {
          expect(fields).toContain("onset, expires, sent");
          return this;
        },
        eq(key: string, value: string) {
          call.filters.push(["eq", key, value]);
          return this;
        },
        neq(key: string, value: string) {
          call.filters.push(["neq", key, value]);
          return this;
        },
        gt(key: string, value: string) {
          call.filters.push(["gt", key, value]);
          return this;
        },
        lt(key: string, value: string) {
          call.filters.push(["lt", key, value]);
          return this;
        },
        lte(key: string, value: string) {
          call.filters.push(["lte", key, value]);
          return this;
        },
        is(key: string, value: null) {
          call.filters.push(["is", key, String(value)]);
          return this;
        },
        order(key: string) {
          call.order.push(key);
          return this;
        },
        range(from: number, to: number) {
          call.range = [from, to];
          return this;
        },
        async abortSignal() {
          if (
            source.historyError &&
            call.filters.some(
              ([operator, key]) => operator === "lt" && key === "onset",
            )
          )
            return { data: null, error: { message: "History unavailable" } };
          const rows = source.rows
            .filter((row) =>
              call.filters.every(([operator, key, value]) => {
                const actual = row[key as keyof OnmVigilance];
                if (operator === "is") return actual == null;
                if (operator === "neq") return actual !== value;
                if (actual == null) return false;
                return operator === "eq"
                  ? actual === value
                  : operator === "gt"
                    ? actual > value
                    : operator === "lt"
                      ? actual < value
                      : actual <= value;
              }),
            )
            .sort(
              (a, b) =>
                b.sent.localeCompare(a.sent) || a.id.localeCompare(b.id),
            );
          return {
            data: rows.slice(call.range[0], call.range[1]! + 1),
            error: null,
          };
        },
      };
    },
  },
}));

function bulletin(
  id: string,
  onset: string | null,
  expires: string,
  wilaya = "wilaya",
): OnmVigilance {
  return {
    id,
    cap_id: id,
    title: id,
    event: "Rain",
    severity: "Severe",
    urgency: "Expected",
    certainty: "Likely",
    onset,
    expires,
    sent: "2026-09-15T08:00:00.000Z",
    area_desc: "Djelfa",
    cap_url: null,
    wilaya_id: wilaya,
    headline_fr: null,
    superseded_at: null,
  };
}
const fetchWarnings = () =>
  new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } }).fetchQuery(
    weatherOnmQuery("wilaya"),
  );

describe("weather warning query producer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T11:00:00.000Z"));
    source.rows = [];
    source.calls = [];
    source.historyError = false;
  });
  afterEach(() => vi.useRealTimers());

  it("retrieves expired overlapping originals within selected geography and active validity bounds", async () => {
    source.rows = [
      bulletin(
        "current",
        "2026-09-15T09:00:00.000Z",
        "2026-09-15T13:00:00.000Z",
      ),
      bulletin(
        "earlier-expired",
        "2026-09-15T08:00:00.000Z",
        "2026-09-15T10:00:00.000Z",
      ),
      bulletin(
        "unrelated-old",
        "2026-09-14T08:00:00.000Z",
        "2026-09-14T10:00:00.000Z",
      ),
      bulletin(
        "other-wilaya",
        "2026-09-15T09:00:00.000Z",
        "2026-09-15T13:00:00.000Z",
        "other",
      ),
    ];
    const result = await fetchWarnings();
    expect(result.warnings.map((row) => row.id).sort()).toEqual([
      "current",
      "earlier-expired",
    ]);
    expect(source.calls[0]!.filters).toContainEqual([
      "gt",
      "expires",
      "2026-09-15T11:00:00.000Z",
    ]);
    expect(source.calls[1]!.filters).toContainEqual([
      "gt",
      "expires",
      "2026-09-15T09:00:00.000Z",
    ]);
    expect(source.calls[1]!.filters).toContainEqual([
      "lt",
      "onset",
      "2026-09-15T13:00:00.000Z",
    ]);
    for (const call of source.calls)
      expect(call.filters).toContainEqual(["eq", "wilaya_id", "wilaya"]);
  });

  it("keeps replaced bulletins out of current warnings but in their history", async () => {
    source.rows = [
      bulletin(
        "current",
        "2026-09-15T09:00:00.000Z",
        "2026-09-15T13:00:00.000Z",
      ),
      {
        ...bulletin(
          "replaced",
          "2026-09-15T09:00:00.000Z",
          "2026-09-15T13:00:00.000Z",
        ),
        superseded_at: "2026-09-15T10:00:00.000Z",
      },
    ];
    const result = await fetchWarnings();
    expect(source.calls[0]!.filters).toContainEqual([
      "is",
      "superseded_at",
      "null",
    ]);
    expect(source.calls[1]!.filters).not.toContainEqual([
      "is",
      "superseded_at",
      "null",
    ]);
    expect(result.warnings.map((row) => row.id).sort()).toEqual([
      "current",
      "replaced",
    ]);
  });

  it("paginates history and retains current warnings if history fails", async () => {
    source.rows = [
      bulletin(
        "current",
        "2026-09-15T09:00:00.000Z",
        "2026-09-15T13:00:00.000Z",
      ),
      ...Array.from({ length: 1005 }, (_, index) =>
        bulletin(
          `earlier-${index}`,
          "2026-09-15T08:00:00.000Z",
          "2026-09-15T10:00:00.000Z",
        ),
      ),
    ];
    const result = await fetchWarnings();
    expect(result.warnings).toHaveLength(1006);
    expect(source.calls.map((call) => call.range)).toEqual([
      [0, 999],
      [0, 999],
      [1000, 1999],
    ]);
    for (const call of source.calls) expect(call.order).toEqual(["sent", "id"]);
    source.historyError = true;
    const partial = await fetchWarnings();
    expect(partial.warnings.map((row) => row.id)).toEqual(["current"]);
    expect(partial.historyUnavailable).toBe(true);
  });

  it("does not query history without current warnings or invent missing onset", async () => {
    expect((await fetchWarnings()).warnings).toEqual([]);
    expect(source.calls).toHaveLength(1);
    source.calls = [];
    source.rows = [bulletin("unknown-onset", null, "2026-09-15T13:00:00.000Z")];
    expect((await fetchWarnings()).warnings.map((row) => row.id)).toEqual([
      "unknown-onset",
    ]);
    expect(source.calls).toHaveLength(1);
  });

  it("excludes Cancel records and cancelled/superseded warnings from current warnings", async () => {
    source.rows = [
      bulletin(
        "active",
        "2026-09-15T09:00:00.000Z",
        "2026-09-15T13:00:00.000Z",
      ),
      {
        ...bulletin(
          "cancelled",
          "2026-09-15T09:00:00.000Z",
          "2026-09-15T13:00:00.000Z",
        ),
        cancelled_at: "2026-09-15T10:30:00.000Z",
      },
      {
        ...bulletin(
          "cancel-record",
          "2026-09-15T09:00:00.000Z",
          "2026-09-15T13:00:00.000Z",
        ),
        msg_type: "Cancel",
      },
    ];
    const result = await fetchWarnings();
    expect(source.calls[0]!.filters).toContainEqual([
      "is",
      "cancelled_at",
      "null",
    ]);
    expect(source.calls[0]!.filters).toContainEqual([
      "is",
      "superseded_by",
      "null",
    ]);
    expect(source.calls[0]!.filters).toContainEqual([
      "neq",
      "msg_type",
      "Cancel",
    ]);
    expect(result.warnings.map((row) => row.id)).not.toContain("cancel-record");
  });
});
