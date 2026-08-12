/**
 * Prospect-specific slide renderers for New Logo decks.
 * 1:1 port of Flask slides_prospect.py render functions.
 */

import type { SlideResult } from "./slide-renderers.js";
import { STATE_TO_REGION } from "./peer-matching.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const PURPLE = "#8D70EE";
const NAVY = "#2C194D";
const NAVY_CARD = "#2C194D";
const DARK = "#1D1D1D";
const GRAY = "#6b7280";
const WHITE = "#ffffff";

function _e(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function _fmt(v: number, decimals = 0): string {
  const trim = (numeric: string): string => {
    if (decimals > 0 && numeric.includes(".")) {
      return numeric.replace(/0+$/, "").replace(/\.$/, "");
    }
    return numeric;
  };
  if (v >= 1_000_000_000) return `$${trim((v / 1_000_000_000).toFixed(decimals))}B`;
  if (v >= 1_000_000) return `$${trim((v / 1_000_000).toFixed(decimals))}M`;
  if (v >= 1_000) return `$${trim((v / 1_000).toFixed(decimals))}K`;
  return `$${trim(v.toFixed(decimals))}`;
}

function _fmtHero(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${Math.round(v).toLocaleString()}`;
}

function _unitBucket(n: number): string {
  if (n <= 0) return "-";
  if (n < 5000) return "< 5k";
  const rounded = Math.max(Math.round(n / 10_000) * 10_000, 10_000);
  return `~${rounded / 1_000}k`;
}

function _propBucket(n: number): string {
  if (n <= 0) return "-";
  if (n <= 50) return "Under 50";
  return "50+";
}

function _r500(v: number): string {
  if (v <= 0) return "-";
  const rounded = Math.round(v / 500) * 500;
  const k = rounded / 1000;
  return k % 1 !== 0 ? `~$${k.toFixed(1)}K` : `~$${Math.floor(k)}K`;
}

// Stat Toggle JS — shared across all prospect slides
const _STAT_TOGGLE_JS = `
<script>
if (!window.flexSetStatMode) {
  window.flexStatMode = 'median';
  window.flexSetStatMode = function(mode) {
    window.flexStatMode = mode;
    document.querySelectorAll('.stat-toggle-value').forEach(function(el) {
      if (el.dataset[mode] !== undefined) el.textContent = el.dataset[mode];
    });
    document.querySelectorAll('.stat-toggle-label').forEach(function(el) {
      var key = mode + 'Label';
      if (el.dataset[key] !== undefined) el.textContent = el.dataset[key];
    });
    document.querySelectorAll('.stat-toggle-btn').forEach(function(btn) {
      btn.classList.toggle('is-active', btn.dataset.mode === mode);
    });
    document.querySelectorAll('.stat-toggle-group').forEach(function(el) {
      el.style.display = (el.dataset.mode === mode) ? '' : 'none';
    });
  };
}
</script>`;

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface ProspectInfo {
  name: string;
  units: number;
  state: string;
  pms: string;
  segment: string;
  opp_stage: string;
  affordable: boolean;
  asset_subtypes: string[];
  avg_rent: number | null;
  footprint: string;
}

export interface Benchmarks {
  median_nar: number;
  avg_nar: number;
  p25_nar: number;
  p75_nar: number;
  p75_signups: number;
  median_avg_rent: number;
  avg_avg_rent: number;
  median_monthly_rent: number;
  avg_monthly_rent: number;
  pool_size: number;
  footprint: string;
  match_level: string;
  match_mode: string;
  established_only: boolean;
  pms: string;
  affordable: boolean;
  // Single Family portfolio flag — without this, every asset-type label falls back to
  // "Multifamily"/"conventional" regardless of the prospect's real Portfolio Type.
  is_sfr?: boolean;
  prospect_units: number;
  prospect_segment: string;
  prospect_region: string;
  _peer_pmc_names: string[];
  median_signups_pmc?: number;
}

export interface PeerRow {
  total_units: number;
  avg_rent: number;
  current_adoption: number;
  current_monthly_rent: number;
  new_signups: number;
  months_live: number;
  pms: string;
  property_count: number;
  dq_shielded_mo: number;
  primary_state: string;
  state_count: number;
  trend: number[];
  overlap_states?: string;
}

export interface PeerMetrics {
  median_bills_paid: number;
  median_new_signups: number;
  median_rent_paid: number;
  median_retention: number | null;
  property_count: number;
}

export interface TrendRow {
  bp_month: string;
  median_bills_paid: number;
  median_new_signups: number;
  median_rent_paid: number;
  median_retention: number;
  property_count: number;
}

export interface CohortRow {
  loyalty_rate: number;
  months_available: number;
  months_paid: number;
}

export interface RampRow {
  months_since_rollout: number;
  median_nar: number;
  avg_nar: number;
  p25_nar: number;
  p75_nar: number;
  p90_nar: number;
  property_count: number;
}

export interface EmbedData {
  pmc_name: string;
  unit_count: number;
  property_count: number;
  charged_users: number;
  bills_paid: number;
  msp: string;
  bp_month: string;
}

// STATE_TO_REGION imported from peer-matching.ts (single source of truth, matches Flask data.py)

function _statesToRegionLabel(statesStr: string): string {
  if (!statesStr) return "";
  const states = statesStr.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
  const regions: string[] = [];
  for (const s of states) {
    const r = STATE_TO_REGION[s];
    if (r && !regions.includes(r)) regions.push(r);
  }
  return regions.length > 0 ? regions.join(", ") : statesStr;
}

function _footprintLabel(stateCount: number): string {
  if (stateCount <= 1) return "Single-market";
  if (stateCount <= 4) return "Regional";
  if (stateCount <= 9) return "Multi-state";
  return "National";
}

// Simple sparkline SVG
function _sparklineSvg(vals: number[], color = "#1a9e6a", w = 64, h = 20): string {
  if (vals.length < 2) return "";
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const points = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

// ─── Slide: Prospect Cover ──────────────────────────────────────────────────

export function renderProspectCover(
  slideId: number,
  prospect: ProspectInfo,
  benchmarks: Benchmarks,
): SlideResult {
  const name = _e(prospect.name || "");
  const units = prospect.units || 0;
  const affordable = prospect.affordable;
  const assetLbl = affordable ? "Affordable" : (benchmarks.is_sfr ? "Single Family" : "Multifamily");

  const medianNar = benchmarks.median_nar || 0;
  const avgNar = benchmarks.avg_nar || 0;
  const p75Nar = benchmarks.p75_nar || 0;
  const avgRent = prospect.avg_rent || benchmarks.median_avg_rent || 0;

  const projectedResMedian = Math.floor(units * medianNar);
  const projectedResAvg = Math.floor(units * avgNar);
  const projectedResTop = Math.floor(units * p75Nar);
  const monthlyMedian = projectedResMedian * avgRent;
  const monthlyAvg = projectedResAvg * avgRent;
  const monthlyTop = projectedResTop * avgRent;

  const heroMedian = _fmtHero(monthlyMedian);
  const heroAvg = _fmtHero(monthlyAvg);
  const heroTop = _fmtHero(monthlyTop);

  const fpMap: Record<string, string> = {
    national: "National",
    multi: "Multi-state",
    regional: "Regional",
    single: "Single-market",
  };
  const fpRaw = (prospect.footprint || "").toLowerCase();
  const footprintLbl = fpMap[fpRaw] || _e(prospect.state) || "-";

  const footerItems = [
    ["PORTFOLIO", `${units.toLocaleString()} units`],
    ["ASSET CLASS", assetLbl],
    ["FOOTPRINT", footprintLbl],
  ];
  const footerHtml = footerItems.map(([k, v]) =>
    `<div><div style="font-size:9px;font-weight:600;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:5px;">${k}</div><div style="font-size:13px;font-weight:600;color:rgba(255,255,255,0.9);">${_e(v)}</div></div>`
  ).join("");

  const html = `<div class="slide" id="slide-${slideId}"
    style="background:linear-gradient(135deg,${NAVY} 0%,${NAVY_CARD} 100%);color:${WHITE};flex-direction:column;">
  <div style="margin-bottom:36px;">
    <div style="font-size:20px;font-weight:700;color:${WHITE};letter-spacing:-0.02em;">flex</div>
  </div>
  <div style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.45);text-transform:uppercase;letter-spacing:0.12em;margin-bottom:14px;">PREPARED FOR ${name}</div>
  <div style="font-size:108px;font-weight:800;color:${WHITE};line-height:0.88;letter-spacing:-0.03em;margin-bottom:22px;">
    <span class="stat-toggle-value" data-median="${heroMedian}" data-avg="${heroAvg}" data-top="${heroTop}">${heroMedian}</span><span style="font-size:36px;font-weight:400;color:rgba(255,255,255,0.55);margin-left:10px;letter-spacing:0;">&thinsp;/ month in rent guaranteed</span>
  </div>
  <div style="font-size:20px;color:rgba(255,255,255,0.75);line-height:1.65;max-width:680px;">
    At peer adoption rates, your ${units.toLocaleString()} units would have
    <strong class="stat-toggle-value" data-median="${projectedResMedian.toLocaleString()}" data-avg="${projectedResAvg.toLocaleString()}" data-top="${projectedResTop.toLocaleString()}" style="color:${WHITE};">${projectedResMedian.toLocaleString()}</strong> residents paying rent through Flex.
  </div>
  <div style="flex:1;"></div>
  <div style="display:flex;gap:40px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.1);">${footerHtml}</div>
  <div style="position:absolute;bottom:16px;left:64px;right:64px;display:flex;justify-content:space-between;align-items:center;font-size:10px;color:rgba(255,255,255,0.2);">
    <span>Flex &middot; Confidential &middot; <em class="stat-toggle-label" data-median-label="Metrics reflect peer group medians" data-avg-label="Metrics reflect peer group averages" data-top-label="Metrics reflect the top 25% of peers">Metrics reflect peer group medians</em>. Individual results will vary.</span>
  </div>
</div>`;
  return { html, js: _STAT_TOGGLE_JS };
}

// ─── Slide: Embed Activation ────────────────────────────────────────────────

export function renderEmbedActivation(
  slideId: number,
  embedData: EmbedData,
  prospect: ProspectInfo,
  benchmarks: Benchmarks,
): SlideResult {
  const mspLabelMap: Record<string, string> = { yardi: "Yardi", appfolio: "AppFolio", mri: "MRI", zego: "Zego" };
  const mspLabel = mspLabelMap[embedData.msp || ""] || embedData.msp || "";
  const prospectUnits = prospect.units || 0;
  const chargedUsers = embedData.charged_users || 0;
  const unitCount = embedData.unit_count || prospectUnits;
  const propertyCount = embedData.property_count || 0;
  const medianNar = benchmarks.median_nar || 0.10;

  const embedRate = unitCount > 0 ? chargedUsers / unitCount : 0;
  const projected = Math.floor(prospectUnits * medianNar);
  const upside = Math.max(0, projected - chargedUsers);

  const embedRateStr = embedRate > 0 ? `${(embedRate * 100).toFixed(1)}%` : "-";

  function stat(label: string, value: string, sub?: string): string {
    const subHtml = sub ? `<div style="font-size:11px;color:rgba(255,255,255,0.38);margin-top:4px;">${sub}</div>` : "";
    return `<div style="margin-bottom:22px;"><div style="font-size:9px;font-weight:600;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;">${label}</div><div style="font-size:28px;font-weight:700;color:${WHITE};letter-spacing:-0.02em;">${value}</div>${subHtml}</div>`;
  }

  const barMax = Math.max(projected, chargedUsers, 1);
  const embedPct = Math.min(chargedUsers / barMax, 1.0) * 100;
  const projPct = Math.min(projected / barMax, 1.0) * 100;

  const left = `<div style="width:340px;flex-shrink:0;background:${NAVY};padding:48px 36px;display:flex;flex-direction:column;">
    <div style="font-size:10px;font-weight:600;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.12em;margin-bottom:16px;">${_e(mspLabel)} · CURRENT ACTIVITY</div>
    <div style="font-size:22px;font-weight:700;color:${WHITE};line-height:1.25;margin-bottom:10px;">Flex is already working at your properties.</div>
    <div style="font-size:12px;color:rgba(255,255,255,0.55);line-height:1.65;margin-bottom:28px;">${chargedUsers.toLocaleString()} residents split rent through Flex today - through ${_e(mspLabel)}, without a formal integration.</div>
    <div style="flex:1;">
      ${stat("Residents active now", chargedUsers.toLocaleString(), `via ${_e(mspLabel)} embed`)}
      ${stat("Properties live", propertyCount.toLocaleString())}
      ${stat("Current adoption rate", embedRateStr, "of embed portfolio")}
    </div>
    <div style="border-top:1px solid rgba(255,255,255,0.1);padding-top:12px;font-size:10px;color:rgba(255,255,255,0.22);">Flex &middot; Confidential</div>
  </div>`;

  const right = `<div style="flex:1;background:#f8f7ff;padding:52px 56px;display:flex;flex-direction:column;justify-content:center;">
    <div style="font-size:10px;font-weight:600;color:${GRAY};text-transform:uppercase;letter-spacing:0.1em;margin-bottom:36px;">THE OPPORTUNITY: BRING YOUR PORTFOLIO IN</div>
    <div style="margin-bottom:28px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
        <div style="font-size:13px;font-weight:600;color:${DARK};">Today - via ${_e(mspLabel)} Embed (OON)</div>
        <div style="font-size:22px;font-weight:700;color:${GRAY};">${chargedUsers.toLocaleString()}</div>
      </div>
      <div style="background:#e5e7eb;border-radius:4px;height:12px;width:100%;"><div style="background:${GRAY};border-radius:4px;height:12px;width:${embedPct.toFixed(1)}%;"></div></div>
      <div style="font-size:11px;color:${GRAY};margin-top:6px;">${(embedRate * 100).toFixed(1)}% of portfolio &middot; residents find Flex on their own, no marketing push</div>
    </div>
    <div style="margin-bottom:36px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
        <div style="font-size:13px;font-weight:600;color:${DARK};">With full integration - peer median</div>
        <div style="font-size:28px;font-weight:700;color:${PURPLE};">~${projected.toLocaleString()}</div>
      </div>
      <div style="background:#ede9fe;border-radius:4px;height:12px;width:100%;"><div style="background:${PURPLE};border-radius:4px;height:12px;width:${projPct.toFixed(1)}%;"></div></div>
      <div style="font-size:11px;color:${GRAY};margin-top:6px;">${(medianNar * 100).toFixed(1)}% adoption &middot; ${prospectUnits.toLocaleString()} units &middot; based on similar ${_e(mspLabel)} PMCs on Flex</div>
    </div>
    <div style="background:rgba(141,112,238,0.08);border:1px solid rgba(141,112,238,0.2);border-radius:10px;padding:20px 28px;display:flex;align-items:center;gap:24px;">
      <div style="font-size:40px;font-weight:700;color:${PURPLE};flex-shrink:0;">+${upside.toLocaleString()}</div>
      <div style="font-size:13px;color:${DARK};line-height:1.55;">additional residents who could split rent through Flex.<br><span style="color:${GRAY};font-size:11px;">The gap between passive embed discovery and a fully integrated program.</span></div>
    </div>
  </div>`;

  const html = `<div class="slide" id="slide-${slideId}" style="padding:0;background:${WHITE};flex-direction:row;">\n  ${left}\n  ${right}\n</div>`;
  return { html, js: "" };
}

// ─── Slide: Peer Performance (Peer Proof Table) ─────────────────────────────

export function renderPeerPerformance(
  slideId: number,
  benchmarks: Benchmarks,
  metrics: PeerMetrics,
  poolDf: PeerRow[],
): SlideResult {
  const poolSize = benchmarks.pool_size || 0;
  const medianNar = benchmarks.median_nar || 0;
  const avgNar = benchmarks.avg_nar || 0;
  const p75Nar = benchmarks.p75_nar || 0;
  const p75Signups = benchmarks.p75_signups || 0;
  const medianRent = benchmarks.median_monthly_rent || 0;
  const avgRentVal = benchmarks.avg_monthly_rent || 0;
  const affordable = benchmarks.affordable || false;
  const prospectUnits = benchmarks.prospect_units || 0;
  const assetLbl = affordable ? "Affordable" : (benchmarks.is_sfr ? "Single Family" : "Multifamily");
  const isOverlap = benchmarks.match_mode === "overlap";

  // Compute signups/months from pool
  const medianSignups = poolDf.length > 0
    ? poolDf.map(r => r.new_signups).sort((a, b) => a - b)[Math.floor(poolDf.length / 2)]
    : 0;
  const avgSignups = poolDf.length > 0
    ? poolDf.reduce((s, r) => s + r.new_signups, 0) / poolDf.length
    : 0;
  const medianMonths = poolDf.length > 0
    ? poolDf.map(r => r.months_live).sort((a, b) => a - b)[Math.floor(poolDf.length / 2)]
    : 0;
  const avgMonths = poolDf.length > 0
    ? poolDf.reduce((s, r) => s + r.months_live, 0) / poolDf.length
    : 0;

  const signupStr = (v: number) => v >= 1 ? `+${Math.floor(v)}/mo` : "-";
  const monthsStr = (v: number) => v >= 1 ? `${Math.floor(v)} mo` : "-";

  function kpi(medianLabel: string, avgLabel: string, medianValue: string, avgValue: string, sub: string, topLabel?: string, topValue?: string) {
    const effectiveTopValue = topValue ?? avgValue;
    const effectiveTopLabel = topLabel ?? avgLabel;
    return `<div style="flex:1;padding:14px 18px;background:#f8f7ff;border:1px solid #ede9fe;border-radius:10px;">
      <div class="stat-toggle-label" data-median-label="${medianLabel}" data-avg-label="${avgLabel}" data-top-label="${effectiveTopLabel}" style="font-size:9px;font-weight:600;color:${GRAY};text-transform:uppercase;letter-spacing:0.09em;margin-bottom:6px;">${medianLabel}</div>
      <div class="stat-toggle-value" data-median="${medianValue}" data-avg="${avgValue}" data-top="${effectiveTopValue}" style="font-size:26px;font-weight:700;color:${DARK};letter-spacing:-0.02em;">${medianValue}</div>
      <div style="font-size:11px;color:#9ca3af;margin-top:3px;">${sub}</div>
    </div>`;
  }

  const kpisHtml =
    kpi("Peer Median Adoption Rate", "Peer Average Adoption Rate",
      `${(medianNar * 100).toFixed(1)}%`, `${(avgNar * 100).toFixed(1)}%`, "of units paying through Flex",
      "Top 25% of Peers - Adoption Rate", `${(p75Nar * 100).toFixed(1)}%`) +
    kpi("Peer Median Rent Paid / Month", "Peer Average Rent Paid / Month",
      _fmt(medianRent, 0), _fmt(avgRentVal, 0), "total monthly rent volume") +
    kpi("Peer Median New Paying Residents / Month", "Peer Average New Paying Residents / Month",
      signupStr(medianSignups), signupStr(avgSignups), "residents' first-ever payment, per PMC",
      "Top 25% of Peers - New Paying Residents / Month", signupStr(p75Signups)) +
    kpi("Median Time of Flex Partnership", "Average Time of Flex Partnership",
      monthsStr(medianMonths), monthsStr(avgMonths), "months comparable PMCs have been live");

  // Peer table — up to 5 rows closest in size
  let tableRows = "";
  const ref = prospectUnits > 0 ? prospectUnits : (poolDf.length > 0 ? poolDf.map(r => r.total_units).sort((a, b) => a - b)[Math.floor(poolDf.length / 2)] : 1);
  const sorted = [...poolDf].sort((a, b) => Math.abs(a.total_units - ref) - Math.abs(b.total_units - ref));
  // In overlap mode, prefer high-coverage peers, then adoption
  const sample = isOverlap
    ? [...poolDf].sort((a, b) => {
        const covA = (a.overlap_states || "").split(",").filter(Boolean).length;
        const covB = (b.overlap_states || "").split(",").filter(Boolean).length;
        if (covB !== covA) return covB - covA;
        return b.current_adoption - a.current_adoption;
      }).slice(0, 5)
    : (() => {
        // 3-tier size-band narrowing (matches Flask render_peer_performance)
        // Step 1: hard credibility floor — never show a peer more than 10x bigger/smaller than ref
        let candidates = sorted.filter(r => r.total_units >= ref / 10 && r.total_units <= ref * 10);

        // Step 2: try progressively wider size bands, use the tightest one with >= 3 peers
        let selected: PeerRow[] = [];
        for (const mult of [1.5, 2.5]) {
          const filtered = candidates.filter(r => r.total_units >= ref / mult && r.total_units <= ref * mult);
          if (filtered.length >= 3) {
            selected = [...filtered].sort((a, b) => b.current_adoption - a.current_adoption).slice(0, 5);
            break;
          }
        }
        // Step 3: fallback — only reached if even the ±2.5x band had < 3 peers
        if (selected.length === 0) {
          const closestN = Math.min(15, candidates.length);
          const closestBySize = [...candidates].sort((a, b) => Math.abs(a.total_units - ref) - Math.abs(b.total_units - ref)).slice(0, closestN);
          selected = [...closestBySize].sort((a, b) => b.current_adoption - a.current_adoption).slice(0, 5);
        }
        return selected;
      })();

  let anyDeclining = false;
  sample.forEach((row, idx) => {
    const adoption = row.current_adoption;
    const unitsR = row.total_units;
    const rentR = row.current_monthly_rent;
    const signupsR = row.new_signups;
    const monthsR = row.months_live;
    const dqR = row.dq_shielded_mo || 0;
    const avgRentR = row.avg_rent || 0;
    const propCount = row.property_count || 0;
    const stateCnt = row.state_count || 1;
    const footprintL = isOverlap ? _statesToRegionLabel(row.overlap_states || "") : _footprintLabel(stateCnt);
    const code = `PMC ${idx + 1}`;
    const stripe = idx % 2 === 0 ? "background:#fafafa;" : "";
    const dqStr = dqR > 0 ? _fmt(dqR, 0) : "-";

    // Sparkline
    const trendVals = (row.trend || []).filter(v => v != null);
    let sparkCellHtml = '<span style="color:#d1d5db;">-</span>';
    if (trendVals.length >= 2) {
      const declining = trendVals[trendVals.length - 1] < trendVals[0];
      if (declining) anyDeclining = true;
      const sparkColor = declining ? "#dc5050" : "#1a9e6a";
      sparkCellHtml = _sparklineSvg(trendVals, sparkColor, 64, 20);
    }

    tableRows += `<tr style="${stripe}">
      <td style="padding:9px 8px;font-size:12px;font-weight:600;color:${DARK};white-space:nowrap;">${code}</td>
      <td class="markets-col" style="padding:9px 8px;font-size:9.5px;line-height:1.3;color:${GRAY};text-align:center;white-space:normal;word-break:break-word;">${_e(footprintL)}</td>
      <td class="properties-col" style="padding:9px 8px;font-size:11px;color:${GRAY};text-align:center;white-space:nowrap;">${_propBucket(propCount)}</td>
      <td style="padding:9px 8px;font-size:11px;color:${DARK};text-align:right;white-space:nowrap;">${_unitBucket(unitsR)}</td>
      <td style="padding:9px 8px;font-size:11px;color:${GRAY};text-align:right;white-space:nowrap;">${_r500(avgRentR)}</td>
      <td style="padding:9px 8px;font-size:15px;font-weight:700;color:${PURPLE};text-align:right;white-space:nowrap;">${(adoption * 100).toFixed(1)}%</td>
      <td class="trend-col" style="padding:9px 8px;text-align:center;">${sparkCellHtml}</td>
      <td style="padding:9px 8px;font-size:12px;color:${DARK};text-align:right;white-space:nowrap;">${_fmt(rentR, 0)}</td>
      <td style="padding:9px 8px;font-size:12px;color:#6A3DB8;text-align:right;white-space:nowrap;font-weight:600;">${dqStr}</td>
      <td class="new-residents-col" style="padding:9px 8px;font-size:12px;color:${GRAY};text-align:right;white-space:nowrap;">+${signupsR.toLocaleString()}</td>
      <td style="padding:9px 8px;font-size:12px;color:${GRAY};text-align:right;white-space:nowrap;">${monthsR}</td>
    </tr>`;
  });

  const rentHookMedian = medianRent > 0 ? _fmt(medianRent, 0) : "";
  const rentHookAvg = avgRentVal > 0 ? _fmt(avgRentVal, 0) : "";
  const hookTitleMedian = rentHookMedian
    ? `PMCs like yours are pulling ${rentHookMedian}/mo through Flex right now.`
    : "What PMCs like yours are pulling through Flex right now.";
  const hookTitleAvg = rentHookAvg
    ? `PMCs like yours are pulling ${rentHookAvg}/mo through Flex right now, on average.`
    : "What PMCs like yours are pulling through Flex right now, on average.";
  const hookTitleTop = rentHookMedian
    ? `Top 25% of PMCs like yours are pulling even more through Flex.`
    : "What the top 25% of PMCs like yours are pulling through Flex right now.";

  const subtitleText = isOverlap
    ? "Anonymized data from PMCs on Flex with real presence in your markets - adoption, units, and rent shown reflect only their properties there, not their full portfolio."
    : "Anonymized data from PMCs on Flex with comparable portfolios - matched by portfolio size, geographic footprint, and average rent level.";

  const peerToggleButtons = `<div class="presenter-control peer-toggles" style="display:flex;gap:6px;align-items:center;">
    <button class="peer-col-toggle" data-col="hide-trend" data-table="peerTable${slideId}">Hide trend</button>
    <button class="peer-col-toggle" data-col="hide-markets" data-table="peerTable${slideId}">Hide markets</button>
    <button class="peer-col-toggle" data-col="hide-properties" data-table="peerTable${slideId}">Hide properties</button>
    <button class="peer-col-toggle" data-col="hide-new-residents" data-table="peerTable${slideId}">Hide residents</button>
  </div>`;

  const html = `<div class="slide" id="slide-${slideId}" style="background:${WHITE};">
  <style>
    #peerTable${slideId}.hide-trend .trend-col { display: none; }
    #peerTable${slideId}.hide-markets .markets-col { display: none; }
    #peerTable${slideId}.hide-properties .properties-col { display: none; }
    #peerTable${slideId}.hide-new-residents .new-residents-col { display: none; }
  </style>
  <div style="margin-bottom:12px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
      <div style="font-size:10px;font-weight:600;color:${PURPLE};text-transform:uppercase;letter-spacing:0.12em;">PEER PROOF</div>
      ${peerToggleButtons}
    </div>
    <div class="stat-toggle-label" data-median-label="${hookTitleMedian}" data-avg-label="${hookTitleAvg}" data-top-label="${hookTitleTop}" style="font-size:34px;font-weight:700;color:${DARK};line-height:1.1;margin-bottom:6px;">${hookTitleMedian}</div>
    <div style="font-size:11px;color:${GRAY};line-height:1.5;white-space:nowrap;">${subtitleText} No models - actual Flex data from the last 30 days.</div>
    <div style="font-size:10px;color:#a09cb0;margin-top:2px;">Excludes properties in their first 3 months, so still-ramping rollouts don't understate what an established partnership looks like.</div>
  </div>
  <div style="display:flex;gap:10px;margin-bottom:12px;">${kpisHtml}</div>
  <div style="flex:1;overflow:hidden;">
    <table id="peerTable${slideId}" style="width:100%;height:100%;border-collapse:collapse;font-family:'Lexend',sans-serif;table-layout:fixed;">
      <thead><tr style="border-bottom:2px solid #e5e7eb;">
        <th style="padding:4px 8px;text-align:left;font-size:9px;font-weight:600;color:${GRAY};text-transform:uppercase;letter-spacing:0.08em;">REF</th>
        <th class="markets-col" style="padding:4px 8px;text-align:center;font-size:9px;font-weight:600;color:${GRAY};text-transform:uppercase;">${isOverlap ? "MARKETS" : "GEOGRAPHIC FOOTPRINT"}</th>
        <th class="properties-col" style="padding:4px 8px;text-align:center;font-size:9px;font-weight:600;color:${GRAY};text-transform:uppercase;">PROPERTIES</th>
        <th style="padding:4px 8px;text-align:right;font-size:9px;font-weight:600;color:${GRAY};text-transform:uppercase;">UNITS</th>
        <th style="padding:4px 8px;text-align:right;font-size:9px;font-weight:600;color:${GRAY};text-transform:uppercase;">AVG RENT</th>
        <th style="padding:4px 8px;text-align:right;font-size:9px;font-weight:600;color:${GRAY};text-transform:uppercase;">ADOPTION RATE</th>
        <th class="trend-col" style="padding:4px 8px;text-align:center;font-size:9px;font-weight:600;color:${GRAY};text-transform:uppercase;">ADOPTION TREND</th>
        <th style="padding:4px 8px;text-align:right;font-size:9px;font-weight:600;color:${GRAY};text-transform:uppercase;">MONTHLY RENT PAID</th>
        <th style="padding:4px 8px;text-align:right;font-size:9px;font-weight:600;color:#6A3DB8;text-transform:uppercase;">DELINQUENCY SHIELDED / MO</th>
        <th class="new-residents-col" style="padding:4px 8px;text-align:right;font-size:9px;font-weight:600;color:${GRAY};text-transform:uppercase;">NEW RESIDENTS</th>
        <th style="padding:4px 8px;text-align:right;font-size:9px;font-weight:600;color:${GRAY};text-transform:uppercase;">MO ON FLEX</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>
</div>`;
  return { html, js: _STAT_TOGGLE_JS };
}

// ─── Slide: Peer Repeat Usage (Retention) ───────────────────────────────────

export function renderPeerRepeatUsage(
  slideId: number,
  trendDf: TrendRow[],
  metrics: PeerMetrics,
  benchmarks: Benchmarks,
  cohortDf: CohortRow[],
): SlideResult {
  if (!metrics || !metrics.median_retention) return { html: "", js: "" };

  const retentionPct = Math.min(metrics.median_retention * 100, 99.0);
  const propCount = metrics.property_count || 0;
  const affordable = benchmarks.affordable || false;
  const assetLbl = affordable ? "affordable" : (benchmarks.is_sfr ? "single family" : "conventional");

  // Cohort analysis
  const hasRealCohort = cohortDf && cohortDf.length > 0;
  let perf = 0, high = 0, reg = 0, epis = 0;
  let cohortSubtitle = "";

  if (hasRealCohort) {
    const n = cohortDf.length;
    perf = cohortDf.filter(r => r.loyalty_rate >= 1.0).length / n;
    high = cohortDf.filter(r => r.loyalty_rate >= 0.75 && r.loyalty_rate < 1.0).length / n;
    reg = cohortDf.filter(r => r.loyalty_rate >= 0.50 && r.loyalty_rate < 0.75).length / n;
    epis = cohortDf.filter(r => r.loyalty_rate < 0.50).length / n;
    cohortSubtitle = `Actual resident data - ${n.toLocaleString()} residents across ${benchmarks.pool_size.toLocaleString()} comparable PMCs`;
  } else {
    // Binomial approximation fallback
    const r = Math.max(0.01, Math.min(0.99, retentionPct / 100));
    let pS = 0, hS = 0, rgS = 0, eS = 0;
    function comb(n2: number, k: number): number {
      if (k > n2 || k < 0) return 0;
      if (k === 0 || k === n2) return 1;
      let result = 1;
      for (let i = 0; i < Math.min(k, n2 - k); i++) {
        result = result * (n2 - i) / (i + 1);
      }
      return result;
    }
    for (let m = 2; m <= 12; m++) {
      for (let k = 1; k <= m; k++) {
        const prob = comb(m - 1, k - 1) * Math.pow(r, k - 1) * Math.pow(1 - r, m - k);
        const lr = k / m;
        if (lr >= 1.0) pS += prob;
        else if (lr >= 0.75) hS += prob;
        else if (lr >= 0.50) rgS += prob;
        else eS += prob;
      }
    }
    const n2 = 11.0;
    perf = pS / n2; high = hS / n2; reg = rgS / n2; epis = eS / n2;
    cohortSubtitle = "Modeled from peer median MoM retention · estimated, not individual resident data";
  }

  const tiers = [
    { name: "Perfect ⭐", desc: "every available month", pct: perf, color: "#1a9e6a" },
    { name: "High", desc: "75–99% of months", pct: high, color: "#6A3DB8" },
    { name: "Regular", desc: "50–74% of months", pct: reg, color: "#d97706" },
    { name: "Episodic", desc: "< 50% of months", pct: epis, color: "#a09cb0" },
  ];
  const tierBars = tiers.map(t => {
    const bw = Math.max(2, t.pct * 100);
    const pctLbl = t.pct * 100 < 0.5 ? "< 1%" : `${(t.pct * 100).toFixed(0)}%`;
    return `<div style="display:flex;align-items:center;gap:12px;flex:1;">
      <div style="width:150px;flex-shrink:0;"><div style="font-size:12px;font-weight:600;color:#1d1d1d;">${t.name}</div><div style="font-size:10px;color:#a09cb0;margin-top:1px;">${t.desc}</div></div>
      <div style="flex:1;background:#eceaf2;border-radius:5px;height:10px;overflow:hidden;"><div style="background:${t.color};height:100%;width:${bw.toFixed(0)}%;border-radius:5px;"></div></div>
      <div style="font-size:13px;font-weight:700;color:#1d1d1d;width:44px;text-align:right;">${pctLbl}</div>
    </div>`;
  }).join("");

  const loyaltyTitle = `${(perf * 100).toFixed(0)}% of peer residents use Flex every available month` +
    (epis * 100 >= 0.5 ? ` - ${(epis * 100).toFixed(0)}% use it when they need it.` : ".");

  const leftHtml = `<div style="background:#f7f7f7;border:1px solid #eceaf2;border-radius:12px;padding:16px 20px;display:flex;flex-direction:column;min-height:0;overflow:hidden;">
    <div style="font-size:9px;letter-spacing:0.1em;text-transform:uppercase;color:#524e5b;font-weight:600;margin-bottom:6px;">LOYALTY RATE</div>
    <div style="font-size:15px;font-weight:700;color:#1d1d1d;line-height:1.3;margin-bottom:8px;">${loyaltyTitle}</div>
    <div style="font-size:10px;color:#a09cb0;margin-bottom:12px;">${cohortSubtitle}</div>
    <div style="flex:1;min-height:0;display:flex;flex-direction:column;justify-content:space-around;">${tierBars}</div>
    <div style="font-size:10px;color:#a09cb0;margin-top:8px;font-style:italic;">"Perfect" = paid through Flex every available month after first use (months prior to first payment are excluded).</div>
  </div>`;

  // Right panel: MoM retention chart
  const chartMonths: string[] = [];
  const chartVals: number[] = [];
  if (trendDf.length > 0) {
    const recent = trendDf.filter(r => r.median_retention != null && r.median_retention > 0).slice(-6);
    for (const row of recent) {
      chartMonths.push(row.bp_month.slice(0, 7));
      chartVals.push(Math.round(Math.min(row.median_retention * 100, 99.0) * 10) / 10);
    }
  }

  let chartHtml = "", chartJs = "";
  if (chartMonths.length > 0) {
    const yMin = Math.max(0, Math.floor(Math.min(...chartVals) / 5) * 5 - 5);
    const avgRet = chartVals.reduce((s, v) => s + v, 0) / chartVals.length;
    const avgColor = avgRet >= 80 ? "#1a9e6a" : avgRet >= 65 ? "#d97706" : "#dc5050";
    chartHtml = `<div style="background:#f7f7f7;border:1px solid #eceaf2;border-radius:12px;padding:16px 20px;display:flex;flex-direction:column;min-height:0;overflow:hidden;">
      <div style="font-size:9px;letter-spacing:0.1em;text-transform:uppercase;color:#524e5b;font-weight:600;margin-bottom:6px;">MONTH-OVER-MONTH RETENTION</div>
      <div style="flex-shrink:0;margin-bottom:8px;">
        <div style="font-size:46px;font-weight:400;color:${avgColor};letter-spacing:-0.03em;line-height:1;">${avgRet.toFixed(0)}%</div>
        <div style="font-size:11px;color:#6b7280;margin-top:4px;">peer median · last ${chartVals.length} months</div>
      </div>
      <div style="flex:1;min-height:0;position:relative;overflow:hidden;"><canvas id="pru${slideId}"></canvas></div>
    </div>`;
    chartJs = `<script>
window['initSlide${slideId}'] = (function() {
  let done = false;
  return function() {
    if (done) return; done = true;
    new Chart(document.getElementById('pru${slideId}'), {
      type: 'bar',
      data: { labels: ${JSON.stringify(chartMonths)}, datasets: [{ data: ${JSON.stringify(chartVals)}, backgroundColor: 'rgba(141,112,238,0.75)', borderRadius: 5, datalabels: { anchor: 'end', align: 'end', formatter: v => v.toFixed(0) + '%', color: '#374151', font: { size: 10, weight: '700' } } }] },
      options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 22 } }, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: '#9ca3af', font: { size: 9 } } }, y: { min: ${yMin}, max: 100, grid: { color: '#eceaf2' }, border: { display: false }, ticks: { color: '#9ca3af', font: { size: 9 }, stepSize: 5, callback: v => v + '%' } } } }
    });
  };
})();
</script>`;
  }

  const bottom = leftHtml && chartHtml
    ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;flex:1;min-height:0;overflow:hidden;">${leftHtml}${chartHtml}</div>`
    : chartHtml
    ? `<div style="flex:1;min-height:0;overflow:hidden;margin-top:14px;">${chartHtml}</div>`
    : "";

  const html = `<div class="slide" id="slide-${slideId}" style="background:#fff;justify-content:flex-start;overflow:hidden;">
  <div class="slide-header" style="margin-bottom:12px;flex-shrink:0;">
    <div class="slide-label">Peer Group · Repeat Usage</div>
    <div class="slide-title">Residents use Flex their own way - once they start, most keep coming back.</div>
    <div class="slide-subtitle">Median metrics across ${propCount.toLocaleString()} established ${_e(assetLbl)} properties in the same size tier</div>
  </div>
  ${bottom}
</div>`;
  return { html, js: chartJs };
}

// ─── Slide: Ramp Benchmark ──────────────────────────────────────────────────

export function renderRampBenchmark(
  slideId: number,
  rampDf: RampRow[],
  benchmarks: Benchmarks,
  prospect: ProspectInfo,
  rampSource = "peer",
): SlideResult {
  const poolSize = benchmarks.pool_size || 0;
  const medianNar = benchmarks.median_nar || 0;
  const avgNarVal = benchmarks.avg_nar || 0;
  const p75Nar = benchmarks.p75_nar || 0;
  const avgRent = prospect.avg_rent || benchmarks.median_avg_rent || 0;
  const affordable = benchmarks.affordable || false;
  const assetLbl = affordable ? "affordable" : (benchmarks.is_sfr ? "single family" : "conventional");
  const units = prospect.units || 0;
  const name = _e(prospect.name || "");

  function rampNar(moTarget: number, col: "median_nar" | "avg_nar" | "p75_nar" = "median_nar"): number | null {
    if (rampDf.length === 0) return null;
    const exact = rampDf.find(r => r.months_since_rollout === moTarget);
    if (exact) {
      const v = exact[col];
      return v != null && !isNaN(v) ? v : null;
    }
    // Closest
    const closest = [...rampDf].sort((a, b) => Math.abs(a.months_since_rollout - moTarget) - Math.abs(b.months_since_rollout - moTarget))[0];
    if (closest && Math.abs(closest.months_since_rollout - moTarget) <= 2) {
      const v = closest[col];
      return v != null && !isNaN(v) ? v : null;
    }
    return null;
  }

  const nar12 = rampNar(12) ?? medianNar * 0.50;
  const nar24 = rampNar(24) ?? medianNar * 0.70;
  const year1 = Math.floor(units * nar12) * avgRent * 12;
  const year2 = Math.floor(units * nar24) * avgRent * 12;

  const avgNar12 = rampNar(12, "avg_nar") ?? (avgNarVal ? avgNarVal * 0.50 : nar12);
  const avgNar24 = rampNar(24, "avg_nar") ?? (avgNarVal ? avgNarVal * 0.70 : nar24);
  const avgYear1 = Math.floor(units * avgNar12) * avgRent * 12;
  const avgYear2 = Math.floor(units * avgNar24) * avgRent * 12;

  const topNar12 = rampNar(12, "p75_nar") ?? (p75Nar ? p75Nar * 0.50 : nar12);
  const topNar24 = rampNar(24, "p75_nar") ?? (p75Nar ? p75Nar * 0.70 : nar24);
  const topYear1 = Math.floor(units * topNar12) * avgRent * 12;
  const topYear2 = Math.floor(units * topNar24) * avgRent * 12;

  // Milestones
  const milestoneColors: Record<number, string> = { 3: "#a78bfa", 6: "#7c3aed", 12: "#5b21b6", 24: "#3730a3" };
  function milestone(mo: number, label: string): string {
    if (rampDf.length === 0) return "";
    const row = rampDf.find(r => r.months_since_rollout === mo)
      || rampDf.reduce((best, r) => Math.abs(r.months_since_rollout - mo) < Math.abs(best.months_since_rollout - mo) ? r : best, rampDf[0]);
    if (Math.abs(row.months_since_rollout - mo) > 2) return "";
    const nar = row.median_nar;
    const res = Math.floor(units * nar);
    const rentMo = res * avgRent;
    const col = milestoneColors[mo] || PURPLE;
    const avgV = row.avg_nar != null ? row.avg_nar : nar;
    const avgRes = Math.floor(units * avgV);
    const avgRentMo = avgRes * avgRent;
    const topV = row.p75_nar != null ? row.p75_nar : nar;
    const topRes = Math.floor(units * topV);
    const topRentMo = topRes * avgRent;
    return `<div style="flex:1;padding:16px 16px;background:#f9f8ff;border-top:3px solid ${col};border-radius:0 0 8px 8px;display:flex;flex-direction:column;justify-content:space-between;">
      <div style="font-size:11px;font-weight:600;color:${GRAY};text-transform:uppercase;letter-spacing:0.08em;">${label}</div>
      <div class="stat-toggle-value" data-median="${_fmt(rentMo, 1)}/mo" data-avg="${_fmt(avgRentMo, 1)}/mo" data-top="${_fmt(topRentMo, 1)}/mo" style="font-size:30px;font-weight:700;color:${col};letter-spacing:-0.03em;line-height:1;">${_fmt(rentMo, 1)}/mo<span style="display:block;font-size:13px;font-weight:400;color:#6b7280;margin-top:2px;">in rent</span></div>
      <div class="stat-toggle-label" data-median-label="${res.toLocaleString()} residents · ${(nar * 100).toFixed(1)}% adoption" data-avg-label="${avgRes.toLocaleString()} residents · ${(avgV * 100).toFixed(1)}% adoption" data-top-label="${topRes.toLocaleString()} residents · ${(topV * 100).toFixed(1)}% adoption" style="font-size:11px;color:#6b7280;">${res.toLocaleString()} residents · ${(nar * 100).toFixed(1)}% adoption</div>
    </div>`;
  }

  const milestones = [3, 6, 12, 24].map((mo, i) => milestone(mo, `MONTH ${mo}`)).join("");

  // SVG ramp curve — with stat-toggle-group mode switching (median/avg/top lines)
  const svgW = 680, svgH = 340;
  const PAD_L = 44, PAD_R = 16, PAD_T = 12, PAD_B = 32;
  const chartW = svgW - PAD_L - PAD_R;
  const chartH = svgH - PAD_T - PAD_B;
  let rampSvg = "";
  if (rampDf.length >= 2) {
    const maxMo = Math.max(...rampDf.map(r => r.months_since_rollout));
    const maxSeriesVal = Math.max(...rampDf.map(r => Math.max(r.median_nar, r.p75_nar || 0, r.p90_nar || 0)));
    const maxNar2 = Math.max(maxSeriesVal * 1.12, 0.05);
    const hasAvg = rampDf.some(r => r.avg_nar != null && !isNaN(r.avg_nar));
    const hasP90 = rampDf.some(r => r.p90_nar != null && !isNaN(r.p90_nar));

    const cx = (mo: number) => PAD_L + (mo / Math.max(maxMo, 12)) * chartW;
    const cy = (v: number) => PAD_T + chartH - (Math.min(v, maxNar2) / maxNar2) * chartH;

    // Grid lines + Y-axis tick labels
    const yTicks = [0, 1, 2, 3, 4].map(i => maxNar2 * i / 4);
    const gridLines = yTicks.map(v =>
      `<line x1="${PAD_L}" y1="${cy(v).toFixed(1)}" x2="${svgW - PAD_R}" y2="${cy(v).toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>` +
      `<text x="${PAD_L - 5}" y="${(cy(v) + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#9ca3af">${(v * 100).toFixed(0)}%</text>`
    ).join("");

    // X-axis labels
    const xLabels = [0, 3, 6, 12, 24].filter(m => m <= maxMo).map(m =>
      `<text x="${cx(m).toFixed(1)}" y="${svgH - 4}" text-anchor="middle" font-size="9" fill="#9ca3af">M${m}</text>`
    ).join("");

    // Data lines
    const bandTop = rampDf.map(r => `${cx(r.months_since_rollout).toFixed(1)},${cy(r.p75_nar).toFixed(1)}`).join(" ");
    const bandBot = [...rampDf].reverse().map(r => `${cx(r.months_since_rollout).toFixed(1)},${cy(r.p25_nar).toFixed(1)}`).join(" ");
    const medianPts = rampDf.map(r => `${cx(r.months_since_rollout).toFixed(1)},${cy(r.median_nar).toFixed(1)}`).join(" ");
    const p75Pts = rampDf.map(r => `${cx(r.months_since_rollout).toFixed(1)},${cy(r.p75_nar).toFixed(1)}`).join(" ");
    const avgPts = hasAvg ? rampDf.map(r => `${cx(r.months_since_rollout).toFixed(1)},${cy(r.avg_nar ?? r.median_nar).toFixed(1)}`).join(" ") : "";
    const p90Pts = hasP90 ? rampDf.map(r => `${cx(r.months_since_rollout).toFixed(1)},${cy(r.p90_nar ?? r.p75_nar).toFixed(1)}`).join(" ") : "";

    // Milestone dots generator
    function dots(col: "median_nar" | "avg_nar" | "p75_nar"): string {
      return [3, 6, 12, 24].map(mo => {
        const row2 = rampDf.find(r2 => r2.months_since_rollout === mo);
        if (!row2) return "";
        const v = row2[col];
        if (v == null || isNaN(v)) return "";
        const dx = cx(mo), dy = cy(v);
        const mCol = milestoneColors[mo] || PURPLE;
        return `<circle cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="5" fill="${WHITE}" stroke="${mCol}" stroke-width="2.5"/>` +
          `<text x="${dx.toFixed(1)}" y="${Math.max(PAD_T + 10, dy - 10).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="700" fill="${mCol}">${(v * 100).toFixed(1)}%</text>`;
      }).join("");
    }
    const medianDots = dots("median_nar");
    const avgDots = hasAvg ? dots("avg_nar") : "";
    const topDots = dots("p75_nar");

    // Legend with stat-toggle-label
    const legend = `<rect x="${PAD_L}" y="1" width="10" height="6" fill="${PURPLE}" fill-opacity="0.15"/>` +
      `<text x="${PAD_L + 13}" y="8" font-size="8" fill="#9ca3af">Middle 50% of peers</text>` +
      `<line x1="${PAD_L + 115}" y1="4" x2="${PAD_L + 130}" y2="4" stroke="${PURPLE}" stroke-width="2"/>` +
      `<text class="stat-toggle-label" data-median-label="Peer median" data-avg-label="Peer average" data-top-label="Top 25%" x="${PAD_L + 133}" y="8" font-size="8" fill="#9ca3af">Peer median</text>` +
      `<line x1="${PAD_L + 208}" y1="4" x2="${PAD_L + 223}" y2="4" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="4,2"/>` +
      `<text class="stat-toggle-label" data-median-label="Top quartile" data-avg-label="Top quartile" data-top-label="90th percentile" x="${PAD_L + 226}" y="8" font-size="8" fill="#9ca3af">Top quartile</text>`;

    const yAxisLabel = `<text transform="translate(9,${(PAD_T + chartH / 2).toFixed(0)}) rotate(-90)" text-anchor="middle" font-size="9" fill="#9ca3af">Adoption Rate</text>`;

    // Stat-toggle-group line groups: median (default visible), avg (hidden), top (hidden)
    const medianGroup = `<g class="stat-toggle-group" data-mode="median">
      <polyline points="${medianPts}" fill="none" stroke="${PURPLE}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${medianDots}
    </g>`;
    const avgGroup = hasAvg ? `<g class="stat-toggle-group" data-mode="avg" style="display:none;">
      <polyline points="${avgPts}" fill="none" stroke="${PURPLE}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${avgDots}
    </g>` : "";
    const topGroup = `<g class="stat-toggle-group" data-mode="top" style="display:none;">
      <polyline points="${p75Pts}" fill="none" stroke="${PURPLE}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${topDots}
    </g>`;

    // Dashed reference lines: p75 for median/avg mode, p90 for top mode
    const refP75 = `<g class="stat-toggle-group" data-mode="median">
      <polyline points="${p75Pts}" fill="none" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="5,3"/>
    </g>
    <g class="stat-toggle-group" data-mode="avg" style="display:none;">
      <polyline points="${p75Pts}" fill="none" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="5,3"/>
    </g>`;
    const refP90 = hasP90 ? `<g class="stat-toggle-group" data-mode="top" style="display:none;">
      <polyline points="${p90Pts}" fill="none" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="5,3"/>
    </g>` : "";

    rampSvg = `<svg viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg" style="width:100%;display:block;">
      ${gridLines}
      ${legend}
      ${yAxisLabel}
      <polygon points="${bandTop} ${bandBot}" fill="${PURPLE}" fill-opacity="0.10"/>
      ${refP75}
      ${refP90}
      ${medianGroup}
      ${avgGroup}
      ${topGroup}
      ${xLabels}
      <line x1="${PAD_L}" y1="${svgH - PAD_B}" x2="${svgW - PAD_R}" y2="${svgH - PAD_B}" stroke="#e5e7eb" stroke-width="1"/>
    </svg>`;
  }

  const attribution = rampSource === "state"
    ? `${name} · ${rampDf.length > 0 ? Math.max(...rampDf.map(r => r.property_count)).toLocaleString() : "0"} properties across your markets`
    : `${name} · ${poolSize} comparable PMCs`;
  const dollarNote = rampSource === "state"
    ? "Dollar figures: market median adoption rates × your unit count × median rent paid by Flex users in comparable properties. Results will vary."
    : "Dollar figures: peer median adoption rates × your unit count × median rent paid by Flex users in comparable portfolios. Results will vary.";

  const left = `<div style="width:340px;flex-shrink:0;background:${NAVY};padding:44px 36px;display:flex;flex-direction:column;justify-content:space-between;">
    <div>
      <div style="font-size:10px;font-weight:600;color:rgba(255,255,255,0.45);text-transform:uppercase;letter-spacing:0.12em;margin-bottom:12px;">RAMP</div>
      <div style="font-size:28px;font-weight:700;color:${WHITE};line-height:1.15;margin-bottom:14px;">It compounds faster than you'd think.</div>
      <div style="font-size:12px;color:rgba(255,255,255,0.55);line-height:1.6;">Ramp curve from comparable ${_e(assetLbl)} rollouts scaled to ${units.toLocaleString()} units. First 24 months shown.</div>
    </div>
    <div style="border-top:1px solid rgba(255,255,255,0.12);padding-top:16px;display:flex;flex-direction:column;gap:14px;">
      <div>
        <div style="font-size:9px;font-weight:600;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;">YEAR 1 RUN RATE</div>
        <div class="stat-toggle-value" data-median="${_fmt(year1, 1)}/yr" data-avg="${_fmt(avgYear1, 1)}/yr" data-top="${_fmt(topYear1, 1)}/yr" style="font-size:30px;font-weight:800;color:${WHITE};letter-spacing:-0.02em;line-height:1;">${_fmt(year1, 1)}/yr</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:4px;">rent through Flex at the 12-month mark</div>
      </div>
      <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:14px;">
        <div style="font-size:9px;font-weight:600;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;">YEAR 2 RUN RATE</div>
        <div class="stat-toggle-value" data-median="${_fmt(year2, 1)}/yr" data-avg="${_fmt(avgYear2, 1)}/yr" data-top="${_fmt(topYear2, 1)}/yr" style="font-size:30px;font-weight:800;color:#DDC6F9;letter-spacing:-0.02em;line-height:1;">${_fmt(year2, 1)}/yr</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:4px;">rent through Flex at the 24-month mark</div>
      </div>
    </div>
    <div style="font-size:10px;color:rgba(255,255,255,0.2);">Flex · Confidential</div>
  </div>`;

  const right = `<div style="flex:1;padding:36px 40px 28px;display:flex;flex-direction:column;">
    <div style="flex:0 0 340px;">${rampSvg}</div>
    <div style="display:flex;gap:8px;margin-top:10px;flex:1;">${milestones}</div>
    <div style="margin-top:8px;font-size:9px;color:#d1d5db;text-align:right;line-height:1.4;">${attribution}<br><em>${dollarNote}</em></div>
  </div>`;

  const html = `<div class="slide" id="slide-${slideId}" style="padding:0;background:${WHITE};flex-direction:row;">\n  ${left}\n  ${right}\n</div>`;
  return { html, js: _STAT_TOGGLE_JS };
}

// ─── Slide: Flex For Everyone (high_rent) ───────────────────────────────────

export interface RentDistRow {
  rent_bucket: string;
  median_nar: number;
  total_monthly_rent: number;
  total_monthly_users: number;
  property_count: number;
}

export interface HighRentPropertyRow {
  property_state: string;
  property_unit_count: number;
  avg_rent: number;
  avg_monthly_users: number;
  avg_nar: number;
}

/**
 * Render the "Flex For Everyone" slide for non-affordable prospects.
 * Shows rent distribution chart (dual-axis: % of users + total rent/mo) when pool_df has ≥2 buckets,
 * falls back to property cards (top high-rent properties) otherwise.
 * Port of generator/slides.py render_peer_high_rent_adoption.
 */
export function renderFlexForEveryone(
  slideId: number,
  peerHighRentDf: HighRentPropertyRow[],
  rentDistDf: RentDistRow[],
  sourceLabel: "peer" | "network",
): SlideResult {
  // Try chart view first (rent distribution)
  if (rentDistDf.length >= 2) {
    // Compute user share per bucket
    const totalUsers = rentDistDf.reduce((s, r) => s + r.total_monthly_users, 0);
    let dist: { bucket: string; userShare: number; rent: number; propertyCount: number }[];
    if (totalUsers > 0) {
      dist = rentDistDf.map(r => ({
        bucket: r.rent_bucket,
        userShare: (r.total_monthly_users / totalUsers) * 100,
        rent: r.total_monthly_rent,
        propertyCount: r.property_count,
      }));
    } else {
      // Approximate users from rent / bucket midpoint
      function bucketMid(lbl: string): number {
        const nums = (lbl.match(/[\d,]+/g) || []).map(n => parseInt(n.replace(/,/g, ""), 10));
        if (nums.length === 0) return 1500;
        if (lbl.startsWith("Under")) return nums[0] * 0.8;
        if (lbl.endsWith("+")) return nums[0] * 1.125;
        if (nums.length >= 2) return (nums[0] + nums[1]) / 2;
        return nums[0];
      }
      const approxUsers = rentDistDf.map(r => r.total_monthly_rent / Math.max(bucketMid(r.rent_bucket), 1));
      const totalApprox = approxUsers.reduce((s, v) => s + v, 0);
      if (totalApprox <= 0) {
        // Fall through to property cards
        return _renderHighRentCards(slideId, peerHighRentDf);
      }
      dist = rentDistDf.map((r, i) => ({
        bucket: r.rent_bucket,
        userShare: (approxUsers[i] / totalApprox) * 100,
        rent: r.total_monthly_rent,
        propertyCount: r.property_count,
      }));
    }

    // If last bucket isn't open-ended and has a dash, relabel it
    const lastIdx = dist.length - 1;
    if (!dist[lastIdx].bucket.endsWith("+") && dist[lastIdx].bucket.includes("-")) {
      dist[lastIdx].bucket = dist[lastIdx].bucket.split("-")[0] + "+";
    }

    const nB = dist.length;
    const bgColors = JSON.stringify(
      dist.map((_, i) => `rgba(141,112,238,${(0.28 + 0.62 * i / Math.max(nB - 1, 1)).toFixed(2)})`)
    );
    const chartLabels = dist.map(d => d.bucket);
    const chartVals = dist.map(d => Math.round(d.userShare * 10) / 10);
    const rentVals = dist.map(d => d.rent);
    const nProps = dist.reduce((s, d) => s + d.propertyCount, 0);
    const topShare = chartVals[chartVals.length - 1];
    const topLbl = chartLabels[chartLabels.length - 1];
    const chartMax = Math.ceil((Math.max(...chartVals) + 5) / 10) * 10;
    const maxRent = Math.max(...rentVals);
    const rentChartMax = maxRent > 0 ? Math.ceil(maxRent * 1.3 / 25_000) * 25_000 : 100_000;

    const isPeer = sourceLabel === "peer";
    const scopeTag = isPeer ? "PEER GROUP · FLEX IS FOR EVERYONE" : "FLEX IS FOR EVERYONE";
    const scopeSuffix = isPeer
      ? `${nProps.toLocaleString()} PEER-GROUP FLEX PROPERTIES - ACTUAL RENT PAID BY FLEX USERS / MO`
      : `${nProps.toLocaleString()} FLEX PROPERTIES NETWORK-WIDE - ACTUAL RENT PAID BY FLEX USERS / MO`;

    // Dynamic messaging
    const adoptMsg = chartVals[chartVals.length - 1] >= chartVals[0]
      ? `<strong>${topShare.toFixed(0)}% of Flex users across comparable PMCs pay ${_e(topLbl)}/month in rent.</strong> Flex isn't just for rent-burdened residents - usage spans every rent level.`
      : `<strong>${topShare.toFixed(0)}% of Flex users across comparable PMCs pay ${_e(topLbl)}/month in rent</strong> - real volume at the top of the rent range. The timing problem doesn't care what rent costs.`;

    const labelsJs = JSON.stringify(chartLabels);
    const valsJs = JSON.stringify(chartVals);
    const rentJs = JSON.stringify(rentVals);

    const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;">
    <div class="slide-header" style="margin-bottom:8px;flex-shrink:0;">
      <div class="slide-label">${scopeTag}</div>
      <div class="slide-title">Flex users span every rent level - some just use it more.</div>
      <div style="font-size:13px;color:#524e5b;margin-top:4px;">${adoptMsg}</div>
    </div>
    <div style="flex:1;min-height:0;background:#f7f7f7;border:1px solid #eceaf2;border-radius:14px;padding:14px 24px;display:flex;flex-direction:column;overflow:hidden;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-shrink:0;">
        <div style="font-size:11px;font-weight:600;color:#524e5b;text-transform:uppercase;letter-spacing:0.08em;">
          Share of Flex users by rent level - ${scopeSuffix}
        </div>
        <div style="display:flex;gap:14px;font-size:11px;color:#524e5b;">
          <span><span style="display:inline-block;width:10px;height:10px;background:rgba(141,112,238,0.7);border-radius:2px;margin-right:4px;vertical-align:middle;"></span>% of Flex users</span>
          <span><span style="display:inline-block;width:10px;height:10px;background:rgba(26,158,106,0.4);border:1px solid #1a9e6a;border-radius:2px;margin-right:4px;vertical-align:middle;"></span>Total rent / mo</span>
        </div>
      </div>
      <div style="flex:1;min-height:0;position:relative;overflow:hidden;">
        <canvas id="phrchart${slideId}"></canvas>
      </div>
    </div>
  </div>`;

    const js = `<script>
window['initSlide${slideId}'] = (function() {
  let done = false;
  return function() {
    if (done) return; done = true;
    const fmtRent${slideId} = v => {
      if (!v) return '$0';
      return v < 1e6 ? '$' + Math.round(v / 1e3) + 'K' : '$' + (v / 1e6).toFixed(1) + 'M';
    };
    new Chart(document.getElementById('phrchart${slideId}'), {
      type: 'bar',
      data: {
        labels: ${labelsJs},
        datasets: [
          {
            label: '% of Flex users',
            data: ${valsJs},
            backgroundColor: ${bgColors},
            borderColor: '#8D70EE', borderWidth: 1.5, borderRadius: 4, yAxisID: 'y',
            datalabels: { anchor: 'end', align: 'end', formatter: v => v.toFixed(0)+'% of users', color: '#2C194D', font: { size: 14, weight: '700' } }
          },
          {
            label: 'Total rent / mo',
            data: ${rentJs},
            backgroundColor: 'rgba(26,158,106,0.18)',
            borderColor: '#1a9e6a', borderWidth: 1.5, borderRadius: 4, yAxisID: 'y2',
            datalabels: { anchor: 'end', align: 'end', formatter: v => fmtRent${slideId}(v), color: '#1a9e6a', font: { size: 13, weight: '600' } }
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 36, right: 8 } },
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: '#524e5b', font: { size: 12, weight: '600' } } },
          y: { min: 0, max: ${chartMax}, position: 'left', grid: { color: '#f3f4f6' }, border: { display: false },
               ticks: { color: '#9ca3af', font: { size: 10 }, callback: v => v+'%' } },
          y2: { min: 0, max: ${rentChartMax}, position: 'right', grid: { display: false }, border: { display: false },
                ticks: { display: false } }
        }
      }
    });
  };
})();
</script>`;
    return { html, js };
  }

  // Fallback: property cards (when rent distribution has < 2 buckets)
  return _renderHighRentCards(slideId, peerHighRentDf);
}

/** Card-based fallback for Flex For Everyone when distribution data is insufficient. */
function _renderHighRentCards(slideId: number, peerDf: HighRentPropertyRow[]): SlideResult {
  if (!peerDf || peerDf.length < 2) return { html: "", js: "" };

  const topProps = peerDf.slice(0, 6);
  const medRent = Math.round(
    [...topProps].sort((a, b) => a.avg_rent - b.avg_rent)[Math.floor(topProps.length / 2)].avg_rent
  );
  const avgNarPct = topProps.reduce((s, r) => s + r.avg_nar, 0) / topProps.length * 100;

  const cardsHtml = topProps.map(row => {
    const units = row.property_unit_count;
    const avgRentVal = Math.round(row.avg_rent);
    const narPct = row.avg_nar * 100;
    const avgUsers = Math.round(row.avg_monthly_users || 0);
    const state = row.property_state || "-";
    return `
        <div style="background:#fff;border:1px solid #e8e4f5;border-radius:14px;padding:18px 20px;">
          <div style="font-size:9px;letter-spacing:0.12em;text-transform:uppercase;color:#a09cb0;margin-bottom:6px;">Flex Users Pay</div>
          <div style="font-size:34px;font-weight:400;color:#6A3DB8;letter-spacing:-0.02em;line-height:1;font-family:'ABCDiatype',sans-serif;">$${avgRentVal.toLocaleString()}<span style="font-size:13px;color:#a09cb0;font-weight:300;">/mo avg</span></div>
          <div style="font-size:11px;color:#524e5b;margin-top:8px;font-weight:500;">${units.toLocaleString()}-unit property · ${_e(state)}</div>
          <div style="padding-top:8px;border-top:1px solid #f0edff;margin-top:8px;display:flex;align-items:flex-end;justify-content:space-between;">
            <div>
              <div style="font-size:22px;font-weight:600;color:${NAVY};line-height:1;">${narPct.toFixed(0)}%</div>
              <div style="font-size:9px;color:#a09cb0;text-transform:uppercase;letter-spacing:0.08em;margin-top:3px;">Adoption Rate</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:22px;font-weight:600;color:#6A3DB8;line-height:1;">${avgUsers.toLocaleString()}</div>
              <div style="font-size:9px;color:#a09cb0;text-transform:uppercase;letter-spacing:0.08em;margin-top:3px;">Residents/mo</div>
            </div>
          </div>
        </div>`;
  }).join("");

  const nCols = Math.min(topProps.length, 3);
  const gridCols = `repeat(${nCols}, 1fr)`;

  const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;">
    <div class="slide-header" style="margin-bottom:10px;">
      <div class="slide-label">FLEX IS FOR EVERYONE</div>
      <div class="slide-title">Residents at higher-rent properties use Flex too.</div>
      <div style="font-size:13px;color:#524e5b;margin-top:6px;">
        Anonymized peer properties where Flex users pay $${medRent.toLocaleString()}+/mo in rent. ${avgNarPct.toFixed(0)}% avg adoption - showing Flex isn't only for one type of resident.
      </div>
    </div>
    <div style="flex:1;display:flex;align-items:center;padding:8px 0;">
      <div style="display:grid;grid-template-columns:${gridCols};gap:14px;width:100%;">
        ${cardsHtml}
      </div>
    </div>
    <div style="margin-top:8px;background:#2C194D;border-radius:12px;padding:12px 20px;flex-shrink:0;">
      <div style="font-size:12px;color:rgba(255,255,255,0.75);line-height:1.65;">
        Paydays fall before rent due dates regardless of income level. <strong style="color:#DDC6F9;">The timing problem doesn't care how much rent costs.</strong>
      </div>
    </div>
  </div>`;
  return { html, js: "" };
}

/**
 * Static affordable housing impact slide — shown instead of rent distribution
 * for affordable PMCs. Port of generator/slides.py render_affordable_housing_slide.
 */
export function renderAffordableHousingSlide(slideId: number): SlideResult {
  const html = `
  <div class="slide" id="slide-${slideId}" style="background:#f8f7ff;">
    <div class="slide-header" style="margin-bottom:16px;flex-shrink:0;">
      <div class="slide-label">PEER GROUP · RESIDENT OUTCOMES</div>
      <div class="slide-title">Flex works harder in affordable housing.</div>
      <div style="font-size:13px;color:#524e5b;margin-top:5px;">
        From the Flex affordable housing partner study - 40,000+ residents across 200+ affordable properties.
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;flex:1;min-height:0;">
      <div style="background:#fff;border:1px solid #ede9fe;border-radius:14px;padding:28px 32px;display:flex;flex-direction:column;justify-content:space-between;">
        <div style="font-size:16px;font-weight:700;color:#2C194D;margin-bottom:16px;">
          Proven impact for <span style="color:#6A3DB8;">residents</span>
        </div>
        <div style="display:flex;gap:18px;align-items:flex-start;">
          <div style="font-size:38px;font-weight:700;color:#6A3DB8;letter-spacing:-0.03em;line-height:1;min-width:72px;">73%</div>
          <div style="font-size:15px;color:#374151;line-height:1.5;padding-top:6px;">of renters said Flex helped them stay housed and avoid eviction</div>
        </div>
        <div style="display:flex;gap:18px;align-items:flex-start;">
          <div style="font-size:38px;font-weight:700;color:#6A3DB8;letter-spacing:-0.03em;line-height:1;min-width:72px;">70%</div>
          <div style="font-size:15px;color:#374151;line-height:1.5;padding-top:6px;">avoided late rent fees after enrolling</div>
        </div>
        <div style="display:flex;gap:18px;align-items:flex-start;">
          <div style="font-size:38px;font-weight:700;color:#6A3DB8;letter-spacing:-0.03em;line-height:1;min-width:72px;">31%</div>
          <div style="font-size:15px;color:#374151;line-height:1.5;padding-top:6px;">of renters avoided overdraft fees</div>
        </div>
        <div style="display:flex;gap:18px;align-items:flex-start;">
          <div style="font-size:30px;font-weight:700;color:#6A3DB8;letter-spacing:-0.03em;line-height:1;min-width:90px;white-space:nowrap;">1 in 4</div>
          <div style="font-size:15px;color:#374151;line-height:1.5;padding-top:6px;">renters avoided skipping essentials like food or childcare to pay rent</div>
        </div>
      </div>
      <div style="background:#2C194D;border-radius:14px;padding:28px 32px;display:flex;flex-direction:column;justify-content:space-between;">
        <div style="font-size:16px;font-weight:700;color:#DDC6F9;margin-bottom:16px;">
          Stronger outcomes for <span style="color:#8D70EE;">properties</span>
        </div>
        <div style="display:flex;gap:18px;align-items:flex-start;">
          <div style="font-size:38px;font-weight:700;color:#8D70EE;letter-spacing:-0.03em;line-height:1;min-width:72px;">89%</div>
          <div style="font-size:15px;color:rgba(255,255,255,0.82);line-height:1.5;padding-top:6px;">of property managers recommend continuing Flex</div>
        </div>
        <div style="display:flex;gap:18px;align-items:flex-start;">
          <div style="font-size:38px;font-weight:700;color:#8D70EE;letter-spacing:-0.03em;line-height:1;min-width:72px;">47%</div>
          <div style="font-size:15px;color:rgba(255,255,255,0.82);line-height:1.5;padding-top:6px;">of property managers reported fewer arrears and delinquencies</div>
        </div>
        <div style="display:flex;gap:18px;align-items:flex-start;">
          <div style="font-size:38px;font-weight:700;color:#8D70EE;letter-spacing:-0.03em;line-height:1;min-width:72px;">43%</div>
          <div style="font-size:15px;color:rgba(255,255,255,0.82);line-height:1.5;padding-top:6px;">saw a reduction in eviction filings or notices</div>
        </div>
        <div style="padding-top:16px;border-top:1px solid rgba(255,255,255,0.12);">
          <div style="font-size:10px;color:rgba(255,255,255,0.38);line-height:1.5;">
            Based on our Flex affordable housing partner study. Individual results may vary.
          </div>
        </div>
      </div>
    </div>
  </div>`;
  return { html, js: "" };
}

// ─── Slide: Prospect Close ──────────────────────────────────────────────────

export function renderProspectClose(
  slideId: number,
  prospect: ProspectInfo,
  benchmarks: Benchmarks,
): SlideResult {
  const pmcName = prospect.name || "";
  const pmcLabel = pmcName ? _e(pmcName) : "Your portfolio";

  const steps = [
    { num: "01", title: "Sign the FSA", desc: "Your Flex Services Agreement - the only document needed to get started." },
    { num: "02", title: "Submit intake forms", desc: "Property info, banking details, and rollout preferences. Takes about 1 hour." },
    { num: "03", title: "Team trainings", desc: "Your on-site staff gets a walkthrough of Flex - what it is, how to answer resident questions." },
    { num: "04", title: "Go live", desc: "Properties typically go live within 24–48 hours of completing setup." },
  ];

  const stepsHtml = steps.map((step, i) => {
    const connector = i < steps.length - 1
      ? `<div style="position:absolute;top:26px;left:52%;width:96%;height:2px;background:#e5e0f5;z-index:0;"></div>`
      : "";
    return `<div style="flex:1;position:relative;display:flex;flex-direction:column;align-items:flex-start;">
      ${connector}
      <div style="position:relative;z-index:1;width:52px;height:52px;border-radius:50%;background:${PURPLE};display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:#fff;margin-bottom:18px;box-shadow:0 4px 14px rgba(141,112,238,0.35);">${step.num}</div>
      <div style="font-size:16px;font-weight:700;color:${NAVY};margin-bottom:6px;">${_e(step.title)}</div>
      <div style="font-size:13px;color:${GRAY};line-height:1.6;padding-right:24px;">${_e(step.desc)}</div>
    </div>`;
  }).join("");

  const html = `<div class="slide" id="slide-${slideId}" style="background:${WHITE};padding:56px 64px;">
  <div style="height:100%;display:flex;flex-direction:column;">
    <div style="flex-shrink:0;margin-bottom:56px;">
      <div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:${PURPLE};font-weight:600;margin-bottom:10px;">IMMEDIATE NEXT STEPS</div>
      <div style="font-size:40px;font-weight:700;color:${NAVY};line-height:1.15;letter-spacing:-0.02em;margin-bottom:10px;">${pmcLabel}'s path to live.</div>
      <div style="font-size:15px;color:${GRAY};">Properties typically go live within 24&ndash;48 hours of completing setup.</div>
    </div>
    <div style="display:flex;gap:32px;flex:1;align-items:center;">${stepsHtml}</div>
  </div>
</div>`;
  return { html, js: "" };
}
