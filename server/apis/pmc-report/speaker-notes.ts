/**
 * Speaker notes generator for PMC QBR presentations — port of Flask's
 * generator/speaker_notes.py (build_speaker_notes_html + per-slide _notes_* functions).
 * Produces a printable HTML script with stage-aware talking points per slide, matching the
 * "Slide Deck" download pattern (returned as an HTML string, downloaded client-side as a
 * data URI — no server-side file storage needed).
 *
 * Property Reference tab (Kevin's catch, 2026-08-19): ported with 7 of Flask's 9 columns —
 * Property, Units, Paying Residents, New Signups, Adoption, This Month Rent, Total Rent Paid.
 * KNOWN GAP: Tier and Approval Rate are NOT included — those need current_tier/cum_approvals/
 * cum_applications, which this report's property snapshot doesn't pull anywhere today
 * (confirmed via full-repo grep). Adding them is a real, separate follow-up (new query), not a
 * quick wire-up. Still not ported: the cohort standout-segment insight callouts
 * (detectStandoutSegments/pullCohortDealTags — a separate analysis pass Flask runs before
 * notes generation) — a safe, additive follow-up.
 */

function _e(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function pctStr(v: number): string {
  // Drop the trailing ".0" on a whole-number percent (Kevin's catch: "85%", not "85.0%") -
  // same fix as get-pmc-monthly-report.ts's own fmtPct, just never ported to this file.
  const s = (v * 100).toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) + "%" : s + "%";
}

function ppStr(v: number): string {
  const sign = v >= 0 ? "+" : "−";
  return `${sign}${Math.abs(v * 100).toFixed(1)}pp`;
}

function kStr(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return Math.round(v).toLocaleString();
}

function monthStr(m: string | null | undefined): string {
  if (!m) return "—";
  const d = new Date(m + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

type Stage = "new" | "growing" | "established";

function stageOf(monthsSince: number): Stage {
  if (monthsSince < 6) return "new";
  if (monthsSince < 18) return "growing";
  return "established";
}

const SEASONALITY_NOTE =
  "Seasonality heads-up: adoption and rent collected often soften in the Apr–Jun window — " +
  "tax-refund season gives residents a cash cushion to pay rent directly, and student housing " +
  "turnover adds noise. If you see a spring dip, it's usually seasonal rather than a red flag — " +
  "still worth a quick check that nothing property-specific is driving it.";

export const SLIDE_TITLES: Record<number, string> = {
  1: "Cover", 2: "KPI Headline", 3: "How You Stack Up Against Peers",
  4: "Active Residents Over Time", 5: "Revenue Trend", 6: "Adoption Rate Trend",
  8: "Engagement Funnel",
  9: "Top Properties by Active Residents", 10: "Top & Bottom Performers",
  11: "Top 10 Performers", 12: "Adoption by State", 13: "Executive Summary",
  14: "Cohort Overview", 15: "Retention", 16: "Properties Over Time", 17: "Units Over Time",
  21: "Portfolio Projection", 22: "Whitespace Analysis", 23: "Integration Gap",
  25: "Full Property Table", 26: "Delinquency", 27: "Customer Testimonials",
  34: "Adoption Opportunities", 35: "Portfolio Gap — Path to Full Portfolio",
  39: "Flex Is for Everyone", 43: "Executive Summary & The Case for Expanding",
  44: "Performance Benchmarks", 45: "Adoption Ceiling", 49: "Resident Marketing Split",
  50: "Research: What Flexible Rent Does", 47: "Closing — Wins & Next Steps",
  52: "Anniversary Milestone", 53: "Properties That Went Offline",
  54: "Residents, Units & Rent", 56: "Bills & Rent Since Inception",
  57: "Customer Experience", 58: "Properties Worth Celebrating",
};

export interface SpeakerNotesKpis {
  pmcName: string;
  reportingMonth: string | null;
  monthsSinceLaunch: number;
  currentNar: number;
  currentBillsPaid: number;
  currentNewSignups: number;
  targetNar: number;
  totalUnits: number;
  currentResidents: number;
  hasNiro: boolean;
  // How many months the Delinquency slide's trailing window actually covers - up to 12, but
  // fewer when the PMC doesn't have 12 months of DQ history yet (Kevin's ask: reps need to know
  // an "8 months" figure means 8 months of real data, not a truncated 12-month view).
  dqWindowMonths?: number;
  // True only when Expansion's Adoption Rate chart is showing a peer-median line (i.e. this PMC
  // is above peer median - see isAbovePeerMedian at its renderAdoptionTrend call site in
  // get-pmc-monthly-report.ts). Left undefined for QBR, which shows the peer line
  // unconditionally and has no equivalent gating to explain.
  showingAbovePeerMedian?: boolean;
}

export interface SpeakerNotesBenchmark {
  benchmarkNar?: number;
  peerCount?: number;
  criteria?: string;
  unitRange?: string;
  p50Nar?: number | null;
  p75Nar?: number | null;
  p90Nar?: number | null;
  p99Nar?: number | null;
}

export interface SpeakerNotesMonthlyRow {
  month: string;
  billsPaid: number;
  units: number;
  rentPaid: number;
  newSignups: number;
  propertyCount: number;
}

// ── per-slide note functions ────────────────────────────────────────────────

function notesCover(k: SpeakerNotesKpis): string[] {
  const month = monthStr(k.reportingMonth);
  const stage = stageOf(k.monthsSinceLaunch);
  const opener = {
    new: `Welcome to ${k.pmcName}'s first Flex business review. You're ${k.monthsSinceLaunch} months into the partnership — today is about showing early momentum and setting expectations for how adoption ramps.`,
    growing: `Welcome to ${k.pmcName}'s ${month} business review. You're ${k.monthsSinceLaunch} months into the partnership — today we'll look at how the portfolio has matured and where the biggest opportunities are.`,
    established: `Welcome to ${k.pmcName}'s ${month} business review. With ${k.monthsSinceLaunch} months on Flex, we have a rich picture of your portfolio — today we'll look at performance, highlights, and where to focus next.`,
  }[stage];
  return [
    opener,
    "Set the tone: this is a partnership review, not a report card. The goal is a shared view of what's working and where to go next.",
    "Agenda preview: we'll cover portfolio performance, how you compare to peers, property-level highlights, and one or two focus areas.",
  ];
}

// Expansion-specific Cover notes (Kevin's catch: notesCover above is a review/QBR framing -
// "business review," "partnership review, not a report card." An expansion conversation isn't
// a review of the past; it's a pitch to grow, using the past as the evidence. Kept as its own
// function (not a branch inside notesCover) since getNotesForExpansionSlide is a fully separate
// string-keyed dispatcher from QBR's numeric one - no risk of this touching QBR's copy.
function notesCoverExpansion(k: SpeakerNotesKpis): string[] {
  const month = monthStr(k.reportingMonth);
  return [
    `Welcome to ${k.pmcName}'s ${month} expansion conversation. This isn't a review of the past ${k.monthsSinceLaunch} months - it's the evidence for what comes next.`,
    "Set the tone from the first slide: everything after this is proof, building toward one ask - roll Flex out to the rest of the portfolio. Don't let the room settle into 'here's how we did' mode.",
    "Agenda preview: we'll show what's already working, how that compares to peers, then translate it directly into what rolling out the remainder of the portfolio looks like.",
  ];
}

function notesKpis(k: SpeakerNotesKpis, monthly: SpeakerNotesMonthlyRow[]): string[] {
  const stage = stageOf(k.monthsSinceLaunch);
  const notes: string[] = [];
  if (monthly.length >= 2) {
    const prev = monthly[monthly.length - 2];
    const prevNar = prev.units > 0 ? prev.billsPaid / prev.units : 0;
    const delta = k.currentNar - prevNar;
    notes.push(Math.abs(delta) > 0.005
      ? `Adoption moved ${ppStr(delta)} from last month — ${delta > 0 ? "up, lead with that." : "down slightly, have context ready on why."}`
      : "Adoption is holding steady month-over-month — frame as consistency.");
  }
  const stageNotes = {
    new: `At ${k.monthsSinceLaunch} months in, focus on trajectory, not absolute level. The question isn't where you are today — it's the direction of the trend.`,
    growing: "You're in the growth phase. The portfolio is maturing — expect adoption to keep climbing as properties hit their stride.",
    established: `With ${k.monthsSinceLaunch} months of history, these numbers reflect a settled portfolio. Any meaningful movement — up or down — is a signal worth discussing.`,
  }[stage];
  return [
    `${k.pmcName} is at ${pctStr(k.currentNar)} adoption this month — that's ${kStr(k.currentBillsPaid)} residents actively paying rent through Flex.`,
    `${kStr(k.currentNewSignups)} new residents enrolled this month.`,
    ...notes,
    stageNotes,
    "If they ask what 'adoption rate' means: it's the share of units in the portfolio where a resident used Flex to pay rent this month.",
  ];
}

function notesExecSummary(k: SpeakerNotesKpis): string[] {
  return [
    "Second slide, right after the cover — this is the one tile row most people will remember if they remember nothing else. Give it a beat before moving on.",
    `${k.pmcName} is at ${pctStr(k.currentNar)} adoption this month, ${k.monthsSinceLaunch} months into the partnership. The sparkline under each tile shows the trend, not just the current value — if a number is flat or down, that's worth naming out loud rather than hoping no one asks.`,
    "Tiles typically cover: residents paying, new residents this month, adoption rate, true repeat rate, and delinquency shielded. True repeat rate is lifetime (of residents who had a chance to come back, what % did) — it's a stickiness signal, not a monthly snapshot.",
    "Delinquency shielded is real rent Flex covered when a resident missed a payment — it's a good one to connect back to NOI if the room is finance-oriented.",
    "Treat this as the agenda-setting slide: it previews everything the rest of the deck will unpack in more depth.",
  ];
}

function notesBenchmark(k: SpeakerNotesKpis, b: SpeakerNotesBenchmark): string[] {
  const bNar = b.benchmarkNar ?? 0;
  const diff = k.currentNar - bNar;
  const peerDesc = (b.peerCount ?? 0) > 0
    ? `${(b.peerCount ?? 0).toLocaleString()} PMCs matched on unit count ${b.unitRange ? `(${b.unitRange})` : ""} and integration profile (${b.criteria ?? "similar PMCs"})`
    : "similar-size PMCs";
  const notes = [`Peer group: ${peerDesc}. This is an apples-to-apples comparison — only integrated PMCs of similar scale.`];
  if (diff >= 0) {
    notes.push(`Good news lead: at ${pctStr(k.currentNar)}, you're ${ppStr(diff)} above your peer group average of ${pctStr(bNar)}. That puts you in the top tier of comparable PMCs.`);
    notes.push("Let this land. Don't move past it too quickly — this is a win.");
  } else {
    notes.push(`You're ${ppStr(Math.abs(diff))} below the peer group average of ${pctStr(bNar)}. Frame this carefully.`);
    notes.push("If they push back: the gap usually comes down to one of three levers — reach (are residents seeing Flex?), conversion (are they signing up?), or retention (are they sticking?). The next few slides will show which one is the bottleneck.");
  }
  notes.push("If they ask 'why are we compared to those PMCs specifically': they're selected to match your size and integration type so it's a fair comparison. It's not random.");
  return notes;
}

function notesTrend(label: string, col: "billsPaid" | "rentPaid" | "propertyCount" | "units", k: SpeakerNotesKpis, monthly: SpeakerNotesMonthlyRow[]): string[] {
  const stage = stageOf(k.monthsSinceLaunch);
  const notes = [`This chart shows your ${label.toLowerCase()} over the last ${monthly.length} months.`];
  if (monthly.length >= 2) {
    const first = monthly[0][col], last = monthly[monthly.length - 1][col];
    const direction = last > first ? "grown" : last < first ? "declined" : "held steady";
    notes.push(`Over the period, ${label.toLowerCase()} has ${direction} from ${kStr(first)} to ${kStr(last)}.`);
  }
  if (stage === "new") notes.push("For a new partner, any upward trend here is the story — growth, even incremental, validates the rollout is working.");
  else if (stage === "established") notes.push("For a mature partner, look for the inflection points — what months showed spikes or dips? Usually correlates to a property event or seasonal pattern.");
  return notes;
}

function notesAdoptionTrend(k: SpeakerNotesKpis, monthly: SpeakerNotesMonthlyRow[]): string[] {
  const stage = stageOf(k.monthsSinceLaunch);
  // showingAbovePeerMedian is only ever explicitly false on Expansion (gated - below/at peer
  // median, so the peer line genuinely isn't on this slide). Undefined means either QBR (no
  // gating, peer line always shows when data exists) or Expansion above median - both cases
  // describe the peer line normally.
  const notes = k.showingAbovePeerMedian === false
    ? ["Solid purple is the portfolio's adoption rate. No peer-median line on this one - this PMC isn't clearing peer median right now, so we're not putting a losing comparison in front of them. Keep the conversation on their own trend line instead."]
    : ["Solid purple is the portfolio's adoption rate. Grey dashed is the peer median — comparable PMCs at the same calendar months, not a fixed target."];
  notes.push("If a third, lighter line appears, that's the established-cohort rate — properties past their first rollout month. A gap between that and the solid line means new-property rollouts are still diluting the portfolio number, which is a sign of growth, not underperformance.");
  if (monthly.length >= 2) {
    const last = monthly[monthly.length - 1];
    const lastNar = last.units > 0 ? last.billsPaid / last.units : 0;
    notes.push(`Current adoption: ${pctStr(lastNar)} overall.`);
  }
  // Kevin's ask: when the peer line IS showing on Expansion, it's because this PMC is winning -
  // coach the AE to use that as the bridge into the ask, not just report the number.
  if (k.showingAbovePeerMedian === true) {
    notes.push("This PMC is beating peer median right now — lean into it. Frame it as the case for expanding: 'you're already outperforming comparable PMCs, so let's get more of the portfolio doing this.' Don't just report the number, use it as the bridge to the ask.");
  }
  if (stage === "new") notes.push("For a new partner: adoption is still being pulled down by properties in their first month or two. Watch the trend direction more than the absolute level.");
  else if (stage === "established") notes.push("For a mature partner: if the portfolio rate and established-cohort rate track closely, that's expected. A big gap suggests a recent wave of new property rollouts — ask: 'Are there new properties we've added recently that are still ramping?'");
  notes.push(SEASONALITY_NOTE);
  return notes;
}

function notesResidentsUnitsRent(monthly: SpeakerNotesMonthlyRow[]): string[] {
  const notes = [
    "Three lines on one axis pair: Residents Paying and Units in Network share the left scale — the shaded gap between them is the untapped unit base. Rent Collected runs on its own right-hand scale so its shape is comparable without the two counts drowning it out.",
    "Hover any point to see all three metrics for that month together, plus each one's % change vs. the prior month — useful for tying a resident move directly to a rent move.",
  ];
  if (monthly.length >= 2) {
    const last = monthly[monthly.length - 1];
    notes.push(`This month: ${kStr(last.billsPaid)} residents paying against ${kStr(last.units)} units in network, $${kStr(last.rentPaid)} in rent collected.`);
  }
  notes.push(SEASONALITY_NOTE);
  return notes;
}

function notesSinceInception(k: SpeakerNotesKpis): string[] {
  return [
    `This is ${k.pmcName}'s full history on Flex, year by year — bars are total rent paid, the dot on each bar is bills paid that year. Deliberately ignores the report's normal lookback window; use it when the partner wants to see the whole relationship, not just this period.`,
    "If the current year is incomplete, the last bar is a lighter, dashed 'projected' bar — actual rent so far, plus the trailing 3-month run-rate carried through the rest of the year. Not a flat year-to-date average, since that would understate a portfolio that's still growing.",
    "If asked 'how is that projection calculated': trailing 3 months' pace extrapolated forward, not a guarantee — results depend on the portfolio continuing to perform the way it has recently.",
    "The year-over-year callout on the projected bar (e.g. '+X% vs last year') is a good one to lead with if the number is positive — it's a clean, single-number growth story for the whole partnership.",
    "Occasional-use slide — most reviews stick to the standard lookback window. Turn this on specifically when the conversation is about the full arc of the relationship (renewals, anniversaries, expansion pitches).",
  ];
}

function notesAnniversary(): string[] {
  return [
    "Milestone slide — only shows up on an actual anniversary window (1, 2, 3, or 5 years) and only for PMCs in the top half of Flex partners by tenure, so if it's here, genuinely acknowledge it before moving into the data-heavy slides.",
    "The 'top X%' figure is by tenure (how long they've been a partner), not by performance — don't conflate the two if asked.",
    "Good moment to say something personal and non-scripted before returning to the deck — this slide exists specifically to make room for that.",
  ];
}

function notesQbrClose(): string[] {
  return [
    "Closing slide — two columns: wins this quarter (left) and what we're working on together next quarter (right). Always positioned last.",
    "Lead with the wins column — it's built from real data (adoption vs. peer benchmark, guaranteed rent, repeat usage), not filler. Let each one land before moving to the action items.",
    "The right column is a standing set of default actions (review underperforming properties, drive co-marketing, schedule the next QBR) — know what's on it before the meeting.",
    "End the meeting by explicitly confirming the next steps out loud and agreeing on a date for the next touchpoint — don't let the slide just speak for itself.",
  ];
}

function notesTopProperties(): string[] {
  return [
    "These are your top properties by active residents this month.",
    "Call out any property that has notably improved or joined the top tier since last period — partners love to see movement.",
    "Avoid dwelling on properties not on this list. This slide is for celebrating wins.",
  ];
}

function notesTopBottom(): string[] {
  return [
    "Left side: your top 5 by adoption rate. Right side: bottom 5.",
    "Lead with the top performers — set a positive frame before going to the bottom.",
    "For bottom performers: come prepared with a hypothesis on what's driving the gap. Is it a rollout timing issue? A specific property type? A management contact who's disengaged?",
    "Avoid reading the property names on the bottom list out loud — let them read it. Give them a moment, then offer context.",
    "If they ask 'what do we do about these': that's your segue to whitespace analysis and a follow-up conversation about targeted outreach.",
  ];
}

function notesCohortOverview(k: SpeakerNotesKpis): string[] {
  const stage = stageOf(k.monthsSinceLaunch);
  const notes = [
    "Each row is a cohort — properties that rolled out at the same time. This shows how each group has matured.",
    "Key insight: newer cohorts always look lower. That's expected — they haven't had time to ramp. The older cohorts show where your portfolio will land over time.",
  ];
  if (stage === "new") notes.push("For a new partner: you'll have one or two cohorts. The numbers will look early — that's normal. Point to the trajectory within the cohort, not the absolute level.");
  else if (stage === "established") notes.push("For a mature partner: the oldest cohort is your 'steady state' signal. That's roughly the ceiling for a property without any major intervention.");
  notes.push("If they ask why cohorts have different rates: mix of property age, location, how well Flex was marketed at rollout, and resident engagement.");
  return notes;
}

function notesRetention(monthly: SpeakerNotesMonthlyRow[]): string[] {
  const notes = [
    "TRUE REPEAT RATE (the hero number on this slide) means: of residents who paid with Flex before, what share are still paying now? Say it plainly if asked — 'of everyone who's tried Flex, this is the share still using it.'",
    "This is one of the stickiest metrics — high retention means residents have built Flex into their routine. Low retention means something is interrupting the habit.",
    "The loyalty tier breakdown (left panel) measures each resident's consistency over their full history: months they paid Flex divided by months Flex was available to them since their first payment. Perfect = every single month; Episodic = less than half.",
  ];
  if (monthly.length >= 2) {
    const last = monthly[monthly.length - 1];
    const prev = monthly[monthly.length - 2];
    const recur = Math.max(0, last.billsPaid - last.newSignups);
    if (prev.billsPaid > 0) {
      const rate = recur / prev.billsPaid;
      notes.push(`Current repeat usage: roughly ${pctStr(rate)} of last month's transacting users (unique payers) paid again this month.`);
      // Kevin's ask: reps need this spelled out plainly, not left to guess whether a number
      // over 100% is a mistake. It's real and it's good news - the math allows it because the
      // numerator (everyone who paid this month who isn't brand new) can include residents who
      // came BACK after skipping a month, and they were never in last month's denominator.
      if (rate > 1) {
        notes.push(`Above 100% is real, not a typo: it means every resident who paid last month paid again this month, PLUS some additional residents who'd skipped a month or more came back on top of that. If asked: 'we didn't just hold on to everyone, we actually won some back.'`);
      }
    }
  }
  notes.push("If retention is high (>70%): 'Once residents try Flex, they keep using it. That's the flywheel.' This is a strong value prop for the partner.");
  notes.push("If retention is low: 'The opportunity here is re-engagement. Residents who tried Flex but drifted off are easier to convert than brand new prospects — they already know the product.'");
  notes.push("Common question: 'Why do some residents stop?' Usually lease turnover, payment timing changes, or they moved. Worth separating natural churn from avoidable churn if they want to dig in.");
  return notes;
}

function notesPortfolioProjection(k: SpeakerNotesKpis, b: SpeakerNotesBenchmark): string[] {
  const gapResidents = Math.max(0, Math.round(k.totalUnits * k.targetNar) - k.currentResidents);
  const { p50Nar: p50, p75Nar: p75, p90Nar: p90, p99Nar: p99 } = b;
  let targetBasis: string;
  if (p90 && k.currentNar >= p90) {
    targetBasis = p99
      ? `You're already at or above the top-decile (P90) peer rate of ${pctStr(p90)}, so there's no higher REGULAR peer tier to point to — the target reaches for P99 (${pctStr(p99)}) plus a 2pp stretch, since it's a real peer datapoint (not a manufactured number), just a rarer one.`
      : `You're already at or above the top-decile (P90) peer rate of ${pctStr(p90)}, so there's no higher peer tier to point to — the target stretches above your own current rate instead.`;
  } else if (p90 && p75 && k.currentNar >= p75) {
    targetBasis = `You're already above the top-quartile (P75) peer rate of ${pctStr(p75)} — the target is P90, ${pctStr(p90)}, the next real tier up.`;
  } else if (p75 && p50 && k.currentNar >= p50) {
    targetBasis = `You're above the peer median (P50, ${pctStr(p50)}) but below the top quartile — the target is P75, ${pctStr(p75)}, the next real peer-benchmark tier.`;
  } else if (p50) {
    targetBasis = `The target is P50, ${pctStr(p50)} — the peer median. That's the floor worth closing before reaching for a stretch goal.`;
  } else {
    targetBasis = "The target is derived from the peer-benchmark distribution for PMCs your size and integration profile, not a flat manually-set number.";
  }
  const notes = [
    `This slide shows what the portfolio looks like today vs. the ${pctStr(k.targetNar)} adoption target — and what it means in dollars.`,
    `Why ${pctStr(k.targetNar)} specifically: ${targetBasis} If asked 'why this number' — it's a real peer tier, not a round number picked for effect.`,
    `Closing the gap requires roughly ${kStr(gapResidents)} more active residents. That's the prize — use it to make the opportunity feel concrete, not abstract.`,
    "Let the 'How to Get There' cards drive the conversation. Don't just show the number and move on — this is where you propose the actual plan.",
  ];
  if (k.hasNiro || k.currentNar < 0.10) {
    notes.push("Marketing integration is the lead lever for this portfolio. If Flex isn't visible in their resident portal, that's the first thing to fix — it has the highest ROI of any activation tactic.");
  }
  notes.push(
    "Co-marketing campaign: offer to co-create an email or flyer. Give them a template they can send in the next 2 weeks — low lift, high signal that you're a real partner.",
    "On-site training: propose a 30-min Zoom for their property managers. Staff who understand Flex convert residents at a much higher rate. Make it easy — you run it.",
    "Commit to a specific follow-up before ending the call: 'Let's schedule a co-marketing send for [date] and a staff training for [date]. I'll draft both.'",
  );
  return notes;
}

function notesDelinquency(k: SpeakerNotesKpis): string[] {
  const notes = [
    "This slide shows Flex's delinquency shield: rent Flex guaranteed to you for residents who fell behind, and how much has been recovered.",
    "Lead with the protection angle — Flex absorbed this risk so the PMC didn't have to.",
  ];
  // Kevin's ask: state the actual window plainly, and flag when it's short because of real
  // data availability (a new partner) rather than let a rep get asked "why only 8 months?" and
  // not have an answer. windowMonths itself is always min(real DQ history, 12) - never a
  // partial/truncated 12-month view, so "8 months" here always means 8 real months exist.
  if (k.dqWindowMonths != null) {
    notes.push(
      k.dqWindowMonths >= 12
        ? "This covers the trailing 12 months of DQ history."
        : `This covers ${k.dqWindowMonths} month${k.dqWindowMonths === 1 ? "" : "s"} — that's ALL the DQ history this PMC has so far (they haven't been on Flex for a full 12 months yet), not a partial view of a longer window. If asked why it's not 12 months: 'there just isn't more history yet — this is everything.'`
    );
  }
  notes.push(
    "If they ask about recovery rates: Flex pursues repayment from residents; the PMC is made whole regardless of outcome.",
    "This data is typically most relevant for PMCs with higher-risk resident profiles or in markets with higher delinquency rates.",
  );
  return notes;
}

function notesCustomerExperience(): string[] {
  return [
    "This slide shows resident support quotes and/or a CSAT/response-time trend from Zendesk, depending on what's available this month — check which one(s) actually rendered before the meeting.",
    "If quotes are shown: these come directly from residents and property managers. Read one or two out loud — first person voice lands differently than a chart. If a quote is from a property manager at one of their properties, call that out: 'This is from your team at [property].' It makes it real.",
    "If the CSAT/response-time trend is shown: it only appears when support quality genuinely improved — not flat, not declining — over the review window, so it's a real, defensible win if asked about it.",
    "Good closing-adjacent slide — ends on a human/service note rather than a pure adoption-metrics note.",
  ];
}

function notesAdoptionOpportunities(k: SpeakerNotesKpis): string[] {
  return [
    `This slide surfaces the properties with the most headroom — below the portfolio median and sized large enough that moving them would meaningfully lift ${k.pmcName}'s overall adoption rate.`,
    "HOW TO USE IT: Don't read the list top-to-bottom. Lead with the largest opportunity. 'If we could move [property] from X% to median, that's roughly Y more residents on Flex every month.'",
    "WHAT DRIVES LAGGARDS: The most common causes are (1) residents don't know Flex is available — marketing isn't turned on, (2) the sign-up flow has friction specific to this PMS integration, or (3) it's a newer property still in its ramp period.",
    `Current portfolio NAR: ${pctStr(k.currentNar)}. Each property on this list is dragging that number. Moving even one from the bottom quartile to the median can shift the portfolio rate.`,
    "COACHING PROMPT: 'For the top property on this list — do you know if Flex is visible to residents there? Is it in the portal, in move-in communication?' This usually opens a property manager conversation.",
    "Methodology note if they ask: properties are ranked by estimated adoption gap (units × (median − current NAR)). Only properties with meaningful unit count included.",
  ];
}

function notesPropertiesWorthCelebrating(k: SpeakerNotesKpis): string[] {
  return [
    `These are ${k.pmcName}'s biggest wins this period — properties beating the portfolio average by a meaningful, unit-weighted margin, not just whichever single small property happens to have the highest raw rate.`,
    "HOW TO USE IT: Lead with the biggest impact property, not necessarily the highest percentage — impact is units × outperformance, so a large property that's moderately above average can matter more than a tiny one that's way above.",
    "Ask what's working at the top property — marketing cadence, move-in process, staff engagement — and whether it can travel to other properties. That's the real value of this slide.",
  ];
}

function notesOffboardedProperties(k: SpeakerNotesKpis): string[] {
  return [
    "This slide covers properties that went offline — removed from the Flex network — during the review period.",
    `WHY THIS MATTERS: Offboarded properties suppress portfolio-level adoption and unit counts. If ${k.pmcName} had a spike in offboards, it should be named and contextualized, not just left as a data anomaly.`,
    "COMMON REASONS: (1) Property sold or transferred to another PMC — standard, no action needed. (2) PMC requested removal — worth understanding why. (3) Compliance or account issue — Flex should have flagged this proactively.",
    "HOW TO PRESENT IT: Be matter-of-fact. 'Here are the properties that exited the network this period, and the reason for each.' Don't over-explain unless they ask.",
  ];
}

function notesHighRentAdoption(): string[] {
  return [
    "Addresses the 'our residents can afford rent, they don't need this' objection head-on — shows Flex usage across every rent tier, not just lower-rent properties.",
    "The point isn't that lower-rent residents use it more (though they often do) — it's that even at the top-quartile-rent properties, real usage still shows up. The timing problem (payday vs. rent due date) doesn't care how much rent costs.",
    "If asked why higher-rent residents would need this at all: it's not about affordability, it's about cash-flow timing. A resident paid biweekly or on the 15th still has a gap before the 1st, regardless of income level.",
    "Good slide to have ready if the room pushes back with 'our portfolio skews upscale, this product isn't for us.'",
  ];
}

function notesStateBreakdown(): string[] {
  return [
    "This breaks down adoption rate by state — useful if the PMC operates across multiple markets.",
    "Look for variance: states with significantly higher or lower adoption often reflect differences in property type, rollout timing, or how well Flex was marketed locally.",
    "If one state is consistently high: 'What are you doing differently in [state] that we could replicate elsewhere?'",
    "Bars compare each state against the portfolio average. The darker shade is the established-properties-only rate (3+ months on Flex), the lighter shade is all properties blended together — a same-month rollout mixed in with an older, better-performing property can drag the blended rate below the established one alone. Not a rendering issue if you see that.",
  ];
}

function notesMultiBenchmark(k: SpeakerNotesKpis, b: SpeakerNotesBenchmark): string[] {
  const criteria = b.criteria ?? "";
  return [
    `HOW TO READ THIS SLIDE: Each row shows one metric. The colored dot is where ${k.pmcName} sits. The purple shaded band is where the middle 50% of comparable PMCs fall (P25 to P75). Dot to the RIGHT of the band = outperforming most peers. Dot to the LEFT = room to improve.` +
      (criteria ? ` PEER SET CONTEXT: peers were matched on '${criteria}' — read literally, that's the actual basis for this comparison.` : ""),
    "ENGAGEMENT (per 100 units): How many NEW bill connections (residents linking their account to Flex for the first time) happened per 100 enrolled units in the trailing 12 months. HIGH engagement + LOW adoption = residents are discovering Flex but not completing payment (onboarding issue). LOW engagement = residents don't know Flex is available — marketing integration is the lever.",
    "ADOPTION RATE: % of enrolled units with an active Flex payer this month. WHAT MOVES IT: Marketing integration (D2C) is the #1 driver. Tenure also matters — properties in their first 6 months are still ramping.",
    "REPEAT USAGE RATE: Of last month's unique Flex payers, what % paid again this month. 90%+ is typical for established properties — once residents are on Flex it becomes habitual.",
    "PORTFOLIO PENETRATION: Enrolled Flex units ÷ total portfolio units. LOW penetration (< 30%) = large untapped opportunity. HIGH penetration (> 70%) = focus shifts to maximizing adoption within enrolled properties.",
    `COACHING PROMPT FOR THE ROOM: 'Looking at where ${k.pmcName} is on each of these, which one would you most want to move — and what do you think is getting in the way?' Then connect their answer to specific Flex levers: low engagement -> D2C marketing, low adoption -> property-level activation, low repeat usage -> resident communication cadence, low penetration -> portfolio expansion.`,
  ];
}

function notesExpansionBottomLine(k: SpeakerNotesKpis, b: SpeakerNotesBenchmark): string[] {
  const p50 = b.p50Nar ?? b.benchmarkNar ?? 0.085;
  const above = k.currentNar >= p50;
  return [
    "This slide is the KPI tile grid, not a two-panel layout — lifetime rent up top, then tiles for properties, residents paying, new residents, adoption rate, true repeat rate, and delinquency shielded. Each tile carries a trend sparkline and a change pill vs. the comparison period you picked when generating the deck.",
    "Lead with lifetime rent and adoption rate — those are the anchor numbers. Use the tiles as proof of what Flex has already delivered, then pivot immediately: 'here's what more of this looks like across the rest of the portfolio.'",
    `Adoption rate framing: ${k.pmcName} is ${above ? "above" : "below"} the peer median (${pctStr(p50)}). ` +
      (above
        ? "Use this as validation — they're already outperforming. The ask is: let's extend that to the full portfolio."
        : "Don't dwell on being below median — pivot to 'here's what closing the gap looks like in dollars.'"),
    "If the sparklines or change pills feel like too much detail for this room, both can be hidden live with the buttons on the slide — no need to regenerate the deck.",
    "If the room pushes back on the expansion ask: 'We're not asking you to change what's working — we're asking you to apply it to more doors.'",
  ];
}

function notesExpansionGap(): string[] {
  return [
    "The purple bars show ACTUAL historical monthly rent — this is what really happened as they enrolled each cohort. If you see bumps or dips, those reflect real onboarding events.",
    "The two scenario lines show STEADY-STATE POTENTIAL for the gap (unenrolled) units — not a time-bound forecast. The red dashed line uses peer-median adoption (the conservative case). The purple dashed line uses this PMC's own current rate (the upside if they replicate what they've already proven).",
    "KEY POINT FOR DATA-SKEPTICAL ROOMS: These lines do NOT assume the gap units instantly inherit today's adoption rate. New properties take 12-24 months to ramp. These lines show the destination, not the journey.",
  ];
}

function notesExpansionMetrosight(): string[] {
  return [
    "This slide is third-party validation, not a Flex pitch. MetroSight is an independent multifamily research firm — this data comes from a study of ~75,000 units across flexible rent programs.",
    "The headline stat is resident behavior: a large share of renters are already splitting expenses and would split rent if they could. Flex meets that behavior where it exists — it doesn't create new demand.",
    "Don't over-rotate on the stats. Pick one that resonates for their pain point (vacancy, collections, resident retention) and use that as the anchor.",
  ];
}

function notesTestimonialsStandalone(): string[] {
  return [
    "These quotes come directly from residents and property managers. Let them do the talking.",
    "Read one or two out loud — first person voice lands differently than a chart.",
    "If a quote is from a property manager at one of their properties, call that out: 'This is from your team at [property].' It makes it real.",
    "Good closing slide — ends the meeting on a human note, not a data note.",
  ];
}

// ── dispatch table ───────────────────────────────────────────────────────────

export function getNotesForSlide(
  slideId: number,
  k: SpeakerNotesKpis,
  monthly: SpeakerNotesMonthlyRow[],
  benchmark: SpeakerNotesBenchmark,
): string[] {
  try {
    switch (slideId) {
      case 1: return notesCover(k);
      case 2: return notesKpis(k, monthly);
      case 13: return notesExecSummary(k);
      case 3: return notesBenchmark(k, benchmark);
      case 4: return notesTrend("Active Residents", "billsPaid", k, monthly);
      case 5: return notesTrend("Revenue", "rentPaid", k, monthly);
      case 6: return notesAdoptionTrend(k, monthly);
      case 9: case 11: return notesTopProperties();
      case 10: return notesTopBottom();
      case 14: return notesCohortOverview(k);
      case 15: return notesRetention(monthly);
      case 16: return notesTrend("Active Properties", "propertyCount", k, monthly);
      case 17: return notesTrend("Unit Count", "units", k, monthly);
      case 12: return notesStateBreakdown();
      case 21: return notesPortfolioProjection(k, benchmark);
      case 26: return notesDelinquency(k);
      case 39: return notesHighRentAdoption();
      case 44: return notesMultiBenchmark(k, benchmark);
      case 34: return notesAdoptionOpportunities(k);
      case 47: return notesQbrClose();
      case 52: return notesAnniversary();
      case 53: return notesOffboardedProperties(k);
      case 54: return notesResidentsUnitsRent(monthly);
      case 56: return notesSinceInception(k);
      case 57: return notesCustomerExperience();
      case 58: return notesPropertiesWorthCelebrating(k);
      default: return [];
    }
  } catch {
    return [];
  }
}

// ── Property Reference tab (internal-only, never shown to the partner) ─────────
// Port of Flask's _build_property_reference_table (generator/speaker_notes.py:793) — 7 of its
// 9 columns; see the file-level KNOWN GAP note at the top for Tier/Approval Rate.

interface PropertyReferenceRow {
  propertyName: string;
  units: number;
  billsPaid: number;
  newSignups: number;
  adoptionRate: number;
  rentPaid: number;
  cumRent?: number;
}

function buildPropertyReferenceTable(snapshot: PropertyReferenceRow[] | undefined): string {
  if (!snapshot || snapshot.length === 0) {
    return `<div style="color:#a09cb0;font-size:13px;">No property data available.</div>`;
  }

  const rows = [...snapshot]
    .sort((a, b) => b.billsPaid - a.billsPaid)
    .map((p) => {
      const narColor = p.adoptionRate >= 0.20 ? "#1a9e6a" : p.adoptionRate >= 0.10 ? "#d97706" : "#dc5050";
      return `
        <tr>
          <td data-sort="${_e(p.propertyName)}" style="padding:7px 10px;font-size:12px;">${_e(p.propertyName)}</td>
          <td data-sort="${p.units}" style="padding:7px 10px;font-size:12px;text-align:right;">${p.units.toLocaleString()}</td>
          <td data-sort="${p.billsPaid}" style="padding:7px 10px;font-size:12px;text-align:right;">${p.billsPaid.toLocaleString()}</td>
          <td data-sort="${p.newSignups}" style="padding:7px 10px;font-size:12px;text-align:right;">${p.newSignups.toLocaleString()}</td>
          <td data-sort="${p.adoptionRate}" style="padding:7px 10px;font-size:12px;text-align:right;font-weight:700;color:${narColor};">${pctStr(p.adoptionRate)}</td>
          <td data-sort="${p.rentPaid}" style="padding:7px 10px;font-size:12px;text-align:right;">$${kStr(p.rentPaid)}</td>
          <td data-sort="${p.cumRent ?? p.rentPaid}" style="padding:7px 10px;font-size:12px;text-align:right;color:#6A3DB8;">$${kStr(p.cumRent ?? p.rentPaid)}</td>
        </tr>`;
    })
    .join("");

  const cols = ["Property", "Units", "Paying Residents", "New Signups", "Adoption", "This Month Rent", "Total Rent Paid"];
  const thHtml = cols.map((c, i) => `
    <th onclick="flexNotesSortTable(${i})" id="pr-th-${i}"
        style="padding:7px 10px;text-align:${i === 0 ? "left" : "right"};
               font-size:10px;color:#524e5b;text-transform:uppercase;letter-spacing:0.08em;
               cursor:pointer;user-select:none;white-space:nowrap;">
      ${c}<span id="pr-arrow-${i}" style="display:inline-block;width:12px;"></span>
    </th>`).join("");

  return `
    <div style="margin-bottom:16px;background:#fef2f2;border:1px solid #fca5a5;border-left:4px solid #dc2626;
                border-radius:8px;padding:12px 16px;font-size:12px;color:#7f1d1d;">
      <strong>Internal reference only</strong> — never shown to the partner.
    </div>
    <div style="font-size:11px;color:#a09cb0;margin-bottom:10px;">Click a column header to sort.</div>
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr id="pr-thead" style="border-bottom:2px solid #eceaf2;">${thHtml}</tr></thead>
        <tbody id="pr-tbody">${rows}</tbody>
      </table>
    </div>
    <script>
    function flexNotesSortTable(col) {
      var tbody = document.getElementById('pr-tbody'); if (!tbody) return;
      var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
      var thead = document.getElementById('pr-thead');
      var prevCol = thead.getAttribute('data-sort-col'), prevDir = thead.getAttribute('data-sort-dir');
      var asc = !(String(col) === prevCol && prevDir === 'asc');
      rows.sort(function(a, b) {
        var av = a.children[col].getAttribute('data-sort'), bv = b.children[col].getAttribute('data-sort');
        var an = parseFloat(av), bn = parseFloat(bv);
        var cmp = (!isNaN(an) && !isNaN(bn)) ? (an - bn) : String(av).localeCompare(String(bv));
        return asc ? cmp : -cmp;
      });
      rows.forEach(function(r) { tbody.appendChild(r); });
      thead.setAttribute('data-sort-col', col);
      thead.setAttribute('data-sort-dir', asc ? 'asc' : 'desc');
      for (var i = 0; i < ${cols.length}; i++) {
        var el = document.getElementById('pr-arrow-' + i);
        if (el) el.textContent = (i === col) ? (asc ? '▲' : '▼') : '';
      }
    }
    </script>`;
}

// Tab bar + tab-content wrapper shared by both speaker-notes builders below — port of Flask's
// notes-tab-bar/notes-tab-content CSS + flexNotesTab() JS (generator/speaker_notes.py:961-1010).
function wrapWithPropertyReferenceTabs(talkTrackHtml: string, propertyReferenceHtml: string): string {
  return `
  <div class="notes-tab-bar">
    <button class="notes-tab-btn is-active" id="notes-tab-btn-talktrack" onclick="flexNotesTab('talktrack')">Talk Track</button>
    <button class="notes-tab-btn" id="notes-tab-btn-propref" onclick="flexNotesTab('propref')">Property Reference</button>
  </div>
  <div class="notes-tab-content is-active" id="notes-tab-talktrack">
    ${talkTrackHtml}
  </div>
  <div class="notes-tab-content" id="notes-tab-propref">
    ${propertyReferenceHtml}
  </div>
  <script>
  function flexNotesTab(name) {
    ['talktrack', 'propref'].forEach(function(n) {
      document.getElementById('notes-tab-' + n).classList.toggle('is-active', n === name);
      document.getElementById('notes-tab-btn-' + n).classList.toggle('is-active', n === name);
    });
  }
  </script>`;
}

const NOTES_TAB_STYLE = `
  .notes-tab-bar { display: flex; gap: 8px; margin-bottom: 24px; }
  .notes-tab-btn {
    padding: 8px 16px; border-radius: 7px; border: 1px solid #eceaf2; background: #fff;
    color: #524e5b; font-size: 13px; font-weight: 600; cursor: pointer;
    font-family: 'Helvetica Neue', Arial, sans-serif;
  }
  .notes-tab-btn.is-active { background: #8d70ee; border-color: #8d70ee; color: #fff; }
  .notes-tab-content { display: none; }
  .notes-tab-content.is-active { display: block; }
  @media print {
    .notes-tab-bar { display: none; }
    .notes-tab-content { display: block !important; }
  }`;

// ── Expansion deck notes dispatch ────────────────────────────────────────────
// Expansion's own slide keys (get-pmc-monthly-report.ts's EXPANSION_SLIDE_ORDER) are strings,
// not the numeric Flask IDs above — and critically, several numeric IDs mean something
// DIFFERENT in expansion mode than in QBR mode (e.g. Flask's own sid 47 is QBR Close in QBR
// mode but MetroSight in expansion mode), so this can't safely share getNotesForSlide's numeric
// switch. Separate string-keyed dispatch avoids reproducing that collision.

// Exported so get-pmc-monthly-report.ts can reuse the same labels for the "N slides didn't
// render" notice (Kevin's ask) instead of maintaining a second copy of these strings.
export const EXPANSION_SLIDE_TITLES: Record<string, string> = {
  cover: "Cover",
  exec_bottom_line: "Executive Summary & The Case for Expanding",
  by_state: "Adoption by State",
  residents_units: "Residents, Units & Rent",
  adoption_trend: "Adoption Rate Trend",
  cohort_overview: "Cohort Overview",
  peer_benchmarks: "Performance Benchmarks",
  retention: "Retention",
  high_rent: "Flex Is for Everyone",
  delinquency: "Delinquency",
  expansion_metrosight: "Research: What Flexible Rent Does",
  expansion_gap: "Portfolio Gap — Path to Full Portfolio",
  testimonials: "Customer Testimonials",
  expansion_case_close: "The Case for Expanding — Close",
};

export function getNotesForExpansionSlide(
  key: string,
  k: SpeakerNotesKpis,
  monthly: SpeakerNotesMonthlyRow[],
  benchmark: SpeakerNotesBenchmark,
): string[] {
  try {
    switch (key) {
      case "cover": return notesCoverExpansion(k);
      case "exec_bottom_line": return notesExpansionBottomLine(k, benchmark);
      case "by_state": return notesStateBreakdown();
      case "residents_units": return notesResidentsUnitsRent(monthly);
      case "adoption_trend": return notesAdoptionTrend(k, monthly);
      case "cohort_overview": return notesCohortOverview(k);
      case "peer_benchmarks": return notesMultiBenchmark(k, benchmark);
      case "retention": return notesRetention(monthly);
      case "high_rent": return notesHighRentAdoption();
      case "delinquency": return notesDelinquency(k);
      case "expansion_metrosight": return notesExpansionMetrosight();
      case "expansion_gap": return notesExpansionGap();
      case "testimonials": return notesTestimonialsStandalone();
      // No Flask reference notes exist for the mandatory close slide either (Flask's own
      // dispatch table has no entry for render_expansion_case_close's slide id) — matching
      // that rather than inventing content Flask itself doesn't have.
      default: return [];
    }
  } catch {
    return [];
  }
}

export function buildExpansionSpeakerNotesHtml(
  slideKeysInOrder: string[],
  k: SpeakerNotesKpis,
  monthly: SpeakerNotesMonthlyRow[],
  benchmark: SpeakerNotesBenchmark,
  propertySnapshot?: PropertyReferenceRow[],
): string {
  const pmc = _e(k.pmcName);
  const reportMonth = monthStr(k.reportingMonth);
  const stage = stageOf(k.monthsSinceLaunch);
  const stageLabel = { new: "New Partner", growing: "Growing Partner", established: "Established Partner" }[stage];
  const stageColor = { new: "#1a9e6a", growing: "#d97706", established: "#6A3DB8" }[stage];

  const sections: string[] = [];
  let slideCounter = 0;
  for (const key of slideKeysInOrder) {
    const title = EXPANSION_SLIDE_TITLES[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const notes = getNotesForExpansionSlide(key, k, monthly, benchmark);
    if (notes.length === 0) continue;
    slideCounter++;
    const bullets = notes.map((n) => `<li style="margin-bottom:10px;line-height:1.55;">${_e(n)}</li>`).join("");
    sections.push(`
    <div class="section" style="page-break-inside:avoid;margin-bottom:32px;padding-bottom:28px;border-bottom:1px solid #eceaf2;">
      <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:12px;">
        <span style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;
                     color:#8d70ee;background:#f0edff;border-radius:99px;padding:3px 10px;flex-shrink:0;">
          Slide ${slideCounter}
        </span>
        <span style="font-size:16px;font-weight:600;color:#1d1d1d;">${_e(title)}</span>
      </div>
      <ul style="margin:0;padding-left:20px;color:#2C194D;font-size:14px;">
        ${bullets}
      </ul>
    </div>`);
  }

  const talkTrackHtml = sections.join("\n");
  const propertyReferenceHtml = buildPropertyReferenceTable(propertySnapshot);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${pmc} — Expansion Speaker Notes — ${reportMonth}</title>
<style>
  @page { size: letter; margin: 0.75in; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1d1d1d; font-size: 13px; line-height: 1.5; }
  .header { border-bottom: 2px solid #8d70ee; padding-bottom: 16px; margin-bottom: 32px; }
  .callout {
    display: inline-block; padding: 3px 10px; border-radius: 99px; font-size: 11px; font-weight: 700;
    letter-spacing: 0.08em; text-transform: uppercase; color: ${stageColor}; border: 1px solid ${stageColor};
    margin-top: 6px;
  }
  @media print { .section { page-break-inside: avoid; } }
  ${NOTES_TAB_STYLE}
</style>
</head>
<body>
  <div class="header">
    <div style="font-size:11px;font-weight:600;letter-spacing:0.15em;text-transform:uppercase;color:#8d70ee;margin-bottom:4px;">
      Flex &middot; Expansion Speaker Notes
    </div>
    <div style="font-size:24px;font-weight:700;letter-spacing:-0.02em;color:#1d1d1d;">${pmc}</div>
    <div style="font-size:14px;color:#524e5b;margin-top:4px;">${reportMonth} Expansion Conversation</div>
    <div class="callout">${stageLabel} &middot; ${k.monthsSinceLaunch} months on Flex</div>
    <div style="margin-top:12px;font-size:12px;color:#a09cb0;font-style:italic;">
      Confidential &mdash; for internal use only. Print before the meeting or keep open on a second screen.
    </div>
  </div>
  <div style="background:#f8f7ff;border:1px solid #ede9fe;border-radius:10px;padding:18px 22px;margin-bottom:32px;">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#6A3DB8;margin-bottom:10px;">How to Frame This Conversation</div>
    <ul style="margin:0;padding-left:20px;color:#2C194D;font-size:13.5px;">
      <li style="margin-bottom:8px;line-height:1.55;">This is an expansion conversation, not a performance review. Every slide exists to build one case: what's already working can work for the rest of the portfolio.</li>
      <li style="margin-bottom:8px;line-height:1.55;">Lead with proof, then pivot immediately: open each performance slide with what's working today, then translate it into "here's what more of this looks like" - don't let the room settle into review mode.</li>
      <li style="margin-bottom:8px;line-height:1.55;">The ask is the throughline, not one slide. Point back to it after every strong number: "that's exactly why the rest of the portfolio should look like this."</li>
      <li style="margin-bottom:8px;line-height:1.55;">If a metric is below benchmark or declining, don't dwell on it as a report card - reframe as headroom: "here's what closing that gap is worth."</li>
      <li style="margin-bottom:0;line-height:1.55;">Close on the ask, not a recap. The room should leave with a specific next step - which properties, what timeline - not a summary of the meeting.</li>
    </ul>
  </div>
  ${wrapWithPropertyReferenceTabs(talkTrackHtml, propertyReferenceHtml)}
</body>
</html>`;
}

// ── HTML builder ─────────────────────────────────────────────────────────────

export function buildSpeakerNotesHtml(
  slideIdsInOrder: number[],
  k: SpeakerNotesKpis,
  monthly: SpeakerNotesMonthlyRow[],
  benchmark: SpeakerNotesBenchmark,
  preMeetingFlags?: string[],
  propertySnapshot?: PropertyReferenceRow[],
): string {
  const pmc = _e(k.pmcName);
  const reportMonth = monthStr(k.reportingMonth);
  const stage = stageOf(k.monthsSinceLaunch);
  const stageLabel = { new: "New Partner", growing: "Growing Partner", established: "Established Partner" }[stage];
  const stageColor = { new: "#1a9e6a", growing: "#d97706", established: "#6A3DB8" }[stage];

  const sections: string[] = [];
  let slideCounter = 0;
  for (const sid of slideIdsInOrder) {
    const title = SLIDE_TITLES[sid] ?? `Slide ${sid}`;
    const notes = getNotesForSlide(sid, k, monthly, benchmark);
    if (notes.length === 0) continue;
    slideCounter++;
    const bullets = notes.map((n) => `<li style="margin-bottom:10px;line-height:1.55;">${_e(n)}</li>`).join("");
    sections.push(`
    <div class="section" style="page-break-inside:avoid;margin-bottom:32px;padding-bottom:28px;border-bottom:1px solid #eceaf2;">
      <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:12px;">
        <span style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;
                     color:#8d70ee;background:#f0edff;border-radius:99px;padding:3px 10px;flex-shrink:0;">
          Slide ${slideCounter}
        </span>
        <span style="font-size:16px;font-weight:600;color:#1d1d1d;">${_e(title)}</span>
      </div>
      <ul style="margin:0;padding-left:20px;color:#2C194D;font-size:14px;">
        ${bullets}
      </ul>
    </div>`);
  }

  const preMeetingHtml = preMeetingFlags && preMeetingFlags.length > 0
    ? `<div style="margin-bottom:28px;background:#fef2f2;border:1px solid #fca5a5;border-left:4px solid #dc2626;border-radius:8px;padding:14px 18px;font-size:13px;color:#7f1d1d;">
         <div style="font-weight:700;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:10px;">⚠ Pre-Meeting Checks</div>
         ${preMeetingFlags.map((f) => `<div style="margin-bottom:6px;">• ${_e(f)}</div>`).join("")}
       </div>`
    : "";

  const talkTrackHtml = `${preMeetingHtml}\n${sections.join("\n")}`;
  const propertyReferenceHtml = buildPropertyReferenceTable(propertySnapshot);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${pmc} — Speaker Notes — ${reportMonth}</title>
<style>
  @page { size: letter; margin: 0.75in; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1d1d1d; font-size: 13px; line-height: 1.5; }
  .header { border-bottom: 2px solid #8d70ee; padding-bottom: 16px; margin-bottom: 32px; }
  .callout {
    display: inline-block; padding: 3px 10px; border-radius: 99px; font-size: 11px; font-weight: 700;
    letter-spacing: 0.08em; text-transform: uppercase; color: ${stageColor}; border: 1px solid ${stageColor};
    margin-top: 6px;
  }
  @media print { .section { page-break-inside: avoid; } }
  ${NOTES_TAB_STYLE}
</style>
</head>
<body>
  <div class="header">
    <div style="font-size:11px;font-weight:600;letter-spacing:0.15em;text-transform:uppercase;color:#8d70ee;margin-bottom:4px;">
      Flex &middot; Speaker Notes
    </div>
    <div style="font-size:24px;font-weight:700;letter-spacing:-0.02em;color:#1d1d1d;">${pmc}</div>
    <div style="font-size:14px;color:#524e5b;margin-top:4px;">${reportMonth} Business Review</div>
    <div class="callout">${stageLabel} &middot; ${k.monthsSinceLaunch} months on Flex</div>
    <div style="margin-top:12px;font-size:12px;color:#a09cb0;font-style:italic;">
      Confidential &mdash; for internal use only. Print before the meeting or keep open on a second screen.
    </div>
  </div>
  ${wrapWithPropertyReferenceTabs(talkTrackHtml, propertyReferenceHtml)}
</body>
</html>`;
}

// ── Prospect / New Logo speaker notes ───────────────────────────────────────
// Port of Flask's build_prospect_speaker_notes_html. Keyed by the prospect deck's real string
// slide keys (cover/peer_perf/peer_retention/high_rent/ramp/metrosight/market_map/testimonials/
// close — see get-prospect-deck.ts's `slides.push({ key: ... })` call sites), not the numeric
// Flask IDs the QBR notes above use. Not ported: "embed" (render_embed_activation isn't called
// anywhere in this TS port yet) and "projection" (no separate portfolio-projection slide in the
// prospect deck here — projection content lives inside the ramp slide instead).

export interface ProspectSpeakerNotesInput {
  name: string;
  poolSize: number;
  medianNar: number;
  matchLevel: string;
  ownAvgRent: number | null;
  medianAvgRent: number;
}

export function buildProspectSpeakerNotesHtml(
  slideKeysInOrder: string[],
  input: ProspectSpeakerNotesInput,
): string {
  const { name, poolSize, medianNar, ownAvgRent, medianAvgRent } = input;
  const matchLevel = input.matchLevel || "portfolio size and average rent";

  const rentSource = ownAvgRent
    ? `the average rent you told us ($${ownAvgRent.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo)`
    : `the peer group's median rent ($${medianAvgRent.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo, since none was provided)`;
  const calcExplainer =
    `HOW THE DOLLAR FIGURES ARE CALCULATED (say this if asked, don't lead with it): ` +
    `peer adoption rate x ${rentSource} x ${name}'s total units. That's it — three inputs, no modeling. ` +
    `Toggling Median/Average/Top 25% in the footer changes only the adoption-rate input; the rent and unit-count inputs stay fixed.`;

  const marketRentSource = ownAvgRent
    ? `your average rent input ($${ownAvgRent.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo) — the same number used everywhere else in this deck`
    : "that specific market's own real average rent (rent paid/mo divided by active users there) — NOT the peer-group median used elsewhere in this deck, since you didn't give us your own rent";
  const marketMapCalcExplainer =
    `HOW THE GREEN GUARANTEE BULLET IS CALCULATED (say this if asked): your units in that specific market x ${marketRentSource} x that market's own real adoption rate, annualized.`;

  const NOTES: Record<string, string[]> = {
    cover: [
      "Open with the headline number — that's your hook. Don't explain it yet, just let it land.",
      "This is a data story. Everything comes from comparable PMCs. You're not making promises, you're showing what's already happening.",
      "Ask: 'Does this number surprise you?' Let them respond before you move on.",
      calcExplainer,
    ],
    peer_perf: [
      `These are ${poolSize} PMCs matched to ${name} — real criteria: ${matchLevel}. PMS and asset type are NOT matching criteria (this pool is PMS-agnostic); don't claim otherwise if asked. All identifiers are redacted.`,
      `Median adoption is ${(medianNar * 100).toFixed(1)}% — roughly 1 in ${Math.max(1, Math.round(1 / Math.max(medianNar, 0.01)))} units. Walk through one row to make it concrete.`,
      "The delinquency protection column shows rent that was guaranteed even when a resident missed a payment. That's a value prop most PMCs haven't thought about.",
      "If they ask 'how long does it take to get there?' — point to the Live column. Median is 65 months. These companies have been doing this for years.",
    ],
    peer_retention: [
      "This is for the skeptic who says residents will try it once and stop. The answer is in this slide.",
      "94% of residents who paid through Flex in one month paid through it again the next month. That's not a trial product.",
      "The bar chart shows 6 consecutive months of stability. It's a habit, not an experiment.",
      "The new sign-ups number (+2/property/month) means the user base is growing on top of a stable base. Compounding.",
    ],
    high_rent: [
      "Address the 'our residents can afford rent, they don't need this' objection head-on.",
      "The chart shows Flex usage across all rent levels. Lower-rent residents use it more — the timing problem is more acute when budgets are tighter.",
      "But even at $2,000+/month rent, 8% of units have active Flex residents. That's not a product for struggling renters.",
      "The real driver is timing: payday falls on the 15th, rent is due on the 1st. That gap exists at every income level. It's structural, not financial.",
    ],
    ramp: [
      "This is the ramp curve from comparable rollouts. It tells the prospect what their first year actually looks like.",
      "Month 3 is around 4% adoption. Month 12 is around 6%. Top performers are in the 10-14% range.",
      "Walk through one milestone card. 'At month 6, comparable PMCs of your size are guaranteeing $5M/month in rent.' Make it specific.",
      "Don't promise top-quartile. Promise the median. The upside is theirs to earn.",
      calcExplainer.replace("HOW THE DOLLAR FIGURES ARE CALCULATED", "METHODOLOGY NOTE (for the detail-oriented person in the room)") +
        (ownAvgRent
          ? " If they want an even more tailored number, you already have their real rent — no follow-up needed."
          : " If they want a more precise projection, invite them to share their portfolio's avg rent: 'If you send us your average rent by property, we can run a tailored projection in 24 hours.' That's a great follow-up ask."),
      "RESULTS VARY: These are peer medians, not guarantees. Individual results depend on marketing activation, resident communication, and property mix. The curve shows what's typical — what they actually achieve is largely up to them.",
    ],
    metrosight: [
      "MetroSight is an independent research firm — this is not Flex's own data. That matters when someone pushes back on the numbers.",
      "The three findings on this slide are the high-confidence ones: on-time payments (+3.0pp), vacancy reduction (2.1 fewer per 100), and longer resident tenure (+3.7 months). Don't cite NOI — the confidence interval is too wide to defend.",
      "The tenure math, if they ask: residents with Flex average 27.9 months before moving vs. 24.2 months baseline — a +3.7 month difference. Annual turnover rate drops from ~49.6% per unit (1 ÷ 24.2mo × 12) to ~43.0% (1 ÷ 27.9mo × 12). That 6.6pp gap, applied across their full portfolio, is where the 'fewer turns' number comes from.",
      "Frame it as: 'These are peer outcomes, not projections. This is what's already happening at PMCs that look like yours.'",
    ],
    market_map: [
      "Transition from the ramp curve: 'So where do we start? These are the markets with your biggest opportunity.' Only shown once, here on the first market map slide — the same talking points apply to every market slide that follows, no need to repeat this per market.",
      "Markets are ordered by projected $ opportunity, highest first — this first market slide IS the biggest number, not buried later in the deck.",
      "The stats on the right (properties, active residents, adoption rate, rent guaranteed) describe Flex's ENTIRE real network in that market — a real, uncapped count from our data, not just what's plotted on the map.",
      "The map itself only plots up to 300 representative pins for readability — it is NOT every property in the market. The map's own legend caption says exactly how many aren't pictured; don't imply the dots are a literal count if asked.",
      "PULL ON THE FOMO ANGLE HERE — this is the strongest emotional beat in the whole deck. Point at the map: 'Look at all these properties around you already on Flex.' Then the 'New to Flex this year' bullet is your proof it's accelerating, not old news. The density on the map is the argument; let them look at it for a second before you talk over it.",
      marketMapCalcExplainer,
      "If this is a national portfolio with more than 5 qualifying markets, only the top 5 by $ opportunity are visible by default — the rest are further back in the deck, just hidden. Unhide any of them before the meeting if you want to show more than the top 5.",
    ],
    testimonials: [
      "These quotes come directly from residents and property managers. Let them do the talking.",
      "Read one or two out loud — first person voice lands differently than a chart.",
      "Good closing-adjacent slide — ends the meeting on a human note, not a data note.",
    ],
    close: [
      "This is a closing slide, not a data slide. Slow down. Let the room breathe.",
      "It's deliberately just the four-step path to go live (FSA → intake forms → team training → live) — the MetroSight outcomes and peer-adoption numbers were already covered on their own dedicated slides earlier, so this slide doesn't repeat them.",
      "Stress that the go-live timeline is fast: 24–48 hours after setup is complete. The FSA is the only required document to kick things off.",
      "If they ask 'how did you get to the numbers earlier' at this point, refer back to the Peer Proof/Ramp slides rather than re-deriving anything here.",
      "Ideal close: 'The FSA is two pages. We can send it today. What would you need to see to feel comfortable moving forward?'",
    ],
  };

  const titleMap: Record<string, string> = {
    cover: "Cover",
    peer_perf: "What PMCs Like Yours Are Pulling Through Flex",
    peer_retention: "Once Residents Try Flex, They Keep Using It",
    high_rent: "Flex Users Span Every Rent Level",
    ramp: "The Ramp — What Your First Year Looks Like",
    testimonials: "Testimonials",
    metrosight: "Applied to Your Portfolio — MetroSight Research",
    market_map: "Market Map — Your Biggest Opportunities",
    close: "What's Next — Closing Slide",
  };

  const sections: string[] = [];
  let marketMapNotesShown = false;
  slideKeysInOrder.forEach((key, i) => {
    if (key === "market_map") {
      if (marketMapNotesShown) return;
      marketMapNotesShown = true;
    }
    const notes = NOTES[key];
    if (!notes) return;
    const title = titleMap[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const bullets = notes.map((n) => `<li style="margin-bottom:12px;line-height:1.65;">${_e(n)}</li>`).join("");
    sections.push(`
    <div style="page-break-inside:avoid;margin-bottom:32px;padding-bottom:28px;border-bottom:1px solid #eceaf2;">
      <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:12px;">
        <span style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#8d70ee;background:#f0edff;border-radius:99px;padding:3px 10px;flex-shrink:0;">
          Slide ${i + 1}
        </span>
        <span style="font-size:16px;font-weight:600;color:#1d1d1d;">${_e(title)}</span>
      </div>
      <ul style="margin:0;padding-left:20px;color:#2C194D;font-size:14px;">${bullets}</ul>
    </div>`);
  });

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8">
<title>${_e(name)} — Speaker Notes</title>
<style>
  @page { size: letter; margin: 0.75in; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1d1d1d; font-size: 13px; line-height: 1.5; }
  .header { border-bottom: 2px solid #8d70ee; padding-bottom: 16px; margin-bottom: 32px; }
  @media print { div { page-break-inside: avoid; } }
</style>
</head>
<body>
  <div class="header">
    <div style="font-size:11px;font-weight:600;letter-spacing:0.15em;text-transform:uppercase;color:#8d70ee;margin-bottom:4px;">Flex &middot; New Logo Speaker Notes</div>
    <div style="font-size:24px;font-weight:700;color:#1d1d1d;">${_e(name)}</div>
    <div style="margin-top:10px;font-size:12px;color:#a09cb0;font-style:italic;">Confidential &mdash; for internal use only. Print before the meeting or keep open on a second screen.</div>
  </div>
  ${sections.join("\n")}
</body>
</html>`;
}
