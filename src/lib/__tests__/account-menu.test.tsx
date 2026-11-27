import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@supabase/supabase-js";
import type { ReactNode } from "react";

const state = vi.hoisted(() => ({
  href: "/alerts?kind=road_blocked#details",
  displayName: null as string | null,
}));

vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ href: state.href }),
  useNavigate: () => vi.fn(),
  Link: ({
    to,
    search,
    children,
    ...props
  }: {
    to: string;
    search?: { returnTo: string };
    children: ReactNode;
  }) => (
    <a
      href={
        to + (search ? `?returnTo=${encodeURIComponent(search.returnTo)}` : "")
      }
      {...props}
    >
      {children}
    </a>
  ),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { display_name: state.displayName } }),
  useQueryClient: () => ({}),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { name: string }) =>
      values ? `${key}: ${values.name}` : key,
    i18n: { dir: () => "ltr" },
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { AccountMenu } from "@/components/AccountMenu";

const user: User = {
  id: "account-123",
  email: "mehdi@example.com",
  user_metadata: { full_name: "Mehdi Bourahla" },
  app_metadata: { provider: "email", providers: ["email"] },
  aud: "authenticated",
  created_at: "2026-09-14T00:00:00Z",
};

describe("account identity", () => {
  beforeEach(() => {
    state.href = "/alerts?kind=road_blocked#details";
    state.displayName = null;
  });

  it("does not flash a signed-out action while the session initializes", () => {
    const html = renderToStaticMarkup(
      <AccountMenu user={undefined} hasPanelAccess={false} />,
    );
    expect(html).toContain('role="status"');
    expect(html).not.toContain("account.signIn");
    expect(html).not.toContain('href="/auth');
  });

  it("offers sign in with the protected destination including its query and fragment", () => {
    const html = renderToStaticMarkup(
      <AccountMenu user={null} hasPanelAccess={false} />,
    );
    expect(html).toContain("account.signIn");
    expect(html).toContain(
      'href="/auth?returnTo=%2Falerts%3Fkind%3Droad_blocked%23details"',
    );
  });

  it("uses the safe default destination when viewing a public page", () => {
    state.href = "/forecast";
    const html = renderToStaticMarkup(
      <AccountMenu user={null} hasPanelAccess={false} />,
    );
    expect(html).toContain('href="/auth?returnTo=%2Fzones"');
  });

  it("names the signed-in account accessibly and shows its initial", () => {
    const html = renderToStaticMarkup(
      <AccountMenu user={user} hasPanelAccess={false} />,
    );
    expect(html).toContain(
      'aria-label="authKit.accountMenuLabel: Mehdi Bourahla"',
    );
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain(">M</span>");
    expect(html).not.toContain("account.signIn");
  });

  it("prefers the edited profile name over provider metadata", () => {
    state.displayName = "Nadhir Admin";
    const html = renderToStaticMarkup(
      <AccountMenu user={user} hasPanelAccess />,
    );
    expect(html).toContain(
      'aria-label="authKit.accountMenuLabel: Nadhir Admin"',
    );
  });

  it("falls back to the email name for password accounts", () => {
    const html = renderToStaticMarkup(
      <AccountMenu
        user={{ ...user, user_metadata: {} }}
        hasPanelAccess={false}
      />,
    );
    expect(html).toContain('aria-label="authKit.accountMenuLabel: mehdi"');
  });
});
