import { useQuery } from "@tanstack/react-query";
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
import { buildPlaceIndex, searchPlaces } from "@/lib/civil-location";
import { adminUnitsQuery } from "@/lib/nadhir";

export function AreaPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation("admin");
  const units = useQuery(adminUnitsQuery);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const index = useMemo(
    () =>
      buildPlaceIndex({
        units: (units.data ?? []).map((unit) => ({
          id: unit.id,
          name_fr: unit.name_fr,
          name_ar: unit.name_ar,
          name_en: unit.name_en,
          level: unit.level,
          parent_id: unit.parent_id,
        })),
        aliases: [],
        settlements: [],
      }),
    [units.data],
  );
  const results = query.trim() ? searchPlaces(index, query, null) : [];
  const selected = index.find((entry) => entry.area.id === value)?.area;
  const label = (area: {
    name_fr: string;
    level: string;
    wilaya?: string | null;
  }) =>
    area.wilaya
      ? `${area.name_fr}, ${area.wilaya}`
      : `${area.name_fr} (${t("ita.wilaya")})`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={!units.data}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">
            {selected ? label(selected) : t("publication.chooseArea")}
          </span>
          <ChevronsUpDown aria-hidden className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0">
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={t("ita.searchArea")}
          />
          <CommandList>
            {query.trim() ? (
              <CommandEmpty>{t("ita.noArea")}</CommandEmpty>
            ) : null}
            {results.map((area) => (
              <CommandItem
                key={area.id}
                value={area.id}
                onSelect={() => {
                  onChange(area.id);
                  setOpen(false);
                  setQuery("");
                }}
              >
                <span className="truncate">{label(area)}</span>
                <span
                  className="ms-auto text-xs text-muted-foreground"
                  dir="rtl"
                >
                  {area.name_ar}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
