import {
  useMutation,
  useQuery,
  useQueryClient,
  useInfiniteQuery,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  LocateFixed,
  Phone,
  ShieldAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { LocationPicker, type PickerTarget } from "@/components/LocationPicker";
import { ReportPhoto } from "@/components/ReportPhoto";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { isTurnstileSiteKeyConfigured } from "@/lib/turnstile";
import { HazardTiles } from "@/components/report/HazardTiles";
import { TILES } from "@/lib/report-tiles";
import { LevelCard } from "@/components/report/LevelCard";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n";
import { nearestPlace } from "@/lib/civil-map";
import { adminUnitsQuery, relativeTime, unitName } from "@/lib/nadhir";
import { pageMeta } from "@/lib/page-meta";
import {
  createReport,
  createReportPhotoDraft,
  deleteReport,
  myReportsQuery,
  publishReport,
  ReportMutationError,
  type CitizenReport,
  type PublishResult,
  type ReportKind,
  type ReportPhotoDraft,
} from "@/lib/reports";
import { pageRows } from "@/lib/paging";
import { LoadMore } from "@/components/LoadMore";

type ReportSearch = { kind?: ReportKind };

const KINDS = new Set<string>(TILES.map((t) => t.kind));

export const Route = createFileRoute("/_authenticated/report")({
  validateSearch: (search: Record<string, unknown>): ReportSearch => {
    const kind = search["kind"] === "smoke" ? "sighting" : search["kind"];
    return typeof kind === "string" && KINDS.has(kind)
      ? { kind: kind as ReportKind }
      : {};
  },
  head: () => ({
    meta: [
      ...pageMeta("reports.metaTitle", "reports.metaDescription"),
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReportPage,
});

type Step = "home" | "what" | "sos" | "where" | "details" | "sent";
const DEFAULT_TARGET: PickerTarget = { lat: 36.7, lon: 4.05, zoom: 6, key: 0 };

function ReportPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language as Locale;
  const search = Route.useSearch();
  const qc = useQueryClient();
  const units = useQuery(adminUnitsQuery);

  const [step, setStep] = useState<Step>(() =>
    search.kind === "person_trapped" ? "sos" : search.kind ? "where" : "home",
  );
  const [kind, setKind] = useState<ReportKind>(search.kind ?? "sighting");
  const [target, setTarget] = useState<PickerTarget>(DEFAULT_TARGET);
  const [point, setPoint] = useState({ lat: 36.7, lon: 4.05 });
  const [located, setLocated] = useState<"idle" | "busy" | "failed">("idle");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<ReportPhotoDraft | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [result, setResult] = useState<PublishResult | null>(null);
  const captchaRequired = isTurnstileSiteKeyConfigured();

  useEffect(() => () => photo?.dispose(), [photo]);

  function locate() {
    if (typeof navigator === "undefined" || !navigator.geolocation)
      return setLocated("failed");
    setLocated("busy");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setTarget((prev) => ({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          zoom: 15,
          key: prev.key + 1,
        }));
        setLocated("idle");
      },
      () => setLocated("failed"),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  useEffect(() => {
    if (step === "where" && target.key === 0) locate();
  }, [step, target.key]);

  const commune = useMemo(
    () => nearestPlace(units.data ?? [], point.lat, point.lon),
    [units.data, point],
  );

  const submit = useMutation({
    mutationFn: async () => {
      const id = await createReport(
        {
          kind,
          lat: point.lat,
          lon: point.lon,
          note: note.trim() || null,
          observed_at: new Date().toISOString(),
        },
        photo,
      );
      try {
        return await publishReport(id, turnstileToken);
      } catch {
        // the report is saved; the next engine run classifies it
        return {
          publish_state: "classifying",
          hazard: null,
          summary: null,
        } satisfies PublishResult;
      }
    },
    onSuccess: (published) => {
      setResult(published);
      setStep("sent");
      setNote("");
      setPhoto(null);
      setTurnstileToken(null);
      setTurnstileResetKey((prev) => prev + 1);
      void qc.invalidateQueries({ queryKey: ["reports"] });
      void qc.invalidateQueries({ queryKey: ["hazard_reports"] });
    },
    onError: () => {
      setTurnstileToken(null);
      setTurnstileResetKey((prev) => prev + 1);
    },
  });

  const pick = (next: ReportKind) => {
    setKind(next);
    setStep(next === "person_trapped" ? "sos" : "where");
  };

  const restart = () => {
    submit.reset();
    setResult(null);
    setStep("what");
  };

  const noteMissing = kind === "other" && !note.trim();

  return (
    <div className="mx-auto max-w-lg px-4 pb-28 pt-6">
      {step !== "home" && step !== "sent" ? (
        <button
          type="button"
          onClick={() =>
            setStep(
              step === "details"
                ? "where"
                : step === "where" && kind === "person_trapped"
                  ? "sos"
                  : step === "what"
                    ? "home"
                    : "what",
            )
          }
          className="mb-3 -ms-2 flex min-h-11 items-center gap-1 px-2 text-sm text-muted-foreground"
        >
          <ArrowLeft aria-hidden className="size-4 rtl:rotate-180" />
          {t("reports.back")}
        </button>
      ) : null}

      {step === "home" ? (
        <Home onStart={() => setStep("what")} />
      ) : step === "what" ? (
        <section aria-labelledby="step-what">
          <h1 id="step-what" className="mb-4 text-2xl">
            {t("reports.stepWhat")}
          </h1>
          <HazardTiles onPick={pick} />
          <p className="mt-5 text-sm text-muted-foreground">
            {t("reports.safety")}
          </p>
        </section>
      ) : step === "sos" ? (
        <section aria-labelledby="step-sos" className="space-y-4">
          <h1 id="step-sos" className="text-2xl">
            {t("reports.sosTitle")}
          </h1>
          <p>{t("reports.sosBody")}</p>
          <a
            href="tel:14"
            className="flex min-h-14 items-center justify-center gap-2 rounded-xl text-lg font-semibold"
            style={{
              backgroundColor: "var(--emergency)",
              color: "var(--surface)",
            }}
          >
            <Phone aria-hidden className="size-5" />
            {t("reports.sosCall")}
          </a>
          <Button
            variant="outline"
            className="h-12 w-full"
            onClick={() => setStep("where")}
          >
            {t("reports.sosRecord")}
          </Button>
          <p className="text-sm text-muted-foreground">
            {t("reports.sosPrivate")}
          </p>
        </section>
      ) : step === "where" ? (
        <section aria-labelledby="step-where">
          <h1 id="step-where" className="text-2xl">
            {t("reports.stepWhere")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("reports.whereHint")}
          </p>
          <div className="relative mt-4 h-[55vh] min-h-72 overflow-hidden rounded-xl border border-border">
            <LocationPicker
              target={target}
              radiusKm={null}
              label={t("reports.stepWhere")}
              onMove={(next) => setPoint(next)}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={locate}
              disabled={located === "busy"}
              // MapLibre pins its zoom buttons top-right in both directions
              className="absolute left-3 top-3 z-10 bg-surface"
            >
              <LocateFixed aria-hidden />
              {located === "busy"
                ? t("reports.locating")
                : t("reports.useMyLocation")}
            </Button>
          </div>
          {located === "failed" ? (
            <p role="status" className="mt-2 text-sm text-muted-foreground">
              {t("reports.locationError")}
            </p>
          ) : null}
          {commune ? (
            <p className="mt-2 text-sm font-medium">
              {unitName(commune, locale)}
            </p>
          ) : units.isError ? (
            <p role="status" className="mt-2 text-sm text-muted-foreground">
              {t("reports.placeUnavailable")}
            </p>
          ) : null}
          <StickyAction>
            <Button
              className="h-12 w-full text-base"
              onClick={() => setStep("details")}
            >
              {t("reports.confirmPlace")}
            </Button>
          </StickyAction>
        </section>
      ) : step === "details" ? (
        <section aria-labelledby="step-details" className="space-y-4">
          <h1 id="step-details" className="text-2xl">
            {t("reports.stepDetails")}
          </h1>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            {t(`reports.tile.${kind}`)}
            {commune ? ` · ${unitName(commune, locale)}` : ""}
          </p>
          <label className="block text-sm font-medium">
            {kind === "other" ? t("reports.noteRequired") : t("reports.note")}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
              rows={4}
              placeholder={t("reports.notePlaceholder")}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base font-normal"
            />
          </label>
          <div className="space-y-2">
            <label className="block text-sm font-medium">
              {t("reports.photo")}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setPhotoError(null);
                  try {
                    setPhoto(createReportPhotoDraft(file));
                  } catch (error) {
                    const code = error instanceof Error ? error.message : "";
                    setPhotoError(
                      code === "too_large"
                        ? t("reports.photoTooLarge")
                        : code === "unsupported_type"
                          ? t("reports.photoBadType")
                          : t("reports.photoFailed"),
                    );
                  }
                }}
                className="mt-1 block w-full text-sm font-normal file:me-3 file:min-h-11 file:rounded-md file:border file:border-border file:bg-surface file:px-3"
              />
            </label>
            <p className="text-xs text-muted-foreground">
              {t("reports.photoHint")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("photoUpload.exifNotice")}
            </p>
            {photoError ? (
              <p role="alert" className="text-sm text-destructive">
                {photoError}
              </p>
            ) : null}
            {photo ? (
              <div className="flex items-start gap-3">
                <img
                  src={photo.previewUrl}
                  alt={t("reports.photoAlt")}
                  className="h-24 w-32 rounded-md border border-border object-cover"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPhoto(null)}
                >
                  {t("reports.photoRemove")}
                </Button>
              </div>
            ) : null}
          </div>
          <TurnstileWidget
            action="report_publish"
            resetKey={turnstileResetKey}
            onVerify={(token) => setTurnstileToken(token)}
            onExpire={() => setTurnstileToken(null)}
            onError={() => setTurnstileToken(null)}
          />
          {submit.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {t(
                submit.error instanceof ReportMutationError
                  ? submit.error.message
                  : "reports.submitFailed",
              )}
            </p>
          ) : null}
          <StickyAction>
            <Button
              className="h-12 w-full text-base"
              disabled={
                submit.isPending ||
                noteMissing ||
                (captchaRequired && !turnstileToken)
              }
              onClick={() => submit.mutate()}
            >
              {submit.isPending
                ? photo
                  ? t("reports.photoUploading")
                  : t("reports.submitting")
                : t("reports.submit")}
            </Button>
          </StickyAction>
        </section>
      ) : (
        <Sent
          result={result}
          kind={kind}
          onAnother={restart}
          onDone={() => setStep("home")}
        />
      )}
    </div>
  );
}

function StickyAction({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-16 z-20 border-t border-border bg-background/95 px-4 py-3 md:static md:mt-5 md:border-0 md:bg-transparent md:p-0">
      <div className="mx-auto max-w-lg">{children}</div>
    </div>
  );
}

function Sent({
  result,
  kind,
  onAnother,
  onDone,
}: {
  result: PublishResult | null;
  kind: ReportKind;
  onAnother: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const state = result?.publish_state ?? "classifying";
  const Icon =
    state === "published"
      ? CheckCircle2
      : state === "private"
        ? ShieldAlert
        : Clock;
  return (
    <section aria-labelledby="sent-title" className="space-y-4">
      <Icon aria-hidden className="size-10 text-primary" />
      <h1 id="sent-title" className="text-2xl">
        {state === "published"
          ? t("reports.sentPublished")
          : state === "private"
            ? t("reports.sosPrivate")
            : state === "held"
              ? t("reports.sentHeld")
              : t("reports.sentChecking")}
      </h1>
      {state === "classifying" ? <p>{t("reports.sentCheckingBody")}</p> : null}
      {result?.summary ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm">
          {result.summary}
        </p>
      ) : null}
      {kind !== "person_trapped" ? (
        <>
          <p className="text-sm">{t("reports.sentHow")}</p>
          <p className="text-sm font-medium">{t("reports.sentPoints")}</p>
          <LevelCard />
        </>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button className="h-12 flex-1" onClick={onDone}>
          {t("reports.done")}
        </Button>
        <Button variant="outline" className="h-12 flex-1" onClick={onAnother}>
          {t("reports.another")}
        </Button>
      </div>
    </section>
  );
}

function Home({ onStart }: { onStart: () => void }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language as Locale;
  const qc = useQueryClient();
  const mine = useInfiniteQuery(myReportsQuery);
  const myReports = pageRows(mine.data);
  const remove = useMutation({
    mutationFn: deleteReport,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["reports"] }),
  });
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl">{t("reports.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("reports.subtitle")}</p>
      </header>
      <Button className="h-14 w-full text-lg" onClick={onStart}>
        {t("reports.start")}
      </Button>
      <LevelCard />
      <section aria-labelledby="mine-title">
        <h2 id="mine-title" className="font-display text-lg">
          {t("reports.mine")}
        </h2>
        {remove.isError ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {t(
              remove.error instanceof ReportMutationError
                ? remove.error.message
                : "reports.deleteFailed",
            )}
          </p>
        ) : null}
        {mine.isPending ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {t("common.loading")}
          </p>
        ) : mine.isError ? (
          <div role="alert" className="mt-3 text-sm">
            <p className="text-destructive">{t("reports.mineError")}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => void mine.refetch()}
            >
              {t("common.retry")}
            </Button>
          </div>
        ) : myReports.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {t("reports.empty")}
          </p>
        ) : (
          <>
            <ul className="mt-3 space-y-2">
              {myReports.map((r) => (
                <ReportRow
                  key={r.id}
                  report={r}
                  locale={locale}
                  onDelete={() => remove.mutate(r.id)}
                />
              ))}
            </ul>
            <LoadMore query={mine} />
          </>
        )}
      </section>
      <p className="text-sm text-muted-foreground">
        <Link to="/" className="text-primary underline">
          {t("nav.map")}
        </Link>
      </p>
    </div>
  );
}

function ReportRow({
  report,
  locale,
  onDelete,
}: {
  report: CitizenReport;
  locale: Locale;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const expired =
    report.publish_state === "published" &&
    !!report.expires_at &&
    Date.parse(report.expires_at) <= Date.now();
  const state =
    report.status === "rejected"
      ? t("reports.statusRejected")
      : expired
        ? t("reports.expired")
        : t(`reports.state.${report.publish_state}`);
  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="font-medium">
          {KINDS.has(report.kind)
            ? t(`reports.tile.${report.kind}`)
            : report.kind}
        </span>
        <span className="text-xs text-muted-foreground">
          {relativeTime(report.observed_at, locale)}
        </span>
        <span className="ms-auto rounded-md border border-border px-2 py-0.5 text-xs">
          {state}
        </span>
      </div>
      {(report.summary ?? report.note) ? (
        <p className="mt-1.5 text-sm">{report.summary ?? report.note}</p>
      ) : null}
      {report.witnesses ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("reports.witnessCount", { count: report.witnesses })}
        </p>
      ) : null}
      <ReportPhoto photo={report.photo_url} />
      <button
        type="button"
        onClick={onDelete}
        className="mt-2 min-h-11 text-xs text-muted-foreground hover:text-destructive"
      >
        {t("reports.delete")}
      </button>
    </li>
  );
}
