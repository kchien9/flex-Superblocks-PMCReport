/**
 * Speaker notes generator for PMC QBR presentations — port of Flask's
 * generator/speaker_notes.py (build_speaker_notes_html + per-slide _notes_* functions).
 * Produces a printable HTML script with stage-aware talking points per slide, matching the
 * "Slide Deck" download pattern (returned as an HTML string, downloaded client-side as a
 * data URI — no server-side file storage needed).
 *
 * Not yet ported from Flask: the "Property Reference" internal tab (tier/approval-rate table
 * — needs fields not yet threaded into this port's property snapshot) and the cohort
 * standout-segment insight callouts (detect_standout_segments/pull_cohort_deal_tags — a
 * separate analysis pass Flask runs before notes generation). Both are safe, additive
 * follow-ups — their absence just means a slightly shorter notes doc, not a wrong one.
 */

function _e(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function pctStr(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
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
  4: "Active Households Over Time", 5: "Revenue Trend", 6: "Adoption Rate Trend",
  7: "New vs. Returning Households", 8: "Engagement Funnel",
  9: "Top Properties by Active Households", 10: "Top & Bottom Performers",
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
  57: "Customer Experience", 58: "Properties Worth Celebrating", 59: "Multiple Payments Update",
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
    `${k.pmcName} is at ${pctStr(k.currentNar)} adoption this month — that's ${kStr(k.currentBillsPaid)} households actively paying rent through Flex.`,
    `${kStr(k.currentNewSignups)} new households enrolled this month.`,
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
  const notes = [
    "Solid purple is the portfolio's adoption rate. Grey dashed is the peer median — comparable PMCs at the same calendar months, not a fixed target.",
    "If a third, lighter line appears, that's the established-cohort rate — properties past their first rollout month. A gap between that and the solid line means new-property rollouts are still diluting the portfolio number, which is a sign of growth, not underperformance.",
  ];
  if (monthly.length >= 2) {
    const last = monthly[monthly.length - 1];
    const lastNar = last.units > 0 ? last.billsPaid / last.units : 0;
    notes.push(`Current adoption: ${pctStr(lastNar)} overall.`);
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

function notesNewVsRecurring(monthly: SpeakerNotesMonthlyRow[]): string[] {
  const notes = [
    "This shows the mix of new vs. returning households each month. 'Recurring' means any resident who has used Flex before — it's not their first payment.",
    "A healthy portfolio shows a growing recurring base month-over-month. New signups are acquisition; recurring is retention.",
  ];
  if (monthly.length >= 2) {
    const last = monthly[monthly.length - 1];
    const recur = Math.max(0, last.billsPaid - last.newSignups);
    if (last.billsPaid > 0) notes.push(`This month: ${pctStr(recur / last.billsPaid)} of paying households are returning — ${kStr(recur)} of ${kStr(last.billsPaid)} total.`);
  }
  notes.push("If recurring is declining: worth investigating whether specific properties have churn or if new signups are slowing.");
  return notes;
}

function notesTopProperties(): string[] {
  return [
    "These are your top properties by active households this month.",
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
    "Retention here means: of households who paid with Flex last month, what share paid again this month?",
    "This is one of the stickiest metrics — high retention means residents have built Flex into their routine. Low retention means something is interrupting the habit.",
    "The loyalty tier breakdown (left panel) measures each resident's consistency over their full history: months they paid Flex divided by months Flex was available to them since their first payment. Perfect = every single month; Episodic = less than half.",
  ];
  if (monthly.length >= 2) {
    const last = monthly[monthly.length - 1];
    const prev = monthly[monthly.length - 2];
    const recur = Math.max(0, last.billsPaid - last.newSignups);
    if (prev.billsPaid > 0) notes.push(`Current repeat usage: roughly ${pctStr(recur / prev.billsPaid)} of last month's transacting users (unique payers) paid again this month.`);
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
    `Closing the gap requires roughly ${kStr(gapResidents)} more active households. That's the prize — use it to make the opportunity feel concrete, not abstract.`,
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

function notesDelinquency(): string[] {
  return [
    "This slide shows Flex's delinquency shield: rent Flex guaranteed to you for residents who fell behind, and how much has been recovered.",
    "Lead with the protection angle — Flex absorbed this risk so the PMC didn't have to.",
    "If they ask about recovery rates: Flex pursues repayment from residents; the PMC is made whole regardless of outcome.",
    "This data is typically most relevant for PMCs with higher-risk resident profiles or in markets with higher delinquency rates.",
  ];
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
    "HOW TO USE IT: Don't read the list top-to-bottom. Lead with the largest opportunity. 'If we could move [property] from X% to median, that's roughly Y more households on Flex every month.'",
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
      case 4: return notesTrend("Active Households", "billsPaid", k, monthly);
      case 5: return notesTrend("Revenue", "rentPaid", k, monthly);
      case 6: return notesAdoptionTrend(k, monthly);
      case 7: return notesNewVsRecurring(monthly);
      case 9: case 11: return notesTopProperties();
      case 10: return notesTopBottom();
      case 14: return notesCohortOverview(k);
      case 15: return notesRetention(monthly);
      case 16: return notesTrend("Active Properties", "propertyCount", k, monthly);
      case 17: return notesTrend("Unit Count", "units", k, monthly);
      case 21: return notesPortfolioProjection(k, benchmark);
      case 26: return notesDelinquency();
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

// ── HTML builder ─────────────────────────────────────────────────────────────

export function buildSpeakerNotesHtml(
  slideIdsInOrder: number[],
  k: SpeakerNotesKpis,
  monthly: SpeakerNotesMonthlyRow[],
  benchmark: SpeakerNotesBenchmark,
  preMeetingFlags?: string[],
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
  ${preMeetingHtml}
  ${sections.join("\n")}
</body>
</html>`;
}
