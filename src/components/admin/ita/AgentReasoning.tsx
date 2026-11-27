import { useTranslation } from "react-i18next";

import { When } from "@/components/admin/kit/When";
import type { Json } from "@/integrations/supabase/types";
import type { CivilDecision } from "@/lib/civil-agent";

type Step = {
  action?: string;
  query?: string | null;
  results?: { name_fr?: string; wilaya?: string | null; matched?: string }[];
};

function searches(trace: Json): Step[] {
  return Array.isArray(trace)
    ? (trace as Step[]).filter((step) => step?.action === "search_areas")
    : [];
}

export function AgentReasoning({
  entries,
}: {
  entries: {
    attempt: number;
    created_at: string;
    decision: CivilDecision;
    trace: Json;
  }[];
}) {
  const { t } = useTranslation("admin");
  if (entries.length === 0) return null;
  return (
    <div className="space-y-4">
      {entries.map((entry) => (
        <div key={entry.attempt} className="space-y-2 text-sm">
          <p className="text-xs text-muted-foreground">
            {t(`publication.agent.${entry.decision.outcome}`)} ·{" "}
            <When at={entry.created_at} />
          </p>
          <p dir="auto">{entry.decision.reason}</p>
          {entry.decision.official_match ? (
            <div className="border-s-2 border-border ps-3" dir="auto">
              <p className="font-medium">
                {t(
                  `publication.agent.official.${entry.decision.official_match.relationship}`,
                )}
              </p>
              <p>{entry.decision.official_match.reason}</p>
            </div>
          ) : null}
          {searches(entry.trace).length > 0 ? (
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                {t("ita.searches")}
              </p>
              <ul className="mt-1 space-y-1">
                {searches(entry.trace).map((step, i) => (
                  <li key={i} className="text-xs">
                    <span dir="auto" className="font-medium">
                      {step.query}
                    </span>{" "}
                    →{" "}
                    {step.results?.length ? (
                      step.results
                        .slice(0, 3)
                        .map((area) =>
                          [area.name_fr, area.wilaya, area.matched]
                            .filter(Boolean)
                            .join(" · "),
                        )
                        .join(", ")
                    ) : (
                      <span className="text-muted-foreground">
                        {t("ita.noArea")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              {t("ita.technical")}
            </summary>
            <pre
              dir="ltr"
              className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words"
            >
              {JSON.stringify(entry.trace, null, 2)}
            </pre>
          </details>
        </div>
      ))}
    </div>
  );
}
