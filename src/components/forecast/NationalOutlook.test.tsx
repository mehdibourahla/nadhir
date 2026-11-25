import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "fr" } }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    search,
    children,
    ...rest
  }: {
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string | undefined>;
    children: ReactNode;
    className?: string;
    "aria-label"?: string;
  }) => {
    const base = params?.["slug"] ? to.replace("$slug", params["slug"]) : to;
    const qs = search
      ? new URLSearchParams(
          Object.entries(search).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        ).toString()
      : "";
    return (
      <a href={qs ? `${base}?${qs}` : base} {...rest}>
        {children}
      </a>
    );
  },
}));

import { NationalOutlook } from "@/components/forecast/NationalOutlook";
import type { WilayaOutlook } from "@/lib/forecast-outlook";

const SAMPLE_ROW: WilayaOutlook = {
  wilaya: {
    id: "w-16",
    level: "wilaya",
    code: "16",
    name_ar: "الجزائر",
    name_fr: "Alger",
    name_en: "Algiers",
    name_kab: "Dzayer",
    parent_id: null,
    lat: 36.7,
    lon: 3.03,
    forest_fraction: 0.1,
    population: 3000000,
  },
  level: 4,
  weather: { level: 3, events: ["snow"] },
  fire: null,
  incidents: 2,
  quake: { magnitude: 4.5 },
  targetCommuneId: "c-1601",
};

function findElements(
  node: ReactNode,
  predicate: (el: ReactElement<Record<string, unknown>>) => boolean,
): Array<ReactElement<Record<string, unknown>>> {
  const found: Array<ReactElement<Record<string, unknown>>> = [];
  const visit = (current: ReactNode) => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (!isValidElement<Record<string, unknown>>(current)) return;
    if (predicate(current)) found.push(current);
    if ("children" in current.props) {
      visit(current.props["children"] as ReactNode);
    }
  };
  visit(node);
  return found;
}

describe("NationalOutlook", () => {
  it("renders sibling /wilaya/$slug link outside button and shows multi-hazard summary", () => {
    const html = renderToStaticMarkup(
      <NationalOutlook
        rows={[SAMPLE_ROW]}
        loading={false}
        failed={false}
        onRetry={() => undefined}
        onPick={() => undefined}
      />,
    );

    expect(html).toContain('href="/wilaya/alger"');
    expect(html).toContain("translation:track3.forecast.onmEvent.snow");
    expect(html).toContain("translation:track3.forecast.nationalIncidents");
    expect(html).toContain("translation:track3.forecast.nationalQuake");
    // Ensure link is NEVER nested inside <button>
    expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>)[\s\S])*<a\b/);
    expect(html).toContain("min-h-11");
    expect(html).not.toContain("\u2014");
    expect(html.toLowerCase()).not.toMatch(/\bsafe\b/);
  });

  it("keeps active ONM rows visible alongside a non-blocking Retry banner on partialFailure and invokes onRetry", () => {
    const onRetry = vi.fn();
    let tree: ReactNode = null;
    function Harness() {
      tree = NationalOutlook({
        rows: [SAMPLE_ROW],
        loading: false,
        failed: false,
        partialFailure: true,
        onRetry,
        onPick: () => undefined,
      });
      return <>{tree}</>;
    }

    const html = renderToStaticMarkup(<Harness />);
    expect(html).toContain('role="status"');
    expect(html).toContain("translation:track3.forecast.nationalPartialError");
    expect(html).toContain("translation:track3.forecast.retryAction");
    // Active ONM row must remain visible alongside the partial-failure banner
    expect(html).toContain('href="/wilaya/alger"');
    expect(html).toContain("translation:track3.forecast.onmEvent.snow");
    expect(html).not.toContain("outlook.nationalError");

    const statusNodes = findElements(
      tree,
      (el) => el.props["role"] === "status",
    );
    expect(statusNodes).toHaveLength(1);
    const retryButtons = findElements(
      statusNodes[0],
      (el) => el.type === "button",
    );
    expect(retryButtons).toHaveLength(1);
    expect(String(retryButtons[0]!.props["className"])).toContain("min-h-11");
    const onClick = retryButtons[0]!.props["onClick"] as () => void;
    onClick();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("preserves explicit ?lang=kab on /wilaya/$slug links", () => {
    const html = renderToStaticMarkup(
      <NationalOutlook
        rows={[SAMPLE_ROW]}
        loading={false}
        failed={false}
        lang="kab"
        onRetry={() => undefined}
        onPick={() => undefined}
      />,
    );

    expect(html).toContain('href="/wilaya/alger?lang=kab"');
  });
});
