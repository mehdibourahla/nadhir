import { useEffect, useState } from "react";
import {
  Outlet,
  createFileRoute,
  redirect,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { supabase } from "@/integrations/supabase/client";
import { hasSessionCookie } from "@/integrations/supabase/session-cookie";
import { authDestination, authRedirectSearch } from "@/lib/auth-destination";
import { AtlasLoading } from "@/ui/primitives";

export const Route = createFileRoute("/_authenticated")({
  ssr: "data-only",
  beforeLoad: ({ location }) => {
    if (!hasSessionCookie())
      throw redirect({
        to: "/auth",
        search: authRedirectSearch(location.href, location.searchStr),
        replace: true,
      });
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      if (!data.user) {
        void navigate({
          to: "/auth",
          search: {
            returnTo: authDestination(
              `${location.pathname}${location.searchStr}`,
            ),
          },
          replace: true,
        });
        return;
      }
      setChecked(true);
    });
    return () => {
      active = false;
    };
  }, [location.pathname, location.searchStr, navigate]);

  if (!checked) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12">
        <AtlasLoading label={t("authKit.checking")} />
      </div>
    );
  }

  return <Outlet />;
}
