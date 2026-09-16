/**
 * WHY THIS FILE EXISTS
 * ====================
 * Kevin's catch: QBRTab.tsx's "Partner Since Override" field exists, sends
 * partner_since_override in the generate request, and its own enablement-deck copy describes
 * a real use case (a transferred property whose Flex billing history under this PMC's name
 * predates its real relationship with it) - but get-pmc-monthly-report.ts's input schema never
 * read it. Typing a date into that field and generating did nothing at all. Flask has always
 * had this wired (app.py:1512/1921); Clark's port dropped it somewhere along the way.
 *
 * Fixed: added partner_since_override to the input schema, and a real apply site right after
 * the existing Salesforce/rollout partnerSince combine - it substitutes partnerSince itself, so
 * it also feeds the Since Inception floor and the cover date, not just a display label.
 *
 * Run: npx tsx server/apis/pmc-report/__tests__/partner-since-override.test.ts
 */
import assert from "node:assert/strict";

import { parsePartnerSinceOverride } from "../get-pmc-monthly-report.js";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

test("a valid 'YYYY-MM' override parses to 'YYYY-MM-01', matching every other partnerSince string in this file", () => {
  assert.equal(parsePartnerSinceOverride("2024-03"), "2024-03-01");
});

test("a single-digit month is zero-padded", () => {
  assert.equal(parsePartnerSinceOverride("2024-3"), "2024-03-01");
});

test("empty, null, or undefined all mean 'no override' - the automatic Salesforce/rollout combine stands", () => {
  assert.equal(parsePartnerSinceOverride(""), null);
  assert.equal(parsePartnerSinceOverride(null), null);
  assert.equal(parsePartnerSinceOverride(undefined), null);
});

test("a malformed override (out-of-range month, garbage text) returns null rather than throwing", () => {
  assert.equal(parsePartnerSinceOverride("2024-13"), null);
  assert.equal(parsePartnerSinceOverride("2024-00"), null);
  assert.equal(parsePartnerSinceOverride("not-a-date"), null);
  assert.equal(parsePartnerSinceOverride("2024"), null);
});

console.log(`\n${passed} passed`);
