/**
 * Adoption Check-in - Clark mirror of Flask's one-slide check-in deck (commit 013c659; spec:
 * flex-pmc-reports docs/superpowers/specs/2026-09-09-adoption-checkin-design.md).
 *
 * "Since our check-in on {date}, you've raised adoption {x} pp - at this pace you'll be at {y}% by
 * {end of next quarter}." Pure functions of the deck's monthly series (get-pmc-monthly-report.ts's
 * monthlyTotals), the check-in BP month, the canonical peer p50/p75 and the projection horizon
 * month. No Snowflake here. User-facing strings are copied from Flask verbatim.
 */

import { monthLabel, previousCalendarQuarter } from "./slide-renderers.js";
import type { SlideResult } from "./slide-renderers.js";

export const CHECKIN_DECK_TITLE = "Adoption check-in";
export const CHECKIN_SLIDE_TITLE = "Adoption since our check-in";
export const CHECKIN_FILL = "rgba(106,61,184,0.18)";
export const CHECKIN_GAP_SUFFIX = "here's the gap to close";
export const CHECKIN_LOOKBACK_MIN = 6;
export const CHECKIN_LOOKBACK_MAX = 24;

// ─── Helpers (Flask generator/slides.py `_fmt_pct` / `_fmt_currency` / `_fmt_pp` / `_e`) ────────

/** Python html.escape (quote=True): also escapes the single quote as &#x27; - Flask's cover /
 * headline markup carries "you&#x27;ve", so this renderer escapes the same way. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

function fmtPct(v: number): string {
  const s = (v * 100).toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) + "%" : s + "%";
}

/** '2.3 pp' / '2 pp' - `v` already in percentage points, sign dropped. */
function fmtPp(v: number): string {
  const s = Math.abs(v).toFixed(1);
  return `${s.endsWith(".0") ? s.slice(0, -2) : s} pp`;
}

/** Flask `_fmt_currency` exactly (same copy as slide-renderers' platinumCurrency). */
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

/** "March 2026" (Flask strftime("%B %Y")). */
function fullMonthLabel(ym: string): string {
  return new Date(ym.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "March 2026 BP month" (Flask `_bp_month_label`). */
function bpMonthLabel(ym: string): string {
  return `${fullMonthLabel(ym)} BP month`;
}

/** Flask `_bp_month_explainer` (same sentence get-pmc-monthly-report.ts's bpMonthExplainer prints
 * on the Exec Summary; that helper is module-private there and importing it here would be a
 * cycle, so the three-line copy lives here). */
function bpMonthExplainer(ym: string): string {
  const d = new Date(ym.slice(0, 10) + "T00:00:00Z");
  const short = d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  const long = d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  return `Months are Flex bill-pay (BP) months. The ${short} BP month covers ${long} rent — activity that closed at the start of ${long}.`;
}

/** year*12 + month for a YYYY-MM(-DD) string. */
function monthIndex(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + m;
}

/** First-of-month YYYY-MM-DD for a month index. */
function monthFromIndex(idx: number): string {
  const y = Math.floor((idx - 1) / 12);
  const m = idx - y * 12;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

function monthKey(ym: string): string {
  return ym.slice(0, 7);
}

/** Python round(x, 1) for the values this deck rounds (half-away-from-zero on the decimal string is
 * close enough here; the rounded value is what every branch below reads, so a +0.04pp month is flat). */
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

// ─── App-side helpers (Flask app.py parse_checkin_month / checkin_lookback / checkin_projection_end) ─

/** `checkin_date` (ISO YYYY-MM-DD, required) -> { month: first-of-month YYYY-MM-DD } or the 400
 * message. The check-in is snapped to the BP month it falls in (calendar month = BP month). */
export function parseCheckinMonth(raw: unknown): { month: string | null; error: string | null } {
  if (typeof raw !== "string" || !raw.trim()) {
    return { month: null, error: "The Check-in deck needs a check-in date (checkin_date, YYYY-MM-DD)." };
  }
  const s = raw.trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return { month: null, error: "checkin_date must be an ISO date (YYYY-MM-DD)." };
  const [, y, mo, d] = m;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (dt.getUTCFullYear() !== Number(y) || dt.getUTCMonth() !== Number(mo) - 1 || dt.getUTCDate() !== Number(d)) {
    return { month: null, error: "checkin_date must be an ISO date (YYYY-MM-DD)." };
  }
  return { month: `${y}-${mo}-01`, error: null };
}

/** Months of history to pull so the series covers check-in - 2 months (the chart's first point).
 * The rows query's window is BP_MONTH >= DATEADD('month', -lookback, CURRENT_DATE()), so the first
 * whole BP month included is (today's month - lookback + 1); covering check-in - 2 therefore needs
 * lookback >= (today's month - check-in month) + 3. Never shrinks the caller's lookback; clamped to
 * [CHECKIN_LOOKBACK_MIN, CHECKIN_LOOKBACK_MAX]. */
export function checkinLookback(checkinMonth: string, requested: number, today: Date = new Date()): number {
  const todayIdx = today.getFullYear() * 12 + (today.getMonth() + 1);
  const needed = todayIdx - monthIndex(checkinMonth) + 3;
  return Math.min(CHECKIN_LOOKBACK_MAX, Math.max(CHECKIN_LOOKBACK_MIN, Math.trunc(requested || 0), needed));
}

/** Last month of the NEXT calendar quarter relative to the reporting month - previousCalendarQuarter
 * (the quarter toggle's helper) gives the latest quarter completed as of the reporting month, so its
 * `end` + 3 months is the next quarter's last month. Sep 2026 -> Dec 2026; Aug 2026 -> Sep 2026;
 * Dec 2026 -> Mar 2027. */
export function checkinProjectionEnd(reportingMonth: string): string {
  const q = previousCalendarQuarter(reportingMonth);
  return monthFromIndex(monthIndex(q.end) + 3);
}

// ─── The math (Flask checkin_summary) ───────────────────────────────────────────────────────────

/** The subset of the per-month totals the check-in reads. */
export interface CheckinMonthlyRow {
  month: string;
  billsPaid: number;
  units: number;
  rentPaid: number;
  adoptionRate: number;
}

export interface CheckinProjection {
  /** First-of-month YYYY-MM-DD of the horizon month. */
  month: string;
  monthsAhead: number;
  rawPct: number;
  valuePct: number;
  capPct: number | null;
  capped: boolean;
  /** "At this pace: ~14% by Sep 2026" */
  label: string;
}

export interface CheckinSummary {
  /** The chart window: (check-in - 2 months) through the reporting month. */
  window: CheckinMonthlyRow[];
  iCheckin: number;
  iLatest: number;
  checkinMonth: string;
  latestMonth: string;
  checkinPct: number;
  latestPct: number;
  /** Rounded to 1dp FIRST; every branch reads this. */
  deltaPp: number;
  rising: boolean;
  monthsElapsed: number;
  slopePpPerMonth: number;
  checkinResidents: number;
  latestResidents: number;
  residentsDelta: number;
  rentDelta: number;
  headline: string;
  subLine: string;
  projection: CheckinProjection | null;
}

/**
 * Flask `checkin_summary`: the check-in math, once, for the slide, the cover subtitle, the speaker
 * notes and the response. `monthly` is the deck's per-month series whose last row IS the reporting
 * month; `checkinMonth` a YYYY-MM(-DD) in the check-in BP month; `projectionEndMonth` the last
 * month of the NEXT calendar quarter (checkinProjectionEnd); `peerP75` the canonical peer p75 as a
 * 0-1 rate (null = no cap). Throws when the check-in month is absent or is the latest month - the
 * caller gates both with a message before calling.
 *
 * deltaPp is rounded to 1dp FIRST and every branch reads that rounded value, so a +0.04pp month is
 * "flat" (no wedge, no projection) and the headline can never print "0.0 pp". The projection holds
 * the observed slope (latest - checkin) / monthsElapsed for the months to projectionEndMonth; when
 * peerP75 exists the value is capped at max(p75, latest) - never past what the top quarter of
 * comparable PMCs achieve, never below where the subject already is.
 */
export function checkinSummary(
  monthly: CheckinMonthlyRow[],
  checkinMonth: string,
  projectionEndMonth?: string | null,
  peerP75?: number | null,
): CheckinSummary {
  const keys = monthly.map((m) => monthKey(m.month));
  const ck = monthKey(checkinMonth);
  let iCk = keys.indexOf(ck);
  if (iCk < 0) throw new Error(`check-in month ${ck} not in monthly series`);
  let iLast = keys.length - 1;
  if (iLast <= iCk) throw new Error("check-in month must precede the reporting month");
  const start = Math.max(0, iCk - 2);
  const window = monthly.slice(start);
  iCk -= start;
  iLast -= start;
  const ckRow = window[iCk];
  const lastRow = window[iLast];
  const ckDate = ckRow.month.slice(0, 10);
  const lastDate = lastRow.month.slice(0, 10);

  const a = (ckRow.adoptionRate || 0) * 100;
  const b = (lastRow.adoptionRate || 0) * 100;
  const deltaPp = round1(b - a);
  const rising = deltaPp > 0;
  const monthsElapsed = monthIndex(lastDate) - monthIndex(ckDate);
  const slope = monthsElapsed ? (b - a) / monthsElapsed : 0;
  const residentsDelta = Math.trunc(lastRow.billsPaid || 0) - Math.trunc(ckRow.billsPaid || 0);
  const rentDelta = (lastRow.rentPaid || 0) - (ckRow.rentPaid || 0);
  const ckLabel = monthLabel(ckDate);

  let headline: string;
  if (rising) {
    headline = `Since ${ckLabel}, you've raised adoption ${fmtPp(deltaPp)} — ${fmtPct(a / 100)} → ${fmtPct(b / 100)}.`;
  } else if (deltaPp < 0) {
    headline = `Adoption is down ${fmtPp(deltaPp)} since ${ckLabel} — ${CHECKIN_GAP_SUFFIX}`;
  } else {
    headline = `Adoption is flat since ${ckLabel} — ${CHECKIN_GAP_SUFFIX}`;
  }
  const resWord = residentsDelta >= 0 ? "more" : "fewer";
  const rentWord = rentDelta >= 0 ? "more" : "less";
  const subLine = `${Math.abs(residentsDelta).toLocaleString("en-US")} ${resWord} residents paying than at check-in · `
    + `${fmtCurrency(Math.abs(rentDelta))} ${rentWord} rent last month`;

  let projection: CheckinProjection | null = null;
  if (rising && projectionEndMonth) {
    const h = monthIndex(projectionEndMonth) - monthIndex(lastDate);
    if (h > 0) {
      const raw = b + slope * h;
      let cap: number | null = null;
      if (peerP75 != null && peerP75 > 0) cap = Math.max(peerP75 * 100, b);
      const value = cap != null ? Math.min(raw, cap) : raw;
      const endDate = monthFromIndex(monthIndex(projectionEndMonth));
      projection = {
        month: endDate,
        monthsAhead: h,
        rawPct: round1(raw),
        valuePct: round1(value),
        capPct: cap != null ? round1(cap) : null,
        capped: cap != null && raw > cap,
        label: `At this pace: ~${fmtPct(value / 100)} by ${monthLabel(endDate)}`,
      };
    }
  }

  return {
    window, iCheckin: iCk, iLatest: iLast,
    checkinMonth: ckDate, latestMonth: lastDate,
    checkinPct: a, latestPct: b, deltaPp, rising,
    monthsElapsed, slopePpPerMonth: slope,
    checkinResidents: Math.trunc(ckRow.billsPaid || 0), latestResidents: Math.trunc(lastRow.billsPaid || 0),
    residentsDelta, rentDelta,
    headline, subLine, projection,
  };
}

// ─── Renderers (Flask render_adoption_checkin / render_checkin_cover / _checkin_tile) ───────────

/** Exec Summary's small-tile look; `emphasized` = the peer tile in the flat-or-down case (spec:
 * "the peer tile is emphasized"). */
function checkinTile(label: string, value: string, sublabel = "", emphasized = false): string {
  const box = emphasized
    ? "border:2px solid #6A3DB8;background:#f3efff;"
    : "border:2px solid transparent;background:#f8f7ff;";
  const sub = sublabel
    ? `<div style="font-size:11px;color:#6b7280;font-weight:500;margin-top:6px;">${sublabel}</div>`
    : "";
  return `<div style="padding:16px 18px 14px;border-radius:10px;${box}display:flex;flex-direction:column;">`
    + `<div style="font-size:12px;color:#2d2550;font-weight:700;margin-bottom:8px;">${label}</div>`
    + `<div style="font-size:28px;font-weight:700;color:#1a1040;letter-spacing:-0.03em;line-height:1;">${value}</div>`
    + `${sub}</div>`;
}

export interface CheckinBenchmark {
  /** Canonical peer p50 / p75 as 0-1 rates (the same values every other deck's benchmark prints). */
  p50Nar?: number | null;
  p75Nar?: number | null;
  /** The locked cohort's criteria string ("comparable PMCs · ..."). */
  criteria?: string | null;
}

/**
 * Flask render_adoption_checkin - "Adoption since our check-in". Adoption-rate line from (check-in
 * - 2 months) through the reporting month; the area between the line and the check-in level, from
 * the check-in month to the latest, filled Flex purple (its own dataset, so the wedge reads as a
 * right triangle: base = months elapsed, height = pp gained); a vertical marker + label at the
 * check-in month (inline Chart.js plugin); datalabels on the check-in and latest points only; a
 * dashed projection from the latest point to `projectionEndMonth` at the observed slope, capped at
 * the canonical peer p75. Three tiles: adoption / paying residents at check-in -> now, peer median
 * now (canonical p50). Delta <= 0: no fill, no projection, neutral headline, peer tile emphasized.
 */
export function renderAdoptionCheckin(
  slideId: number,
  monthly: CheckinMonthlyRow[],
  checkinMonth: string,
  benchmark: CheckinBenchmark | null | undefined,
  projectionEndMonth: string | null | undefined,
): SlideResult {
  const peerP50 = benchmark?.p50Nar ?? null;
  const peerP75 = benchmark?.p75Nar ?? null;
  const peerCriteria = benchmark?.criteria ?? "";
  const s = checkinSummary(monthly, checkinMonth, projectionEndMonth, peerP75);
  const { window, iCheckin: iCk, iLatest: iLast, projection: proj } = s;

  const labels = window.map((m) => monthLabel(m.month));
  const actual: (number | null)[] = window.map((m) => round1((m.adoptionRate || 0) * 100));
  const wedge: (number | null)[] = actual.map((v, i) => (s.rising && iCk <= i && i <= iLast ? v : null));
  let projVals: (number | null)[] = [];
  if (proj) {
    for (let k = 1; k <= proj.monthsAhead; k++) labels.push(monthLabel(monthFromIndex(monthIndex(s.latestMonth) + k)));
    const nTotal = labels.length;
    for (let k = 0; k < proj.monthsAhead; k++) { actual.push(null); wedge.push(null); }
    projVals = new Array<number | null>(nTotal).fill(null);
    projVals[iLast] = actual[iLast];
    projVals[nTotal - 1] = proj.valuePct;
  }
  const iProjEnd = labels.length - 1;

  const pts = [...actual.filter((v): v is number => v != null), s.checkinPct];
  if (proj) pts.push(proj.valuePct);
  const yMin = Math.max(0, Math.floor(Math.min(...pts)) - 1);
  const yMax = Math.floor(Math.max(...pts)) + 2;

  const ckBp = `${monthLabel(s.checkinMonth)} BP`;
  const rptBp = `${monthLabel(s.latestMonth)} BP`;
  const markerLabel = `Check-in · ${ckBp}`;
  const sign = s.deltaPp > 0 ? "+" : s.deltaPp < 0 ? "−" : "±";
  const resSign = s.residentsDelta > 0 ? "+" : s.residentsDelta < 0 ? "−" : "±";

  let peerValue: string;
  let peerSub: string;
  if (peerP50) {
    const gap = s.latestPct - peerP50 * 100;
    const where = gap > 0.05 ? "above" : gap < -0.05 ? "below" : "at";
    peerValue = fmtPct(peerP50);
    peerSub = (peerCriteria ? `${esc(peerCriteria)} · ` : "")
      + (where !== "at" ? `you're ${fmtPp(gap)} ${where} it` : "you're at the median");
  } else {
    peerValue = "—";
    peerSub = "No comparable peer pool at this size";
  }
  const tiles =
    checkinTile("Adoption at check-in → now", `${fmtPct(s.checkinPct / 100)} → ${fmtPct(s.latestPct / 100)}`,
      `${ckBp} → ${rptBp} · ${sign}${fmtPp(s.deltaPp)}`)
    + checkinTile("Paying residents at check-in → now", `${s.checkinResidents.toLocaleString("en-US")} → ${s.latestResidents.toLocaleString("en-US")}`,
      `${resSign}${Math.abs(s.residentsDelta).toLocaleString("en-US")} residents`)
    + checkinTile("Peer median now", peerValue, peerSub, !s.rising);

  let method: string;
  if (proj) {
    const capNote = proj.capped ? `, capped at the peer 75th percentile (${fmtPct((proj.capPct ?? 0) / 100)})` : "";
    const slopeStr = `${s.slopePpPerMonth >= 0 ? "+" : "-"}${Math.abs(s.slopePpPerMonth).toFixed(2)}`;
    method = `Projection holds the observed pace (${slopeStr} pp per month, ${ckBp} → ${rptBp}) `
      + `for ${proj.monthsAhead} more months to ${monthLabel(proj.month)}${capNote}. `;
  } else if (s.rising) {
    method = "";
  } else {
    method = "No projection — adoption has not risen since the check-in. ";
  }
  const footnote = `${method}Adoption = residents paying ÷ units in network, per BP month. ${bpMonthExplainer(s.latestMonth)}`;

  const legendItems: [string, string][] = [
    ['<span style="display:inline-block;width:26px;height:3px;background:#8D70EE;border-radius:2px;"></span>', "Adoption rate"],
  ];
  if (s.rising) {
    legendItems.push([`<span style="display:inline-block;width:26px;height:12px;background:${CHECKIN_FILL};border-radius:2px;"></span>`, "Gained since check-in"]);
  }
  if (proj) {
    legendItems.push(['<span style="display:inline-block;width:28px;height:0;border-top:2px dashed rgba(106,61,184,0.7);"></span>', "At this pace"]);
  }
  const legendOverlay =
    '<div style="position:absolute;top:10px;left:0;right:0;z-index:5;display:flex;justify-content:center;gap:24px;'
    + 'align-items:center;pointer-events:none;flex-wrap:wrap;">'
    + legendItems.map(([sw, lb]) => `<span style="display:flex;align-items:center;gap:7px;">${sw}<span style="font-size:13px;color:#524e5b;">${lb}</span></span>`).join("")
    + "</div>";

  const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;flex-direction:column;padding:36px 56px 28px;overflow:hidden;">
    <div style="flex-shrink:0;margin-bottom:10px;">
      <div class="slide-label" style="font-size:9px;letter-spacing:0.18em;text-transform:uppercase;color:#6A3DB8;font-weight:600;margin-bottom:10px;">${CHECKIN_SLIDE_TITLE.toUpperCase()}</div>
      <div class="slide-title" style="font-size:28px;font-weight:700;color:#1d1d1d;line-height:1.15;letter-spacing:-0.02em;margin-bottom:6px;">${esc(s.headline)}</div>
      <div style="font-size:13px;color:#6b7280;line-height:1.5;">${esc(s.subLine)}</div>
    </div>
    <div class="chart-wrap" style="position:relative;height:360px;padding:12px;flex-shrink:0;">${legendOverlay}<canvas id="chart${slideId}"></canvas></div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:14px;flex-shrink:0;">${tiles}</div>
    <div style="font-size:10px;color:#a09cb0;line-height:1.5;margin-top:10px;flex-shrink:0;">${footnote}</div>
  </div>`;

  const projLabelJs = proj ? JSON.stringify(["At this pace:", proj.label.split(": ", 2)[1]]) : "null";
  const js = `
window['initSlide${slideId}'] = (function() {
  let done = false;
  return function() {
    if (done) return; done = true;
    const labels = ${JSON.stringify(labels)};
    const actual = ${JSON.stringify(actual)};
    const wedge = ${JSON.stringify(wedge)};
    const proj = ${JSON.stringify(projVals)};
    const iCheckin = ${iCk}, iLatest = ${iLast}, iProjEnd = ${iProjEnd};
    const datasets = [{
      label: 'Adoption rate',
      data: actual,
      borderColor: '#8D70EE',
      backgroundColor: 'transparent',
      fill: false,
      tension: 0.25,
      pointRadius: ctx => (ctx.dataIndex === iCheckin || ctx.dataIndex === iLatest) ? 6 : 3,
      pointBackgroundColor: '#8D70EE',
      pointBorderColor: '#fff',
      pointBorderWidth: 1.5,
      borderWidth: 2.5,
      datalabels: {
        display: ctx => ctx.dataIndex === iCheckin || ctx.dataIndex === iLatest,
        color: '#1D1D1D',
        font: { size: 14, weight: '700', family: 'ABCDiatype' },
        anchor: 'end', align: 'top', offset: 8,
        formatter: v => v != null ? v + '%' : ''
      }
    }];
    if (${s.rising}) {
      datasets.push({
        label: 'Gained since check-in',
        _flexWedge: true,
        data: wedge,
        borderColor: 'transparent',
        borderWidth: 0,
        backgroundColor: '${CHECKIN_FILL}',
        fill: { target: { value: ${Math.round(s.checkinPct * 10000) / 10000} }, above: '${CHECKIN_FILL}', below: 'transparent' },
        tension: 0.25,
        pointRadius: 0, pointHoverRadius: 0,
        datalabels: { display: false }
      });
    }
    if (proj.length) {
      datasets.push({
        label: 'At this pace',
        _flexProj: true,
        data: proj,
        spanGaps: true,
        borderColor: 'rgba(106,61,184,0.7)',
        backgroundColor: 'transparent',
        fill: false,
        tension: 0,
        borderWidth: 2,
        borderDash: [6, 5],
        pointRadius: ctx => ctx.dataIndex === iProjEnd ? 5 : 0,
        pointBackgroundColor: '#fff',
        pointBorderColor: '#6A3DB8',
        pointBorderWidth: 2,
        datalabels: {
          display: ctx => ctx.dataIndex === iProjEnd,
          color: '#6A3DB8',
          font: { size: 12, weight: '700', family: 'ABCDiatype' },
          anchor: 'end', align: 'top', offset: 10, clamp: true, textAlign: 'center',
          formatter: () => ${projLabelJs}
        }
      });
    }
    // Vertical marker + label at the check-in month (no annotation plugin in the deck shell - a
    // tiny inline plugin does the same job).
    const checkinMarker${slideId} = {
      id: 'checkinMarker${slideId}',
      afterDatasetsDraw(chart) {
        const x = chart.scales.x.getPixelForValue(iCheckin);
        const area = chart.chartArea;
        const c = chart.ctx;
        c.save();
        c.strokeStyle = 'rgba(106,61,184,0.55)';
        c.lineWidth = 1.5;
        c.setLineDash([4, 4]);
        c.beginPath(); c.moveTo(x, area.top); c.lineTo(x, area.bottom); c.stroke();
        c.setLineDash([]);
        c.font = "600 12px ABCDiatype, sans-serif";
        c.fillStyle = '#6A3DB8';
        c.textAlign = 'left';
        c.textBaseline = 'top';
        c.fillText(${JSON.stringify(markerLabel)}, x + 6, area.top + 2);
        c.restore();
      }
    };
    const checkinChart${slideId} = new Chart(document.getElementById('chart${slideId}'), {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          datalabels: { display: true },
          tooltip: {
            filter: item => !item.dataset._flexWedge && item.parsed.y != null,
            callbacks: { label: ctx => ctx.dataset.label + ': ' + ctx.parsed.y + '%' }
          }
        },
        layout: { padding: { top: 40, bottom: 10, right: 64, left: 4 } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#524e5b', font: { size: 13, family: 'ABCDiatype' } } },
          y: {
            grid: { color: '#eceaf2' },
            ticks: { color: '#524e5b', font: { size: 13, family: 'ABCDiatype' }, callback: v => v + '%' },
            beginAtZero: false,
            suggestedMin: ${yMin},
            suggestedMax: ${yMax}
          }
        }
      },
      plugins: [checkinMarker${slideId}]
    });
    requestAnimationFrame(() => { checkinChart${slideId}.resize(); });
  };
})();`;
  return { html, js };
}

export interface CheckinCoverKpis {
  pmcName: string;
  reportingMonth: string;
  propertyCount: number;
  totalUnits: number;
}

/** Flask render_checkin_cover. Title "Adoption check-in", subtitle IS the headline sentence
 * (checkinSummary().headline); facts: check-in and reporting BP months, properties, units. Same
 * dark-purple shell as the Platinum cover; the deck footer comes from buildDeckHtml. */
export function renderCheckinCover(slideId: number, kpis: CheckinCoverKpis, headline: string, checkinMonth: string): SlideResult {
  const rpt = kpis.reportingMonth;
  const fact = (label: string, value: string) =>
    `<div><div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.28);`
    + `margin-bottom:6px;font-family:'ABCDiatype',sans-serif;">${label}</div>`
    + `<div style="font-size:16px;font-weight:600;color:rgba(255,255,255,0.85);font-family:'ABCDiatype',sans-serif;">${value}</div></div>`;

  const html = `
  <div class="slide${slideId === 1 ? " active" : ""}" id="slide-${slideId}" style="background:#2C194D;justify-content:center;align-items:flex-start;">
    <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#DDC6F9;margin-bottom:20px;font-weight:600;font-family:'ABCDiatype',sans-serif;">${CHECKIN_DECK_TITLE}</div>
    <div style="font-size:64px;font-weight:500;line-height:1.0;color:#fff;margin-bottom:18px;letter-spacing:-0.02em;font-family:'ABCDiatype',sans-serif;">${esc(kpis.pmcName)}</div>
    <div style="font-size:22px;font-weight:400;line-height:1.35;color:rgba(255,255,255,0.7);margin-bottom:52px;max-width:980px;font-family:'ABCDiatype',sans-serif;">${esc(headline)}</div>
    <div style="display:flex;gap:52px;flex-wrap:wrap;">
      ${fact("Check-in", bpMonthLabel(checkinMonth))}
      ${fact("Reporting month", bpMonthLabel(rpt))}
      ${fact("Properties active", Math.trunc(kpis.propertyCount || 0).toLocaleString("en-US"))}
      ${fact("Units in network", Math.trunc(kpis.totalUnits || 0).toLocaleString("en-US"))}
    </div>
    <div style="position:absolute;bottom:60px;left:80px;font-size:11px;color:rgba(255,255,255,0.35);font-family:'ABCDiatype',sans-serif;">${bpMonthLabel(rpt)} · Adoption = residents paying ÷ units in network</div>
    <div style="position:absolute;right:100px;top:50%;transform:translateY(-50%);width:380px;height:380px;border-radius:50%;background:radial-gradient(circle,rgba(106,61,184,0.22) 0%,transparent 68%);"></div>
    <div style="position:absolute;bottom:60px;right:80px;font-size:28px;font-weight:500;letter-spacing:-0.04em;color:rgba(255,255,255,0.15);font-family:'ABCDiatype',sans-serif;">flex</div>
  </div>`;
  return { html, js: "" };
}
