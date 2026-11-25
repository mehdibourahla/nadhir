import { Share2 } from "lucide-react";
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
import type { OfficialIncident } from "@/lib/nadhir";
import {
  incidentUrl,
  linkTargets,
  shareImagePath,
  shareLocale,
  type ShareFormat,
} from "@/lib/share-card";
import { cn } from "@/lib/utils";
import { NATIVE, apiUrl } from "@/lib/platform";

const CARDS = [
  "story",
  "post",
  "sticker",
] as const satisfies readonly ShareFormat[];
type Loaded = { file: File; url: string } | "error" | undefined;

export function IncidentShareSheet({
  incident,
}: {
  incident: OfficialIncident;
}) {
  const { t, i18n } = useTranslation();
  const lang = shareLocale(i18n.language);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<(typeof CARDS)[number]>("story");
  const [images, setImages] = useState<Partial<Record<ShareFormat, Loaded>>>(
    {},
  );
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const statusId = useId();

  useEffect(() => {
    if (!open) return;
    const urls: string[] = [];
    let live = true;
    for (const format of CARDS) {
      void fetch(
        apiUrl(shareImagePath(incident.id, format, lang, incident.updated_at)),
      )
        .then(async (res) => {
          if (!res.ok) throw new Error(`${res.status}`);
          const blob = await res.blob();
          if (!live) return;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          const file = new File([blob], `nadhir-${format}.png`, {
            type: blob.type,
          });
          setImages((prev) => ({ ...prev, [format]: { file, url } }));
        })
        .catch(
          () => live && setImages((prev) => ({ ...prev, [format]: "error" })),
        );
    }
    return () => {
      live = false;
      urls.forEach(URL.revokeObjectURL);
      setImages({});
      setNotice(null);
    };
  }, [open, attempt, incident.id, incident.updated_at, lang]);

  const link = incidentUrl(incident.id, lang);
  const targets = linkTargets(link);
  const current = images[active];
  const file = current && current !== "error" ? current.file : null;
  const canShareFiles =
    !!file &&
    (NATIVE ||
      (typeof navigator.canShare === "function" &&
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
      if (failure instanceof DOMException && failure.name === "AbortError")
        return;
      setNotice(t("shareCard.failed"));
    }
  };
  const save = () => {
    if (!current || current === "error") return;
    const a = document.createElement("a");
    a.href = current.url;
    a.download = current.file.name;
    a.click();
  };
  const copySticker = async () => {
    if (!file) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": Promise.resolve(file) }),
      ]);
      setNotice(t("shareCard.stickerCopied"));
    } catch {
      setNotice(t("shareCard.failed"));
    }
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setNotice(t("shareCard.linkCopied"));
    } catch {
      setNotice(t("shareCard.copyFailed"));
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" className="min-h-11">
          <Share2 aria-hidden />
          {t("shareCard.open")}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t("shareCard.title")}</SheetTitle>
        </SheetHeader>
        <div className="grid grid-cols-3 gap-2 px-4 pb-2">
          {CARDS.map((format) => {
            const image = images[format];
            return (
              <button
                key={format}
                type="button"
                onClick={() => setActive(format)}
                aria-pressed={active === format}
                aria-label={t(`shareCard.formats.${format}`)}
                aria-describedby={
                  image && image !== "error"
                    ? undefined
                    : `${statusId}-${format}`
                }
                className={cn(
                  "flex min-w-0 flex-col items-center gap-2 rounded-xl p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active === format && "bg-muted ring-2 ring-primary",
                )}
              >
                <span className="flex h-28 w-full items-center justify-center">
                  {image && image !== "error" ? (
                    <img
                      src={image.url}
                      alt=""
                      className="max-h-full max-w-full rounded-md"
                    />
                  ) : (
                    <span
                      id={`${statusId}-${format}`}
                      className="flex h-full w-full items-center justify-center rounded-md bg-muted p-1 text-center text-xs text-muted-foreground"
                    >
                      {t(
                        image === "error"
                          ? "shareCard.cardError"
                          : "shareCard.preparing",
                      )}
                    </span>
                  )}
                </span>
                <span className="text-center text-xs leading-tight">
                  {t(`shareCard.formats.${format}`)}
                </span>
              </button>
            );
          })}
        </div>
        <div className="space-y-3 px-4 pb-4">
          <p aria-live="polite" className="min-h-5 text-sm">
            {notice}
            {current === "error" ? (
              <button
                type="button"
                onClick={() => setAttempt((n) => n + 1)}
                className={cn(
                  "font-medium text-primary underline underline-offset-2",
                  notice && "ms-2",
                )}
              >
                {t("shareCard.retry")}
              </button>
            ) : null}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("shareCard.image")}
          </p>
          <div className="flex flex-wrap gap-2">
            {active === "sticker" ? (
              <Button disabled={!file} onClick={() => void copySticker()}>
                {t("shareCard.copySticker")}
              </Button>
            ) : canShareFiles ? (
              <Button onClick={() => void shareImage()}>
                {t("shareCard.shareImage")}
              </Button>
            ) : null}
            {NATIVE ? null : (
              <Button
                variant={
                  canShareFiles || active === "sticker" ? "outline" : "default"
                }
                disabled={!file}
                onClick={save}
              >
                {t("shareCard.save")}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t("shareCard.link")}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <a
                href={targets.whatsapp}
                target="_blank"
                rel="noreferrer noopener"
              >
                WhatsApp
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a
                href={targets.facebook}
                target="_blank"
                rel="noreferrer noopener"
              >
                Facebook
              </a>
            </Button>
            <Button variant="outline" onClick={() => void copyLink()}>
              {t("shareCard.copyLink")}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
