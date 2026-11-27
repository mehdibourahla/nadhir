import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { isCanonicalReportPhotoPath, signedPhotoUrl } from "@/lib/reports";

export function ReportPhoto({
  photo,
  className,
}: {
  photo: string | null;
  className?: string;
}) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const validPhoto = !!photo && isCanonicalReportPhotoPath(photo);
  const url = useQuery({
    queryKey: ["report-photo", photo],
    queryFn: () => signedPhotoUrl(photo),
    enabled: validPhoto,
    staleTime: 20 * 60 * 1000,
  });

  useEffect(() => setFailed(false), [photo]);

  if (!photo) return null;
  if (!validPhoto || !url.data || failed) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("reports.photoUnavailable")}
      </p>
    );
  }
  return (
    <a href={url.data} target="_blank" rel="noreferrer">
      <img
        src={url.data}
        alt={t("reports.photoAlt")}
        loading="lazy"
        onError={() => setFailed(true)}
        className={
          className ??
          "mt-2 h-28 w-40 rounded-md border border-border object-cover"
        }
      />
    </a>
  );
}
