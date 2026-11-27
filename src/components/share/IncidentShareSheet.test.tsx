import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { OfficialIncident } from "@/lib/nadhir";
import { IncidentShareSheet } from "./IncidentShareSheet";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "fr" } }),
}));

describe("IncidentShareSheet", () => {
  it("renders on the server, where the landing page is rendered first", () => {
    const incident = {
      id: "898c4601-1ade-4a1a-adf9-83383956fc82",
      updated_at: "2026-09-27T13:40:00Z",
    } as OfficialIncident;
    expect(
      renderToStaticMarkup(<IncidentShareSheet incident={incident} />),
    ).toContain("shareCard.open");
  });
});
