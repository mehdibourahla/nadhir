import type { Track4Translation } from "./en";

export const track4Fr: Track4Translation = {
  officialSource: {
    disclaimerWithSource:
      "Relayé depuis le canal public officiel de {{source}}. Information uniquement, pas une consigne officielle.",
  },
  quakeOfficial: {
    eyebrow: "Bulletin sismique officiel",
    attributionLabel: "Bulletin CRAAG",
    magnitudeLabel: "Magnitude CRAAG",
    placeLabel: "Localisation CRAAG",
    viewBulletin: "Voir le bulletin CRAAG",
    standaloneNote:
      "Mesure sismique officielle publiée par le CRAAG. Information uniquement, pas une évaluation des dégâts ni une consigne.",
  },
  rainfallObserved: {
    title: "Pluie satellitaire observée sur 30 min",
    satelliteBadge: "Observé par satellite",
    rateUnit: "{{rate}} mm/h",
    accum30mUnit: "{{mm}} mm / 30 min",
    distinctFromModel:
      "Estimation satellitaire des précipitations sur 30 minutes, distincte des prévisions numériques.",
  },
};
