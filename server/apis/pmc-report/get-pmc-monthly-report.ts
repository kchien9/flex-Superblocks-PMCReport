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
} from "./slide-renderers.js";
import type { BenchmarkMetric, ResidentTrend, Testimonial, TrendFlag, YearlyData, NewRolloutCandidate, DisabledPropertyRow } from "./slide-renderers.js";
import { buildSpeakerNotesHtml, buildExpansionSpeakerNotesHtml } from "./speaker-notes.js";
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
type NetworkPoolRow = { PMC_NAME: string; PROPERTY_NAME: string; PROPERTY_STATE: string | null; PROPERTY_UNIT_COUNT: number; RENT_PAID_AMOUNT: number | null; BILLS_PAID_COUNT: number; ROLLOUT_MONTH: string | null; T12_CONNECTIONS: number; MEDIAN_RENTER_INCOME: number | null };
let _networkPoolCache: { cutoff: string; data: NetworkPoolRow[]; fetchedAt: number } | null = null;
const _NETWORK_POOL_TTL_MS = 10 * 60 * 1000; // 10 minutes — unused while caching is disabled, see below

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
  // Direct-to-resident marketing opt-in (Flask: is_marketing_opt_in) — drives the "Direct
  // Marketing on/off" badge and D2C tiebreaker on the Property Deep Dive slides.
  HAS_MARKETING_INTEGRATION: z.boolean().nullable(),
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

function renderCover(kpis: { pmcName: string; reportingMonth: string; partnerSince: string | null; propertyCount: number }): string {
  return `
  <div class="slide active" id="slide-1" style="background:#2C194D;justify-content:center;align-items:flex-start;">
    <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#DDC6F9;margin-bottom:20px;font-weight:600;font-family:'ABCDiatype',sans-serif;">Flex Performance Review</div>
    <div style="font-size:76px;font-weight:500;line-height:1.0;color:#fff;margin-bottom:12px;letter-spacing:-0.02em;font-family:'ABCDiatype',sans-serif;">${kpis.pmcName}</div>
    <div style="font-size:22px;font-weight:400;color:rgba(255,255,255,0.45);margin-bottom:72px;font-family:'ABCDiatype',sans-serif;">${monthLabel(kpis.reportingMonth)}</div>
    <div style="display:flex;gap:52px;">
      <div><div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.28);margin-bottom:6px;font-family:'ABCDiatype',sans-serif;">Partner Since</div>
           <div style="font-size:16px;font-weight:600;color:rgba(255,255,255,0.85);font-family:'ABCDiatype',sans-serif;">${monthLabel(kpis.partnerSince)}</div></div>
      <div><div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.28);margin-bottom:6px;font-family:'ABCDiatype',sans-serif;">Properties Active</div>
           <div style="font-size:16px;font-weight:600;color:rgba(255,255,255,0.85);font-family:'ABCDiatype',sans-serif;">${kpis.propertyCount}</div></div>
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
  vsLabel?: string;
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
    retentionSub = "of eligible residents returned";
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
  const dqSub = d.lifetimeDqShielded != null && d.lifetimeDqShielded > 0 ? "rent covered when residents missed" : "";
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

  // ── Delta toggle check ────────────────────────────────────────────────────
  const pillProps = pill(d.propertyCount, d.prevPropertyCount, "abs");
  const pillResidents = pill(d.currentResidents, d.prevResidents, "abs");
  const pillNar = pill(nar, d.prevNar, "pp");
  const anyDelta = !!(pillProps || pillResidents || pillNar || heroPill);

  const deltaToggle = anyDelta
    ? `<button class="presenter-control" onclick="var s=document.getElementById('slide-${slideId}');s.classList.toggle('hide-deltas');this.textContent=s.classList.contains('hide-deltas')?'Show change ${_vs}':'Hide change ${_vs}';" style="padding:4px 10px;border-radius:5px;border:1px solid #e5e7eb;background:#fff;color:#6b7280;font-size:10px;font-weight:600;cursor:pointer;letter-spacing:0.04em;font-family:'Lexend',sans-serif;">Hide change ${_vs}</button>`
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
  <div class="slide" id="slide-${slideId}" style="background:#fff;flex-direction:column;padding:44px 56px 36px;overflow:hidden;">
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
              ${avgPayment > 0 ? `<div style="font-size:11px;color:rgba(255,255,255,0.40);margin-top:5px;">avg $${avgPayment.toLocaleString()}/household</div>` : ""}
            </div>
            ${moRentSparkSvg ? `<div style="flex-shrink:0;">${moRentSparkSvg}</div>` : ""}
          </div>
        </div>
      </div>
      <!-- 6 Metric Tiles (3×2 grid) -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(2,1fr);gap:12px;">
        ${tile("Active properties", d.propertyCount.toLocaleString(), "", pillProps, "", svgBldg)}
        ${tile("Residents paying", d.currentResidents.toLocaleString(), "", pillResidents, residentsSparkHtml, svgPerson)}
        ${tile("New residents paying this month", d.currentNewSignups.toLocaleString(), signupsSub, "", signupsSparkHtml, svgNewP)}
        ${tile("Adoption rate", fmtPct(nar), "", pillNar, narSparkHtml, svgPct)}
        ${tile("True repeat rate", retentionVal, retentionSub, "", "", svgRepeat)}
        ${tile("Delinquency shielded", dqVal, dqSub, dqPill, "", svgShield)}
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
      `Closing to ${fmtPct(targetNar)} means ${Math.round(p.totalUnits * targetNar).toLocaleString()} more active households - each adds ~$${avgRent >= 1000 ? Math.round(avgRent / 1000) + 'K' : avgRent}/month.`],
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
      conText = `<strong>Adoption dipped last month</strong> - ${propDelta >= 0 ? "+" : ""}${propDelta.toLocaleString()} new properties joined, diluting the overall rate. Floor holds at today's ${fmtPct(p.currentNar)}: ${conservativeResidents.toLocaleString()} households.`;
    } else {
      conText = `<strong>Adoption dipped last month</strong> - fewer residents paid through Flex. Could reflect seasonal patterns or a real signal; worth monitoring. Floor: ${conservativeResidents.toLocaleString()} households at ${fmtPct(p.currentNar)}.`;
    }
  } else {
    conText = `Conservative floor: <strong>${conservativeResidents.toLocaleString()} households</strong> at today's ${fmtPct(p.currentNar)} rate - the baseline if nothing changes.`;
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

  const tgtText = `Closing to <strong>${fmtPct(targetNar)}</strong> means <strong>${gapResidents.toLocaleString()} more active households</strong> - each adds ~${fmtCurrency(avgRent)}/month.`;

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
              <div style="font-size:15px;color:#524e5b;margin-bottom:10px;">${residents.toLocaleString()} active households</div>
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
      regionBlock = `<div id="${rowsId}" style="display:none;padding-left:20px;margin-top:-4px;">${regionRows}</div>`;
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

  async function exportDeckPDF(btn) {
    const origHTML = btn.innerHTML;
    btn.innerHTML = '\\u23f3 Building\\u2026';
    btn.disabled = true;
    try {
      await document.fonts.ready;
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
        el.querySelectorAll('canvas').forEach(cv => {
          const c = Chart.getChart(cv);
          if (!c) return;
          try { c.resize(); c.update('none'); } catch(e) {}
        });
        await new Promise(r => setTimeout(r, 100));
        const canvas = await html2canvas(el, {
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
  }),

  output: z.object({
    html: z.string(),
    empty: z.boolean(),
    notes_html: z.string().optional(),
  }),

  async run(ctx, { pmc_name, second_pmc, report_name, lookback_months, deck_mode, adoption_target, testimonials, total_portfolio_units, expansion_slides, presenting_mode, comparison_months }) {
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
          HAS_MARKETING_INTEGRATION
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

    const NetworkPoolSchema = z.object({
      PMC_NAME: z.string(),
      PROPERTY_NAME: z.string(),
      PROPERTY_STATE: z.string().nullable(),
      PROPERTY_UNIT_COUNT: z.number(),
      RENT_PAID_AMOUNT: z.number().nullable(),
      BILLS_PAID_COUNT: z.number(),
      ROLLOUT_MONTH: z.string().nullable(),
      T12_CONNECTIONS: z.number(),
      MEDIAN_RENTER_INCOME: z.number().nullable(),
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

    const [metricsRows, dqShieldedRows, yearlyRentBillsRows, trendRawRows, retentionCohortRows, customerMonthRows] = await Promise.all([
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
               AND IS_IN_NETWORK = TRUE
             GROUP BY 1
             ORDER BY 1
             LIMIT 50`,
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
                    TO_VARCHAR(ROLLOUT_MONTH, 'YYYY-MM-DD') AS ROLLOUT_MONTH
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
        `WITH scoped_props AS (
            SELECT PROPERTY_PUBLIC_ID, BP_MONTH
            FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
            WHERE PMC_NAME = ?
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
        // starve the cohort window entirely.
        [pmc_name, Math.max(3, lookback_months), cutoffStr, cutoffStr, reportingMonthStr, reportingMonthStr],
        { label: "Compute loyalty buckets & true repeat rate from customer cohort" }
      ).catch(() => [] as { LOYALTY_BUCKET: string; BUCKET_COUNT: number; TOTAL_CUSTOMERS: number; TRUE_REPEAT_RATE: number | null }[]),
      ctx.integrations.snowflake_sso.query(
        `SELECT
            n.CUSTOMER_PUBLIC_ID,
            TO_VARCHAR(n.BP_MONTH, 'YYYY-MM-DD') AS BP_MONTH
         FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS p
         JOIN PRODUCTION.ANALYTICS.NAR_CHARGED_USERS n
            ON n.PROPERTY_PUBLIC_ID = p.PROPERTY_PUBLIC_ID AND n.BP_MONTH = p.BP_MONTH
         WHERE p.PMC_NAME = ?
           AND p.IS_IN_NETWORK = TRUE
           AND p.BP_MONTH >= DATEADD('month', -?, ?::DATE)
           AND p.BP_MONTH < ?
           AND n.HAS_BILL_PAID = TRUE`,
        CustomerMonthSchema,
        // Same window as the retention-cohort query above (Flask: pull_retention_cohort's
        // lookback_months) — this feeds the same cohort_df the MoM chart is built from.
        [pmc_name, Math.max(3, lookback_months), cutoffStr, cutoffStr],
        { label: "Fetch raw (customer, month) pairs for MoM retention set-intersection" }
      ).catch(() => [] as { CUSTOMER_PUBLIC_ID: string; BP_MONTH: string }[]),
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
        SELECT MIN(o.CLOSED_AT_UTC) AS closed_at
        FROM PRODUCTION.SALES.FCT_SALES_OPPORTUNITIES o
        JOIN PRODUCTION.SALES.DIM_SALES_ACCOUNTS a ON o.SALES_ACCOUNT_KEY = a.SALES_ACCOUNT_KEY
        JOIN (SELECT DISTINCT PMC_ID FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS WHERE PMC_NAME = ?) p
             ON a.PMC_ID = p.PMC_ID
        WHERE o.OPPORTUNITY_TYPE = 'New Logo' AND o.IS_CLOSED_WON = TRUE
        UNION ALL
        SELECT MIN(o.CLOSED_AT_UTC) AS closed_at
        FROM FLEX.SALES.FCT_CRM_OPPORTUNITY o
        JOIN FLEX.SALES.DIM_CRM_ACCOUNT_HISTORY a ON o.CRM_ACCOUNT_SK = a.CRM_ACCOUNT_SK
        JOIN (SELECT DISTINCT PMC_ID FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS WHERE PMC_NAME = ?) p
             ON a.PMC_ID = p.PMC_ID
        WHERE a.IS_CURRENT = TRUE
          AND o.OPPORTUNITY_TYPE = 'New Logo' AND o.IS_CLOSED_WON = TRUE
       )
       SELECT TO_VARCHAR(MIN(closed_at), 'YYYY-MM-DD') AS LAUNCH_MONTH FROM opp_dates`,
      LaunchSchema,
      [pmc_name, pmc_name],
      { label: "Pull partner launch month from Salesforce opportunities (old + new schema)" }
    ).catch((err) => {
      partnerSinceError = err instanceof Error ? err.message : String(err);
      return [{ LAUNCH_MONTH: null }] as { LAUNCH_MONTH: string | null }[];
    });

    // --- Network property pool (cached, same for all PMCs in a given cutoff) ---
    // Only needed for QBR mode (15,000 row query for peer matching)
    let networkPool: NetworkPoolRow[] = [];
    let regionDetail: { PROPERTY_STATE: string; PROPERTY_REGION: string; PROPERTIES: number; TOTAL_UNITS: number; BILLS_PAID: number }[] = [];
    // Subject PMC's own properties' median renter income, keyed by property name — feeds the
    // RTI (rent-to-income) peer-matching tier in peer-matching.ts's resolvePropertyPeerMetric.
    const subjectIncomeByProperty = new Map<string, number>();
    // Tenure percentile vs. all active PMCs (1 = oldest) — gates the anniversary-milestone
    // callout below to only the top 50% most-tenured partners, matching Flask.
    let tenurePercentileFromTop: number | null = null;
    // Deactivated properties + network-wide age-since-rollout benchmark, feeding the
    // "These properties need our attention" slide's New Rollouts and No-Longer-Active
    // sections (QBR only, same as the rest of this block).
    let disabledPropertyRows: { PROPERTY_NAME: string; DEACTIVATION_REASON: string; PROPERTY_UNIT_COUNT: number; LAST_SEEN_MONTH: string | null }[] = [];
    let stageAgeBenchmarkRows: { AGE_MONTHS: number; P50_NAR: number | null; P50_ENG_PER_100: number | null; N: number }[] = [];

    if (needsQBRQueries) {
      // Caching disabled — this module-level cache was almost certainly serving stale,
      // pre-bugfix results for up to 10 minutes after every deploy this session (the server
      // process doesn't necessarily restart on a git-synced code update, so `let`-scoped module
      // state can outlive the code that populated it). Correctness over the small perf win while
      // this pipeline is under active repair; worth reinstating once things are verified stable.
      const cacheValid = false;

      const networkPoolPromise = cacheValid
        ? Promise.resolve(_networkPoolCache!.data)
        : ctx.integrations.snowflake_sso.query(
            `WITH prop_zip AS (
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
                GROUP BY PMC_NAME, PROPERTY_NAME
             )
             SELECT a.PMC_NAME, a.PROPERTY_NAME, a.PROPERTY_STATE, a.PROPERTY_UNIT_COUNT,
                    a.RENT_PAID_AMOUNT, a.BILLS_PAID_COUNT, a.ROLLOUT_MONTH, a.T12_CONNECTIONS,
                    PRODUCTION.ANALYTICS.FIPS_TO_CENSUS_DATA(
                        PRODUCTION.ANALYTICS.ZIP_TO_FIPS(LEFT(p.PROPERTY_ZIP, 5)),
                        'median_renter_household_income'
                    ) AS MEDIAN_RENTER_INCOME
             FROM agg a
             LEFT JOIN prop_zip p
               ON p.PROPERTY_PUBLIC_ID = a.PROPERTY_PUBLIC_ID AND p.rn = 1
             WHERE a.PROPERTY_UNIT_COUNT >= 10
               AND a.PROPERTY_STATE IS NOT NULL AND a.PROPERTY_STATE != ''
             LIMIT 15000`,
            NetworkPoolSchema,
            [cutoffStr],
            { label: "Pull network property pool for peer matching (incl. median renter income for RTI tier)" }
          ).then((rows) => {
            // Cache the result for future runs
            _networkPoolCache = { cutoff: cutoffStr, data: rows, fetchedAt: Date.now() };
            return rows;
          }).catch(() => [] as NetworkPoolRow[]);

      // Fire region detail in parallel with network pool
      const regionDetailPromise = ctx.integrations.snowflake_sso.query(
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
          // KNOWN ISSUE, not fixed here: cutoffStr is an exclusive boundary (1st of the next
          // allowed month), not a real month — exact-matching it can land on Snowflake's
          // pre-created, not-yet-real stub row for that month (same bug class fixed elsewhere
          // in this file). latestCompletedMonth (the correct value to use) isn't computed yet
          // at this point in the request pipeline, so it's not a same-line swap; needs its own
          // pass to compute a real "latest" inline the way reportingMonthStr does above.
          [pmc_name, cutoffStr],
          { label: "Pull DMA region detail for geo slide dropdowns" }
        ).catch(() => [] as { PROPERTY_STATE: string; PROPERTY_REGION: string; PROPERTIES: number; TOTAL_UNITS: number; BILLS_PAID: number }[]);

      // Subject PMC's own property-level median renter income (same ZIP→FIPS→census UDF
      // chain as the network pool query above) — lets the peer-matching resolver compare
      // rent-to-income instead of raw rent for this PMC's properties.
      const SubjectIncomeSchema = z.object({
        PROPERTY_NAME: z.string(),
        MEDIAN_RENTER_INCOME: z.number().nullable(),
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
      // the top 50% most-tenured partners, same as Flask's pull_pmc_tenure_percentile. Ranks by
      // true rollout tenure (any integration status), which is what the milestone slide's
      // tenure stat is about — a separate concept from months_since_launch's DI-only maturity.
      const subjectPmcNames = second_pmc ? [pmc_name, second_pmc] : [pmc_name];
      const subjectPlaceholders = subjectPmcNames.map(() => "?").join(", ");
      const TenurePercentileSchema = z.object({
        PERCENTILE_FROM_TOP: z.number().nullable(),
      });
      const tenurePercentilePromise = ctx.integrations.snowflake_sso.query(
          `WITH pmc_tenures AS (
              SELECT PMC_NAME, MIN(ROLLOUT_MONTH) AS launch_month
              FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
              WHERE ROLLOUT_MONTH IS NOT NULL
              GROUP BY PMC_NAME
           ),
           subject AS (
              SELECT MIN(ROLLOUT_MONTH) AS launch_month
              FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
              WHERE ROLLOUT_MONTH IS NOT NULL AND PMC_NAME IN (${subjectPlaceholders})
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

      // Network-wide NAR + T12-engagement benchmark by months-since-rollout (age 1-11), for
      // the New Rollouts section's "expected" columns. Flask's real equivalent
      // (_pull_stage_benchmarks, generator/data.py:2524) geo/size/rent/D2C/NIRO-tiers this by
      // PMC portfolio; simplified here to a network-wide-only percentile (still 100% real data,
      // just not geo-matched) since the established per-property peer pool used elsewhere on
      // this slide structurally excludes anything under 7 months live and has no candidates
      // this young.
      const StageAgeBenchmarkSchema = z.object({
        AGE_MONTHS: z.number(),
        P50_NAR: z.number().nullable(),
        P50_ENG_PER_100: z.number().nullable(),
        N: z.number(),
      });
      const stageAgeBenchmarkPromise = ctx.integrations.snowflake_sso.query(
        `WITH base AS (
            SELECT
              PROPERTY_PUBLIC_ID,
              PMC_NAME,
              PROPERTY_UNIT_COUNT,
              BP_MONTH,
              DATEDIFF('month', ROLLOUT_MONTH, BP_MONTH) + 1 AS AGE_MONTHS,
              BILLS_PAID_COUNT,
              SUM(COALESCE(NEW_BILL_CONNECTIONS_PROPERTY, 0)) OVER (
                PARTITION BY PROPERTY_PUBLIC_ID ORDER BY BP_MONTH
              ) AS CUM_CONNECTIONS
            FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
            WHERE IS_IN_NETWORK = TRUE
              AND ROLLOUT_MONTH IS NOT NULL
              AND PMC_NAME NOT IN (${subjectPlaceholders})
              AND BP_MONTH >= DATEADD('month', -24, CURRENT_DATE())
              AND BP_MONTH < ?
         )
         SELECT
            AGE_MONTHS,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY BILLS_PAID_COUNT::FLOAT / NULLIF(PROPERTY_UNIT_COUNT, 0)) AS P50_NAR,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CUM_CONNECTIONS::FLOAT / NULLIF(PROPERTY_UNIT_COUNT, 0) * 100) AS P50_ENG_PER_100,
            COUNT(*) AS N
         FROM base
         WHERE AGE_MONTHS BETWEEN 1 AND 11
         GROUP BY AGE_MONTHS
         HAVING COUNT(*) >= 5`,
        StageAgeBenchmarkSchema,
        [...subjectPmcNames, cutoffStr],
        { label: "Fetch network-wide age-since-rollout benchmark for New Rollouts section" }
      ).catch(() => [] as z.infer<typeof StageAgeBenchmarkSchema>[]);

      const [networkPoolResult, regionDetailResult, subjectIncomeRows, tenurePercentileRows, disabledPropertyResult, stageAgeBenchmarkResult] = await Promise.all([
        networkPoolPromise, regionDetailPromise, subjectIncomePromise, tenurePercentilePromise,
        disabledPropertiesPromise, stageAgeBenchmarkPromise,
      ]);
      networkPool = networkPoolResult;
      regionDetail = regionDetailResult;
      disabledPropertyRows = disabledPropertyResult;
      stageAgeBenchmarkRows = stageAgeBenchmarkResult;
      for (const row of subjectIncomeRows) {
        if (row.MEDIAN_RENTER_INCOME != null && row.MEDIAN_RENTER_INCOME > 0) {
          subjectIncomeByProperty.set(row.PROPERTY_NAME, row.MEDIAN_RENTER_INCOME);
        }
      }
      tenurePercentileFromTop = tenurePercentileRows[0]?.PERCENTILE_FROM_TOP ?? null;
    }

    // --- Testimonials (user-selected from frontend, or auto-pulled from Zendesk) ---
    // Fire Zendesk query as a non-blocking promise (we await it later, just before slides need it)
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

    // --- Resident Experience Trend (CSAT + Response Time from Zendesk) ---
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
    const networkPoolProps: NetworkPoolProperty[] = networkPool
      .filter((r) => r.PROPERTY_STATE && r.ROLLOUT_MONTH)
      .map((r) => {
        const rollout = new Date(r.ROLLOUT_MONTH!);
        const mLive = (reportingMonthDate.getFullYear() - rollout.getFullYear()) * 12
                      + (reportingMonthDate.getMonth() - rollout.getMonth());
        const avgRent = r.BILLS_PAID_COUNT > 0 ? (r.RENT_PAID_AMOUNT ?? 0) / r.BILLS_PAID_COUNT : 0;
        const nar = r.PROPERTY_UNIT_COUNT > 0 ? r.BILLS_PAID_COUNT / r.PROPERTY_UNIT_COUNT : 0;
        const t12EngPer100 = r.PROPERTY_UNIT_COUNT > 0 ? r.T12_CONNECTIONS / r.PROPERTY_UNIT_COUNT * 100 : 0;
        return {
          pmcName: r.PMC_NAME,
          propertyName: r.PROPERTY_NAME,
          propertyState: r.PROPERTY_STATE!,
          propertyUnitCount: r.PROPERTY_UNIT_COUNT,
          avgRent,
          monthsLive: mLive,
          nar,
          t12EngPer100,
          ageBucket: propertyAgeBucket(mLive),
          medianRenterIncome: r.MEDIAN_RENTER_INCOME,
        };
      })
      .filter((p) => p.monthsLive >= 7 && (p.avgRent === 0 || (p.avgRent >= 700 && p.avgRent <= 2500)));

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

    // ── Partner Since: prefer earliest of Salesforce closed-won OR MIN(ROLLOUT_MONTH) ──
    // Flask: pull_launch_month() — uses the EARLIER of Salesforce close date and first rollout
    let partnerSince = earliestRollout;
    try {
      const [launchRow] = await partnerSincePromise;
      if (launchRow?.LAUNCH_MONTH) {
        // Use the EARLIER of Salesforce close date and first property rollout
        if (!earliestRollout || launchRow.LAUNCH_MONTH < earliestRollout) {
          partnerSince = launchRow.LAUNCH_MONTH;
        }
      } else if (partnerSinceError) {
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
    const latestMetrics = metricsRows.find((r) => r.BP_MONTH === latestCompletedMonth);
    let trueRepeatRate: number | null = null;
    if (latestMetrics && latestMetrics.BILLS_PAID_REPEAT != null && latestMetrics.BILLS_PAID_PREV_MONTH != null && latestMetrics.BILLS_PAID_PREV_MONTH > 0) {
      trueRepeatRate = Math.min(1, latestMetrics.BILLS_PAID_REPEAT / latestMetrics.BILLS_PAID_PREV_MONTH);
    }

    // --- Compute Lifetime DQ Shielded ---
    const lifetimeDqShielded = dqShieldedRows.reduce((sum, r) => sum + (r.TOTAL_RENT_SHIELDED ?? 0), 0);

    // --- Segment NAR / HubSpot segment label — REMOVED (fabricated data source) ---
    // PARTNER_REPORTING_CORE_METRICS.HUBSPOT_COMPANY_SEGMENT / SEGMENT_NAR_AVG have zero
    // equivalent anywhere in Flask (confirmed via full-repo grep) — this table/columns don't
    // exist in real Snowflake. Every read site below is being migrated to the real
    // geo/size/rent-matched peer cohort (lockedPeers / canonicalPeerNarP50), which is already
    // sourced from real data (PROPERTY_BP_MONTH_STATS). Kept as explicit nulls (not deleted)
    // so every downstream `?? fallback` still resolves correctly while that migration lands.
    const segmentNarAvg: number | null = null;
    const hubspotSegment: string | null = null;

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
    let segmentPercentiles: { metric: string; p25: number; p50: number; p75: number; p90: number; p99: number; pmcValue: number }[] = [];
    let canonicalPeerNarP50: number | null = null;
    let rollingPeerMedianMap: Record<string, { p50: number }> = {};
    // Compute months since launch for benchmark resolution (used by peer median + adoption trend)
    let _msl = 0;
    if (earliestRollout && latestCompletedMonth) {
      const [ey, em] = earliestRollout.split("-").map(Number);
      const [ly, lm] = latestCompletedMonth.split("-").map(Number);
      _msl = (ly - ey) * 12 + (lm - em) + 1;
    }

    // --- Locked peers for rolling median (pure JS tiered matching, no query) ---
    // Computed regardless of tenure — the rolling time-series median (below) is only useful
    // for established PMCs (>=36mo), but this cohort itself also backs the Peer Benchmarks
    // slide's snapshot percentiles for PMCs of any tenure, so it can't be gated on _msl.
    let lockedPeers: string[] = [];
    let lockedPeersCriteria = "comparable PMCs";
    if (networkPoolProps.length > 0) {
      // Step 1: Aggregate networkPool to PMC level for peer matching
      const pmcAgg = new Map<string, { totalUnits: number; avgRent: number; primaryState: string; stateCount: number }>();
      const pmcStateUnits = new Map<string, Map<string, number>>();
      for (const p of networkPoolProps) {
        if (p.pmcName === pmc_name || (second_pmc && p.pmcName === second_pmc)) continue;
        const existing = pmcAgg.get(p.pmcName);
        if (!existing) {
          pmcAgg.set(p.pmcName, { totalUnits: p.propertyUnitCount, avgRent: p.avgRent, primaryState: p.propertyState, stateCount: 1 });
          pmcStateUnits.set(p.pmcName, new Map([[p.propertyState, p.propertyUnitCount]]));
        } else {
          existing.totalUnits += p.propertyUnitCount;
          // Weighted avg rent approximation
          const su = pmcStateUnits.get(p.pmcName)!;
          su.set(p.propertyState, (su.get(p.propertyState) ?? 0) + p.propertyUnitCount);
        }
      }
      // Derive primary state (most units)
      for (const [nm, su] of pmcStateUnits.entries()) {
        const agg = pmcAgg.get(nm);
        if (!agg) continue;
        let maxSt = "", maxU = 0;
        for (const [st, u] of su.entries()) { if (u > maxU) { maxU = u; maxSt = st; } }
        agg.primaryState = maxSt;
        agg.stateCount = su.size;
      }

      // Step 2: Match peers using Flask's tiered approach
      const subjectUnits = latestRows.reduce((s, r) => s + r.PROPERTY_UNIT_COUNT, 0);
      const subjectBills = latestRows.reduce((s, r) => s + r.BILLS_PAID, 0);
      const subjectRent = latestRows.reduce((s, r) => s + r.RENT_PAID, 0);
      const subjectAvgRent = subjectBills > 0 ? subjectRent / subjectBills : 0;
      const subjectState = (() => {
        const stateMap = new Map<string, number>();
        for (const r of latestRows) {
          if (r.PROPERTY_STATE) stateMap.set(r.PROPERTY_STATE, (stateMap.get(r.PROPERTY_STATE) ?? 0) + r.PROPERTY_UNIT_COUNT);
        }
        let maxSt = "", maxU = 0;
        for (const [st, u] of stateMap) { if (u > maxU) { maxU = u; maxSt = st; } }
        return maxSt;
      })();

      type PeerCandidate = { name: string; totalUnits: number; avgRent: number; primaryState: string };
      const candidates: PeerCandidate[] = [];
      for (const [nm, agg] of pmcAgg) {
        candidates.push({ name: nm, totalUnits: agg.totalUnits, avgRent: agg.avgRent, primaryState: agg.primaryState });
      }

      // Tiered matching (simplified Flask approach) — criteria labels match Flask's real
      // tier ladder (generator/data.py:4156-4165) so the Peer Benchmarks subtitle describes
      // the ACTUAL cohort that matched, instead of a fabricated segment name.
      const tiers: Array<{ useState: boolean; lowMult: number; highMult: number; useRent: boolean; minPeers: number; label: string }> = [
        { useState: true,  lowMult: 0.60, highMult: 1.40, useRent: true,  minPeers: 3, label: `same state (${subjectState}), comparable size & avg rent` },
        { useState: true,  lowMult: 0.60, highMult: 1.40, useRent: false, minPeers: 3, label: `same state (${subjectState}), comparable size` },
        { useState: false, lowMult: 0.60, highMult: 1.40, useRent: true,  minPeers: 5, label: "geographic footprint, comparable size & avg rent" },
        { useState: false, lowMult: 0.30, highMult: 1.70, useRent: true,  minPeers: 5, label: "geographic footprint, comparable size & avg rent" },
        { useState: false, lowMult: 0.30, highMult: 1.70, useRent: false, minPeers: 5, label: "geographic footprint & comparable size" },
        { useState: false, lowMult: 0.30, highMult: 1.70, useRent: false, minPeers: 3, label: "comparable size" },
        // Final fallback: no filters at all, just need 3 peers (Flask also falls through)
        { useState: false, lowMult: 0.00, highMult: 100.0, useRent: false, minPeers: 3, label: "comparable PMCs" },
      ];
      for (const tier of tiers) {
        let pool = candidates.filter((c) =>
          c.totalUnits >= subjectUnits * tier.lowMult && c.totalUnits <= subjectUnits * tier.highMult
        );
        if (tier.useState) pool = pool.filter((c) => c.primaryState === subjectState);
        if (tier.useRent && subjectAvgRent > 0) {
          pool = pool.filter((c) => c.avgRent >= subjectAvgRent * 0.70 && c.avgRent <= subjectAvgRent * 1.30);
        }
        if (pool.length >= tier.minPeers) {
          lockedPeers = pool.map((c) => c.name);
          lockedPeersCriteria = tier.label;
          break;
        }
      }
    }

    const RollingPeerSchema = z.object({ BP_MONTH: z.string(), SMOOTHED_NAR: z.number().nullable() });

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
         WHERE ENG_PER_100 IS NOT NULL`,
        SegmentPercentilesSchema,
        [...lockedPeers, latestCompletedMonth, latestCompletedMonth, latestCompletedMonth, latestCompletedMonth, latestCompletedMonth],
        { label: "Compute peer-cohort P25/P50/P75 for multi-benchmark (real cohort, not a segment table)" }
      ).catch(() => [] as z.infer<typeof SegmentPercentilesSchema>[])
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
           PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY smoothed_nar) AS SMOOTHED_NAR
         FROM smoothed
         WHERE BP_MONTH >= DATEADD('month', -?, ?::DATE)
           AND BP_MONTH < ?
           AND smoothed_nar IS NOT NULL
         GROUP BY BP_MONTH
         HAVING COUNT(*) >= 3
         ORDER BY BP_MONTH`,
        RollingPeerSchema,
        [...lockedPeers, cutoffStr, cutoffStr, lookback_months, cutoffStr, cutoffStr],
        { label: "Rolling peer median NAR (per-month P50 from locked peers)" }
      ).catch(() => [] as z.infer<typeof RollingPeerSchema>[])
      : Promise.resolve([] as z.infer<typeof RollingPeerSchema>[]);

    // Fire both independent round-trips together instead of one at a time
    const [percRows, rollingRows] = await Promise.all([segPercPromise, rollingPromise]);

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

    // Fill in the subject's own value per metric from real, already-computed data (not a
    // second/divergent calculation): NAR from the subject's latest-month adoption rate;
    // engagement from the subject's own trailing-12mo per-property T12_CONNECTIONS, matching
    // the peer query's units-weighted formula exactly.
    {
      const subjectNarValue = latestMonth?.adoptionRate ?? null;
      const subjectPoolProps = networkPoolProps.filter((p) => p.pmcName === pmc_name || (second_pmc && p.pmcName === second_pmc));
      const subjectEngUnits = subjectPoolProps.reduce((s, p) => s + p.propertyUnitCount, 0);
      const subjectEngValue = subjectEngUnits > 0
        ? subjectPoolProps.reduce((s, p) => s + p.t12EngPer100 * p.propertyUnitCount, 0) / subjectEngUnits
        : null;
      segmentPercentiles = segmentPercentiles.map((m) => {
        if (m.metric === "NAR" && subjectNarValue != null) return { ...m, pmcValue: subjectNarValue };
        if (m.metric === "NEW_CONNECTIONS" && subjectEngValue != null) return { ...m, pmcValue: subjectEngValue };
        return m;
      });
    }

    for (const row of rollingRows) {
      if (row.SMOOTHED_NAR != null) {
        rollingPeerMedianMap[row.BP_MONTH] = { p50: row.SMOOTHED_NAR };
      }
    }

    // --- Canonical Peer Benchmark (one resolved P50 NAR per deck) ---
    // Resolution order (mirrors Flask's resolve_canonical_benchmark, generator/data.py:2095-2177,
    // minus the stage-bucket tier — that one is a separate real query, _pull_stage_benchmarks,
    // data.py:2524, not yet ported; PMCs younger than 36mo fall through to tier 2 below instead
    // of a dedicated young-PMC benchmark, a known gap):
    //   1. Rolling calendar-time peer median (established PMCs, tenure >= 36 months) — real,
    //      time-series, from the SAME geo/size/rent-matched lockedPeers cohort.
    //   2. Snapshot P50 across lockedPeers (real, single-month) — used for all other tenures,
    //      and as tier 1's own fallback if the rolling query came back empty.
    // Every slide that shows a peer-median number MUST read from this single value.
    {
      const narPerc = segmentPercentiles.find((s) => s.metric === "NAR");
      if (narPerc) {
        canonicalPeerNarP50 = narPerc.p50;
      }

      // Rolling per-month data, if present, overrides the single P50 above with the latest
      // month's own smoothed value for consistency with the adoption-trend chart's own line.
      if (rollingRows.length > 0) {
        const latestPeer = rollingRows[rollingRows.length - 1];
        if (latestPeer.SMOOTHED_NAR != null) {
          canonicalPeerNarP50 = latestPeer.SMOOTHED_NAR;
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
             PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY smoothed_nar) AS SMOOTHED_NAR
           FROM smoothed
           WHERE BP_MONTH >= DATEADD('month', -?, ?::DATE)
             AND BP_MONTH < ?
             AND smoothed_nar IS NOT NULL
           GROUP BY BP_MONTH
           HAVING COUNT(*) >= 10
           ORDER BY BP_MONTH`,
          RollingPeerSchema,
          [pmc_name, cutoffStr, cutoffStr, lookback_months, cutoffStr, cutoffStr],
          { label: "Network-wide rolling median NAR (fallback)" }
        );
        for (const row of networkWideRolling) {
          if (row.SMOOTHED_NAR != null) {
            rollingPeerMedianMap[row.BP_MONTH] = { p50: row.SMOOTHED_NAR };
          }
        }
      } catch (_e2) {
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

    // Compute DQ shielded since comparison month (same cutoff as other tiles)
    const comparisonMonth = prevMonth?.month ?? null;
    const dqSinceComparison = comparisonMonth
      ? dqShieldedRows
          .filter((r) => r.BP_MONTH != null && r.BP_MONTH! > comparisonMonth)
          .reduce((sum, r) => sum + (r.TOTAL_RENT_SHIELDED ?? 0), 0)
      : null;

    // Cohort-based true repeat rate (preferred over MoM aggregate — matches Flask)
    const cohortTrueRepeatEarly = retentionCohortRows.length > 0
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
      slideId: 2,
      // Flask: QBR always show_sparklines=False (hardcoded, unconditional).
      // Expansion: show_sparklines = not (is_smb and 54 in active_exp_order).
      // Since slide 54 = "residents_units", suppress sparklines on expansion when SMB
      // and that slide is included (it renders the same data as a full chart).
      showSparklines: deck_mode === "qbr" ? false
        : deck_mode === "expansion" ? !(is_smb && (expansion_slides?.includes("residents_units") ?? true))
        : false,
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
    const subjectRepeatValue = (retentionCohortRows[0]?.TRUE_REPEAT_RATE ?? trueRepeatRate) ?? retentionAvg;

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

      const html = buildDeckHtml({
        slides: nlSlides.join("\n"),
        pmc_name,
        report_month: reportMonth,
        report_year: reportYear,
        slide_count: nlCount,
        pdf_filename: pdfFilename,
        extra_js: nlJs,
      });

      return { html, empty: false };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EXPANSION DECK MODE
    // Canonical order matches EXPANSION_SLIDE_ORDER in app.py line 125
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

      const pushSlide = (sid: string, result: { html: string; js: string }) => {
        if (result.html) {
          expSlideHtmls.push(result.html);
          expRenderedKeys.push(sid);
          if (result.js) expSlideJsList.push(result.js);
        }
      };

      // Canonical expansion slide order (string IDs matching SlidesPicker)
      const EXPANSION_SLIDE_ORDER = [
        "cover",
        "exec_bottom_line",
        "by_state",
        "residents_units",     // SMB-only
        "adoption_trend",      // SMB-only
        "cohort_overview",     // SMB-only
        "peer_benchmarks",
        "retention",
        "high_rent",
        "delinquency",
        "expansion_metrosight",
        "expansion_gap",
        "testimonials",
        "expansion_case_close",
      ];

      // SMB-only slides are excluded when not an SMB account
      const SMB_ONLY = new Set(["residents_units", "adoption_trend", "cohort_overview"]);

      // Build active order: filter by expansion_slides if provided, then
      // force-append expansion_case_close at the end regardless of selection
      const slideFilter = expansion_slides && expansion_slides.length > 0
        ? new Set(expansion_slides)
        : null;

      const activeOrder = EXPANSION_SLIDE_ORDER.filter((sid) => {
        if (sid === "expansion_case_close") return false; // always appended below
        if (SMB_ONLY.has(sid) && !is_smb) return false;  // SMB gate
        if (sid === "testimonials" && testimonials.length === 0) return false;
        return slideFilter === null || slideFilter.has(sid);
      });
      activeOrder.push("expansion_case_close"); // always last

      // Shared computations
      const enrolledUnits = latestMonth?.units ?? 0;
      // Auto-populate total_portfolio_units from Snowflake data (HUBSPOT_DEAL_TOTAL_COMPANY_UNITS)
      // if the caller didn't provide one — mirrors Flask's list_expansion_candidates SFDC lookup
      let expTotalPortfolio = total_portfolio_units;
      if (!expTotalPortfolio) {
        const hubspotUnits = inNetwork.reduce((max, r) => Math.max(max, r.HUBSPOT_DEAL_TOTAL_COMPANY_UNITS ?? 0), 0);
        expTotalPortfolio = hubspotUnits > 0 ? hubspotUnits : enrolledUnits;
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
            else slideNum--; // no data — don't count this slot
            break;
          }

          case "peer_benchmarks": {
            // Use canonical-resolved metrics for NAR P50 consistency
            const expBenchMetrics = segmentPercentiles.map((m) => {
              if (m.metric === "NAR" && canonicalPeerNarP50 != null) return { ...m, p50: canonicalPeerNarP50 };
              if (m.metric === "REPEAT_RATE" && subjectRepeatValue != null) return { ...m, pmcValue: subjectRepeatValue };
              return m;
            });
            const r = renderPeerBenchmarks({
              slideId: slideNum,
              pmcName: pmcDisplayName,
              segment: lockedPeersCriteria,
              metrics: expBenchMetrics,
            });
            pushSlide(sid, r);
            break;
          }

          case "retention": {
            const r = renderRetention({
              slideId: slideNum,
              pmcName: pmcDisplayName,
              reportingMonth: latestCompletedMonth,
              trueRepeatRate,
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
              const r = renderHighRentAdoption({ slideId: slideNum, pmcName: pmcDisplayName, propertySnapshot: expRentBucketProps });
              pushSlide(sid, r);
            }
            break;
          }

          case "delinquency": {
            const r = renderDelinquency({
              slideId: slideNum,
              months: dqMonths,
              lifetimeShielded: lifetimeDqShielded,
              windowMonths: lookback_months,
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
              p50Nar: canonicalPeerNarP50 ?? expNarPerc?.p50,
              p75Nar: expNarPerc?.p75,
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
            });
            pushSlide(sid, r);
            break;
          }
        }
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

      const html = buildDeckHtml({
        slides: expSlidesRenumbered.join("\n"),
        pmc_name: displayName,
        report_month: reportMonth,
        report_year: reportYear,
        slide_count: expSlidesRenumbered.length,
        pdf_filename: pdfFilename,
        extra_js: expJs,
      });

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
        };
        const expNotesBenchmark: SpeakerNotesBenchmark = {
          benchmarkNar: canonicalPeerNarP50 ?? segmentNarAvg ?? 0.085,
          p50Nar: canonicalPeerNarP50 ?? expNarPerc?.p50 ?? null,
          p75Nar: expNarPerc?.p75 ?? null,
        };
        const expNotesMonthly: SpeakerNotesMonthlyRow[] = monthlyTotals.map((m) => ({
          month: m.month, billsPaid: m.billsPaid, units: m.units, rentPaid: m.rentPaid,
          newSignups: m.newSignups, propertyCount: m.propertyCount,
        }));
        expNotesHtml = buildExpansionSpeakerNotesHtml(expRenderedKeys, expNotesKpis, expNotesMonthly, expNotesBenchmark);
      } catch (e) {
        console.warn(`[PMC Report] expansion speaker notes generation failed for ${pmc_name}: ${e instanceof Error ? e.message : String(e)}`);
      }

      return { html, empty: false, notes_html: expNotesHtml };
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
      // Build stage_benchmarks: map month-since-launch to segment P50 NAR
      stage_benchmarks: Object.fromEntries(
        metricsRows
          .filter((r) => r.SEGMENT_NAR_AVG != null)
          .map((r, i, arr) => {
            // Map this month's data to a months-since-launch value
            const msLaunch = monthsSinceLaunch - (arr.length - 1 - i);
            return [Math.max(1, Math.min(36, msLaunch)), { p50: r.SEGMENT_NAR_AVG!, peer_label: hubspotSegment ?? undefined }];
          })
      ),
      // Use real rolling peer median if available; otherwise hide the peer median line
      // (a flat line from SEGMENT_NAR_AVG is misleading — better to show no peer line
      // than a constant that doesn't actually represent calendar-month peer movement)
      rolling_peer_median: Object.keys(rollingPeerMedianMap).length > 0
        ? rollingPeerMedianMap
        : {},
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
      peerPercentiles: narPerc ? {
        p25: narPerc.p25,
        p50: canonicalPeerNarP50 ?? narPerc.p50,
        p75: narPerc.p75,
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
    const benchmarkMetrics = segmentPercentiles.map((m) => {
      if (m.metric === "NAR" && canonicalPeerNarP50 != null) {
        return { ...m, p50: canonicalPeerNarP50 };
      }
      if (m.metric === "REPEAT_RATE" && subjectRepeatValue != null) {
        return { ...m, pmcValue: subjectRepeatValue };
      }
      return m;
    });
    const peerBenchResult = renderPeerBenchmarks({
      slideId: 9,
      pmcName: pmcDisplayName,
      segment: lockedPeersCriteria,
      metrics: benchmarkMetrics,
      // TEMPORARY diagnostic — remove once the empty-metrics root cause is confirmed and fixed.
      debugInfo: [
        `pmc_name (query param): ${pmc_name}`,
        `latestCompletedMonth: ${latestCompletedMonth}`,
        `cutoffStr: ${cutoffStr}`,
        `_msl (months since launch): ${_msl}`,
        `networkPool.length (raw SQL rows): ${networkPool.length}`,
        `networkPoolProps.length (post-filter): ${networkPoolProps.length}`,
        `lockedPeers.length: ${lockedPeers.length}`,
        `lockedPeersCriteria: ${lockedPeersCriteria}`,
        `lockedPeers (first 10): ${lockedPeers.slice(0, 10).join(", ")}`,
        `segmentPercentiles.length: ${segmentPercentiles.length}`,
        `segmentPercentiles: ${JSON.stringify(segmentPercentiles)}`,
        `canonicalPeerNarP50: ${canonicalPeerNarP50}`,
        `rollingPeerMedianMap keys: ${Object.keys(rollingPeerMedianMap).length}`,
      ].join("\n"),
    });

    // --- Flex Is For Everyone (high rent adoption) slide ---
    // Query resident-level rent data for more accurate bucketing + All-Time toggle
    const ResidentRentSchema = z.object({
      RESIDENT_AMOUNT_PAID: z.number(),
    });
    const AlltimeResidentSchema = z.object({
      RESIDENT_AMOUNT_PAID: z.number(),
      RESIDENT_TOTAL_PAID: z.number(),
    });
    const [residentRentRows, alltimeResidentRows] = await Promise.all([
      ctx.integrations.snowflake_sso.query(
        `WITH scoped_props AS (
            SELECT PROPERTY_PUBLIC_ID, BP_MONTH
            FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
            WHERE PMC_NAME = ?
              AND IS_IN_NETWORK = TRUE
         ),
         latest AS (
            -- NAR_CHARGED_USERS lags PROPERTY_BP_MONTH_STATS's own BILLS_PAID_COUNT — a month
            -- can already show as "completed" (bills paid > 0) before this table has been
            -- populated for it. Requiring an exact match on latestCompletedMonth here silently
            -- returned zero resident rows, which fell back to inflated property-level totals.
            -- Mirrors Flask's pull_resident_detail (generator/data.py:3317-3327) exactly: the
            -- real "latest" for THIS table is whichever month it actually has data joined for.
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
        `WITH scoped_props AS (
            SELECT PROPERTY_PUBLIC_ID, BP_MONTH
            FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
            WHERE PMC_NAME = ?
              AND IS_IN_NETWORK = TRUE
              AND BP_MONTH < ?
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
        [pmc_name, cutoffStr],
        { label: "Pull all-time resident rent averages for rent bucket toggle" }
      ).catch(() => [] as { RESIDENT_AMOUNT_PAID: number; RESIDENT_TOTAL_PAID: number }[]),
    ]);
    const residentRents = residentRentRows.filter((r) => r.RESIDENT_AMOUNT_PAID > 0).map((r) => r.RESIDENT_AMOUNT_PAID);
    const alltimeResidentRents = alltimeResidentRows.filter((r) => r.RESIDENT_AMOUNT_PAID > 0).map((r) => ({
      amountPaid: r.RESIDENT_AMOUNT_PAID,
      totalPaid: r.RESIDENT_TOTAL_PAID,
    }));

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

    // --- Delinquency Protection slide ---
    const delinquencyResult = renderDelinquency({
      slideId: 13,
      months: dqMonths,
      lifetimeShielded: lifetimeDqShielded,
      windowMonths: Math.min(dqMonths.length, 12),
    });

    // --- Resident Retention slide ---
    // Use cohort-derived true repeat rate (lifetime metric, stable across runs).
    // The MoM fallback (trueRepeatRate) measures a different thing and is non-deterministic
    // across months, so only use it if the cohort query genuinely has no data.
    let cohortTrueRepeatRate: number | null = null;
    if (retentionCohortRows.length > 0) {
      const trueRepeat = retentionCohortRows[0]?.TRUE_REPEAT_RATE;
      if (trueRepeat != null) cohortTrueRepeatRate = trueRepeat;
    }
    const finalTrueRepeatRate = cohortTrueRepeatRate ?? trueRepeatRate;

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
      // TEMPORARY diagnostic — remove once retention numbers are confirmed correct.
      debugInfo: [
        `latestCompletedMonth: ${latestCompletedMonth}`,
        `reportingMonthStr: ${reportingMonthStr}`,
        `cutoffStr: ${cutoffStr}`,
        `lookback_months (raw input): ${lookback_months}`,
        `customerMonthRows.length: ${customerMonthRows.length}`,
        `sortedCustomerMonths: ${sortedCustomerMonths.join(", ")}`,
        `momRetentionRates: ${JSON.stringify(momRetentionRates)}`,
        `retentionCohortRows.length: ${retentionCohortRows.length}`,
        `retentionCohortRows: ${JSON.stringify(retentionCohortRows)}`,
        `trueRepeatRate (fabricated-table fallback): ${trueRepeatRate}`,
        `cohortTrueRepeatRate: ${cohortTrueRepeatRate}`,
        `finalTrueRepeatRate: ${finalTrueRepeatRate}`,
        `retentionAvg: ${retentionAvg}`,
        `loyaltyTotal: ${loyaltyTotal}`,
      ].join("\n"),
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
    const stageAgeBenchmarkMap = new Map<number, { p50Nar: number; p50Eng: number }>();
    for (const row of stageAgeBenchmarkRows) {
      if (row.P50_NAR != null) {
        stageAgeBenchmarkMap.set(row.AGE_MONTHS, { p50Nar: row.P50_NAR, p50Eng: row.P50_ENG_PER_100 ?? 0 });
      }
    }
    const newRolloutCandidates: NewRolloutCandidate[] = [];
    if (_msl >= 6) {
      const newCutoffDate = latestCompletedMonth ? new Date(latestCompletedMonth) : new Date();
      newCutoffDate.setMonth(newCutoffDate.getMonth() - 6);
      const newCutoffStr = newCutoffDate.toISOString().slice(0, 10);
      for (const p of propertySnapshot) {
        if (!p.rolloutMonth || p.rolloutMonth <= newCutoffStr) continue;
        const age = Math.max(1, p.monthsLive);
        const bench = stageAgeBenchmarkMap.get(age);
        newRolloutCandidates.push({
          propertyName: p.propertyName,
          propertyState: p.propertyState,
          units: p.units,
          ageMonths: age,
          adoptionRate: p.adoptionRate,
          benchNar: bench?.p50Nar ?? 0,
          observedEngPer100: p.t12EngPer100 ?? 0,
          expectedEngPer100: bench?.p50Eng ?? 0,
          hasMarketingIntegration: p.hasMarketingIntegration,
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

    const html = buildDeckHtml({
      slides: slidesConcatenated,
      pmc_name: displayName,
      report_month: reportMonth,
      report_year: reportYear,
      slide_count: slidesOrdered.length, // actual number of rendered slides
      pdf_filename: pdfFilename,
      extra_js: extraJs,
    });

    // --- Speaker notes (downloaded client-side as a data URI, same pattern as the deck) ---
    let notesHtml: string | undefined;
    try {
      // Same target-NAR cascade renderPortfolioProjection uses above (next real peer tier up
      // from current NAR: P50 -> P75 -> P90 -> P99+2pp), so the notes explain the same number
      // the projection slide actually shows.
      const p25 = narPerc?.p25, p50 = canonicalPeerNarP50 ?? narPerc?.p50, p75 = narPerc?.p75, p90 = narPerc?.p90, p99 = narPerc?.p99;
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
      notesHtml = buildSpeakerNotesHtml(qbrSlideIdSequence, notesKpis, notesMonthly, notesBenchmark);
    } catch (e) {
      console.warn(`[PMC Report] speaker notes generation failed for ${pmc_name}: ${e instanceof Error ? e.message : String(e)}`);
    }

    return { html, empty: false, notes_html: notesHtml };
  },
});
