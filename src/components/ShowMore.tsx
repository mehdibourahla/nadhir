import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export function ShowMore<T>({
  items,
  step = 20,
  children,
}: {
  items: T[];
  step?: number;
  children: (visible: T[]) => ReactNode;
}) {
  const { t } = useTranslation();
  const [count, setCount] = useState(step);
  const remaining = items.length - count;
  return (
    <>
      {children(items.slice(0, count))}
      {remaining > 0 && (
        <Button
          type="button"
          variant="outline"
          className="mt-3 w-full"
          onClick={() => setCount((shown) => shown + step)}
        >
          {t("common.showMore", {
            count: Math.min(step, remaining),
            remaining,
          })}
        </Button>
      )}
    </>
  );
}
