import { useState, type ReactNode } from "react";

export function LazyDetails({
  summary,
  children,
  className,
  summaryClassName,
}: {
  summary: ReactNode;
  children: ReactNode;
  className?: string;
  summaryClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className={className}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className={summaryClassName}>{summary}</summary>
      {open ? children : null}
    </details>
  );
}
