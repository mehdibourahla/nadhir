import { archivedFetch, ArchiveFailure } from "@/lib/source-archive.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  parseCapMsgType,
  parseCapReferenceIds,
  type CapMsgType,
} from "@/lib/cap";
import { fetchAllPages } from "@/lib/paginate";

/* ONM (Office National de la Météorologie) vigilance feed: CAP 1.2 warnings per
 * wilaya, CC BY 4.0, registered WMO alerting authority (OID 2.49.0.1.12.0).
 * Nadhir RELAYS these verbatim with source and timestamps — it never composes or
 * edits an authority's warning (CONTEXT.md, Instruction). The Atom feed carries
 * the CAP summary inline, so one fetch covers all wilayas. */
const FEED_URL = "https://ametvigilance.meteo.dz/rss/rss_meteo_dz.xml";

export type OnmEntry = {
  cap_id: string;
  title: string;
  event: string;
  severity: string;
  urgency: string;
  certainty: string;
  onset: string | null;
  expires: string | null;
  sent: string;
  area_desc: string;
  cap_url: string | null;
  msg_type: CapMsgType;
  cap_references: string | null;
  referenced_cap_ids: string[];
  geocodes: string[];
};

const isXmlTagBoundary = (ch: string | undefined): boolean =>
  ch === ">" ||
  ch === " " ||
  ch === "\t" ||
  ch === "\n" ||
  ch === "\r" ||
  ch === "/";

/** Linear O(n), ReDoS-free XML leaf tag reader supporting optional attributes. */
const tag = (xml: string, name: string): string | null => {
  const openPrefix = `<${name}`;
  const closeTag = `</${name}>`;
  let pos = 0;
  while (pos < xml.length) {
    const start = xml.indexOf(openPrefix, pos);
    if (start === -1) return null;
    const afterName = start + openPrefix.length;
    if (!isXmlTagBoundary(xml[afterName])) {
      pos = afterName;
      continue;
    }
    const openEnd = xml.indexOf(">", afterName);
    if (openEnd === -1) return null;
    if (xml[openEnd - 1] === "/") {
      pos = openEnd + 1;
      continue;
    }
    const nextLt = xml.indexOf("<", openEnd + 1);
    if (nextLt === -1) return null;
    if (!xml.startsWith(closeTag, nextLt)) {
      pos = nextLt;
      continue;
    }
    return xml.slice(openEnd + 1, nextLt).trim();
  }
  return null;
};

/** Linear O(n), ReDoS-free extraction of Atom <entry>...</entry> blocks (with optional attributes). */
function extractEntries(xml: string): string[] {
  const entries: string[] = [];
  const openPrefix = "<entry";
  const closeTag = "</entry>";
  let pos = 0;
  while (pos < xml.length) {
    const start = xml.indexOf(openPrefix, pos);
    if (start === -1) break;
    const afterName = start + openPrefix.length;
    if (!isXmlTagBoundary(xml[afterName])) {
      pos = afterName;
      continue;
    }
    const openEnd = xml.indexOf(">", afterName);
    if (openEnd === -1) break;
    if (xml[openEnd - 1] === "/") {
      pos = openEnd + 1;
      continue;
    }
    const closeStart = xml.indexOf(closeTag, openEnd + 1);
    if (closeStart === -1) break;
    entries.push(xml.slice(start, closeStart + closeTag.length));
    pos = closeStart + closeTag.length;
  }
  return entries;
}

/** Linear O(n) extraction of <geocode><value>...</value></geocode> (and cap:-prefixed forms). */
function extractGeocodes(xml: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const prefixes = ["cap:", ""];
  for (const prefix of prefixes) {
    const openGeo = `<${prefix}geocode`;
    const closeGeo = `</${prefix}geocode>`;
    let pos = 0;
    while (pos < xml.length) {
      const start = xml.indexOf(openGeo, pos);
      if (start === -1) break;
      const afterName = start + openGeo.length;
      if (!isXmlTagBoundary(xml[afterName])) {
        pos = afterName;
        continue;
      }
      const openEnd = xml.indexOf(">", afterName);
      if (openEnd === -1) break;
      if (xml[openEnd - 1] === "/") {
        pos = openEnd + 1;
        continue;
      }
      const end = xml.indexOf(closeGeo, openEnd + 1);
      if (end === -1) break;
      const block = xml.slice(openEnd + 1, end);
      const val = tag(block, `${prefix}value`);
      if (val && !seen.has(val)) {
        seen.add(val);
        out.push(val);
      }
      pos = end + closeGeo.length;
    }
  }
  return out;
}

/** Linear O(n), ReDoS-free extractor for CAP XML link hrefs (`/CAPs/*.xml`). */
function extractCapUrl(entry: string): string | null {
  let pos = 0;
  while (pos < entry.length) {
    const start = entry.indexOf('href="', pos);
    if (start === -1) return null;
    const valStart = start + 6;
    const end = entry.indexOf('"', valStart);
    if (end === -1) return null;
    const href = entry.slice(valStart, end);
    const capsIdx = href.indexOf("/CAPs/");
    if (
      capsIdx !== -1 &&
      href.endsWith(".xml") &&
      href.length > capsIdx + "/CAPs/.xml".length
    ) {
      return href;
    }
    pos = end + 1;
  }
  return null;
}

export function parseOnmFeed(xml: string): OnmEntry[] {
  if (!xml.includes("urn:oasis:names:tc:emergency:cap:1.2")) return [];
  const out: OnmEntry[] = [];
  for (const entry of extractEntries(xml)) {
    const cap_id = tag(entry, "id");
    const title = tag(entry, "title");
    const sent = tag(entry, "cap:sent");
    const rawMsgType = tag(entry, "cap:msgType") ?? tag(entry, "msgType");
    let msg_type: CapMsgType = "Alert";
    if (rawMsgType !== null && rawMsgType !== "") {
      const parsed = parseCapMsgType(rawMsgType);
      if (!parsed) continue;
      msg_type = parsed;
    }
    const area = tag(entry, "cap:areaDesc");
    if (!cap_id || !title || !sent) continue;
    if (!area && msg_type !== "Cancel") continue;
    const rawRefs =
      tag(entry, "cap:references") ?? tag(entry, "references") ?? null;
    const cap_references = rawRefs && rawRefs.length > 0 ? rawRefs : null;
    out.push({
      cap_id,
      title,
      // "Rain Moderate warning for the wilaya: X" — the first word is the event
      event: title.split(" ")[0] ?? "Unknown",
      severity: tag(entry, "cap:severity") ?? "Unknown",
      urgency: tag(entry, "cap:urgency") ?? "Unknown",
      certainty: tag(entry, "cap:certainty") ?? "Unknown",
      onset: tag(entry, "cap:onset"),
      expires: tag(entry, "cap:expires"),
      sent,
      area_desc: area ?? "",
      cap_url: extractCapUrl(entry),
      msg_type,
      cap_references,
      referenced_cap_ids: parseCapReferenceIds(cap_references),
      geocodes: extractGeocodes(entry),
    });
  }
  return out;
}

export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

export function matchWilaya<
  T extends { name_fr: string; name_en?: string | null },
>(areaDesc: string, wilayas: T[]): T | null {
  const target = normalizeName(areaDesc);
  // ONM's romanisation follows the English column for some wilayas (TIMIMOUN vs
  // the French Timimoune), and one silent mismatch degrades the whole run
  return (
    wilayas.find(
      (w) =>
        normalizeName(w.name_fr) === target ||
        (w.name_en != null && normalizeName(w.name_en) === target),
    ) ?? null
  );
}

export type CapDetail = {
  headline_fr: string | null;
  instruction_fr: string | null;
  polygon: [number, number][] | null;
  msg_type: CapMsgType | null;
  cap_references: string | null;
  referenced_cap_ids: string[];
  geocodes: string[];
};

const BOILERPLATE = "no additional information.";

const isBoilerplateInstruction = (value: string): boolean =>
  value.trim().replace(/\s+/g, " ").toLowerCase() === BOILERPLATE;

export function parseCapDetail(xml: string): CapDetail | null {
  if (!xml.includes("urn:oasis:names:tc:emergency:cap:1.2")) return null;
  const infoMatch = /<info(?:\s|>)/.exec(xml);
  const infoStart = infoMatch ? infoMatch.index : -1;
  const headerXml = infoStart === -1 ? xml : xml.slice(0, infoStart);
  const msg_type = parseCapMsgType(
    tag(headerXml, "msgType") ?? tag(headerXml, "cap:msgType"),
  );
  const rawRefs =
    tag(headerXml, "references") ?? tag(headerXml, "cap:references") ?? null;
  const cap_references = rawRefs && rawRefs.length > 0 ? rawRefs : null;

  const headline = tag(xml, "headline");
  const instruction = tag(xml, "instruction");
  const rawPolygon = tag(xml, "polygon");
  const polygon = rawPolygon
    ? rawPolygon
        .trim()
        .split(/\s+/)
        .map((pair): [number, number] | null => {
          const [lat, lon] = pair.split(",").map(Number);
          return Number.isFinite(lat) && Number.isFinite(lon)
            ? [lon!, lat!]
            : null;
        })
        .filter((pt): pt is [number, number] => pt !== null)
    : null;
  return {
    headline_fr: headline,
    instruction_fr:
      instruction && !isBoilerplateInstruction(instruction)
        ? instruction
        : null,
    polygon: polygon?.length ? polygon : null,
    msg_type,
    cap_references,
    referenced_cap_ids: parseCapReferenceIds(cap_references),
    geocodes: extractGeocodes(xml),
  };
}

const DETAIL_BATCH = 20;

export async function backfillCapDetails(): Promise<{
  filled: number;
  failed: number;
}> {
  const { data, error } = await supabaseAdmin
    .from("onm_vigilance")
    .select("id, cap_id, cap_url")
    .is("cap_detail_fetched_at", null)
    .not("cap_url", "is", null)
    .order("sent", { ascending: false })
    .limit(DETAIL_BATCH);
  if (error) throw new Error(`CAP detail query failed: ${error.message}`);
  if (!data?.length) return { filled: 0, failed: 0 };

  let filled = 0;
  let failed = 0;
  const chainCapIds: string[] = [];
  for (const row of data) {
    const res = await archivedFetch(
      "onm",
      "cap_detail",
      row.cap_url!,
      undefined,
      {
        requestParams: {
          document: new URL(row.cap_url!).pathname.split("/").at(-1) ?? "",
        },
      },
    ).catch((error) => {
      if (error instanceof ArchiveFailure) throw error;
      return null;
    });
    if (!res?.ok) {
      failed++;
      continue;
    }
    const detail = parseCapDetail(await res.text());
    if (!detail) {
      failed++;
      continue;
    }
    const { error: upErr } = await supabaseAdmin.rpc("store_onm_detail", {
      _id: row.id,
      ...(detail.headline_fr === null
        ? {}
        : { _headline_fr: detail.headline_fr }),
      ...(detail.instruction_fr === null
        ? {}
        : { _instruction_fr: detail.instruction_fr }),
      ...(detail.polygon === null ? {} : { _polygon: detail.polygon }),
      ...(detail.msg_type === null ? {} : { _msg_type: detail.msg_type }),
      ...(detail.cap_references === null
        ? {}
        : { _cap_references: detail.cap_references }),
      ...(detail.referenced_cap_ids.length
        ? { _referenced_cap_ids: detail.referenced_cap_ids }
        : {}),
      ...(detail.geocodes.length ? { _geocodes: detail.geocodes } : {}),
    });
    if (!upErr) {
      filled += 1;
      if (
        typeof row.cap_id === "string" &&
        row.cap_id.length > 0 &&
        (detail.msg_type === "Update" ||
          detail.msg_type === "Cancel" ||
          detail.referenced_cap_ids.length > 0)
      ) {
        chainCapIds.push(row.cap_id);
      }
    } else failed++;
  }
  if (chainCapIds.length) {
    const { error: chainErr } = await supabaseAdmin.rpc("apply_onm_cap_chain", {
      _cap_ids: chainCapIds,
    });
    if (chainErr) {
      throw new Error(`ONM CAP detail chain failed: ${chainErr.message}`);
    }
  }
  return { filled, failed };
}

export type OnmRun = {
  fetched: number;
  stored: number;
  unmatched: number;
  superseded?: number;
  detailed?: number;
  linkedUpdates?: number;
  cancelled?: number;
  invalidatedDeliveries?: number;
  error?: string;
};

const MSG_TYPE_ORDER: Record<CapMsgType, number> = {
  Alert: 0,
  Update: 1,
  Cancel: 2,
};

function parseChainResult(raw: unknown): {
  linkedUpdates?: number;
  cancelled?: number;
  invalidatedDeliveries?: number;
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  return {
    ...(typeof obj["linked_updates"] === "number"
      ? { linkedUpdates: obj["linked_updates"] }
      : {}),
    ...(typeof obj["cancelled_warnings"] === "number"
      ? { cancelled: obj["cancelled_warnings"] }
      : {}),
    ...(typeof obj["invalidated_deliveries"] === "number"
      ? { invalidatedDeliveries: obj["invalidated_deliveries"] }
      : {}),
  };
}

export async function ingestOnm(): Promise<OnmRun> {
  let xml: string;
  try {
    const res = await archivedFetch("onm", "atom_feed", FEED_URL, {
      headers: { accept: "application/atom+xml" },
    });
    if (!res.ok)
      return {
        fetched: 0,
        stored: 0,
        unmatched: 0,
        error: `ONM feed ${res.status}`,
      };
    xml = await res.text();
  } catch (error) {
    if (error instanceof ArchiveFailure) throw error;
    return {
      fetched: 0,
      stored: 0,
      unmatched: 0,
      error: error instanceof Error ? error.message : "ONM fetch failed",
    };
  }

  const entries = parseOnmFeed(xml);
  if (!entries.length)
    return {
      fetched: 0,
      stored: 0,
      unmatched: 0,
      error: "ONM feed returned no CAP entries",
    };

  const wilayas = await fetchAllPages<{
    id: string;
    name_fr: string;
    name_en: string | null;
  }>((from, to) =>
    supabaseAdmin
      .from("admin_units")
      .select("id, name_fr, name_en")
      .eq("level", "wilaya")
      .order("id")
      .range(from, to),
  );

  let unmatched = 0;
  // Sort chronologically with Alert < Update < Cancel tiebreak so parents precede children in one batch
  const rows = [...entries]
    .sort(
      (a, b) =>
        Date.parse(a.sent) - Date.parse(b.sent) ||
        MSG_TYPE_ORDER[a.msg_type] - MSG_TYPE_ORDER[b.msg_type],
    )
    .map((e) => {
      const wilaya = e.area_desc ? matchWilaya(e.area_desc, wilayas) : null;
      if (!wilaya && e.msg_type !== "Cancel") unmatched += 1;
      return { ...e, wilaya_id: wilaya?.id ?? null };
    });

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabaseAdmin
      .from("onm_vigilance")
      .upsert(rows.slice(i, i + 500), { onConflict: "cap_id" });
    if (error)
      return {
        fetched: entries.length,
        stored: 0,
        unmatched,
        error: `onm_vigilance upsert failed: ${error.message}`,
      };
  }

  const newest = entries.reduce((a, b) =>
    Date.parse(b.sent) > Date.parse(a.sent) ? b : a,
  );
  const { data: superseded, error: supersedeError } = await supabaseAdmin.rpc(
    "supersede_onm_absent",
    { _feed_cap_ids: entries.map((e) => e.cap_id), _feed_sent: newest.sent },
  );
  if (supersedeError)
    return {
      fetched: entries.length,
      stored: rows.length,
      unmatched,
      error: `ONM supersession failed: ${supersedeError.message}`,
    };

  const { data: chainData, error: chainError } = await supabaseAdmin.rpc(
    "apply_onm_cap_chain",
    { _cap_ids: rows.map((r) => r.cap_id) },
  );
  if (chainError)
    return {
      fetched: entries.length,
      stored: rows.length,
      unmatched,
      superseded: superseded ?? 0,
      error: `ONM CAP chain failed: ${chainError.message}`,
    };

  const detailed = await backfillCapDetails();
  return {
    fetched: entries.length,
    stored: rows.length,
    unmatched,
    superseded: superseded ?? 0,
    detailed: detailed.filled,
    ...parseChainResult(chainData),
    ...(detailed.failed
      ? { error: `ONM partial CAP detail coverage: ${detailed.failed} failed` }
      : {}),
  };
}
