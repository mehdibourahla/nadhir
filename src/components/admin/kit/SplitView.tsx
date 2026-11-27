import { useEffect, useState, type ReactNode } from "react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useEndSide } from "@/hooks/use-end-side";

function useWide() {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return wide;
}

export function SplitView({
  list,
  detail,
  detailTitle,
  placeholder,
  onClose,
}: {
  list: ReactNode;
  detail: ReactNode | null;
  detailTitle: string;
  placeholder: string;
  onClose: () => void;
}) {
  const wide = useWide();
  const side = useEndSide();
  if (!wide)
    return (
      <>
        {list}
        <Sheet
          open={detail !== null}
          onOpenChange={(open) => !open && onClose()}
        >
          <SheetContent
            side={side}
            className="w-full overflow-y-auto sm:max-w-lg"
          >
            <SheetHeader>
              <SheetTitle>{detailTitle}</SheetTitle>
            </SheetHeader>
            <div className="mt-4">{detail}</div>
          </SheetContent>
        </Sheet>
      </>
    );
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-4">
      <div className="min-w-0">{list}</div>
      <aside
        aria-label={detailTitle}
        className="sticky top-20 max-h-[calc(100vh-6rem)] min-w-0 overflow-y-auto rounded-lg border border-border bg-surface p-4"
      >
        {detail ?? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {placeholder}
          </p>
        )}
      </aside>
    </div>
  );
}
