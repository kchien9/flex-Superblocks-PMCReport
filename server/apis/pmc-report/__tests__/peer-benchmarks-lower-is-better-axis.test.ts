/**
 * WHY THIS FILE EXISTS
 * ====================
 * Kevin's catch, live screenshot: "Time to First Sign-Up" is a lowerIsBetter metric (fewer
 * days = faster = better) - sliderRow already flips the COLOR/LABEL logic for it (8 days,
 * slower than the 6-day median, correctly reads "Below median" in orange), but the TRACK
 * ITSELF still positioned P25/P50/P75/the PMC dot by raw value, left-to-right ascending - so
 * the fast (good) PMCs clustered on the LEFT third of the bar while every other metric card
 * (Engagement, Retention, Portfolio Penetration - all higher-is-better) has its good PMCs
 * cluster on the RIGHT. Scanning "further right = better" across the same row of toggleable
 * cards gave the wrong impression on this one card alone.
 *
 * Fix: mirror the track (100 - pct) for a lowerIsBetter metric, so the best quartile (fewest
 * days) always renders on the right - same visual direction as every other card. Each tick
 * still shows its own REAL value (P25's tick still prints the real P25 day count) - only
 * WHERE it renders on the bar flips, never WHICH number it shows.
 *
 * Run: npx tsx server/apis/pmc-report/__tests__/peer-benchmarks-lower-is-better-axis.test.ts
 */
import assert from "node:assert/strict";

import { renderPeerBenchmarks } from "../slide-renderers.js";
import type { BenchmarkMetric } from "../slide-renderers.js";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

// Kevin's exact shape: 2 / 6 / 29 days, PMC at 8 days (slower than median, but inside P75).
const SIGNUP_TIMING: BenchmarkMetric = {
  metric: "SIGNUP_TIMING", p25: 2, p50: 6, p75: 29, pmcValue: 8, lowerIsBetter: true,
};
// A normal higher-is-better metric, same shape otherwise, for a same-file control comparison.
const NAR: BenchmarkMetric = {
  metric: "NAR", p25: 0.08, p50: 0.14, p75: 0.22, pmcValue: 0.10,
};

function leftPct(html: string, marker: string): number {
  const re = new RegExp(`left:([\\d.]+)%[^"]*">${marker}<`);
  const m = html.match(re);
  if (!m) throw new Error(`marker not found: ${marker}`);
  return parseFloat(m[1]);
}

test("a lowerIsBetter metric's track is mirrored - P25 (best/fastest) renders furthest right, P75 (worst/slowest) furthest left", () => {
  const { html } = renderPeerBenchmarks({
    slideId: 5, pmcName: "Coast Property Management", segment: "SMB",
    metrics: [SIGNUP_TIMING],
  });
  const p25Left = leftPct(html, "P25");
  const p75Left = leftPct(html, "P75");
  const p50Left = leftPct(html, "P50");
  // Mirrored: P25 (2 days, best) sits at a LARGER left% than P75 (29 days, worst).
  assert.ok(p25Left > p75Left, `expected P25 (${p25Left}%) right of P75 (${p75Left}%)`);
  assert.ok(p25Left > p50Left, `expected P25 (${p25Left}%) right of P50 (${p50Left}%)`);
  assert.ok(p50Left > p75Left, `expected P50 (${p50Left}%) right of P75 (${p75Left}%)`);
  // The real day values are still printed - only their position moved, not their identity.
  assert.match(html, />2 days</);
  assert.match(html, />6 days</);
  assert.match(html, />29 days</);
});

test("a higher-is-better metric's track is untouched (control) - P25 still renders left of P75", () => {
  const { html } = renderPeerBenchmarks({
    slideId: 5, pmcName: "Coast Property Management", segment: "SMB",
    metrics: [NAR],
  });
  const p25Left = leftPct(html, "P25");
  const p75Left = leftPct(html, "P75");
  assert.ok(p25Left < p75Left, `expected P25 (${p25Left}%) left of P75 (${p75Left}%) - unmirrored`);
});

test("the IQR band's left/width stay correct after mirroring (min/abs, not the raw p25-first assumption)", () => {
  const { html } = renderPeerBenchmarks({
    slideId: 5, pmcName: "Coast Property Management", segment: "SMB",
    metrics: [SIGNUP_TIMING],
  });
  const bandMatch = html.match(/IQR band -->\s*<div style="position:absolute;top:18px;left:([\d.]+)%;width:([\d.]+)%/);
  assert.ok(bandMatch, "IQR band div not found");
  const bandLeft = parseFloat(bandMatch![1]);
  const bandWidth = parseFloat(bandMatch![2]);
  assert.ok(bandWidth > 0, "band width must be positive even when P75's mirrored position is left of P25's");
  const p25Left = leftPct(html, "P25");
  const p75Left = leftPct(html, "P75");
  assert.equal(bandLeft, Math.min(p25Left, p75Left));
  assert.equal(Math.round((bandLeft + bandWidth) * 10) / 10, Math.max(p25Left, p75Left));
});

console.log(`\n${passed} passed`);
