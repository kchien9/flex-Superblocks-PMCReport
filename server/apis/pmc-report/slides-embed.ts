/**
 * Embed → DI deck slides — Clark mirror of Flask's `generator/slides_embed.py` (ids 70-76; spec:
 * flex-pmc-reports `docs/superpowers/specs/2026-09-10-embed-deck-design.md`).
 *
 * Every renderer takes the one `EmbedCtx` the embed branch of get-pmc-monthly-report.ts builds
 * (Flask's `_generate_embed` ctx dict) and returns { html, js } like every other Clark slide
 * module. Slide 74 (market map) is market-map-slides.ts's renderMarketMap with subjectEmbed - not
 * defined here. Flask is the reference: every user-facing string below is copied from it verbatim.
 */

import type { SlideResult } from "./slide-renderers.js";
import { monthLabel } from "./slide-renderers.js";
import type { EmbedMonthSummary, EmbedProperty, EmbedProjectionRange, GraduationCurve, GraduationCurvePoint, ChannelRepeatRates, NiroSnapshot } from "./embed.js";

// ─── Palette (Flask generator/slides_embed.py) ─────────────────────────────────

const PURPLE = "#8D70EE";
const BRAND_PURPLE = "#6A3DB8";
const NAVY = "#2C194D";
const DARK = "#1D1D1D";
const GRAY = "#6b7280";
const WHITE = "#ffffff";
const EMBED_GREY = "#9ca3af";
/** Faded variants for the thin tails of the graduation curve (slide 72). */
const EMBED_GREY_FADED = "rgba(156,163,175,0.45)";
const BRAND_PURPLE_FADED = "rgba(106,61,184,0.4)";

export const EMBED_DECK_TITLE = "Embed → Direct Integration";
export const EMBED_TODAY_TITLE = "Your embed today";
export const EMBED_GRADUATION_TITLE = "Same properties, before and after DI";
export const EMBED_PROJECTION_TITLE = "What it could be for you";
export const EMBED_VISIBILITY_TITLE = "What you'd see";
export const EMBED_NEXT_STEPS_TITLE = "Next steps";
export const EMBED_COHORT_FOOTNOTE = "Graduation cohort unavailable this run — the range shows the peer floor only.";
export const EMBED_THIN_TAIL_FOOTNOTE = "Dashed segments: fewer switchers have been on embed/DI this long.";

// ─── Helpers (Flask generator/slides.py `_e` / `_fmt_pct` / `_fmt_currency` /
//     `_month_label` / `_bp_month_label` / `_bp_month_explainer`; same copies checkin.ts keeps) ──

/** Python html.escape (quote=True). */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

function fmtPct(v: number): string {
  const s = (v * 100).toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) + "%" : s + "%";
}

/** Python `f"{v:.0%}"`. */
function fmtPct0(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** Python `f"{v:.1%}"`. */
function fmtPct1(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function fmtCurrency(v: number): string {
  const trim = (s: string) => { let t = s.replace(/0+$/, ""); if (t.endsWith(".")) t += "0"; return t; };
  if (v >= 1_000_000_000) return `$${trim((v / 1_000_000_000).toFixed(2))}B`;
  if (v >= 1_000_000) {
    const s = trim((v / 1_000_000).toFixed(2));
    if (s.startsWith("1000")) return "$1.0B";
    return `$${s}M`;
  }
  if (v >= 1_000) {
    const k = Math.round(v / 1_000);
    if (k >= 1000) return "$1.0M";
    return `$${k}K`;
  }
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

/** "September 2026 BP month" (Flask `_bp_month_label`). */
function bpMonthLabel(ym: string): string {
  const full = new Date(ym.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return `${full} BP month`;
}

/** Flask `_bp_month_explainer`. */
function bpMonthExplainer(ym: string): string {
  const d = new Date(ym.slice(0, 10) + "T00:00:00Z");
  const short = d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  const long = d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  return `Months are Flex bill-pay (BP) months. The ${short} BP month covers ${long} rent — activity that closed at the start of ${long}.`;
}

function n(v: number): string {
  return Math.trunc(v).toLocaleString("en-US");
}

// ─── ctx (Flask `_generate_embed`'s one dict; the plan's "Shared contracts") ───

export interface EmbedCtx {
  pmc_name: string;
  msp: string;
  msp_label: string;
  /** Latest completed BP month, YYYY-MM-DD. */
  reporting_month: string;
  property_count: number;
  /** = bills_paid, never charged_users. */
  paying: number;
  bills_paid: number;
  rent_paid: number;
  /** CHARGED_USERS: every Flex customer at these buildings, any channel. */
  flex_customers: number;
  total_units: number;
  units_known: boolean;
  adoption: number;
  monthly: EmbedMonthSummary[];
  floor_rate: number;
  floor_label: string;
  ceiling_rate: number | null;
  cohort: GraduationCurve | null;
  repeat: ChannelRepeatRates | null;
  niro: NiroSnapshot | null;
  avg_rent: number;
  avg_rent_source: "input" | "peer";
  range: EmbedProjectionRange;
  properties: EmbedProperty[];
  property_paying: Record<string, number>;
  property_rent: Record<string, number>;
  lookback_months: number;
}

function fact(label: string, value: string): string {
  return (
    `<div><div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.28);` +
    `margin-bottom:6px;font-family:'ABCDiatype',sans-serif;">${label}</div>` +
    `<div style="font-size:16px;font-weight:600;color:rgba(255,255,255,0.85);font-family:'ABCDiatype',sans-serif;">${value}</div></div>`
  );
}

function tile(label: string, value: string, sub = ""): string {
  const subHtml = sub ? `<div style="font-size:11px;color:${GRAY};margin-top:4px;">${sub}</div>` : "";
  return (
    `<div style="background:#fff;border:1px solid #eceaf2;border-radius:14px;padding:18px 20px;">` +
    `<div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#524e5b;margin-bottom:8px;font-weight:500;">${label}</div>` +
    `<div style="font-size:30px;font-weight:700;color:${DARK};letter-spacing:-0.02em;">${value}</div>${subHtml}</div>`
  );
}

function header(label: string, title: string, sub = ""): string {
  const subHtml = sub ? `<div class="slide-subtitle">${sub}</div>` : "";
  return `<div class="slide-header"><div class="slide-label">${label}</div><div class="slide-title">${title}</div>${subHtml}</div>`;
}

/** "x.x% of your {total_units:,} units" - portfolio-level adoption (spec slide 71). */
function unitsPhrase(ctx: EmbedCtx): string {
  return `${fmtPct(ctx.adoption)} of your ${n(ctx.total_units)} units`;
}

// ─── 70 cover ──────────────────────────────────────────────────────────────────

export function renderEmbedCover(slideId: number, ctx: EmbedCtx): SlideResult {
  const rpt = ctx.reporting_month;
  const headline = `Flex is already working at ${ctx.pmc_name}. Here's what it looks like turned all the way on.`;
  const sub = `${ctx.msp_label} embed · ${n(ctx.property_count)} properties · ${n(ctx.paying)} residents paying in ${monthLabel(rpt)} BP`;
  const html = `
  <div class="slide" id="slide-${slideId}" style="background:${NAVY};justify-content:center;align-items:flex-start;">
    <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#DDC6F9;margin-bottom:20px;font-weight:600;font-family:'ABCDiatype',sans-serif;">${EMBED_DECK_TITLE}</div>
    <div style="font-size:44px;font-weight:500;line-height:1.1;color:#fff;margin-bottom:18px;letter-spacing:-0.02em;max-width:1040px;font-family:'ABCDiatype',sans-serif;">${esc(headline)}</div>
    <div style="font-size:20px;font-weight:400;line-height:1.35;color:rgba(255,255,255,0.7);margin-bottom:52px;font-family:'ABCDiatype',sans-serif;">${esc(sub)}</div>
    <div style="display:flex;gap:52px;flex-wrap:wrap;">
      ${fact("Embed properties", n(ctx.property_count))}
      ${fact("Residents paying", n(ctx.paying))}
      ${fact("Total units", n(ctx.total_units))}
      ${fact("Reporting month", bpMonthLabel(rpt))}
    </div>
    <div style="position:absolute;bottom:60px;left:80px;font-size:11px;color:rgba(255,255,255,0.35);font-family:'ABCDiatype',sans-serif;">${bpMonthLabel(rpt)} · Embed = residents who found Flex inside ${esc(ctx.msp_label)} on their own · DI = direct integration</div>
    <div style="position:absolute;right:100px;top:50%;transform:translateY(-50%);width:380px;height:380px;border-radius:50%;background:radial-gradient(circle,rgba(106,61,184,0.22) 0%,transparent 68%);"></div>
    <div style="position:absolute;bottom:60px;right:80px;font-size:28px;font-weight:500;letter-spacing:-0.04em;color:rgba(255,255,255,0.15);font-family:'ABCDiatype',sans-serif;">flex</div>
  </div>`;
  return { html, js: "" };
}

// ─── 71 your embed today ───────────────────────────────────────────────────────

export function renderEmbedToday(slideId: number, ctx: EmbedCtx): SlideResult {
  const monthly = ctx.monthly;
  const labels = monthly.map((m) => monthLabel(m.bp_month));
  // Solid line / first tile = residents paying through the embed (BILLS_PAID - one bill per
  // resident per BP month, the basis every adoption rate in this tool uses). Dashed line / third
  // tile = CHARGED_USERS: every Flex customer at these buildings, any channel, incl. residents who
  // found Flex directly - always >= the embed count, never called "paying".
  const bills = monthly.map((m) => Math.trunc(m.bills_paid));
  const customers = monthly.map((m) => Math.trunc(m.charged_users));
  const flexCustomers = Math.trunc(ctx.flex_customers || 0);
  const tiles =
    tile("Paying residents", n(ctx.paying), esc(unitsPhrase(ctx)))
    + tile("Properties live", n(ctx.property_count), `via ${esc(ctx.msp_label)} embed`)
    + tile("All Flex customers here", n(flexCustomers), "any channel, incl. residents who found Flex directly")
    + tile("Rent paid", fmtCurrency(ctx.rent_paid), "through Flex this month");
  const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;">
    ${header("TODAY", EMBED_TODAY_TITLE, `Residents at your ${esc(ctx.msp_label)} properties already split rent with Flex — without an integration or any marketing.`)}
    <div style="display:flex;gap:28px;flex:1;min-height:0;">
      <div style="width:300px;flex-shrink:0;display:grid;grid-template-columns:1fr;gap:12px;align-content:start;">${tiles}</div>
      <div style="flex:1;position:relative;min-height:240px;"><canvas id="chart${slideId}"></canvas></div>
    </div>
    <div style="font-size:11px;color:#a09cb0;margin-top:10px;line-height:1.5;">${esc(bpMonthExplainer(ctx.reporting_month))} Adoption is portfolio-level: paying residents ÷ your total units.</div>
  </div>`;
  const js = `
<script>
window['initSlide${slideId}'] = (function() {
  let done = false;
  return function() {
    if (done) return; done = true;
    new Chart(document.getElementById('chart${slideId}'), {
      type: 'line',
      data: { labels: ${JSON.stringify(labels)}, datasets: [
        { label: 'Paying residents (via embed)', data: ${JSON.stringify(bills)}, borderColor: '${BRAND_PURPLE}', backgroundColor: 'rgba(106,61,184,0.12)',
           borderWidth: 3, tension: 0.3, fill: true, pointRadius: 4, pointBackgroundColor: '${BRAND_PURPLE}',
           datalabels: { display: true, align: 'top', color: '${BRAND_PURPLE}', font: { size: 11, weight: '600', family: 'ABCDiatype' } } },
        { label: 'All Flex customers at these properties', data: ${JSON.stringify(customers)}, borderColor: '${EMBED_GREY}', borderDash: [6, 4], borderWidth: 2, tension: 0.3,
           fill: false, pointRadius: 3, pointBackgroundColor: '${EMBED_GREY}', datalabels: { display: false } }
      ] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: true, labels: { color: '#524e5b', font: { size: 12, family: 'ABCDiatype' } } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#524e5b', font: { size: 12, family: 'ABCDiatype' } } },
          y: { grid: { color: '#eceaf2' }, beginAtZero: true, ticks: { color: '#524e5b', font: { size: 12, family: 'ABCDiatype' } } }
        }
      }
    });
  };
})();
</script>`;
  return { html, js };
}

// ─── 72 graduation curve (hero) ────────────────────────────────────────────────

/**
 * True where a rel_month is backed by fewer than half the eligible cohort - both tails thin (few
 * switchers were on embed 6 months before DI; few have been on DI 12 months). Drawn dashed/faded so
 * the eye reads the solid middle as the evidence. Computed from the curve's own `properties`
 * column, never from a fixed offset.
 */
export function thinMask(curve: GraduationCurvePoint[], cohortProps: number): boolean[] {
  const half = 0.5 * (cohortProps || 0);
  return curve.map((p) => p.properties < half);
}

export function renderEmbedGraduation(slideId: number, ctx: EmbedCtx): SlideResult {
  const cohort = ctx.cohort;
  if (!cohort) return { html: "", js: "" };
  const curve = cohort.curve;
  const rel = curve.map((p) => Math.trunc(p.rel_month));
  const adoption = curve.map((p) => Math.round(p.adoption * 100 * 100) / 100);
  const embedSeries = rel.map((r, i) => (r < 0 ? adoption[i] : null));
  const diSeries = rel.map((r, i) => (r >= 0 ? adoption[i] : null));
  const zeroIdx = rel.indexOf(0) >= 0 ? rel.indexOf(0) : 0;
  const thin = thinMask(curve, Math.trunc(cohort.properties || 0));
  const sameMsp = cohort.scope === "same_msp";
  const pmsPhrase = sameMsp ? `${ctx.msp_label} embed` : "a PMS embed";
  const subLine = `${n(cohort.properties)} properties / ${n(cohort.units)} units that were on ${pmsPhrase} like yours `
    + "and switched to a direct integration — same buildings, same residents.";
  const legendScope = sameMsp
    ? `${ctx.msp_label} embed properties only`
    : `All PMS embeds (${ctx.msp_label} cohort under 300 properties)`;
  const pair = `${fmtPct(cohort.before_rate)} → ${fmtPct(cohort.after_rate)}`;
  const thinNote = thin.some(Boolean)
    ? `<div style="font-size:11px;color:#a09cb0;margin-top:8px;line-height:1.5;">${esc(EMBED_THIN_TAIL_FOOTNOTE)}</div>`
    : "";
  const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;">
    ${header("THE EVIDENCE", EMBED_GRADUATION_TITLE, esc(subLine))}
    <div style="display:flex;gap:28px;flex:1;min-height:0;">
      <div style="flex:1;position:relative;min-height:260px;"><canvas id="chart${slideId}"></canvas></div>
      <div style="width:300px;flex-shrink:0;display:flex;flex-direction:column;justify-content:center;">
        <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#524e5b;margin-bottom:8px;font-weight:500;">Adoption, 3 months before → months 4–6 on DI</div>
        <div style="font-size:52px;font-weight:700;color:${BRAND_PURPLE};letter-spacing:-0.03em;line-height:1.05;margin-bottom:14px;">${pair}</div>
        <div style="font-size:13px;color:${GRAY};line-height:1.6;">Grey = on embed · Purple = on a direct integration. Month 0 is the DI go-live BP month.</div>
        <div style="margin-top:18px;font-size:11px;color:#a09cb0;line-height:1.5;">Cohort: ${esc(legendScope)} · ${n(cohort.pmcs)} PMCs · adoption = bills paid ÷ units</div>
      </div>
    </div>
    ${thinNote}
  </div>`;
  const js = `
<script>
window['initSlide${slideId}'] = (function() {
  let done = false;
  return function() {
    if (done) return; done = true;
    const relMonths = ${JSON.stringify(rel)};
    const zeroIdx = ${zeroIdx};
    // thin[i]: rel_month i is backed by < half the cohort -> dashed, faded line + points
    const thin = ${JSON.stringify(thin)};
    const thinSeg = c => thin[c.p0DataIndex] || thin[c.p1DataIndex];
    const seg = (solid, faded) => ({
      borderDash: c => thinSeg(c) ? [6, 4] : undefined,
      borderColor: c => thinSeg(c) ? faded : undefined,
      backgroundColor: c => thinSeg(c) ? 'rgba(0,0,0,0.02)' : undefined
    });
    const pts = (solid, faded) => relMonths.map((_, i) => thin[i] ? faded : solid);
    const marker = { id: '_flexDiMarker${slideId}', afterDraw(chart) {
      const x = chart.scales.x.getPixelForValue(zeroIdx); const y = chart.scales.y;
      const c = chart.ctx; c.save(); c.strokeStyle = '${BRAND_PURPLE}'; c.setLineDash([4, 4]); c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(x, y.top); c.lineTo(x, y.bottom); c.stroke();
      c.fillStyle = '${BRAND_PURPLE}'; c.font = '600 11px ABCDiatype'; c.textAlign = 'center'; c.fillText('DI go-live', x, y.top - 6); c.restore();
    } };
    new Chart(document.getElementById('chart${slideId}'), {
      type: 'line',
      data: { labels: relMonths.map(r => r === 0 ? '0' : (r > 0 ? '+' + r : String(r))), datasets: [
        { label: 'On embed', data: ${JSON.stringify(embedSeries)}, borderColor: '${EMBED_GREY}', backgroundColor: 'rgba(156,163,175,0.15)',
           borderWidth: 3, tension: 0.3, fill: true, pointRadius: 3, spanGaps: false, datalabels: { display: false },
           pointBackgroundColor: pts('${EMBED_GREY}', '${EMBED_GREY_FADED}'), pointBorderColor: pts('${EMBED_GREY}', '${EMBED_GREY_FADED}'),
           segment: seg('${EMBED_GREY}', '${EMBED_GREY_FADED}') },
        { label: 'On a direct integration', data: ${JSON.stringify(diSeries)}, borderColor: '${BRAND_PURPLE}', backgroundColor: 'rgba(106,61,184,0.15)',
           borderWidth: 3, tension: 0.3, fill: true, pointRadius: 3, spanGaps: false, datalabels: { display: false },
           pointBackgroundColor: pts('${BRAND_PURPLE}', '${BRAND_PURPLE_FADED}'), pointBorderColor: pts('${BRAND_PURPLE}', '${BRAND_PURPLE_FADED}'),
           segment: seg('${BRAND_PURPLE}', '${BRAND_PURPLE_FADED}') }
      ] },
      plugins: [marker],
      options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 18 } },
        plugins: { legend: { display: true, labels: { color: '#524e5b', font: { size: 12, family: 'ABCDiatype' } } } },
        scales: {
          x: { title: { display: true, text: 'Months relative to DI go-live', color: '#524e5b' }, grid: { display: false }, ticks: { color: '#524e5b', font: { size: 12, family: 'ABCDiatype' } } },
          y: { grid: { color: '#eceaf2' }, beginAtZero: true, ticks: { color: '#524e5b', font: { size: 12, family: 'ABCDiatype' }, callback: v => v + '%' } }
        }
      }
    });
  };
})();
</script>`;
  return { html, js };
}

// ─── 73 what it could be for you ───────────────────────────────────────────────

function bar(title: string, value: number, pct: number, color: string, track: string, sub: string): string {
  return `
      <div style="margin-bottom:22px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
          <div style="font-size:13px;font-weight:600;color:${DARK};">${title}</div>
          <div style="font-size:24px;font-weight:700;color:${color};">${n(value)}</div>
        </div>
        <div style="background:${track};border-radius:4px;height:12px;width:100%;"><div style="background:${color};border-radius:4px;height:12px;width:${pct.toFixed(1)}%;"></div></div>
        <div style="font-size:11px;color:${GRAY};margin-top:6px;">${sub}</div>
      </div>`;
}

export function renderEmbedProjection(slideId: number, ctx: EmbedCtx): SlideResult {
  const rng = ctx.range;
  const today = Math.trunc(rng.today);
  const floorRes = Math.trunc(rng.floor_residents);
  const ceilingRes = rng.ceiling_residents;
  const barMax = Math.max(today, floorRes, ceilingRes ?? 0, 1);
  const units = Math.trunc(ctx.total_units);
  const floorTitle = "With DI — peer median" + (rng.floor_already_here ? " (already here)" : "");
  let bars = bar("Today via embed", today, (today / barMax) * 100, GRAY, "#e5e7eb",
    `${esc(unitsPhrase(ctx))} &middot; residents find Flex on their own, no marketing push`);
  bars += bar(floorTitle, rng.floor_already_here ? Math.max(floorRes, today) : floorRes,
    (Math.max(floorRes, today) / barMax) * 100, PURPLE, "#ede9fe",
    `${fmtPct(ctx.floor_rate)} adoption &middot; ${n(units)} units &middot; ${esc(ctx.floor_label)}`);
  if (ceilingRes !== null && ceilingRes !== undefined) {
    bars += bar("With DI — what switchers reached", Math.trunc(ceilingRes), (ceilingRes / barMax) * 100, BRAND_PURPLE, "#ddd6fe",
      `${fmtPct(ctx.ceiling_rate ?? 0)} adoption &middot; months 4–6 after switching, same-property cohort`);
  }
  const lo = Math.trunc(rng.floor_gain);
  const hi = Math.trunc(rng.ceiling_gain);
  const rentSrc = ctx.avg_rent_source === "input" ? "your avg rent" : "your avg rent (peer median)";
  let callout: string;
  if (hi > 0) {
    const gainTxt = hi !== lo ? `+${n(lo)} to +${n(hi)}` : `+${n(hi)}`;
    callout = `<div style="font-size:22px;font-weight:700;color:${BRAND_PURPLE};margin-bottom:6px;">`
      + `<strong>${gainTxt} more residents paying through Flex</strong></div>`
      + `<div style="font-size:13px;color:${DARK};">≈ ${fmtCurrency(rng.rent_lo)}–${fmtCurrency(rng.rent_hi)}/mo in rent at ${rentSrc}</div>`;
  } else {
    callout = `<div style="font-size:22px;font-weight:700;color:${BRAND_PURPLE};margin-bottom:6px;">Already ahead of the peer median.</div>`
      + `<div style="font-size:13px;color:${DARK};">Your residents found Flex on their own above the Platinum peer baseline — with a direct integration, that baseline is the floor, not the ceiling.</div>`;
  }
  let lines = "";
  const rep = ctx.repeat;
  if (rep && rep.di !== undefined && rep.di !== null && rep.embed !== undefined && rep.embed !== null) {
    // Backward-looking continuity rate (pullChannelRepeatRates): of this month's payers, the share
    // who also paid last month. Copy fixed by the spec (slide 73) - keep it verbatim.
    lines += `<div style="font-size:12px;color:${GRAY};margin-top:14px;line-height:1.5;">Residents stick: ${fmtPct0(rep.di)} of residents paying `
      + `through a direct integration also paid the month before, vs ${fmtPct0(rep.embed)} on embed.</div>`;
  }
  const niro = ctx.niro;
  if (niro) {
    lines += `<div style="font-size:12px;color:${GRAY};margin-top:6px;line-height:1.5;">You already have ${n(niro.niro_units)} units in network `
      + `without an integration — at ${fmtPct1(niro.niro_rate)}.</div>`;
  }
  if (!ctx.cohort) {
    lines += `<div style="font-size:11px;color:#a09cb0;margin-top:10px;">${esc(EMBED_COHORT_FOOTNOTE)}</div>`;
  }
  const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;">
    ${header("THE OPPORTUNITY", EMBED_PROJECTION_TITLE, "Floor = Platinum peers at your unit count. Ceiling = what the same-property switchers reached. Never below where you already are.")}
    <div style="display:flex;gap:36px;flex:1;min-height:0;">
      <div style="flex:1.2;">${bars}</div>
      <div style="flex:1;display:flex;flex-direction:column;justify-content:center;">
        <div style="background:rgba(141,112,238,0.08);border:1px solid rgba(141,112,238,0.2);border-radius:10px;padding:22px 26px;">${callout}</div>
        ${lines}
      </div>
    </div>
  </div>`;
  return { html, js: "" };
}

// ─── 75 what you'd see ─────────────────────────────────────────────────────────

const DI_STEPS: Record<string, [string, string]> = {
  yardi: ["Toggle DI on in Yardi", "Your Yardi admin enables the Flex integration in Voyager (Flex sends the exact steps)."],
  appfolio: ["Toggle DI on in AppFolio", "Your AppFolio admin turns on the Flex integration under Settings — a few clicks, no development."],
  mri: ["Toggle DI on in MRI", "Your MRI admin enables the Flex integration; Flex confirms the property list."],
  zego: ["Toggle DI on in Zego", "Zego enables the Flex integration on your account; Flex confirms the property list."],
};

export function renderEmbedVisibility(slideId: number, ctx: EmbedCtx): SlideResult {
  const paying = ctx.property_paying ?? {};
  const rent = ctx.property_rent ?? {};
  const ranked = [...ctx.properties]
    .sort((a, b) => {
      const pa = Math.trunc(paying[a.property_public_id] ?? 0);
      const pb = Math.trunc(paying[b.property_public_id] ?? 0);
      if (pa !== pb) return pb - pa;
      return String(a.property_name) < String(b.property_name) ? -1 : String(a.property_name) > String(b.property_name) ? 1 : 0;
    })
    .slice(0, 3);
  let rows = "";
  for (const p of ranked) {
    const cnt = Math.trunc(paying[p.property_public_id] ?? 0);
    const u = p.unit_count;
    const hasUnits = u !== null && u !== undefined && Math.trunc(u) > 0;
    const unitsTxt = hasUnits ? n(u) : "—";
    const adoptTxt = hasUnits ? fmtPct(cnt / Math.trunc(u)) : "—";
    const rentVal = rent[p.property_public_id];
    const rentTxt = rentVal ? fmtCurrency(Number(rentVal)) : "—";
    rows += `<tr><td style="padding:8px 10px;font-size:12px;">${esc(p.property_name)}</td>`
      + `<td style="padding:8px 10px;font-size:12px;text-align:right;">${unitsTxt}</td>`
      + `<td style="padding:8px 10px;font-size:12px;text-align:right;">${n(cnt)}</td>`
      + `<td style="padding:8px 10px;font-size:12px;text-align:right;font-weight:600;color:${BRAND_PURPLE};">${adoptTxt}</td>`
      + `<td style="padding:8px 10px;font-size:12px;text-align:right;">${rentTxt}</td></tr>`;
  }
  const unitsNote = ctx.units_known
    ? `unit counts: from your ${ctx.msp_label} embed list`
    : "unit counts: not available";
  const todayLine = `${ctx.msp_label} embed · ${n(ctx.property_count)} properties · ${unitsNote} · `
    + "resident view: none · Property Hub: —";
  const th = ["Property", "Units", "Paying residents", "Adoption", "Rent this month"]
    .map((c, i) => `<th style="padding:8px 10px;font-size:10px;color:#524e5b;text-transform:uppercase;letter-spacing:0.08em;text-align:${i === 0 ? "left" : "right"};border-bottom:2px solid #eceaf2;">${c}</th>`)
    .join("");
  const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;">
    ${header("VISIBILITY", esc(EMBED_VISIBILITY_TITLE), "Everything on the right is your own data where we have it — the dash is what embed can't show anyone.")}
    <div style="display:flex;gap:28px;flex:1;min-height:0;">
      <div style="flex:1;background:#f7f7f7;border:1px solid #eceaf2;border-radius:14px;padding:24px;">
        <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#524e5b;margin-bottom:12px;font-weight:600;">Today (embed)</div>
        <div style="font-size:14px;color:${DARK};line-height:1.7;">${esc(todayLine)}</div>
        <div style="font-size:12px;color:${GRAY};margin-top:16px;line-height:1.6;">That's the whole view — for you and for us. No per-property signal, no resident outreach, no on-ledger guarantee.</div>
      </div>
      <div style="flex:1.4;background:#fff;border:1px solid #ddd6fe;border-radius:14px;padding:24px;">
        <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:${BRAND_PURPLE};margin-bottom:12px;font-weight:600;">With a direct integration</div>
        <table style="width:100%;border-collapse:collapse;"><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table>
        <div style="font-size:12px;color:${DARK};margin-top:16px;line-height:1.6;">Property Hub: live resident-level visibility, marketing tools, on-ledger rent guarantee</div>
      </div>
    </div>
  </div>`;
  return { html, js: "" };
}

// ─── 76 next steps ─────────────────────────────────────────────────────────────

export function renderEmbedNextSteps(slideId: number, ctx: EmbedCtx): SlideResult {
  const [toggleTitle, toggleDesc] = DI_STEPS[ctx.msp]
    ?? [`Toggle DI on in ${ctx.msp_label}`, "Your PMS admin enables the Flex integration; Flex confirms the property list."];
  const steps: [string, string, string][] = [
    ["01", toggleTitle, toggleDesc],
    ["02", "Confirm the property list", "We already have your embed properties — you confirm unit counts and any additions."],
    ["03", "Turn on resident marketing", "Flex appears in the resident portal and reaches every unit — the step embed can't do."],
    ["04", "Go live", "Properties typically go live within 24–48 hours of completing setup."],
  ];
  let stepsHtml = "";
  steps.forEach(([num, title, desc], i) => {
    const connector = i < steps.length - 1
      ? '<div style="position:absolute;top:26px;left:52%;width:96%;height:2px;background:#e5e0f5;z-index:0;"></div>'
      : "";
    stepsHtml += `
        <div style="flex:1;position:relative;display:flex;flex-direction:column;align-items:flex-start;">
          ${connector}
          <div style="position:relative;z-index:1;width:52px;height:52px;border-radius:50%;background:${PURPLE};display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:#fff;margin-bottom:18px;box-shadow:0 4px 14px rgba(141,112,238,0.35);">${num}</div>
          <div style="font-size:16px;font-weight:700;color:${NAVY};margin-bottom:6px;">${esc(title)}</div>
          <div style="font-size:13px;color:${GRAY};line-height:1.6;padding-right:24px;">${esc(desc)}</div>
        </div>`;
  });
  const html = `
  <div class="slide" id="slide-${slideId}" style="background:${WHITE};padding:56px 64px;">
    <div style="height:100%;display:flex;flex-direction:column;">
    <div style="flex-shrink:0;margin-bottom:56px;">
      <div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:${PURPLE};font-weight:600;margin-bottom:10px;">${esc(EMBED_NEXT_STEPS_TITLE)}</div>
      <div style="font-size:40px;font-weight:700;color:${NAVY};line-height:1.15;letter-spacing:-0.02em;margin-bottom:10px;">${esc(ctx.pmc_name + "'s path to a direct integration.")}</div>
      <div style="font-size:15px;color:${GRAY};">Properties typically go live within 24–48 hours of completing setup. Questions: your Flex account team.</div>
    </div>
    <div style="display:flex;gap:32px;flex:1;align-items:center;">${stepsHtml}</div>
    </div>
  </div>`;
  return { html, js: "" };
}
