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

console.log(`\n${passed} passed`);
