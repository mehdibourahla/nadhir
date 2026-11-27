import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { QueryState } from "@/components/admin/kit/QueryState";
import { When } from "@/components/admin/kit/When";
import { actionKey } from "@/lib/admin-audit";
import { memberDetailQuery } from "@/lib/roles";

export function MemberDetail({ userId }: { userId: string }) {
  const { t } = useTranslation("admin");
  const detail = useQuery(memberDetailQuery(userId));
  const yesNo = (value: boolean | null) =>
    value ? t("people.yes") : t("people.no");

  return (
    <QueryState query={detail} rows={2}>
      {(d) => (
        <div className="grid gap-4 text-xs sm:grid-cols-2">
          <div>
            <p className="font-medium">{t("people.reachability")}</p>
            <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-muted-foreground">
              <dt>{t("people.alertEmail")}</dt>
              <dd>{yesNo(d.alert_email)}</dd>
              <dt>{t("people.alertPush")}</dt>
              <dd>{yesNo(d.alert_push)}</dd>
              <dt>{t("people.phoneOnFile")}</dt>
              <dd>{yesNo(d.has_phone)}</dd>
              <dt>{t("people.minDanger")}</dt>
              <dd>{d.min_danger_level ?? t("empty.notSet")}</dd>
            </dl>
            <p className="mt-1 text-muted-foreground">
              {t("people.alertsReceived", { count: d.alerts_received })}
            </p>
          </div>
          <div>
            <p className="font-medium">{t("people.zones")}</p>
            {d.zones.length === 0 ? (
              <p className="mt-1 text-muted-foreground">
                {t("people.noZones")}
              </p>
            ) : (
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                {d.zones.map((z) => (
                  <li key={z.id}>{z.name ?? t("people.unnamedZone")}</li>
                ))}
              </ul>
            )}
          </div>
          <div className="sm:col-span-2">
            <p className="font-medium">{t("people.recentActions")}</p>
            {d.recent_actions.length === 0 ? (
              <p className="mt-1 text-muted-foreground">
                {t("people.noActions")}
              </p>
            ) : (
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                {d.recent_actions.map((a, i) => (
                  <li key={`${a.at}-${i}`} className="flex gap-2">
                    <span>
                      {t(`audit.action.${actionKey(a.action)}`, {
                        defaultValue: a.action,
                        role: t("audit.aRole"),
                        member: t("audit.someone"),
                      })}
                    </span>
                    <span className="ms-auto shrink-0">
                      <When at={a.at} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </QueryState>
  );
}
