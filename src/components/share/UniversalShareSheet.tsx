import { Download, Link2, RefreshCw, Share2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { AnyLocale } from "@/i18n/locales-list";
import { NATIVE, apiUrl } from "@/lib/platform";
import {
  linkTargets,
  universalShareImagePath,
  type ShareKind,
  type UniversalShareFormat,
} from "@/lib/share-card";
import { cn } from "@/lib/utils";

const FORMATS = [
  "whatsapp",
  "facebook",
] as const satisfies readonly UniversalShareFormat[];

type CardFormat = (typeof FORMATS)[number];
type LoadedImage = { file: File; url: string } | "error" | undefined;

export interface UniversalShareSheetProps {
  kind: ShareKind;
  id: string;
  lang: AnyLocale;
  placeLabel: string;
  shareUrl: string;
  className?: string;
}

export function UniversalShareSheet({
  kind,
  id,
  lang,
  placeLabel,
  shareUrl,
  className,
}: UniversalShareSheetProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<CardFormat>("whatsapp");
  const [images, setImages] = useState<
    Partial<Record<CardFormat, LoadedImage>>
  >({});
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const statusId = useId();

  useEffect(() => {
    if (!open) return;
    const urls: string[] = [];
    let live = true;
    for (const format of FORMATS) {
      const path = universalShareImagePath(kind, id, format, lang, "webp");
      void fetch(apiUrl(path))
        .then(async (res) => {
          if (!res.ok) throw new Error(`${res.status}`);
          const blob = await res.blob();
          if (!live) return;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          const file = new File([blob], `nadhir-${kind}-${id}-${format}.webp`, {
            type: blob.type || "image/webp",
          });
          setImages((prev) => ({ ...prev, [format]: { file, url } }));
        })
        .catch(() => {
          if (live) {
            setImages((prev) => ({ ...prev, [format]: "error" }));
          }
        });
    }
    return () => {
      live = false;
      urls.forEach(URL.revokeObjectURL);
      setImages({});
      setNotice(null);
    };
  }, [open, attempt, kind, id, lang]);

  const targets = linkTargets(shareUrl);
  const current = images[active];
  const file = current && current !== "error" ? current.file : null;
  const canShareFiles =
    !!file &&
    (NATIVE ||
      (typeof navigator !== "undefined" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] })));

  const shareImage = async () => {
    if (!file) return;
    try {
      if (NATIVE) {
        const { shareImageFile } = await import("@/lib/native-share");
        await shareImageFile(file);
        return;
      }
      await navigator.share({ files: [file] });
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === "AbortError") {
        return;
      }
      setNotice(t("track3.share.shareFailed"));
    }
  };

  const downloadImage = () => {
    if (!current || current === "error") return;
    const a = document.createElement("a");
    a.href = current.url;
    a.download = current.file.name;
    a.click();
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setNotice(t("track3.share.linkCopied"));
    } catch {
      setNotice(t("track3.share.copyFailed"));
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "min-h-11 gap-2 rounded-lg border-border px-3.5 text-sm font-medium",
            className,
          )}
        >
          <Share2 aria-hidden className="size-4 shrink-0" />
          <span>{t("track3.share.open")}</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t("track3.share.title")}</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-5">
          <div className="grid grid-cols-2 gap-2" role="group">
            {FORMATS.map((format) => (
              <button
                key={format}
                type="button"
                onClick={() => setActive(format)}
                aria-pressed={active === format}
                className={cn(
                  "inline-flex min-h-11 items-center justify-center rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active === format
                    ? "border-primary bg-primary/10 font-semibold text-foreground"
                    : "border-border bg-surface text-muted-foreground hover:bg-muted",
                )}
              >
                {t(`track3.share.formats.${format}`)}
              </button>
            ))}
          </div>

          <div
            aria-describedby={
              current && current !== "error" ? undefined : statusId
            }
            className="flex min-h-40 w-full items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40 p-2"
          >
            {current && current !== "error" ? (
              <img
                src={current.url}
                alt={t("track3.share.previewAlt", { place: placeLabel })}
                className="block max-h-64 max-w-full rounded-lg object-contain"
              />
            ) : current === "error" ? (
              <div
                id={statusId}
                className="flex flex-col items-center gap-3 p-4 text-center"
              >
                <p className="text-sm text-muted-foreground">
                  {t("track3.share.cardError")}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 gap-2"
                  onClick={() => setAttempt((n) => n + 1)}
                >
                  <RefreshCw aria-hidden className="size-4 shrink-0" />
                  <span>{t("track3.share.retry")}</span>
                </Button>
              </div>
            ) : (
              <p
                id={statusId}
                className="p-4 text-center text-sm text-muted-foreground"
              >
                {t("track3.share.preparing")}
              </p>
            )}
          </div>

          {notice ? (
            <p aria-live="polite" className="text-sm text-foreground">
              {notice}
            </p>
          ) : (
            <p aria-live="polite" className="sr-only" />
          )}

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {t("track3.share.imageSection")}
            </p>
            <div className="flex flex-wrap gap-2">
              {canShareFiles ? (
                <Button
                  type="button"
                  className="min-h-11 gap-2"
                  onClick={() => void shareImage()}
                >
                  <Share2 aria-hidden className="size-4 shrink-0" />
                  <span>{t("track3.share.shareImage")}</span>
                </Button>
              ) : null}
              {NATIVE ? null : (
                <Button
                  type="button"
                  variant={canShareFiles ? "outline" : "default"}
                  className="min-h-11 gap-2"
                  disabled={!file}
                  onClick={downloadImage}
                >
                  <Download aria-hidden className="size-4 shrink-0" />
                  <span>{t("track3.share.download")}</span>
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {t("track3.share.linkSection")}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="min-h-11" asChild>
                <a
                  href={targets.whatsapp}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {t("track3.share.shareWhatsApp")}
                </a>
              </Button>
              <Button variant="outline" className="min-h-11" asChild>
                <a
                  href={targets.facebook}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {t("track3.share.shareFacebook")}
                </a>
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 gap-2"
                onClick={() => void copyLink()}
              >
                <Link2 aria-hidden className="size-4 shrink-0" />
                <span>{t("track3.share.copyLink")}</span>
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
