import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  redirect,
  useLocation,
} from "@tanstack/react-router";
import { useEffect, useMemo, type ReactNode } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import { Toaster } from "sonner";

import {
  RTL_LOCALES,
  headTranslator,
  initLocale,
  localeInstance,
  readActiveLocale,
  syncClientLocale,
  type AnyLocale,
} from "@/i18n";
import { watchAuthCache } from "@/lib/auth-cache";
import { NATIVE, openOnWeb, webOnlyPath } from "@/lib/platform";
import { THEME_BOOT_SCRIPT, applyTheme, readThemeCookie } from "@/lib/theme";
import appCss from "@/styles.css?url";
import { AtlasShell } from "@/ui/app-shell";
import { AtlasButton, AtlasPanel } from "@/ui/primitives";

const ATLAS_FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800&family=Fraunces:opsz,wght@9..144,500;9..144,600&family=JetBrains+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    beforeLoad: ({ location }) => {
      if (
        NATIVE &&
        typeof window !== "undefined" &&
        webOnlyPath(location.pathname)
      ) {
        openOnWeb(location.href);
        throw redirect({ to: "/", replace: true });
      }
      return { locale: initLocale(location.searchStr) };
    },
    head: () => ({
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { name: "author", content: "Nadhir" },
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
        { rel: "stylesheet", href: ATLAS_FONTS_URL },
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
    shellComponent: RootDocument,
    component: RootApp,
    notFoundComponent: RootNotFound,
    errorComponent: RootError,
  },
);

function RootDocument({ children }: { children: ReactNode }) {
  const ctx = Route.useRouteContext();
  const locale: AnyLocale = ctx?.locale ?? readActiveLocale();
  const dir = (RTL_LOCALES as readonly string[]).includes(locale)
    ? "rtl"
    : "ltr";
  const initialTheme = readThemeCookie();

  return (
    <html
      lang={locale}
      dir={dir}
      className={initialTheme === "dark" ? "dark" : undefined}
      suppressHydrationWarning
    >
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="bg-canvas text-ink antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootApp() {
  const { queryClient, locale } = Route.useRouteContext();
  const location = useLocation();
  const i18n = useMemo(() => localeInstance(locale), [locale]);

  useEffect(() => {
    syncClientLocale(locale);
    applyTheme(readThemeCookie());
    return watchAuthCache(queryClient);
  }, [locale, queryClient]);

  const isBareRoute =
    location.pathname.startsWith("/admin") ||
    location.pathname.startsWith("/share-card");
  const isLiveMap = location.pathname === "/";

  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        {isBareRoute ? (
          <Outlet />
        ) : (
          <AtlasShell fullBleed={isLiveMap}>
            <Outlet />
          </AtlasShell>
        )}
        <Toaster position="top-center" richColors />
      </I18nextProvider>
    </QueryClientProvider>
  );
}

function RootNotFound() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-xl px-4 py-20">
      <AtlasPanel className="space-y-4 text-center">
        <div className="font-mono text-xs text-ink-muted">404</div>
        <h1 className="font-display text-3xl font-semibold text-ink">
          {t("notFound.title")}
        </h1>
        <p className="text-sm text-ink-secondary">{t("notFound.body")}</p>
        <div className="pt-2">
          <Link to="/">
            <AtlasButton variant="primary">{t("notFound.home")}</AtlasButton>
          </Link>
        </div>
      </AtlasPanel>
    </div>
  );
}

function RootError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const message = error instanceof Error ? error.message : "";
  return (
    <div className="mx-auto max-w-xl px-4 py-20">
      <AtlasPanel className="space-y-4">
        <div className="font-mono text-xs text-hazard-extreme">ERROR</div>
        <h1 className="font-display text-2xl font-semibold text-ink">
          {t("errorPage.title")}
        </h1>
        <p className="text-sm text-ink-secondary">{t("errorPage.body")}</p>
        {message && (
          <pre className="overflow-x-auto rounded-lg bg-surface-raised p-3 font-mono text-xs text-ink-secondary">
            {message}
          </pre>
        )}
        <div className="flex items-center gap-2 pt-2">
          <AtlasButton
            variant="primary"
            onClick={() => window.location.reload()}
          >
            {t("common.retry")}
          </AtlasButton>
          <Link to="/">
            <AtlasButton variant="secondary">{t("notFound.home")}</AtlasButton>
          </Link>
        </div>
      </AtlasPanel>
    </div>
  );
}
