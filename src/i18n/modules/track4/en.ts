export const track4En = {
  officialSource: {
    disclaimerWithSource:
      "Relayed from {{source}}'s official public channel. Information only, not an official order.",
  },
  quakeOfficial: {
    eyebrow: "Official seismic bulletin",
    attributionLabel: "CRAAG bulletin",
    magnitudeLabel: "CRAAG magnitude",
    placeLabel: "CRAAG location",
    viewBulletin: "View CRAAG bulletin",
    standaloneNote:
      "Official seismic measurement published by CRAAG. Information only, not a damage assessment or directive.",
  },
  rainfallObserved: {
    title: "Observed 30-min satellite rainfall",
    satelliteBadge: "Satellite observed",
    rateUnit: "{{rate}} mm/h",
    accum30mUnit: "{{mm}} mm / 30 min",
    distinctFromModel:
      "Satellite rainfall estimate over 30 minutes, separate from numerical weather forecasts.",
  },
};

export type Track4Translation = typeof track4En;
