import { api, z, snowflake } from "@superblocksteam/sdk-api";
import {
  renderMetrosightEvidence,
  renderResidentsUnitsCombo,
  renderSinceInception,
  renderQbrClose,
  renderLaunchSnapshot,
  renderHighRentAdoption,
  renderAdoptionTrend,
  renderPropertiesWorthCelebrating,
  renderAdoptionOpportunities,
  renderPeerBenchmarks,
  renderDelinquency,
  renderRetention,
  renderCustomerExperience,
  computePropertyTrendFlags,
  renderImportedSlide,
} from "./slide-renderers.js";
import type { BenchmarkMetric, ResidentTrend, Testimonial, TrendFlag, YearlyData, NewRolloutCandidate, DisabledPropertyRow } from "./slide-renderers.js";
import { buildSpeakerNotesHtml, buildExpansionSpeakerNotesHtml, EXPANSION_SLIDE_TITLES } from "./speaker-notes.js";
import type { SpeakerNotesKpis, SpeakerNotesBenchmark, SpeakerNotesMonthlyRow } from "./speaker-notes.js";
import {
  renderExpansionMetrosight,
  renderExpansionGap,
  renderExpansionCaseClose,
  renderAffordableHousing,
} from "./expansion-renderers.js";
import {
  type NetworkPoolProperty,
  propertyAgeBucket,
  resolvePropertyPeerNar,
  resolvePropertyPeerEngagement,
} from "./peer-matching.js";

const SNOWFLAKE_SSO = "d38ee94a-4e93-46f5-ab44-c65a99b3aea5";

// ─── Module-level cache: network pool (same for all PMCs in a given cutoff month) ───
type NetworkPoolRow = { PMC_NAME: string; PROPERTY_NAME: string; PROPERTY_STATE: string | null; PROPERTY_UNIT_COUNT: number; RENT_PAID_AMOUNT: number | null; BILLS_PAID_COUNT: number | null; ROLLOUT_MONTH: string | null; T12_CONNECTIONS: number | null; MEDIAN_RENTER_INCOME: number | null };
let _networkPoolCache: { cutoff: string; data: NetworkPoolRow[]; fetchedAt: number } | null = null;
const _NETWORK_POOL_TTL_MS = 10 * 60 * 1000; // 10 minutes — unused while caching is disabled, see below

// ─── Peer-matching geo helpers (faithful port of Flask's generator/data.py:1047-1440) ───
// Ported because the peer-median/Peer Benchmarks cohort was found to diverge from Flask's:
// the tier ladder further down was missing the multi-state overlap tier AND the region tier
// entirely, and its "footprint" tiers didn't actually check footprint (no bucket match — they
// behaved like Flask's unconditional "none" tiers under a misleading label). All four pieces
// below exist purely to let the tier ladder match Flask's real ladder tier-for-tier.
const STATE_TO_REGION: Record<string, string> = {
  FL: "Southeast", GA: "Southeast", SC: "Southeast", NC: "Southeast",
  TN: "Southeast", AL: "Southeast", MS: "Southeast", VA: "Southeast",
  WV: "Southeast", KY: "Southeast",
  AR: "South Central", LA: "South Central", OK: "South Central", TX: "South Central",
  AZ: "Southwest", NM: "Southwest",
  OH: "Midwest", IN: "Midwest", IL: "Midwest", MI: "Midwest",
  WI: "Midwest", MN: "Midwest", IA: "Midwest", MO: "Midwest",
  ND: "Midwest", SD: "Midwest", NE: "Midwest", KS: "Midwest",
  CO: "Mountain", UT: "Mountain", NV: "Mountain", ID: "Mountain",
  MT: "Mountain", WY: "Mountain",
  CA: "Pacific", WA: "Pacific", OR: "Pacific", AK: "Pacific", HI: "Pacific",
  NY: "Northeast", NJ: "Northeast", PA: "Northeast", MA: "Northeast",
  CT: "Northeast", RI: "Northeast", VT: "Northeast", NH: "Northeast",
  ME: "Northeast", MD: "Northeast", DE: "Northeast", DC: "Northeast",
};

/** Flask: _dominant_region (generator/data.py:1298) — only a real >=45% plurality counts as a
 * region identity; a genuinely national footprint (e.g. 36/35/23% split) must fall through to
 * the footprint-bucket tiers instead of being mislabeled with whichever region barely edges out. */
function dominantRegion(stateUnits: Map<string, number>, minShare = 0.45): string | null {
  const regionUnits = new Map<string, number>();
  for (const [st, units] of stateUnits) {
    const r = STATE_TO_REGION[st];
    if (r) regionUnits.set(r, (regionUnits.get(r) ?? 0) + units);
  }
  if (regionUnits.size === 0) return null;
  let total = 0;
  for (const u of regionUnits.values()) total += u;
  if (total <= 0) return null;
  let topRegion = "", topUnits = -1;
  for (const [r, u] of regionUnits) { if (u > topUnits) { topUnits = u; topRegion = r; } }
  return topUnits / total >= minShare ? topRegion : null;
}

/** Flask: _primary_state_if_dominant (generator/data.py:1325) — same real-plurality guard
 * (>=35%) as dominantRegion, one level down. A PMC spread thin across many states in one
 * region has no single-state identity and should fall through to region matching instead. */
function primaryStateIfDominant(stateUnits: Map<string, number>, minShare = 0.35): string | null {
  let total = 0;
  for (const u of stateUnits.values()) total += u;
  if (total <= 0) return null;
  let topState = "", topUnits = -1;
  for (const [st, u] of stateUnits) { if (u > topUnits) { topUnits = u; topState = st; } }
  return topUnits / total >= minShare ? topState : null;
}

/** Flask: _fp_bucket (generator/data.py:1426) — footprint bucket by state count. */
function fpBucket(stateCount: number): string {
  if (stateCount <= 1) return "single";
  if (stateCount <= 4) return "regional";
  if (stateCount <= 9) return "multi";
  return "national";
}

interface GeoTierCandidate { name: string; totalUnits: number; stateUnits: Map<string, number> }

/** Flask: _resolve_geo_tier (generator/data.py:1341) — multi-state overlap matching, tried
 * BEFORE the dominant-state/region/footprint tiers below. A subject genuinely present in two
 * states with neither dominant (e.g. real CA+WA presence) previously reduced to
 * primaryState=null/dominantRegion=null and fell straight to a count-based footprint bucket
 * with no attempt to find peers who ALSO operate in those same states — this fixes that blind
 * spot without replacing the existing tiers, which remain the fallback when no overlap match. */
function resolveGeoTier<T extends GeoTierCandidate>(
  candidates: T[],
  subjectStateUnits: Map<string, number>,
  minPoolSize = 3
): { matched: T[]; label: string; isOverlap: boolean } {
  const subjectStates = new Set<string>();
  for (const [st, u] of subjectStateUnits) if (u > 0) subjectStates.add(st);
  if (subjectStates.size === 0 || candidates.length === 0) {
    return { matched: [], label: "", isOverlap: false };
  }

  const overlapUnits = (su: Map<string, number>) => {
    let s = 0;
    for (const [st, u] of su) if (subjectStates.has(st)) s += u;
    return s;
  };
  const coverage = (su: Map<string, number>) => {
    let c = 0;
    for (const st of subjectStates) if ((su.get(st) ?? 0) > 0) c++;
    return c;
  };

  const withMeta = candidates.map((c) => {
    const ov = overlapUnits(c.stateUnits);
    return { c, overlapUnits: ov, coverage: coverage(c.stateUnits), concentration: c.totalUnits > 0 ? ov / c.totalUnits : 0 };
  });

  const nStates = subjectStates.size;
  const notThin = minPoolSize * 2;
  const sortedStates = [...subjectStates].sort();
  const statesLabel = nStates <= 6 ? sortedStates.join(", ") : "your markets";

  // Tier 1: true 1:1 — candidate's own portfolio is >=70% concentrated inside the subject's
  // states AND covers every one of them.
  const t1 = withMeta.filter((m) => m.concentration >= 0.70 && m.coverage >= nStates && m.overlapUnits > 0);
  if (t1.length >= minPoolSize) {
    return { matched: t1.map((m) => m.c), label: `true 1:1 match in ${statesLabel}`, isOverlap: true };
  }

  // Tier 2: both-state presence — covers every one of the subject's states, any concentration.
  if (nStates >= 2) {
    const t2 = withMeta.filter((m) => m.coverage >= nStates && m.overlapUnits > 0);
    if (t2.length >= notThin) {
      return { matched: t2.map((m) => m.c), label: `presence in every one of ${statesLabel}`, isOverlap: true };
    }
  }

  // Tier 3: any real overlap presence in at least one of the subject's states.
  const t3 = withMeta.filter((m) => m.overlapUnits > 0);
  if (t3.length >= minPoolSize) {
    return { matched: t3.map((m) => m.c), label: `presence in ${statesLabel}`, isOverlap: true };
  }

  return { matched: [], label: "", isOverlap: false };
}

const RawRowSchema = z.object({
  BP_MONTH: z.string(),
  PROPERTY_NAME: z.string(),
  PMC_NAME: z.string(),
  PROPERTY_UNIT_COUNT: z.coerce.number(),
  ROLLOUT_MONTH: z.string().nullable(),
  CHARGED_USERS: z.coerce.number(),
  NEW_SIGNUPS: z.coerce.number().nullable(),
  BILLS_PAID: z.coerce.number(),
  RENT_PAID: z.coerce.number(),
  PROPERTY_PUBLIC_ID: z.string().nullable(),
  IS_IN_NETWORK: z.boolean(),
  PROPERTY_STATE: z.string().nullable(),
  NEW_BILL_CONNECTIONS: z.coerce.number(),
  HUBSPOT_DEAL_TOTAL_COMPANY_UNITS: z.coerce.number().nullable(),
  // Internal Flex sales/CS team assignment (Flask: app.py "segment_team", used as the mode
  // across a PMC's rows to detect SMB-managed accounts) — NOT a HubSpot company-segment field.
  SEGMENT_TEAM: z.string().nullable(),
  // Whether the marketing integration is technically wired up — a DIFFERENT flag from actual
  // opt-in (below). Kept for whatever else already reads it (e.g. the D2C-split unit count
  // further down this file); NOT the badge driver — see IS_MARKETING_OPT_IN.
  HAS_MARKETING_INTEGRATION: z.boolean().nullable(),
  // Direct-to-resident marketing opt-in (Flask: is_marketing_opt_in) — the actual driver of the
  // "Direct Marketing on/off" badge and D2C tiebreaker on the Property Deep Dive slides. Kevin's
  // catch: this file previously read HAS_MARKETING_INTEGRATION for that badge instead, a
  // genuinely different per-property flag (integration wired up ≠ opted in to direct
  // marketing), which produced a scattered, per-property mismatch against Flask's badges.
  IS_MARKETING_OPT_IN: z.boolean().nullable(),
});

// Partner-relevant deactivation reasons (Flask: PARTNER_DEACTIVATION_REASONS, generator/data.py:3860)
// — internal ops codes are excluded entirely (not in this map, filtered out at the query's
// WHERE clause). Human-friendly labels for the "No Longer Active" section.
const DEACTIVATION_LABELS: Record<string, string> = {
  CHURN_PARTNER_PROCESS: "Churned — misalignment with Flex",
  CHURN_PRODUCT: "Churned — product dissatisfaction",
  PARTNER_VOLUNTARY_CHURN: "Churned",
  FAILED_TO_ACTIVATE: "Failed to activate",
  PMC_TO_PMC_TRANSFER: "Transferred to new management",
  PARTNER_INITIATED_LOSS_OF_API_ACCESS: "API access revoked — needs investigation",
};

// --- Helpers ---

function htmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function monthLabel(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function monthOnly(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
}

// Snowflake's PMC_NAME sometimes carries a "(FKA <old name>)" suffix for continuity after a
// rename/acquisition (e.g. "AG Living (FKA Ashland Greene Capital Partners)"). Useful in a
// system-of-record, but reads as clutter on every slide title across QBR/Expansion/New Logo —
// strip it for display everywhere the PMC name is shown, while leaving the raw pmc_name
// variable itself untouched everywhere it's used as a query parameter.
function stripFkaSuffix(name: string): string {
  return name.replace(/\s*\(\s*FKA\b[^)]*\)\s*$/i, "").trim();
}

function yearOnly(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { year: "numeric", timeZone: "UTC" });
}

function _e(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtPct(value: number): string {
  const s = (value * 100).toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) + "%" : s + "%";
}

// Resident/household terminology toggle (Kevin's ask, 2026-08-19) — applied once to a fully-
// assembled HTML document (deck or speaker notes), not threaded through every render
// function. Ports Flask's app.py:_apply_terminology (recently made bidirectional there too).
// Safe as a whole-word substitution: every "resident"-containing identifier/dict-key in this
// codebase either never appears as literal text in rendered output, or is a compound
// identifier with no word boundary at "resident(s)" (e.g. residentsAlign), so \b skips it.
const TERM_MAP: Record<string, string> = {
  Residents: "Households", residents: "households",
  Resident: "Household", resident: "household",
  RESIDENTS: "HOUSEHOLDS", RESIDENT: "HOUSEHOLD",
};
const TERM_MAP_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(TERM_MAP).map(([k, v]) => [v, k])
);

function applyTerminology(html: string, terminology: string | undefined): string {
  const mapping = terminology === "household" ? TERM_MAP : TERM_MAP_REVERSE;
  let out = html;
  for (const [src, dst] of Object.entries(mapping)) {
    out = out.replace(new RegExp(`\\b${src}\\b`, "g"), dst);
  }
  return out;
}

function fmtCurrency(v: number): string {
  if (v >= 1_000_000) {
    let s = (v / 1_000_000).toFixed(2).replace(/0+$/, "");
    if (s.endsWith(".")) s += "0";
    return `$${s}M`;
  }
  if (v >= 1_000) {
    const k = Math.round(v / 1_000);
    if (k >= 1000) return "$1.0M";
    return `$${k}K`;
  }
  return `$${Math.round(v).toLocaleString()}`;
}

function rentWindowLabel(opts: { partnerSince: string | null; lookbackMonths: number; coversFullTenure: boolean }): string {
  if (opts.coversFullTenure && opts.partnerSince) {
    return `since ${monthLabel(opts.partnerSince)}`;
  }
  return `last ${opts.lookbackMonths} months`;
}

function sparklineSvg(values: (number | null)[], color = "#6A3DB8", w = 64, h = 20): string {
  const vals = values.filter((v): v is number => v !== null);
  if (vals.length < 2) return "";
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);
  const rng = mx > mn ? mx - mn : 0.001;
  const n = vals.length;
  const pts = vals
    .map((v, i) => `${(i * w / (n - 1)).toFixed(1)},${(h - 2 - ((v - mn) / rng) * (h - 4)).toFixed(1)}`)
    .join(" ");
  const lx = w;
  const ly = (h - 2 - ((vals[vals.length - 1] - mn) / rng) * (h - 4)).toFixed(1);
  return (
    `<svg width="${w}" height="${h}" style="overflow:visible;display:block;">` +
    `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="${lx}" cy="${ly}" r="2.5" fill="${color}"/>` +
    `</svg>`
  );
}

// --- HTML Slide Renderers ---

function renderCover(kpis: { pmcName: string; reportingMonth: string; partnerSince: string | null; propertyCount: number; firstMonth: string | null; isExpansion?: boolean }): string {
  // Reporting Period tile - was entirely missing (Flask's render_cover has a 3rd tile here:
  // generator/slides.py:91-92, period_range = first_month label - reporting_month label).
  // firstMonth is the earliest month in this report's own lookback window (monthlyTotals[0]),
  // same source Flask uses (kpis["first_month"] = monthly["bp_month"].iloc[0]) - not the
  // lifetime/since-inception window, which is a different, unbounded query (Kevin's catch).
  const periodRange = kpis.firstMonth
    ? `${monthLabel(kpis.firstMonth)} – ${monthLabel(kpis.reportingMonth)}`
    : monthLabel(kpis.reportingMonth);
  // Deck label / props label vary by mode (Flask render_cover, generator/slides.py:53-67).
  // Only branching on is_expansion here (Kevin's catch) — Flask's third branch, is_pitch_mode
  // ("Flex Integration Opportunity" / OON-specific props label), belongs to a genuinely
  // different deck (Flask's separate pitch_mode/PITCH_SLIDE_ORDER flow) with no Superblocks
  // equivalent wired through this function yet — left as the existing default, not touched here.
  const deckLabel = kpis.isExpansion ? "Portfolio Expansion Opportunity" : "Flex Performance Review";
  const propsLabel = kpis.isExpansion ? "Properties on Flex" : "Properties Active";
  // "Reporting Period" reads as QBR/review framing (Kevin's call - this isn't a review, it's
  // an expansion pitch). Relabeled rather than removed on Expansion - the date range itself is
  // still useful context for the performance slides that follow a few pages later; it's the
  // word "Reporting" that fights the tone, not the underlying date range.
  const periodLabel = kpis.isExpansion ? "Track Record" : "Reporting Period";
  return `
  <div class="slide active" id="slide-1" style="background:#2C194D;justify-content:center;align-items:flex-start;">
    <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#DDC6F9;margin-bottom:20px;font-weight:600;font-family:'ABCDiatype',sans-serif;">${deckLabel}</div>
    <div style="font-size:76px;font-weight:500;line-height:1.0;color:#fff;margin-bottom:12px;letter-spacing:-0.02em;font-family:'ABCDiatype',sans-serif;">${kpis.pmcName}</div>
    <div style="font-size:22px;font-weight:400;color:rgba(255,255,255,0.45);margin-bottom:72px;font-family:'ABCDiatype',sans-serif;">${monthLabel(kpis.reportingMonth)}</div>
    <div style="display:flex;gap:52px;">
      <div><div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.28);margin-bottom:6px;font-family:'ABCDiatype',sans-serif;">Partner Since</div>
           <div style="font-size:16px;font-weight:600;color:rgba(255,255,255,0.85);font-family:'ABCDiatype',sans-serif;">${monthLabel(kpis.partnerSince)}</div></div>
      <div><div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.28);margin-bottom:6px;font-family:'ABCDiatype',sans-serif;">${propsLabel}</div>
           <div style="font-size:16px;font-weight:600;color:rgba(255,255,255,0.85);font-family:'ABCDiatype',sans-serif;">${kpis.propertyCount}</div></div>
      <div><div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.28);margin-bottom:6px;font-family:'ABCDiatype',sans-serif;">${periodLabel}</div>
           <div style="font-size:16px;font-weight:600;color:rgba(255,255,255,0.85);font-family:'ABCDiatype',sans-serif;">${periodRange}</div></div>
    </div>
    <div style="position:absolute;right:100px;top:50%;transform:translateY(-50%);width:380px;height:380px;border-radius:50%;background:radial-gradient(circle,rgba(106,61,184,0.22) 0%,transparent 68%);"></div>
    <div style="position:absolute;bottom:60px;right:80px;font-size:28px;font-weight:500;letter-spacing:-0.04em;color:rgba(255,255,255,0.15);font-family:'ABCDiatype',sans-serif;">flex</div>
  </div>`;
}

interface ExecSummaryInput {
  slideId: number;
  pmcName: string;
  reportingMonth: string;
  partnerSince: string | null;
  lookbackMonths: number;
  targetNar: number;
  currentNar: number;
  currentResidents: number;
  currentRent: number;
  currentNewSignups: number;
  lifetimeRent: number;
  propertyCount: number;
  totalUnits: number;
  prevNar: number | null;
  prevResidents: number | null;
  prevRent: number | null;
  prevNewSignups: number | null;
  prevPropertyCount: number | null;
  prevUnits: number | null;
  monthlyTotals: { month: string; billsPaid: number; units: number; rentPaid: number; newSignups: number; adoptionRate: number; establishedNar?: number | null }[];
  trueRepeatRate: number | null;
  lifetimeDqShielded: number | null;
  dqSinceComparison: number | null;
  execNotes?: string;
  showSparklines?: boolean;
  // Kevin's ask: an explicit form-level control over the exec tile's period-comparison pills
  // (rent %, DQ $, etc. - anything using the shared "_vs" delta pill builder below), independent
  // of showSparklines. The live in-deck toggle button (deltaToggle below) already lets an AE
  // flip this DURING a meeting; this just sets which state it STARTS in when the deck is
  // generated, same relationship showSparklines already has to the individual sparkline
  // toggle buttons.
  hidePeriodComparison?: boolean;
  vsLabel?: string;
  // Keys: active_properties, residents_paying, new_residents, adoption_rate, true_repeat_rate,
  // delinquency_shielded. Chosen at generation time (Kevin's ask) - see hidden_kpi_tiles on the
  // top-level input schema for why this isn't a live post-generation toggle.
  hiddenTiles?: string[];
}

function renderExecSummary(d: ExecSummaryInput): { html: string; js: string } {
  const slideId = d.slideId;
  const pmc = _e(d.pmcName);
  const reportingMonth = monthLabel(d.reportingMonth);
  const nar = d.currentNar;

  // Partner since label
  let sinceLbl = "launch";
  if (d.partnerSince) {
    try {
      const dt = new Date(d.partnerSince + "T00:00:00Z");
      sinceLbl = dt.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
    } catch { sinceLbl = d.partnerSince.slice(0, 7); }
  }

  // ── Delta pill builder (exec-delta class for toggle) ──────────────────────
  const _vs = d.vsLabel ?? "vs last month";
  function pill(cur: number, prev: number | null, fmt: "abs" | "pct" | "pp" | "currency"): string {
    if (prev === null || prev === 0) return "";
    const delta = cur - prev;
    if (Math.abs(delta) < 0.001 && fmt === "pp") return "";
    if (Math.abs(delta) < 1 && fmt !== "pp" && fmt !== "pct") return "";
    const pct = (delta / prev) * 100;
    const isUp = delta > 0;
    // Format the text first so we can detect rounded-to-zero
    let txt: string;
    if (fmt === "pct") txt = `${Math.abs(pct).toFixed(1)}%`;
    else if (fmt === "pp") txt = `${(Math.abs(delta) * 100).toFixed(1)}pp`;
    else if (fmt === "currency") txt = fmtCurrency(Math.abs(delta));
    else txt = Math.abs(Math.round(delta)).toLocaleString();
    // "No change" handling: if the formatted text would display as 0, show grey "No change" instead
    if (/^0(\.0+)?(pp|%|)$/.test(txt)) {
      const lbl = fmt === "pp" ? "adoption" : fmt === "pct" ? "change" : "";
      return `<div class="exec-delta" style="display:inline-block;background:rgba(156,163,175,0.10);color:#9ca3af;font-size:10px;font-weight:600;border-radius:5px;padding:2px 7px;margin-top:8px;">No change${lbl ? " " + lbl : ""} ${_vs}</div>`;
    }
    const bg = isUp ? "rgba(26,158,106,0.11)" : "rgba(220,80,80,0.09)";
    const col = isUp ? "#1a9e6a" : "#dc5050";
    const sign = isUp ? "+" : "\u2212";
    return `<div class="exec-delta" style="display:inline-block;background:${bg};color:${col};font-size:10px;font-weight:600;border-radius:5px;padding:2px 7px;margin-top:8px;">${sign}${txt} ${_vs}</div>`;
  }

  // ── Sparkline builder ─────────────────────────────────────────────────────
  const tail12 = d.monthlyTotals.slice(-12);
  function sparkSvg(values: number[], width = 72, height = 22): string {
    const valid = values.filter((v) => v > 0);
    if (valid.length < 3) return "";
    const mn = Math.min(...values);
    const mx = Math.max(...values);
    const rng = mx - mn || 1;
    const trend = values[values.length - 1] - values[0];
    const color = trend > rng * 0.05 ? "#1a9e6a" : trend < -rng * 0.05 ? "#dc5050" : "#9ca3af";
    const pts = values.map((v, i) => {
      const x = (i / (values.length - 1)) * (width - 4) + 2;
      const y = (height - 4) - ((v - mn) / rng) * (height - 4) + 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" L ");
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" style="display:block;margin-top:8px;opacity:0.7;"><path d="M ${pts}" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  const showSparks = d.showSparklines !== false;
  const narSparkVals = tail12.map((m) => m.adoptionRate);
  const residentsSparkVals = tail12.map((m) => m.billsPaid);
  const signupsSparkVals = tail12.map((m) => m.newSignups);
  const narSparkRaw = showSparks ? sparkSvg(narSparkVals) : "";
  const residentsSparkRaw = showSparks ? sparkSvg(residentsSparkVals) : "";
  const signupsSparkRaw = showSparks ? sparkSvg(signupsSparkVals) : "";
  // Wrap in identifiable divs so toggle buttons can show/hide them
  const narSparkHtml = narSparkRaw ? `<div id="sp_nar_${slideId}">${narSparkRaw}</div>` : "";
  const residentsSparkHtml = residentsSparkRaw ? `<div id="sp_res_${slideId}">${residentsSparkRaw}</div>` : "";
  const signupsSparkHtml = signupsSparkRaw ? `<div id="ss_${slideId}">${signupsSparkRaw}</div>` : "";

  // ── Monthly rent for hero sparkline ────────────────────────────────────────
  const monthlyRentVals = tail12.map((m) => m.rentPaid);

  // Hero sparkline: Flask's real version (render_expansion_bottom_line, generator/slides.py:
  // ~7750-7767, ~7967-7993) is a CUMULATIVE running sum of monthly rent — deliberately always
  // rising, drawn as a filled area, purely visual ("visualises growth story," not meant to show
  // month-to-month movement). A prior pass here swapped this for the raw monthly series
  // assuming the ramp shape was a bug; it isn't — confirmed against Kevin's reference screenshot.
  function heroSparkSvg(values: number[], width = 200, height = 40): string {
    if (values.filter((v) => v > 0).length < 3) return "";
    let running = 0;
    const cumulative = values.map((v) => (running += v));
    const mn = Math.min(...cumulative);
    const mx = Math.max(...cumulative);
    const rng = mx - mn || 1;
    const pad = 2;
    const pts = cumulative.map((v, i) => {
      const x = (i / (cumulative.length - 1)) * (width - pad * 2) + pad;
      const y = (height - pad * 2) - ((v - mn) / rng) * (height - pad * 2) + pad;
      return { x, y };
    });
    const lineD = "M " + pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L ");
    const areaD = `${lineD} L ${pts[pts.length - 1].x.toFixed(1)},${height} L ${pts[0].x.toFixed(1)},${height} Z`;
    // width="100%" + preserveAspectRatio="none" so the line stretches to fill the hero card
    // regardless of its actual rendered width — a fixed pixel width left the line stopping
    // partway across the tile instead of spanning it.
    return `<svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" fill="none" style="display:block;">`
      + `<path d="${areaD}" fill="rgba(255,255,255,0.06)" stroke="none"/>`
      + `<path d="${lineD}" stroke="rgba(255,255,255,0.55)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
      + `</svg>`;
  }
  const heroSparkSvgHtml = heroSparkSvg(monthlyRentVals);

  // ── Monthly rent sparkline (small white line in hero bottom) ──────────────
  const moRentSparkRaw = showSparks ? sparkSvg(monthlyRentVals, 100, 36).replace(/#1a9e6a|#dc5050|#9ca3af/g, "rgba(255,255,255,0.6)") : "";
  const moRentSparkSvg = moRentSparkRaw ? `<div id="sp_mo_${slideId}">${moRentSparkRaw}</div>` : "";

  // ── Hero rent pill (white-on-dark) ────────────────────────────────────────
  let heroPill = "";
  if (d.prevRent !== null && d.prevRent > 0) {
    const delta = d.currentRent - d.prevRent;
    const pctDelta = (delta / d.prevRent) * 100;
    const sign = delta >= 0 ? "+" : "\u2212";
    const col = delta >= 0 ? "#6dffca" : "#ffaaaa";
    heroPill = `<div class="exec-delta" style="display:inline-block;background:rgba(255,255,255,0.12);color:${col};font-size:10px;font-weight:700;border-radius:6px;padding:3px 9px;margin-top:8px;">${sign}${Math.abs(pctDelta).toFixed(1)}% ${_vs}</div>`;
  }

  // ── Avg rent per household ────────────────────────────────────────────────
  const avgPayment = d.currentResidents > 0 ? Math.round(d.currentRent / d.currentResidents) : 0;

  // ── Retention metric ──────────────────────────────────────────────────────
  let retentionVal = "\u2014";
  let retentionSub = "";
  if (d.trueRepeatRate !== null) {
    retentionVal = fmtPct(d.trueRepeatRate);
    retentionSub = "of eligible residents came back";
  } else if (d.prevResidents !== null && d.prevResidents > 0) {
    const momRet = (d.currentResidents - d.currentNewSignups) / d.prevResidents;
    retentionVal = fmtPct(Math.max(0, Math.min(momRet, 1)));
    retentionSub = "users who paid again this month";
  }

  // ── Rent window label ─────────────────────────────────────────────────────
  // coversFullTenure = true ONLY when the partner's actual tenure is ≤ lookback window
  // For mature partners (e.g. since 2021 with lookback=12), show "last 12 months" not "since 2021"
  const tenureMonths = d.partnerSince
    ? Math.round((new Date(d.reportingMonth + "T00:00:00Z").getTime() - new Date(d.partnerSince + "T00:00:00Z").getTime()) / (30.44 * 24 * 60 * 60 * 1000))
    : 999;
  const rwl = rentWindowLabel({ partnerSince: d.partnerSince, lookbackMonths: d.lookbackMonths, coversFullTenure: tenureMonths <= d.lookbackMonths && !!d.partnerSince });

  // ── DQ shielded ───────────────────────────────────────────────────────────
  const dqVal = d.lifetimeDqShielded != null && d.lifetimeDqShielded > 0 ? fmtCurrency(d.lifetimeDqShielded) : "\u2014";
  // Window now tracks the report's own period (Full/Quarter/YTD via lookbackMonths) instead of
  // a fixed 13 months — caption names the real window so it's never ambiguous (Kevin's catch).
  const dqSub = d.lifetimeDqShielded != null && d.lifetimeDqShielded > 0
    ? `rent covered when residents missed — trailing ${d.lookbackMonths} month${d.lookbackMonths === 1 ? "" : "s"}`
    : "";
  // DQ since-comparison pill — always green/positive framing
  let dqPill = "";
  if (d.dqSinceComparison != null && d.dqSinceComparison > 0) {
    dqPill = `<div class="exec-delta" style="display:inline-block;background:rgba(26,158,106,0.11);color:#1a9e6a;font-size:10px;font-weight:700;border-radius:6px;padding:3px 9px;margin-top:6px;">+${fmtCurrency(d.dqSinceComparison)} ${_vs}</div>`;
  }

  // ── New signups QTD sub-label ─────────────────────────────────────────────
  const last3 = d.monthlyTotals.slice(-3);
  const qtdSignups = last3.reduce((s, m) => s + m.newSignups, 0);
  const signupsSub = qtdSignups > 0 ? `${qtdSignups.toLocaleString()} last 3 months` : "first-time Flex payments this month";

  // ── SVG icons for tiles ────────────────────────────────────────────────────
  const svgBldg = '<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="2" y="4" width="7" height="8.5" rx="0.8" stroke="#6A3DB8" stroke-width="1.3"/><path d="M9 7h2.5v5.5H9" stroke="#6A3DB8" stroke-width="1.3" stroke-linejoin="round"/><path d="M4.5 7v0M6.5 7v0M4.5 9.5v0M6.5 9.5v0" stroke="#6A3DB8" stroke-width="1.5" stroke-linecap="round"/></svg>';
  const svgPerson = '<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="4.5" r="2.5" stroke="#6A3DB8" stroke-width="1.3"/><path d="M2 12.5c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="#6A3DB8" stroke-width="1.3" stroke-linecap="round"/></svg>';
  const svgNewP = '<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="5.5" cy="4.5" r="2.3" stroke="#6A3DB8" stroke-width="1.3"/><path d="M1 12.5c0-2.5 2-4.5 4.5-4.5" stroke="#6A3DB8" stroke-width="1.3" stroke-linecap="round"/><path d="M10.5 8.5v4M8.5 10.5h4" stroke="#6A3DB8" stroke-width="1.5" stroke-linecap="round"/></svg>';
  const svgPct = '<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="4" cy="4" r="1.8" stroke="#6A3DB8" stroke-width="1.3"/><circle cx="10" cy="10" r="1.8" stroke="#6A3DB8" stroke-width="1.3"/><path d="M11 3L3 11" stroke="#6A3DB8" stroke-width="1.3" stroke-linecap="round"/></svg>';
  const svgRepeat = '<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M3 5a4 4 0 0 1 6.5-1.5L11 5" stroke="#6A3DB8" stroke-width="1.3" stroke-linecap="round"/><path d="M11 3v2H9" stroke="#6A3DB8" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 9a4 4 0 0 1-6.5 1.5L3 9" stroke="#6A3DB8" stroke-width="1.3" stroke-linecap="round"/><path d="M3 11V9h2" stroke="#6A3DB8" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const svgShield = '<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 1.5L2 3.5v4c0 2.5 2 4.5 5 5 3-0.5 5-2.5 5-5v-4L7 1.5z" stroke="#6A3DB8" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  const svgCoinsW = '<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="5" cy="5" r="3.5" stroke="rgba(255,255,255,0.6)" stroke-width="1.3"/><circle cx="9" cy="9" r="3.5" stroke="rgba(255,255,255,0.6)" stroke-width="1.3"/></svg>';

  function iconCircle(svg: string, dark = false): string {
    const bg = dark ? "rgba(255,255,255,0.12)" : "rgba(106,61,184,0.09)";
    return `<div style="width:22px;height:22px;border-radius:50%;background:${bg};display:flex;align-items:center;justify-content:center;flex-shrink:0;">${svg}</div>`;
  }

  // ── Small tile helper ─────────────────────────────────────────────────────
  function tile(label: string, value: string, sublabel: string, pillHtml: string, sparkHtml = "", icon = ""): string {
    const labelRow = icon
      ? `<div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">${iconCircle(icon)}<div style="font-size:13px;color:#2d2550;font-weight:700;">${label}</div></div>`
      : `<div style="font-size:13px;color:#2d2550;font-weight:700;margin-bottom:10px;">${label}</div>`;
    return `<div style="padding:18px 18px 16px;border-radius:10px;background:#f8f7ff;display:flex;flex-direction:column;">
      ${labelRow}
      <div style="flex:1;display:flex;flex-direction:column;justify-content:center;">
        <div style="font-size:34px;font-weight:700;color:#1a1040;letter-spacing:-0.03em;line-height:1;">${value}</div>
        ${pillHtml}${sparkHtml}${sublabel ? `<div style="font-size:11px;color:#6b7280;font-weight:500;margin-top:6px;">${sublabel}</div>` : ""}
      </div>
    </div>`;
  }

  const hiddenTileSet = new Set(d.hiddenTiles ?? []);
  // Column count that avoids stranding a lonely single tile in its own row (Kevin's ask) -
  // the grid used to be a fixed 3 columns, which left a 3-then-1 split whenever exactly 4
  // tiles were visible (e.g. 2 hidden via hiddenTileSet above). Mirrors Flask's
  // render_expansion_bottom_line - same mapping, same reasoning.
  const ALL_TILE_KEYS = ["active_properties", "residents_paying", "new_residents",
    "adoption_rate", "true_repeat_rate", "delinquency_shielded"];
  const visibleTileCount = ALL_TILE_KEYS.filter((k) => !hiddenTileSet.has(k)).length;
  const TILE_COLS_BY_VISIBLE_COUNT: Record<number, number> = { 0: 1, 1: 1, 2: 2, 3: 3, 4: 2, 5: 3, 6: 3 };
  const tileCols = TILE_COLS_BY_VISIBLE_COUNT[visibleTileCount] ?? 3;

  // ── Delta toggle check ────────────────────────────────────────────────────
  const pillProps = pill(d.propertyCount, d.prevPropertyCount, "abs");
  const pillResidents = pill(d.currentResidents, d.prevResidents, "abs");
  const pillNar = pill(nar, d.prevNar, "pp");
  const anyDelta = !!(pillProps || pillResidents || pillNar || heroPill);

  // Starts hidden when the form-level toggle forces it (Kevin's ask) - the button and its
  // onclick logic are otherwise unchanged, so the live in-deck override still works exactly the
  // same either way, just flipped from its new starting point.
  const startDeltasHidden = anyDelta && d.hidePeriodComparison === true;
  const deltaToggle = anyDelta
    ? `<button class="presenter-control" onclick="var s=document.getElementById('slide-${slideId}');s.classList.toggle('hide-deltas');this.textContent=s.classList.contains('hide-deltas')?'Show change ${_vs}':'Hide change ${_vs}';" style="padding:4px 10px;border-radius:5px;border:1px solid #e5e7eb;background:#fff;color:#6b7280;font-size:10px;font-weight:600;cursor:pointer;letter-spacing:0.04em;font-family:'Lexend',sans-serif;">${startDeltasHidden ? `Show change ${_vs}` : `Hide change ${_vs}`}</button>`
    : "";

  // ── Sparkline toggle controls ──────────────────────────────────────────────
  const sparkCtrlBtns: string[] = [];
  if (showSparks) {
    if (narSparkRaw) sparkCtrlBtns.push(`<button class="spark-ctrl-btn" onclick="flexToggleSpark('sp_nar_${slideId}',this)">NAR trend</button>`);
    if (residentsSparkRaw) sparkCtrlBtns.push(`<button class="spark-ctrl-btn" onclick="flexToggleSpark('sp_res_${slideId}',this)">Resident trend</button>`);
    if (signupsSparkRaw) sparkCtrlBtns.push(`<button class="spark-ctrl-btn" onclick="flexToggleSpark('ss_${slideId}',this)">New residents trend</button>`);
    if (moRentSparkRaw) sparkCtrlBtns.push(`<button class="spark-ctrl-btn" onclick="flexToggleSpark('sp_mo_${slideId}',this)">Monthly rent trend</button>`);
  }
  const sparkCtrlHtml = sparkCtrlBtns.length > 0
    ? `<div class="spark-ctrl presenter-control">${sparkCtrlBtns.join("")}</div>`
    : "";

  const html = `
  <div class="slide${startDeltasHidden ? " hide-deltas" : ""}" id="slide-${slideId}" style="background:#fff;flex-direction:column;padding:44px 56px 36px;overflow:hidden;">
    <style>#slide-${slideId}.hide-deltas .exec-delta { display: none !important; }</style>
    <div style="flex-shrink:0;margin-bottom:24px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
        <div class="slide-label" style="margin-bottom:10px;">EXECUTIVE SUMMARY</div>
        ${deltaToggle}
      </div>
      <div class="slide-title" style="margin-bottom:6px;">What we've built together.</div>
      <div style="font-size:12px;color:#6b7280;">${pmc} &middot; ${reportingMonth} &nbsp;&middot;&nbsp; Partner since ${_e(sinceLbl)}</div>
    </div>
    <div style="flex:1;display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:16px;min-height:0;">
      <!-- Hero: Rent Guaranteed -->
      <div style="background:#2C194D;border-radius:12px;padding:26px 24px;display:flex;flex-direction:column;min-height:0;overflow:hidden;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
        ${iconCircle(svgCoinsW, true)}
        <span style="font-size:13px;color:rgba(255,255,255,0.75);font-weight:700;">Rent guaranteed</span>
      </div>
        <div style="font-size:46px;font-weight:700;color:#fff;letter-spacing:-0.03em;line-height:1;">${fmtCurrency(d.lifetimeRent)}</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.55);font-weight:500;margin-top:5px;">${rwl.toLowerCase()}</div>
        <div style="flex:1;min-height:40px;display:flex;align-items:flex-end;margin:12px 0 4px;">${heroSparkSvgHtml}</div>
        <div style="border-top:1px solid rgba(255,255,255,0.10);padding-top:14px;">
          <div style="font-size:13px;color:rgba(255,255,255,0.75);font-weight:700;margin-bottom:5px;">Rent guaranteed this month</div>
          <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:8px;">
            <div>
              <div style="font-size:28px;font-weight:700;color:#fff;letter-spacing:-0.02em;">${fmtCurrency(d.currentRent)}</div>
              ${heroPill}
              ${avgPayment > 0 ? `<div style="font-size:11px;color:rgba(255,255,255,0.40);margin-top:5px;">avg $${avgPayment.toLocaleString()}/resident</div>` : ""}
            </div>
            ${moRentSparkSvg ? `<div style="flex-shrink:0;">${moRentSparkSvg}</div>` : ""}
          </div>
        </div>
      </div>
      <!-- 6 Metric Tiles (3-wide grid, rows auto-size to however many remain after hiding) -->
      <div style="display:grid;grid-template-columns:repeat(${tileCols},1fr);grid-auto-rows:1fr;gap:12px;">
        ${hiddenTileSet.has("active_properties") ? "" : tile("Active properties", d.propertyCount.toLocaleString(), "", pillProps, "", svgBldg)}
        ${hiddenTileSet.has("residents_paying") ? "" : tile("Residents paying", d.currentResidents.toLocaleString(), "", pillResidents, residentsSparkHtml, svgPerson)}
        ${hiddenTileSet.has("new_residents") ? "" : tile("New residents paying this month", d.currentNewSignups.toLocaleString(), signupsSub, "", signupsSparkHtml, svgNewP)}
        ${hiddenTileSet.has("adoption_rate") ? "" : tile("Adoption rate", fmtPct(nar), "", pillNar, narSparkHtml, svgPct)}
        ${hiddenTileSet.has("true_repeat_rate") ? "" : tile("True repeat rate", retentionVal, retentionSub, "", "", svgRepeat)}
        ${hiddenTileSet.has("delinquency_shielded") ? "" : tile("Delinquency shielded", dqVal, dqSub, dqPill, "", svgShield)}
      </div>
    </div>
    ${sparkCtrlHtml}
  </div>`;

  // flexToggleSpark JS — shared utility, only define once
  const sparkJs = sparkCtrlBtns.length > 0
    ? `if(!window.flexToggleSpark){window.flexToggleSpark=function(id,btn){var el=document.getElementById(id);if(!el)return;var h=el.style.display==="none";el.style.display=h?"":"none";btn.classList.toggle("is-hidden",!h);};}`
    : "";

  return { html, js: sparkJs };
}



interface CohortRow {
  rolloutMonth: string;
  propertyCount: number;
  totalUnits: number;
  currentResidents: number;
  currentRent: number;
  cumulativeRent: number;
  cohortNar: number;
}

interface CohortOverviewInput {
  cohorts: CohortRow[];
  reportingMonth: string;
  cohortMonthly: Map<string, (number | null)[]>; // rolloutMonth → array of monthly NAR values
  presentingMode?: boolean;
}

function renderCohortAnalysis(input: CohortOverviewInput & { slideId: number }): string {
  const { cohorts, reportingMonth, cohortMonthly, slideId, presentingMode } = input;
  const totalCohorts = cohorts.length;
  const MAX_COHORTS = presentingMode ? Infinity : 6;
  const display = cohorts.slice(-MAX_COHORTS);
  const hiddenCohorts = Math.max(0, totalCohorts - MAX_COHORTS);

  let rows = "";
  let anySpark = false;

  for (const c of display) {
    // Compute months active
    let monthsActive: number | null = null;
    if (reportingMonth && c.rolloutMonth) {
      try {
        const rmYear = parseInt(reportingMonth.slice(0, 4));
        const rmMon = parseInt(reportingMonth.slice(5, 7));
        const coYear = parseInt(c.rolloutMonth.slice(0, 4));
        const coMon = parseInt(c.rolloutMonth.slice(5, 7));
        monthsActive = (rmYear - coYear) * 12 + (rmMon - coMon);
        if (monthsActive < 0) monthsActive = 0;
      } catch {
        monthsActive = null;
      }
    }

    let ageLabel = "";
    if (monthsActive !== null) {
      const monthNum = monthsActive + 1;
      ageLabel = monthsActive <= 3
        ? `Month ${monthNum} - Ramping`
        : `${monthNum} months active`;
    }
    const ageTag = ageLabel
      ? `<div style="font-size:9px;color:#a09cb0;margin-top:1px;">${ageLabel}</div>`
      : "";

    // Sparkline for this cohort's NAR trend
    const sparkVals = cohortMonthly.get(c.rolloutMonth) || [];
    const validSpark = sparkVals.filter((v): v is number => v !== null);
    let sparkColor = "#a09cb0";
    if (validSpark.length >= 2) {
      sparkColor = validSpark[validSpark.length - 1] > validSpark[0] ? "#1a9e6a" : "#dc5050";
    }
    const sparkHtml = sparklineSvg(sparkVals, sparkColor);
    anySpark = anySpark || sparkHtml !== "";
    const sparkCell = sparkHtml
      ? `<div class="cohort-trend-col" style="display:flex;flex-direction:column;justify-content:center;">` +
        `<div style="font-size:9px;text-transform:uppercase;letter-spacing:0.07em;color:#a09cb0;margin-bottom:4px;">Trend</div>` +
        sparkHtml +
        `</div>`
      : `<div class="cohort-trend-col"></div>`;

    const avgRent = c.currentResidents > 0 ? c.currentRent / c.currentResidents : 0;

    rows += `
        <div style="display:grid;grid-template-columns:1.8fr 0.6fr 1.0fr 1.0fr 1.0fr 1.1fr 1.0fr 0.9fr;gap:10px;align-items:center;
                    padding:14px 20px;background:#f7f7f7;border-radius:8px;border:1px solid #eceaf2;">
          <div>
            <div style="font-size:13px;font-weight:600;white-space:nowrap;">${monthLabel(c.rolloutMonth)} Cohort</div>
            ${ageTag}
          </div>
          <div><div style="font-size:9px;text-transform:uppercase;letter-spacing:0.07em;color:#a09cb0;">Active</div>
               <div style="font-size:17px;font-weight:700;color:#1d1d1d;">${c.propertyCount}</div></div>
          <div><div style="font-size:9px;text-transform:uppercase;letter-spacing:0.07em;color:#a09cb0;">Total Units</div>
               <div style="font-size:17px;font-weight:700;color:#1d1d1d;">${c.totalUnits.toLocaleString()}</div></div>
          <div><div style="font-size:9px;text-transform:uppercase;letter-spacing:0.07em;color:#a09cb0;">Residents Paying</div>
               <div style="font-size:17px;font-weight:700;color:#1d1d1d;">${c.currentResidents.toLocaleString()}</div></div>
          <div><div style="font-size:9px;text-transform:uppercase;letter-spacing:0.07em;color:#a09cb0;">Avg Rent</div>
               <div style="font-size:17px;font-weight:700;color:#1d1d1d;">$${Math.round(avgRent).toLocaleString()}</div></div>
          <div><div style="font-size:9px;text-transform:uppercase;letter-spacing:0.07em;color:#a09cb0;">Total Rent Paid</div>
               <div style="font-size:17px;font-weight:700;color:#6A3DB8;">${fmtCurrency(c.cumulativeRent)}</div></div>
          <div><div style="font-size:9px;text-transform:uppercase;letter-spacing:0.07em;color:#a09cb0;">Adoption Rate</div>
               <div style="font-size:17px;font-weight:700;color:#1d1d1d;">${fmtPct(c.cohortNar)}</div></div>
          ${sparkCell}
        </div>`;
  }

  const overflowNote = hiddenCohorts > 0
    ? `<div style="font-size:10px;color:#a09cb0;margin-top:6px;flex-shrink:0;">` +
      `Showing the ${MAX_COHORTS} most recent cohorts &middot; ${hiddenCohorts} older cohort${hiddenCohorts !== 1 ? "s" : ""} not shown - see full cohort table in the workbook</div>`
    : "";

  // Totals bar
  const totalActiveProps = cohorts.reduce((s, c) => s + c.propertyCount, 0);
  const totalUnitsSum = cohorts.reduce((s, c) => s + c.totalUnits, 0);
  const totalResidents = cohorts.reduce((s, c) => s + c.currentResidents, 0);
  const overallNar = totalUnitsSum > 0 ? totalResidents / totalUnitsSum : 0;

  const totalsBar = `
    <div style="display:flex;gap:12px;margin-bottom:12px;">
      <div style="background:#f7f7f7;border:1px solid #eceaf2;border-radius:8px;padding:8px 16px;flex:1;text-align:center;">
        <div style="font-size:10px;color:#a09cb0;text-transform:uppercase;letter-spacing:0.08em;">Total Cohorts</div>
        <div style="font-size:18px;font-weight:700;color:#1d1d1d;">${totalCohorts}</div>
      </div>
      <div style="background:#f7f7f7;border:1px solid #eceaf2;border-radius:8px;padding:8px 16px;flex:1;text-align:center;">
        <div style="font-size:10px;color:#a09cb0;text-transform:uppercase;letter-spacing:0.08em;">Active Properties</div>
        <div style="font-size:18px;font-weight:700;color:#1d1d1d;">${totalActiveProps.toLocaleString()}</div>
      </div>
      <div style="background:#f7f7f7;border:1px solid #eceaf2;border-radius:8px;padding:8px 16px;flex:1;text-align:center;">
        <div style="font-size:10px;color:#a09cb0;text-transform:uppercase;letter-spacing:0.08em;">Total Units</div>
        <div style="font-size:18px;font-weight:700;color:#1d1d1d;">${totalUnitsSum.toLocaleString()}</div>
      </div>
      <div style="background:#f7f7f7;border:1px solid #eceaf2;border-radius:8px;padding:8px 16px;flex:1;text-align:center;">
        <div style="font-size:10px;color:#a09cb0;text-transform:uppercase;letter-spacing:0.08em;">Residents Paying</div>
        <div style="font-size:18px;font-weight:700;color:#1d1d1d;">${totalResidents.toLocaleString()}</div>
      </div>
      <div style="background:#ede9fe;border:1px solid #c4b5fd;border-radius:8px;padding:8px 16px;flex:1;text-align:center;">
        <div style="font-size:10px;color:#6A3DB8;text-transform:uppercase;letter-spacing:0.08em;">Adoption Rate</div>
        <div style="font-size:18px;font-weight:700;color:#6A3DB8;">${fmtPct(overallNar)}</div>
      </div>
    </div>`;

  const trendToggleHtml = anySpark
    ? `<button class="presenter-control" onclick="var s=document.getElementById('slide-${slideId}');` +
      `s.classList.toggle('hide-cohort-trend');` +
      `this.textContent=s.classList.contains('hide-cohort-trend')?'Show adoption trend':'Hide adoption trend';"` +
      ` style="padding:4px 10px;border-radius:5px;border:1px solid #e5e7eb;background:#fff;` +
      `color:#524e5b;font-size:10px;font-weight:600;cursor:pointer;font-family:'ABCDiatype',sans-serif;` +
      `letter-spacing:0.04em;">Hide adoption trend</button>`
    : "";

  return `
  <div class="slide" id="slide-${slideId}" style="background:#fff;justify-content:flex-start;">
    <style>#slide-${slideId}.hide-cohort-trend .cohort-trend-col { display: none !important; }</style>
    <div class="slide-header" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
      <div>
        <div class="slide-label">Launch Cohorts</div>
        <div class="slide-title">Performance by Rollout Month</div>
      </div>
      ${trendToggleHtml}
    </div>
    ${totalsBar}
    <div style="flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding-right:4px;">
      ${rows}
    </div>
    ${overflowNote}
  </div>`;
}

interface ProjectionInput {
  currentResidents: number;
  currentRent: number;
  currentNar: number;
  totalUnits: number;
  monthlyTotals: { month: string; adoptionRate: number; propertyCount?: number }[];
  pmcName: string;
  showProjection?: boolean;
  slideId?: number;
  peerPercentiles?: { p25: number; p50: number; p75: number; p90: number; p99: number };
}

function renderPortfolioProjection(p: ProjectionInput): { html: string; js: string } {
  const slideId = p.slideId ?? 5;
  const showProjection = p.showProjection !== false;
  const avgRent = p.currentResidents > 0 ? Math.round(p.currentRent / p.currentResidents) : 1365;

  const conservativeNar = p.currentNar;
  let projectedNar = p.currentNar;
  let avgMom = 0;
  let lastMomOutlier = false;
  let projDesc = `If current adoption rate holds at ${fmtPct(p.currentNar)} across all enrolled units`;

  if (p.monthlyTotals.length >= 3) {
    const rates = p.monthlyTotals.map((m) => m.adoptionRate);
    const momChanges = rates.slice(1).map((r, i) => r - rates[i]);
    const sortedChanges = [...momChanges].sort((a, b) => a - b);
    const n = sortedChanges.length;
    const medianMom = n % 2 === 1 ? sortedChanges[Math.floor(n / 2)] : (sortedChanges[Math.floor(n / 2) - 1] + sortedChanges[Math.floor(n / 2)]) / 2;
    avgMom = medianMom;
    projectedNar = Math.min(Math.max(p.currentNar + medianMom * 12, 0.001), 0.80);
    const trendStr = `${medianMom >= 0 ? "+" : ""}${(medianMom * 100).toFixed(2)}pp/mo`;
    projDesc = `Median ${trendStr} adoption trend across ${momChanges.length} months, projected 12-month rate`;

    // Outlier detection
    if (momChanges.length >= 3) {
      const sortedAbsDev = momChanges.map((c) => Math.abs(c - medianMom)).sort((a, b) => a - b);
      const mad = sortedAbsDev[Math.floor(n / 2)];
      const lastChange = momChanges[momChanges.length - 1];
      if (mad > 0 && Math.abs(lastChange - medianMom) > 2 * mad && lastChange < 0) {
        lastMomOutlier = true;
      }
    }
  }

  // Auto-target: next peer-percentile tier up from current NAR
  // Flask rounds to whole percent: "12.1% reads as oddly precise for a directional peer-tier goal"
  let targetNar: number;
  const targetLabel = "Target"; // Never expose which tier (P75/P90) — backend-only logic
  if (p.peerPercentiles) {
    const { p50, p75, p90, p99 } = p.peerPercentiles;
    if (p.currentNar >= p90) {
      targetNar = p99 + 0.02;
    } else if (p.currentNar >= p75) {
      targetNar = p90;
    } else if (p.currentNar >= p50) {
      targetNar = p75;
    } else {
      targetNar = p50;
    }
  } else {
    // Fallback when no peer data available
    targetNar = 0.20;
  }
  // Round to nearest whole percent BEFORE computing any downstream values (households, rent, run-rate)
  targetNar = Math.round(targetNar * 100) / 100;
  if (targetNar <= projectedNar) {
    targetNar = projectedNar + 0.01;
    targetNar = Math.round(targetNar * 100) / 100;
  }

  const projDeclining = projectedNar < p.currentNar - 0.0005;
  const projectedColor = projDeclining ? "#dc2626" : "#6A3DB8";

  const scenarios: [string, number, string, string][] = [
    ["Conservative", conservativeNar, "#d97706",
      `If adoption stays exactly where it is today - your floor with no new resident growth`],
    ["Projected", projectedNar, projectedColor, projDesc],
    [targetLabel, targetNar, "#1a9e6a",
      `Closing to ${fmtPct(targetNar)} means ${Math.round(p.totalUnits * targetNar).toLocaleString()} more active residents - each adds ~$${avgRent >= 1000 ? Math.round(avgRent / 1000) + 'K' : avgRent}/month.`],
  ];

  const pctEnrolled = Math.min(p.totalUnits > 0 ? (p.currentResidents / p.totalUnits) * 100 : 0, 100);
  const untapped = p.totalUnits - p.currentResidents;

  const progressBar = `
    <div style="background:#f7f7f7;border:1px solid #eceaf2;border-radius:12px;padding:10px 16px;margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#524e5b;font-weight:500;">Resident Adoption Today</div>
        <div style="font-size:12px;color:#a09cb0;">${p.currentResidents.toLocaleString()} of ${p.totalUnits.toLocaleString()} units paying &middot; <strong style="color:#dc5050;">${untapped.toLocaleString()} not yet paying</strong></div>
      </div>
      <div style="background:#eceaf2;border-radius:99px;height:8px;overflow:hidden;">
        <div style="background:#6A3DB8;height:100%;width:${pctEnrolled.toFixed(1)}%;border-radius:99px;"></div>
      </div>
    </div>`;

  // --- Insight text per scenario ---
  const gapResidents = Math.round(p.totalUnits * targetNar) - p.currentResidents;
  const conservativeResidents = Math.round(p.totalUnits * conservativeNar);

  let conText: string;
  if (lastMomOutlier) {
    // Check if new properties drove the dip
    let propDelta = 0;
    if (p.monthlyTotals.length >= 2) {
      const last = p.monthlyTotals[p.monthlyTotals.length - 1];
      const prev = p.monthlyTotals[p.monthlyTotals.length - 2];
      if (last.propertyCount != null && prev.propertyCount != null) {
        propDelta = last.propertyCount - prev.propertyCount;
      }
    }
    if (propDelta >= 5) {
      conText = `<strong>Adoption dipped last month</strong> - ${propDelta >= 0 ? "+" : ""}${propDelta.toLocaleString()} new properties joined, diluting the overall rate. Floor holds at today's ${fmtPct(p.currentNar)}: ${conservativeResidents.toLocaleString()} residents.`;
    } else {
      conText = `<strong>Adoption dipped last month</strong> - fewer residents paid through Flex. Could reflect seasonal patterns or a real signal; worth monitoring. Floor: ${conservativeResidents.toLocaleString()} residents at ${fmtPct(p.currentNar)}.`;
    }
  } else {
    conText = `Conservative floor: <strong>${conservativeResidents.toLocaleString()} residents</strong> at today's ${fmtPct(p.currentNar)} rate - the baseline if nothing changes.`;
  }

  let projText: string;
  if (avgMom < -0.001) {
    projText = `<strong>Rate being diluted by rapid enrollment</strong> - new properties joining faster than residents activate. Projected scenario reflects this unless activation pace picks up.`;
  } else if (avgMom > 0.001) {
    projText = `<strong>Momentum is positive</strong> at +${(avgMom * 100).toFixed(2)}pp/month - at this pace, adoption reaches <strong>${fmtPct(projectedNar)}</strong> in 12 months.`;
  } else if (projDeclining) {
    projText = `<strong>Adoption is trending down</strong> - recent months have softened, projecting to <strong>${fmtPct(projectedNar)}</strong> over 12 months if the pattern holds, down from today's ${fmtPct(p.currentNar)}. Worth a closer look at what's driving the recent dip.`;
  } else {
    projText = `<strong>Adoption is flat</strong> near ${fmtPct(p.currentNar)}. Re-engaging lapsed residents or improving new-property activation would move the needle.`;
  }
  projText += ` <span style="color:#a09cb0;">Assumes today's portfolio size - doesn't include any properties not yet live.</span>`;

  const tgtText = `Closing to <strong>${fmtPct(targetNar)}</strong> means <strong>${gapResidents.toLocaleString()} more active residents</strong> - each adds ~${fmtCurrency(avgRent)}/month.`;

  const insightTexts: Record<string, string> = { Conservative: conText, Projected: projText, [targetLabel]: tgtText };

  const gridId = `proj-grid-${slideId}`;
  const projTileId = `proj-tile-projected-${slideId}`;

  let cards = "";
  let visibleCount = 0;
  for (const [label, nar, color] of scenarios) {
    const residents = Math.round(p.totalUnits * nar);
    const monthlyRent = residents * avgRent;
    const annual = monthlyRent * 12;
    const tileInsight = insightTexts[label] || "";
    const labelColor = (label === "Projected" && projDeclining) ? color : "#524e5b";
    const isProjected = label === "Projected";
    const initiallyHidden = isProjected && !showProjection;
    if (!initiallyHidden) visibleCount++;
    const tileIdAttr = isProjected ? ` id="${projTileId}"` : "";
    const tileDisplay = initiallyHidden ? "display:none;" : "display:flex;";
    cards += `
        <div${tileIdAttr} style="${tileDisplay}background:#f7f7f7;border:1px solid #eceaf2;border-radius:14px;padding:20px 22px;
                    flex-direction:column;justify-content:space-between;">
          <div style="display:flex;flex-direction:column;flex:1;">
            <div style="font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:${labelColor};font-weight:600;margin-bottom:8px;">${label} &middot; ${fmtPct(nar)} adoption</div>
            <div style="font-size:15px;color:#a09cb0;margin-bottom:0;line-height:1.5;">${tileInsight}</div>
            <div style="margin-top:28px;padding-top:8px;">
              <div style="font-size:15px;color:#524e5b;margin-bottom:10px;">${residents.toLocaleString()} active residents</div>
              <div style="font-size:52px;font-weight:400;color:${color};letter-spacing:-0.04em;line-height:1;font-family:'ABCDiatype',sans-serif;">${fmtCurrency(monthlyRent)}</div>
              <div style="font-size:13px;color:#a09cb0;margin-top:8px;">monthly rent collected</div>
            </div>
          </div>
          <div style="padding-top:16px;border-top:1px solid #eceaf2;margin-top:16px;">
            <div style="font-size:12px;color:#524e5b;margin-bottom:2px;">Annual run rate</div>
            <div style="font-size:26px;font-weight:700;">${fmtCurrency(annual)} / yr</div>
          </div>
        </div>`;
  }

  const gridCols = Array(visibleCount).fill("1fr").join(" ");

  // Projected tile toggle button
  const btnHiddenClass = showProjection ? "" : " is-hidden";
  const btnLabel = showProjection ? "Hide Projected tile" : "Show Projected tile";
  const projToggleHtml = `
    <div class="presenter-control" style="margin-top:10px;">
      <button class="spark-ctrl-btn${btnHiddenClass}" onclick="flexToggleProjTile('${projTileId}','${gridId}',this)">${btnLabel}</button>
    </div>
    <script>if(!window.flexToggleProjTile){window.flexToggleProjTile=function(tileId,gridId,btn){
      var el=document.getElementById(tileId); if(!el) return;
      var wasVisible=el.style.display!=='none';
      el.style.display=wasVisible?'none':'flex';
      btn.classList.toggle('is-hidden',wasVisible);
      btn.textContent=wasVisible?'Show Projected tile':'Hide Projected tile';
      var grid=document.getElementById(gridId);
      if(grid){
        var visible=0;
        Array.prototype.forEach.call(grid.children,function(c){if(c.style.display!=='none')visible++;});
        grid.style.gridTemplateColumns=new Array(visible).fill('1fr').join(' ');
      }
    };}<\/script>`;

  const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;">
    <div class="slide-header" style="margin-bottom:12px;flex-shrink:0;">
      <div class="slide-label">The Opportunity Ahead</div>
      <div class="slide-title">What ${p.totalUnits.toLocaleString()} Units Looks Like in 12 Months</div>
    </div>
    <div style="flex-shrink:0;">${progressBar}</div>
    <div id="${gridId}" style="display:grid;grid-template-columns:${gridCols};gap:14px;flex:1;min-height:0;">${cards}</div>
    ${projToggleHtml}
  </div>`;
  return { html, js: "" };
}

interface StateRowData {
  state: string;
  properties: number;
  totalUnits: number;
  billsPaid: number;
  adoptionRate: number;
  estRate?: number;
}

interface StateBreakdownInput {
  latestRows: { PROPERTY_NAME: string; PROPERTY_UNIT_COUNT: number; BILLS_PAID: number; PROPERTY_STATE: string | null; ROLLOUT_MONTH: string | null }[];
  portfolioNar: number;
  reportingMonth: string;
  slideId?: number;
  regionDetail?: { PROPERTY_STATE: string; PROPERTY_REGION: string; PROPERTIES: number; TOTAL_UNITS: number; BILLS_PAID: number }[];
}

function renderStateBreakdown(input: StateBreakdownInput): { html: string; js: string } {
  const { latestRows, portfolioNar, reportingMonth, slideId = 6, regionDetail = [] } = input;

  // --- Aggregate by state ---
  const statesMap = new Map<string, { properties: Set<string>; totalUnits: number; billsPaid: number }>();
  for (const row of latestRows) {
    if (!row.PROPERTY_STATE) continue;
    const s = statesMap.get(row.PROPERTY_STATE) || { properties: new Set<string>(), totalUnits: 0, billsPaid: 0 };
    s.properties.add(row.PROPERTY_NAME);
    s.totalUnits += row.PROPERTY_UNIT_COUNT;
    s.billsPaid += row.BILLS_PAID;
    statesMap.set(row.PROPERTY_STATE, s);
  }

  // Flask: snapshot["property_state"].nunique() > 2 — strictly greater than 2.
  // At 2 states or fewer, render nothing (empty string).
  if (statesMap.size <= 2) {
    return { html: "", js: "" };
  }

  const states: StateRowData[] = Array.from(statesMap.entries())
    .map(([st, s]) => ({
      state: st,
      properties: s.properties.size,
      totalUnits: s.totalUnits,
      billsPaid: s.billsPaid,
      adoptionRate: s.totalUnits > 0 ? s.billsPaid / s.totalUnits : 0,
    }))
    .sort((a, b) => b.adoptionRate - a.adoptionRate);

  // --- Dynamic title from top-performing states ---
  const aboveAvgStates = states.filter((s) => s.adoptionRate >= portfolioNar);
  const topStates = (aboveAvgStates.length > 0 ? aboveAvgStates : states).slice(0, 3).map((s) => s.state);
  let stateTitle: string;
  if (topStates.length === 1) {
    stateTitle = `${topStates[0]} leads - what&apos;s working there?`;
  } else if (topStates.length === 2) {
    stateTitle = `${topStates[0]} and ${topStates[1]} are ahead - what can other markets learn?`;
  } else {
    stateTitle = `${topStates[0]}, ${topStates[1]}, and ${topStates[2]} lead - what can other markets learn?`;
  }

  // --- Single-state guard ---
  if (states.length <= 1) {
    const stateName = states[0]?.state || "N/A";
    const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;">
    <div class="slide-header">
      <div class="slide-label">Geographic Breakdown</div>
      <div class="slide-title">Adoption by State</div>
    </div>
    <div style="color:#524e5b;font-size:15px;padding:40px 0;">
      All properties are located in <strong>${htmlEscape(stateName)}</strong> - no multi-state comparison available.
    </div>
  </div>`;
    return { html, js: "" };
  }

  // --- Established-property rate (properties 3+ months old) ---
  let hasEst = false;
  try {
    const rmDate = new Date(reportingMonth);
    const cutoffDate = new Date(rmDate.getFullYear(), rmDate.getMonth() - 3, 1);
    const cutoffStr = cutoffDate.toISOString().slice(0, 10);

    // Filter to established properties (rollout_month <= cutoff)
    const estRows = latestRows.filter(
      (r) => r.PROPERTY_STATE && r.ROLLOUT_MONTH && r.ROLLOUT_MONTH <= cutoffStr
    );
    if (estRows.length > 0) {
      const estMap = new Map<string, { billsPaid: number; units: number }>();
      for (const row of estRows) {
        const key = row.PROPERTY_STATE!;
        const e = estMap.get(key) || { billsPaid: 0, units: 0 };
        e.billsPaid += row.BILLS_PAID;
        e.units += row.PROPERTY_UNIT_COUNT;
        estMap.set(key, e);
      }
      for (const s of states) {
        const est = estMap.get(s.state);
        if (est && est.units > 0) {
          s.estRate = est.billsPaid / est.units;
        }
      }
      hasEst = states.some((s) => s.estRate != null && s.estRate > 0);
    }
  } catch {
    // Skip est computation on error
  }

  // --- Metrics ---
  const aboveAvgCount = states.filter((s) => s.adoptionRate >= portfolioNar).length;
  const bestState = states[0];
  const barScale = (Math.max(...states.map((s) => s.adoptionRate)) * 1.15) || 1.0;
  const rowMargin = states.length <= 7 ? "10px" : "0";

  // --- KPI card helper ---
  function kpiCard(label: string, value: string, delta: string, color: string): string {
    const colorMap: Record<string, string> = { purple: "#6A3DB8", teal: "#0d9488", amber: "#d97706" };
    const c = colorMap[color] || "#6A3DB8";
    return `
      <div style="background:#fff;border:1px solid #eceaf2;border-radius:16px;padding:20px 20px 16px;">
        <div style="font-size:11px;text-transform:uppercase;color:#524e5b;margin-bottom:10px;font-weight:500;">${label}</div>
        <div style="font-size:36px;font-weight:400;color:${c};margin-bottom:6px;">${value}</div>
        <div style="font-size:12px;color:#524e5b;">${delta}</div>
      </div>`;
  }

  // --- Bar row helper ---
  function barRow(opts: {
    stateLabel: string;
    rate: number;
    avg: number;
    estRate?: number;
    props: number;
    units: number;
    extraHtml?: string;
    onclick?: string;
    scale?: number;
  }): string {
    const { stateLabel, rate, avg, estRate = 0, props, units, extraHtml = "", onclick = "", scale } = opts;
    const isNested = scale != null;
    const localScale = scale ?? barScale;
    const barPct = (rate / localScale) * 100;
    const markerPct = Math.min((avg / localScale) * 100, 100);
    const gap = rate - avg;

    let lightShade: string, darkShade: string, labelColor: string;
    if (gap >= 0) {
      lightShade = "#bdead9"; darkShade = "#1a9e6a"; labelColor = "#1a9e6a";
    } else if (gap >= -0.03) {
      lightShade = "#f6d9ab"; darkShade = "#d97706"; labelColor = "#d97706";
    } else {
      lightShade = "#DDC6F9"; darkShade = "#6A3DB8"; labelColor = "#524e5b";
    }

    const barOpacity = isNested ? "opacity:0.55;" : "";
    const estPct = estRate > 0 ? (estRate / localScale) * 100 : 0;

    let barsHtml: string;
    if (estRate > 0) {
      const blendedDiv = `<div style="background:${lightShade};height:100%;width:${barPct.toFixed(0)}%;border-radius:4px;position:absolute;top:0;left:0;${barOpacity}"></div>`;
      const estDiv = `<div style="background:${darkShade};height:100%;width:${estPct.toFixed(0)}%;border-radius:4px;position:absolute;top:0;left:0;${barOpacity}${estPct > 0 ? "border-right:2px solid #fff;" : ""}"></div>`;
      barsHtml = estPct <= barPct ? (blendedDiv + estDiv) : (estDiv + blendedDiv);
    } else {
      barsHtml = `<div style="background:${darkShade};height:100%;width:${barPct.toFixed(0)}%;border-radius:4px;position:absolute;top:0;left:0;${barOpacity}"></div>`;
    }

    const cursorStyle = onclick ? "cursor:pointer;" : "";
    const chevron = onclick ? ` <span style="color:#a09cb0;font-size:11px;">&#9662;</span>` : "";
    const labelColWidth = isNested ? "230px" : "84px";
    const labelStyle = isNested
      ? "font-size:11px;font-weight:500;color:#524e5b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
      : "font-size:13px;font-weight:600;color:#1d1d1d;";

    return `
      <div style="display:grid;grid-template-columns:${labelColWidth} 1fr 62px 68px 68px;gap:10px;align-items:center;margin-bottom:${rowMargin};">
        <div ${onclick} style="${labelStyle}${cursorStyle}" title="${htmlEscape(stateLabel)}">${htmlEscape(stateLabel)}${chevron}</div>
        <div style="position:relative;background:#eceaf2;border-radius:4px;height:10px;overflow:visible;">
          ${barsHtml}
          <div style="position:absolute;top:-5px;bottom:-5px;left:${markerPct.toFixed(1)}%;width:2px;background:#2C194D;opacity:0.3;border-radius:1px;"></div>
        </div>
        <div style="font-size:13px;font-weight:700;color:${labelColor};text-align:right;">${fmtPct(rate)}</div>
        <div style="font-size:11px;color:#a09cb0;text-align:right;">${props} props</div>
        <div style="font-size:11px;color:#a09cb0;text-align:right;">${units.toLocaleString()} units</div>
      </div>${extraHtml}`;
  }

  // --- Build region map by state ---
  const regionsByState = new Map<string, { region: string; properties: number; totalUnits: number; billsPaid: number; adoptionRate: number }[]>();
  for (const r of regionDetail) {
    if (!r.PROPERTY_STATE) continue;
    const arr = regionsByState.get(r.PROPERTY_STATE) || [];
    const rate = r.TOTAL_UNITS > 0 ? r.BILLS_PAID / r.TOTAL_UNITS : 0;
    arr.push({ region: r.PROPERTY_REGION, properties: r.PROPERTIES, totalUnits: r.TOTAL_UNITS, billsPaid: r.BILLS_PAID, adoptionRate: rate });
    regionsByState.set(r.PROPERTY_STATE, arr);
  }
  // Sort regions within each state by adoption rate desc
  for (const [, regions] of regionsByState) {
    regions.sort((a, b) => b.adoptionRate - a.adoptionRate);
  }

  // --- Build state rows ---
  let stateRowsHtml = "";
  let stateIdx = 0;
  for (const s of states) {
    const regions = regionsByState.get(s.state);
    let regionBlock = "";
    let onclick = "";
    if (regions && regions.length > 0) {
      const rowsId = `geo-region-${slideId}-${stateIdx}`;
      const localScale = Math.max(Math.max(...regions.map(r => r.adoptionRate)), portfolioNar) * 1.15 || 1.0;
      let regionRows = "";
      for (const rr of regions) {
        regionRows += barRow({
          stateLabel: rr.region,
          rate: rr.adoptionRate,
          avg: portfolioNar,
          props: rr.properties,
          units: rr.totalUnits,
          scale: localScale,
        });
      }
      // Left border acts as a visible tree guide-line connecting every region row back to
      // its parent state - a plain padding-left (the old approach) only nudged the label
      // text a little to the right, which read as barely-there hierarchy (Kevin's catch:
      // hard to tell these roll up into the state total above them). Deeper padding-left
      // than the first pass (18px -> 28px) makes the indent itself more decisive, and
      // margin-bottom gives the group a visible close before the next state starts -
      // without it, the gap after the last region row was the same rowMargin used between
      // every row throughout the list, so nothing signaled "this nested group just ended"
      // before the next top-level state appeared right after it (Kevin's follow-up catch:
      // hard to tell FL's rows end and TN begins). Mirrors the identical fix in Flask's
      // render_state_breakdown.
      regionBlock = `<div id="${rowsId}" style="display:none;margin-top:6px;margin-bottom:14px;margin-left:6px;padding-left:28px;border-left:2px solid #e5e2f0;">${regionRows}</div>`;
      onclick = `onclick="flexToggleGeoRegion('${rowsId}')"`;
    }
    stateRowsHtml += barRow({
      stateLabel: s.state,
      rate: s.adoptionRate,
      avg: portfolioNar,
      estRate: s.estRate ?? 0,
      props: s.properties,
      units: s.totalUnits,
      extraHtml: regionBlock,
      onclick,
    });
    stateIdx++;
  }

  // --- KPI row ---
  const kpiRow = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px;">
      ${kpiCard("States", String(states.length), "active markets", "purple")}
      ${kpiCard("Above Portfolio Avg", `${aboveAvgCount} / ${states.length}`, `portfolio avg ${fmtPct(portfolioNar)}`, aboveAvgCount >= Math.floor(states.length / 2) ? "teal" : "amber")}
      ${kpiCard("Top State", fmtPct(bestState.adoptionRate), htmlEscape(bestState.state), "teal")}
    </div>`;

  // --- Legend footer ---
  let legendText = `Line = portfolio avg ${fmtPct(portfolioNar)} &middot; Green = above avg &middot; Amber = within 3pp &middot; Purple = below avg`;
  if (hasEst) {
    legendText += ` &middot; Darker shade = established properties (3+ mo.) &middot; Lighter shade = all properties`;
  }
  if (regionsByState.size > 0) {
    legendText += ` &middot; Click a state to see its regions`;
  }

  const regionScript = regionsByState.size > 0
    ? `<script>if(!window.flexToggleGeoRegion){window.flexToggleGeoRegion=function(rowId){var block=document.getElementById(rowId);if(!block)return;block.style.display=(block.style.display==='none')?'block':'none';};}</script>`
    : "";

  const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;justify-content:flex-start;">
    <div class="slide-header">
      <div class="slide-label">Geographic Breakdown</div>
      <div class="slide-title">${stateTitle}</div>
    </div>
    ${kpiRow}
    <div style="background:#f7f7f7;border:1px solid #eceaf2;border-radius:12px;padding:20px 20px 14px;
                flex:1;min-height:0;display:flex;flex-direction:column;">
      <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#524e5b;margin-bottom:16px;font-weight:600;">
        Current Month - Ranked by Adoption Rate
      </div>
      <div style="flex:1;min-height:0;overflow-y:auto;padding-right:4px;display:flex;flex-direction:column;justify-content:space-evenly;">
        ${stateRowsHtml}
      </div>
      <div style="font-size:11px;color:#a09cb0;margin-top:10px;border-top:1px solid #eceaf2;padding-top:10px;flex-shrink:0;">
        ${legendText}
      </div>
    </div>
  </div>
  ${regionScript}`;
  return { html, js: "" };
}



function renderFullPropertyTable(
  snapshot: { propertyName: string; units: number; billsPaid: number; newSignups: number; prevSignups?: number; adoptionRate: number; rentPaid?: number; cumRent?: number; rolloutMonth?: string | null }[],
  slideId: number
): string {
  let rows = "";
  for (const row of snapshot) {
    const narColor = row.adoptionRate >= 0.20 ? "#1a9e6a" : row.adoptionRate >= 0.10 ? "#d97706" : "#dc5050";
    const curSig = Math.round(row.newSignups);
    const prevSig = Math.round(row.prevSignups ?? 0);
    let sigHtml = String(curSig);
    if (prevSig > 0) {
      const delta = curSig - prevSig;
      const deltaPct = Math.abs(delta / prevSig) * 100;
      const arr = delta >= 0 ? "▲" : "▼";
      const sigColor = delta >= 0 ? "#1a9e6a" : "#dc5050";
      sigHtml = `${curSig} <span style="font-size:10px;color:${sigColor};white-space:nowrap;">${arr}${deltaPct.toFixed(0)}%</span>`;
    }
    const thisMonthRent = row.rentPaid ?? 0;
    const totalRent = row.cumRent ?? thisMonthRent;
    // Rollout month: sort key as plain YYYYMM digits (fixes parseFloat stopping at dash)
    const rmRaw = row.rolloutMonth ?? "";
    const rmSort = rmRaw ? rmRaw.replace(/-/g, "").slice(0, 6) : "0";
    const rmDisplay = rmRaw ? new Date(rmRaw + "T00:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "short", timeZone: "UTC" }) : "-";
    rows += `
        <tr>
          <td data-sort="${_e(row.propertyName)}" style="padding:6px 8px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;">${_e(row.propertyName)}</td>
          <td data-sort="${rmSort}" style="padding:6px 8px;font-size:12px;text-align:right;color:#a09cb0;">${rmDisplay}</td>
          <td data-sort="${row.units}" style="padding:6px 8px;font-size:12px;text-align:right;">${row.units.toLocaleString()}</td>
          <td data-sort="${row.billsPaid}" style="padding:6px 8px;font-size:12px;text-align:right;">${Math.round(row.billsPaid)}</td>
          <td data-sort="${curSig}" style="padding:6px 8px;font-size:12px;text-align:right;">${sigHtml}</td>
          <td data-sort="${row.adoptionRate}" style="padding:6px 8px;font-size:12px;text-align:right;font-weight:700;color:${narColor};">${fmtPct(row.adoptionRate)}</td>
          <td data-sort="${thisMonthRent}" style="padding:6px 8px;font-size:12px;text-align:right;">${fmtCurrency(thisMonthRent)}</td>
          <td data-sort="${totalRent}" style="padding:6px 8px;font-size:12px;text-align:right;color:#6A3DB8;">${fmtCurrency(totalRent)}</td>
        </tr>`;
  }

  const cols = ["Property", "Rollout Month", "Units", "Current Paying Residents", "New Signups (vs Last Mo.)", "Adoption", "This Month Rent", "Total Rent Paid"];
  const colWidths = ["18%", "11%", "8%", "13%", "14%", "10%", "13%", "13%"];
  const thHtml = cols
    .map((c, i) =>
      `<th onclick="flexSortTable(${slideId},${i})" id="th${slideId}-${i}" ` +
      `style="padding:6px 8px;text-align:${i === 0 ? "left" : "right"};font-size:10px;` +
      `color:${i === cols.length - 1 ? "#6A3DB8" : "#524e5b"};text-transform:uppercase;` +
      `letter-spacing:0.06em;cursor:pointer;user-select:none;white-space:normal;word-wrap:break-word;` +
      `width:${colWidths[i]};">` +
      `${c}<span id="arrow${slideId}-${i}" style="display:inline-block;width:12px;"></span></th>`
    )
    .join("");

  return `
  <div class="slide" id="slide-${slideId}" style="background:#fff;">
    <div class="slide-header">
      <div class="slide-label">Appendix</div>
      <div class="slide-title">All Properties - Full Metrics</div>
      <div style="font-size:11px;color:#a09cb0;margin-top:4px;">Click a column header to sort</div>
    </div>
    <div style="overflow-y:auto;max-height:520px;overflow-x:hidden;">
      <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
        <thead><tr id="thead${slideId}" style="border-bottom:2px solid #eceaf2;position:sticky;top:0;background:#fff;z-index:1;">${thHtml}</tr></thead>
        <tbody id="tbody${slideId}">${rows}</tbody>
      </table>
    </div>
  </div>
  <script>if(!window.flexSortTable){window.flexSortTable=function(sid,col){
    var tbody=document.getElementById('tbody'+sid); if(!tbody) return;
    var rows=Array.prototype.slice.call(tbody.querySelectorAll('tr'));
    var thead=document.getElementById('thead'+sid);
    var prevCol=thead.getAttribute('data-sort-col'), prevDir=thead.getAttribute('data-sort-dir');
    var asc = !(String(col)===prevCol && prevDir==='asc');
    rows.sort(function(a,b){
      var av=a.children[col].getAttribute('data-sort'), bv=b.children[col].getAttribute('data-sort');
      var an=parseFloat(av), bn=parseFloat(bv);
      var cmp = (!isNaN(an) && !isNaN(bn)) ? (an-bn) : String(av).localeCompare(String(bv));
      return asc ? cmp : -cmp;
    });
    rows.forEach(function(r){ tbody.appendChild(r); });
    thead.setAttribute('data-sort-col', col);
    thead.setAttribute('data-sort-dir', asc?'asc':'desc');
    for(var i=0;i<${cols.length};i++){
      var el=document.getElementById('arrow'+sid+'-'+i);
      if(el) el.textContent = (i===col) ? (asc?'\\u25B2':'\\u25BC') : '';
    }
  };}</script>`;
}

// --- Deck Template ---

function buildDeckHtml(params: {
  slides: string;
  pmc_name: string;
  report_month: string;
  report_year: string;
  slide_count: number;
  pdf_filename: string;
  extra_js?: string;
}): string {
  const { slides, pmc_name, report_month, report_year, slide_count, pdf_filename, extra_js } = params;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${pmc_name} - Flex Performance Review | ${report_month}</title>
<style>
  @font-face { font-family: 'ABCDiatype'; src: url('/static/fonts/ABCDiatype-Regular.otf') format('opentype'); font-weight: 400; font-style: normal; }
  @font-face { font-family: 'ABCDiatype'; src: url('/static/fonts/ABCDiatype-Medium.otf') format('opentype'); font-weight: 500; font-style: normal; }
  @font-face { font-family: 'ABCDiatype'; src: url('/static/fonts/ABCDiatype-Bold.otf') format('opentype'); font-weight: 700; font-style: normal; }
  @font-face { font-family: 'ABCDiatype'; src: url('/static/fonts/ABCDiatype-Bold.otf') format('opentype'); font-weight: 800; font-style: normal; }
  @font-face { font-family: 'ABCDiatype'; src: url('/static/fonts/ABCDiatype-Bold.otf') format('opentype'); font-weight: 900; font-style: normal; }
  @font-face { font-family: 'CooperBT'; src: url('/static/fonts/CooperMdBT-Regular.ttf') format('truetype'); font-weight: 500; font-style: normal; }
</style>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js"><\/script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"><\/script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"><\/script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --black: #1D1D1D; --navy: #2C194D; --white: #ffffff; --purple: #6A3DB8;
    --purple-mid: #DDC6F9; --purple-light: #EEE2FC; --gray: #524e5b; --bg: #F7F7F7;
    --border: #eceaf2; --green: #1a9e6a; --amber: #d97706;
    --orange: #ea8c28; --red: #dc5050;
  }
  body { font-family: 'ABCDiatype', 'Lexend', sans-serif; background: #111; color: var(--navy); overflow: hidden; height: 100vh; display: flex; flex-direction: column; }
  .deck-viewport { flex: 1; position: relative; overflow: hidden; }
  .deck { position: relative; }
  .slide { display: none; position: absolute; width: 1280px; height: 720px; padding: 40px 72px 52px; background: #fff; flex-direction: column; justify-content: flex-start; overflow: hidden; }
  .slide.active { display: flex; }
  .slide::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 44px; pointer-events: none; }
  .footer-left { position: fixed; bottom: 14px; left: 44px; font-family: 'ABCDiatype', sans-serif; font-size: 11px; color: #9896a4; letter-spacing: 0.02em; z-index: 100; line-height: 1; }
  .footer-right { position: fixed; bottom: 10px; right: 44px; display: flex; align-items: center; gap: 16px; z-index: 100; }
  .flex-wordmark { font-family: 'ABCDiatype', sans-serif; font-size: 22px; font-weight: 800; letter-spacing: -0.04em; color: var(--navy); line-height: 1; }
  .slide-counter { font-family: 'ABCDiatype', sans-serif; font-size: 12px; color: #9896a4; line-height: 1; }
  .slide-label { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--purple); margin-bottom: 8px; font-weight: 600; font-family: 'ABCDiatype', sans-serif; }
  .slide-title { font-size: 34px; font-weight: 700; color: var(--navy); line-height: 1.15; letter-spacing: -0.02em; font-family: 'ABCDiatype', sans-serif; }
  .slide-header { margin-bottom: 20px; }
  .chart-wrap { position: relative; flex: 1; min-height: 280px; width: 100%; background: var(--bg); border-radius: 16px; border: 1px solid var(--border); padding: 22px; }
  .deck-actions { display: flex; gap: 6px; align-items: center; }
  .action-btn { display: flex; align-items: center; gap: 5px; padding: 5px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.06); color: #9896a4; font-family: 'ABCDiatype', sans-serif; font-size: 11px; cursor: pointer; transition: all 0.15s; letter-spacing: 0.02em; }
  .action-btn:hover { background: rgba(255,255,255,0.14); color: #fff; border-color: rgba(255,255,255,0.28); }
  .action-btn.is-active { background: #6A3DB8; color: #fff; border-color: #6A3DB8; }
  #deck[contenteditable="true"] .slide { cursor: text; }
  .slide-hide-btn { position: absolute; top: 10px; right: 10px; z-index: 50; padding: 4px 10px; border-radius: 5px; border: 1px solid #e5e7eb; background: rgba(255,255,255,0.92); color: #9ca3af; font-size: 10px; font-weight: 600; cursor: pointer; font-family: 'ABCDiatype', sans-serif; letter-spacing: 0.04em; backdrop-filter: blur(4px); transition: all 0.12s; }
  .slide-hide-btn:hover { background: #f9f5ff; color: #6A3DB8; border-color: #6A3DB8; }
  .slide-hide-btn.is-hidden { background: #fee2e2; color: #dc5050; border-color: #fca5a5; }
  .slide-copy-btn { position: absolute; top: 10px; right: 90px; z-index: 50; padding: 4px 10px; border-radius: 5px; border: 1px solid #e5e7eb; background: rgba(255,255,255,0.92); color: #9ca3af; font-size: 10px; font-weight: 600; cursor: pointer; font-family: 'ABCDiatype', sans-serif; letter-spacing: 0.04em; backdrop-filter: blur(4px); transition: all 0.12s; }
  .slide-copy-btn:hover { background: #f0edff; color: #6A3DB8; border-color: #6A3DB8; }
  .slide.slide-excluded { opacity: 0.35; outline: 2px solid #dc5050; }
  :fullscreen .slide-hide-btn, :-webkit-full-screen .slide-hide-btn { display: none; }
  :fullscreen .slide.slide-excluded, :-webkit-full-screen .slide.slide-excluded { opacity: 1; outline: none; }
  :fullscreen .presenter-control, :-webkit-full-screen .presenter-control { display: none; }
  :fullscreen #editBtn, :-webkit-full-screen #editBtn { display: none; }
  .bm-metric-toggles { display: flex; gap: 6px; margin-top: 12px; flex-wrap: wrap; }
  .stat-toggle-bar { display: flex; gap: 4px; }
  .spark-ctrl { position: absolute; bottom: 44px; left: 72px; z-index: 49; display: flex; gap: 5px; align-items: center; }
  .spark-ctrl-btn { padding: 3px 9px; border-radius: 4px; border: 1px solid #e5e7eb; background: rgba(255,255,255,0.92); color: #9ca3af; font-size: 10px; font-weight: 600; cursor: pointer; font-family: 'ABCDiatype', sans-serif; letter-spacing: 0.04em; backdrop-filter: blur(4px); transition: all 0.12s; }
  .spark-ctrl-btn:hover { background: #f9f5ff; color: #6A3DB8; border-color: #6A3DB8; }
  .spark-ctrl-btn.is-hidden { color: #dc5050; background: #fee2e2; border-color: #fca5a5; text-decoration: line-through; }
  .spark-ctrl-btn.is-active { color: #fff; background: #6A3DB8; border-color: #6A3DB8; }
  .spark-ctrl-btn.is-active:hover { color: #fff; background: #6A3DB8; }
  :fullscreen .spark-ctrl, :-webkit-full-screen .spark-ctrl { display: none; }
  .stat-toggle-btn.is-active { background: #6A3DB8; color: #fff; border-color: #6A3DB8; }
  .nav-overlay { position: fixed; inset: 0; z-index: 200; background: rgba(17,17,17,0.72); display: flex; align-items: center; justify-content: center; }
  .nav-panel { background: #fff; border-radius: 16px; width: min(720px, 88vw); max-height: 78vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 24px 64px rgba(0,0,0,0.4); }
  .nav-panel-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 22px; border-bottom: 1px solid var(--border); font-family: 'ABCDiatype', sans-serif; }
  .nav-panel-title { font-size: 15px; font-weight: 700; color: var(--navy); }
  .nav-panel-close { border: none; background: transparent; color: #9896a4; cursor: pointer; font-size: 20px; line-height: 1; padding: 2px 6px; border-radius: 6px; }
  .nav-panel-close:hover { background: var(--bg); color: var(--navy); }
  .nav-list { overflow-y: auto; padding: 8px; }
  .nav-row { display: flex; align-items: baseline; gap: 12px; padding: 10px 14px; border-radius: 8px; cursor: pointer; font-family: 'ABCDiatype', sans-serif; color: var(--navy); transition: background 0.1s; }
  .nav-row:hover { background: var(--purple-light); }
  .nav-row.is-current { background: var(--purple-light); outline: 1.5px solid var(--purple); }
  .nav-row-num { font-size: 12px; color: #9896a4; font-weight: 600; min-width: 22px; flex-shrink: 0; }
  .nav-row-label { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--purple); font-weight: 600; flex-shrink: 0; }
  .nav-row-title { font-size: 13px; color: var(--navy); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @media print {
    body { background: #fff; overflow: visible; height: auto; display: block; }
    .deck-viewport, .deck { position: static !important; transform: none !important; width: auto !important; height: auto !important; }
    .slide { display: flex !important; position: relative !important; transform: none !important; width: 100% !important; height: auto !important; min-height: 720px; page-break-after: always; }
    .footer-left, .footer-right, .deck-actions, .nav-overlay { display: none; }
    .slide::before { content: 'Flexible Finance, Inc. \\00A9 ${report_year} | Confidential'; position: absolute; bottom: 14px; left: 80px; font-family: 'ABCDiatype', sans-serif; font-size: 11px; color: #9896a4; }
    .slide-brand::after { content: 'flex'; position: absolute; bottom: 12px; right: 80px; font-family: 'ABCDiatype', sans-serif; font-size: 22px; font-weight: 800; letter-spacing: -0.04em; color: #6A3DB8; }
  }
</style>
</head>
<body>
<div class="deck-viewport" id="deckViewport">
  <div class="deck" id="deck">
    ${slides}
  </div>
</div>
<div class="footer-left">
  Flexible Finance, Inc. &copy; ${report_year} | Confidential &nbsp;&middot;&nbsp; ${pmc_name} &middot; ${report_month}
</div>
<div class="footer-right">
  <div class="deck-actions">
    <button class="action-btn" id="pdfBtn" title="Save as PDF" onclick="exportDeckPDF(this)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      PDF
    </button>
    <button class="action-btn" id="fsBtn" title="Fullscreen (F)" onclick="toggleFullscreen()">
      <svg id="fsIcon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
      Present
    </button>
    <button class="action-btn" id="navToggleBtn" title="Jump to Slide (G)" onclick="toggleNavigator()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
      Slides
    </button>
    <button class="action-btn" id="editBtn" title="Quick-edit slide text" onclick="toggleEditMode()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
      Edit
    </button>
  </div>
  <span class="slide-counter" id="navCounter">1 / ${slide_count}</span>
  <span class="flex-wordmark">flex</span>
</div>
<div class="nav-overlay" id="navOverlay" style="display:none;" onclick="if (event.target === this) closeNavigator();">
  <div class="nav-panel">
    <div class="nav-panel-header">
      <span class="nav-panel-title">Jump to Slide</span>
      <button class="nav-panel-close" onclick="closeNavigator()" title="Close (Esc)">&times;</button>
    </div>
    <div class="nav-list" id="navList"></div>
  </div>
</div>
<script>
  Chart.register(ChartDataLabels);
  let current = 1;
  const total = ${slide_count};
  const HIDE_KEY = 'flex_hidden_${pdf_filename}';
  let hiddenSlides = new Set(JSON.parse(localStorage.getItem(HIDE_KEY) || '[]'));
  function saveHidden() { localStorage.setItem(HIDE_KEY, JSON.stringify([...hiddenSlides])); }
  function visibleSlides() { const v = []; for (let i = 1; i <= total; i++) if (!hiddenSlides.has(i)) v.push(i); return v; }
  function updateCounter() {
    const hidden = hiddenSlides.size;
    if (document.fullscreenElement) {
      const vis = visibleSlides();
      const pos = vis.indexOf(current) + 1 || 1;
      document.getElementById('navCounter').textContent = pos + ' / ' + vis.length + (hidden ? ' (' + hidden + ' hidden)' : '');
    } else {
      document.getElementById('navCounter').textContent = current + ' / ' + total + (hidden ? ' \\u00b7 ' + hidden + ' hidden' : '');
    }
  }
  function toggleHide(n) {
    if (hiddenSlides.has(n)) { hiddenSlides.delete(n); }
    else {
      hiddenSlides.add(n);
      if (current === n) {
        const vis = visibleSlides();
        if (vis.length > 0) showSlide(vis.reduce((a, b) => Math.abs(b - n) < Math.abs(a - n) ? b : a));
      }
    }
    saveHidden(); refreshHideButtons(); updateCounter();
  }
  function refreshHideButtons() {
    document.querySelectorAll('.slide').forEach(slide => {
      const n = parseInt(slide.id.replace('slide-', ''));
      const btn = slide.querySelector('.slide-hide-btn');
      if (!btn) return;
      const hidden = hiddenSlides.has(n);
      slide.classList.toggle('slide-excluded', hidden);
      btn.classList.toggle('is-hidden', hidden);
      btn.textContent = hidden ? 'Show' : 'Hide';
      btn.title = hidden ? 'Click to include in presentation' : 'Click to skip in presentation';
    });
  }
  document.querySelectorAll('.slide').forEach(slide => {
    const n = parseInt(slide.id.replace('slide-', ''));
    if (isNaN(n)) return;
    const btn = document.createElement('button');
    btn.className = 'slide-hide-btn';
    btn.textContent = 'Hide';
    btn.title = 'Click to skip in presentation';
    btn.addEventListener('click', e => { e.stopPropagation(); toggleHide(n); });
    slide.appendChild(btn);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'slide-copy-btn pdf-export-hide presenter-control';
    copyBtn.textContent = 'Copy slide';
    copyBtn.title = 'Copy this slide as an image - paste into a Sheet, Doc, or Slide';
    copyBtn.addEventListener('click', e => { e.stopPropagation(); copySlideImage(n, copyBtn); });
    slide.appendChild(copyBtn);
  });
  refreshHideButtons();
  function showSlide(n) {
    current = n;
    document.querySelectorAll('.slide').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('slide-' + n);
    if (el) el.classList.add('active');
    updateCounter();
    if (window['initSlide' + n]) { try { window['initSlide' + n](); } catch(e) { console.error('slide', n, 'init failed:', e); } }
    if (window.flexSetStatMode) flexSetStatMode(window.flexStatMode || 'median');
  }
  function buildNavList() {
    const list = document.getElementById('navList');
    list.innerHTML = '';
    visibleSlides().forEach(n => {
      const slide = document.getElementById('slide-' + n);
      if (!slide) return;
      const label = slide.querySelector('.slide-label')?.textContent?.trim() || '';
      const title = slide.querySelector('.slide-title')?.textContent?.trim() || ('Slide ' + n);
      const row = document.createElement('div');
      row.className = 'nav-row' + (n === current ? ' is-current' : '');
      row.innerHTML = '<span class="nav-row-num">' + n + '</span>' + (label ? '<span class="nav-row-label">' + label + '</span>' : '') + '<span class="nav-row-title">' + title + '</span>';
      row.addEventListener('click', () => { showSlide(n); closeNavigator(); });
      list.appendChild(row);
    });
  }
  function toggleNavigator() {
    const overlay = document.getElementById('navOverlay');
    if (overlay.style.display === 'none') {
      buildNavList();
      overlay.style.display = 'flex';
      const currentRow = document.querySelector('.nav-row.is-current');
      if (currentRow) currentRow.scrollIntoView({ block: 'center' });
    } else { closeNavigator(); }
  }
  function closeNavigator() { document.getElementById('navOverlay').style.display = 'none'; }
  function isNavigatorOpen() { return document.getElementById('navOverlay').style.display !== 'none'; }
  let editMode = false;
  function toggleEditMode() {
    editMode = !editMode;
    document.getElementById('deck').setAttribute('contenteditable', editMode ? 'true' : 'false');
    document.getElementById('editBtn').classList.toggle('is-active', editMode);
  }
  function navigate(dir) {
    if (document.fullscreenElement) {
      const vis = visibleSlides();
      if (!vis.length) return;
      const idx = vis.indexOf(current);
      const next = idx + dir;
      if (next >= 0 && next < vis.length) showSlide(vis[next]);
    } else {
      const next = current + dir;
      if (next >= 1 && next <= total) showSlide(next);
    }
  }
  function fitSlides() {
    var vp = document.getElementById('deckViewport');
    if (!vp) return;
    var scale = Math.min(vp.offsetWidth / 1280, vp.offsetHeight / 720);
    var left = Math.max(0, (vp.offsetWidth  - 1280 * scale) / 2);
    var top  = Math.max(0, (vp.offsetHeight - 720  * scale) / 2);
    var deck = document.getElementById('deck');
    deck.style.transform = 'scale(' + scale + ')';
    deck.style.transformOrigin = 'top left';
    deck.style.left = left + 'px';
    deck.style.top  = top  + 'px';
    deck.style.position = 'absolute';
  }
  fitSlides();
  window.addEventListener('resize', fitSlides);
  document.addEventListener('fullscreenchange', fitSlides);
  document.addEventListener('keydown', (e) => {
    if (editMode) {
      if (e.key === 'Escape' && document.fullscreenElement) document.exitFullscreen();
      return;
    }
    if (e.key === 'Escape' && isNavigatorOpen()) { closeNavigator(); return; }
    if (isNavigatorOpen()) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') navigate(+1);
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   navigate(-1);
    if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    if (e.key === 'g' || e.key === 'G') toggleNavigator();
    if (e.key === 'Escape' && document.fullscreenElement) document.exitFullscreen();
  });
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => {
        document.getElementById('fsBtn').innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/></svg> Exit';
      }).catch(() => {});
    } else { document.exitFullscreen(); }
  }
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
      document.getElementById('fsBtn').innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg> Present';
    } else if (editMode) { toggleEditMode(); }
    updateCounter();
  });
  showSlide(1);

  // Extra slide-specific JS (sparklines, toggles)
  ${extra_js || ''}

  // Chart.js initialization for adoption trend
  (function initCharts() {
    const canvas = document.getElementById('adoptionChart');
    if (!canvas) return;
    const configStr = canvas.getAttribute('data-chart-config');
    if (!configStr) return;
    try {
      const chartData = JSON.parse(configStr.replace(/&#39;/g, "'"));
      new Chart(canvas, {
        type: 'line',
        data: chartData,
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, datalabels: { display: false } },
          scales: { y: { ticks: { callback: function(v) { return v + '%'; } } } },
        },
      });
    } catch (e) { console.error('Chart init failed:', e); }
  })();

  // Shared by exportDeckPDF's per-page loop AND copySlideImage's single-slide capture below -
  // mirrors Flask's captureSlideCanvas (deck_base.html / app.py) exactly, so the two apps'
  // capture behavior doesn't drift. Deliberately does NOT touch deck.style.transform or
  // el.style.position - the loop resets those once for its whole run, the single-slide button
  // resets them once for its one capture; bundling that in here would make the loop reset on
  // every iteration and flicker across each page of a full-deck PDF export.
  async function captureSlideCanvas(el) {
    await document.fonts.ready;
    void el.offsetHeight;
    el.querySelectorAll('canvas').forEach(cv => {
      const c = Chart.getChart(cv);
      if (!c) return;
      try { c.resize(); c.update('none'); } catch(e) {}
    });
    await new Promise(r => setTimeout(r, 100));
    return html2canvas(el, {
      scale: 2, useCORS: true, allowTaint: true,
      backgroundColor: '#ffffff', width: 1280, height: 720,
      logging: false, imageTimeout: 0, x: 0, y: 0,
      windowWidth: 1280, windowHeight: 720,
      onclone: (doc) => {
        const s = doc.createElement('style');
        s.textContent = '* { letter-spacing: 0 !important; word-spacing: normal !important; } .slide-hide-btn, .presenter-control, .pdf-export-hide { display: none !important; } .slide-excluded { opacity: 1 !important; outline: none !important; }';
        doc.head.appendChild(s);
      },
    });
  }

  async function exportDeckPDF(btn) {
    const origHTML = btn.innerHTML;
    btn.innerHTML = '\\u23f3 Building\\u2026';
    btn.disabled = true;
    try {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [1280, 720], hotfixes: ['px_scaling'] });
      const deck = document.getElementById('deck');
      const savedDeckT = deck.style.transform, savedDeckL = deck.style.left, savedDeckTop = deck.style.top;
      deck.style.transform = 'none'; deck.style.left = '0'; deck.style.top = '0'; deck.style.position = 'relative';
      const exportList = visibleSlides();
      let pageAdded = false;
      for (let i = 0; i < exportList.length; i++) {
        const n = exportList[i];
        document.querySelectorAll('.slide').forEach(s => { s.classList.remove('active'); s.style.position = 'absolute'; });
        const el = document.getElementById('slide-' + n);
        if (!el) continue;
        el.classList.add('active');
        el.style.position = 'relative';
        void el.offsetHeight;
        if (window['initSlide' + n]) { try { window['initSlide' + n](); } catch(e) {} }
        await new Promise(r => setTimeout(r, 300));
        const canvas = await captureSlideCanvas(el);
        el.style.position = 'absolute';
        if (pageAdded) pdf.addPage([1280, 720], 'landscape');
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 1280, 720);
        pageAdded = true;
        btn.innerHTML = '\\u23f3 ' + (i + 1) + '/' + exportList.length;
      }
      deck.style.transform = savedDeckT; deck.style.left = savedDeckL; deck.style.top = savedDeckTop; deck.style.position = 'absolute';
      showSlide(current);
      pdf.save('${pdf_filename}');
    } catch(e) { alert('PDF export failed: ' + e.message); }
    btn.innerHTML = origHTML;
    btn.disabled = false;
  }

  // Copy (or, on clipboard failure, download) just the currently-active slide as a flat PNG -
  // replaces the screenshot-into-a-Sheet/Doc workaround people were already doing by hand.
  async function copySlideImage(n, btn) {
    const el = document.getElementById('slide-' + n);
    if (!el) return;
    const origLabel = btn.textContent;
    btn.textContent = '\\u2026';
    btn.disabled = true;
    try {
      const deck = document.getElementById('deck');
      const savedDeckT = deck.style.transform, savedDeckL = deck.style.left, savedDeckTop = deck.style.top, savedDeckPos = deck.style.position;
      deck.style.transform = 'none'; deck.style.left = '0'; deck.style.top = '0'; deck.style.position = 'relative';
      const savedElPos = el.style.position;
      el.style.position = 'relative';
      const canvas = await captureSlideCanvas(el);
      el.style.position = savedElPos;
      deck.style.transform = savedDeckT; deck.style.left = savedDeckL; deck.style.top = savedDeckTop; deck.style.position = savedDeckPos;

      await new Promise(resolve => canvas.toBlob(async (blob) => {
        let copied = false;
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          copied = true;
        } catch (e) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = 'slide-' + n + '.png';
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
        btn.textContent = copied ? 'Copied!' : 'Downloaded';
        resolve();
      }, 'image/png'));
    } catch (e) {
      btn.textContent = 'Failed';
    }
    setTimeout(() => { btn.textContent = origLabel; btn.disabled = false; }, 1500);
  }
<\/script>
</body>
</html>`;
}

// --- Main API ---

export default api({
  name: "GetPMCMonthlyReport",
  description: "Queries Snowflake PMC stats and returns a complete deck HTML document.",

  integrations: {
    snowflake_sso: snowflake(SNOWFLAKE_SSO),
  },

  input: z.object({
    pmc_name: z.string(),
    second_pmc: z.string().optional().default(""),
    report_name: z.string().optional().default(""),
    lookback_months: z.number().int().default(12),
    deck_mode: z.enum(["qbr", "new_logo", "expansion"]).default("qbr"),
    adoption_target: z.number().default(15), // percent, e.g. 15 = 15%
    testimonials: z.array(z.object({
      name: z.string(),
      propertyName: z.string(),
      quote: z.string(),
    })).default([]),

    total_portfolio_units: z.number().int().optional().default(0),
    expansion_slides: z.array(z.string()).optional(),
    presenting_mode: z.boolean().optional().default(false),
    comparison_months: z.number().int().optional().default(1),
    // Growth trend slides (residents_units/adoption_trend/cohort_overview) override.
    // "auto" preserves the SMB-only default; "include"/"exclude" force the segment veto
    // either way. Plain optional (not .default()) like expansion_slides above — a concurrent
    // edit changed this to .default("auto"), which makes the field REQUIRED in the generated
    // call-site type (breaks QBR/new_logo callers that don't pass it); restored, with the
    // fallback handled at the derivation site instead (`growth_slides ?? "auto"`).
    growth_slides: z.enum(["auto", "include", "exclude"]).optional(),
    // Exec tile sparklines / period-comparison pills, independent manual overrides (Kevin's
    // ask - "I want to be able to toggle everything if we want", on top of the implicit
    // sparklines-follow-growth-slides behavior). "auto" preserves today's derived default for
    // each; "include"/"exclude" force it either way. Same plain-optional convention as
    // growth_slides above (not .default()) for the same call-site-required reason.
    sparklines: z.enum(["auto", "include", "exclude"]).optional(),
    period_comparison: z.enum(["auto", "include", "exclude"]).optional(),
    // Resident/household terminology, every deck mode (Kevin's ask, 2026-08-19). Plain
    // optional like growth_slides above — same .default() call-site-required gotcha.
    terminology: z.enum(["resident", "household"]).optional(),
    // Which of the 6 exec-summary KPI tiles to omit entirely (Kevin's ask). Chosen at
    // generation time, not a live post-generation toggle — the download button re-serializes
    // this API's original response string, not whatever's currently in the preview iframe, so
    // a live click-to-hide wouldn't survive into the downloaded file with today's architecture.
    // Valid keys: active_properties, residents_paying, new_residents, adoption_rate,
    // true_repeat_rate, delinquency_shielded.
    // Plain optional (not .default()), like growth_slides above — a concurrent edit changing
    // any of these to .default() would make it REQUIRED in the generated call-site type
    // (breaks every caller that doesn't pass it). Fallback handled at the usage site instead:
    // hiddenTileSet = new Set(d.hiddenTiles ?? []), and benchmarkTableHeader/benchmarkRowCells
    // treat an omitted show* flag as `!== false` → shown, so undefined already means "default".
    hidden_kpi_tiles: z.array(z.string()).optional(),
    // Property Deep Dive benchmark columns (Kevin's ask) — full per-column control, since
    // sometimes the benchmarking isn't relevant but the property listing itself still is.
    // Applies to both the celebrating and needs-attention tables (they share one structure).
    show_adoption_portfolio_avg: z.boolean().optional(),
    show_adoption_peer_median: z.boolean().optional(),
    // Engagement's Observed is toggleable (Kevin's ask) - Adoption's Observed isn't, since
    // it's the metric that decided which properties are on this table in the first place.
    show_engagement_observed: z.boolean().optional(),
    show_engagement_portfolio_avg: z.boolean().optional(),
    show_engagement_peer_median: z.boolean().optional(),
    // "Include D2C Marketing Language" QBRTab toggle (Kevin's catch: this existed in the UI
    // and updated local state, but was never actually read server-side, nor even included in
    // index.tsx's generate args - the control did nothing at all, badges always showed
    // regardless. Mirrors Flask's hide_d2c: hides the Direct Marketing on/off badge on the
    // adoption-opportunities ("needs attention") slide).
    hide_d2c: z.boolean().optional(),
    // Slides pulled in from an uploaded PDF (Import Slides picker, QBR only for now) - pages
    // are rendered to images client-side (pdf.js), so the server never touches the PDF itself.
    // anchor is "start" | "end" only in this first pass (mirrors Flask's app.py comment shape,
    // minus the "after:<slide_id>" variant - see renderImportedSlide's docstring in
    // slide-renderers.ts for why that's out of scope here). Plain optional, not .default([]) -
    // same call-site-required gotcha as every other optional field in this schema.
    imported_slides: z.array(z.object({
      anchor: z.string(),
      image_b64: z.string(),
      image_mime: z.string(),
      source_title: z.string().optional(),
      deck_title: z.string().optional(),
    })).optional(),
  }),

  output: z.object({
    html: z.string(),
    empty: z.boolean(),
    notes_html: z.string().optional(),
    // Expansion only for now (Kevin's ask) - slides the AE selected that got auto-hidden for
    // not having enough real data to make a credible chart, so the UI can tell them what
    // happened instead of leaving a silent gap they have to notice and wonder about.
    skipped_slides: z.array(z.object({ key: z.string(), label: z.string() })).optional(),
  }),

  async run(ctx, { pmc_name, second_pmc, report_name, lookback_months, deck_mode, adoption_target, testimonials, total_portfolio_units, expansion_slides, presenting_mode, comparison_months, growth_slides, sparklines, period_comparison, terminology, hidden_kpi_tiles, show_adoption_portfolio_avg, show_adoption_peer_median, show_engagement_observed, show_engagement_portfolio_avg, show_engagement_peer_median, imported_slides, hide_d2c }) {
    // Compute bp_safe_cutoff
    const today = new Date();
    const dayOfMonth = today.getDate();
    let cutoff: Date;
    if (dayOfMonth <= 5) {
      cutoff = new Date(today.getFullYear(), today.getMonth(), 1);
    } else {
      cutoff = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    }
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    // Perf fix (Kevin's catch: the 3 Zendesk queries below - testimonials/CSAT/response-time -
    // showed up as ~8.6s/7.6s/9.5s in Superblocks' own trace after the peer-matching and
    // peerCandidateRows fixes landed). Hoisted from their old position (~line 3230, right after
    // `await Promise.all([networkPoolPromise, propertyPoolPromise, ...])`) to here. A comment
    // sitting right next to networkPoolPromise below already claimed these followed the same
    // "fire early, await late" pattern - they didn't; they were only ever DEFINED after that
    // whole batch had already resolved, so they ran fully serial after it instead of overlapping
    // it. Both only depend on `pmc_name`/`testimonials`, both already-destructured function
    // params available from the first line of run() - nothing downstream of them needs to run
    // first. Moving the definition (not the await - both are still awaited at their original
    // late call sites, just before the slides that need them) costs nothing and overlaps this
    // ~9.5s (the slower of the two) with the network/property-pool batch's own ~14s instead of
    // adding to it.
    const ZendeskTestimonialSchema = z.object({
      COMMENT: z.string(),
      RESIDENT_NAME: z.string().nullable(),
      PROPERTY_NAME: z.string().nullable(),
    });
    const zendeskPromise = testimonials.length > 0
      ? null // User provided testimonials, no need to query
      : ctx.integrations.snowflake_sso.query(
          `WITH latest_prop AS (
              SELECT CUSTOMER_PUBLIC_ID, PROPERTY_NAME
              FROM PRODUCTION.ANALYTICS.CUSTOMER_BP_MONTH_OUTCOMES
              WHERE UPPER(PMC_NAME) = UPPER(?)
              QUALIFY ROW_NUMBER() OVER (PARTITION BY CUSTOMER_PUBLIC_ID ORDER BY BP_MONTH DESC) = 1
           )
           SELECT
              sr.COMMENT,
              u.NAME AS RESIDENT_NAME,
              o.PROPERTY_NAME
           FROM EXTERNAL_DATA.STITCH_ZENDESK_NEW.SATISFACTION_RATINGS sr
           JOIN EXTERNAL_DATA.STITCH_ZENDESK_NEW.USERS u
              ON u.ID = sr.REQUESTER_ID
           JOIN latest_prop o
              ON o.CUSTOMER_PUBLIC_ID = u.USER_FIELDS:customer_id::VARCHAR
           WHERE sr.SCORE = 'good'
             AND sr.COMMENT IS NOT NULL
             AND LENGTH(TRIM(sr.COMMENT)) > 50
           ORDER BY sr.CREATED_AT DESC
           LIMIT 30`,
          ZendeskTestimonialSchema,
          [pmc_name],
          { label: "Pull Zendesk testimonials for PMC" }
        ).catch(() => [] as z.infer<typeof ZendeskTestimonialSchema>[]);

    const CsatMonthSchema = z.object({
      MONTH: z.string(),
      N_TOTAL: z.number(),
      N_GOOD: z.number(),
    });
    const ResponseMonthSchema = z.object({
      MONTH: z.string(),
      N_TICKETS: z.number(),
      AVG_REPLY_MIN: z.number().nullable(),
    });
    const residentTrendPromise = Promise.all([
      ctx.integrations.snowflake_sso.query(
        `WITH latest_prop AS (
            SELECT CUSTOMER_PUBLIC_ID, PROPERTY_NAME
            FROM PRODUCTION.ANALYTICS.CUSTOMER_BP_MONTH_OUTCOMES
            WHERE UPPER(PMC_NAME) = UPPER(?)
            QUALIFY ROW_NUMBER() OVER (PARTITION BY CUSTOMER_PUBLIC_ID ORDER BY BP_MONTH DESC) = 1
         )
         SELECT
            TO_VARCHAR(DATE_TRUNC('month', sr.CREATED_AT), 'YYYY-MM-DD') AS MONTH,
            COUNT(*) AS N_TOTAL,
            SUM(CASE WHEN sr.SCORE = 'good' THEN 1 ELSE 0 END) AS N_GOOD
         FROM EXTERNAL_DATA.STITCH_ZENDESK_NEW.SATISFACTION_RATINGS sr
         JOIN EXTERNAL_DATA.STITCH_ZENDESK_NEW.USERS u ON u.ID = sr.REQUESTER_ID
         JOIN latest_prop o ON o.CUSTOMER_PUBLIC_ID = u.USER_FIELDS:customer_id::VARCHAR
         WHERE sr.SCORE IN ('good', 'bad')
           AND sr.CREATED_AT >= DATEADD(month, -12, CURRENT_DATE())
           AND sr.CREATED_AT < DATE_TRUNC('month', CURRENT_DATE())
         GROUP BY 1 ORDER BY 1`,
        CsatMonthSchema,
        [pmc_name],
        { label: "Pull monthly CSAT trend from Zendesk" }
      ).catch(() => [] as z.infer<typeof CsatMonthSchema>[]),
      ctx.integrations.snowflake_sso.query(
        `WITH latest_prop AS (
            SELECT CUSTOMER_PUBLIC_ID, PROPERTY_NAME
            FROM PRODUCTION.ANALYTICS.CUSTOMER_BP_MONTH_OUTCOMES
            WHERE UPPER(PMC_NAME) = UPPER(?)
            QUALIFY ROW_NUMBER() OVER (PARTITION BY CUSTOMER_PUBLIC_ID ORDER BY BP_MONTH DESC) = 1
         )
         SELECT
            TO_VARCHAR(DATE_TRUNC('month', t.CREATED_AT), 'YYYY-MM-DD') AS MONTH,
            COUNT(*) AS N_TICKETS,
            AVG(tm.REPLY_TIME_IN_MINUTES:business::FLOAT) AS AVG_REPLY_MIN
         FROM EXTERNAL_DATA.STITCH_ZENDESK_NEW.TICKET_METRICS tm
         JOIN EXTERNAL_DATA.STITCH_ZENDESK_NEW.TICKETS t ON t.ID = tm.TICKET_ID
         JOIN EXTERNAL_DATA.STITCH_ZENDESK_NEW.USERS u ON u.ID = t.REQUESTER_ID
         JOIN latest_prop o ON o.CUSTOMER_PUBLIC_ID = u.USER_FIELDS:customer_id::VARCHAR
         WHERE t.CREATED_AT >= DATEADD(month, -12, CURRENT_DATE())
           AND t.CREATED_AT < DATE_TRUNC('month', CURRENT_DATE())
         GROUP BY 1 ORDER BY 1`,
        ResponseMonthSchema,
        [pmc_name],
        { label: "Pull monthly response-time trend from Zendesk" }
      ).catch(() => [] as z.infer<typeof ResponseMonthSchema>[]),
    ]).catch(() => [[], []] as [z.infer<typeof CsatMonthSchema>[], z.infer<typeof ResponseMonthSchema>[]]);

    // Peer-candidate profile for GEO-TIER matching - fired here, immediately, rather than at
    // its point of use (~line 3700, after two entire sequential query batches) because its
    // inputs (pmc_name/second_pmc/cutoffStr) are already available and it depends on nothing
    // else this function computes. Awaited later at its original call site - same "fire early,
    // await late" pattern as networkPoolPromise/rollingPromise/zendeskPromise below. Performance
    // fix (Kevin's catch: GetPMCMonthlyReport taking 60+s vs Flask's ~20s) - this alone removes
    // one full sequential stage (an unbatched, standalone await) from the critical path by
    // overlapping it with the rows query and the two query batches that come after it instead.
    //
    // A SEPARATE, dedicated query at (PMC, STATE) grain, deliberately NOT built from
    // networkPoolProps. networkPoolProps is capped (top-20-properties-per-PMC, 3000 rows total)
    // to survive Superblocks' 5MB step-output limit - fine for the property-level things it's
    // built for (income lookups, T12 engagement), but fatal for geo-matching specifically: if a
    // candidate PMC's smaller in-state properties get sampled out in favor of its bigger
    // properties elsewhere, it looks state-absent here when it isn't, and a real multi-state
    // overlap match (which Flask found for this exact PMC — "true 1:1 match in NC, SC" — while
    // this port fell through to the region tier instead) never gets a chance to match. Matches
    // Flask's own pull_rolling_peer_median Step A (generator/data.py:4088-4104) exactly:
    // aggregated to (PMC_NAME, PROPERTY_STATE) grain in SQL, not fetched as raw property rows -
    // a PMC operates in a handful of states, not thousands of properties, so this is naturally
    // tiny and needs no row cap at all.
    const PeerCandidateProfileSchema = z.object({
      PMC_NAME: z.string(),
      PROPERTY_STATE: z.string(),
      UNITS: z.coerce.number().nullable(),
      RENT: z.coerce.number().nullable(),
      BILLS: z.coerce.number().nullable(),
    });
    // Excluding the subject PMC(s) from the candidate pool HERE, before resolveGeoTier ever
    // runs, is deliberate and is a KNOWN, CONFIRMED deviation from Flask - do not "fix" this to
    // match Flask's behavior. Flask's own candidate pool (pmc_state_totals in
    // _run_benchmark_query, generator/data.py:1530-1587) never excludes the subject before
    // calling _resolve_geo_tier - the subject trivially matches its own true-1:1-match tier
    // (100% concentration in its own states, by definition), so it lands in Flask's
    // overlap_names/geo_names list as one of the "matched" candidates. Only the FINAL SQL query
    // that computes peer percentiles adds `PMC_NAME != subject` (generator/data.py:1740) to
    // exclude it - which means Flask's reported peer_count always undercounts the true number
    // of matching OTHER PMCs by exactly one. Confirmed live for Wellington: Flask showed "7
    // comparable PMCs", this pool correctly finds 8 real distinct other PMCs matching the same
    // "true 1:1 match in NC, SC" criteria - the missing 8th is Wellington counting itself, then
    // subtracting itself back out. Kevin's call (2026-08-13): keep this side correct rather than
    // reproducing Flask's undercount; Flask should get the equivalent fix (exclude subject
    // before the candidate pool is built) instead.
    const peerCandidateSubjectPmcs = second_pmc ? [pmc_name, second_pmc] : [pmc_name];
    const peerCandidateRowsPromise = ctx.integrations.snowflake_sso.query(
      `SELECT PMC_NAME, PROPERTY_STATE,
              SUM(PROPERTY_UNIT_COUNT) AS UNITS,
              SUM(RENT_PAID_AMOUNT) AS RENT,
              SUM(BILLS_PAID_COUNT) AS BILLS
       FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
       WHERE IS_INTEGRATED_TOTAL = TRUE
         AND ROLLOUT_MONTH IS NOT NULL
         AND PROPERTY_STATE IS NOT NULL AND PROPERTY_STATE != ''
         AND PMC_NAME NOT IN (${peerCandidateSubjectPmcs.map(() => "?").join(", ")})
         AND BP_MONTH = (
            SELECT MAX(BP_MONTH) FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
            WHERE BP_MONTH < ? AND IS_INTEGRATED_TOTAL = TRUE
         )
       GROUP BY PMC_NAME, PROPERTY_STATE`,
      PeerCandidateProfileSchema,
      [...peerCandidateSubjectPmcs, cutoffStr],
      { label: "Peer-candidate geo profile for tier matching (PMC x state grain, unsampled)" }
    ).catch(() => [] as z.infer<typeof PeerCandidateProfileSchema>[]);

    const rows = await ctx.integrations.snowflake_sso.query(
      `SELECT
          TO_VARCHAR(BP_MONTH, 'YYYY-MM-DD') AS BP_MONTH,
          PROPERTY_NAME,
          PMC_NAME,
          PROPERTY_UNIT_COUNT,
          TO_VARCHAR(ROLLOUT_MONTH, 'YYYY-MM-DD') AS ROLLOUT_MONTH,
          CHARGED_USERS_COUNT AS CHARGED_USERS,
          COALESCE(NEW_SIGNUPS_COUNT, 0) AS NEW_SIGNUPS,
          BILLS_PAID_COUNT AS BILLS_PAID,
          COALESCE(RENT_PAID_AMOUNT, 0) AS RENT_PAID,
          PROPERTY_PUBLIC_ID,
          PROPERTY_STATE,
          IS_IN_NETWORK,
          COALESCE(NEW_BILL_CONNECTIONS_PROPERTY, 0) AS NEW_BILL_CONNECTIONS,
          HUBSPOT_DEAL_TOTAL_COMPANY_UNITS,
          STATIC_PARENT_TEAM_NAME_OPPORTUNITY AS SEGMENT_TEAM,
          HAS_MARKETING_INTEGRATION,
          IS_MARKETING_OPT_IN
       FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
       WHERE PMC_NAME = ?
         AND BP_MONTH >= DATEADD('month', -?, CURRENT_DATE())
         AND BP_MONTH < ?
       ORDER BY BP_MONTH, PROPERTY_NAME
       LIMIT 10000`,
      RawRowSchema,
      [pmc_name, lookback_months, cutoffStr],
      { label: "Fetch PMC monthly report data" }
    );

    // If a second PMC is provided, fetch its rows and merge (UNION ALL)
    let allRows = rows;
    if (second_pmc) {
      const secondRows = await ctx.integrations.snowflake_sso.query(
        `SELECT
            TO_VARCHAR(BP_MONTH, 'YYYY-MM-DD') AS BP_MONTH,
            PROPERTY_NAME,
            PMC_NAME,
            PROPERTY_UNIT_COUNT,
            TO_VARCHAR(ROLLOUT_MONTH, 'YYYY-MM-DD') AS ROLLOUT_MONTH,
            CHARGED_USERS_COUNT AS CHARGED_USERS,
            COALESCE(NEW_SIGNUPS_COUNT, 0) AS NEW_SIGNUPS,
            BILLS_PAID_COUNT AS BILLS_PAID,
            COALESCE(RENT_PAID_AMOUNT, 0) AS RENT_PAID,
            PROPERTY_PUBLIC_ID,
            PROPERTY_STATE,
            IS_IN_NETWORK,
            COALESCE(NEW_BILL_CONNECTIONS_PROPERTY, 0) AS NEW_BILL_CONNECTIONS,
            HUBSPOT_DEAL_TOTAL_COMPANY_UNITS
         FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
         WHERE PMC_NAME = ?
           AND BP_MONTH >= DATEADD('month', -?, CURRENT_DATE())
           AND BP_MONTH < ?
         ORDER BY BP_MONTH, PROPERTY_NAME
         LIMIT 10000`,
        RawRowSchema,
        [second_pmc, lookback_months, cutoffStr],
        { label: "Fetch second PMC data for merge" }
      );
      allRows = [...rows, ...secondRows];
    }

    // Display-only PMC name (FKA suffix stripped) — pmc_name itself stays untouched everywhere
    // it's used as a query parameter; this is only for what actually shows up on a slide.
    const pmcDisplayName = stripFkaSuffix(pmc_name);

    // Apply report_name override if provided
    const displayName = report_name || pmcDisplayName;

    // Filter to in-network only
    const inNetwork = allRows.filter((r) => r.IS_IN_NETWORK === true);

    if (inNetwork.length === 0) {
      return { html: "", empty: true };
    }

    // --- Additional data queries (run in parallel) ---
    const MetricsRowSchema = z.object({
      BP_MONTH: z.string(),
      NAR: z.number().nullable(),
      SEGMENT_NAR_AVG: z.number().nullable(),
      BILLS_PAID: z.number().nullable(),
      BILLS_PAID_NEW: z.number().nullable(),
      BILLS_PAID_REPEAT: z.number().nullable(),
      BILLS_PAID_PREV_MONTH: z.number().nullable(),
      RENT_PAID: z.number().nullable(),
      HUBSPOT_COMPANY_SEGMENT: z.string().nullable(),
    });

    const DqShieldedRowSchema = z.object({
      BP_MONTH: z.string().nullable(),
      TOTAL_RENT_SHIELDED: z.number().nullable(),
      RENT_NOT_COLLECTED: z.number().nullable(),
      NUMBER_OF_RESIDENTS: z.number().nullable(),
    });

    const SegmentPercentilesSchema = z.object({
      METRIC: z.string(),
      P25: z.number().nullable(),
      P50: z.number().nullable(),
      P75: z.number().nullable(),
      P90: z.number().nullable(),
      P99: z.number().nullable(),
      PMC_VALUE: z.number().nullable(),
    });

    const YearlyRentBillsSchema = z.object({
      YEAR: z.number(),
      TOTAL_RENT: z.number().nullable(),
      BILLS_PAID: z.number().nullable(),
      MONTHS_ACTIVE: z.number().nullable(),
      YTD_RENT: z.number().nullable(),
      YTD_BILLS: z.number().nullable(),
      YTD_MONTHS_ACTIVE: z.number().nullable(),
    });

    const PropertyTrendSchema = z.object({
      PROPERTY_NAME: z.string(),
      BP_MONTH: z.string(),
      BILLS_PAID_COUNT: z.number().nullable(),
      PROPERTY_UNIT_COUNT: z.number().nullable(),
      ROLLOUT_MONTH: z.string().nullable(),
      // Signup timing uses THIS, not BILLS_PAID_COUNT — "first payment" is gated by the BP
      // cycle (a property rolling out on the 2nd of a month can still make that month's bill
      // run; one rolling out on the 28th can't, purely by calendar luck, nothing to do with
      // marketing/ops), while a bill CONNECTION isn't tied to a monthly cutoff the same way.
      NEW_BILL_CONNECTIONS_PROPERTY: z.number().nullable(),
    });

    const RetentionCohortSchema = z.object({
      LOYALTY_BUCKET: z.string(),
      BUCKET_COUNT: z.number(),
      TOTAL_CUSTOMERS: z.number(),
      TRUE_REPEAT_RATE: z.number().nullable(),
    });

    // Raw (customer, month) pairs for the MoM retention chart — Flask's real method
    // (render_retention, generator/slides.py) computes MoM retention as a true customer-level
    // set intersection between consecutive months: rate = |prior month's customers ∩ this
    // month's customers| / |prior month's customers| — NOT an aggregate ratio from a
    // pre-computed "repeat" column. Same NAR_CHARGED_USERS source as the loyalty-bucket query
    // above, just unaggregated.
    const CustomerMonthSchema = z.object({
      CUSTOMER_PUBLIC_ID: z.string(),
      BP_MONTH: z.string(),
    });

    // BILLS_PAID_COUNT and T12_CONNECTIONS were declared non-nullable here, but the query
    // computes BILLS_PAID_COUNT via MAX(CASE WHEN BP_MONTH = latest THEN BILLS_PAID_COUNT END) —
    // NULL for any property where that column itself is null even in its "latest" row (a real,
    // observed case, not hypothetical: live-verified this exact query returns 78,224 real rows
    // directly against Snowflake, but the app's own networkPool ended up with 0 — the only
    // place that many real rows can vanish silently is schema validation rejecting the whole
    // array over a single non-matching row, caught by this query's outer .catch(() => []).
    // z.coerce.number() rather than z.number() on every numeric field below — the previous
    // fix (making BILLS_PAID_COUNT/T12_CONNECTIONS nullable) did NOT resolve networkPool
    // silently coming back empty despite the exact same query, live-verified, returning
    // 78,224 real rows with no error. That means the actual mismatch is a TYPE issue, not
    // (only) a nullability one — most likely FIPS_TO_CENSUS_DATA (a UDF returning a
    // semi-structured/VARIANT value) coming back as a string-shaped number rather than a
    // strict JS number, which z.number() rejects outright. z.coerce.number() accepts either.
    // (.nullable() still short-circuits real SQL NULLs before coercion ever runs, so this
    // doesn't change null-handling — only accepts non-null values in more shapes.)
    const NetworkPoolSchema = z.object({
      PMC_NAME: z.string(),
      PROPERTY_NAME: z.string(),
      PROPERTY_STATE: z.string().nullable(),
      PROPERTY_UNIT_COUNT: z.coerce.number(),
      RENT_PAID_AMOUNT: z.coerce.number().nullable(),
      BILLS_PAID_COUNT: z.coerce.number().nullable(),
      ROLLOUT_MONTH: z.string().nullable(),
      T12_CONNECTIONS: z.coerce.number().nullable(),
      MEDIAN_RENTER_INCOME: z.coerce.number().nullable(),
    });

    const RegionDetailSchema = z.object({
      PROPERTY_STATE: z.string(),
      PROPERTY_REGION: z.string(),
      PROPERTIES: z.number(),
      TOTAL_UNITS: z.number(),
      BILLS_PAID: z.number(),
    });

    // Compute cutoff month number for YTD calculation
    const cutoffMonthNum = cutoff.getMonth() === 0 ? 12 : cutoff.getMonth();

    // Reporting month = most recent fully-completed month with real, in-network data for this
    // PMC (used for the retention-cohort eligibility cutoff below). Previously guessed as
    // "cutoff minus one calendar month" before any query had run — that guess can genuinely
    // disagree with the PMC's real latest reported month, which shifts who counts as "eligible"
    // in the retention-cohort query and skews the true-repeat-rate / loyalty-bucket numbers.
    // `rows` (fetched above, ORDER BY BP_MONTH ascending) is already resolved by this point, so
    // derive the real value directly from it instead of approximating.
    //
    // Requires CHARGED_USERS > 0, matching Flask's _latest_completed_month (generator/data.py:
    // 370-399), which explicitly requires real billing data, not just an IS_IN_NETWORK flag —
    // a month can be flagged in-network before its billing data has actually landed. Using only
    // IS_IN_NETWORK let a billing-lagged month count as "reporting month," which pushed this
    // anchor date later than Flask's, diluting the retention-cohort's eligible pool with
    // brand-new signups who hadn't had a chance to repeat yet (this is what was pulling
    // true_repeat_rate below Flask's real number). `latestCompletedMonth` (computed further
    // down from monthlyTotals) is the same concept but isn't available yet at this point in
    // the pipeline — this mirrors its exact filter using the already-fetched `rows` instead.
    const currentMonthStrForReporting = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
    const inNetworkBpMonths = rows
      .filter((r) => r.IS_IN_NETWORK && r.CHARGED_USERS > 0
        && !(dayOfMonth <= 5 && r.BP_MONTH === currentMonthStrForReporting))
      .map((r) => r.BP_MONTH);
    const reportingMonthStr = inNetworkBpMonths.length > 0
      ? inNetworkBpMonths[inNetworkBpMonths.length - 1]
      : new Date(cutoff.getFullYear(), cutoff.getMonth() - 1, 1).toISOString().slice(0, 10);

    // For expansion/new_logo modes, skip expensive queries that are only used by QBR:
    // - yearlyRentBillsRows: Since Inception slide (QBR only)
    // - trendRawRows: Property trend badges (QBR appendix only)
    const needsQBRQueries = deck_mode === "qbr";

    // --- Network property pool (QBR only) — fired here, BEFORE the batch below, instead of
    // after it finishes. Per Clark: the "IntegrationError code 4" failures aren't a broken
    // Snowflake connection (SELECT 1 works fine) — they're the overall API step's time budget
    // running out and Superblocks killing whatever query is still in flight, which reports back
    // as a generic integration error rather than a clean timeout. This query used to only start
    // AFTER the first Promise.all (6 queries) fully resolved, meaning it queued behind ~12 other
    // queries before even beginning — and it's by far the heaviest single query in the whole
    // report (15,000-row cap + a UDF chain), so it was consistently the one still running when
    // the budget ran out. Starting it here, in parallel with everything else, gives it the same
    // wall-clock head start as every other query instead of a ~12-query handicap.
    // Currently write-only (its debug-panel reader was removed) - kept, not deleted, since it's
    // a real query result and this file's own comments document real cost-diagnosis history
    // around it; underscore-prefixed per this codebase's convention for intentionally-idle
    // diagnostics rather than silently dropping a traced pipeline.
    let _networkPool: NetworkPoolRow[] = [];
    // Dedicated property-level peer pool (Flask's pull_network_property_pool,
    // generator/data.py:4900-5066) — see the full comment on PROPERTY_POOL_SQL below for why
    // this can't just reuse networkPool.
    let propertyPool: NetworkPoolRow[] = [];
    // Also currently write-only (debug-panel reader removed); underscore-prefixed for the same
    // reason as _networkPool above.
    let _propertyPoolError: string | null = null;
    // TEMPORARY diagnostic — captures the real error instead of silently swallowing it.
    let _networkPoolError: string | null = null;
    const NETWORK_POOL_SQL = `WITH prop_zip AS (
                SELECT PROPERTY_PUBLIC_ID, PROPERTY_ZIP,
                       ROW_NUMBER() OVER (PARTITION BY PROPERTY_PUBLIC_ID ORDER BY CREATED_AT_UTC DESC) AS rn
                FROM PRODUCTION.ANALYTICS.DIM_PROPERTIES_PMCS
             ),
             latest AS (
                -- cutoffStr is an EXCLUSIVE upper bound (1st of the next allowed month) — using
                -- <= here let it match that exact stub month, which Snowflake pre-creates with
                -- zeroed/null billing columns before it has real data. Every peer's "latest"
                -- resolved to that empty month, zeroing out NAR/avg-rent for the entire network
                -- pool and breaking every rent-matched peer tier. Must be strict <.
                SELECT MAX(BP_MONTH) AS bp_month
                FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
                WHERE BP_MONTH < ? AND IS_INTEGRATED_TOTAL = TRUE
             ),
             agg AS (
                SELECT
                  PMC_NAME, PROPERTY_NAME,
                  MAX(CASE WHEN BP_MONTH = (SELECT bp_month FROM latest) THEN PROPERTY_STATE END) AS PROPERTY_STATE,
                  MAX(CASE WHEN BP_MONTH = (SELECT bp_month FROM latest) THEN PROPERTY_UNIT_COUNT END) AS PROPERTY_UNIT_COUNT,
                  MAX(CASE WHEN BP_MONTH = (SELECT bp_month FROM latest) THEN RENT_PAID_AMOUNT END) AS RENT_PAID_AMOUNT,
                  MAX(CASE WHEN BP_MONTH = (SELECT bp_month FROM latest) THEN BILLS_PAID_COUNT END) AS BILLS_PAID_COUNT,
                  MAX(ROLLOUT_MONTH) AS ROLLOUT_MONTH,
                  SUM(CASE WHEN BP_MONTH >= DATEADD('month', -12, (SELECT bp_month FROM latest))
                            AND BP_MONTH <= (SELECT bp_month FROM latest)
                       THEN NEW_BILL_CONNECTIONS_PROPERTY ELSE 0 END) AS T12_CONNECTIONS,
                  ANY_VALUE(PROPERTY_PUBLIC_ID) AS PROPERTY_PUBLIC_ID
                FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
                WHERE IS_INTEGRATED_TOTAL = TRUE
                  AND ROLLOUT_MONTH IS NOT NULL
                  -- Real fix for the "IntegrationError code 4" failures: this GROUP BY was
                  -- scanning/aggregating EVERY property's ENTIRE history network-wide with no
                  -- date bound at all — by far the most expensive thing in the whole report
                  -- (every other query here is scoped to one PMC or a short peer list). Nothing
                  -- this CTE computes needs data older than 13 months back from "latest" — the
                  -- MAX(CASE WHEN BP_MONTH = latest ...) columns only ever read the single latest
                  -- month, and T12_CONNECTIONS' own SUM(CASE...) already only looks back 12
                  -- months from latest. Bounding the scan to that same window cuts the aggregated
                  -- row count by the same ratio as (network lifetime in months / 13) for any
                  -- property with more history than that, with an identical result.
                  AND BP_MONTH >= DATEADD('month', -13, (SELECT bp_month FROM latest))
                  AND BP_MONTH <= (SELECT bp_month FROM latest)
                GROUP BY PMC_NAME, PROPERTY_NAME
             ),
             subject_rows AS (
                -- ALWAYS include the subject PMC's (and second_pmc's, if any) own properties,
                -- unconditionally, regardless of the peer-sampling cap below. A single PMC never
                -- has anywhere near enough properties to threaten the byte-size cap, but without
                -- this, an unordered LIMIT over the full network can arbitrarily exclude the very
                -- PMC this report is being generated for. (Historical note: this originally
                -- guarded a subjectPoolProps read of this pool for the subject's own engagement
                -- stat — that stat has since been moved to read directly from allRows/inNetwork
                -- instead, per the engagement fix elsewhere in this file, so this CTE no longer
                -- protects that specific stat. Left in place since the general principle — a
                -- report should never silently lose its own subject's rows to an unordered cap —
                -- still holds for whatever else reads this pool.)
                SELECT PMC_NAME, PROPERTY_NAME, PROPERTY_STATE, PROPERTY_UNIT_COUNT,
                       RENT_PAID_AMOUNT, BILLS_PAID_COUNT, ROLLOUT_MONTH, T12_CONNECTIONS,
                       PROPERTY_PUBLIC_ID
                FROM agg
                WHERE PMC_NAME IN (?, ?)
             ),
             peer_candidates AS (
                -- Peer sample: filtered + capped, but spread across PMCs (top 20 properties per
                -- PMC by unit count) instead of an arbitrary unordered slice of the whole network.
                -- An unordered LIMIT lets Snowflake return whatever 3000 rows it happens to scan
                -- first, which can be dominated by one or two large PMCs and starve the rest --
                -- this is almost certainly why the peer-median line came back flatter than the
                -- real (unbounded) calculation. Spreading per-PMC keeps the sample representative
                -- across the network instead of a lottery draw.
                SELECT PMC_NAME, PROPERTY_NAME, PROPERTY_STATE, PROPERTY_UNIT_COUNT,
                       RENT_PAID_AMOUNT, BILLS_PAID_COUNT, ROLLOUT_MONTH, T12_CONNECTIONS,
                       PROPERTY_PUBLIC_ID
                FROM (
                   SELECT PMC_NAME, PROPERTY_NAME, PROPERTY_STATE, PROPERTY_UNIT_COUNT,
                          RENT_PAID_AMOUNT, BILLS_PAID_COUNT, ROLLOUT_MONTH, T12_CONNECTIONS,
                          PROPERTY_PUBLIC_ID,
                          ROW_NUMBER() OVER (PARTITION BY PMC_NAME ORDER BY PROPERTY_UNIT_COUNT DESC) AS rn
                   FROM agg
                   WHERE PROPERTY_UNIT_COUNT >= 10
                     AND PROPERTY_STATE IS NOT NULL AND PROPERTY_STATE != ''
                     AND PMC_NAME NOT IN (?, ?)
                )
                WHERE rn <= 20
                -- Per Clark: Superblocks enforces a ~5MB step-output size limit, and 15000 rows
                -- x 9 columns, serialized with full JSON keys per row, plausibly lands right at
                -- that ceiling -- a FIXED row limit hitting a FIXED byte cap fails identically
                -- every single time, exactly what was observed across 3 different query bodies.
                -- Cut hard to 3000 as a decisive test, comfortably clear of 5MB even at a
                -- generous worst-case ~500 bytes/row (~1.5MB total); can be tuned back up now
                -- that the cap is confirmed.
                --
                -- ORDER BY here is NOT optional. Snowflake gives no row-order guarantee for a
                -- LIMIT with nothing ordering it -- which 3000 rows out of the full qualifying
                -- pool actually survive can differ between two runs of the IDENTICAL query
                -- against IDENTICAL data. That reshuffles which PMCs' properties get counted,
                -- which reshuffles the tier-matching JS does downstream, which reshuffles who
                -- ends up in lockedPeers -- this is what made the peer median swing wildly
                -- between two reports generated 5 minutes apart with no real data change.
                -- PMC_NAME, rn gives a fully stable, reproducible selection (alphabetical, then
                -- each PMC's own top properties by size) -- deterministic, at the cost of a
                -- mild bias toward alphabetically-early PMCs if the true pool exceeds 3000,
                -- which is a far better trade than "random each run."
                ORDER BY PMC_NAME, rn
                LIMIT 3000
             ),
             candidates AS (
                SELECT * FROM subject_rows
                UNION ALL
                SELECT * FROM peer_candidates
             )
             SELECT c.PMC_NAME, c.PROPERTY_NAME, c.PROPERTY_STATE, c.PROPERTY_UNIT_COUNT,
                    c.RENT_PAID_AMOUNT, c.BILLS_PAID_COUNT, c.ROLLOUT_MONTH, c.T12_CONNECTIONS,
                    PRODUCTION.ANALYTICS.FIPS_TO_CENSUS_DATA(
                        PRODUCTION.ANALYTICS.ZIP_TO_FIPS(LEFT(p.PROPERTY_ZIP, 5)),
                        'median_renter_household_income'
                    ) AS MEDIAN_RENTER_INCOME
             FROM candidates c
             LEFT JOIN prop_zip p
               ON p.PROPERTY_PUBLIC_ID = c.PROPERTY_PUBLIC_ID AND p.rn = 1`;
    // Region detail (DMA sub-region breakdown, "By State" slide's drill-down rows) - Kevin's
    // ask: Expansion's own "By State" slide never got this even though QBR's has had it all
    // along. Hoisted out of the QBR-only batch below (same "fire early" pattern networkPoolPromise
    // already uses) and gated on its OWN flag rather than needsQBRQueries, since this one query
    // is cheap (scoped to a single subject PMC, no network-wide scan, no UDF chain) and safe to
    // also run for Expansion - unlike network pool/property pool just below, which stay QBR-only
    // on purpose (that's real, deliberately-tuned query cost this session already fought to keep
    // under control; Kevin didn't ask for those in Expansion, so they're untouched).
    const needsRegionDetail = needsQBRQueries || deck_mode === "expansion";
    const regionDetailPromise = !needsRegionDetail
      ? Promise.resolve([] as { PROPERTY_STATE: string; PROPERTY_REGION: string; PROPERTIES: number; TOTAL_UNITS: number; BILLS_PAID: number }[])
      : ctx.integrations.snowflake_sso.query(
          `WITH prop_zip AS (
              SELECT PROPERTY_PUBLIC_ID, PROPERTY_ZIP,
                     ROW_NUMBER() OVER (PARTITION BY PROPERTY_PUBLIC_ID ORDER BY CREATED_AT_UTC DESC) AS rn
              FROM PRODUCTION.ANALYTICS.DIM_PROPERTIES_PMCS
           )
           SELECT
              t.PROPERTY_STATE                            AS PROPERTY_STATE,
              COALESCE(dma.DMA_NAME, 'Unknown')           AS PROPERTY_REGION,
              COUNT(DISTINCT t.PROPERTY_NAME)             AS PROPERTIES,
              SUM(t.PROPERTY_UNIT_COUNT)                  AS TOTAL_UNITS,
              SUM(t.BILLS_PAID_COUNT)                     AS BILLS_PAID
           FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS t
           LEFT JOIN prop_zip p
             ON p.PROPERTY_PUBLIC_ID = t.PROPERTY_PUBLIC_ID AND p.rn = 1
           LEFT JOIN PRODUCTION.SEEDS.SEED_ZIP_CODE_TO_DMA_MAPPING dma
             ON dma.ZIP_CODE = LEFT(p.PROPERTY_ZIP, 5)
           WHERE t.PMC_NAME = ?
             AND t.BP_MONTH = ?
             AND t.IS_IN_NETWORK = TRUE
             AND t.PROPERTY_STATE IS NOT NULL AND t.PROPERTY_STATE != ''
           GROUP BY t.PROPERTY_STATE, COALESCE(dma.DMA_NAME, 'Unknown')
           ORDER BY t.PROPERTY_STATE, BILLS_PAID DESC`,
          RegionDetailSchema,
          [pmc_name, reportingMonthStr],
          { label: "Pull DMA region detail for geo slide dropdowns" }
        ).catch(() => [] as { PROPERTY_STATE: string; PROPERTY_REGION: string; PROPERTIES: number; TOTAL_UNITS: number; BILLS_PAID: number }[]);

    const networkPoolPromise = !needsQBRQueries
      ? Promise.resolve([] as NetworkPoolRow[])
      : (async (): Promise<NetworkPoolRow[]> => {
          // Retry-with-backoff is separate, cheap insurance against any additional transient
          // blip on top of the timeout fix above — harmless if the timeout fix alone is enough.
          const maxAttempts = 3;
          let lastErr: unknown = null;
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
              // second_pmc defaults to "" (never undefined, per the input schema) when not
              // provided -- duplicating pmc_name in its place is a harmless no-op for both the
              // IN and NOT IN clauses (a repeated value changes nothing), and keeps exactly 2
              // placeholders in each clause regardless of whether a second PMC was passed.
              const subjectPmcsForPool = [pmc_name, second_pmc || pmc_name];
              const netRows = await ctx.integrations.snowflake_sso.query(
                NETWORK_POOL_SQL,
                NetworkPoolSchema,
                [cutoffStr, ...subjectPmcsForPool, ...subjectPmcsForPool],
                { label: "Pull network property pool for peer matching (incl. median renter income for RTI tier)" }
              );
              _networkPoolCache = { cutoff: cutoffStr, data: netRows, fetchedAt: Date.now() };
              return netRows;
            } catch (err) {
              lastErr = err;
              if (attempt < maxAttempts) {
                await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
              }
            }
          }
          // TEMPORARY diagnostic — err.message alone was just a generic Superblocks wrapper
          // ("Integration ... failed during 'query'") with no real Snowflake-side detail. Walk
          // every own-enumerable property (err.cause, err.response, err.details, etc. — whatever
          // this integration error shape actually carries) so the debug panel surfaces the real
          // underlying failure instead of the wrapper text alone.
          const err = lastErr;
          const base = err instanceof Error ? err.message : String(err);
          let extra = "";
          try {
            const props = err && typeof err === "object" ? Object.getOwnPropertyNames(err) : [];
            const extraProps = props.filter((p) => p !== "message" && p !== "stack");
            if (extraProps.length > 0) {
              const dump: Record<string, unknown> = {};
              for (const p of extraProps) dump[p] = (err as Record<string, unknown>)[p];
              extra = " | extra: " + JSON.stringify(dump, null, 0).slice(0, 2000);
            }
          } catch {
            // ignore — best-effort diagnostic only
          }
          _networkPoolError = `${base}${extra} (failed after ${maxAttempts} attempts)`;
          return [] as NetworkPoolRow[];
        })();

    // Dedicated property-level peer pool — Flask's real pull_network_property_pool
    // (generator/data.py:4900-5066), NOT a reuse of networkPool above. networkPool is
    // deliberately SAMPLED (top 20 properties per PMC by unit count, capped at 3000 total) to
    // stay under Superblocks' ~5MB step-output limit for PMC-level geo-tier matching, where
    // that sampling is a reasonable trade-off. Per-property peer matching (resolvePropertyPeerNar/
    // resolvePropertyPeerEngagement below) was reading from that SAME sampled pool though —
    // confirmed live: per-property peer medians on the Property Deep Dive slide came back
    // close-but-not-exact vs Flask across the board (e.g. adoption peer median 15.4% vs
    // Flask's 11.7%, engagement 29 vs 30), even for tiny 12-unit sister properties that should
    // land in an identical peer bucket. Root cause: the top-20-per-PMC cap silently drops most
    // small/mid-size properties from every PMC, and the 3000-row cap drops entire
    // alphabetically-late PMCs once the true network exceeds it — exactly the kind of
    // systematic bias that shows up as "close but consistently off," not random noise. Flask's
    // real pool has no such sampling at all.
    // months_live >= 7 (Flask's own filter) is pushed into a HAVING clause here specifically
    // to shrink the response payload before it hits Snowflake's wire, since that's the actual
    // constraint surface — not to introduce new filtering behavior. The other Flask filter
    // (rent band 700-2500, bypassed when bills_paid_count < 3) stays a JS post-filter below,
    // matching the existing pattern; it's a much smaller row-count lever than months_live and
    // doesn't need to move.
    // CORRECTION #2 (verified live against real Snowflake data — measured actual JSON payload
    // bytes, not estimated): the flat 8,000-row hash-ordered sample from the previous version of
    // this comment was itself the bug, just a different one than "no cap needed." A flat random
    // sample applies the SAME retention rate (8,000/55,901 ≈ 14.3%) to every (state, age_bucket)
    // cell regardless of that cell's real size — fine for a large cell (NC's 37+mo bucket has
    // 2,184 real rows, retains ~310), but for a genuinely small cell a 14.3% sample can land
    // right at or below min_peers=8 by pure chance. Confirmed live: Congaree Villas (SC, 9mo -
    // the "7-12mo" bucket) has only 69 real qualifying candidates network-wide in its exact
    // state+size band; the flat sample retained exactly 8 (barely enough for the loosest
    // no-rent tier, nowhere near enough after an RTI/rent filter), while Flask's unsampled data
    // found 40 passing its rent-adjusted tier. Every other metric's peer bands had already
    // reconciled almost exactly by this point, so this was the last real gap.
    // Fix: STRATIFY the cap per (state, age_bucket) cell instead of sampling flat -
    // ROW_NUMBER() OVER (PARTITION BY PROPERTY_STATE, age_bucket ORDER BY HASH(...)) capped at
    // 80. Any cell at or under 80 real rows (the overwhelming majority - Congaree's 69 included)
    // keeps ALL of them, zero sampling loss; only cells bigger than 80 (which have plenty of
    // margin above any min_peers threshold even after capping) get trimmed. Measured the real
    // wire payload directly (not the ~500 bytes/row guess from the first version of this query):
    // actual is ~278 bytes/row for this exact 9-column shape, so a ~16,000-row result under this
    // scheme is ~4.5MB - comfortably under Superblocks' ~5MB limit with real margin, not a guess.
    // age_bucket here matches _property_age_bucket exactly (generator/data.py:4886, and this
    // file's own propertyAgeBucket) - only 7-12mo..37+mo are ever reachable since months_live>=7
    // is already enforced above, but the full scheme is kept for the same "consistency with the
    // rest of this file" reason Flask's own docstring gives.
    // CORRECTION #3 (verified live): this query was STILL failing in Superblocks
    // (IntegrationError code 4, pluginName "JavaScript SDK API") even after the stratified-
    // sampling fix above - confirmed via the retry+error-dump diagnostic that it fails
    // identically all 3 attempts, i.e. a consistent, reproducible cost problem, not a transient
    // blip. Verified directly against Snowflake outside Superblocks: this exact query with the
    // FIPS_TO_CENSUS_DATA/ZIP_TO_FIPS UDF chain (for MEDIAN_RENTER_INCOME, feeding ONLY the
    // optional RTI-adjusted-rent tier 0 in resolvePropertyPeerMetric) takes 8.5s; the identical
    // query with that UDF chain removed takes 2.9s - the UDF chain alone is ~66% of this query's
    // cost, evaluated once per sampled row (up to 16,144 times). networkPool's own query has the
    // same UDF chain but only ever evaluates it 3,080 times and succeeds reliably - strong
    // evidence the UDF chain's cost, not row count or payload size, is what's tipping this query
    // over Superblocks' real (undocumented) per-query cost ceiling under production concurrency
    // that an isolated test doesn't reproduce.
    // Fix: drop the UDF chain (and its prop_zip CTE/join) entirely, selecting MEDIAN_RENTER_INCOME
    // as a literal NULL. Tier 0 (RTI-adjusted rent) will never fire for property-level peer
    // matching as a result - _resolve_property_peer_metric's own hasIncome gate requires a real
    // (non-null) income value on the candidate side, so it falls through to tier 1 (same state +
    // size + raw rent) instead, same as it already does for any candidate lacking income data
    // today. This is a real feature loss (a somewhat less precise rent comparison for the
    // fraction of properties that would have hit tier 0), but strictly better than the current
    // state, where propertyPool is empty and NO per-property peer matching works at all.
    // CORRECTION #4 (verified live via the version marker below): the UDF-chain removal above
    // was NOT sufficient on its own - PROPERTY_POOL_SQL_VERSION "v4-no-udf-stratified-80"
    // confirmed in the debug panel that the UDF-free query genuinely ran and still failed
    // identically. Rules out both the UDF-chain theory (on its own) AND a working-tree sync-lag
    // repeat (the version marker proved the new code was live). What's left: raw row count.
    // networkPool's own query succeeds reliably at 3,080 rows; this query, even UDF-free, was
    // still 16,144 rows - over 5x larger. Cutting the per-cell cap to 15 (3,521 rows total)
    // confirmed live: it works. Two real data points now: 3,521 succeeds, 16,144 fails - the
    // real threshold sits somewhere between them.
    // Cap=15 was a real completeness cost (Congaree Villas' 69-row SC cell kept only 15 of
    // them), so once cap=15 was confirmed working, raised it to 30 (6,780 rows, measured 4.4s
    // standalone) - confirmed working in production too.
    // At cap=30, a real second-order issue surfaced: several tiny (10-20 unit), mature (37+mo)
    // NC/SC properties (the CumTow sister properties) showed an adoption peer median of exactly
    // 0.0%, which looked wrong but wasn't fabricated - verified live against the true unsampled
    // population that ~31% of tiny mature Southeast properties genuinely have zero bills paid
    // that month (true median across 154 real candidates is ~10%, not 0%). The problem was
    // sample SIZE, not sample correctness: the region-tier match for these properties was
    // landing on only ~9 peers after cap=30 thinned the pool, small enough that a real 31%-
    // zero-mass population can swing the reported median all the way to 0% by chance. Raised
    // to 45 (9,827 rows, verified this specific tiny-Southeast segment's candidate count grows
    // from 82 to 121 going 30->45) - confirmed working in production, 0%-median issue resolved.
    // Kevin asked to push further for a more compelling sample size generally; raised to 60
    // (12,648 rows, verified live 4.4s standalone) - this is closer to the confirmed-failing
    // 16,144 than earlier steps (~78% of the way there vs. ~61% at cap=45), so if this specific
    // step fails, the real threshold is somewhere between 45 and 60, not further out.
    // TEMPORARY diagnostic — this exact query has failed identically ("IntegrationError code 4")
    // across two substantively different versions now (stratified-with-UDF, then stratified-
    // without-UDF), and Superblocks' error text is too generic to tell whether that's the same
    // underlying cost problem persisting or another instance of the working-tree sync-lag that's
    // hit this session repeatedly. A version marker in the debug panel removes the ambiguity:
    // if the NEXT failure shows this exact string, we know for certain the UDF-free query is
    // really what ran and the problem is something else entirely; if the panel is missing this
    // line or shows old debugInfo shape, the working tree is still stale.
    // CORRECTION #5 (Kevin's catch): stratifying by (state, age_bucket) alone, with no size
    // dimension, meant the retained 60 rows per cell were a RANDOM hash-ordered sample across
    // every size in that state/age combo - a property's own size-matched tier (±40% units,
    // e.g. resolvePropertyPeerNar's tier 1/2) then had to filter that already-random 60 down
    // further, and for a size band far from the cell's bulk, could land on anywhere from 0 to
    // a handful of real candidates. Confirmed real: LC Dublin (552 units, OH, 13-18mo) showed
    // a peer median of 7.2% one run and 0.0% another, vs. Flask's real unsampled 1.7% - not
    // sample-size noise at a stable N, but the SAMPLE ITSELF changing composition run to run
    // because size was never part of what the cap preserved.
    // Fix: add a size-bucket dimension to the partition key, cap reduced from 60 to 10 per
    // (state, age_bucket, size_bucket) cell (6 size buckets x 10 = 60 worst-case per original
    // (state, age_bucket) cell - same ceiling as before for a maximally dense cell, but now
    // every size band within it is guaranteed representation instead of a coin flip). Real
    // total row count should come in AT OR BELOW today's ~12,648 (most cells aren't dense
    // enough to hit 10 in every size band, let alone 60 in aggregate) - not expected to
    // reopen the IntegrationError code 4 cost ceiling documented above, but worth confirming
    // live after this ships.
    // Version-history marker, no remaining reader since its debug-panel display was removed;
    // underscore-prefixed rather than deleted, so a future diagnostic pass can find this thread.
    const _PROPERTY_POOL_SQL_VERSION = "v9-no-udf-stratified-state-age-size-10";
    const PROPERTY_POOL_SQL = `WITH latest AS (
                SELECT MAX(BP_MONTH) AS bp_month
                FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
                WHERE BP_MONTH < ? AND IS_INTEGRATED_TOTAL = TRUE
             ),
             agg AS (
                SELECT
                  PMC_NAME, PROPERTY_NAME,
                  MAX(CASE WHEN BP_MONTH = (SELECT bp_month FROM latest) THEN PROPERTY_STATE END) AS PROPERTY_STATE,
                  MAX(CASE WHEN BP_MONTH = (SELECT bp_month FROM latest) THEN PROPERTY_UNIT_COUNT END) AS PROPERTY_UNIT_COUNT,
                  MAX(CASE WHEN BP_MONTH = (SELECT bp_month FROM latest) THEN RENT_PAID_AMOUNT END) AS RENT_PAID_AMOUNT,
                  MAX(CASE WHEN BP_MONTH = (SELECT bp_month FROM latest) THEN BILLS_PAID_COUNT END) AS BILLS_PAID_COUNT,
                  MAX(ROLLOUT_MONTH) AS ROLLOUT_MONTH,
                  SUM(CASE WHEN BP_MONTH >= DATEADD('month', -12, (SELECT bp_month FROM latest))
                            AND BP_MONTH <= (SELECT bp_month FROM latest)
                       THEN NEW_BILL_CONNECTIONS_PROPERTY ELSE 0 END) AS T12_CONNECTIONS,
                  ANY_VALUE(PROPERTY_PUBLIC_ID) AS PROPERTY_PUBLIC_ID
                FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
                WHERE IS_INTEGRATED_TOTAL = TRUE
                  AND ROLLOUT_MONTH IS NOT NULL
                  -- Lossless perf optimization, same reasoning as networkPool's identical bound:
                  -- nothing below reads data older than 13mo back from "latest".
                  AND BP_MONTH >= DATEADD('month', -13, (SELECT bp_month FROM latest))
                  AND BP_MONTH <= (SELECT bp_month FROM latest)
                GROUP BY PMC_NAME, PROPERTY_NAME
                HAVING MAX(CASE WHEN BP_MONTH = (SELECT bp_month FROM latest) THEN PROPERTY_UNIT_COUNT END) >= 10
                   AND MAX(CASE WHEN BP_MONTH = (SELECT bp_month FROM latest) THEN PROPERTY_STATE END) IS NOT NULL
                   AND MAX(CASE WHEN BP_MONTH = (SELECT bp_month FROM latest) THEN PROPERTY_STATE END) != ''
                   AND DATEDIFF('month', MAX(ROLLOUT_MONTH), (SELECT bp_month FROM latest)) >= 7
             ),
             ranked AS (
                SELECT *,
                       ROW_NUMBER() OVER (
                         PARTITION BY PROPERTY_STATE,
                           CASE
                             WHEN DATEDIFF('month', ROLLOUT_MONTH, (SELECT bp_month FROM latest)) <= 3  THEN '1-3mo'
                             WHEN DATEDIFF('month', ROLLOUT_MONTH, (SELECT bp_month FROM latest)) <= 6  THEN '4-6mo'
                             WHEN DATEDIFF('month', ROLLOUT_MONTH, (SELECT bp_month FROM latest)) <= 12 THEN '7-12mo'
                             WHEN DATEDIFF('month', ROLLOUT_MONTH, (SELECT bp_month FROM latest)) <= 18 THEN '13-18mo'
                             WHEN DATEDIFF('month', ROLLOUT_MONTH, (SELECT bp_month FROM latest)) <= 24 THEN '19-24mo'
                             WHEN DATEDIFF('month', ROLLOUT_MONTH, (SELECT bp_month FROM latest)) <= 36 THEN '25-36mo'
                             ELSE '37+mo'
                           END,
                           -- Size bucket - roughly doubling steps, aligned with the ±40%
                           -- relative-size tiers resolvePropertyPeerMetric filters by
                           -- downstream, so no size band gets starved by a cap that only
                           -- ever preserved state+age composition.
                           CASE
                             WHEN PROPERTY_UNIT_COUNT < 50   THEN 'xs'
                             WHEN PROPERTY_UNIT_COUNT < 100  THEN 'sm'
                             WHEN PROPERTY_UNIT_COUNT < 200  THEN 'md'
                             WHEN PROPERTY_UNIT_COUNT < 400  THEN 'lg'
                             WHEN PROPERTY_UNIT_COUNT < 800  THEN 'xl'
                             ELSE 'xxl'
                           END
                         ORDER BY HASH(PMC_NAME, PROPERTY_NAME)
                       ) AS rn
                FROM agg
             ),
             sampled AS (
                SELECT * FROM ranked WHERE rn <= 10
             )
             SELECT PMC_NAME, PROPERTY_NAME, PROPERTY_STATE, PROPERTY_UNIT_COUNT,
                    RENT_PAID_AMOUNT, BILLS_PAID_COUNT, ROLLOUT_MONTH, T12_CONNECTIONS,
                    NULL AS MEDIAN_RENTER_INCOME
             FROM sampled`;
    const propertyPoolPromise = !needsQBRQueries
      ? Promise.resolve([] as NetworkPoolRow[])
      : (async (): Promise<NetworkPoolRow[]> => {
          // Confirmed live: this exact query, run directly against Snowflake outside
          // Superblocks, returns 16,144 real rows in ~9s with no error - so the generic
          // "IntegrationError ... failed during 'query'" here is Superblocks-integration-layer
          // specific (timeout under real concurrent load, a payload/driver difference from the
          // isolated test, or a transient blip), not a SQL problem. Same retry-with-backoff +
          // rich-error-dump pattern as networkPoolPromise above, for the same reason: get real
          // diagnostic signal instead of guessing again.
          const maxAttempts = 3;
          let lastErr: unknown = null;
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
              return await ctx.integrations.snowflake_sso.query(
                PROPERTY_POOL_SQL,
                NetworkPoolSchema,
                [cutoffStr],
                { label: "Pull network-wide property pool for per-property peer matching, stratified per state x age-bucket cell (Property Deep Dive)" }
              );
            } catch (err) {
              lastErr = err;
              if (attempt < maxAttempts) {
                await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
              }
            }
          }
          const err = lastErr;
          const base = err instanceof Error ? err.message : String(err);
          let extra = "";
          try {
            const props = err && typeof err === "object" ? Object.getOwnPropertyNames(err) : [];
            const extraProps = props.filter((p) => p !== "message" && p !== "stack");
            if (extraProps.length > 0) {
              const dump: Record<string, unknown> = {};
              for (const p of extraProps) dump[p] = (err as Record<string, unknown>)[p];
              extra = " | extra: " + JSON.stringify(dump, null, 0).slice(0, 2000);
            }
          } catch {
            // ignore — best-effort diagnostic only
          }
          _propertyPoolError = `${base}${extra} (failed after ${maxAttempts} attempts)`;
          return [] as NetworkPoolRow[];
        })();

    const SubjectSignupTimingSchema = z.object({
      PROPERTY_NAME: z.string(),
      ROLLOUT_DATE: z.string(),
      FIRST_CONNECTED_AT: z.string(),
    });
    const [metricsRows, dqShieldedRows, yearlyRentBillsRows, trendRawRows, retentionCohortRows, customerMonthRows, subjectSignupTimingRows] = await Promise.all([
      ctx.integrations.snowflake_sso.query(
        `SELECT TO_VARCHAR(BP_MONTH, 'YYYY-MM-DD') AS BP_MONTH, NAR, SEGMENT_NAR_AVG,
                BILLS_PAID, BILLS_PAID_NEW, BILLS_PAID_REPEAT, BILLS_PAID_PREV_MONTH,
                RENT_PAID, HUBSPOT_COMPANY_SEGMENT
         FROM PRODUCTION.EXTERNAL_REPORTING.PARTNER_REPORTING_CORE_METRICS
         WHERE PMC_NAME = ?
           AND BP_MONTH >= DATEADD('month', -?, CURRENT_DATE())
         ORDER BY BP_MONTH
         LIMIT 100`,
        MetricsRowSchema,
        [pmc_name, lookback_months],
        { label: "Fetch PMC core metrics (repeat rate, segment NAR)" }
      ),
      ctx.integrations.snowflake_sso.query(
        // Stays a fixed 13-month pull (a safe superset covering the Delinquency slide's own
        // 12-month display cap) regardless of the report's own lookback_months — that slide's
        // trend chart always wants the full window. The exec-summary tile's period-scoped
        // figure (Full/Quarter/YTD) is computed separately below by filtering dqShieldedRows
        // to lookback_months, not by shrinking this pull.
        `SELECT TO_VARCHAR(BP_MONTH, 'YYYY-MM-DD') AS BP_MONTH,
                SUM(TOTAL_RENT_SHIELDED) AS TOTAL_RENT_SHIELDED,
                SUM(RENT_NOT_COLLECTED) AS RENT_NOT_COLLECTED,
                SUM(NUMBER_OF_RESIDENTS) AS NUMBER_OF_RESIDENTS
         FROM PRODUCTION.EXTERNAL_REPORTING.DQ_PROPERTY
         WHERE PMC_NAME = ?
           AND BP_MONTH >= DATEADD('month', -13, CURRENT_DATE())
           AND BP_MONTH < ?
         GROUP BY 1
         ORDER BY 1 DESC
         LIMIT 50`,
        DqShieldedRowSchema,
        [pmc_name, cutoffStr],
        { label: "Fetch DQ shielded data from DQ_PROPERTY" }
      ),
      needsQBRQueries
        ? ctx.integrations.snowflake_sso.query(
            `SELECT
                YEAR(BP_MONTH) AS YEAR,
                SUM(RENT_PAID_AMOUNT) AS TOTAL_RENT,
                SUM(BILLS_PAID_COUNT) AS BILLS_PAID,
                COUNT(DISTINCT BP_MONTH) AS MONTHS_ACTIVE,
                SUM(CASE WHEN MONTH(BP_MONTH) <= ? THEN RENT_PAID_AMOUNT ELSE 0 END) AS YTD_RENT,
                SUM(CASE WHEN MONTH(BP_MONTH) <= ? THEN BILLS_PAID_COUNT ELSE 0 END) AS YTD_BILLS,
                COUNT(DISTINCT CASE WHEN MONTH(BP_MONTH) <= ? THEN BP_MONTH END) AS YTD_MONTHS_ACTIVE
             FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
             WHERE PMC_NAME = ?
               AND BP_MONTH < ?
             GROUP BY 1
             ORDER BY 1
             LIMIT 50`,
            // No IS_IN_NETWORK filter - matches Flask's pull_yearly_rent_bills exactly (deliberately
            // unfiltered, same "true history" convention as lifetime_rent). Confirmed real: this
            // filter dropped 6 properties' historical rent/bills for months they were later
            // deactivated/transferred out of - $10.9K/6 bills in 2024, $5.5K/3 bills in 2025 -
            // silently shrinking a lifetime total that was genuinely guaranteed and paid at the
            // time. A property's CURRENT network status has no bearing on whether past history
            // happened (Kevin's catch: Flask showed $12.43M/7,239 bills, this showed $12.4M/7,230).
            YearlyRentBillsSchema,
            [cutoffMonthNum, cutoffMonthNum, cutoffMonthNum, pmc_name, cutoffStr],
            { label: "Fetch since-inception yearly totals (unbounded)" }
          )
        : Promise.resolve([] as z.infer<typeof YearlyRentBillsSchema>[]),
      needsQBRQueries
        ? ctx.integrations.snowflake_sso.query(
            `SELECT PROPERTY_NAME,
                    TO_VARCHAR(BP_MONTH, 'YYYY-MM-DD') AS BP_MONTH,
                    BILLS_PAID_COUNT,
                    PROPERTY_UNIT_COUNT,
                    TO_VARCHAR(ROLLOUT_MONTH, 'YYYY-MM-DD') AS ROLLOUT_MONTH,
                    NEW_BILL_CONNECTIONS_PROPERTY
             FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
             WHERE PMC_NAME = ?
               AND IS_IN_NETWORK = TRUE
               AND BP_MONTH < ?
               AND BP_MONTH >= DATEADD('month', -25, ?)
             ORDER BY PROPERTY_NAME, BP_MONTH`,
            PropertyTrendSchema,
            [pmc_name, cutoffStr, cutoffStr],
            { label: "Fetch 25-month property history for trend badges" }
          )
        : Promise.resolve([] as z.infer<typeof PropertyTrendSchema>[]),
      ctx.integrations.snowflake_sso.query(
        `WITH active_properties AS (
            -- Flask (generator/data.py:405-427, _active_property_pmc_pairs): scopes retention
            -- to properties IS_IN_NETWORK as of the LATEST COMPLETED MONTH specifically, not
            -- per-row across the whole window -- "keeps retention rates honest by not counting
            -- departed-property residents as churn." A property that transferred away or
            -- deactivated PARTWAY through the 12-month window used to still contribute its
            -- earlier in-network months, and once it drops out of the data its residents look
            -- exactly like churn -- they left because their PROPERTY left the network, not
            -- because they personally stopped using Flex. This is the real cause of the true-
            -- repeat-rate gap: the "Perfect" bucket count was IDENTICAL between Flask and this
            -- port (267 both) while every OTHER bucket, and the total population, ran higher
            -- here -- those extra customers were exactly the departed-property residents
            -- Flask's snapshot excludes (a customer with a broken/incomplete history from a
            -- property leaving mid-window can't hit "Perfect," but can inflate every other
            -- bucket and drag the eligible-population denominator up).
            -- Flask's real match key is (PROPERTY_NAME, PMC_NAME) pairs, NOT PROPERTY_PUBLIC_ID
            -- -- matching that exactly (rather than the arguably-more-correct stable-ID version
            -- tried first) in case any of this PMC's properties were renamed within the window,
            -- which would make Flask's own name-based pairs silently exclude that property's
            -- pre-rename history as if it were a "different" property. Testing whether this
            -- explains the small residual gap remaining after the first active-properties fix.
            SELECT PROPERTY_NAME
            FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
            WHERE PMC_NAME = ?
              AND BP_MONTH = ?::DATE
              AND IS_IN_NETWORK = TRUE
         ),
         scoped_props AS (
            SELECT PROPERTY_PUBLIC_ID, BP_MONTH
            FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
            WHERE PMC_NAME = ?
              AND PROPERTY_NAME IN (SELECT PROPERTY_NAME FROM active_properties)
              AND IS_IN_NETWORK = TRUE
              AND BP_MONTH >= DATEADD('month', -?, ?::DATE)
              AND BP_MONTH < ?
         ),
         customer_months AS (
            SELECT
               n.CUSTOMER_PUBLIC_ID,
               COUNT(DISTINCT n.BP_MONTH) AS months_paid,
               MIN(n.BP_MONTH) AS first_month,
               GREATEST(1, DATEDIFF('month', MIN(n.BP_MONTH), ?::DATE) + 1) AS months_available
            FROM scoped_props p
            JOIN PRODUCTION.ANALYTICS.NAR_CHARGED_USERS n
               ON n.PROPERTY_PUBLIC_ID = p.PROPERTY_PUBLIC_ID AND n.BP_MONTH = p.BP_MONTH
            WHERE n.HAS_BILL_PAID = TRUE
            GROUP BY n.CUSTOMER_PUBLIC_ID
         ),
         -- Flask (generator/slides.py:3891-3894): only customers with 3+ months of history can
         -- be assessed for a real loyalty pattern — 1-2 month customers can't yet. Was >= 2.
         multi_month AS (
            SELECT * FROM customer_months WHERE months_available >= 3
         ),
         total_cust AS (
            SELECT COUNT(*) AS cnt FROM multi_month
         ),
         eligible AS (
            SELECT * FROM customer_months WHERE first_month < ?::DATE
         ),
         repeat_cust AS (
            SELECT COUNT(*) AS cnt FROM eligible WHERE months_paid >= 2
         ),
         eligible_count AS (
            SELECT COUNT(*) AS cnt FROM eligible
         ),
         bucketed AS (
            SELECT
              CASE
                WHEN months_paid >= months_available THEN 'PERFECT'
                WHEN CAST(months_paid AS FLOAT) / NULLIF(months_available, 0) >= 0.75 THEN 'HIGH'
                WHEN CAST(months_paid AS FLOAT) / NULLIF(months_available, 0) >= 0.50 THEN 'REGULAR'
                ELSE 'EPISODIC'
              END AS LOYALTY_BUCKET
            FROM multi_month
         )
         SELECT
            b.LOYALTY_BUCKET,
            COUNT(*) AS BUCKET_COUNT,
            t.cnt AS TOTAL_CUSTOMERS,
            CASE WHEN e.cnt > 0 THEN CAST(r.cnt AS FLOAT) / e.cnt ELSE NULL END AS TRUE_REPEAT_RATE
         FROM bucketed b
         CROSS JOIN total_cust t
         CROSS JOIN repeat_cust r
         CROSS JOIN eligible_count e
         GROUP BY b.LOYALTY_BUCKET, t.cnt, r.cnt, e.cnt`,
        RetentionCohortSchema,
        // Flask: max(3, lookback_months) (app.py:730) — floor so a very short override can't
        // starve the cohort window entirely. First two params (pmc_name, reportingMonthStr)
        // resolve active_properties' latest-month snapshot; third (pmc_name again) is
        // scoped_props' own PMC_NAME filter, needed now that the join key is PROPERTY_NAME
        // (not unique across the whole network) instead of PROPERTY_PUBLIC_ID.
        [pmc_name, reportingMonthStr, pmc_name, Math.max(3, lookback_months), cutoffStr, cutoffStr, reportingMonthStr, reportingMonthStr],
        { label: "Compute loyalty buckets & true repeat rate from customer cohort" }
      ).catch(() => [] as { LOYALTY_BUCKET: string; BUCKET_COUNT: number; TOTAL_CUSTOMERS: number; TRUE_REPEAT_RATE: number | null }[]),
      ctx.integrations.snowflake_sso.query(
        `WITH active_properties AS (
            -- Same "active as of latest month" scoping as the retention-cohort query above
            -- (Flask: _active_property_pmc_pairs, generator/data.py:405-427) -- without it, a
            -- property that departed the network mid-window still contributes customers here,
            -- whose payment history simply stops when the property leaves, looking exactly like
            -- churn in the MoM set-intersection below.
            -- Flask's real match key is (PROPERTY_NAME, PMC_NAME), not PROPERTY_PUBLIC_ID --
            -- see the retention-cohort query's own comment for why this is being tested as the
            -- source of the small residual gap remaining after the first active-properties fix.
            SELECT PROPERTY_NAME
            FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
            WHERE PMC_NAME = ?
              AND BP_MONTH = ?::DATE
              AND IS_IN_NETWORK = TRUE
         )
         SELECT
            n.CUSTOMER_PUBLIC_ID,
            TO_VARCHAR(n.BP_MONTH, 'YYYY-MM-DD') AS BP_MONTH
         FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS p
         JOIN PRODUCTION.ANALYTICS.NAR_CHARGED_USERS n
            ON n.PROPERTY_PUBLIC_ID = p.PROPERTY_PUBLIC_ID AND n.BP_MONTH = p.BP_MONTH
         WHERE p.PMC_NAME = ?
           AND p.PROPERTY_NAME IN (SELECT PROPERTY_NAME FROM active_properties)
           AND p.IS_IN_NETWORK = TRUE
           AND p.BP_MONTH >= DATEADD('month', -?, ?::DATE)
           AND p.BP_MONTH < ?
           AND n.HAS_BILL_PAID = TRUE`,
        CustomerMonthSchema,
        // Same window as the retention-cohort query above (Flask: pull_retention_cohort's
        // lookback_months) — this feeds the same cohort_df the MoM chart is built from.
        [pmc_name, reportingMonthStr, pmc_name, Math.max(3, lookback_months), cutoffStr, cutoffStr],
        { label: "Fetch raw (customer, month) pairs for MoM retention set-intersection" }
      ).catch(() => [] as { CUSTOMER_PUBLIC_ID: string; BP_MONTH: string }[]),
      // Real DAY-level rollout-to-first-signup, replacing the old BP_MONTH-granularity calc
      // (Kevin's catch: "0.0 months" from same-BP-month rollout+connection told you nothing;
      // the real number for the one qualifying property here is 3 days, not 0). RENTERS is
      // resident-level with real timestamps (BILL_CONNECTED_AT_UTC, RESIDENT_PROPERTY_ROLLOUT_
      // DATE) - PROPERTY_BP_MONTH_STATS only has BP_MONTH, monthly granularity, no finer.
      // BILL_CONNECTED_AT_UTC >= rollout date is NOT redundant - confirmed real and necessary:
      // without it, residents who moved from an EARLIER Flex-connected property carry their
      // original connection timestamp (one real case: dated 2024, two years before this
      // property even rolled out in 2026), which would make "days to first sign-up" go
      // negative or nonsensically large instead of reflecting this property's own onboarding.
      ctx.integrations.snowflake_sso.query(
        `SELECT
            RESIDENT_PROPERTY_NAME AS PROPERTY_NAME,
            TO_VARCHAR(RESIDENT_PROPERTY_ROLLOUT_DATE, 'YYYY-MM-DD') AS ROLLOUT_DATE,
            TO_VARCHAR(MIN(BILL_CONNECTED_AT_UTC), 'YYYY-MM-DD"T"HH24:MI:SS') AS FIRST_CONNECTED_AT
         FROM PRODUCTION.ANALYTICS.RENTERS
         WHERE RESIDENT_PMC_NAME = ?
           AND RESIDENT_PROPERTY_ROLLOUT_DATE IS NOT NULL
           AND RESIDENT_PROPERTY_ROLLOUT_DATE >= DATEADD('month', -12, ?::DATE)
           AND RESIDENT_PROPERTY_ROLLOUT_DATE < ?::DATE
           AND BILL_CONNECTED_AT_UTC IS NOT NULL
           AND BILL_CONNECTED_AT_UTC >= RESIDENT_PROPERTY_ROLLOUT_DATE::TIMESTAMP_NTZ
         GROUP BY RESIDENT_PROPERTY_NAME, RESIDENT_PROPERTY_ROLLOUT_DATE`,
        SubjectSignupTimingSchema,
        [pmc_name, cutoffStr, cutoffStr],
        { label: "Fetch real day-level rollout-to-first-signup timing (RENTERS)" }
      ).catch((err) => { console.error("[SUBJECT SIGNUP TIMING QUERY FAILED]", String(err)); return [] as z.infer<typeof SubjectSignupTimingSchema>[]; }),
    ]);

    // --- Fire slow secondary queries in parallel ---
    // Customer signups + partner-since launch concurrently with networkPool + regionDetail
    const CustomerSignupsSchema = z.object({
      BP_MONTH: z.string(),
      NEW_SIGNUPS_CUSTOMER: z.coerce.number(),
    });
    const custSignupsPromise = ctx.integrations.snowflake_sso.query(
      `WITH customer_first AS (
          SELECT CUSTOMER_PUBLIC_ID, MIN(n.BP_MONTH) AS first_paid_month
          FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS p
          JOIN PRODUCTION.ANALYTICS.NAR_CHARGED_USERS n
              ON n.PROPERTY_PUBLIC_ID = p.PROPERTY_PUBLIC_ID AND n.BP_MONTH = p.BP_MONTH
          WHERE p.PMC_NAME = ?
            AND p.IS_IN_NETWORK = TRUE
            AND n.HAS_BILL_PAID = TRUE
          GROUP BY CUSTOMER_PUBLIC_ID
       )
       SELECT
          TO_VARCHAR(first_paid_month, 'YYYY-MM-DD') AS BP_MONTH,
          COUNT(*) AS NEW_SIGNUPS_CUSTOMER
       FROM customer_first
       WHERE first_paid_month >= DATEADD('month', -?, CURRENT_DATE())
         AND first_paid_month < ?
       GROUP BY 1
       ORDER BY 1
       LIMIT 50`,
      CustomerSignupsSchema,
      [pmc_name, lookback_months, cutoffStr],
      { label: "True first-time-payer monthly counts (excl. win-backs)" }
    ).catch(() => [] as { BP_MONTH: string; NEW_SIGNUPS_CUSTOMER: number }[]);

    const LaunchSchema = z.object({ LAUNCH_MONTH: z.string().nullable() });
    let partnerSinceError: string | null = null;
    const partnerSincePromise = ctx.integrations.snowflake_sso.query(
      `WITH opp_dates AS (
        -- Any closed-won opportunity, not just 'New Logo' - dropped that type filter (Kevin's
        -- catch, mirrors the same fix in Flask's pull_launch_month, generator/data.py:2496).
        -- 'New Logo' isn't reliable: confirmed real on Bridge PM, whose only 'New Logo'-typed
        -- opps are dated 2024 and are literally named "(Glen 91 Transfer)" / "(Dulles Greene
        -- Transfer)" - property-transfer deals into an already multi-year-established partner,
        -- mistyped as New Logo - while real Expansion opportunities go back to Sept 2020 (an
        -- Expansion deal can't happen before you're already a customer) and property rollout
        -- data goes back to Oct 2019. Because a 'New Logo' match existed, this never fell
        -- through to the rollout fallback that would have gotten closer to the truth, and
        -- returned the false, too-recent 2024 date instead. Any closed-won deal proves the
        -- partnership already existed by that date, which is all this needs - and unlike
        -- rollout_month, a deal record is tied to the ACCOUNT, not a property, so it can't be
        -- inherited from an unrelated prior owner via a transfer the way rollout_month can.
        SELECT MIN(o.CLOSED_AT_UTC) AS closed_at
        FROM PRODUCTION.SALES.FCT_SALES_OPPORTUNITIES o
        JOIN PRODUCTION.SALES.DIM_SALES_ACCOUNTS a ON o.SALES_ACCOUNT_KEY = a.SALES_ACCOUNT_KEY
        JOIN (SELECT DISTINCT PMC_ID FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS WHERE PMC_NAME = ?) p
             ON a.PMC_ID = p.PMC_ID
        WHERE o.IS_CLOSED_WON = TRUE
        UNION ALL
        SELECT MIN(o.CLOSED_AT_UTC) AS closed_at
        FROM FLEX.SALES.FCT_CRM_OPPORTUNITY o
        JOIN FLEX.SALES.DIM_CRM_ACCOUNT_HISTORY a ON o.CRM_ACCOUNT_SK = a.CRM_ACCOUNT_SK
        JOIN (SELECT DISTINCT PMC_ID FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS WHERE PMC_NAME = ?) p
             ON a.PMC_ID = p.PMC_ID
        WHERE a.IS_CURRENT = TRUE
          AND o.IS_CLOSED_WON = TRUE
       )
       SELECT TO_VARCHAR(MIN(closed_at), 'YYYY-MM-DD') AS LAUNCH_MONTH FROM opp_dates`,
      LaunchSchema,
      [pmc_name, pmc_name],
      { label: "Pull partner launch month from Salesforce opportunities (old + new schema)" }
    ).catch((err) => {
      partnerSinceError = err instanceof Error ? err.message : String(err);
      return [{ LAUNCH_MONTH: null }] as { LAUNCH_MONTH: string | null }[];
    });

    // Guarded rollout-date comparator - mirrors Flask's pull_launch_month (generator/data.py:
    // 2496) after its second fix. Only trusts a property's ROLLOUT_MONTH when that property's
    // OWN earliest bp_month row under this pmc scope actually starts close to it (<=3 months) -
    // a transferred-in property carries its old rollout_month forward but has a real gap
    // before its billing history under the new PMC's name begins, which this excludes. This is
    // the guard the PREVIOUS version of this file's "earlier wins" logic was missing (see the
    // comment above partnerSince below) - without it, a genuinely long-tenured property and a
    // transfer-inherited one are indistinguishable by date alone, which is why that logic got
    // reverted. With the guard, they're not: verified directly against Bridge PM's own data -
    // "Allure" (rollout 2019-10-01) has 1,505 bills paid continuously from Oct 2019 through
    // today, not a gapped transfer artifact.
    const rolloutDatePromise = ctx.integrations.snowflake_sso.query(
      `SELECT TO_VARCHAR(MIN(ROLLOUT_MONTH), 'YYYY-MM-DD') AS LAUNCH_MONTH
       FROM (
           SELECT PROPERTY_PUBLIC_ID, ROLLOUT_MONTH, MIN(BP_MONTH) AS first_billed_month
           FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
           WHERE PMC_NAME = ? AND ROLLOUT_MONTH IS NOT NULL
           GROUP BY PROPERTY_PUBLIC_ID, ROLLOUT_MONTH
       ) t
       WHERE DATEDIFF('month', ROLLOUT_MONTH, first_billed_month) <= 3`,
      LaunchSchema,
      [pmc_name],
      { label: "Pull guarded earliest rollout month for partner-since comparison" }
    ).catch(() => [{ LAUNCH_MONTH: null }] as { LAUNCH_MONTH: string | null }[]);

    // Flask (generator/data.py:2367-2413, compute_benchmark): Portfolio Penetration's
    // denominator is deliberately NOT HUBSPOT_DEAL_TOTAL_COMPANY_UNITS for the SUBJECT PMC -
    // that field is a per-deal snapshot that varies wildly row-to-row (explicit comment in
    // Flask source warns against it). Instead it queries the Salesforce accounts table
    // directly via PMC_ID, same join pattern as partnerSincePromise above. NOTE: this is
    // intentionally asymmetric with the PEER side (below, in the PENETRATION percentile CTE),
    // which DOES use HUBSPOT_DEAL_TOTAL_COMPANY_UNITS - Flask does the same (peer_penetration
    // CTE, data.py:2035-2043) because peers only feed a percentile position, not a displayed
    // headline number, so the noisier field is tolerated there but not for the subject's own
    // value.
    const SubjectPortfolioTotalSchema = z.object({ TOTAL_COMPANY_UNITS: z.coerce.number().nullable() });
    let subjectPortfolioTotalError: string | null = null;
    const subjectPortfolioTotalPromise = ctx.integrations.snowflake_sso.query(
      `SELECT acc.ACCOUNT_TOTAL_COMPANY_UNITS AS TOTAL_COMPANY_UNITS
       FROM PRODUCTION.SALES.DIM_SALES_ACCOUNTS acc
       JOIN (SELECT DISTINCT PMC_ID FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS WHERE PMC_NAME = ? LIMIT 1) p
            ON acc.PMC_ID = p.PMC_ID`,
      SubjectPortfolioTotalSchema,
      [pmc_name],
      { label: "Subject PMC's true total company units from Salesforce accounts (for Portfolio Penetration denominator)" }
    ).catch((err) => {
      subjectPortfolioTotalError = err instanceof Error ? err.message : String(err);
      return [] as { TOTAL_COMPANY_UNITS: number | null }[];
    });

    // --- Network property pool was moved earlier (fired before the batch) ---
    let regionDetail: { PROPERTY_STATE: string; PROPERTY_REGION: string; PROPERTIES: number; TOTAL_UNITS: number; BILLS_PAID: number }[] = [];
    // Subject PMC's own properties' median renter income, keyed by property name — feeds the
    // RTI (rent-to-income) peer-matching tier in peer-matching.ts's resolvePropertyPeerMetric.
    const subjectIncomeByProperty = new Map<string, number>();
    // Tenure percentile vs. all active PMCs (1 = oldest) — gates the anniversary-milestone
    // callout below to only the top 50% most-tenured partners, matching Flask.
    let tenurePercentileFromTop: number | null = null;
    // Deactivated properties, feeding the "These properties need our attention" slide's
    // No-Longer-Active section (QBR only, same as the rest of this block). New Rollouts'
    // benchmark used to come from a dedicated network-wide-untiered query here
    // (stageAgeBenchmarkRows) - removed (see stageBenchmarksMap below for why).
    let disabledPropertyRows: { PROPERTY_NAME: string; DEACTIVATION_REASON: string; PROPERTY_UNIT_COUNT: number; LAST_SEEN_MONTH: string | null }[] = [];

    if (needsQBRQueries) {
      // Network pool query was moved earlier (fires in parallel with the main batch above).
      // regionDetailPromise was moved earlier too (now fires for Expansion as well - see its
      // new definition and comment next to networkPoolPromise above).

      // Subject PMC's own property-level median renter income (same ZIP→FIPS→census UDF
      // chain as the network pool query above) — lets the peer-matching resolver compare
      // rent-to-income instead of raw rent for this PMC's properties.
      const SubjectIncomeSchema = z.object({
        PROPERTY_NAME: z.string(),
        // z.coerce — same FIPS_TO_CENSUS_DATA UDF as NetworkPoolSchema above; see that
        // comment for why z.number() alone can silently reject the whole result.
        MEDIAN_RENTER_INCOME: z.coerce.number().nullable(),
      });
      const subjectIncomePromise = ctx.integrations.snowflake_sso.query(
          `WITH prop_zip AS (
              SELECT PROPERTY_PUBLIC_ID, PROPERTY_ZIP,
                     ROW_NUMBER() OVER (PARTITION BY PROPERTY_PUBLIC_ID ORDER BY CREATED_AT_UTC DESC) AS rn
              FROM PRODUCTION.ANALYTICS.DIM_PROPERTIES_PMCS
           )
           SELECT DISTINCT
              t.PROPERTY_NAME,
              PRODUCTION.ANALYTICS.FIPS_TO_CENSUS_DATA(
                  PRODUCTION.ANALYTICS.ZIP_TO_FIPS(LEFT(p.PROPERTY_ZIP, 5)),
                  'median_renter_household_income'
              ) AS MEDIAN_RENTER_INCOME
           FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS t
           LEFT JOIN prop_zip p
             ON p.PROPERTY_PUBLIC_ID = t.PROPERTY_PUBLIC_ID AND p.rn = 1
           WHERE t.PMC_NAME = ?
             AND t.IS_IN_NETWORK = TRUE`,
          SubjectIncomeSchema,
          [pmc_name],
          { label: "Fetch subject PMC's property median renter income for RTI peer matching" }
        ).catch(() => [] as { PROPERTY_NAME: string; MEDIAN_RENTER_INCOME: number | null }[]);

      // Tenure percentile vs. all active PMCs — gates the anniversary-milestone callout to only
      // the top 50% most-tenured partners, same as Flask's pull_pmc_tenure_percentile.
      //
      // Ranks by the same SFDC-New-Logo-aware "true partner since" date as partnerSincePromise
      // above (COALESCE opp close date, falling back to raw MIN(ROLLOUT_MONTH) only when no
      // matching opportunity exists) — NOT raw MIN(ROLLOUT_MONTH) alone. Confirmed real bug
      // this fixes (Kevin's catch, 2026-08-19): Bridge PM's milestone slide showed "Top 1%" /
      // "2 years" / "since July 2024" on the same slide — internally contradictory, since 2
      // years of tenure is nowhere near the network's real top 1% (P99 tenure is ~75 months).
      // Root cause: Bridge PM's earliest PROPERTY rolled out in Oct 2019 under a prior
      // management company, 57 months before Bridge PM itself became a Flex partner — ranking
      // the whole network by raw rollout month reproduces that inherited-date problem for any
      // PMC in the same situation. Live-verified: Bridge PM's real percentile is 36%, not 1%,
      // and the corrected subject launch_month (2024-07-29) matches its own "since July 2024"
      // headline exactly.
      const subjectPmcNames = second_pmc ? [pmc_name, second_pmc] : [pmc_name];
      const subjectPlaceholders = subjectPmcNames.map(() => "?").join(", ");
      const TenurePercentileSchema = z.object({
        PERCENTILE_FROM_TOP: z.number().nullable(),
      });
      const tenurePercentilePromise = ctx.integrations.snowflake_sso.query(
          `WITH pmc_ids AS (
              SELECT DISTINCT PMC_NAME, PMC_ID FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS WHERE PMC_ID IS NOT NULL
           ),
           pmc_rollout AS (
              -- Same guard as rolloutDatePromise above: only trust a property's ROLLOUT_MONTH
              -- when its own earliest bp_month row starts close to it (<=3 months), so a
              -- transferred-in property's inherited old rollout_month doesn't win here either.
              SELECT PMC_NAME, MIN(ROLLOUT_MONTH) AS rollout_launch
              FROM (
                  SELECT PMC_NAME, PROPERTY_PUBLIC_ID, ROLLOUT_MONTH, MIN(BP_MONTH) AS first_billed_month
                  FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
                  WHERE ROLLOUT_MONTH IS NOT NULL
                  GROUP BY PMC_NAME, PROPERTY_PUBLIC_ID, ROLLOUT_MONTH
              )
              WHERE DATEDIFF('month', ROLLOUT_MONTH, first_billed_month) <= 3
              GROUP BY PMC_NAME
           ),
           pmc_opps AS (
              -- Same join shape as partnerSincePromise's old-schema half above, and the same
              -- dropped 'New Logo' type filter - see the comment there for why (Kevin's catch).
              SELECT pi.PMC_NAME, MIN(o.CLOSED_AT_UTC) AS opp_launch
              FROM PRODUCTION.SALES.FCT_SALES_OPPORTUNITIES o
              JOIN PRODUCTION.SALES.DIM_SALES_ACCOUNTS a ON o.SALES_ACCOUNT_KEY = a.SALES_ACCOUNT_KEY
              JOIN pmc_ids pi ON pi.PMC_ID = a.PMC_ID
              WHERE o.IS_CLOSED_WON = TRUE
              GROUP BY pi.PMC_NAME
           ),
           pmc_tenures AS (
              -- Earlier of the two (guarded rollout vs opp date), same reasoning as
              -- partnerSincePromise above, not "opp wins whenever it exists" - and driven off
              -- every known PMC_NAME (not just those with a qualifying rollout property), so a
              -- PMC with only an opp date isn't dropped from the ranking entirely.
              SELECT pi.PMC_NAME,
                     CASE
                       WHEN o.opp_launch IS NOT NULL AND r.rollout_launch IS NOT NULL
                         THEN LEAST(o.opp_launch::DATE, r.rollout_launch)
                       ELSE COALESCE(o.opp_launch::DATE, r.rollout_launch)
                     END AS launch_month
              FROM (SELECT DISTINCT PMC_NAME FROM pmc_ids) pi
              LEFT JOIN pmc_rollout r ON r.PMC_NAME = pi.PMC_NAME
              LEFT JOIN pmc_opps o ON o.PMC_NAME = pi.PMC_NAME
           ),
           subject AS (
              SELECT MIN(launch_month) AS launch_month
              FROM pmc_tenures
              WHERE PMC_NAME IN (${subjectPlaceholders})
           ),
           counts AS (
              SELECT
                  (SELECT COUNT(*) FROM pmc_tenures) AS total_count,
                  (SELECT COUNT(*) FROM pmc_tenures t, subject s
                   WHERE t.launch_month < s.launch_month) + 1 AS tenure_rank
           )
           SELECT CEIL(100.0 * c.tenure_rank / NULLIF(c.total_count, 0)) AS PERCENTILE_FROM_TOP
           FROM subject s CROSS JOIN counts c
           WHERE s.launch_month IS NOT NULL`,
          TenurePercentileSchema,
          subjectPmcNames,
          { label: "Fetch PMC tenure percentile for anniversary-milestone gate" }
        ).catch(() => [] as { PERCENTILE_FROM_TOP: number | null }[]);

      // Disabled/deactivated properties for the "These properties need our attention" slide's
      // No-Longer-Active section (Flask: pull_disabled_properties, generator/data.py:4247).
      // Partner-relevant reasons only — internal ops codes are excluded via the WHERE clause,
      // and PARTNER_INITIATED_LOSS_OF_API_ACCESS is additionally dropped at render time
      // (ambiguous — may be intentional/migration, not necessarily churn).
      const DisabledPropertySchema = z.object({
        PROPERTY_NAME: z.string(),
        DEACTIVATION_REASON: z.string(),
        PROPERTY_UNIT_COUNT: z.number(),
        LAST_SEEN_MONTH: z.string().nullable(),
      });
      const disabledPropertiesPromise = ctx.integrations.snowflake_sso.query(
        `SELECT
            PROPERTY_NAME,
            DEACTIVATION_REASON,
            PROPERTY_UNIT_COUNT,
            TO_VARCHAR(MAX(BP_MONTH), 'YYYY-MM-DD') AS LAST_SEEN_MONTH
         FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
         WHERE PMC_NAME IN (${subjectPlaceholders})
           AND DEACTIVATION_REASON IN (${Object.keys(DEACTIVATION_LABELS).map(() => "?").join(", ")})
           AND BP_MONTH >= DATEADD('month', -18, CURRENT_DATE())
         GROUP BY PROPERTY_NAME, DEACTIVATION_REASON, PROPERTY_UNIT_COUNT
         ORDER BY LAST_SEEN_MONTH DESC, PROPERTY_NAME`,
        DisabledPropertySchema,
        [...subjectPmcNames, ...Object.keys(DEACTIVATION_LABELS)],
        { label: "Fetch deactivated properties for the No-Longer-Active section" }
      ).catch(() => [] as z.infer<typeof DisabledPropertySchema>[]);

      // New Rollouts section's "expected" NAR used to come from a dedicated network-wide,
      // UNTIERED query here. Confirmed real and broken: it returned P50_NAR = 0.0 at every
      // single age bucket 1-11 (Kevin's catch - "clark is showing a 0 peer median adoption
      // rate") because ~77% of ALL network property-months have zero bills paid and nothing
      // here excluded them by geography/size/rent the way every real peer benchmark elsewhere
      // in this deck does - Flask's real equivalent for this exact column
      // (_pull_stage_benchmarks, generator/data.py:2524) IS geo/size/rent/NIRO-tiered, and
      // showed a real 3.4% for the same property/age this query returned 0.0% for. Since
      // stageBenchmarksMap (built above, same tenure-cohort query the Adoption Trend chart
      // now uses) already covers ages 1-36 on the SAME locked-peers cohort, the New Rollouts
      // section now reads that directly instead of this separate, broken query - see the
      // newRolloutCandidates loop below.

      const [networkPoolResult, propertyPoolResult, regionDetailResult, subjectIncomeRows, tenurePercentileRows, disabledPropertyResult] = await Promise.all([
        networkPoolPromise, propertyPoolPromise, regionDetailPromise, subjectIncomePromise, tenurePercentilePromise,
        disabledPropertiesPromise,
      ]);
      _networkPool = networkPoolResult;
      propertyPool = propertyPoolResult;
      regionDetail = regionDetailResult;
      disabledPropertyRows = disabledPropertyResult;
      for (const row of subjectIncomeRows) {
        if (row.MEDIAN_RENTER_INCOME != null && row.MEDIAN_RENTER_INCOME > 0) {
          subjectIncomeByProperty.set(row.PROPERTY_NAME, row.MEDIAN_RENTER_INCOME);
        }
      }
      tenurePercentileFromTop = tenurePercentileRows[0]?.PERCENTILE_FROM_TOP ?? null;
    }

    // --- Testimonials (user-selected from frontend, or auto-pulled from Zendesk) ---
    // zendeskPromise/residentTrendPromise are defined up near cutoffStr now, not here - see the
    // perf-fix comment there (Kevin's catch: they were only firing after the network/property
    // pool batch resolved instead of overlapping it). Still awaited below, just before the
    // slides that need them - only the definition moved, not the await site.

    // --- Transform ---

    // Monthly totals
    const monthMap = new Map<string, { billsPaid: number; units: number; rentPaid: number; newSignups: number; chargedUsers: number; propertyNames: Set<string> }>();
    for (const row of inNetwork) {
      const existing = monthMap.get(row.BP_MONTH) || { billsPaid: 0, units: 0, rentPaid: 0, newSignups: 0, chargedUsers: 0, propertyNames: new Set<string>() };
      existing.billsPaid += row.BILLS_PAID;
      existing.units += row.PROPERTY_UNIT_COUNT;
      existing.rentPaid += row.RENT_PAID;
      existing.newSignups += row.NEW_SIGNUPS ?? 0;
      existing.chargedUsers += row.CHARGED_USERS ?? 0;
      existing.propertyNames.add(row.PROPERTY_NAME);
      monthMap.set(row.BP_MONTH, existing);
    }

    // Pre-index inNetwork by BP_MONTH for O(1) lookups in established NAR calc
    const byMonth = new Map<string, typeof inNetwork>();
    for (const r of inNetwork) {
      const arr = byMonth.get(r.BP_MONTH);
      if (arr) arr.push(r);
      else byMonth.set(r.BP_MONTH, [r]);
    }

    const monthlyTotals = Array.from(monthMap.entries())
      .map(([month, { billsPaid, units, rentPaid, newSignups, chargedUsers, propertyNames }]) => {
        // Established NAR: properties where rollout_month < (month - 2 calendar months).
        // DateOffset(months=2) gives a 3-full-month floor, aligned with Loyalty Rate's
        // months_available >= 3 and the trend legend "(excl. first 3 months)".
        const mDate = new Date(month + "T00:00:00");
        const estCutoff = new Date(mDate.getFullYear(), mDate.getMonth() - 2, 1)
          .toISOString().slice(0, 10);
        const monthRows = byMonth.get(month) ?? [];
        let estUnits = 0;
        let estBills = 0;
        for (const r of monthRows) {
          if (r.ROLLOUT_MONTH != null && r.ROLLOUT_MONTH < estCutoff) {
            estUnits += r.PROPERTY_UNIT_COUNT;
            estBills += r.BILLS_PAID;
          }
        }
        const establishedNar = estUnits > 0 ? estBills / estUnits : undefined;

        return {
          month,
          billsPaid,
          units,
          rentPaid,
          newSignups,
          chargedUsers,
          adoptionRate: units > 0 ? billsPaid / units : 0,
          propertyCount: propertyNames.size,
          establishedNar,
        };
      })
      .sort((a, b) => a.month.localeCompare(b.month));

    // ── True first-time-payer counts (excluding win-backs) ──────────────────
    // Flask: pull_customer_monthly_signups() — customers whose first-ever payment
    // falls in that month. Overrides the simpler NEW_SIGNUPS_COUNT which includes
    // win-backs and property-level double-counting.
    // Applied from custSignupsResult (fetched in parallel above).
    try {
      const custSignupRows = await custSignupsPromise;
      const custSignupMap = new Map(custSignupRows.map((r) => [r.BP_MONTH, r.NEW_SIGNUPS_CUSTOMER]));
      for (const m of monthlyTotals) {
        const trueCount = custSignupMap.get(m.month);
        if (trueCount !== undefined) {
          m.newSignups = trueCount;
        }
      }
    } catch {
      // Fall back to property-level NEW_SIGNUPS_COUNT on query failure
    }

    // Latest completed month
    const currentMonthStr = new Date(today.getFullYear(), today.getMonth(), 1)
      .toISOString().slice(0, 10);

    const completedMonths = monthlyTotals.filter((m) => {
      if (dayOfMonth <= 5 && m.month === currentMonthStr) return false;
      return m.billsPaid > 0;
    });

    const latestCompletedMonth = completedMonths.length > 0
      ? completedMonths[completedMonths.length - 1].month
      : monthlyTotals[monthlyTotals.length - 1]?.month || "";

    // Resident-level rents for the "Flex For Everyone" rent-bucket slide's Last Month/All Time
    // toggle (Kevin's ask - Expansion's own "high_rent" case never got this; QBR's has had it
    // all along, as its own separate query further down used to fire unconditionally). Hoisted
    // here (first point latestCompletedMonth is available) and shared by both modes instead of
    // querying twice - both queries are scoped to a single subject PMC, no network-wide scan,
    // no UDF chain, same "safe to extend to Expansion" profile as regionDetailPromise above.
    const needsResidentRents = needsQBRQueries || deck_mode === "expansion";
    const ResidentRentSchema = z.object({ RESIDENT_AMOUNT_PAID: z.number() });
    const AlltimeResidentSchema = z.object({ RESIDENT_AMOUNT_PAID: z.number(), RESIDENT_TOTAL_PAID: z.number() });
    const [residentRentRows, alltimeResidentRows] = !needsResidentRents
      ? [[] as { RESIDENT_AMOUNT_PAID: number }[], [] as { RESIDENT_AMOUNT_PAID: number; RESIDENT_TOTAL_PAID: number }[]]
      : await Promise.all([
          ctx.integrations.snowflake_sso.query(
            `WITH scoped_props AS (
                SELECT PROPERTY_PUBLIC_ID, BP_MONTH
                FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
                WHERE PMC_NAME = ?
                  AND IS_IN_NETWORK = TRUE
             ),
             latest AS (
                -- NAR_CHARGED_USERS lags PROPERTY_BP_MONTH_STATS's own BILLS_PAID_COUNT — a
                -- month can already show as "completed" (bills paid > 0) before this table has
                -- been populated for it. Requiring an exact match on latestCompletedMonth here
                -- silently returned zero resident rows, which fell back to inflated property-
                -- level totals. Mirrors Flask's pull_resident_detail (generator/data.py:3317-
                -- 3327) exactly: the real "latest" for THIS table is whichever month it
                -- actually has data joined for.
                SELECT MAX(p.BP_MONTH) AS BP_MONTH
                FROM scoped_props p
                JOIN PRODUCTION.ANALYTICS.NAR_CHARGED_USERS n
                   ON n.PROPERTY_PUBLIC_ID = p.PROPERTY_PUBLIC_ID AND n.BP_MONTH = p.BP_MONTH
                WHERE n.HAS_BILL_PAID = TRUE AND p.BP_MONTH <= ?
             )
             SELECT n.RENT_AMOUNT AS RESIDENT_AMOUNT_PAID
             FROM scoped_props p
             JOIN PRODUCTION.ANALYTICS.NAR_CHARGED_USERS n
               ON n.PROPERTY_PUBLIC_ID = p.PROPERTY_PUBLIC_ID AND n.BP_MONTH = p.BP_MONTH
             WHERE p.BP_MONTH = (SELECT BP_MONTH FROM latest)
               AND n.HAS_BILL_PAID = TRUE
             LIMIT 50000`,
            ResidentRentSchema,
            [pmc_name, latestCompletedMonth],
            { label: "Pull resident-level rents for rent bucket slide (last month)" }
          ).catch(() => [] as { RESIDENT_AMOUNT_PAID: number }[]),
          ctx.integrations.snowflake_sso.query(
            `WITH active_props AS (
                -- Only properties still IS_IN_NETWORK as of the latest completed month - mirrors
                -- Flask's _active_property_pmc_pairs scoping for this exact slide
                -- (generator/data.py:429, app.py:1501), which keeps All-Time honest by not
                -- counting a departed property's old residents/rent. Without this, All-Time
                -- silently included every property ever active under this PMC name, even ones
                -- since sold/transferred/taken off Flex - which is why Last Month matched
                -- between Flask and Clark but All-Time didn't (Kevin's catch).
                SELECT DISTINCT PROPERTY_PUBLIC_ID
                FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
                WHERE PMC_NAME = ? AND IS_IN_NETWORK = TRUE AND BP_MONTH = ?
             ),
             scoped_props AS (
                SELECT PROPERTY_PUBLIC_ID, BP_MONTH
                FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
                WHERE PMC_NAME = ?
                  AND IS_IN_NETWORK = TRUE
                  AND BP_MONTH < ?
                  AND PROPERTY_PUBLIC_ID IN (SELECT PROPERTY_PUBLIC_ID FROM active_props)
             )
             SELECT
                AVG(n.RENT_AMOUNT)   AS RESIDENT_AMOUNT_PAID,
                SUM(n.RENT_AMOUNT)   AS RESIDENT_TOTAL_PAID
             FROM scoped_props p
             JOIN PRODUCTION.ANALYTICS.NAR_CHARGED_USERS n
               ON n.PROPERTY_PUBLIC_ID = p.PROPERTY_PUBLIC_ID AND n.BP_MONTH = p.BP_MONTH
             WHERE n.HAS_BILL_PAID = TRUE
             GROUP BY n.CUSTOMER_PUBLIC_ID
             LIMIT 50000`,
            AlltimeResidentSchema,
            [pmc_name, latestCompletedMonth, pmc_name, cutoffStr],
            { label: "Pull all-time resident rent averages for rent bucket toggle" }
          ).catch(() => [] as { RESIDENT_AMOUNT_PAID: number; RESIDENT_TOTAL_PAID: number }[]),
        ]);
    const residentRents = residentRentRows.filter((r) => r.RESIDENT_AMOUNT_PAID > 0).map((r) => r.RESIDENT_AMOUNT_PAID);
    const alltimeResidentRents = alltimeResidentRows.filter((r) => r.RESIDENT_AMOUNT_PAID > 0).map((r) => ({
      amountPaid: r.RESIDENT_AMOUNT_PAID,
      totalPaid: r.RESIDENT_TOTAL_PAID,
    }));

    // Property snapshot for latest completed month
    const latestRows = inNetwork.filter((r) => r.BP_MONTH === latestCompletedMonth);
    // Compute cumulative rent & prev-month signups per property for appendix table
    const cumRentMap = new Map<string, number>();
    const prevSignupsMap = new Map<string, number>();
    const priorMonthStr = monthlyTotals.length >= 2
      ? [...monthlyTotals].sort((a, b) => a.month.localeCompare(b.month)).slice(-2)[0]?.month
      : null;
    // Compute T12 connections per property (sum of NEW_BILL_CONNECTIONS over trailing 12 months)
    const t12ConnMap = new Map<string, number>();
    const t12RefDate = latestCompletedMonth ? new Date(latestCompletedMonth) : today;
    const t12CutoffDate = new Date(t12RefDate);
    t12CutoffDate.setMonth(t12CutoffDate.getMonth() - 12);
    const t12CutoffStr = t12CutoffDate.toISOString().slice(0, 10);
    for (const r of inNetwork) {
      const propKey = `${r.PMC_NAME}||${r.PROPERTY_NAME}`;
      cumRentMap.set(propKey, (cumRentMap.get(propKey) ?? 0) + r.RENT_PAID);
      if (priorMonthStr && r.BP_MONTH === priorMonthStr) {
        prevSignupsMap.set(propKey, r.NEW_SIGNUPS ?? 0);
      }
      // Sum T12 connections
      if (r.BP_MONTH >= t12CutoffStr) {
        t12ConnMap.set(propKey, (t12ConnMap.get(propKey) ?? 0) + r.NEW_BILL_CONNECTIONS);
      }
    }

    const propertySnapshot = latestRows
      .map((r) => {
        const monthsLive = r.ROLLOUT_MONTH && latestCompletedMonth
          ? ((new Date(latestCompletedMonth).getFullYear() - new Date(r.ROLLOUT_MONTH).getFullYear()) * 12
             + (new Date(latestCompletedMonth).getMonth() - new Date(r.ROLLOUT_MONTH).getMonth()))
          : 0;
        const avgRent = r.BILLS_PAID > 0 ? (r.RENT_PAID ?? 0) / r.BILLS_PAID : 0;
        const propKey = `${r.PMC_NAME}||${r.PROPERTY_NAME}`;
        return {
          propertyName: r.PROPERTY_NAME,
          units: r.PROPERTY_UNIT_COUNT,
          billsPaid: r.BILLS_PAID,
          newSignups: r.NEW_SIGNUPS ?? 0,
          prevSignups: prevSignupsMap.get(propKey) ?? 0,
          adoptionRate: r.PROPERTY_UNIT_COUNT > 0 ? r.BILLS_PAID / r.PROPERTY_UNIT_COUNT : 0,
          propertyState: r.PROPERTY_STATE ?? "",
          monthsLive,
          avgRent,
          rentPaid: r.RENT_PAID ?? 0,
          cumRent: cumRentMap.get(propKey) ?? (r.RENT_PAID ?? 0),
          rolloutMonth: r.ROLLOUT_MONTH ?? null,
          trendFlag: undefined as TrendFlag | undefined,
          t12EngPer100: r.PROPERTY_UNIT_COUNT > 0
            ? (t12ConnMap.get(propKey) ?? 0) / r.PROPERTY_UNIT_COUNT * 100
            : 0,
          hasMarketingIntegration: r.HAS_MARKETING_INTEGRATION ?? false,
          isMarketingOptIn: r.IS_MARKETING_OPT_IN ?? false,
          peerNar: undefined as number | null | undefined,
          peerNarCriteria: undefined as string | undefined,
          peerNarCount: undefined as number | undefined,
          peerEng: undefined as number | null | undefined,
          peerEngCriteria: undefined as string | undefined,
          peerEngCount: undefined as number | undefined,
        };
      })
      .sort((a, b) => b.billsPaid - a.billsPaid);

    // --- Compute trend flags for property deep dive badges ---
    const trendFlagsMap = computePropertyTrendFlags(trendRawRows, cutoffStr);
    for (const p of propertySnapshot) {
      const flag = trendFlagsMap.get(p.propertyName);
      if (flag) p.trendFlag = flag;
    }

    // --- Per-property peer matching (geography + rent + age aware) ---
    const reportingMonthDate = latestCompletedMonth ? new Date(latestCompletedMonth) : new Date();
    // Reads from propertyPool (Flask's real pull_network_property_pool - dedicated, unsampled),
    // NOT networkPool (the PMC-level, sampled pool used for geo-tier matching) - see the full
    // comment on PROPERTY_POOL_SQL above for why those two can't share a source.
    const networkPoolProps: NetworkPoolProperty[] = propertyPool
      .filter((r) => r.PROPERTY_STATE && r.ROLLOUT_MONTH)
      .map((r) => {
        const rollout = new Date(r.ROLLOUT_MONTH!);
        const mLive = (reportingMonthDate.getFullYear() - rollout.getFullYear()) * 12
                      + (reportingMonthDate.getMonth() - rollout.getMonth());
        const billsPaid = r.BILLS_PAID_COUNT ?? 0;
        const t12Conn = r.T12_CONNECTIONS ?? 0;
        const avgRent = billsPaid > 0 ? (r.RENT_PAID_AMOUNT ?? 0) / billsPaid : 0;
        const nar = r.PROPERTY_UNIT_COUNT > 0 ? billsPaid / r.PROPERTY_UNIT_COUNT : 0;
        const t12EngPer100 = r.PROPERTY_UNIT_COUNT > 0 ? t12Conn / r.PROPERTY_UNIT_COUNT * 100 : 0;
        return {
          pmcName: r.PMC_NAME,
          propertyName: r.PROPERTY_NAME,
          propertyState: r.PROPERTY_STATE!,
          propertyUnitCount: r.PROPERTY_UNIT_COUNT,
          avgRent,
          billsPaid,
          monthsLive: mLive,
          nar,
          t12EngPer100,
          ageBucket: propertyAgeBucket(mLive),
          medianRenterIncome: r.MEDIAN_RENTER_INCOME,
        };
      })
      // Flask (generator/data.py:5062): _rent_ok = (bills_paid_count < 3) | (avg_rent between
      // 700 and 2500) - a property with too few payers to trust its avg_rent estimate isn't
      // excluded on that noise. This was previously checking avgRent === 0 as the bypass,
      // which is NOT equivalent: a property with 1-2 payers (nonzero avgRent, potentially an
      // outlier from so few payers) should also bypass the rent-band check but didn't, quietly
      // shrinking the pool relative to Flask's real population.
      .filter((p) => p.monthsLive >= 7 && (p.billsPaid < 3 || (p.avgRent >= 700 && p.avgRent <= 2500)));

    // Shared exclusion set for every peer-pool read below — on a combined 2-PMC report, both
    // named PMCs' own properties must be excluded, or the second PMC's properties silently
    // count as the first PMC's "peers" (and vice versa). Flask's resolver uses this same
    // exclusion set for every tier, including its network-wide fallback tier — there's no
    // separately-scoped fallback query on the Flask side to fall out of sync with.
    const excludedPmcNames = second_pmc ? [pmc_name, second_pmc] : [pmc_name];

    // Apply per-property peer matching
    // Gate mirrors buildEstablishedPool's (slide-renderers.ts) — 7+mo live, and either
    // >=10 units OR a genuine 0%-adoption laggard. Previously required units>=10
    // unconditionally, so small 0%-adoption properties could land in the "needs attention"
    // table (via buildEstablishedPool's looser gate) but never get a peer-median value —
    // exactly the laggard a PMC most needs a peer comparison for.
    if (networkPoolProps.length > 0) {
      for (const p of propertySnapshot) {
        if (!p.propertyState || p.monthsLive < 7) continue;
        if (!(p.adoptionRate === 0 || p.units >= 10)) continue;
        const subjectIncome = subjectIncomeByProperty.get(p.propertyName);
        const narResult = resolvePropertyPeerNar(p.propertyState, p.units, p.avgRent, p.monthsLive, excludedPmcNames, networkPoolProps, subjectIncome);
        if (narResult) {
          p.peerNar = narResult.p50;
          p.peerNarCriteria = narResult.criteria;
          p.peerNarCount = narResult.peerCount;
        }
        const engResult = resolvePropertyPeerEngagement(p.propertyState, p.units, p.avgRent, p.monthsLive, excludedPmcNames, networkPoolProps, subjectIncome);
        if (engResult) {
          p.peerEng = engResult.p50;
          p.peerEngCriteria = engResult.criteria;
          p.peerEngCount = engResult.peerCount;
        }
      }
    }

    // Fallback: properties without peer NAR get the network-wide P50 (same exclusion set as
    // the tiered matching above — this is not a distinct code path in Flask, just this tier's
    // own "network-wide" bucket, so it must exclude both named PMCs the same way every other
    // tier does)
    const networkNarValues = networkPoolProps
      .filter((p) => !excludedPmcNames.includes(p.pmcName) && p.nar > 0)
      .map((p) => p.nar)
      .sort((a, b) => a - b);
    const networkNarP50 = networkNarValues.length > 0
      ? networkNarValues[Math.floor(networkNarValues.length / 2)]
      : undefined;
    for (const p of propertySnapshot) {
      if (p.peerNar == null && networkNarP50 != null) {
        p.peerNar = networkNarP50;
        p.peerNarCriteria = "network-wide";
      }
    }

    // KPIs
    const earliestRollout = inNetwork
      .filter((r) => r.ROLLOUT_MONTH)
      .map((r) => r.ROLLOUT_MONTH!)
      .sort()[0] || null;

    // ── Partner Since: the EARLIER of the Salesforce closed-won opportunity date and the
    // guarded rollout date (rolloutDatePromise above), not just an "earlier wins" pick between
    // the opp date and the naive earliestRollout computed above from lookback-bounded data.
    // Salesforce opportunity/account data has a confirmed hard floor around mid-2020 (Flex's
    // HubSpot-to-Salesforce migration; pre-migration deal history didn't carry over — Bridge
    // PM's own SFDC account record wasn't created until 2020-07-14, and network-wide, dozens
    // of unrelated PMCs' "earliest opportunity" cluster in Aug-Dec 2020, a migration-backfill
    // signature, not organic sales activity). So for any partner whose real tenure predates
    // that boundary, the opportunity date alone is structurally incapable of being right, even
    // when a match exists — which is why this compares against rollout rather than only
    // falling back to it when no opportunity exists.
    //
    // This file previously took the opp date unconditionally when it existed, specifically to
    // avoid a different bug: a PMC that acquired/inherited a property with OLDER rollout
    // history (from a prior management company) having that inherited date win over its own
    // real, later partnership start. That concern was real, but the fix reached for was too
    // blunt — it assumed ANY rollout date earlier than the opp date must be an inherited
    // artifact, which isn't true. Confirmed directly against Bridge PM's own data: their
    // earliest guarded rollout date (2019-10-01, from "Allure") isn't an inherited artifact —
    // that property has 1,505 bills paid continuously from Oct 2019 through today. The real
    // signature of an inherited transfer date is a GAP between a property's rollout_month and
    // when its billing history under the current PMC's name actually begins — which
    // rolloutDatePromise's own guard (<=3 months) already filters for, making the blunt
    // "always trust the opp date" override unnecessary and, for any pre-2020 partner, wrong.
    let partnerSince = earliestRollout;
    try {
      const [launchRow] = await partnerSincePromise;
      const [rolloutRow] = await rolloutDatePromise;
      const oppDate = launchRow?.LAUNCH_MONTH ?? null;
      const guardedRollout = rolloutRow?.LAUNCH_MONTH ?? null;
      if (oppDate && guardedRollout) {
        partnerSince = oppDate < guardedRollout ? oppDate : guardedRollout;
      } else {
        partnerSince = oppDate ?? guardedRollout ?? earliestRollout;
      }
      if (!oppDate && partnerSinceError) {
        console.warn(`[PMC Report] partner-since Salesforce query failed for ${pmc_name}: ${partnerSinceError}`);
      }
    } catch {
      // Fallback to rollout-date aggregate on Salesforce query failure
    }

    const uniqueProperties = new Set(latestRows.map((r) => r.PROPERTY_NAME));

    const kpis = {
      pmcName: pmcDisplayName,
      reportingMonth: latestCompletedMonth,
      partnerSince,
      propertyCount: uniqueProperties.size,
      firstMonth: monthlyTotals.length > 0 ? monthlyTotals[0].month : null,
    };

    // --- Compute KPI slide data ---
    const latestIdx = monthlyTotals.findIndex((m) => m.month === latestCompletedMonth);
    const latestMonth = latestIdx >= 0 ? monthlyTotals[latestIdx] : null;
    // comparison_months: look back N months for delta (Flask: _cmp_idx = max(1, min(comparison_months, len-1)))
    const cmpIdx = Math.max(1, Math.min(comparison_months ?? 1, latestIdx));
    const prevMonth = latestIdx >= cmpIdx ? monthlyTotals[latestIdx - cmpIdx] : null;
    // Build "vs ..." label: show actual month name when comparison_months > 1
    let vsLabel = "vs last month";
    if (prevMonth) {
      const prevDate = new Date(prevMonth.month + "T00:00:00");
      const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      vsLabel = `vs ${monthNames[prevDate.getMonth()]} ${prevDate.getFullYear()}`;
    }
    const lifetimeRent = monthlyTotals.reduce((sum, m) => sum + m.rentPaid, 0);

    // --- Compute True Repeat Rate from PARTNER_REPORTING_CORE_METRICS ---
    // RELIABLE_REPEAT_RATE_MIN (Kevin's catch, live-verified against a real "100.0% of
    // eligible residents came back" hero stat on a small portfolio): this ratio is a real,
    // correctly-computed number that's still meaningless as a headline when the denominator is
    // tiny - 1 resident paying again out of 1 who paid last month is a genuine 100%, not a
    // real retention story. Same bug class as the rent-bucket/delinquency floors added this
    // session; this metric had none at all. Applied to BOTH sources below (this MoM fallback
    // and the cohort-derived value near retentionCohortRows), same threshold either way.
    const RELIABLE_REPEAT_RATE_MIN = 10;
    const latestMetrics = metricsRows.find((r) => r.BP_MONTH === latestCompletedMonth);
    let trueRepeatRate: number | null = null;
    if (latestMetrics && latestMetrics.BILLS_PAID_REPEAT != null && latestMetrics.BILLS_PAID_PREV_MONTH != null && latestMetrics.BILLS_PAID_PREV_MONTH >= RELIABLE_REPEAT_RATE_MIN) {
      trueRepeatRate = Math.min(1, latestMetrics.BILLS_PAID_REPEAT / latestMetrics.BILLS_PAID_PREV_MONTH);
    }

    // --- Compute DQ shielded for the exec-summary tile — windowed to lookback_months (the
    // report's own Full/Quarter/YTD period), not the full 13-month dqShieldedRows pulled above
    // (that stays wide on purpose so the Delinquency slide's own trend chart keeps its full
    // window). Used to always show a fixed 13-month figure regardless of the period the AE
    // picked (Kevin's catch). BP_MONTH is 'YYYY-MM-DD' — string comparison is chronological.
    //
    // Anchor to DQ's OWN latest month, not latestCompletedMonth (the main report's latest
    // month) — DQ_PROPERTY data lags 1 month behind BP_MONTH (see the Delinquency slide's
    // comment), so anchoring to latestCompletedMonth silently excluded the oldest real DQ row
    // (Kevin's catch: Delinquency slide said $530K, this tile said $487K — the $43K gap was
    // exactly one excluded month). Not relying on the query's own ORDER BY for which row is
    // latest — computed defensively via string max, same robustness as Flask's sort_values.
    const dqLatestMonth = dqShieldedRows.reduce<string | null>(
      (latest, r) => (r.BP_MONTH != null && (latest == null || r.BP_MONTH > latest) ? r.BP_MONTH : latest),
      null
    );
    const dqWindowedRows = (() => {
      if (dqLatestMonth == null) return [];
      const dqWindowStartDate = new Date(dqLatestMonth + "T00:00:00Z");
      dqWindowStartDate.setUTCMonth(dqWindowStartDate.getUTCMonth() - (lookback_months - 1));
      const dqWindowStart = dqWindowStartDate.toISOString().slice(0, 10);
      return dqShieldedRows.filter((r) => r.BP_MONTH != null && r.BP_MONTH >= dqWindowStart);
    })();
    const lifetimeDqShielded = dqWindowedRows.reduce((sum, r) => sum + (r.TOTAL_RENT_SHIELDED ?? 0), 0);

    // --- Segment NAR / HubSpot segment label — REMOVED (fabricated data source) ---
    // PARTNER_REPORTING_CORE_METRICS.HUBSPOT_COMPANY_SEGMENT / SEGMENT_NAR_AVG have zero
    // equivalent anywhere in Flask (confirmed via full-repo grep) — this table/columns don't
    // exist in real Snowflake. Every read site is migrated to the real geo/size/rent-matched
    // peer cohort (lockedPeers / canonicalPeerNarP50 / stageBenchmarksMap), which is already
    // sourced from real data (PROPERTY_BP_MONTH_STATS) - the Adoption Trend chart's
    // stage_benchmarks was the last holdout (Kevin's catch) and is now migrated too.
    // segmentNarAvg kept as an explicit null (not deleted) so its remaining `?? fallback`
    // read sites still resolve correctly; hubspotSegment had no remaining reader, removed.
    const segmentNarAvg: number | null = null;

    // --- Auto-derive is_smb (Flask app.py:1551-1553): mode of STATIC_PARENT_TEAM_NAME_OPPORTUNITY
    // (the internal Flex sales/CS team assignment, aliased SEGMENT_TEAM above) across the PMC's
    // rows, true when the most common team name is "SMB Manager". This is NOT a HubSpot
    // company-segment field — PARTNER_REPORTING_CORE_METRICS.HUBSPOT_COMPANY_SEGMENT has no
    // Flask equivalent and was a fabricated data source; removed.
    const is_smb = (() => {
      const counts = new Map<string, number>();
      for (const r of inNetwork) {
        if (!r.SEGMENT_TEAM) continue;
        counts.set(r.SEGMENT_TEAM, (counts.get(r.SEGMENT_TEAM) ?? 0) + 1);
      }
      let modeTeam: string | null = null, modeCount = 0;
      for (const [team, count] of counts) {
        if (count > modeCount) { modeTeam = team; modeCount = count; }
      }
      return modeTeam === "SMB Manager";
    })();

    // Growth trend slides (residents_units/adoption_trend/cohort_overview) override —
    // "auto" preserves the is_smb-only default above; "include"/"exclude" let an AE force
    // the segment veto either way. Derived here (not inline at each gate) since it's needed
    // by renderExecSummary's showSparklines below, ahead of where activeOrder is built.
    // (Restored 2026-08-19 — a concurrent Superblocks-side edit reverted this derivation back
    // to a plain is_smb check in the sparkline ternary below; re-synced with the same fix in
    // flex-pmc-reports.)
    const showGrowthSlides =
      growth_slides === "include" || ((growth_slides ?? "auto") === "auto" && is_smb);

    // Sparklines / period-comparison manual overrides (Kevin's ask) - null means "auto" (no
    // override; the existing derived default applies unchanged). Derived here, same reasoning
    // as showGrowthSlides above - needed before the execResult call further down.
    const sparklinesOverride = sparklines === "include" ? true : sparklines === "exclude" ? false : null;
    const periodComparisonOverride = period_comparison === "include" ? true : period_comparison === "exclude" ? false : null;

    // --- Auto-derive evidence_type from property-level avg rent ---
    // Python logic: median of per-property (rent_paid / bills_paid); if < $950 → "affordable"
    let evidence_type: "high_rent" | "affordable" = "high_rent";
    const propAvgRents = latestRows
      .filter((r) => r.BILLS_PAID > 0 && r.RENT_PAID > 0)
      .map((r) => r.RENT_PAID / r.BILLS_PAID);
    if (propAvgRents.length > 0) {
      const sorted = [...propAvgRents].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
      if (median < 950) {
        evidence_type = "affordable";
      }
    }

    // --- Segment percentiles (multi-benchmark slide) + rolling peer median (adoption trend) ---
    // These two Snowflake round-trips are independent of each other — segment percentiles only
    // needs hubspotSegment/latestCompletedMonth, rolling peer median only needs
    // networkPoolProps/latestRows (via lockedPeers, computed below) — but were previously
    // awaited one at a time. Compute lockedPeers first (pure JS, no query), then fire both
    // queries together.
    // CRITICAL: Exclude the named PMC(s) from the peer pool to avoid self-contamination.
    // On a 2-PMC combined report, the second PMC's NAR would otherwise inflate the P50.
    let segmentPercentiles: { metric: string; p25: number; p50: number; p75: number; p90: number; p99: number; pmcValue: number | null; lowerIsBetter?: boolean }[] = [];
    let canonicalPeerNarP50: number | null = null;
    // P25/P75 companions to canonicalPeerNarP50, resolved from the SAME tier at the SAME time -
    // added alongside the tenure-cohort tier fix below so the Performance Benchmarks slide's
    // IQR band can never show a P25/P75 from a different (snapshot) distribution than its own
    // P50 (Kevin's catch: P50 updated to the real 4.8-4.9% tenure-matched value, but P25/P75
    // stayed at the old snapshot's 11.9%/17.0% - an impossible P25 > P50 ordering on screen).
    let canonicalPeerNarP25: number | null = null;
    let canonicalPeerNarP75: number | null = null;
    let rollingPeerMedianMap: Record<string, { p50: number; p25?: number; p75?: number }> = {};
    // Compute months since launch for benchmark resolution (used by peer median + adoption trend)
    let _msl = 0;
    if (earliestRollout && latestCompletedMonth) {
      const [ey, em] = earliestRollout.split("-").map(Number);
      const [ly, lm] = latestCompletedMonth.split("-").map(Number);
      _msl = (ly - ey) * 12 + (lm - em) + 1;
    }

    // --- Locked peers for rolling median (faithful port of Flask's pull_rolling_peer_median
    // Step A, generator/data.py:4043-4199 — pure JS tiered matching, no query) ---
    // Computed regardless of tenure — the rolling time-series median (below) is only useful
    // for established PMCs (>=36mo), but this cohort itself also backs the Peer Benchmarks
    // slide's snapshot percentiles for PMCs of any tenure, so it can't be gated on _msl.
    //
    // This used to be a "simplified Flask approach" that quietly dropped two real tiers (multi-
    // state overlap, region) and mislabeled two more: its "footprint" tiers never actually
    // checked footprint bucket (single/regional/multi/national) — they behaved exactly like
    // Flask's unconditional "none" tiers under a misleading "geographic footprint" label. That's
    // the direct cause of the peer-median line coming back close to, but not matching, Flask's
    // (14.6% vs 15.0%) — a materially different (if similar-looking) cohort. Now matches Flask's
    // real ladder tier-for-tier, in the same order, with the same thresholds.
    let lockedPeers: string[] = [];
    let lockedPeersCriteria = "comparable PMCs";
    // Peer-candidate profile for GEO-TIER matching - query fired at the very top of this
    // function (right after cutoffStr), not here, so it overlaps with the rows query and the
    // two query batches in between instead of adding its own sequential stage. See that
    // definition for the full "why this shape" explanation (geo-matching grain, the deliberate
    // Flask deviation on excluding the subject PMC, etc.) - unchanged, just relocated.
    const peerCandidateRows = await peerCandidateRowsPromise;

    // For Expansion decks, peer-match against the FULL TARGET portfolio size instead of the
    // current enrolled size when the target is larger — every slide in the deck must agree on
    // one peer group (Flask app.py:1608-1668, Kevin's call 2026-08-08/2026-08-19: "make clark
    // re derive full target portfolio to match flask"). Resolved here, before the peer-matching
    // ladder below runs (lockedPeers/segmentPercentiles/canonicalPeerNarP50/stageBenchmarksMap
    // all key off subjectUnits, set from this), rather than at the later expTotalPortfolio call
    // site — subjectPortfolioTotalPromise already fired at the top of this function, so
    // resolving it here costs nothing extra. Reused (not recomputed) at the later
    // expTotalPortfolio site. Declared at this scope (not inside the `if` below) so both sites
    // can see it.
    let expTotalPortfolioEarly: number | null = null;
    if (deck_mode === "expansion") {
      expTotalPortfolioEarly = total_portfolio_units || null;
      if (!expTotalPortfolioEarly) {
        const [expPortfolioRow] = await subjectPortfolioTotalPromise;
        const acctUnits = expPortfolioRow?.TOTAL_COMPANY_UNITS ?? 0;
        expTotalPortfolioEarly = acctUnits > 0 ? acctUnits : (latestMonth?.units ?? 0);
      }
      // Region detail (Kevin's ask - Expansion's own "By State" slide never got QBR's DMA
      // sub-region drill-down). QBR awaits this inside its own needsQBRQueries batch further
      // down (unchanged); Expansion needs its own await since it never reaches that batch at
      // all - same hoisted promise either way, no duplicate query.
      regionDetail = await regionDetailPromise;
    }

    if (peerCandidateRows.length > 0) {
      // Step 1: Aggregate to PMC level for peer matching. avgRent is bills-weighted (summed
      // rent / summed bills) — matching Flask's per_pmc_totals (generator/data.py:4118-4121)
      // exactly.
      const pmcAgg = new Map<string, { totalUnits: number; totalRent: number; totalBills: number; stateCount: number }>();
      const pmcStateUnits = new Map<string, Map<string, number>>();
      for (const r of peerCandidateRows) {
        const units = r.UNITS ?? 0;
        const rent = r.RENT ?? 0;
        const bills = r.BILLS ?? 0;
        const existing = pmcAgg.get(r.PMC_NAME);
        if (!existing) {
          pmcAgg.set(r.PMC_NAME, { totalUnits: units, totalRent: rent, totalBills: bills, stateCount: 1 });
          pmcStateUnits.set(r.PMC_NAME, new Map([[r.PROPERTY_STATE, units]]));
        } else {
          existing.totalUnits += units;
          existing.totalRent += rent;
          existing.totalBills += bills;
          const su = pmcStateUnits.get(r.PMC_NAME)!;
          su.set(r.PROPERTY_STATE, (su.get(r.PROPERTY_STATE) ?? 0) + units);
        }
      }
      for (const [nm, su] of pmcStateUnits.entries()) {
        const agg = pmcAgg.get(nm);
        if (agg) agg.stateCount = su.size;
      }

      // Step 2: Subject's own profile — full per-state breakdown (needed for the overlap tier),
      // plus the same >=35%/>=45% real-plurality gating Flask uses for primaryState/dominantRegion
      // instead of an unconditional max() (a subject genuinely split ~35/35/30 across 3 states
      // has no real single-state identity and should fall through to region/footprint, not get
      // matched to peers who happen to share its barely-largest state).
      const enrolledUnitsForMatching = latestRows.reduce((s, r) => s + r.PROPERTY_UNIT_COUNT, 0);
      // Use the target portfolio size (resolved above) instead of the current enrolled size
      // when it's larger — see the comment at expTotalPortfolioEarly's declaration above.
      const subjectUnits = (expTotalPortfolioEarly != null && expTotalPortfolioEarly > enrolledUnitsForMatching)
        ? expTotalPortfolioEarly
        : enrolledUnitsForMatching;
      const subjectBills = latestRows.reduce((s, r) => s + r.BILLS_PAID, 0);
      const subjectRent = latestRows.reduce((s, r) => s + r.RENT_PAID, 0);
      const subjectAvgRent = subjectBills > 0 ? subjectRent / subjectBills : 0;
      const subjectStateUnits = new Map<string, number>();
      for (const r of latestRows) {
        if (r.PROPERTY_STATE) subjectStateUnits.set(r.PROPERTY_STATE, (subjectStateUnits.get(r.PROPERTY_STATE) ?? 0) + r.PROPERTY_UNIT_COUNT);
      }
      const primaryState = primaryStateIfDominant(subjectStateUnits);
      const dominantRegionName = dominantRegion(subjectStateUnits);
      const fpTarget = fpBucket(subjectStateUnits.size);

      interface PeerCandidate { name: string; totalUnits: number; avgRent: number; stateUnits: Map<string, number>; stateCount: number }
      const candidates: PeerCandidate[] = [];
      for (const [nm, agg] of pmcAgg) {
        candidates.push({
          name: nm,
          totalUnits: agg.totalUnits,
          avgRent: agg.totalBills > 0 ? agg.totalRent / agg.totalBills : 0,
          stateUnits: pmcStateUnits.get(nm) ?? new Map(),
          stateCount: agg.stateCount,
        });
      }

      // Step A1: multi-state overlap tier, tried BEFORE the dominant-state/region/footprint
      // ladder below — Flask's _resolve_geo_tier (generator/data.py:1341), see resolveGeoTier's
      // own comment for why this exists separately from the tiers it doesn't replace.
      if (subjectStateUnits.size > 0) {
        const overlap = resolveGeoTier(candidates, subjectStateUnits, 3);
        if (overlap.isOverlap) {
          let pool = overlap.matched;
          // Size-match on each candidate's units WITHIN the overlapping states (not their whole
          // portfolio) — a national operator can be far larger overall while genuinely comparable
          // in scale just within these states. Uses the SAME overlap-units figure resolveGeoTier
          // already computed internally; recomputed here identically since it isn't returned.
          const subjectStates = new Set([...subjectStateUnits.keys()]);
          const overlapUnitsOf = (su: Map<string, number>) => {
            let s = 0;
            for (const [st, u] of su) if (subjectStates.has(st)) s += u;
            return s;
          };
          pool = pool.filter((c) => {
            const ov = overlapUnitsOf(c.stateUnits);
            return ov >= subjectUnits * 0.60 && ov <= subjectUnits * 1.40;
          });
          if (pool.length >= 3) {
            if (subjectAvgRent > 0) {
              const rentSub = pool.filter((c) => c.avgRent >= subjectAvgRent * 0.70 && c.avgRent <= subjectAvgRent * 1.30);
              if (rentSub.length >= 3) pool = rentSub;
            }
            if (pool.length >= 3) {
              lockedPeers = pool.map((c) => c.name);
              lockedPeersCriteria = overlap.label;
            }
          }
        }
      }

      // Step A2: dominant-state -> region -> footprint -> none ladder, same order and
      // thresholds as Flask's `tiers` list (generator/data.py:4168-4181).
      if (lockedPeers.length === 0) {
        interface Tier { kind: "state" | "region" | "footprint" | "none"; lowMult: number; highMult: number; useRent: boolean; minPeers: number; label: string }
        const tiers: Tier[] = [];
        if (primaryState) {
          tiers.push({ kind: "state", lowMult: 0.60, highMult: 1.40, useRent: true, minPeers: 3, label: `same state (${primaryState}), comparable size & avg rent` });
        }
        if (dominantRegionName) {
          tiers.push({ kind: "region", lowMult: 0.60, highMult: 1.40, useRent: true, minPeers: 5, label: `${dominantRegionName} region, comparable size & avg rent` });
        }
        tiers.push(
          { kind: "footprint", lowMult: 0.65, highMult: 1.35, useRent: true, minPeers: 5, label: "geographic footprint, comparable size & avg rent" },
          { kind: "footprint", lowMult: 0.60, highMult: 1.40, useRent: true, minPeers: 3, label: "geographic footprint, comparable size & avg rent" },
          { kind: "footprint", lowMult: 0.30, highMult: 1.70, useRent: false, minPeers: 5, label: "geographic footprint & comparable size" },
          { kind: "none", lowMult: 0.30, highMult: 1.70, useRent: true, minPeers: 5, label: "comparable size & avg rent" },
          { kind: "none", lowMult: 0.30, highMult: 1.70, useRent: false, minPeers: 5, label: "comparable size" },
          { kind: "none", lowMult: 0.30, highMult: 1.70, useRent: false, minPeers: 3, label: "comparable size" },
        );

        for (const tier of tiers) {
          if (tier.useRent && subjectAvgRent <= 0) continue; // Flask: can't apply a rent band without the subject's own avg_rent
          let pool = candidates.filter((c) => c.totalUnits >= subjectUnits * tier.lowMult && c.totalUnits <= subjectUnits * tier.highMult);
          if (tier.kind === "state") pool = pool.filter((c) => primaryStateIfDominant(c.stateUnits) === primaryState);
          else if (tier.kind === "region") pool = pool.filter((c) => dominantRegion(c.stateUnits) === dominantRegionName);
          else if (tier.kind === "footprint") pool = pool.filter((c) => fpBucket(c.stateCount) === fpTarget);
          if (tier.useRent) pool = pool.filter((c) => c.avgRent >= subjectAvgRent * 0.70 && c.avgRent <= subjectAvgRent * 1.30);
          if (pool.length >= tier.minPeers) {
            lockedPeers = pool.map((c) => c.name);
            lockedPeersCriteria = tier.label;
            break;
          }
        }
      }
    }

    // P25/P75 added alongside the existing SMOOTHED_NAR (Kevin's catch: an established
    // (>=36mo) PMC's Peer Benchmarks slide could show a P50 from this rolling tier while
    // P25/P75 stayed stuck on whatever tier 2/3 set them to, producing an impossible
    // P75 < P50 ordering on screen when the two tiers' distributions didn't line up).
    const RollingPeerSchema = z.object({
      BP_MONTH: z.string(),
      SMOOTHED_NAR: z.number().nullable(),
      P25: z.number().nullable(),
      P75: z.number().nullable(),
    });
    const StageBenchmarkQuerySchema = z.object({
      MONTH_NUMBER: z.number(),
      P25: z.number().nullable(),
      P50: z.number().nullable(),
      P75: z.number().nullable(),
      PMC_COUNT: z.number(),
    });

    // Peer-Benchmarks percentiles — real formulas ported from Flask's `_run_supplemental_
    // benchmark` (generator/data.py:1920-2093), scoped to the SAME geo/size/rent-matched
    // `lockedPeers` cohort NAR uses (matching app.py's "canonical supplemental recompute",
    // app.py:1400-1421, which re-runs this exact query against the canonical peer list rather
    // than an independent segment). Replaces the fabricated PARTNER_REPORTING_CORE_METRICS /
    // HUBSPOT_COMPANY_SEGMENT read (that table+columns have zero Flask equivalent — confirmed
    // via full-repo grep). PMC_VALUE (the subject's own dot) is left NULL here and overridden
    // in JS below from values already computed elsewhere in this pipeline, so there's one
    // source of truth per metric instead of a second, divergent calculation.
    const segPercPromise = (lockedPeers.length >= 3 && latestCompletedMonth)
      ? ctx.integrations.snowflake_sso.query(
        `WITH peer_latest AS (
           SELECT PMC_NAME, MAX(BP_MONTH) AS BP_MONTH
           FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
           WHERE PMC_NAME IN (${lockedPeers.map(() => "?").join(", ")})
             AND BP_MONTH <= ?
             AND IS_INTEGRATED_TOTAL = TRUE
           GROUP BY PMC_NAME
         ),
         peer_current AS (
           SELECT t.PMC_NAME,
                  SUM(t.PROPERTY_UNIT_COUNT) AS UNITS,
                  SUM(t.CHARGED_USERS_COUNT) AS CHARGED_USERS
           FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS t
           JOIN peer_latest pl ON t.PMC_NAME = pl.PMC_NAME AND t.BP_MONTH = pl.BP_MONTH
           WHERE t.IS_INTEGRATED_TOTAL = TRUE
           GROUP BY t.PMC_NAME
         ),
         -- Portfolio Penetration's own peer CTE, kept separate from peer_current above.
         -- Flask's real peer_penetration CTE (generator/data.py:2035-2043) deliberately has
         -- NO IS_INTEGRATED_TOTAL filter - only HUBSPOT_DEAL_TOTAL_COMPANY_UNITS > 0. Reusing
         -- peer_current here (an earlier version of this query did) silently added that filter
         -- back in, which pulled in a different (smaller) peer distribution than Flask's -
         -- confirmed live: Flask P50/P75 = 46%/87%, ours = 80%/116% on an otherwise-identical
         -- peer cohort (other metrics' P50s matched almost exactly). Still uses peer_latest's
         -- per-peer join (not Flask's exact single-calendar-month BP_MONTH = rpt_str match) to
         -- avoid the stub-month bug fixed elsewhere in this file - that part of the deviation
         -- is intentional and unrelated to this fix.
         peer_penetration AS (
           -- Capped at 100% (LEAST(1.0, ...)) for the same reason Flask caps the SUBJECT's own
           -- displayed value (generator/data.py:2414-2416): HUBSPOT_DEAL_TOTAL_COMPANY_UNITS is
           -- a noisy per-deal snapshot that can understate a peer's true company size, which
           -- would otherwise show an impossible >100% "penetration" for that one peer and drag
           -- the whole P25/P50/P75 band with it (confirmed live: P75 showed 116%). Flask itself
           -- doesn't cap this on the peer side (only the subject's), but there's no principled
           -- reason a peer's noisy artifact should be allowed to distort the comparison band
           -- when the subject's own identical artifact isn't - same clamp pattern already used
           -- for peer_repeat's rate just below.
           SELECT t.PMC_NAME,
                  LEAST(1.0, SUM(t.PROPERTY_UNIT_COUNT) / NULLIF(MAX(t.HUBSPOT_DEAL_TOTAL_COMPANY_UNITS), 0)) AS PEN_RATE
           FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS t
           JOIN peer_latest pl ON t.PMC_NAME = pl.PMC_NAME AND t.BP_MONTH = pl.BP_MONTH
           WHERE t.HUBSPOT_DEAL_TOTAL_COMPANY_UNITS > 0
           GROUP BY t.PMC_NAME
         ),
         peer_engagement AS (
           SELECT t.PMC_NAME,
                  SUM(t.NEW_BILL_CONNECTIONS_PROPERTY) / NULLIF(pc.UNITS, 0) * 100 AS ENG_PER_100
           FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS t
           JOIN peer_current pc ON t.PMC_NAME = pc.PMC_NAME
           WHERE t.BP_MONTH BETWEEN DATEADD('month', -11, ?::DATE) AND ?
             AND t.IS_INTEGRATED_TOTAL = TRUE
           GROUP BY t.PMC_NAME, pc.UNITS
         ),
         peer_repeat AS (
           SELECT t.PMC_NAME,
                  AVG(LEAST(1.0, GREATEST(0.0,
                      (t.CHARGED_USERS_COUNT - t.NEW_SIGNUPS_COUNT)::FLOAT
                      / NULLIF(t.PREVIOUS_MONTH_CHARGED_USERS_COUNT, 0)
                  ))) AS REPEAT_RATE
           FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS t
           JOIN peer_current pc ON t.PMC_NAME = pc.PMC_NAME
           WHERE t.BP_MONTH BETWEEN DATEADD('month', -11, ?::DATE) AND ?
             AND t.PREVIOUS_MONTH_CHARGED_USERS_COUNT > 0
           GROUP BY t.PMC_NAME
         ),
         -- Time to First Sign-Up: avg DAYS (not months - Kevin's catch, see subjectSignupTimingValue
         -- above for the full reasoning) from a property's rollout to its first NEW BILL
         -- CONNECTION (not first payment). A bill connection is the "expressed interest /
         -- opted in" event -- a real signal distinct from payment, and NOT gated by the BP
         -- billing cycle the way payment is. RENTERS (resident-level, real timestamps) replaces
         -- PROPERTY_BP_MONTH_STATS (BP_MONTH granularity only) as the data source here, same as
         -- the subject-side query. BILL_CONNECTED_AT_UTC >= rollout date excludes residents who
         -- carry a connection timestamp from an earlier Flex-connected property - confirmed real
         -- necessary guard, not defensive-only (see subjectSignupTimingRows' query comment).
         signup_timing AS (
            -- Scoped to properties rolled out in the trailing 12 months, not a PMC's entire
            -- history -- Wellington joined 5 years ago, so a lifetime average would be
            -- dominated by rollouts from years back and say nothing about how fast marketing/
            -- ops get NEW properties live today. Matches the same trailing-12mo window every
            -- other metric on this slide (Engagement, Repeat Rate) already uses, for the same
            -- "how do things look now" reason.
            SELECT
               RESIDENT_PMC_NAME AS PMC_NAME,
               RESIDENT_PROPERTY_NAME AS PROPERTY_NAME,
               RESIDENT_PROPERTY_ROLLOUT_DATE AS ROLLOUT_DATE,
               MIN(BILL_CONNECTED_AT_UTC) AS FIRST_CONNECTED_AT
            FROM PRODUCTION.ANALYTICS.RENTERS
            WHERE RESIDENT_PMC_NAME IN (${lockedPeers.map(() => "?").join(", ")})
              AND RESIDENT_PROPERTY_ROLLOUT_DATE IS NOT NULL
              AND RESIDENT_PROPERTY_ROLLOUT_DATE >= DATEADD('month', -12, ?::DATE)
              AND RESIDENT_PROPERTY_ROLLOUT_DATE < ?::DATE
              AND BILL_CONNECTED_AT_UTC IS NOT NULL
              AND BILL_CONNECTED_AT_UTC >= RESIDENT_PROPERTY_ROLLOUT_DATE::TIMESTAMP_NTZ
            GROUP BY RESIDENT_PMC_NAME, RESIDENT_PROPERTY_NAME, RESIDENT_PROPERTY_ROLLOUT_DATE
         ),
         signup_timing_pmc AS (
            SELECT PMC_NAME, AVG(DATEDIFF('day', ROLLOUT_DATE, FIRST_CONNECTED_AT)) AS AVG_DAYS_TO_SIGNUP
            FROM signup_timing
            GROUP BY PMC_NAME
         )
         SELECT 'NAR' AS METRIC,
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY CHARGED_USERS / NULLIF(UNITS, 0)) AS P25,
                PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY CHARGED_USERS / NULLIF(UNITS, 0)) AS P50,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY CHARGED_USERS / NULLIF(UNITS, 0)) AS P75,
                NULL AS P90, NULL AS P99, NULL AS PMC_VALUE
         FROM peer_current
         WHERE UNITS > 0
         UNION ALL
         SELECT 'REPEAT_RATE' AS METRIC,
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY REPEAT_RATE) AS P25,
                PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY REPEAT_RATE) AS P50,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY REPEAT_RATE) AS P75,
                NULL AS P90, NULL AS P99, NULL AS PMC_VALUE
         FROM peer_repeat
         UNION ALL
         SELECT 'NEW_CONNECTIONS' AS METRIC,
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY ENG_PER_100) AS P25,
                PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY ENG_PER_100) AS P50,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ENG_PER_100) AS P75,
                NULL AS P90, NULL AS P99, NULL AS PMC_VALUE
         FROM peer_engagement
         WHERE ENG_PER_100 IS NOT NULL
         UNION ALL
         SELECT 'SIGNUP_TIMING' AS METRIC,
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY AVG_DAYS_TO_SIGNUP) AS P25,
                PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY AVG_DAYS_TO_SIGNUP) AS P50,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY AVG_DAYS_TO_SIGNUP) AS P75,
                NULL AS P90, NULL AS P99, NULL AS PMC_VALUE
         FROM signup_timing_pmc
         UNION ALL
         SELECT 'PENETRATION' AS METRIC,
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY PEN_RATE) AS P25,
                PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY PEN_RATE) AS P50,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY PEN_RATE) AS P75,
                NULL AS P90, NULL AS P99, NULL AS PMC_VALUE
         FROM peer_penetration`,
        SegmentPercentilesSchema,
        [
          ...lockedPeers, latestCompletedMonth, latestCompletedMonth, latestCompletedMonth, latestCompletedMonth, latestCompletedMonth,
          ...lockedPeers, cutoffStr, cutoffStr,
        ],
        { label: "Compute peer-cohort P25/P50/P75 for multi-benchmark (real cohort, not a segment table)" }
      ).catch((err) => { console.error("[PERC QUERY FAILED]", String(err)); return [] as z.infer<typeof SegmentPercentilesSchema>[]; })
      : Promise.resolve([] as z.infer<typeof SegmentPercentilesSchema>[]);

    const rollingPromise = (lockedPeers.length >= 3)
      ? ctx.integrations.snowflake_sso.query(
        `WITH peer_monthly AS (
            SELECT
              BP_MONTH,
              PMC_NAME,
              SUM(CHARGED_USERS_COUNT) / NULLIF(SUM(PROPERTY_UNIT_COUNT)::FLOAT, 0) AS nar
            FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
            WHERE PMC_NAME IN (${lockedPeers.map(() => "?").join(", ")})
              AND IS_INTEGRATED_TOTAL = TRUE
              -- cutoffStr is an EXCLUSIVE upper bound (1st of the next allowed month) —
              -- BETWEEN is inclusive on both ends, which let this match Snowflake's pre-created
              -- stub row for that month (zeroed billing columns), injecting a bogus NAR=0 point.
              AND BP_MONTH >= DATEADD('month', -${lookback_months + 3}, ?::DATE)
              AND BP_MONTH < ?
            GROUP BY BP_MONTH, PMC_NAME
         ),
         smoothed AS (
            SELECT
              BP_MONTH, PMC_NAME,
              AVG(nar) OVER (PARTITION BY PMC_NAME ORDER BY BP_MONTH ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS smoothed_nar
            FROM peer_monthly
         )
         SELECT
           TO_VARCHAR(BP_MONTH, 'YYYY-MM-DD') AS BP_MONTH,
           PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY smoothed_nar) AS SMOOTHED_NAR,
           PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY smoothed_nar) AS P25,
           PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY smoothed_nar) AS P75
         FROM smoothed
         WHERE BP_MONTH >= DATEADD('month', -?, ?::DATE)
           AND BP_MONTH < ?
           AND smoothed_nar IS NOT NULL
         GROUP BY BP_MONTH
         HAVING COUNT(*) >= 3
         ORDER BY BP_MONTH`,
        RollingPeerSchema,
        [...lockedPeers, cutoffStr, cutoffStr, lookback_months, cutoffStr, cutoffStr],
        { label: "Rolling peer median NAR (per-month P25/P50/P75 from locked peers)" }
      ).catch((err) => { console.error("[ROLLING QUERY FAILED]", String(err)); return [] as z.infer<typeof RollingPeerSchema>[]; })
      : Promise.resolve([] as z.infer<typeof RollingPeerSchema>[]);

    // Tenure-cohort benchmark for the Adoption Trend chart (months-since-launch 1-36), for PMCs
    // below the 36mo "established" threshold where rollingPromise above doesn't apply. Replaces
    // a stage_benchmarks construction that read PARTNER_REPORTING_CORE_METRICS.SEGMENT_NAR_AVG -
    // a column explicitly flagged elsewhere in this file as having no real Flask equivalent
    // ("fabricated data source"). Confirmed real: it produced 8.9% (wrong direction: "below
    // peer median") where Flask's real tenure-matched benchmark showed 4.8% ("1.6x above"), for
    // the same PMC, same report - and it dropped the most recent 1-2 months whenever that table
    // happened to have a null there, which is why the dashed line never reached the current
    // month. This scopes to the SAME already-resolved, geo/size/rent-matched `lockedPeers`
    // cohort every other slide in this deck uses (Peer Benchmarks, canonicalPeerNarP50) rather
    // than independently re-deriving Flask's separate stage-tier ladder (_pull_stage_benchmarks,
    // generator/data.py:2524) from scratch - internally consistent with the rest of this deck,
    // even if the resulting peer SET can differ in count from Flask's own separately-resolved
    // tenure tier. Mirrors Flask's real monthly_nar/monthly_nar_smoothed CTEs exactly: each
    // peer's OWN adoption rate at their OWN months-since-launch, smoothed over their trailing 3
    // months of tenure before aggregating cross-sectionally, adoption_rate > 0 filter included
    // (Flask drops zero/null months from the curve itself, not just from display).
    const stageBenchmarkPromise = (lockedPeers.length >= 3)
      ? ctx.integrations.snowflake_sso.query(
        `WITH pmc_launch AS (
            SELECT PMC_NAME, MIN(BP_MONTH) AS launch_month
            FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
            WHERE PMC_NAME IN (${lockedPeers.map(() => "?").join(", ")})
              AND ROLLOUT_MONTH IS NOT NULL
              AND IS_INTEGRATED_TOTAL = TRUE
            GROUP BY PMC_NAME
         ),
         monthly_nar AS (
            SELECT
              s.PMC_NAME,
              DATEDIFF('month', l.launch_month, s.BP_MONTH) + 1 AS month_number,
              SUM(s.BILLS_PAID_COUNT) / NULLIF(SUM(s.PROPERTY_UNIT_COUNT)::FLOAT, 0) AS adoption_rate
            FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS s
            JOIN pmc_launch l ON s.PMC_NAME = l.PMC_NAME
            WHERE s.PMC_NAME IN (${lockedPeers.map(() => "?").join(", ")})
              AND s.BP_MONTH >= l.launch_month
              AND s.BP_MONTH < ?
              AND s.IS_INTEGRATED_TOTAL = TRUE
            GROUP BY s.PMC_NAME, month_number
            HAVING adoption_rate IS NOT NULL AND adoption_rate > 0
         ),
         monthly_nar_smoothed AS (
            SELECT
              PMC_NAME, month_number,
              AVG(adoption_rate) OVER (
                PARTITION BY PMC_NAME ORDER BY month_number
                ROWS BETWEEN 2 PRECEDING AND CURRENT ROW
              ) AS smoothed_adoption_rate
            FROM monthly_nar
         )
         SELECT
           month_number AS MONTH_NUMBER,
           PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY smoothed_adoption_rate) AS P25,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY smoothed_adoption_rate) AS P50,
           PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY smoothed_adoption_rate) AS P75,
           COUNT(DISTINCT PMC_NAME) AS PMC_COUNT
         FROM monthly_nar_smoothed
         WHERE month_number BETWEEN 1 AND 36
         GROUP BY month_number
         ORDER BY month_number`,
        StageBenchmarkQuerySchema,
        [...lockedPeers, ...lockedPeers, cutoffStr],
        { label: "Tenure-cohort peer benchmark for Adoption Trend chart (locked peers, months-since-launch)" }
      ).catch((err) => { console.error("[STAGE BENCHMARK QUERY FAILED]", String(err)); return [] as z.infer<typeof StageBenchmarkQuerySchema>[]; })
      : Promise.resolve([] as z.infer<typeof StageBenchmarkQuerySchema>[]);

    // On-Time Payment Rate via CPT_OUTCOMES_SEMANTIC_VIEW was tried and pulled back out.
    // Querying that semantic view crashed the ENTIRE report generation ("Generation failed"),
    // not a graceful per-metric degradation the way every other optional query in this file
    // fails safely -- something about semantic-view queries hits a harder failure mode in
    // Superblocks' integration than a normal table query does, severe enough that the
    // .catch()-guarded promise wrapping it never even got the chance to run. Not safe to
    // re-attempt without confirming, outside this pipeline, that a SEMANTIC_VIEW()/AGG() query
    // against this integration can succeed at all -- reintroducing this blind risks breaking
    // report generation again.

    // Fire both independent round-trips together instead of one at a time
    const [percRows, rollingRows, stageBenchmarkRows] = await Promise.all([segPercPromise, rollingPromise, stageBenchmarkPromise]);

    // Build the tenure-bucketed benchmark map the Adoption Trend chart reads (kpis.stage_benchmarks).
    // peer_label matches lockedPeersCriteria - the SAME criteria string the Peer Benchmarks slide
    // shows, so the two never disagree on what "peer" means (this deck's whole reason for having
    // a canonical/locked peer cohort at all). pmc_count surfaces how many peers actually had data
    // at that specific bucket, shown alongside the label (Kevin's ask) - a bucket down to 2 peers
    // shouldn't read with the same confidence as one with 5.
    const stageBenchmarksMap: Record<number, { p25: number | null; p50: number | null; p75: number | null; peer_label?: string; pmc_count?: number }> = {};
    for (const row of stageBenchmarkRows) {
      if (row.P50 != null) {
        stageBenchmarksMap[row.MONTH_NUMBER] = { p25: row.P25, p50: row.P50, p75: row.P75, peer_label: lockedPeersCriteria, pmc_count: row.PMC_COUNT };
      }
    }

    // PMC_VALUE is always NULL from the query above (the subject is excluded from lockedPeers,
    // so it can't appear in its own peer-percentile query) — filled in from values already
    // computed elsewhere in this pipeline right below, one source of truth per metric.
    segmentPercentiles = percRows
      .filter((r) => r.P25 != null && r.P50 != null && r.P75 != null)
      .map((r) => ({
        metric: r.METRIC,
        p25: r.P25!,
        p50: r.P50!,
        p75: r.P75!,
        p90: r.P90 ?? r.P75! * 1.2,
        p99: r.P99 ?? r.P75! * 1.4,
        pmcValue: r.PMC_VALUE ?? 0,
      }));

    // TEMPORARY diagnostic — the engagement fix moved the number (42 -> 47) but in the wrong
    // direction relative to Flask's 33, meaning something in this new formula still doesn't
    // match. Hoisted so the debug panel below can show the actual intermediate values instead
    // of guessing again from the final result alone.
    let _engDebugTotalConnects: number | null = null;
    let _engDebugAvgUnits: number | null = null;
    let _engDebugMonthsFound: string[] = [];
    let _engDebugWindowStart = "";

    // Fill in the subject's own value per metric from real, already-computed data (not a
    // second/divergent calculation): NAR from the subject's latest-month adoption rate;
    // engagement from the subject's own trailing-12mo per-property T12_CONNECTIONS, matching
    // the peer query's units-weighted formula exactly; signup timing from trendRawRows (already
    // fetched for the property trend badges — reused here rather than a second query).
    {
      const subjectNarValue = latestMonth?.adoptionRate ?? null;
      // Flask (generator/data.py:2328-2338): trailing-12mo SUM of new bill connections across
      // ALL properties, divided by the AVERAGE monthly total unit count over that same window —
      // a network-wide ratio, NOT a unit-weighted average of each property's own individually-
      // computed rate (a different, non-equivalent aggregation: summing a ratio-of-ratios biases
      // toward smaller properties' individual rates in a way Flask's single network-wide ratio
      // doesn't). This was ALSO reading from networkPoolProps — the shared/filtered pool built
      // for peer-matching (months_live >= 7, avg rent $700-2500 band) — which silently excluded
      // some of the subject's OWN properties that don't happen to meet those PEER-comparability
      // filters.
      //
      // Second bug, found from the actual debug numbers (1319 connects / 2809.75 avg units =
      // 46.9, arithmetically correct but still the wrong INPUTS): Flask's df here comes from
      // pull_pmc_data (generator/data.py:170-228), whose SQL has NO IS_IN_NETWORK filter AT ALL
      // -- it pulls every property-month row for the PMC in the window regardless of network
      // status. inNetwork (this file's own filtered view) excludes OON/not-yet-integrated
      // property-months -- which Flask's calc does NOT exclude. Those OON months still add their
      // full unit count to the denominator while contributing near-zero bill connections,
      // diluting Flask's ratio downward relative to a version that properly excludes them (this
      // is why removing the filter moves the number DOWN toward Flask's, not up). allRows (the
      // unfiltered fetch inNetwork itself is filtered FROM) is the right source here, not
      // inNetwork -- no second query needed, already fetched.
      const engWindowStart = (() => {
        const [cy, cm] = cutoffStr.split("-").map(Number);
        return new Date(cy, cm - 1 - 12, 1).toISOString().slice(0, 10);
      })();
      const engUnitsByMonth = new Map<string, number>();
      let engTotalConnects = 0;
      for (const r of allRows) {
        if (r.BP_MONTH < engWindowStart || r.BP_MONTH >= cutoffStr) continue;
        engUnitsByMonth.set(r.BP_MONTH, (engUnitsByMonth.get(r.BP_MONTH) ?? 0) + r.PROPERTY_UNIT_COUNT);
        engTotalConnects += r.NEW_BILL_CONNECTIONS ?? 0;
      }
      const engAvgUnitsRecent = engUnitsByMonth.size > 0
        ? [...engUnitsByMonth.values()].reduce((s, v) => s + v, 0) / engUnitsByMonth.size
        : 0;
      const subjectEngValue = engAvgUnitsRecent > 0 ? engTotalConnects / engAvgUnitsRecent * 100 : null;
      _engDebugTotalConnects = engTotalConnects;
      _engDebugAvgUnits = engAvgUnitsRecent;
      _engDebugMonthsFound = [...engUnitsByMonth.keys()].sort();
      _engDebugWindowStart = engWindowStart;
      // Real days (not months) from rollout to first resident bill connection - subjectSignupTimingRows
      // is already scoped to the trailing 12 months and already excludes carried-over history
      // from a prior property (BILL_CONNECTED_AT_UTC >= rollout date, enforced in the query
      // itself). "Days" not "months" was Kevin's catch - a same-BP-month rollout+connection
      // used to always read as "0.0 months" regardless of whether that meant 1 day or 29.
      const subjectSignupTimingValue = (() => {
        const [cy, cm] = cutoffStr.split("-").map(Number);
        const daysList: number[] = [];
        let mostRecentContributingRollout: string | null = null;
        for (const r of subjectSignupTimingRows) {
          const rolloutMs = new Date(r.ROLLOUT_DATE + "T00:00:00Z").getTime();
          const connectedMs = new Date(r.FIRST_CONNECTED_AT.replace(" ", "T") + "Z").getTime();
          if (Number.isNaN(rolloutMs) || Number.isNaN(connectedMs)) continue;
          const days = Math.round((connectedMs - rolloutMs) / 86_400_000);
          daysList.push(Math.max(0, days));
          if (!mostRecentContributingRollout || r.ROLLOUT_DATE > mostRecentContributingRollout) {
            mostRecentContributingRollout = r.ROLLOUT_DATE;
          }
        }
        if (daysList.length === 0) return null;
        // Gate on recency (Kevin's catch): this metric measures whichever cohort happens to be
        // in the trailing-12mo window, which can be a single rollout from 10+ months ago -
        // stale data about how onboarding USED to go, not a live signal about how it's going
        // now. Only trust it if the most recent contributing rollout is itself within the
        // trailing 3 months - i.e. there's actually been a recent "class" to measure, not just
        // a wide lookback window catching something old.
        const recentEnoughCutoff = new Date(cy, cm - 1 - 3, 1).toISOString().slice(0, 10);
        if (!mostRecentContributingRollout || mostRecentContributingRollout < recentEnoughCutoff) {
          return null;
        }
        return daysList.reduce((s, v) => s + v, 0) / daysList.length;
      })();
      // Flask: pmc_penetration = min(enrolled_units / total_company_units, 1.0) — capped so a
      // stale/undersized total-company-units figure can't produce an impossible >100%.
      // total_company_units comes from the Salesforce-accounts query above, NOT
      // HUBSPOT_DEAL_TOTAL_COMPANY_UNITS (that field is a noisy per-deal snapshot Flask
      // explicitly avoids for this calc — see the query's comment above). If the Salesforce
      // query fails or the PMC has no matching account, Flask leaves pmc_penetration as None
      // rather than falling back to a different, less-trustworthy denominator — matched here
      // by leaving subjectPenetrationValue null instead of using the HubSpot field as a fallback.
      const [subjectPortfolioRow] = await subjectPortfolioTotalPromise;
      if (subjectPortfolioTotalError) {
        console.warn(`[PMC Report] subject portfolio-total Salesforce query failed for ${pmc_name}: ${subjectPortfolioTotalError}`);
      }
      const subjectTotalCompanyUnits = subjectPortfolioRow?.TOTAL_COMPANY_UNITS ?? 0;
      // Numerator: latestMonth.units (IS_IN_NETWORK-filtered), NOT Flask's literal
      // current["property_unit_count"].sum() (unfiltered df, same missing-filter pattern as
      // the engagement bug fixed earlier). Verified live for Wellington: Flask's own SFDC
      // snapshot (ACCOUNT_TOTAL_COMPANY_UNITS / ACCOUNT_FLEX_UNITS = 4,300 / 2,992 = 69.6%)
      // reconciles almost exactly with this IS_IN_NETWORK-filtered number (68%), while Flask's
      // compute_benchmark() itself displays 94% - implying an enrolled-units numerator ~1,090
      // higher than Salesforce's own recorded figure, almost certainly non-in-network rows
      // leaking into Flask's unfiltered sum. Deliberately NOT matching Flask's literal
      // behavior here since it demonstrably drifts from ground truth; Flask's own
      // compute_benchmark should get the equivalent fix (scope current to IS_IN_NETWORK rows)
      // rather than this side chasing Flask's inflated number.
      const subjectPenetrationValue = subjectTotalCompanyUnits > 0
        ? Math.min((latestMonth?.units ?? 0) / subjectTotalCompanyUnits, 1.0)
        : null;
      segmentPercentiles = segmentPercentiles.map((m) => {
        if (m.metric === "NAR" && subjectNarValue != null) return { ...m, pmcValue: subjectNarValue };
        if (m.metric === "NEW_CONNECTIONS" && subjectEngValue != null) return { ...m, pmcValue: subjectEngValue };
        // lowerIsBetter: faster (fewer months) is the better outcome — see BenchmarkMetric's
        // own comment for why this has to be flagged explicitly on the metric object. pmcValue
        // stays null (not defaulted to 0) when there's no real trendRawRows data — the renderer
        // already hides a row whose pmcValue is null, and a 0-month fallback would display as
        // "instant," which is a misleading placeholder, not a real result.
        if (m.metric === "SIGNUP_TIMING") return { ...m, pmcValue: subjectSignupTimingValue, lowerIsBetter: true };
        if (m.metric === "PENETRATION") return { ...m, pmcValue: subjectPenetrationValue };
        return m;
      });
    }

    for (const row of rollingRows) {
      if (row.SMOOTHED_NAR != null) {
        rollingPeerMedianMap[row.BP_MONTH] = { p50: row.SMOOTHED_NAR, p25: row.P25 ?? undefined, p75: row.P75 ?? undefined };
      }
    }

    // --- Canonical Peer Benchmark (one resolved P50 NAR per deck) ---
    // Resolution order now mirrors Flask's resolve_canonical_benchmark EXACTLY
    // (generator/data.py:2126-2205) - the stage-bucket tier below was the missing piece
    // (previously "not yet ported... a known gap"), now that stageBenchmarksMap exists.
    //   1. Rolling calendar-time peer median (established PMCs, tenure >= 36 months) — real,
    //      time-series, from the SAME geo/size/rent-matched lockedPeers cohort.
    //   2. Tenure-cohort benchmark (nearest stage_benchmarks bucket to months_since_launch) -
    //      for PMCs under 36mo, or established PMCs whose rolling query came back empty.
    //   3. Snapshot P50 across lockedPeers (real, single-month) — only when neither above has
    //      data at all.
    // Every slide that shows a peer-median number MUST read from this single value. Confirmed
    // real, Kevin's catch: before this, Peer Benchmarks/QBR Close showed tier 3's snapshot
    // (11.8%) while the Adoption Trend chart showed the real tenure-matched curve (4.9%) for
    // the SAME PMC, same report - Flask's real function resolves both from the same value.
    {
      const narPerc = segmentPercentiles.find((s) => s.metric === "NAR");
      if (narPerc) {
        canonicalPeerNarP50 = narPerc.p50; // tier 3
        canonicalPeerNarP25 = narPerc.p25;
        canonicalPeerNarP75 = narPerc.p75;
      }

      // Tier 2: nearest tenure bucket to months_since_launch, mirroring Flask's
      // `min(stage_bmarks.keys(), key=lambda k: abs(k - months_since))` exactly. P25/P75 move
      // WITH P50 here, from the same bucket's same smoothed cross-sectional distribution -
      // never left behind pointing at tier 3's unrelated snapshot (Kevin's catch).
      if (Object.keys(stageBenchmarksMap).length > 0 && _msl > 0) {
        let nearestMn = -1;
        let nearestDist = Infinity;
        for (const mnStr of Object.keys(stageBenchmarksMap)) {
          const mn = Number(mnStr);
          const dist = Math.abs(mn - _msl);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearestMn = mn;
          }
        }
        const nearestRow = nearestMn >= 0 ? stageBenchmarksMap[nearestMn] : undefined;
        if (nearestRow?.p50 != null) {
          canonicalPeerNarP50 = nearestRow.p50;
          canonicalPeerNarP25 = nearestRow.p25;
          canonicalPeerNarP75 = nearestRow.p75;
        }
      }

      // Tier 1 (highest priority): rolling calendar-time peer median - established PMCs
      // (>=36mo) only, matching Flask's msl_is_capped gate. Without this gate, a PMC under
      // 36mo with a stray non-empty rollingPeerMedianMap (e.g. the network-wide fallback a
      // few hundred lines up) would wrongly prefer calendar-time movement over the real
      // tenure-matched comparison for a PMC still in its ramp stage.
      // FIXED (Kevin's catch - Peer Benchmarks slide showing P75 < P50, an impossible
      // ordering): rollingPromise/RollingPeerSchema now computes P25/P75 alongside
      // SMOOTHED_NAR (P50) - all three come from this same tier's same smoothed
      // cross-sectional distribution, never a P50 from here left paired with P25/P75 still
      // pointing at tier 2/3's unrelated distribution.
      if (_msl >= 36 && rollingRows.length > 0) {
        const latestPeer = rollingRows[rollingRows.length - 1];
        if (latestPeer.SMOOTHED_NAR != null) {
          canonicalPeerNarP50 = latestPeer.SMOOTHED_NAR;
          if (latestPeer.P25 != null) canonicalPeerNarP25 = latestPeer.P25;
          if (latestPeer.P75 != null) canonicalPeerNarP75 = latestPeer.P75;
        }
      }
    }

    // Fallback: if tiered matching failed to produce per-month data, run a broader
    // network-wide rolling median (all PMCs except subject) to avoid a flat line. This one
    // stays sequential — it's a genuine fallback that only fires when the query above came
    // back empty, so it can't be fired in parallel with it.
    if (_msl >= 36 && networkPoolProps.length > 0 && Object.keys(rollingPeerMedianMap).length === 0) {
      try {
        const networkWideRolling = await ctx.integrations.snowflake_sso.query(
          `WITH peer_monthly AS (
              SELECT
                BP_MONTH,
                PMC_NAME,
                SUM(CHARGED_USERS_COUNT) / NULLIF(SUM(PROPERTY_UNIT_COUNT)::FLOAT, 0) AS nar
              FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
              WHERE PMC_NAME != ?
                AND IS_INTEGRATED_TOTAL = TRUE
                -- cutoffStr is exclusive (see peer_latest above) — BETWEEN's inclusive upper
                -- bound let this same query pick up the pre-created, not-yet-real stub month.
                AND BP_MONTH >= DATEADD('month', -${lookback_months + 3}, ?::DATE)
                AND BP_MONTH < ?
              GROUP BY BP_MONTH, PMC_NAME
              HAVING SUM(PROPERTY_UNIT_COUNT) >= 10
           ),
           smoothed AS (
              SELECT
                BP_MONTH, PMC_NAME,
                AVG(nar) OVER (PARTITION BY PMC_NAME ORDER BY BP_MONTH ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS smoothed_nar
              FROM peer_monthly
           )
           SELECT
             TO_VARCHAR(BP_MONTH, 'YYYY-MM-DD') AS BP_MONTH,
             PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY smoothed_nar) AS SMOOTHED_NAR,
             PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY smoothed_nar) AS P25,
             PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY smoothed_nar) AS P75
           FROM smoothed
           WHERE BP_MONTH >= DATEADD('month', -?, ?::DATE)
             AND BP_MONTH < ?
             AND smoothed_nar IS NOT NULL
           GROUP BY BP_MONTH
           HAVING COUNT(*) >= 10
           ORDER BY BP_MONTH`,
          RollingPeerSchema,
          [pmc_name, cutoffStr, cutoffStr, lookback_months, cutoffStr, cutoffStr],
          { label: "Network-wide rolling median NAR (fallback, P25/P50/P75)" }
        );
        for (const row of networkWideRolling) {
          if (row.SMOOTHED_NAR != null) {
            rollingPeerMedianMap[row.BP_MONTH] = { p50: row.SMOOTHED_NAR, p25: row.P25 ?? undefined, p75: row.P75 ?? undefined };
          }
        }
      } catch (_e2) {
        console.error("[NETWORK-WIDE ROLLING FAILED]", String(_e2));
        // If even the network-wide query fails, peer median line will be hidden
      }
    }

    // --- Compute cohort data ---
    const cohortMap = new Map<string, { propertyIds: Set<string>; totalUnits: number; currentResidents: number; currentRent: number }>();
    for (const r of latestRows) {
      if (!r.ROLLOUT_MONTH) continue;
      const existing = cohortMap.get(r.ROLLOUT_MONTH) || { propertyIds: new Set<string>(), totalUnits: 0, currentResidents: 0, currentRent: 0 };
      if (r.PROPERTY_PUBLIC_ID) existing.propertyIds.add(r.PROPERTY_PUBLIC_ID);
      existing.totalUnits += r.PROPERTY_UNIT_COUNT;
      existing.currentResidents += r.BILLS_PAID;
      existing.currentRent += r.RENT_PAID;
      cohortMap.set(r.ROLLOUT_MONTH, existing);
    }

    // Cumulative rent per cohort (sum of RENT_PAID across ALL months since rollout, not just current)
    const cohortCumRentMap = new Map<string, number>();
    for (const r of inNetwork) {
      if (!r.ROLLOUT_MONTH) continue;
      cohortCumRentMap.set(r.ROLLOUT_MONTH, (cohortCumRentMap.get(r.ROLLOUT_MONTH) ?? 0) + r.RENT_PAID);
    }

    const cohorts: CohortRow[] = Array.from(cohortMap.entries())
      .map(([rolloutMonth, c]) => ({
        rolloutMonth,
        propertyCount: c.propertyIds.size,
        totalUnits: c.totalUnits,
        currentResidents: c.currentResidents,
        currentRent: c.currentRent,
        cumulativeRent: cohortCumRentMap.get(rolloutMonth) ?? 0,
        cohortNar: c.totalUnits > 0 ? c.currentResidents / c.totalUnits : 0,
      }))
      .sort((a, b) => a.rolloutMonth.localeCompare(b.rolloutMonth));

    // --- Compute cohort monthly NAR for sparklines ---
    // For each cohort (by rollout_month), compute NAR per billing period
    const cohortMonthly = new Map<string, (number | null)[]>();
    const sortedMonthKeys = Array.from(monthMap.keys()).sort();
    for (const [cohortRollout] of cohortMap.entries()) {
      const narValues: (number | null)[] = [];
      for (const bpMonth of sortedMonthKeys) {
        // Get rows for this cohort in this bp_month
        const cohortRows = inNetwork.filter(
          (r) => r.ROLLOUT_MONTH === cohortRollout && r.BP_MONTH === bpMonth
        );
        if (cohortRows.length === 0) {
          narValues.push(null);
        } else {
          const units = cohortRows.reduce((s, r) => s + r.PROPERTY_UNIT_COUNT, 0);
          const residents = cohortRows.reduce((s, r) => s + r.BILLS_PAID, 0);
          narValues.push(units > 0 ? residents / units : null);
        }
      }
      cohortMonthly.set(cohortRollout, narValues);
    }

    // --- Render slide blocks ---
    const totalUnitsAll = latestRows.reduce((s, r) => s + r.PROPERTY_UNIT_COUNT, 0);

    // Compute prevPropertyCount (distinct properties in the prev month)
    const prevMonthStr = prevMonth?.month ?? null;
    const prevPropertyCount = prevMonthStr
      ? new Set(inNetwork.filter((r) => r.BP_MONTH === prevMonthStr).map((r) => r.PROPERTY_NAME)).size
      : null;

    // Compute DQ shielded since comparison month (same cutoff as other tiles) — filtered from
    // the same lookback_months-windowed rows as lifetimeDqShielded above, not the raw pull.
    const comparisonMonth = prevMonth?.month ?? null;
    const dqSinceComparison = comparisonMonth
      ? dqWindowedRows
          .filter((r) => r.BP_MONTH != null && r.BP_MONTH! > comparisonMonth)
          .reduce((sum, r) => sum + (r.TOTAL_RENT_SHIELDED ?? 0), 0)
      : null;

    // Cohort-based true repeat rate (preferred over MoM aggregate — matches Flask). Gated on
    // TOTAL_CUSTOMERS (same RELIABLE_REPEAT_RATE_MIN floor as the MoM fallback above) - this is
    // the single, shared, gated source every downstream reader of the cohort repeat rate uses
    // (also feeds subjectRepeatValue and cohortTrueRepeatRate below), so the floor can't be
    // applied at one read site and forgotten at another.
    const cohortTrueRepeatEarly = (retentionCohortRows.length > 0 && (retentionCohortRows[0]?.TOTAL_CUSTOMERS ?? 0) >= RELIABLE_REPEAT_RATE_MIN)
      ? retentionCohortRows[0]?.TRUE_REPEAT_RATE ?? null
      : null;
    const effectiveTrueRepeat = cohortTrueRepeatEarly ?? trueRepeatRate;

    const execResult = renderExecSummary({
      pmcName: pmcDisplayName,
      reportingMonth: latestCompletedMonth,
      partnerSince,
      lookbackMonths: lookback_months,
      targetNar: adoption_target,
      currentNar: latestMonth?.adoptionRate ?? 0,
      currentResidents: latestMonth?.billsPaid ?? 0,
      currentRent: latestMonth?.rentPaid ?? 0,
      currentNewSignups: latestMonth?.newSignups ?? 0,
      lifetimeRent,
      propertyCount: uniqueProperties.size,
      totalUnits: totalUnitsAll,
      prevNar: prevMonth?.adoptionRate ?? null,
      prevResidents: prevMonth?.billsPaid ?? null,
      prevRent: prevMonth?.rentPaid ?? null,
      prevNewSignups: prevMonth?.newSignups ?? null,
      prevPropertyCount: prevPropertyCount !== null && prevPropertyCount > 0 ? prevPropertyCount : null,
      prevUnits: prevMonth?.units ?? null,
      monthlyTotals,
      trueRepeatRate: effectiveTrueRepeat,
      lifetimeDqShielded: lifetimeDqShielded > 0 ? lifetimeDqShielded : null,
      dqSinceComparison: dqSinceComparison != null && dqSinceComparison > 0 ? dqSinceComparison : null,
      hiddenTiles: hidden_kpi_tiles,
      slideId: 2,
      // Flask: QBR always show_sparklines=False (hardcoded, unconditional).
      // Expansion: show_sparklines = not (_show_growth and 54 in active_exp_order).
      // Since slide 54 = "residents_units", suppress sparklines on expansion when the growth
      // trend slides are showing (SMB by default, or forced via growth_slides="include") and
      // that slide specifically is included (it renders the same data as a full chart).
      // An empty expansion_slides array means "no filter" (all slides included) per the
      // activeOrder build below — match that semantics here rather than treating [] as "off".
      // sparklinesOverride is Expansion-only (Kevin's call: QBR stays exactly as-is - it never
      // shows sparklines regardless, so an override has nothing to attach to there anyway).
      // `?? ` so "auto" (null) falls through to the existing derived default unchanged.
      showSparklines: deck_mode === "qbr" ? false
        : deck_mode === "expansion" ? (sparklinesOverride ?? !(showGrowthSlides && (
            expansion_slides && expansion_slides.length > 0
              ? expansion_slides.includes("residents_units")
              : true
          )))
        : false,
      // Same Expansion-only scoping as sparklinesOverride above - QBR's comparison pills always
      // show today with no override mechanism to hook into, so leaving it false there preserves
      // that exactly.
      hidePeriodComparison: deck_mode === "expansion" && periodComparisonOverride === false,
      vsLabel,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // SHARED DATA: Delinquency, Retention, Loyalty — used by Expansion & QBR
    // ─────────────────────────────────────────────────────────────────────────
    const dqMonths = dqShieldedRows
      .filter((r) => r.BP_MONTH != null)
      .sort((a, b) => (a.BP_MONTH! < b.BP_MONTH! ? -1 : 1))
      .map((r) => ({
        month: r.BP_MONTH!,
        totalRentShielded: r.TOTAL_RENT_SHIELDED ?? 0,
        residentsShielded: r.NUMBER_OF_RESIDENTS ?? 0,
      }));

    // Flask's real MoM retention (render_retention, generator/slides.py) is a true
    // customer-level set intersection between consecutive months — NOT a ratio of two
    // pre-aggregated columns. Build month -> set(customer_public_id) from the raw pairs,
    // then rate = |prior month's customers ∩ this month's customers| / |prior month's customers|.
    const customerMonthMap = new Map<string, Set<string>>();
    for (const row of customerMonthRows) {
      if (!customerMonthMap.has(row.BP_MONTH)) customerMonthMap.set(row.BP_MONTH, new Set());
      customerMonthMap.get(row.BP_MONTH)!.add(row.CUSTOMER_PUBLIC_ID);
    }
    const sortedCustomerMonths = [...customerMonthMap.keys()]
      .filter((m) => m <= latestCompletedMonth)
      .sort();
    const momRetentionRates: { month: string; rate: number }[] = [];
    for (let i = 1; i < sortedCustomerMonths.length; i++) {
      const priorIds = customerMonthMap.get(sortedCustomerMonths[i - 1])!;
      const curIds = customerMonthMap.get(sortedCustomerMonths[i])!;
      if (priorIds.size === 0) continue;
      let intersectionCount = 0;
      for (const id of priorIds) if (curIds.has(id)) intersectionCount++;
      momRetentionRates.push({ month: sortedCustomerMonths[i], rate: intersectionCount / priorIds.size });
    }

    const retentionAvg = momRetentionRates.length > 0
      ? momRetentionRates.reduce((s, r) => s + r.rate, 0) / momRetentionRates.length
      : 0;

    // Subject's own true repeat rate for the Peer Benchmarks REPEAT_RATE row's dot — matching
    // Flask's kpis.get("true_repeat_rate") or kpis.get("avg_retention") fallback (slides.py:328).
    // Computed here (shared by both QBR and expansion mode, which branches before QBR's own
    // later retention-slide computation of the same value) so it exists before either code path
    // that might read it.
    const subjectRepeatValue = (cohortTrueRepeatEarly ?? trueRepeatRate) ?? retentionAvg;

    let loyaltyBuckets: { name: string; description: string; count: number; color: string }[] | null = null;
    let loyaltyTotal = 0;
    let loyaltyTitle = "Loyalty rate across active residents";

    if (retentionCohortRows.length > 0) {
      const totalCustomers = retentionCohortRows[0]?.TOTAL_CUSTOMERS ?? 0;
      loyaltyTotal = totalCustomers;

      if (totalCustomers >= 5) {
        const getBucket = (name: string) => retentionCohortRows.find((r) => r.LOYALTY_BUCKET === name)?.BUCKET_COUNT ?? 0;
        const perfect = getBucket("PERFECT");
        const high = getBucket("HIGH");
        const regular = getBucket("REGULAR");
        const episodic = getBucket("EPISODIC");

        loyaltyBuckets = [
          { name: "Perfect ⭐", description: "every available month", count: perfect, color: "#1a9e6a" },
          { name: "High", description: "75–99% of months", count: high, color: "#6A3DB8" },
          { name: "Regular", description: "50–74% of months", count: regular, color: "#d97706" },
          { name: "Episodic", description: "< 50% of months", count: episodic, color: "#a09cb0" },
        ];

        const pctPerfect = totalCustomers > 0 ? perfect / totalCustomers : 0;
        const pctHigh = totalCustomers > 0 ? high / totalCustomers : 0;
        const pctEpisodic = totalCustomers > 0 ? episodic / totalCustomers : 0;

        // Third case: if Perfect tier is empty, drop down to High tier for headline
        if (perfect > 0) {
          loyaltyTitle = episodic > 0
            ? `${(pctPerfect * 100).toFixed(0)}% used Flex every available month – ${(pctEpisodic * 100).toFixed(0)}% used it when they needed it.`
            : `${(pctPerfect * 100).toFixed(0)}% used Flex every available month.`;
        } else if (high > 0) {
          loyaltyTitle = episodic > 0
            ? `${(pctHigh * 100).toFixed(0)}% used Flex 75%+ of available months – ${(pctEpisodic * 100).toFixed(0)}% used it when they needed it.`
            : `${(pctHigh * 100).toFixed(0)}% used Flex 75%+ of available months.`;
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NEW LOGO DECK MODE — 3 slides only
    // ─────────────────────────────────────────────────────────────────────────
    if (deck_mode === "new_logo") {
      const totalRent = monthlyTotals.reduce((s, m) => s + m.rentPaid, 0);
      const totalBills = monthlyTotals.reduce((s, m) => s + m.billsPaid, 0);
      const totalSignups = monthlyTotals.reduce((s, m) => s + m.newSignups, 0);

      const launchResult = renderLaunchSnapshot({
        slideId: 2,
        pmcName: pmcDisplayName,
        partnerSince,
        propertyCount: uniqueProperties.size,
        totalUnits: totalUnitsAll,
        monthCount: completedMonths.length,
        totalRent,
        totalBills,
        totalSignups,
        latestNar: latestMonth?.adoptionRate ?? 0,
      });

      // Property snapshot needs rentPaid for rent bucket slide
      const propSnapshotWithRent = latestRows
        .map((r) => ({
          propertyName: r.PROPERTY_NAME,
          units: r.PROPERTY_UNIT_COUNT,
          billsPaid: r.BILLS_PAID,
          rentPaid: r.RENT_PAID,
          adoptionRate: r.PROPERTY_UNIT_COUNT > 0 ? r.BILLS_PAID / r.PROPERTY_UNIT_COUNT : 0,
        }))
        .sort((a, b) => b.billsPaid - a.billsPaid);

      const rentBucketResult = renderHighRentAdoption({
        slideId: 3,
        pmcName: pmcDisplayName,
        propertySnapshot: propSnapshotWithRent,
      });

      const nlSlides = [
        renderCover(kpis),
        launchResult.html,
        rentBucketResult.html,
      ].filter(Boolean);

      const nlJs = [launchResult.js, rentBucketResult.js].filter(Boolean).join("\n");
      const nlCount = nlSlides.length;

      const reportMonth = monthOnly(latestCompletedMonth);
      const reportYear = yearOnly(latestCompletedMonth);
      const pdfFilename = pmc_name.replace(/[^a-zA-Z0-9]/g, "_") + "_launch.pdf";

      const html = applyTerminology(buildDeckHtml({
        slides: nlSlides.join("\n"),
        pmc_name,
        report_month: reportMonth,
        report_year: reportYear,
        slide_count: nlCount,
        pdf_filename: pdfFilename,
        extra_js: nlJs,
      }), terminology);

      return { html, empty: false };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EXPANSION DECK MODE
    // Canonical order matches EXPANSION_SLIDE_ORDER in app.py's own EXPANSION_SLIDE_ORDER constant
    // (Multiple Payments Update is retired and omitted).
    //
    // Cover and Exec Summary are NOT hardcoded — they only render if selected,
    // exactly the same as every other slide in this deck.
    //
    // Expansion Case Close is always force-appended last regardless of
    // selection, matching the Flask override at app.py line 1466.
    // ─────────────────────────────────────────────────────────────────────────
    if (deck_mode === "expansion") {
      const expSlideHtmls: string[] = [];
      const expSlideJsList: string[] = [];
      // Parallel to expSlideHtmls — the string slide key that actually rendered at each
      // position, in order, for speaker-notes generation below (mirrors Flask's
      // rendered_exp_sids: only slides that actually produced html, not everything attempted).
      const expRenderedKeys: string[] = [];
      // Slides the AE selected that a renderer decided NOT to show - insufficient real sample
      // to make a credible chart (Kevin's ask: surface this in the UI so an AE who notices
      // fewer slides than expected isn't left guessing whether something's broken). Every
      // Expansion slide funnels through pushSlide except cohort_overview's own raw push below,
      // which is tracked the same way at its own call site.
      const expSkippedSlides: { key: string; label: string }[] = [];

      const pushSlide = (sid: string, result: { html: string; js: string }) => {
        if (result.html) {
          expSlideHtmls.push(result.html);
          expRenderedKeys.push(sid);
          if (result.js) expSlideJsList.push(result.js);
        } else {
          expSkippedSlides.push({ key: sid, label: EXPANSION_SLIDE_TITLES[sid] ?? sid });
        }
      };

      // Canonical expansion slide order (string IDs matching SlidesPicker).
      // Reordered 2026-08-19 per Kevin: growth trend slides move up front (right after the
      // KPI slide), benchmarking/MetroSight move later, right before the closing slides.
      const EXPANSION_SLIDE_ORDER = [
        "cover",
        "exec_bottom_line",
        "residents_units",     // growth trend — residents paying across unit base
        "adoption_trend",      // growth trend — adoption by month
        "cohort_overview",     // growth trend — performance by rollout-month cohort
        "by_state",            // geographic breakdown
        "retention",           // resident behavior / loyalty bucket
        "high_rent",           // rent bucket
        "delinquency",         // DQ shielded
        // "peer_benchmarks" removed (Kevin's call - "we don't need to show that" on Expansion).
        // Its case in the switch below was removed too - unreachable dead code once it's gone
        // from this order, same slide id/case still exists and stays live for QBR mode.
        "expansion_metrosight",
        "expansion_gap",
        "testimonials",
        "expansion_case_close",
      ];

      // Growth trend slides are gated by showGrowthSlides (derived earlier, right after
      // is_smb) rather than a bare is_smb check — "auto" keeps the SMB-only default,
      // "include"/"exclude" override it. Also feeds the exec-tile sparkline suppression
      // above, which is why it's derived once, early, instead of redeclared here.
      const GROWTH_TREND_SLIDES = new Set(["residents_units", "adoption_trend", "cohort_overview"]);

      // Build active order: filter by expansion_slides if provided, then
      // force-append expansion_case_close at the end regardless of selection
      const slideFilter = expansion_slides && expansion_slides.length > 0
        ? new Set(expansion_slides)
        : null;

      const activeOrder = EXPANSION_SLIDE_ORDER.filter((sid) => {
        if (sid === "expansion_case_close") return false; // always appended below
        if (GROWTH_TREND_SLIDES.has(sid) && !showGrowthSlides) return false;  // growth trend gate
        if (sid === "testimonials" && testimonials.length === 0) return false;
        return slideFilter === null || slideFilter.has(sid);
      });
      activeOrder.push("expansion_case_close"); // always last

      // Shared computations
      const enrolledUnits = latestMonth?.units ?? 0;
      // Auto-populate total_portfolio_units from Salesforce accounts (ACCOUNT_TOTAL_COMPANY_UNITS)
      // if the caller didn't provide one — mirrors Flask's list_expansion_candidates SFDC lookup
      // (generator/data.py:343, PRODUCTION.SALES.DIM_SALES_ACCOUNTS). NOT
      // HUBSPOT_DEAL_TOTAL_COMPANY_UNITS — same noisy-field reasoning as the QBR Portfolio
      // Penetration fix above. Reuses expTotalPortfolioEarly (resolved above, before the peer-
      // matching ladder ran) rather than re-deriving it here — same value, already computed.
      let expTotalPortfolio = expTotalPortfolioEarly ?? total_portfolio_units;
      if (!expTotalPortfolio) {
        const [expPortfolioRow] = await subjectPortfolioTotalPromise;
        const acctUnits = expPortfolioRow?.TOTAL_COMPANY_UNITS ?? 0;
        expTotalPortfolio = acctUnits > 0 ? acctUnits : enrolledUnits;
      }
      const expNarPerc = segmentPercentiles.find((s) => s.metric === "NAR");

      const expRentBucketProps = latestRows
        .map((r) => ({
          propertyName: r.PROPERTY_NAME,
          units: r.PROPERTY_UNIT_COUNT,
          billsPaid: r.BILLS_PAID,
          rentPaid: r.RENT_PAID,
          adoptionRate: r.PROPERTY_UNIT_COUNT > 0 ? r.BILLS_PAID / r.PROPERTY_UNIT_COUNT : 0,
        }))
        .sort((a, b) => b.billsPaid - a.billsPaid);

      // Render each slide in order; slideNum is used as the sequential HTML id
      let slideNum = 0;

      // Imported slides (PDF upload / Google Slides picker), Expansion deck - start/end
      // anchors only (Kevin's ask: PDF upload across report types, not just QBR). Pushed via
      // the same pushSlide() every real slide uses, so they flow through the exact same
      // expSlideIdMap/expSlidesRenumbered renumbering pass below with no special-casing.
      // image_b64 rides as an opaque placeholder token until AFTER applyTerminology runs (see
      // the token-swap right before `html` is returned) - see renderImportedSlide's docstring
      // in slide-renderers.ts for why raw base64 here would be a real bug, not just unneeded
      // caution.
      const expImportPlaceholders = new Map<string, string>();
      const expStartImports: { token: string; sourceTitle: string; deckTitle: string }[] = [];
      const expEndImports: { token: string; sourceTitle: string; deckTitle: string }[] = [];
      (imported_slides ?? []).forEach((imp, idx) => {
        const token = `__FLEX_IMPORTED_SLIDE_X${idx}__`;
        expImportPlaceholders.set(token, `data:${imp.image_mime || "image/png"};base64,${imp.image_b64 || ""}`);
        const entry = { token, sourceTitle: imp.source_title ?? "", deckTitle: imp.deck_title ?? "" };
        if (imp.anchor === "start") expStartImports.push(entry); else expEndImports.push(entry);
      });
      for (const imp of expStartImports) {
        slideNum++;
        pushSlide(`imported:${imp.token}`, renderImportedSlide(slideNum, imp.token, imp.sourceTitle, imp.deckTitle));
      }

      for (const sid of activeOrder) {
        slideNum++;
        switch (sid) {
          case "cover": {
            const coverHtml = renderCover(kpis);
            if (coverHtml) {
              expSlideHtmls.push(coverHtml);
              expRenderedKeys.push(sid);
            }
            break;
          }

          case "exec_bottom_line":
            pushSlide(sid, execResult);
            break;

          case "by_state": {
            // Pre-check: skip if ≤2 distinct states (Flask: property_state.nunique() > 2)
            const distinctStates = new Set(latestRows.map(r => r.PROPERTY_STATE).filter(Boolean)).size;
            if (distinctStates > 2) {
              const r = renderStateBreakdown({
                latestRows,
                portfolioNar: latestMonth?.adoptionRate ?? 0,
                reportingMonth: latestCompletedMonth,
                slideId: slideNum,
                // Was missing here (Kevin's ask) - QBR's own call to this same function a few
                // hundred lines down already passes this; Expansion just never did.
                regionDetail,
              });
              pushSlide(sid, r);
            }
            break;
          }

          case "residents_units": {
            const r = renderResidentsUnitsCombo({ slideId: slideNum, monthlyTotals });
            pushSlide(sid, r);
            break;
          }

          case "adoption_trend": {
            const r = renderAdoptionTrend({ slideId: slideNum, monthly: monthlyTotals });
            pushSlide(sid, r);
            break;
          }

          case "cohort_overview": {
            const cohortHtml = renderCohortAnalysis({ cohorts, reportingMonth: latestCompletedMonth, cohortMonthly, slideId: slideNum, presentingMode: presenting_mode });
            if (cohortHtml) expSlideHtmls.push(cohortHtml);
            else {
              slideNum--; // no data — don't count this slot
              expSkippedSlides.push({ key: sid, label: EXPANSION_SLIDE_TITLES[sid] ?? sid });
            }
            break;
          }

          case "retention": {
            const r = renderRetention({
              slideId: slideNum,
              pmcName: pmcDisplayName,
              reportingMonth: latestCompletedMonth,
              // Was the bare MoM-based trueRepeatRate directly - unlike QBR's own retention
              // slide, which already prefers the cohort-derived value (stable lifetime metric,
              // matches Flask) over the MoM fallback (non-deterministic across months). Fixed
              // to use the same preference here, so Expansion's hero stat isn't a different,
              // less-reliable number than QBR's for the same PMC.
              trueRepeatRate: cohortTrueRepeatEarly ?? trueRepeatRate,
              avgRetention: retentionAvg,
              momRates: momRetentionRates,
              loyaltyBuckets,
              loyaltyTotal,
              loyaltyTitle,
              newInMonth: latestMonth?.newSignups ?? 0,
              avgPayment: latestMonth ? (latestMonth.rentPaid / Math.max(latestMonth.billsPaid, 1)) : 0,
              slideTitle: "Your residents use Flex their own way, but once they start, most keep coming back.",
            });
            pushSlide(sid, r);
            break;
          }

          case "high_rent": {
            if (evidence_type === "affordable") {
              const r = renderAffordableHousing({ slideId: slideNum, pmcName: pmcDisplayName, propertySnapshot: expRentBucketProps });
              pushSlide(sid, r);
            } else {
              // residentRents/alltimeResidentRents were missing here (Kevin's ask) - QBR's own
              // call to this same function passes both for the Last Month/All Time toggle;
              // Expansion never did. Both are now hoisted/shared, computed once near
              // latestCompletedMonth above.
              const r = renderHighRentAdoption({
                slideId: slideNum,
                pmcName: pmcDisplayName,
                propertySnapshot: expRentBucketProps,
                residentRents: residentRents.length >= 4 ? residentRents : undefined,
                alltimeResidentRents: alltimeResidentRents.length >= 4 ? alltimeResidentRents : undefined,
              });
              pushSlide(sid, r);
            }
            break;
          }

          case "delinquency": {
            // This slide is deliberately independent of the report's own Full/Quarter/YTD
            // period (matches Flask's render_delinquency, generator/slides.py:3309-3325) —
            // always a trailing-12-months-or-full-tenure headline. windowMonths used to be
            // lookback_months, which made this slide silently follow Quarter/YTD even though
            // its own label never did — the same "$ doesn't match its own label" bug class
            // Kevin caught on the exec tile, just introduced from the other direction. Dropped
            // lifetimeShielded entirely — renderDelinquency now computes its own windowed sum
            // from `months` + `windowMonths` internally, so it can't drift from its own label.
            const r = renderDelinquency({
              slideId: slideNum,
              months: dqMonths,
              windowMonths: Math.min(dqMonths.length, 12),
            });
            pushSlide(sid, r);
            break;
          }

          case "expansion_metrosight": {
            const r = renderExpansionMetrosight({
              slideId: slideNum,
              pmcName: pmcDisplayName,
              enrolledUnits,
              totalPortfolioUnits: expTotalPortfolio,
              avgRent: latestMonth ? (latestMonth.rentPaid / Math.max(latestMonth.billsPaid, 1)) : 0,
            });
            pushSlide(sid, r);
            break;
          }

          case "expansion_gap": {
            const r = renderExpansionGap({
              slideId: slideNum,
              pmcName: pmcDisplayName,
              totalPortfolioUnits: expTotalPortfolio,
              enrolledUnits,
              currentNar: latestMonth?.adoptionRate ?? 0,
              currentRent: latestMonth?.rentPaid ?? 0,
              currentResidents: latestMonth?.billsPaid ?? 0,
              monthlyHistory: monthlyTotals.map((m) => ({ units: m.units, rentPaid: m.rentPaid })),
              // Canonical value — every slide showing a peer-median NAR must read from this same
              // one (see the rule at its declaration above), or a PMC can see two different
              // "peer median" numbers in the same deck (this slide vs. Peer Benchmarks/Case Close).
              // p75Nar was missing this same fallback (Kevin's catch) — p50/p75 must move
              // together from the same resolved tier, same fix as every other read site in
              // this file. KNOWN REMAINING GAP: Flask re-derives this slide's whole peer cohort
              // at the full target portfolio size (app.py:1608-1668), not the current-enrolled
              // size these values are still scoped to here — that re-derivation isn't done yet.
              p50Nar: canonicalPeerNarP50 ?? expNarPerc?.p50,
              p75Nar: canonicalPeerNarP75 ?? expNarPerc?.p75,
            });
            pushSlide(sid, r);
            break;
          }

          case "testimonials": {
            const r = renderCustomerExperience({
              slideId: slideNum,
              testimonials: testimonials.map((t) => ({ name: t.name, property: t.propertyName, quote: t.quote, role: "Resident" })),
              trend: { csatByMonth: [], responseByMonth: [] },
            });
            pushSlide(sid, r);
            break;
          }

          case "expansion_case_close": {
            const r = renderExpansionCaseClose({
              slideId: slideNum,
              pmcName: pmcDisplayName,
              enrolledUnits,
              totalPortfolioUnits: expTotalPortfolio,
              currentNar: latestMonth?.adoptionRate ?? 0,
              currentRent: latestMonth?.rentPaid ?? 0,
              currentResidents: latestMonth?.billsPaid ?? 0,
              evidenceType: evidence_type,
              lifetimeDqShielded: lifetimeDqShielded ?? 0,
              hasNiroActivity: false,
              benchmarkNar: canonicalPeerNarP50 ?? segmentNarAvg ?? 0.085,
              trueRepeatRate,
              // Names the real window lifetimeDqShielded is summed over (Kevin's catch) -
              // see the comment at its use inside renderExpansionCaseClose.
              lookbackMonths: lookback_months,
            });
            pushSlide(sid, r);
            break;
          }
        }
      }

      for (const imp of expEndImports) {
        slideNum++;
        pushSlide(`imported:${imp.token}`, renderImportedSlide(slideNum, imp.token, imp.sourceTitle, imp.deckTitle));
      }

      // ─── Renumber slideIds sequentially by document position ─────────────────
      // `slideNum` increments on every case in the switch above, even when that case's
      // renderer self-gates and returns empty html (e.g. by_state with <=2 distinct states,
      // an empty peer-benchmark/rent-bucket dataset) — pushSlide only checks the earlier
      // "cohort_overview" case decrements on its own empty path, every other case doesn't, so a
      // skipped slot leaves every later slide's baked-in id="slide-N"/chartN/initSlideN not
      // matching its real position once the empty slide is filtered out. Same fix already
      // applied to the QBR path above (slideIdMap/slidesConcatenated) — reapply it here so
      // navigation (getElementById('slide-'+n)) and the mandatory last "expansion_case_close"
      // slide stay reachable regardless of which slides upstream happened to self-gate empty.
      const expSlideIdMap = new Map<string, string>();
      const expSlidesRenumbered = expSlideHtmls.map((slideHtml, idx) => {
        const newId = idx + 1;
        const m = slideHtml.match(/id="slide-(\d+)"/);
        if (!m) return slideHtml;
        const oldId = m[1];
        expSlideIdMap.set(oldId, String(newId));
        if (oldId === String(newId)) return slideHtml;
        return slideHtml
          .replace(new RegExp(`id="slide-${oldId}"`, "g"), `id="slide-${newId}"`)
          .replace(new RegExp(`#slide-${oldId}\\b`, "g"), `#slide-${newId}`)
          .replace(new RegExp(`id="chart${oldId}"`, "g"), `id="chart${newId}"`)
          .replace(new RegExp(`chart${oldId}(?=['"])`, "g"), `chart${newId}`)
          .replace(new RegExp(`initSlide${oldId}`, "g"), `initSlide${newId}`)
          .replace(new RegExp(`slide-${oldId}(?=['"\\.\\s])`, "g"), `slide-${newId}`);
      });

      let expJs = expSlideJsList.filter(Boolean).join("\n");
      for (const [oldId, newId] of expSlideIdMap) {
        if (oldId === newId) continue;
        expJs = expJs
          .replace(new RegExp(`initSlide${oldId}\\b`, "g"), `initSlide__TMP${newId}__`)
          .replace(new RegExp(`chart${oldId}(?=['"])`, "g"), `chart__TMP${newId}__`)
          .replace(new RegExp(`#slide-${oldId}\\b`, "g"), `#slide-__TMP${newId}__`)
          .replace(new RegExp(`"slide-${oldId}"`, "g"), `"slide-__TMP${newId}__"`);
      }
      expJs = expJs
        .replace(/initSlide__TMP(\d+)__/g, "initSlide$1")
        .replace(/chart__TMP(\d+)__/g, "chart$1")
        .replace(/#slide-__TMP(\d+)__/g, "#slide-$1")
        .replace(/"slide-__TMP(\d+)__"/g, '"slide-$1"');

      const reportMonth = monthOnly(latestCompletedMonth);
      const reportYear = yearOnly(latestCompletedMonth);
      const pdfFilename = displayName.replace(/[^a-zA-Z0-9]/g, "_") + "_expansion.pdf";

      let html = applyTerminology(buildDeckHtml({
        slides: expSlidesRenumbered.join("\n"),
        pmc_name: displayName,
        report_month: reportMonth,
        report_year: reportYear,
        slide_count: expSlidesRenumbered.length,
        pdf_filename: pdfFilename,
        extra_js: expJs,
      }), terminology);
      // Swap imported-slide placeholder tokens for their real data: URIs only now, after
      // terminology substitution has already run (see the imports setup above for why).
      for (const [token, dataUri] of expImportPlaceholders) {
        html = html.replaceAll(token, dataUri);
      }

      // --- Speaker notes ---
      let expNotesHtml: string | undefined;
      try {
        let expMonthsSinceLaunch = 0;
        if (earliestRollout && latestCompletedMonth) {
          const [ey, em] = earliestRollout.split("-").map(Number);
          const [ly, lm] = latestCompletedMonth.split("-").map(Number);
          expMonthsSinceLaunch = (ly - ey) * 12 + (lm - em) + 1;
        }
        const expNotesKpis: SpeakerNotesKpis = {
          pmcName: displayName,
          reportingMonth: latestCompletedMonth,
          monthsSinceLaunch: expMonthsSinceLaunch,
          currentNar: latestMonth?.adoptionRate ?? 0,
          currentBillsPaid: latestMonth?.billsPaid ?? 0,
          currentNewSignups: latestMonth?.newSignups ?? 0,
          targetNar: 0.15,
          totalUnits: expTotalPortfolio,
          currentResidents: latestMonth?.billsPaid ?? 0,
          hasNiro: false,
          dqWindowMonths: Math.min(dqMonths.length, 12),
        };
        const expNotesBenchmark: SpeakerNotesBenchmark = {
          benchmarkNar: canonicalPeerNarP50 ?? segmentNarAvg ?? 0.085,
          p50Nar: canonicalPeerNarP50 ?? expNarPerc?.p50 ?? null,
          // Same missing-fallback fix as the Portfolio Gap slide's p75Nar above.
          p75Nar: canonicalPeerNarP75 ?? expNarPerc?.p75 ?? null,
        };
        const expNotesMonthly: SpeakerNotesMonthlyRow[] = monthlyTotals.map((m) => ({
          month: m.month, billsPaid: m.billsPaid, units: m.units, rentPaid: m.rentPaid,
          newSignups: m.newSignups, propertyCount: m.propertyCount,
        }));
        // Property Reference tab (Kevin's catch) — same propertySnapshot every property-level
        // slide in this deck already reads from.
        const expNotesPropertySnapshot = propertySnapshot.map((p) => ({
          propertyName: p.propertyName, units: p.units, billsPaid: p.billsPaid,
          newSignups: p.newSignups, adoptionRate: p.adoptionRate, rentPaid: p.rentPaid,
          cumRent: p.cumRent,
        }));
        expNotesHtml = applyTerminology(
          buildExpansionSpeakerNotesHtml(expRenderedKeys, expNotesKpis, expNotesMonthly, expNotesBenchmark, expNotesPropertySnapshot),
          terminology
        );
      } catch (e) {
        console.warn(`[PMC Report] expansion speaker notes generation failed for ${pmc_name}: ${e instanceof Error ? e.message : String(e)}`);
      }

      return { html, empty: false, notes_html: expNotesHtml, skipped_slides: expSkippedSlides };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // QBR DECK MODE (default)
    // ─────────────────────────────────────────────────────────────────────────
    // Correct QBR order:
    // 1. Cover (always first)
    // 2. Exec Summary (always second)
    // 3. Since Inception (Bills & Rent Since Inception)
    // 4. Residents, Units & Rent
    // 5. Adoption Trend
    // 6. Portfolio Projection
    // 7. Cohort Overview
    // 8. By State (Geographic Breakdown)
    // 9. Rethinking Rent (MetroSight)
    // 10. QBR Close (always last real slide)
    // 11. Full Property Table (appendix after QBR Close)

    // Build yearlyData from the unbounded yearly query
    const yearlyData: YearlyData[] = yearlyRentBillsRows.map(r => ({
      year: r.YEAR,
      totalRent: r.TOTAL_RENT ?? 0,
      billsPaid: r.BILLS_PAID ?? 0,
      monthsActive: r.MONTHS_ACTIVE ?? 0,
      ytdRent: r.YTD_RENT ?? 0,
      ytdBills: r.YTD_BILLS ?? 0,
      ytdMonthsActive: r.YTD_MONTHS_ACTIVE ?? 0,
    }));

    const sinceInceptionResult = renderSinceInception({
      slideId: 3,
      pmcName: pmcDisplayName,
      reportingMonth: latestCompletedMonth,
      yearlyData,
      monthlyTotals,
      partnerSince,
    });

    const residentsUnitsResult = renderResidentsUnitsCombo({
      slideId: 4,
      monthlyTotals,
    });

    // Adoption Trend = slide 5
    // Compute months since launch for peer benchmark alignment
    let monthsSinceLaunch = 0;
    if (earliestRollout && latestCompletedMonth) {
      const [ey, em] = earliestRollout.split("-").map(Number);
      const [ly, lm] = latestCompletedMonth.split("-").map(Number);
      monthsSinceLaunch = (ly - ey) * 12 + (lm - em) + 1;
    }
    const adoptionTrendKpis = {
      pmc_name,
      months_since_launch: monthsSinceLaunch,
      // Real tenure-cohort benchmark (locked-peers cohort, months-since-launch) - see
      // stageBenchmarksMap above. Replaced the SEGMENT_NAR_AVG-based construction (fabricated
      // data source, confirmed producing a wrong number in the wrong direction - Kevin's catch).
      stage_benchmarks: stageBenchmarksMap,
      // Use real rolling peer median if available; otherwise hide the peer median line
      // (a flat line from SEGMENT_NAR_AVG is misleading — better to show no peer line
      // than a constant that doesn't actually represent calendar-month peer movement)
      rolling_peer_median: Object.keys(rollingPeerMedianMap).length > 0
        ? rollingPeerMedianMap
        : {},
      // Same criteria the Peer Benchmarks slide shows — both read from the same lockedPeers
      // cohort, so their descriptions must agree instead of one being a generic hardcoded string.
      locked_peers_criteria: lockedPeersCriteria,
    };
    const adoptionTrendResult = renderAdoptionTrend({ slideId: 5, monthly: monthlyTotals, kpis: adoptionTrendKpis });
    const adoptionTrendHtml = adoptionTrendResult.html;

    const narPerc = segmentPercentiles.find((s) => s.metric === "NAR");
    const projResult = renderPortfolioProjection({
      currentResidents: latestMonth?.billsPaid ?? 0,
      currentRent: latestMonth?.rentPaid ?? 0,
      currentNar: latestMonth?.adoptionRate ?? 0,
      totalUnits: totalUnitsAll,
      monthlyTotals,
      pmcName: pmcDisplayName,
      slideId: 6,
      // P25/P75 move with P50 from the same resolved tier - same fix as the Peer Benchmarks
      // slide above (Kevin's catch: P50 alone used to get the canonical override here too).
      peerPercentiles: narPerc ? {
        p25: canonicalPeerNarP25 ?? narPerc.p25,
        p50: canonicalPeerNarP50 ?? narPerc.p50,
        p75: canonicalPeerNarP75 ?? narPerc.p75,
        p90: narPerc.p90,
        p99: narPerc.p99,
      } : undefined,
    });

    // Cohort Overview = slide 7
    const cohortHtml = renderCohortAnalysis({ cohorts, reportingMonth: latestCompletedMonth, cohortMonthly, slideId: 7, presentingMode: presenting_mode });

    // Pre-check: skip state breakdown if ≤2 distinct states
    const qbrDistinctStates = new Set(latestRows.map(r => r.PROPERTY_STATE).filter(Boolean)).size;
    const stateResult = qbrDistinctStates > 2
      ? renderStateBreakdown({
          latestRows,
          portfolioNar: latestMonth?.adoptionRate ?? 0,
          reportingMonth: latestCompletedMonth,
          slideId: 8,
          regionDetail,
        })
      : { html: "", js: "" };

    // (MetroSight and QBR Close rendered below with dynamic slide IDs)

    // --- Peer Benchmarks slide ---
    // Override metrics' P50 with locked-peer-derived values for consistency with Flask
    // Flask uses the same geo/size/rent-matched peer pool for all three benchmark metrics.
    // The REPEAT_RATE row's own dot is the subject's true repeat rate (subjectRepeatValue,
    // computed above — matching Flask's kpis.get("true_repeat_rate") or
    // kpis.get("avg_retention") fallback, slides.py:328).
    // Display order: Engagement, Time to First Sign-Up, Adoption Rate, Resident Retention,
    // Portfolio Penetration. segmentPercentiles' own order isn't reliable for this — its rows
    // come from a UNION ALL with no ORDER BY, which Snowflake doesn't guarantee a row order for.
    const BENCHMARK_DISPLAY_ORDER = ["NEW_CONNECTIONS", "SIGNUP_TIMING", "NAR", "REPEAT_RATE", "PENETRATION"];
    const benchmarkMetrics = segmentPercentiles
      .map((m) => {
        if (m.metric === "NAR" && canonicalPeerNarP50 != null) {
          // P25/P75 move together with P50 - all three (or none) come from whichever tier
          // resolved above, never a mix of this tier's P50 with a different tier's spread
          // (Kevin's catch: P50 alone used to get overridden here, leaving P25/P75 pointing at
          // the old snapshot distribution - an impossible P25 > P50 ordering on screen).
          return {
            ...m,
            p50: canonicalPeerNarP50,
            p25: canonicalPeerNarP25 ?? m.p25,
            p75: canonicalPeerNarP75 ?? m.p75,
          };
        }
        if (m.metric === "REPEAT_RATE" && subjectRepeatValue != null) {
          return { ...m, pmcValue: subjectRepeatValue };
        }
        return m;
      })
      .sort((a, b) => BENCHMARK_DISPLAY_ORDER.indexOf(a.metric) - BENCHMARK_DISPLAY_ORDER.indexOf(b.metric));
    const peerBenchResult = renderPeerBenchmarks({
      slideId: 9,
      pmcName: pmcDisplayName,
      segment: lockedPeersCriteria,
      metrics: benchmarkMetrics,
      // Flask's subtitle is "Benchmarked against N comparable PMCs (<criteria>)" — the count
      // prefix was missing here, so the renderer's existing peerCount-gated subtitle logic
      // (slide-renderers.ts, subtitlePeers) fell through to the bare criteria string instead.
      peerCount: lockedPeers.length,
    });

    // --- Flex Is For Everyone (high rent adoption) slide ---
    // residentRents/alltimeResidentRents now computed once, hoisted up near latestCompletedMonth
    // (shared with Expansion's own "high_rent" case) - see the comment there.
    const flexForEveryoneResult = renderHighRentAdoption({
      slideId: 12,
      pmcName: pmcDisplayName,
      propertySnapshot: propertySnapshot.map((p) => ({
        propertyName: p.propertyName,
        units: p.units,
        billsPaid: p.billsPaid,
        rentPaid: p.rentPaid ?? 0,
        adoptionRate: p.adoptionRate,
      })),
      residentRents: residentRents.length >= 4 ? residentRents : undefined,
      alltimeResidentRents: alltimeResidentRents.length >= 4 ? alltimeResidentRents : undefined,
    });

    // --- Delinquency Protection slide --- (windowed internally now, see the Expansion call
    // site's comment above for why lifetimeShielded is no longer passed in)
    const delinquencyResult = renderDelinquency({
      slideId: 13,
      months: dqMonths,
      windowMonths: Math.min(dqMonths.length, 12),
    });

    // --- Resident Retention slide ---
    // Use cohort-derived true repeat rate (lifetime metric, stable across runs).
    // The MoM fallback (trueRepeatRate) measures a different thing and is non-deterministic
    // across months, so only use it if the cohort query genuinely has no data.
    // Reuses cohortTrueRepeatEarly (already gated on RELIABLE_REPEAT_RATE_MIN above) rather
    // than re-reading TRUE_REPEAT_RATE raw - same value QBR's exec tile and Peer Benchmarks
    // already use, so this slide's hero stat can't drift from what the rest of the deck shows.
    const finalTrueRepeatRate = cohortTrueRepeatEarly ?? trueRepeatRate;

    // Average rent per resident per month (for KPI card) — from monthlyTotals (real,
    // PROPERTY_BP_MONTH_STATS-derived), not the fabricated PARTNER_REPORTING_CORE_METRICS table.
    const avgPaymentPerResident = (() => {
      const totalRent = monthlyTotals.reduce((s, m) => s + m.rentPaid, 0);
      const totalBills = monthlyTotals.reduce((s, m) => s + m.billsPaid, 0);
      return totalBills > 0 ? totalRent / totalBills : 0;
    })();

    // New signups in latest month — from monthlyTotals, same reasoning as above.
    const newInLatestMonth = latestMonth?.newSignups ?? 0;

    const retentionResult = renderRetention({
      slideId: 14,
      pmcName: pmcDisplayName,
      reportingMonth: latestCompletedMonth,
      trueRepeatRate: finalTrueRepeatRate,
      avgRetention: retentionAvg,
      momRates: momRetentionRates,
      loyaltyBuckets,
      loyaltyTotal,
      loyaltyTitle,
      newInMonth: newInLatestMonth,
      avgPayment: avgPaymentPerResident,
    });

    // --- Dynamic slide ID allocator ---
    // Every slide above this point uses a fixed literal slideId (2 through 14 — exec, since
    // inception, residents/units, adoption trend, projection, cohort, state, peer benchmarks,
    // flex-for-everyone, delinquency, retention). The slides below (testimonials, celebrate,
    // opportunities, metrosight, QBR close) previously computed their IDs via ad-hoc arithmetic
    // ("9 + newDataSlideCount + testimonialSlideRendered", etc.) trying to guess a free number —
    // that arithmetic could (and did) land back on 9, 12, 13, or 14, colliding with a slide
    // already using that literal. A collision on the same slideId means BOTH slides' JS ends up
    // sharing one entry in the renumbering map (get-pmc-monthly-report.ts's slidesOrdered
    // renumbering pass below), so one of them gets its canvas-lookup renumbered to the WRONG
    // final position — exactly the "Failed to create chart: can't acquire context from the
    // given item" / getElementById-returns-null bug. A simple monotonic counter, safely clear
    // of every literal above, makes a collision structurally impossible regardless of which
    // combination of these slides ends up empty vs. rendered.
    let _nextDynamicSlideId = 100;
    const allocSlideId = () => _nextDynamicSlideId++;

    // --- Imported slides (PDF upload, QBR only for now) ---
    // Mirrors Flask's app.py imported-slides handling: each import rides as an opaque
    // placeholder token until AFTER applyTerminology runs (see the token-swap right before
    // `html` is returned below), then gets swapped for its real data: URI. Only "start"/"end"
    // anchors are supported this round - see renderImportedSlide's docstring for why a
    // specific-slide anchor is out of scope for now.
    const importedSlidesRaw = imported_slides ?? [];
    const importPlaceholders = new Map<string, string>(); // token -> real data: URI
    const startImportsHtml: string[] = [];
    const endImportsHtml: string[] = [];
    importedSlidesRaw.forEach((imp, idx) => {
      const token = `__FLEX_IMPORTED_SLIDE_${idx}__`;
      importPlaceholders.set(token, `data:${imp.image_mime || "image/png"};base64,${imp.image_b64 || ""}`);
      const { html } = renderImportedSlide(allocSlideId(), token, imp.source_title ?? "", imp.deck_title ?? "");
      // Anything other than a literal "start" (including any stray "after:X" from a client
      // that hasn't been updated) falls through to "end" - same default Flask's own anchor
      // parsing uses for an unrecognized value, rather than silently dropping the slide.
      if (imp.anchor === "start") startImportsHtml.push(html); else endImportsHtml.push(html);
    });

    // Testimonials slide (after retention, before celebrate/opportunities)
    // Resolve the deferred Zendesk promise now
    let topTestimonials: Testimonial[];
    if (testimonials.length > 0) {
      topTestimonials = testimonials.map((t) => ({ name: t.name, property: t.propertyName, quote: t.quote }));
    } else {
      const zendeskRows = await (zendeskPromise ?? Promise.resolve([]));
      const POSITIVE_KEYWORDS = ["love", "amazing", "great", "excellent", "helpful", "fantastic", "wonderful", "easy", "convenient", "lifesaver", "recommend", "thank", "best", "perfect", "awesome"];
      const scored = zendeskRows.map((r) => {
        const lower = r.COMMENT.toLowerCase();
        const score = POSITIVE_KEYWORDS.reduce((s, kw) => s + (lower.includes(kw) ? 1 : 0), 0);
        return { ...r, score };
      });
      scored.sort((a, b) => b.score - a.score);
      topTestimonials = scored.slice(0, 4).map((r) => ({ name: r.RESIDENT_NAME ?? "", property: r.PROPERTY_NAME ?? "", quote: r.COMMENT }));
    }
    const testimonialSlideId = allocSlideId();
    const [csatTrendRows, responseTrendRows] = await residentTrendPromise;
    const residentTrend: ResidentTrend = {
      csatByMonth: csatTrendRows.map((r) => ({ month: r.MONTH, nTotal: r.N_TOTAL, nGood: r.N_GOOD })),
      responseByMonth: responseTrendRows.map((r) => ({ month: r.MONTH, nTickets: r.N_TICKETS, avgReplyMin: r.AVG_REPLY_MIN })),
    };
    const testimonialResult = renderCustomerExperience({
      slideId: testimonialSlideId,
      testimonials: topTestimonials,
      trend: residentTrend,
    });
    // Count new properties onboarded in trailing 3 months for QBR close
    let newPropsThisQ = 0;
    if (latestCompletedMonth) {
      const reportDate = new Date(latestCompletedMonth);
      const qStart = new Date(reportDate.getFullYear(), reportDate.getMonth() - 2, 1);
      const qStartStr = qStart.toISOString().slice(0, 10);
      const newPropNames = new Set<string>();
      for (const row of inNetwork) {
        if (row.ROLLOUT_MONTH && row.ROLLOUT_MONTH >= qStartStr && row.ROLLOUT_MONTH <= latestCompletedMonth) {
          newPropNames.add(row.PROPERTY_NAME);
        }
      }
      newPropsThisQ = newPropNames.size;
    }

    // (QBR Close rendered below with dynamic slide ID)

    // --- Property Deep Dive slides ---
    // Smart adoption target: if user left default (15), use that. Otherwise use their override.
    const targetNar = adoption_target / 100; // convert % to decimal

    // Network-wide P50 engagement as fallback when per-property peer matching didn't resolve
    const networkEngValues = networkPoolProps
      .filter((p) => p.pmcName !== pmc_name && p.t12EngPer100 > 0)
      .map((p) => p.t12EngPer100)
      .sort((a, b) => a - b);
    const peerMedianEngFallback = networkEngValues.length > 0
      ? networkEngValues[Math.floor(networkEngValues.length / 2)]
      : undefined;

    // --- New Rollouts — below age-since-rollout benchmark (Flask: generator/slides.py:5226-5318) ---
    // Only meaningful once the portfolio itself has enough history to distinguish "new" from
    // "everything is new" — Flask's own gate (_msfirst >= 6).
    // benchNar reads stageBenchmarksMap - the SAME real, geo/size/rent-matched tenure-cohort
    // query the Adoption Trend chart uses (built earlier in this function), matching Flask's
    // own render_adoption_opportunities, which reads its "Expected" column from this exact
    // same kpis["stage_benchmarks"] source (generator/slides.py:5277-5279). Previously read a
    // dedicated untiered network-wide query that returned exactly 0.0% at every age bucket -
    // confirmed broken, not a thin-sample artifact (Kevin's catch).
    // expectedEngPer100 falls back to peerMedianEngFallback (already computed above) rather
    // than reviving that same broken query for engagement - a real, if coarser, network-wide
    // P50 beats a degenerate one, and the "below benchmark" filter tolerates a missing/zero
    // engagement expectation without excluding the row (only benchNar being exactly 0 broke
    // that filter).
    const newRolloutCandidates: NewRolloutCandidate[] = [];
    if (_msl >= 6) {
      const newCutoffDate = latestCompletedMonth ? new Date(latestCompletedMonth) : new Date();
      newCutoffDate.setMonth(newCutoffDate.getMonth() - 6);
      const newCutoffStr = newCutoffDate.toISOString().slice(0, 10);
      for (const p of propertySnapshot) {
        if (!p.rolloutMonth || p.rolloutMonth <= newCutoffStr) continue;
        const age = Math.max(1, p.monthsLive);
        const bench = stageBenchmarksMap[age];
        newRolloutCandidates.push({
          propertyName: p.propertyName,
          propertyState: p.propertyState,
          units: p.units,
          ageMonths: age,
          adoptionRate: p.adoptionRate,
          benchNar: bench?.p50 ?? 0,
          observedEngPer100: p.t12EngPer100 ?? 0,
          expectedEngPer100: peerMedianEngFallback ?? 0,
          hasMarketingIntegration: p.hasMarketingIntegration,
          isMarketingOptIn: p.isMarketingOptIn,
        });
      }
    }

    // --- Disabled properties (Flask: pull_disabled_properties, generator/data.py:4247) ---
    const disabledProperties: DisabledPropertyRow[] = disabledPropertyRows
      .filter((r) => r.DEACTIVATION_REASON !== "PARTNER_INITIATED_LOSS_OF_API_ACCESS")
      .map((r) => ({
        propertyName: r.PROPERTY_NAME,
        units: r.PROPERTY_UNIT_COUNT,
        deactivationLabel: DEACTIVATION_LABELS[r.DEACTIVATION_REASON] ?? r.DEACTIVATION_REASON,
        lastSeenMonth: r.LAST_SEEN_MONTH
          ? new Date(r.LAST_SEEN_MONTH + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
          : null,
      }));

    const celebrateResult = renderPropertiesWorthCelebrating({
      slideId: allocSlideId(),
      propertySnapshot,
      targetNar,
      peerMedianNar: canonicalPeerNarP50 ?? undefined,
      peerMedianEngagement: peerMedianEngFallback,
      showAdoptionPortfolioAvg: show_adoption_portfolio_avg,
      showAdoptionPeerMedian: show_adoption_peer_median,
      showEngagementObserved: show_engagement_observed,
      showEngagementPortfolioAvg: show_engagement_portfolio_avg,
      showEngagementPeerMedian: show_engagement_peer_median,
    });

    const opportunitiesResult = renderAdoptionOpportunities({
      slideId: allocSlideId(),
      propertySnapshot,
      targetNar,
      peerMedianNar: canonicalPeerNarP50 ?? undefined,
      peerMedianEngagement: peerMedianEngFallback,
      newRolloutCandidates,
      disabledProperties,
      presentingMode: presenting_mode,
      hideD2c: hide_d2c,
      showAdoptionPortfolioAvg: show_adoption_portfolio_avg,
      showAdoptionPeerMedian: show_adoption_peer_median,
      showEngagementObserved: show_engagement_observed,
      showEngagementPortfolioAvg: show_engagement_portfolio_avg,
      showEngagementPeerMedian: show_engagement_peer_median,
    });

    const metrosightSlideId = allocSlideId();
    const qbrCloseSlideId = allocSlideId();

    // Re-render metrosight and QBR close with corrected slide IDs
    const metrosightFinal = renderMetrosightEvidence({
      slideId: metrosightSlideId,
      pmcName: pmcDisplayName,
      totalUnits: totalUnitsAll,
      avgRent: (latestMonth?.billsPaid ?? 0) > 0
        ? (latestMonth?.rentPaid ?? 0) / latestMonth!.billsPaid
        : 0,
    });

    const qbrFinal = renderQbrClose({
      slideId: qbrCloseSlideId,
      pmcName: pmcDisplayName,
      currentNar: latestMonth?.adoptionRate ?? 0,
      currentRent: latestMonth?.rentPaid ?? 0,
      lifetimeRent,
      currentResidents: latestMonth?.billsPaid ?? 0,
      propertyCount: uniqueProperties.size,
      partnerSince,
      benchmarkNar: canonicalPeerNarP50 ?? segmentNarAvg ?? 0.085,
      benchmarkP75: narPerc?.p75 ?? null,
      trueRepeatRate: finalTrueRepeatRate,
      newPropertiesCount: newPropsThisQ,
      monthlyTotals,
      // Anniversary-milestone check — fires for 1/2/3/5yr milestones within a 3-month window
      // (the milestone month itself, or up to 2 months after), anchored to the true partner-
      // since date (not raw rollout, which can inherit a prior owner's history), then
      // suppressed unless this PMC is in the top 50% most-tenured partners network-wide —
      // matches Flask's app.py:1225-1244 exactly.
      milestoneYears: (() => {
        if (!partnerSince || !latestCompletedMonth) return null;
        const start = new Date(partnerSince + "T00:00:00Z");
        const rpt = new Date(latestCompletedMonth + "T00:00:00Z");
        for (const yrs of [1, 2, 3, 5]) {
          const msDate = new Date(start.getFullYear() + yrs, start.getMonth(), 1);
          const deltaMo = (rpt.getFullYear() * 12 + rpt.getMonth()) - (msDate.getFullYear() * 12 + msDate.getMonth());
          if (deltaMo >= 0 && deltaMo <= 2) {
            if (tenurePercentileFromTop != null && tenurePercentileFromTop > 50) return null;
            return yrs;
          }
        }
        return null;
      })(),
      lifetimeDqShielded,
      // % of units with D2C marketing enabled (Flask: platinum_pct, generator/data.py:2219-2226
      // — plat_units/total_units where HAS_MARKETING_INTEGRATION) — this was never threaded
      // through, so "Drive co-marketing" (gated on optInPct > 70%) never showed on this port
      // regardless of the PMC's real opt-in rate.
      optInPct: (() => {
        const totalUnits = latestRows.reduce((s, r) => s + r.PROPERTY_UNIT_COUNT, 0);
        if (totalUnits === 0) return 0;
        const optInUnits = latestRows.reduce((s, r) => s + (r.HAS_MARKETING_INTEGRATION ? r.PROPERTY_UNIT_COUNT : 0), 0);
        return optInUnits / totalUnits;
      })(),
      showAdoptionPeerMedian: show_adoption_peer_median,
    });

    // Full Property Table = appendix after QBR Close
    const propTableSlideId = allocSlideId();
    const propertyTableHtml = renderFullPropertyTable(propertySnapshot, propTableSlideId);

    // Flask SLIDE_ORDER: [3, 54, 6, 21, 14, 49, 12, 39, 15, 26, 50, 44, 23, 58, 34, 45, 53, 57, 59]
    // Mapped to TS slides (skipping IDs we don't implement: 3, 49, 23, 45, 53, 59):
    //   Cover(1) → Exec(13) → Since Inception(56) → Residents/Units(54)
    //   → Adoption Trend(6) → Projection(21) → Cohort(14) → Geographic(12)
    //   → Flex For Everyone(39) → Retention(15) → Delinquency(26) → MetroSight(50)
    //   → Peer Benchmarks(44) → Celebrate(58) → Opportunities(34) → Testimonials(57) → QBR Close(25) → Appendix
    const slidesOrdered = [
      ...startImportsHtml,                      // Imported (PDF upload) - anchor "start"
      renderCover(kpis),                        // Flask slide 1  - Cover
      execResult.html,                          // Flask slide 13 - Executive Summary
      sinceInceptionResult.html,                // Flask slide 56 - Bills & Rent Since Inception
      residentsUnitsResult.html,                // Flask slide 54 - Residents + Units + Rent
      adoptionTrendHtml,                        // Flask slide 6  - Adoption Trend
      projResult.html,                          // Flask slide 21 - Portfolio Projection
      cohortHtml,                               // Flask slide 14 - Cohort Analysis
      stateResult.html,                         // Flask slide 12 - Geographic Breakdown
      flexForEveryoneResult.html,               // Flask slide 39 - Flex Is For Everyone
      retentionResult.html,                     // Flask slide 15 - Resident Retention
      delinquencyResult.html,                   // Flask slide 26 - Delinquency Protection
      metrosightFinal.html,                     // Flask slide 50 - MetroSight Evidence
      peerBenchResult.html,                     // Flask slide 44 - Multi-metric Peer Benchmarks
      celebrateResult.html,                     // Flask slide 58 - Properties Worth Celebrating
      opportunitiesResult.html,                 // Flask slide 34 - Adoption Opportunities
      testimonialResult.html,                   // Flask slide 57 - Customer Experience / Testimonials
      qbrFinal.html,                            // Flask slide 25 - QBR Close (always last real slide)
      propertyTableHtml,                        // Appendix - Full Property Table
      ...endImportsHtml,                        // Imported (PDF upload) - anchor "end" (default)
    ].filter(Boolean) as string[];

    // ─── Renumber slideIds sequentially by document position ─────────────────
    // Each renderer assigns an arbitrary slideId used for id="slide-N", chart canvases
    // ("chartN"), and JS init functions ("initSlideN"). After .filter(Boolean) removes
    // empty slides, document positions shift. Re-stamp each slide's internal IDs so
    // they match sequential positions (1-based).
    const slideIdMap = new Map<string, string>(); // oldId → newId
    const slidesConcatenated = slidesOrdered.map((html, idx) => {
      const newId = idx + 1;
      const m = html.match(/id="slide-(\d+)"/);
      if (!m) return html;
      const oldId = m[1];
      slideIdMap.set(oldId, String(newId));
      if (oldId === String(newId)) return html;
      return html
        .replace(new RegExp(`id="slide-${oldId}"`, "g"), `id="slide-${newId}"`)
        .replace(new RegExp(`#slide-${oldId}\\b`, "g"), `#slide-${newId}`)
        .replace(new RegExp(`id="chart${oldId}"`, "g"), `id="chart${newId}"`)
        .replace(new RegExp(`chart${oldId}(?=['"])`, "g"), `chart${newId}`)
        .replace(new RegExp(`initSlide${oldId}`, "g"), `initSlide${newId}`)
        .replace(new RegExp(`slide-${oldId}(?=['"\\.\\s])`, "g"), `slide-${newId}`);
    }).join("\n");

    // Collect extra JS from slide renderers and apply same renumbering
    let extraJs = [
      execResult.js, sinceInceptionResult.js, residentsUnitsResult.js,
      adoptionTrendResult.js, projResult.js, stateResult.js,
      peerBenchResult.js,
      flexForEveryoneResult.js,
      delinquencyResult.js, retentionResult.js,
      testimonialResult.js,
      qbrFinal.js,
    ].filter(Boolean).join("\n");
    // Apply the same slideId renumbering to JS init functions
    // Use two-pass approach to avoid double-renames (e.g., 14→9 then 9→12)
    // Pass 1: rename to temporary placeholders
    for (const [oldId, newId] of slideIdMap) {
      if (oldId === newId) continue;
      extraJs = extraJs
        .replace(new RegExp(`initSlide${oldId}\\b`, "g"), `initSlide__TMP${newId}__`)
        .replace(new RegExp(`chart${oldId}(?=['"])`, "g"), `chart__TMP${newId}__`)
        .replace(new RegExp(`#slide-${oldId}\\b`, "g"), `#slide-__TMP${newId}__`)
        .replace(new RegExp(`"slide-${oldId}"`, "g"), `"slide-__TMP${newId}__"`);
    }
    // Pass 2: strip temporary markers
    extraJs = extraJs
      .replace(/initSlide__TMP(\d+)__/g, "initSlide$1")
      .replace(/chart__TMP(\d+)__/g, "chart$1")
      .replace(/#slide-__TMP(\d+)__/g, "#slide-$1")
      .replace(/"slide-__TMP(\d+)__"/g, '"slide-$1"');

    // --- Build full deck HTML ---
    const reportMonth = monthOnly(latestCompletedMonth);
    const reportYear = yearOnly(latestCompletedMonth);
    const pdfFilename = displayName.replace(/[^a-zA-Z0-9]/g, "_") + "_deck.pdf";

    let html = applyTerminology(buildDeckHtml({
      slides: slidesConcatenated,
      pmc_name: displayName,
      report_month: reportMonth,
      report_year: reportYear,
      slide_count: slidesOrdered.length, // actual number of rendered slides
      pdf_filename: pdfFilename,
      extra_js: extraJs,
    }), terminology);
    // Swap imported-slide placeholder tokens for their real data: URIs only now, after
    // terminology substitution has already run - see the imported-slides setup above for
    // why this order matters (mirrors Flask's app.py).
    for (const [token, dataUri] of importPlaceholders) {
      html = html.replaceAll(token, dataUri);
    }

    // --- Speaker notes (downloaded client-side as a data URI, same pattern as the deck) ---
    let notesHtml: string | undefined;
    try {
      // Same target-NAR cascade renderPortfolioProjection uses above (next real peer tier up
      // from current NAR: P50 -> P75 -> P90 -> P99+2pp), so the notes explain the same number
      // the projection slide actually shows.
      // p50/p75 from the same resolved tier (same fix as renderPortfolioProjection above) -
      // p90/p99 stay on narPerc's raw snapshot since no tier here resolves those two.
      const p25 = canonicalPeerNarP25 ?? narPerc?.p25, p50 = canonicalPeerNarP50 ?? narPerc?.p50, p75 = canonicalPeerNarP75 ?? narPerc?.p75, p90 = narPerc?.p90, p99 = narPerc?.p99;
      const currentNarForTarget = latestMonth?.adoptionRate ?? 0;
      let targetNarForNotes: number;
      if (p99 != null && currentNarForTarget >= (p90 ?? Infinity)) targetNarForNotes = p99 + 0.02;
      else if (p90 != null && currentNarForTarget >= (p75 ?? Infinity)) targetNarForNotes = p90;
      else if (p75 != null && currentNarForTarget >= (p50 ?? Infinity)) targetNarForNotes = p75;
      else if (p50 != null) targetNarForNotes = p50;
      else targetNarForNotes = 0.20;
      targetNarForNotes = Math.round(targetNarForNotes * 100) / 100;

      const notesKpis: SpeakerNotesKpis = {
        pmcName: displayName,
        reportingMonth: latestCompletedMonth,
        monthsSinceLaunch,
        currentNar: currentNarForTarget,
        currentBillsPaid: latestMonth?.billsPaid ?? 0,
        currentNewSignups: latestMonth?.newSignups ?? 0,
        targetNar: targetNarForNotes,
        totalUnits: totalUnitsAll,
        currentResidents: latestMonth?.billsPaid ?? 0,
        hasNiro: false,
        dqWindowMonths: Math.min(dqMonths.length, 12),
      };
      const notesBenchmark: SpeakerNotesBenchmark = {
        benchmarkNar: canonicalPeerNarP50 ?? segmentNarAvg ?? 0.085,
        peerCount: undefined,
        p50Nar: p50 ?? null,
        p75Nar: p75 ?? null,
        p90Nar: p90 ?? null,
        p99Nar: p99 ?? null,
      };
      const notesMonthly: SpeakerNotesMonthlyRow[] = monthlyTotals.map((m) => ({
        month: m.month, billsPaid: m.billsPaid, units: m.units, rentPaid: m.rentPaid,
        newSignups: m.newSignups, propertyCount: m.propertyCount,
      }));
      // Same Flask slide-ID sequence the deck itself was just assembled from (see the
      // `slidesOrdered` array above) — notes are keyed by the real Flask slide ID, not by
      // this deck's own renumbered document position.
      const qbrSlideIdSequence = [1, 13, 56, 54, 6, 21, 14, 12, 39, 15, 26, 50, 44, 58, 34, 57, 47];
      // Property Reference tab (Kevin's catch) — same propertySnapshot every property-level
      // slide in this deck already reads from. preMeetingFlags stays unwired (a separate,
      // pre-existing gap, not touched here).
      const qbrNotesPropertySnapshot = propertySnapshot.map((p) => ({
        propertyName: p.propertyName, units: p.units, billsPaid: p.billsPaid,
        newSignups: p.newSignups, adoptionRate: p.adoptionRate, rentPaid: p.rentPaid,
        cumRent: p.cumRent,
      }));
      notesHtml = applyTerminology(
        buildSpeakerNotesHtml(qbrSlideIdSequence, notesKpis, notesMonthly, notesBenchmark, undefined, qbrNotesPropertySnapshot),
        terminology
      );
    } catch (e) {
      console.warn(`[PMC Report] speaker notes generation failed for ${pmc_name}: ${e instanceof Error ? e.message : String(e)}`);
    }

    return { html, empty: false, notes_html: notesHtml };
  },
});
