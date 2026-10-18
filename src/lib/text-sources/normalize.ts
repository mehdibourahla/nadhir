const DIACRITICS = /[ً-ْـ]/g;
const PUNCT = /[-#:،,.()؟!؛;"'«»]/g;

export function normalizeArabic(input: string): string {
  let s = input.normalize("NFKC").replace(/_/g, " ");
  s = s.replace(DIACRITICS, "").replace(PUNCT, " ");
  s = s
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ی/g, "ي")
    .replace(/ھ/g, "ه")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ث/g, "ت")
    .replace(/[قڤڨگ]/g, "ك")
    .replace(/ذ/g, "د")
    .replace(/ظ/g, "ض");
  s = s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/^ال(?=\S)/, "").replace(/^ل(?=\S\S)/, ""))
    .join(" ");
  return s.trim();
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

function diceSimilarity(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let shared = 0;
  for (const [g, n] of ga) shared += Math.min(n, gb.get(g) ?? 0);
  return (2 * shared) / (a.length - 1 + (b.length - 1));
}

const STATUS_WORDS = /عملي|متواصل|إخماد|اخماد|سيطر|تراجع|خطور|حراس|تجنيد|وسائل/;
const FUZZY_THRESHOLD = 0.75;

export type CommuneCandidate = {
  id: string;
  name_ar: string;
  aliases: string[];
};

export type CommuneMatch = { id: string; via: "exact" | "alias" | "fuzzy" };

export function resolveCommune(
  name: string,
  candidates: readonly CommuneCandidate[],
): CommuneMatch | null {
  const n = normalizeArabic(name.replace(/\([^)]*\)?/g, " "));
  if (n.length < 3 || STATUS_WORDS.test(name)) return null;
  const compact = n.replace(/\s+/g, "");
  for (const c of candidates)
    if (normalizeArabic(c.name_ar) === n) return { id: c.id, via: "exact" };
  for (const c of candidates)
    if (c.aliases.some((a) => normalizeArabic(a) === n))
      return { id: c.id, via: "alias" };
  let best: { id: string; score: number } | null = null;
  for (const c of candidates) {
    const score = diceSimilarity(
      compact,
      normalizeArabic(c.name_ar).replace(/\s+/g, ""),
    );
    if (!best || score > best.score) best = { id: c.id, score };
  }
  return best && best.score >= FUZZY_THRESHOLD
    ? { id: best.id, via: "fuzzy" }
    : null;
}

export function resolveWilaya(
  text: string,
  wilayas: readonly { id: string; name_ar: string }[],
): string | null {
  const tokens = normalizeArabic(text).split(" ");
  const ranked = [...wilayas]
    .map((w) => ({ id: w.id, parts: normalizeArabic(w.name_ar).split(" ") }))
    .sort((a, b) => b.parts.length - a.parts.length);
  for (const w of ranked) {
    for (let i = 0; i + w.parts.length <= tokens.length; i++) {
      if (w.parts.every((p, k) => tokens[i + k] === p)) return w.id;
    }
  }
  return null;
}
