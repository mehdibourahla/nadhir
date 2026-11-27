import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  destructive = false,
  reason = "none",
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  description?: string;
  confirmLabel: string;
  destructive?: boolean;
  reason?: "none" | "optional" | "required";
  onConfirm: (reason: string | null) => Promise<unknown>;
}) {
  const { t } = useTranslation("admin");
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = pending || (reason === "required" && !text.trim());

  const change = (next: boolean) => {
    if (pending) return;
    setOpen(next);
    if (!next) {
      setText("");
      setError(null);
    }
  };

  const confirm = async () => {
    setPending(true);
    setError(null);
    try {
      await onConfirm(text.trim() || null);
      setPending(false);
      change(false);
    } catch (failure) {
      setPending(false);
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={change}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        {reason !== "none" ? (
          <label className="block text-sm">
            <span className="font-medium">
              {t("kit.reason")}
              {reason === "required" ? " *" : ""}
            </span>
            <Textarea
              className="mt-1"
              value={text}
              maxLength={1000}
              onChange={(event) => setText(event.target.value)}
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              {t("kit.reasonHint")}
            </span>
          </label>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t("kit.cancel")}
          </AlertDialogCancel>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={blocked}
            onClick={() => void confirm()}
          >
            {pending ? t("kit.working") : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
