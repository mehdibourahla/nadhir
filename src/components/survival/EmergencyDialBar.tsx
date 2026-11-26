import { Phone } from "lucide-react";
import { useTranslation } from "react-i18next";

type Props = {
  onCall14?: () => void;
};

export function EmergencyDialBar({ onCall14 }: Props) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2.5" data-emergency-dial-bar="true">
      <a
        href="tel:14"
        onClick={onCall14}
        className="flex min-h-[68px] items-center justify-center gap-3 rounded-2xl px-4 py-3 text-center transition-opacity hover:opacity-95"
        style={{
          backgroundColor: "var(--emergency)",
          color: "var(--surface)",
        }}
      >
        <Phone aria-hidden className="size-6 shrink-0" />
        <span className="flex flex-col text-start">
          <span className="text-lg font-bold leading-tight">
            {t("survival.sosCall")}
          </span>
          <span className="text-xs font-medium">
            {t("track3.emergency.dial14Sub")}
          </span>
        </span>
      </a>

      <div className="grid grid-cols-2 gap-2.5">
        <a
          href="tel:1070"
          className="card flex min-h-12 flex-col items-center justify-center gap-0.5 px-3 py-2 text-center hover:bg-muted"
        >
          <span className="text-sm font-semibold text-foreground">
            {t("emergency.forest")}{" "}
            <span dir="ltr" className="tabular-nums font-bold">
              1070
            </span>
          </span>
          <span className="text-xs text-muted-foreground">
            {t("track3.emergency.dial1070Sub")}
          </span>
        </a>

        <a
          href="tel:112"
          className="card flex min-h-12 flex-col items-center justify-center gap-0.5 px-3 py-2 text-center hover:bg-muted"
        >
          <span className="text-sm font-semibold text-foreground">
            {t("emergency.general")}{" "}
            <span dir="ltr" className="tabular-nums font-bold">
              112
            </span>
          </span>
          <span className="text-xs text-muted-foreground">
            {t("track3.emergency.dial112Sub")}
          </span>
        </a>
      </div>
    </div>
  );
}
