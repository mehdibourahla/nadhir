import type { BroadcastPhase, CapText } from "@/lib/cap";
import type { NonFireBroadcastKind } from "@/lib/broadcast-rules";

export type BroadcastVars = {
  place: string;
  wilaya: string;
  km: number | null;
  bearingDeg: number | null;
  hotspots: number;
  hours: number;
  inside: Record<Locale, string[]>;
};

type Locale = "ar" | "fr" | "en" | "kab";

type Copy = {
  event: string;
  initialHeadline: string;
  initialDesc: string;
  initialDescNoKm: string;
  initialDrift: string;
  updateHeadline: string;
  updateDesc: string;
  updateDrift: string;
  endHeadline: string;
  endDesc: string;
  cancelHeadline: string;
  cancelDesc: string;
  insideOne: string;
  insideMany: string;
  instruction: string;
  compass: [string, string, string, string, string, string, string, string];
};

/* AR copy is approved maquette wording except the inside-commune sentences and the
 * 2026-09-02 detected/confirmed rewording, both unreviewed; instruction lines are the pre-approved
 * Standing Guidance already shipped in alerts-engine. KAB pending native review. */
const COPY: Record<"ar" | "fr" | "en" | "kab", Copy> = {
  ar: {
    event: "حريق غابات",
    initialHeadline: "حريق مرصود بالقمر الاصطناعي — {{place}}، {{wilaya}}",
    initialDesc:
      "رصدت الأقمار الاصطناعية حريقًا على بعد نحو {{km}} كلم من {{place}}",
    initialDescNoKm: "رصدت الأقمار الاصطناعية حريقًا قرب {{place}}",
    initialDrift: "، يتقدم مع الريح نحو {{bearing}}",
    updateHeadline: "تحديث — حريق {{place}}",
    updateDesc: "اتسع الرصد إلى {{hotspots}} نقطة حرارية.",
    updateDrift: " اتجاه التقدم نحو {{bearing}}.",
    endHeadline: "حريق {{place}} — لا رصد جديد",
    endDesc:
      "لم تُرصد نقاط حرارية منذ {{hours}} ساعة. قد تفوت الأقمار الاصطناعية نارًا نشطة — اتبع تعليمات الحماية المدنية.",
    cancelHeadline: "إلغاء تنبيه حريق {{place}}",
    cancelDesc: "تبيّن أن الرصد قرب {{place}} لم يكن حريقًا نشطًا.",
    insideOne: " رُصدت نقاط حرارية داخل بلدية {{communes}}.",
    insideMany: " رُصدت نقاط حرارية داخل البلديات: {{communes}}.",
    instruction:
      "ابتعد عن الدخان، واتبع تعليمات السلطات المحلية، واتصل بالحماية المدنية على 14 إذا هدّد الحريق أشخاصًا أو منازل.",
    compass: [
      "الشمال",
      "الشمال الشرقي",
      "الشرق",
      "الجنوب الشرقي",
      "الجنوب",
      "الجنوب الغربي",
      "الغرب",
      "الشمال الغربي",
    ],
  },
  fr: {
    event: "Feu de forêt",
    initialHeadline: "Incendie détecté par satellite — {{place}}, {{wilaya}}",
    initialDesc:
      "Incendie détecté par satellite à environ {{km}} km de {{place}}",
    initialDescNoKm: "Incendie détecté par satellite près de {{place}}",
    initialDrift: ", poussé par le vent vers {{bearing}}",
    updateHeadline: "Mise à jour — incendie de {{place}}",
    updateDesc: "La détection s'est étendue à {{hotspots}} points chauds.",
    updateDrift: " La progression reste orientée vers {{bearing}}.",
    endHeadline: "Incendie de {{place}} — aucune nouvelle détection",
    endDesc:
      "Aucun point chaud détecté depuis {{hours}} heures. Les satellites peuvent manquer un feu actif — suivez les consignes de la Protection Civile.",
    cancelHeadline: "Annulation — alerte incendie de {{place}}",
    cancelDesc:
      "La détection près de {{place}} ne correspondait pas à un incendie actif.",
    insideOne: " Détections à l'intérieur de la commune {{communes}}.",
    insideMany: " Détections à l'intérieur des communes : {{communes}}.",
    instruction:
      "Éloignez-vous de la fumée, suivez les consignes des autorités locales et appelez la Protection Civile au 14 si le feu menace des personnes ou des habitations.",
    compass: [
      "le nord",
      "le nord-est",
      "l'est",
      "le sud-est",
      "le sud",
      "le sud-ouest",
      "l'ouest",
      "le nord-ouest",
    ],
  },
  en: {
    event: "Wildfire",
    initialHeadline: "Fire detected by satellite — {{place}}, {{wilaya}}",
    initialDesc: "Satellite-detected fire about {{km}} km from {{place}}",
    initialDescNoKm: "Satellite-detected fire near {{place}}",
    initialDrift: ", moving with the wind toward the {{bearing}}",
    updateHeadline: "Update — {{place}} fire",
    updateDesc: "Detection has grown to {{hotspots}} hotspots.",
    updateDrift: " It is still heading {{bearing}}.",
    endHeadline: "{{place}} fire — no new detections",
    endDesc:
      "No hotspots detected for {{hours}} hours. Satellites can miss an active fire — follow Civil Protection instructions.",
    cancelHeadline: "Cancelled — {{place}} fire alert",
    cancelDesc: "The detection near {{place}} was not an active fire.",
    insideOne: " Detections inside the commune of {{communes}}.",
    insideMany: " Detections inside the communes: {{communes}}.",
    instruction:
      "Stay away from the smoke, follow instructions from local authorities, and call Civil Protection on 14 if the fire threatens people or homes.",
    compass: [
      "north",
      "northeast",
      "east",
      "southeast",
      "south",
      "southwest",
      "west",
      "northwest",
    ],
  },
  kab: {
    event: "Times n teẓgi",
    initialHeadline: "Times tettwaf s uḍfar n igenwan — {{place}}, {{wilaya}}",
    initialDesc:
      "Times tettwaf s uḍfar n igenwan ɣef azal n {{km}} km si {{place}}",
    initialDescNoKm: "Times tettwaf s uḍfar n igenwan ɣer {{place}}",
    initialDrift: ", tetteddu d waḍu ɣer {{bearing}}",
    updateHeadline: "Aleqqem — times n {{place}}",
    updateDesc: "Aḍfar yewweḍ ɣer {{hotspots}} n tenqiḍin n tmes.",
    updateDrift: " Mazal tetteddu ɣer {{bearing}}.",
    endHeadline: "Times n {{place}} — ulac aḍfar amaynut",
    endDesc:
      "Ulac tinqiḍin n tmes seg {{hours}} n tsaɛtin. Igenwan zemren ad zeglen times iddren — ḍfer iwellihen n Tɣellist Tagdudant.",
    cancelHeadline: "Yefsex — alɣu n tmes n {{place}}",
    cancelDesc: "Aḍfar ɣer {{place}} mači d times iddren.",
    insideOne: " Aḍfar deg tɣiwant n {{communes}}.",
    insideMany: " Aḍfar deg tɣiwanin: {{communes}}.",
    instruction:
      "Ḥader iman-ik seg dexxan, ḍfer iwellihen n yidebbaren idiganen, tsiwleḍ i Tɣellist Tagdudant ɣef 14 ma tessexlaɛ times imdanen neɣ ixxamen.",
    compass: [
      "agafa",
      "agafa-agmuḍ",
      "agmuḍ",
      "anẓul-agmuḍ",
      "anẓul",
      "anẓul-ataram",
      "ataram",
      "agafa-ataram",
    ],
  },
};

const LANGUAGE: Record<Locale, string> = {
  ar: "ar-DZ",
  fr: "fr-DZ",
  en: "en",
  kab: "kab",
};

function fill(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) =>
    String(vars[k] ?? ""),
  );
}

function frDe(name: string): string {
  return /^[aeiouyhâéèêîôûAEIOUYH]/.test(name) ? `d'${name}` : `de ${name}`;
}

function insideSentence(copy: Copy, locale: Locale, names: string[]): string {
  if (!names.length) return "";
  if (names.length === 1)
    return fill(copy.insideOne, {
      communes: locale === "fr" ? frDe(names[0]!) : names[0]!,
    });
  return fill(copy.insideMany, {
    communes: names.join(locale === "ar" ? "، " : ", "),
  });
}

function compassWord(copy: Copy, deg: number): string {
  return copy.compass[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
}

function description(
  phase: BroadcastPhase,
  copy: Copy,
  locale: Locale,
  vars: BroadcastVars,
): string {
  const slots = {
    place: vars.place,
    km: vars.km ?? "",
    hotspots: vars.hotspots,
    hours: vars.hours,
    bearing: vars.bearingDeg === null ? "" : compassWord(copy, vars.bearingDeg),
  };
  switch (phase) {
    case "initial": {
      const base = fill(
        vars.km === null ? copy.initialDescNoKm : copy.initialDesc,
        slots,
      );
      const drift =
        vars.bearingDeg === null ? "" : fill(copy.initialDrift, slots);
      return `${base}${drift}.${insideSentence(copy, locale, vars.inside[locale])}`;
    }
    case "update": {
      const drift =
        vars.bearingDeg === null ? "" : fill(copy.updateDrift, slots);
      return `${fill(copy.updateDesc, slots)}${drift}${insideSentence(copy, locale, vars.inside[locale])}`;
    }
    case "end":
      return fill(copy.endDesc, slots);
    case "cancel":
      return fill(copy.cancelDesc, slots);
  }
}

const HEADLINE: Record<BroadcastPhase, keyof Copy> = {
  initial: "initialHeadline",
  update: "updateHeadline",
  end: "endHeadline",
  cancel: "cancelHeadline",
};

export function broadcastTexts(
  phase: BroadcastPhase,
  vars: BroadcastVars,
): CapText[] {
  const live = phase === "initial" || phase === "update";
  return (Object.keys(COPY) as Locale[]).map((locale) => {
    const copy = COPY[locale];
    return {
      language: LANGUAGE[locale],
      event: copy.event,
      headline: fill(copy[HEADLINE[phase]] as string, {
        place: vars.place,
        wilaya: vars.wilaya,
      }),
      description: description(phase, copy, locale, vars),
      instruction: live ? copy.instruction : "",
    };
  });
}

export type OfficialVars = {
  commune: string;
  wilaya: string;
  source: string;
  asOf: string;
  status: "ongoing" | "contained" | "extinguished" | "monitoring" | "unknown";
};

type OfficialCopy = {
  headline: string;
  body: string;
  statuses: Record<OfficialVars["status"], string>;
  noDetection: string;
};

/* The authority's own report, relayed. Nadhir adds only the two facts it can
 * vouch for: when the bulletin was valid, and that it has seen nothing there. */
const OFFICIAL: Record<Locale, OfficialCopy> = {
  ar: {
    headline: "الحماية المدنية: حريق في {{commune}}، {{wilaya}}",
    body: "{{status}} حسب نشرية {{asOf}} (توقيت الجزائر). المصدر: {{source}}.",
    statuses: {
      ongoing: "عملية الإخماد متواصلة",
      contained: "الحريق تحت السيطرة",
      extinguished: "تم إخماد الحريق",
      monitoring: "الموقع تحت الحراسة",
      unknown: "حريق مُبلَّغ عنه",
    },
    noDetection: " لم ترصد الأقمار الاصطناعية أي نقطة حرارية في هذه البلدية.",
  },
  fr: {
    headline: "Protection civile : incendie à {{commune}}, {{wilaya}}",
    body: "{{status}} selon le bulletin de {{asOf}} (heure d'Alger). Source : {{source}}.",
    statuses: {
      ongoing: "Opérations en cours",
      contained: "Incendie maîtrisé",
      extinguished: "Incendie éteint",
      monitoring: "Site sous surveillance",
      unknown: "Incendie signalé",
    },
    noDetection:
      " Aucun point chaud satellite n'a été détecté dans cette commune.",
  },
  en: {
    headline: "Civil Protection: fire in {{commune}}, {{wilaya}}",
    body: "{{status}} as of the {{asOf}} bulletin (Algiers time). Source: {{source}}.",
    statuses: {
      ongoing: "Operations continuing",
      contained: "Fire contained",
      extinguished: "Fire out",
      monitoring: "Site under watch",
      unknown: "Fire reported",
    },
    noDetection: " No satellite hotspot has been detected in this commune.",
  },
  kab: {
    headline: "Tɣellist Tagdudant: times deg {{commune}}, {{wilaya}}",
    body: "{{status}} akken i d-yenna ulɣu n {{asOf}} (akud n Lezzayer). Aɣbalu: {{source}}.",
    statuses: {
      ongoing: "Leqdicat mazal-itent",
      contained: "Times tettwaḥbes",
      extinguished: "Times texsi",
      monitoring: "Amḍiq seddaw uɛessi",
      unknown: "Times yettwabedren",
    },
    noDetection: " Ulac tanqiḍt taḥmayt n igenwan deg tɣiwant-a.",
  },
};

export function officialTexts(
  vars: OfficialVars,
  detected: boolean,
): CapText[] {
  return (Object.keys(OFFICIAL) as Locale[]).map((locale) => {
    const copy = OFFICIAL[locale];
    const slots = {
      commune: vars.commune,
      wilaya: vars.wilaya,
      source: vars.source,
      asOf: vars.asOf,
      status: copy.statuses[vars.status],
    };
    return {
      language: LANGUAGE[locale],
      event: COPY[locale].event,
      headline: fill(copy.headline, slots),
      description: fill(copy.body, slots) + (detected ? "" : copy.noDetection),
      instruction: COPY[locale].instruction,
    };
  });
}

export type OfficialHazardVars = {
  kind: NonFireBroadcastKind;
  phase?: "initial" | "end";
  commune: string;
  wilaya: string;
  place?: string | null;
  source: string;
  asOf: string;
  evidence?: string | null;
};

type OfficialHazardCopy = {
  events: Record<NonFireBroadcastKind, string>;
  initialHeadline: string;
  endHeadline: string;
  initialBody: string;
  endBody: string;
  placeJoin: string;
  evidencePrefix: string;
};

const OFFICIAL_HAZARD: Record<Locale, OfficialHazardCopy> = {
  ar: {
    events: {
      flood: "فيضانات وتجمع مياه",
      storm: "اضطراب جوي وعاصفة",
      road: "اضطراب مروري وقطع طريق",
      structure: "خطر إنشائي أو انهيار",
    },
    initialHeadline: "الحماية المدنية: {{event}} في {{location}}",
    endHeadline: "الحماية المدنية: انتهاء التدخل ({{event}}) في {{location}}",
    initialBody:
      "تدخل جارٍ حسب نشرية {{asOf}} (توقيت الجزائر). المصدر: {{source}}.",
    endBody:
      "أعلنت الحماية المدنية انتهاء الوضع المسجّل حسب نشرية {{asOf}} (توقيت الجزائر). المصدر: {{source}}.",
    placeJoin: "، ",
    evidencePrefix: " نص البلاغ: ",
  },
  fr: {
    events: {
      flood: "Inondation et montée des eaux",
      storm: "Intempéries et tempête",
      road: "Axe routier perturbé ou coupé",
      structure: "Incident structurel",
    },
    initialHeadline: "Protection civile : {{event}} à {{location}}",
    endHeadline:
      "Protection civile : fin d'intervention ({{event}}) à {{location}}",
    initialBody:
      "Intervention en cours selon le bulletin de {{asOf}} (heure d'Alger). Source : {{source}}.",
    endBody:
      "Situation déclarée levée par l'autorité selon le bulletin de {{asOf}} (heure d'Alger). Source : {{source}}.",
    placeJoin: ", ",
    evidencePrefix: " Extrait officiel : ",
  },
  en: {
    events: {
      flood: "Flooding and water accumulation",
      storm: "Severe storm impact",
      road: "Road disruption or closure",
      structure: "Structural hazard",
    },
    initialHeadline: "Civil Protection: {{event}} in {{location}}",
    endHeadline:
      "Civil Protection: incident cleared ({{event}}) in {{location}}",
    initialBody:
      "Ongoing official incident as of the {{asOf}} bulletin (Algiers time). Source: {{source}}.",
    endBody:
      "Authority reported the incident cleared as of the {{asOf}} bulletin (Algiers time). Source: {{source}}.",
    placeJoin: ", ",
    evidencePrefix: " Official excerpt: ",
  },
  kab: {
    events: {
      flood: "Iḥemmalen d unekcum n waman",
      storm: "Tagnit n tegnawt qessiḥen",
      road: "Abrid yergel neɣ yeqqel d amihi",
      structure: "Amihi deg yixeddim neɣ lebni",
    },
    initialHeadline: "Tɣellist Tagdudant: {{event}} deg {{location}}",
    endHeadline:
      "Tɣellist Tagdudant: tfuk tgermant ({{event}}) deg {{location}}",
    initialBody:
      "Tagermant mazal-itt teddu akken i d-yenna ulɣu n {{asOf}} (akud n Lezzayer). Aɣbalu: {{source}}.",
    endBody:
      "Tɣellist Tagdudant tenna-d belli yekfa wugur akken i d-yenna ulɣu n {{asOf}} (akud n Lezzayer). Aɣbalu: {{source}}.",
    placeJoin: ", ",
    evidencePrefix: " Aḍris unṣib: ",
  },
};

function excerptEvidence(raw: string | null | undefined): string {
  if (!raw) return "";
  const clean = raw.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > 180 ? `${clean.slice(0, 177).trimEnd()}...` : clean;
}

/**
 * Multi-hazard DGPC official incident copy (flood, storm, road, structure).
 * Strictly attribution-first, zero em dashes, zero "safe"/"all-clear" labels,
 * zero satellite fire text, and instruction === "" (ADR-0002 / ADR-0003).
 */
export function officialHazardTexts(vars: OfficialHazardVars): CapText[] {
  const phase = vars.phase ?? "initial";
  const excerpt = excerptEvidence(vars.evidence);
  return (Object.keys(OFFICIAL_HAZARD) as Locale[]).map((locale) => {
    const copy = OFFICIAL_HAZARD[locale];
    const location = [vars.place?.trim(), vars.commune, vars.wilaya]
      .filter((part): part is string => Boolean(part && part.trim()))
      .join(copy.placeJoin);
    const event = copy.events[vars.kind];
    const slots = {
      event,
      location,
      source: vars.source,
      asOf: vars.asOf,
    };
    const headline = fill(
      phase === "end" ? copy.endHeadline : copy.initialHeadline,
      slots,
    );
    const baseBody = fill(
      phase === "end" ? copy.endBody : copy.initialBody,
      slots,
    );
    return {
      language: LANGUAGE[locale],
      event,
      headline,
      description: excerpt
        ? `${baseBody}${copy.evidencePrefix}${excerpt}`
        : baseBody,
      instruction: "",
    };
  });
}

export type EarthquakeVars = {
  magnitude: number;
  place: string;
  wilaya?: string | null;
  depthKm?: number | null;
  network: string;
  asOf: string;
  offshore?: boolean;
};

type EarthquakeCopy = {
  event: string;
  headline: string;
  headlineOffshore: string;
  body: string;
  depthPart: string;
  placeJoin: string;
};

const EARTHQUAKE_COPY: Record<Locale, EarthquakeCopy> = {
  ar: {
    event: "هزة أرضية",
    headline: "{{network}}: هزة أرضية بقوة {{mag}} قرب {{location}}",
    headlineOffshore:
      "{{network}}: هزة أرضية بقوة {{mag}} في عرض البحر قرب {{location}}",
    body: "سُجّلت هزة أرضية بقوة {{mag}} في {{asOf}} (توقيت الجزائر) قرب {{location}}{{depth}}. المصدر: {{network}}.",
    depthPart: " على عمق {{depth}} كلم",
    placeJoin: "، ",
  },
  fr: {
    event: "Séisme",
    headline: "{{network}} : séisme de magnitude {{mag}} près de {{location}}",
    headlineOffshore:
      "{{network}} : séisme en mer de magnitude {{mag}} près de {{location}}",
    body: "Séisme de magnitude {{mag}} enregistré à {{asOf}} (heure d'Alger) près de {{location}}{{depth}}. Source : {{network}}.",
    depthPart: " à {{depth}} km de profondeur",
    placeJoin: ", ",
  },
  en: {
    event: "Earthquake",
    headline: "{{network}}: M{{mag}} earthquake near {{location}}",
    headlineOffshore:
      "{{network}}: M{{mag}} offshore earthquake near {{location}}",
    body: "Magnitude {{mag}} earthquake recorded at {{asOf}} (Algiers time) near {{location}}{{depth}}. Source: {{network}}.",
    depthPart: " at {{depth}} km depth",
    placeJoin: ", ",
  },
  kab: {
    event: "Zzelzla",
    headline: "{{network}}: zzelzla n tezmert {{mag}} ɣer {{location}}",
    headlineOffshore:
      "{{network}}: zzelzla deg yilel n tezmert {{mag}} ɣer {{location}}",
    body: "Zzelzla n tezmert {{mag}} tettwakles ɣef {{asOf}} (akud n Lezzayer) ɣer {{location}}{{depth}}. Aɣbalu: {{network}}.",
    depthPart: " ɣef telqey n {{depth}} km",
    placeJoin: ", ",
  },
};

/**
 * Multi-locale M4+ earthquake alert copy for accountless commune topics.
 * Attribution-first, Algiers clock, zero em dashes, zero "safe", instruction === "".
 */
export function earthquakeTexts(vars: EarthquakeVars): CapText[] {
  const mag = vars.magnitude.toFixed(1);
  const depthValue =
    vars.depthKm != null && Number.isFinite(vars.depthKm) && vars.depthKm >= 0
      ? Math.round(vars.depthKm)
      : null;
  return (Object.keys(EARTHQUAKE_COPY) as Locale[]).map((locale) => {
    const copy = EARTHQUAKE_COPY[locale];
    const location = [vars.place, vars.wilaya]
      .filter((part): part is string => Boolean(part && part.trim()))
      .join(copy.placeJoin);
    const depth =
      depthValue !== null ? fill(copy.depthPart, { depth: depthValue }) : "";
    const slots = {
      network: vars.network,
      mag,
      location,
      asOf: vars.asOf,
      depth,
    };
    return {
      language: LANGUAGE[locale],
      event: copy.event,
      headline: fill(
        vars.offshore ? copy.headlineOffshore : copy.headline,
        slots,
      ),
      description: fill(copy.body, slots),
      instruction: "",
    };
  });
}
