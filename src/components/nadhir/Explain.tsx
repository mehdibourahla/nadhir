import { useState, type ReactNode } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function Explain({
  text,
  children,
}: {
  text?: string | undefined;
  children: ReactNode;
}) {
  // Radix tooltips never open on touch; a tap toggle is the only way the
  // mobile audience sees the explainer
  const [open, setOpen] = useState(false);
  if (!text) return <>{children}</>;
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger
        asChild
        tabIndex={0}
        onClick={(event) => {
          // Radix closes the tooltip on click unless the event is default-prevented
          event.preventDefault();
          setOpen((o) => !o);
        }}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent className="max-w-64 border border-border bg-popover px-3 py-2 text-start text-xs leading-relaxed text-popover-foreground shadow-md">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
