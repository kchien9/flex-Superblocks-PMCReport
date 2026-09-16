/**
 * WHY THIS FILE EXISTS
 * ====================
 * Kevin's ask, 2026-09-15: the "These properties need our attention" slide showed churned
 * properties in a "No Longer Active" table right alongside properties that still need action -
 * confusing, since a property that already left the network isn't something a rep can act on
 * in this meeting. Relocated: the table moves to the Full Property Table appendix (still real,
 * partner-facing data), and the "needs attention" slide gets a one-line speaker-notes bullet
 * instead so a rep still knows to mention it live.
 *
 * Run: npx tsx server/apis/pmc-report/__tests__/churned-properties-relocated.test.ts
 */
import assert from "node:assert/strict";

import { renderAdoptionOpportunities } from "../slide-renderers.js";
import { renderFullPropertyTable } from "../get-pmc-monthly-report.js";
import type { DisabledPropertyRow } from "../slide-renderers.js";
import { getNotesForSlide } from "../speaker-notes.js";
import type { SpeakerNotesKpis } from "../speaker-notes.js";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const laggardProperty = {
  propertyName: "Riverside Commons", propertyState: "TX", units: 300, adoptionRate: 0.03,
  billsPaid: 9, monthsLive: 24, newSignups: 2, t12EngPer100: 1.2, isMarketingOptIn: true,
};

const DISABLED: DisabledPropertyRow[] = [
  { propertyName: "Arkadia West Loop", units: 350, deactivationLabel: "Churned", lastSeenMonth: "Oct 2026" },
  { propertyName: "Arkadia", units: 350, deactivationLabel: "Churned", lastSeenMonth: "Apr 2025" },
];

test("renderAdoptionOpportunities no longer accepts or renders a 'No Longer Active' churn table", () => {
  const { html } = renderAdoptionOpportunities({
    slideId: 34, propertySnapshot: [laggardProperty], targetNar: 0.15,
  });
  assert.doesNotMatch(html, /No Longer Active/);
  assert.doesNotMatch(html, /Churned/);
});

test("renderFullPropertyTable gets the churn table instead - same 'No Longer Active' markup, now here", () => {
  const html = renderFullPropertyTable(
    [{ propertyName: "Riverside Commons", units: 300, billsPaid: 12, newSignups: 2, adoptionRate: 0.03 }],
    99,
    DISABLED,
  );
  assert.match(html, /No Longer Active/);
  assert.match(html, /Arkadia West Loop/);
  assert.match(html, /350 units · left Oct 2026/);
  assert.match(html, /Arkadia<\/div>/); // the second, differently-named "Arkadia" row
  assert.match(html, /left Apr 2025/);
  assert.equal((html.match(/Churned/g) ?? []).length, 2);
});

test("renderFullPropertyTable with no disabled properties renders no churn section at all (default param)", () => {
  const html = renderFullPropertyTable(
    [{ propertyName: "Riverside Commons", units: 300, billsPaid: 12, newSignups: 2, adoptionRate: 0.03 }],
    99,
  );
  assert.doesNotMatch(html, /No Longer Active/);
});

test("the Adoption Opportunities slide's speaker notes flag churn as a talk-track bullet when properties left", () => {
  const k: SpeakerNotesKpis = {
    pmcName: "Bozzuto", reportingMonth: "2026-09-01", monthsSinceLaunch: 24, currentNar: 0.12,
    currentBillsPaid: 500, currentNewSignups: 40, targetNar: 0.15, totalUnits: 10000,
    currentResidents: 500, hasNiro: false,
    disabledProperties: [
      { propertyName: "Arkadia West Loop", deactivationLabel: "Churned" },
      { propertyName: "Arkadia", deactivationLabel: "Churned" },
    ],
  };
  const notes = getNotesForSlide(34, k, [], {});
  const churnNote = notes.find((n) => n.includes("WORTH FLAGGING"));
  assert.ok(churnNote, "expected a WORTH FLAGGING churn bullet");
  assert.match(churnNote!, /Arkadia West Loop, Arkadia/);
  assert.match(churnNote!, /2 properties left the network/);
  assert.match(churnNote!, /Full Property Table appendix/);
});

test("no churn bullet appears when nothing churned this period", () => {
  const k: SpeakerNotesKpis = {
    pmcName: "Bozzuto", reportingMonth: "2026-09-01", monthsSinceLaunch: 24, currentNar: 0.12,
    currentBillsPaid: 500, currentNewSignups: 40, targetNar: 0.15, totalUnits: 10000,
    currentResidents: 500, hasNiro: false,
  };
  const notes = getNotesForSlide(34, k, [], {});
  assert.ok(!notes.some((n) => n.includes("WORTH FLAGGING")));
});

console.log(`\n${passed} passed`);
