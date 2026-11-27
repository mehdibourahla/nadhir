import {
  createFileRoute,
  Outlet,
  redirect,
  useNavigate,
  useLocation,
} from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { hasSessionCookie } from "@/integrations/supabase/session-cookie";
import { authDestination, authRedirectSearch } from "@/lib/auth-destination";

export const Route = createFileRoute("/_authenticated")({
  // data-only runs beforeLoad on the server, so a signed-out visitor is redirected
  // before any markup is committed; the component still renders client-side only.
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
  const navigate = useNavigate();
  const location = useLocation();
  const [validUser, setValidUser] = useState<string | null>(null);
  const [sessionUser, setSessionUser] = useState<string | null>();
  const previousUser = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user.id ?? null;
      if (previousUser.current !== nextUser) {
        previousUser.current = nextUser;
        setValidUser(null);
        setSessionUser(nextUser);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // A dehydrated data-only match does not re-run beforeLoad on the client, and the
  // cookie check cannot see a revoked or expired session — so validate here, and
  // hold the subtree back until it resolves rather than rendering doomed queries.
  useEffect(() => {
    if (authDestination(location.href) !== location.href) return;
    if (sessionUser === undefined) return;
    let cancelled = false;
    void supabase.auth.getUser().then(({ data, error }) => {
      if (cancelled) return;
      const ok = !error && !!data.user;
      setValidUser(ok ? data.user!.id : null);
      if (!ok)
        void navigate({
          to: "/auth",
          search: authRedirectSearch(location.href, location.searchStr),
          replace: true,
        });
    });
    return () => {
      cancelled = true;
    };
  }, [navigate, location.href, location.searchStr, sessionUser]);

  if (!validUser || validUser !== sessionUser) return null;
  return <Outlet key={validUser} />;
}
