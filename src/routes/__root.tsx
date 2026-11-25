import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  redirect,
} from "@tanstack/react-router";
import { useEffect, useMemo, type ReactNode } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";

import { TooltipProvider } from "@/components/ui/tooltip";

import appCss from "../styles.css?url";
import {
  headTranslator,
  initLocale,
  localeInstance,
  readLocaleCookie,
  RTL_LOCALES,
  syncClientLocale,
} from "../i18n";
import { THEME_BOOT_SCRIPT, applyTheme, readThemeCookie } from "../lib/theme";
import { SiteHeader, SiteFooter, BottomTabs } from "../components/SiteChrome";
import { AlertNotifier } from "../components/AlertNotifier";
import { watchAuthCache } from "@/lib/auth-cache";
import { NATIVE, openOnWeb, webOnlyPath } from "@/lib/platform";

function NotFoundComponent() {
  const { t } = useTranslation();

  // no route matched, so no route head can title this page
  useEffect(() => {
    document.title = t("notFound.metaTitle");
  }, [t]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">
          {t("notFound.title")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("notFound.body")}
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("notFound.home")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("errorPage.title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("errorPage.body")}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("common.retry")}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {t("notFound.home")}
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    // Isomorphic: resolves the same locale on the server and on the client, so the
    // SSR markup and the hydrated tree render identical text.
    beforeLoad: ({ location }) => {
      // the SPA shell is prerendered on the server, where there is no window
      if (
        NATIVE &&
        typeof window !== "undefined" &&
        webOnlyPath(location.pathname)
      ) {
        openOnWeb(location.href);
        throw redirect({ to: "/", replace: true });
      }
      return { locale: initLocale() };
    },
    head: () => ({
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { name: "author", content: "Nadhir" },
        // deepest match wins, so this only titles pages that set none (404 included)
        { title: headTranslator()("meta.defaultTitle") },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
      links: [
        { rel: "stylesheet", href: appCss },
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        {
          rel: "preconnect",
          href: "https://fonts.gstatic.com",
          crossOrigin: "anonymous",
        },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=Inter:wght@400;500;600&family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap",
        },
        { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
        {
          rel: "icon",
          href: "/icon-192.png",
          type: "image/png",
          sizes: "192x192",
        },
        { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
        { rel: "manifest", href: "/site.webmanifest" },
      ],
    }),
    shellComponent: RootShell,
    component: RootComponent,
    notFoundComponent: NotFoundComponent,
    errorComponent: ErrorComponent,
  },
);

function RootShell({ children }: { children: ReactNode }) {
  const locale = readLocaleCookie();
  const theme = readThemeCookie();
  return (
    <html
      lang={locale}
      dir={RTL_LOCALES.includes(locale) ? "rtl" : "ltr"}
      className={theme === "dark" ? "dark" : undefined}
      suppressHydrationWarning
    >
      <head>
        {/* Must run before paint: SSR cannot know prefers-color-scheme for "system". */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient, locale } = Route.useRouteContext();
  const i18nInstance = useMemo(() => localeInstance(locale), [locale]);
  const router = useRouter();
  useEffect(() => watchAuthCache(queryClient), [queryClient]);
  // Survival Mode owns the whole screen: no header, tabs or footer competing for it.
  const survival = useRouterState({
    select: (s) =>
      s.location.pathname === "/survival" ||
      s.location.pathname.startsWith("/survival/"),
  });
  const liveMap = useRouterState({
    select: (s) => s.location.pathname === "/",
  });
  // share cards are screenshotted: nothing but the card may paint
  const bare = useRouterState({
    select: (s) => s.location.pathname.startsWith("/share-card/"),
  });

  useEffect(() => {
    // Keeps <html lang/dir> aligned with the cookie locale after hydration.
    syncClientLocale();
  }, []);

  useEffect(() => {
    if (bare || NATIVE) return;
    void import("@/integrations/supabase/legacy-session")
      .then(({ migrateLegacySession }) => migrateLegacySession())
      .catch(() => undefined);
  }, [bare]);

  useEffect(() => {
    if (bare) return;
    if (import.meta.env.PROD && !NATIVE && "serviceWorker" in navigator)
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, [bare]);

  useEffect(() => {
    if (!NATIVE) return;
    void Promise.all([import("@/lib/push-native"), import("@/lib/push")])
      .then(([{ startNativePush }, { syncSubscription, syncUserPush }]) =>
        startNativePush({
          channelName: i18nInstance.t("push.channelName"),
          translate: (key) => i18nInstance.t(key),
          navigate: (path) => void router.navigate({ href: path }),
          onToken: () => {
            void syncUserPush().catch(() => undefined);
            void syncSubscription().catch(() => undefined);
          },
        }),
      )
      .catch((error: unknown) =>
        console.error("native push unavailable", error),
      );
  }, [router, i18nInstance]);

  useEffect(() => {
    if (bare) return;
    // ADR-0004: the client re-asserts its FCM topics on load (token refresh path)
    void import("@/lib/push").then(({ syncSubscription, syncUserPush }) => {
      syncSubscription().catch(() => undefined);
      syncUserPush().catch(() => undefined);
    });
  }, [bare]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readThemeCookie() === "system") applyTheme("system");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  if (bare)
    return (
      <I18nextProvider i18n={i18nInstance}>
        <QueryClientProvider client={queryClient}>
          <Outlet />
        </QueryClientProvider>
      </I18nextProvider>
    );

  return (
    <I18nextProvider i18n={i18nInstance}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={200}>
          <div
            className={
              liveMap
                ? "flex h-dvh min-h-0 flex-col overflow-hidden [&>header]:shrink-0 [&>nav]:shrink-0"
                : "flex min-h-screen flex-col"
            }
          >
            <AlertNotifier />
            {survival ? null : <SiteHeader />}
            <main
              className={liveMap ? "min-h-0 flex-1 overflow-hidden" : "flex-1"}
            >
              {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
              <Outlet />
            </main>
            {survival ? null : (
              <>
                {liveMap ? null : <SiteFooter />}
                <BottomTabs />
              </>
            )}
          </div>
        </TooltipProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
