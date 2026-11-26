import { isFireKind } from "@/lib/text-sources/merge";

export type CapUrgency =
  "Immediate" | "Expected" | "Future" | "Past" | "Unknown";
export type CapSeverity =
  "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown";
export type CapCertainty =
  "Observed" | "Likely" | "Possible" | "Unlikely" | "Unknown";
export type CapMsgType = "Alert" | "Update" | "Cancel";

export type CapReference = {
  sender: string;
  identifier: string;
  sent: string;
};

export type CapInfo = {
  language: string;
  category: "Fire" | "Met" | "Transport" | "Geo" | "Safety" | "Other";
  event: string;
  urgency: CapUrgency;
  severity: CapSeverity;
  certainty: CapCertainty;
  effective: string;
  expires: string;
  headline: string;
  description: string;
  instruction: string;
  areaDesc: string;
  circle?: string;
};

export type CapAlert = {
  identifier: string;
  sender: string;
  sent: string;
  status: "Actual";
  msgType: CapMsgType;
  scope: "Public";
  references?: string;
  info: CapInfo[];
};

export type CapText = {
  language: string;
  event: string;
  headline: string;
  description: string;
  instruction: string;
};

export type FireCapInput = {
  shortId: string;
  lat: number;
  lon: number;
  radiusKm: number;
  confirmed: boolean;
  urgent: boolean;
  areaDesc: string;
  sentAt: Date;
  texts: CapText[];
};

const CAP_SENDER = "alerts@nadhir.app";

type CivilCapInput = {
  id: string;
  hazard: "fire" | "weather" | "flood" | "road" | "other";
  summary: string;
  source_name: string;
  source_url: string;
  source_published_at: string;
  published_at: string;
  updated_at: string;
  expires_at: string;
  state: "published" | "withdrawn";
  revision: number;
  cap_references: { revision: number; sent: string }[];
};

export function buildCivilPublicationCap(
  input: CivilCapInput,
  areaDesc: string,
): CapAlert {
  const category: Record<CivilCapInput["hazard"], CapInfo["category"]> = {
    fire: "Fire",
    weather: "Met",
    flood: "Met",
    road: "Transport",
    other: "Other",
  };
  const event = {
    fire: "Incendie signalé",
    weather: "Phénomène météo signalé",
    flood: "Inondation signalée",
    road: "Information routière",
    other: "Information civile",
  };
  const sent = capDateTime(new Date(input.updated_at));
  return {
    identifier: `nadhir-civil-${input.id}-${input.revision}`,
    sender: CAP_SENDER,
    sent,
    status: "Actual",
    scope: "Public",
    msgType:
      input.state === "withdrawn"
        ? "Cancel"
        : input.revision > 1
          ? "Update"
          : "Alert",
    ...(input.cap_references.length
      ? {
          references: input.cap_references
            .map(
              (ref) =>
                `${CAP_SENDER},nadhir-civil-${input.id}-${ref.revision},${capDateTime(new Date(ref.sent))}`,
            )
            .join(" "),
        }
      : {}),
    info:
      input.state === "withdrawn"
        ? []
        : [
            {
              language: "fr-DZ",
              category: category[input.hazard],
              event: event[input.hazard],
              urgency: "Unknown",
              severity: "Unknown",
              certainty: "Unknown",
              effective: capDateTime(new Date(input.published_at)),
              expires: capDateTime(new Date(input.expires_at)),
              headline: input.summary,
              description: `${input.summary}\nSource : ${input.source_name} — ${input.source_url}\nPublié par la source : ${input.source_published_at}\nInformation issue d'un média, examinée par Nadhir. Ce n'est pas une consigne officielle.`,
              instruction: "",
              areaDesc,
            },
          ],
  };
}
const VALID_FOR_MINUTES = 180;

/** CAP 1.2 forbids the "Z" designator; Algeria is UTC+01:00 all year. */
function capDateTime(date: Date): string {
  const local = new Date(date.getTime() + 3600_000);
  return `${local.toISOString().slice(0, 19)}+01:00`;
}

export function fireCapIdentifier(shortId: string, urgent: boolean): string {
  return `nadhir-fire-${shortId}-${urgent ? "urgent" : "new"}`;
}

export function buildFireCap(input: FireCapInput): CapAlert {
  const effective = capDateTime(input.sentAt);
  const expires = capDateTime(
    new Date(input.sentAt.getTime() + VALID_FOR_MINUTES * 60_000),
  );

  return {
    identifier: fireCapIdentifier(input.shortId, input.urgent),
    sender: CAP_SENDER,
    sent: effective,
    status: "Actual",
    msgType: "Alert",
    scope: "Public",
    info: input.texts.map((text) => ({
      language: text.language,
      category: "Fire",
      event: text.event,
      urgency: input.urgent ? "Immediate" : "Expected",
      severity: input.urgent ? "Extreme" : "Severe",
      certainty: input.confirmed ? "Observed" : "Likely",
      effective,
      expires,
      headline: text.headline,
      description: text.description,
      instruction: text.instruction,
      areaDesc: input.areaDesc,
      circle: `${input.lat},${input.lon} ${input.radiusKm}`,
    })),
  };
}

export type BroadcastPhase = "initial" | "update" | "end" | "cancel";

export type BroadcastCapInput = {
  shortId: string;
  seq: number;
  phase: BroadcastPhase;
  lat: number;
  lon: number;
  severity: "Extreme" | "Severe";
  confirmed: boolean;
  areaDesc: string;
  sentAt: Date;
  texts: CapText[];
  references: { identifier: string; sent: string }[];
};

export const BROADCAST_RING_KM = 15;
const CLOSED_VALID_FOR_MINUTES = 24 * 60;

export function broadcastCapIdentifier(shortId: string, seq: number): string {
  return `nadhir-brd-${shortId}-${seq}`;
}

const BROADCAST_MSG_TYPE: Record<BroadcastPhase, CapAlert["msgType"]> = {
  initial: "Alert",
  update: "Update",
  end: "Update",
  cancel: "Cancel",
};

export function buildBroadcastCap(input: BroadcastCapInput): CapAlert {
  const closed = input.phase === "end" || input.phase === "cancel";
  const effective = capDateTime(input.sentAt);
  const expires = capDateTime(
    new Date(
      input.sentAt.getTime() +
        (closed ? CLOSED_VALID_FOR_MINUTES : VALID_FOR_MINUTES) * 60_000,
    ),
  );

  const urgency: CapUrgency = closed
    ? "Past"
    : input.severity === "Extreme"
      ? "Immediate"
      : "Expected";
  const certainty: CapCertainty =
    input.phase === "cancel"
      ? "Unlikely"
      : input.phase === "end"
        ? "Possible"
        : input.confirmed
          ? "Observed"
          : "Likely";

  return {
    identifier: broadcastCapIdentifier(input.shortId, input.seq),
    sender: CAP_SENDER,
    sent: effective,
    status: "Actual",
    msgType: BROADCAST_MSG_TYPE[input.phase],
    scope: "Public",
    // a re-flare opens a fresh thread: chaining it to the closed one would tell
    // clients this Alert updates a warning that is already over
    ...(input.phase !== "initial" && input.references.length
      ? {
          references: input.references
            .map((r) => `${CAP_SENDER},${r.identifier},${r.sent}`)
            .join(" "),
        }
      : {}),
    info: input.texts.map((text) => ({
      language: text.language,
      category: "Fire",
      event: text.event,
      urgency,
      severity: input.severity,
      certainty,
      effective,
      expires,
      headline: text.headline,
      description: text.description,
      instruction: text.instruction,
      areaDesc: input.areaDesc,
      circle: `${input.lat},${input.lon} ${BROADCAST_RING_KM}`,
    })),
  };
}

function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const tag = (name: string, value: string) =>
  `<${name}>${escape(value)}</${name}>`;

export function capToXml(alert: CapAlert): string {
  const info = alert.info
    .map((i) =>
      [
        "  <info>",
        `    ${tag("language", i.language)}`,
        `    ${tag("category", i.category)}`,
        `    ${tag("event", i.event)}`,
        `    ${tag("urgency", i.urgency)}`,
        `    ${tag("severity", i.severity)}`,
        `    ${tag("certainty", i.certainty)}`,
        `    ${tag("effective", i.effective)}`,
        `    ${tag("expires", i.expires)}`,
        `    ${tag("headline", i.headline)}`,
        `    ${tag("description", i.description)}`,
        `    ${tag("instruction", i.instruction)}`,
        "    <area>",
        `      ${tag("areaDesc", i.areaDesc)}`,
        ...(i.circle ? [`      ${tag("circle", i.circle)}`] : []),
        "    </area>",
        "  </info>",
      ].join("\n"),
    )
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">',
    `  ${tag("identifier", alert.identifier)}`,
    `  ${tag("sender", alert.sender)}`,
    `  ${tag("sent", alert.sent)}`,
    `  ${tag("status", alert.status)}`,
    `  ${tag("msgType", alert.msgType)}`,
    `  ${tag("scope", alert.scope)}`,
    ...(alert.references ? [`  ${tag("references", alert.references)}`] : []),
    info,
    "</alert>",
  ].join("\n");
}

const MAX_CAP_REFERENCES_LEN = 32_768;

const CAP_ISO_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/;

function isValidCapTimestamp(ts: string): boolean {
  const match = CAP_ISO_DATETIME_RE.exec(ts);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (match[8] !== undefined) {
    const tzHour = Number(match[9]);
    const tzMinute = Number(match[10]);
    if (tzHour > 23 || tzMinute > 59) return false;
  }
  // Verify real calendar date without JS Date rollover (rejects 2026-02-30, 2026-04-31)
  const checkDate = new Date(0);
  checkDate.setUTCFullYear(year, month - 1, day);
  if (
    checkDate.getUTCFullYear() !== year ||
    checkDate.getUTCMonth() !== month - 1 ||
    checkDate.getUTCDate() !== day
  ) {
    return false;
  }
  return Number.isFinite(Date.parse(ts));
}

/** Parse a CAP 1.2 <msgType> value into Alert | Update | Cancel, or null for Ack/Error/unknown. */
export function parseCapMsgType(
  raw: string | null | undefined,
): CapMsgType | null {
  if (!raw) return null;
  switch (raw.trim().toLowerCase()) {
    case "alert":
      return "Alert";
    case "update":
      return "Update";
    case "cancel":
      return "Cancel";
    default:
      return null;
  }
}

/**
 * Linear O(n), ReDoS-free parser for CAP 1.2 `<references>` values.
 * Accepts standard whitespace-delimited `sender,identifier,sent` tuples as well as
 * comma-joined runs (`s1,id1,t1,s2,id2,t2`), skipping malformed entries safely.
 */
export function parseCapReferences(
  raw: string | null | undefined,
): CapReference[] {
  if (!raw) return [];
  const bounded =
    raw.length > MAX_CAP_REFERENCES_LEN
      ? raw.slice(0, MAX_CAP_REFERENCES_LEN)
      : raw;
  const trimmed = bounded.trim();
  if (!trimmed) return [];

  const out: CapReference[] = [];
  const seen = new Set<string>();
  const pushTuple = (sender: string, identifier: string, sent: string) => {
    const s = sender.trim();
    const id = identifier.trim();
    const ts = sent.trim();
    if (!s || !id || !ts) return;
    if (!isValidCapTimestamp(ts)) return;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ sender: s, identifier: id, sent: ts });
  };

  const tokens = trimmed.split(/\s+/);
  for (const token of tokens) {
    const parts = token.split(",");
    if (parts.length === 3) {
      pushTuple(parts[0]!, parts[1]!, parts[2]!);
    } else if (parts.length >= 6 && parts.length % 3 === 0) {
      for (let i = 0; i < parts.length; i += 3) {
        pushTuple(parts[i]!, parts[i + 1]!, parts[i + 2]!);
      }
    }
  }
  return out;
}

export function parseCapReferenceIds(raw: string | null | undefined): string[] {
  return parseCapReferences(raw).map((ref) => ref.identifier);
}

export function officialCapCategory(kind: string): CapInfo["category"] {
  if (isFireKind(kind)) return "Fire";
  switch (kind) {
    case "flood":
    case "storm":
      return "Met";
    case "road":
      return "Transport";
    case "structure":
      return "Safety";
    default:
      return "Other";
  }
}

export type OfficialCapInput = {
  incidentId: string;
  areaDesc: string;
  sentAt: Date;
  asOf: Date;
  texts: CapText[];
  kind?: string | undefined;
  category?: CapInfo["category"];
  severity?: "Extreme" | "Severe";
  phase?: "initial" | "end";
  expiresHours?: number;
  references?: { identifier: string; sent: string }[];
};

export function officialCapIdentifier(
  incidentId: string,
  phase: "initial" | "end" = "initial",
): string {
  const base = `nadhir-off-${incidentId.slice(0, 8)}`;
  return phase === "end" ? `${base}-end` : base;
}

/* No circle: the authority named a commune, not a point with a radius, and the
 * areaDesc is the only geometry claim Nadhir can make for it. */
export function buildOfficialCap(input: OfficialCapInput): CapAlert {
  const phase = input.phase ?? "initial";
  const isEnd = phase === "end";
  const sent = capDateTime(input.sentAt);
  const expiresHours = input.expiresHours ?? 24;
  const category =
    input.category ?? (input.kind ? officialCapCategory(input.kind) : "Fire");
  const severity = input.severity ?? "Severe";
  const refs = input.references ?? [];
  return {
    identifier: officialCapIdentifier(input.incidentId, phase),
    sender: CAP_SENDER,
    sent,
    status: "Actual",
    msgType: isEnd ? "Update" : "Alert",
    scope: "Public",
    ...(isEnd && refs.length
      ? {
          references: refs
            .map((r) => `${CAP_SENDER},${r.identifier},${r.sent}`)
            .join(" "),
        }
      : {}),
    info: input.texts.map((text) => ({
      language: text.language,
      category,
      event: text.event,
      urgency: isEnd ? "Past" : "Expected",
      severity,
      certainty: "Observed",
      effective: capDateTime(input.asOf),
      expires: capDateTime(
        new Date(input.sentAt.getTime() + expiresHours * 60 * 60_000),
      ),
      headline: text.headline,
      description: text.description,
      instruction: text.instruction,
      areaDesc: input.areaDesc,
    })),
  };
}

export type EarthquakeCapInput = {
  earthquakeId: string;
  magnitude: number;
  lat: number;
  lon: number;
  radiusKm?: number;
  areaDesc: string;
  occurredAt: Date;
  sentAt: Date;
  texts: CapText[];
};

export function earthquakeCapIdentifier(earthquakeId: string): string {
  return `nadhir-quake-${earthquakeId}`;
}

export function buildEarthquakeCap(input: EarthquakeCapInput): CapAlert {
  const severeOrExtreme: "Extreme" | "Severe" =
    input.magnitude >= 5.0 ? "Extreme" : "Severe";
  const urgency: CapUrgency = input.magnitude >= 5.0 ? "Immediate" : "Expected";
  const radiusKm = input.radiusKm ?? 100;
  const effective = capDateTime(input.occurredAt);
  const expires = capDateTime(
    new Date(input.occurredAt.getTime() + 6 * 60 * 60_000),
  );

  return {
    identifier: earthquakeCapIdentifier(input.earthquakeId),
    sender: CAP_SENDER,
    sent: capDateTime(input.sentAt),
    status: "Actual",
    msgType: "Alert",
    scope: "Public",
    info: input.texts.map((text) => ({
      language: text.language,
      category: "Geo",
      event: text.event,
      urgency,
      severity: severeOrExtreme,
      certainty: "Observed",
      effective,
      expires,
      headline: text.headline,
      description: text.description,
      instruction: text.instruction,
      areaDesc: input.areaDesc,
      circle: `${input.lat},${input.lon} ${radiusKm}`,
    })),
  };
}
