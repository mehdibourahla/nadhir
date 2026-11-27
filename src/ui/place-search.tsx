import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, Compass, MapPin, Search, X } from "lucide-react";

import type { AnyLocale } from "@/i18n";
import { adminUnitsQuery, unitName } from "@/lib/nadhir";
import { findPlaces } from "@/lib/civil-map";
import { WILAYA_REGISTRY, wilayaName } from "@/lib/wilaya-slugs";
import { cn } from "@/lib/utils";
import { SafeBdi } from "@/ui/primitives";

type PlaceSearchDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function PlaceSearchDialog({
  open,
  onOpenChange,
}: PlaceSearchDialogProps) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.language || "ar") as AnyLocale;
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const unitsQuery = useQuery({
    ...adminUnitsQuery,
    enabled: open,
    staleTime: 10 * 60 * 1000,
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      } else if (e.key === "Escape" && open) {
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const wilayaMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return WILAYA_REGISTRY.filter((w) =>
        ["16", "31", "25", "06", "15", "09", "19", "23"].includes(w.code),
      );
    }
    return WILAYA_REGISTRY.filter((w) =>
      [w.code, w.slug, w.nameAr, w.nameFr, w.nameEn, w.nameKab].some((v) =>
        v.toLowerCase().includes(q),
      ),
    ).slice(0, 8);
  }, [query]);

  const communeMatches = useMemo(() => {
    if (!query.trim() || !unitsQuery.data) return [];
    return findPlaces(unitsQuery.data, query, locale)
      .filter((u) => u.level === "commune")
      .slice(0, 6);
  }, [query, unitsQuery.data, locale]);

  const flatItems = useMemo(() => {
    const items: Array<
      | {
          kind: "wilaya";
          slug: string;
          code: string;
          label: string;
          sub: string;
        }
      | {
          kind: "commune";
          id: string;
          code: string;
          label: string;
          sub: string;
        }
    > = [];
    for (const w of wilayaMatches) {
      items.push({
        kind: "wilaya",
        slug: w.slug,
        code: w.code,
        label: wilayaName(w, locale),
        sub: locale === "ar" ? w.nameFr : w.nameAr,
      });
    }
    for (const c of communeMatches) {
      const parent = unitsQuery.data?.find((u) => u.id === c.parent_id);
      items.push({
        kind: "commune",
        id: c.id,
        code: c.code,
        label: unitName(c, locale),
        sub: parent ? unitName(parent, locale) : c.code,
      });
    }
    return items;
  }, [wilayaMatches, communeMatches, locale, unitsQuery.data]);

  function selectItem(item: (typeof flatItems)[number]) {
    onOpenChange(false);
    if (item.kind === "wilaya") {
      void navigate({
        to: "/wilaya/$slug",
        params: { slug: item.slug },
      });
    } else {
      void navigate({
        to: "/forecast",
        search: { commune: item.code },
      });
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 backdrop-blur-xs p-4 pt-16 sm:pt-24"
      role="dialog"
      aria-modal="true"
      aria-label={t("weather:outlook.searchPlace")}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-hairline-strong bg-surface shadow-2xl">
        <div className="flex items-center gap-3 border-b border-hairline px-4 py-3">
          <Search className="h-4 w-4 text-ink-secondary shrink-0" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => Math.min(i + 1, flatItems.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && flatItems[activeIndex]) {
                e.preventDefault();
                selectItem(flatItems[activeIndex]!);
              }
            }}
            placeholder={t("weather:outlook.searchPlace")}
            className="h-9 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-muted focus:outline-none"
          />
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label={t("common.close")}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary hover:bg-surface-raised hover:text-ink cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {flatItems.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-ink-secondary">
              {t("weather:outlook.noPlace")}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {flatItems.map((item, idx) => {
                const active = idx === activeIndex;
                return (
                  <li key={`${item.kind}-${item.code}`}>
                    <button
                      type="button"
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => selectItem(item)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-start transition-colors cursor-pointer",
                        active
                          ? "bg-signal-soft text-ink"
                          : "hover:bg-surface-raised text-ink",
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-raised font-mono text-xs font-medium text-ink-secondary">
                          {item.kind === "wilaya" ? (
                            <SafeBdi>{item.code}</SafeBdi>
                          ) : (
                            <MapPin className="h-3.5 w-3.5 text-signal" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">
                            {item.label}
                          </div>
                          <div className="text-xs text-ink-secondary truncate">
                            {item.sub}
                          </div>
                        </div>
                      </div>
                      <span className="flex items-center gap-1.5 text-xs text-ink-muted shrink-0">
                        {item.kind === "wilaya" ? (
                          <Compass className="h-3.5 w-3.5" />
                        ) : null}
                        <ArrowRight className="h-3.5 w-3.5 atlas-dir-icon" />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-hairline bg-surface-raised/60 px-4 py-2 text-[11px] text-ink-muted">
          <span>69 wilayas · 1,541 communes</span>
          <SafeBdi className="font-mono">ESC</SafeBdi>
        </div>
      </div>
    </div>
  );
}
