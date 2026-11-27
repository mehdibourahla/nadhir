import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
export const authInputClass =
  "min-h-12 w-full rounded-lg border border-border bg-background px-3 py-3 text-base focus-visible:outline-2 focus-visible:outline-primary";
export function PasswordField({
  id,
  label,
  value,
  onChange,
  newPassword = false,
  disabled = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  newPassword?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          required
          minLength={newPassword ? 8 : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          autoComplete={newPassword ? "new-password" : "current-password"}
          className={`${authInputClass} pe-14`}
        />
        <button
          type="button"
          aria-label={t(
            visible ? "authKit.hidePassword" : "authKit.showPassword",
          )}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
          className="absolute inset-y-0 end-0 flex min-w-12 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </div>
  );
}
