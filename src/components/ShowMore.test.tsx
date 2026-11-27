import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, values: Record<string, number>) =>
      `${key}:${values["count"]}/${values["remaining"]}`,
  }),
}));

import { ShowMore } from "@/components/ShowMore";

const list = (items: number[], step?: number) =>
  renderToStaticMarkup(
    <ShowMore items={items} {...(step ? { step } : {})}>
      {(visible) => (
        <ul>
          {visible.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </ShowMore>,
  );

describe("ShowMore", () => {
  it("shows the first step and says how many are left", () => {
    const html = list([1, 2, 3, 4, 5], 2);
    expect(html.match(/<li>/g)).toHaveLength(2);
    expect(html).toContain("common.showMore:2/3");
  });

  it("offers nothing more when the list fits", () => {
    const html = list([1, 2, 3]);
    expect(html.match(/<li>/g)).toHaveLength(3);
    expect(html).not.toContain("common.showMore");
  });
});
