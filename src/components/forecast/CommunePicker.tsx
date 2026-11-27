import { ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Locale } from "@/i18n";
import { buildPlaceIndex, searchPlaces } from "@/lib/civil-location";
import { unitName, type AdminUnit } from "@/lib/nadhir";

export function CommunePicker({
  units,
  selected,
  onPick,
}: {
  units: AdminUnit[];
  selected: AdminUnit | null;
  onPick: (commune: AdminUnit) => void;
}) {
  const { t, i18n } = useTranslation("weather");
  const locale = i18n.language as Locale;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const byId = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const index = useMemo(
    () =>
      buildPlaceIndex({
        units: units
          .filter((u) => u.level === "commune")
          .map((u) => ({
            id: u.id,
            name_fr: u.name_fr,
            name_ar: u.name_ar,
            name_en: u.name_en,
            level: u.level,
            parent_id: u.parent_id,
          })),
        aliases: [],
        settlements: [],
      }),
    [units],
  );
  const results = query.trim() ? searchPlaces(index, query, null) : [];
  const label = (commune: AdminUnit) => {
    const wilaya = commune.parent_id ? byId.get(commune.parent_id) : null;
    return wilaya
      ? `${unitName(commune, locale)}${t("outlook.separator")}${unitName(wilaya, locale)}`
      : unitName(commune, locale);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={t("outlook.place")}
          className="h-11 w-full justify-between text-base font-normal sm:w-96"
        >
          <span className="truncate">
            {selected ? label(selected) : t("outlook.choosePlace")}
          </span>
          <ChevronsUpDown aria-hidden className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0">
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={t("outlook.searchPlace")}
          />
          <CommandList>
            {query.trim() ? (
              <CommandEmpty>{t("outlook.noPlace")}</CommandEmpty>
            ) : null}
            {results.map((area) => {
              const commune = byId.get(area.id);
              if (!commune) return null;
              return (
                <CommandItem
                  key={area.id}
                  value={area.id}
                  className="min-h-11"
                  onSelect={() => {
                    onPick(commune);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <span className="truncate">{label(commune)}</span>
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
