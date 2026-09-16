/**
 * WHY THIS FILE EXISTS
 * ====================
 * Kevin's catch, 2026-09-15: "I thought on speaker notes we showed approval rate too? Don't see
 * it in Clark" - Tier and Approval Rate were a documented KNOWN GAP (see the file-level comment
 * at the top of speaker-notes.ts before this fix): those need APPLICATIONS_COUNT_PROPERTY /
 * APPROVALS_COUNT_PROPERTY / CURRENT_TIER, which get-pmc-monthly-report.ts's main property
 * query never selected. Flask's pull_pmc_data pulls the exact same three columns off the exact
 * same table (generator/data.py:196-238) - this just adds them here too.
 *
 * Run: npx tsx server/apis/pmc-report/__tests__/property-reference-tier-approval-rate.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildSpeakerNotesHtml } from "../speaker-notes.js";
import type { SpeakerNotesKpis, SpeakerNotesBenchmark, SpeakerNotesMonthlyRow } from "../speaker-notes.js";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const K: SpeakerNotesKpis = {
  pmcName: "Bozzuto", reportingMonth: "2026-09-01", monthsSinceLaunch: 24, currentNar: 0.14,
  currentBillsPaid: 500, currentNewSignups: 40, targetNar: 0.15, totalUnits: 10000,
  currentResidents: 500, hasNiro: false,
};
const BENCH: SpeakerNotesBenchmark = {};
const MONTHLY: SpeakerNotesMonthlyRow[] = [];

test("Tier and Approval Rate columns are in the header, in Flask's order", () => {
  const html = buildSpeakerNotesHtml([1], K, MONTHLY, BENCH, undefined, [
    { propertyName: "Alpha Towers", units: 100, billsPaid: 12, newSignups: 2, adoptionRate: 0.12, rentPaid: 16000 },
  ]);
  const cols = ["Property", "Units", "Tier", "Paying Residents", "New Signups", "Adoption", "Approval Rate", "This Month Rent", "Total Rent Paid"];
  let lastIdx = -1;
  for (const c of cols) {
    const idx = html.indexOf(`${c}<span id="pr-arrow-`);
    assert.ok(idx > lastIdx, `expected column "${c}" to appear after the previous one`);
    lastIdx = idx;
  }
});

test("Platinum tier renders purple/bold; Silver renders gray/semibold; unset defaults to Bronze, muted", () => {
  const html = buildSpeakerNotesHtml([1], K, MONTHLY, BENCH, undefined, [
    { propertyName: "Platinum Place", units: 100, billsPaid: 12, newSignups: 2, adoptionRate: 0.12, rentPaid: 16000, currentTier: "Platinum" },
    { propertyName: "Silver Springs", units: 100, billsPaid: 12, newSignups: 2, adoptionRate: 0.12, rentPaid: 16000, currentTier: "Silver" },
    { propertyName: "No Tier Court", units: 100, billsPaid: 12, newSignups: 2, adoptionRate: 0.12, rentPaid: 16000 },
  ]);
  assert.match(html, /color:#6A3DB8;font-weight:700;">Platinum</);
  assert.match(html, /color:#6b7280;font-weight:600;">Silver</);
  assert.match(html, /color:#a09cb0;font-weight:400;">Bronze</);
});

test("Approval rate shows counts + rounded percent when there are applications, and an em dash sorting to -1 when there are none", () => {
  const html = buildSpeakerNotesHtml([1], K, MONTHLY, BENCH, undefined, [
    { propertyName: "Has Apps", units: 100, billsPaid: 12, newSignups: 2, adoptionRate: 0.12, rentPaid: 16000, cumApprovals: 7, cumApplications: 10 },
    { propertyName: "No Apps", units: 100, billsPaid: 12, newSignups: 2, adoptionRate: 0.12, rentPaid: 16000, cumApprovals: 0, cumApplications: 0 },
  ]);
  assert.match(html, />7\/10 \(70%\)</);
  assert.match(html, /data-sort="-1" style="padding:7px 10px;font-size:12px;text-align:right;white-space:nowrap;">—</);
});

test("churned properties render as their own trailing rows in the Property Reference tab, not just the talk-track bullet", () => {
  // Kevin's catch, 2026-09-15: "the two churned props arent in the prop reference tab of the
  // speaker notes" - they'd only ever been wired into the talk-track bullet, never into this
  // internal reference table a rep might actually pull up mid-meeting to look someone up.
  const withChurn: SpeakerNotesKpis = {
    ...K,
    disabledProperties: [
      { propertyName: "Arkadia West Loop", units: 350, deactivationLabel: "Churned", lastSeenMonth: "Oct 2026" },
      { propertyName: "Arkadia", units: 350, deactivationLabel: "Churned", lastSeenMonth: "Apr 2025" },
    ],
  };
  const html = buildSpeakerNotesHtml([1], withChurn, MONTHLY, BENCH, undefined, [
    { propertyName: "Alpha Towers", units: 100, billsPaid: 12, newSignups: 2, adoptionRate: 0.12, rentPaid: 16000 },
  ]);
  assert.match(html, /Arkadia West Loop/);
  assert.match(html, /Churned · left Oct 2026/);
  assert.match(html, /Churned · left Apr 2025/);
  // The plain "Arkadia" row (not "Arkadia West Loop") is its own distinct row, not dropped.
  assert.match(html, />Arkadia<\/td>/);
});

test("the Property Reference tab still renders (with just the churn rows) when every active property was filtered out", () => {
  const withChurnOnly: SpeakerNotesKpis = {
    ...K,
    disabledProperties: [{ propertyName: "Gone Property", units: 50, deactivationLabel: "Churned" }],
  };
  const html = buildSpeakerNotesHtml([1], withChurnOnly, MONTHLY, BENCH, undefined, []);
  assert.match(html, /Gone Property/);
  assert.doesNotMatch(html, /No property data available/);
});

// ── Regression guard for the exact bug that shipped: 3 near-identical snapshot-mapping ──────
// blocks in get-pmc-monthly-report.ts, and the whitespace-sensitive edit that updated 2 of the
// 3 (Expansion + a Checkin path) but silently missed the QBR one - the one Kevin actually
// tests. A source-text check catches a future edit doing the same thing again, since the three
// blocks look identical enough at a glance to miss by eye too.
const reportSrc = readFileSync(new URL("../get-pmc-monthly-report.ts", import.meta.url), "utf8");

test("every propertySnapshot-derived notes snapshot carries currentTier + cumApplications + cumApprovals", () => {
  const qbrBlock = reportSrc.slice(reportSrc.indexOf("const qbrNotesPropertySnapshot"), reportSrc.indexOf("const qbrNotesPropertySnapshot") + 400);
  const expBlock = reportSrc.slice(reportSrc.indexOf("const expNotesPropertySnapshot"), reportSrc.indexOf("const expNotesPropertySnapshot") + 400);
  const ckBlock = reportSrc.slice(reportSrc.indexOf("const ckNotesSnapshot"), reportSrc.indexOf("const ckNotesSnapshot") + 400);
  for (const [name, block] of [["qbr", qbrBlock], ["expansion", expBlock], ["checkin", ckBlock]] as const) {
    assert.match(block, /currentTier: p\.currentTier/, `${name} snapshot missing currentTier`);
    assert.match(block, /cumApplications: p\.cumApplications/, `${name} snapshot missing cumApplications`);
    assert.match(block, /cumApprovals: p\.cumApprovals/, `${name} snapshot missing cumApprovals`);
  }
});

console.log(`\n${passed} passed`);
