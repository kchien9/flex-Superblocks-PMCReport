/**
 * Additional slide renderers for PMC Monthly Report.
 * Each function returns { html, js } matching the deck assembly pattern.
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

const PURPLE = "#6A3DB8";
const NAVY = "#2C194D"; // deck's one standard navy (was #1e1145 — a darker, off-brand shade)
const GRAY = "#6b7280";

function _e(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtPct(n: number): string {
  // Drop the trailing ".0" on a whole-number percent (Kevin's catch: "85%", not "85.0%") -
  // same fix as get-pmc-monthly-report.ts's own fmtPct, just never ported to this file.
  const s = (n * 100).toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) + "%" : s + "%";
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(m, 10) - 1]} ${y}`;
}

const _TREND_BASIS_LABEL: Record<string, string> = {
  yoy: "(YoY)",
  peak: "(vs peak)",
  outperform: "(6mo)",
};

function _trendBadgeHtml(flag: { direction: string; basis: string; referenceNar: number | null; currentNar: number | null; referenceWindow?: string | null; pctChange?: number }, monthsLive?: number): string {
  const { direction, basis, referenceNar, currentNar, referenceWindow } = flag;
  if (direction !== "decline" && direction !== "improve") return "";
  // Copy-tone for "outperform": <24mo property age → ramp language; ≥24mo → recency language
  const basisLabel = basis === "outperform"
    ? (monthsLive != null && monthsLive < 24 ? "(vs. typical ramp for its size)" : "(in the last 6mo)")
    : (_TREND_BASIS_LABEL[basis] || "");
  let title = "";
  const hasRef = referenceNar != null && currentNar != null;
  if (basis === "outperform" && hasRef) {
    const gainPp = (currentNar! - referenceNar!) * 100;
    title = `Over the last 6 months, this property's 3-month-average adoption grew from ${(referenceNar! * 100).toFixed(1)}% to ${(currentNar! * 100).toFixed(1)}% (${gainPp >= 0 ? "+" : ""}${gainPp.toFixed(1)}pp)`;
  } else if (basis === "peak" && hasRef) {
    const windowTxt = referenceWindow ? ` (${referenceWindow})` : "";
    title = `This property peaked at ${(referenceNar! * 100).toFixed(1)}%${windowTxt} and has since dropped to ${(currentNar! * 100).toFixed(1)}%`;
  } else if (basis === "yoy" && hasRef) {
    const windowTxt = referenceWindow ? ` (${referenceWindow})` : "";
    title = `This property was at ${(referenceNar! * 100).toFixed(1)}% this time last year${windowTxt} — now ${(currentNar! * 100).toFixed(1)}%`;
  }
  const [arrow, label, color, bg, border] = direction === "decline"
    ? ["▼", "declining", "#b91c1c", "#fef2f2", "#fecaca"]
    : ["▲", "improving", "#15803d", "#f0fdf4", "#bbf7d0"];
  return `<span class="trend-badge" style="font-size:8px;font-weight:600;color:${color};background:${bg};border:1px solid ${border};border-radius:3px;padding:1px 5px;margin-left:5px;vertical-align:middle;" title="${_e(title)}">${arrow} ${label} ${basisLabel}</span>`;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MonthlyTotal {
  month: string;
  billsPaid: number;
  units: number;
  rentPaid: number;
  newSignups: number;
  /** Distinct from billsPaid — feeds the MoM-retention fallback (see renderQbrClose), which
   * prefers this over billsPaid when available, matching Flask's monthly.get("charged_users",
   * monthly.get("bills_paid", 0)). */
  chargedUsers?: number;
  adoptionRate: number;
  propertyCount: number;
}

export interface SlideResult {
  html: string;
  js: string;
}

export interface AdoptionTrendMonthly {
  month: string;
  adoptionRate: number;
  establishedNar?: number;
  propertyCount?: number;
}

// ─── render_metrosight_evidence (Slide 50 - "Rethinking Rent") ──────────────

export interface MetrosightInput {
  slideId: number;
  pmcName: string;
  totalUnits: number;
  avgRent: number;
}

export function renderMetrosightEvidence(input: MetrosightInput): SlideResult {
  const { slideId, pmcName, totalUnits, avgRent: rawAvgRent } = input;
  const refUnits = totalUnits >= 50 ? totalUnits : 300;
  const portfolioLabel = totalUnits >= 50 ? `${totalUnits.toLocaleString()}-unit portfolio` : "300-unit portfolio (example)";
  const avgRent = rawAvgRent > 0 ? rawAvgRent : 1500;

  // Local currency formatter matching slides_prospect.py _fmt_dollars (lowercase k, 1 decimal)
  const fmtDollars = (n: number): string => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
    return `$${Math.round(n).toLocaleString()}`;
  };

  // Applied numbers
  const fewerLate = Math.max(1, Math.round(refUnits * 0.03));
  const fewerVacant = Math.max(1, Math.round(refUnits / 100 * 2.1));
  const fewerTurns = Math.max(1, Math.round(refUnits * (1 / 24.2 - 1 / 27.9) * 12));
  const vacancyAnnual = fewerVacant * avgRent * 12;
  const turnSaveLo = fewerTurns * 1500;
  const turnSaveHi = fewerTurns * 3500;

  const rightHeader = pmcName ? `Applied to ${_e(pmcName)}` : "Applied to your portfolio";

  const appliedRows = [
    {
      sourceStat: "+3.0 pp", sourceLabel: "on-time payments",
      appliedNum: `~${fewerLate.toLocaleString()}`,
      appliedLabel: "fewer past-due payments per month",
      body: "The study estimated Flex improved on-time payments by 3 pp - each fewer past-due notice means fewer calls, fewer escalations, and one less resident on a path toward move-out.",
    },
    {
      sourceStat: "2.1 fewer / 100", sourceLabel: "vacant units",
      appliedNum: `~${fewerVacant.toLocaleString()}`,
      appliedLabel: "fewer vacant units at any moment",
      body: `At ${_e(fmtDollars(avgRent))}/mo avg rent, those units could represent <b>~${_e(fmtDollars(vacancyAnnual))}</b> in annual revenue that stays on the rent roll instead of sitting empty.`,
    },
    {
      sourceStat: "+3.7 mo", sourceLabel: "longer tenure",
      appliedNum: `~${fewerTurns.toLocaleString()}`,
      appliedLabel: "fewer resident turns per year",
      body: `At $1,500\u2013$3,500 per turn (National Apartment Association), ${fewerTurns.toLocaleString()} fewer turns could save <b>~${_e(fmtDollars(turnSaveLo))}\u2013${_e(fmtDollars(turnSaveHi))}</b> per year in avoided make-ready, concessions, and leasing cost.`,
    },
  ];

  const rightRowsHtml = appliedRows.map(r => `
        <div style="display:flex;gap:0;align-items:stretch;background:#f8f7ff;border:1px solid #ede9fe;border-radius:10px;overflow:hidden;">
          <div style="width:4px;background:${PURPLE};flex-shrink:0;"></div>
          <div style="padding:14px 18px;flex:1;">
            <div style="font-size:10px;color:${PURPLE};font-weight:600;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;">${_e(r.sourceStat)} \u00b7 ${_e(r.sourceLabel)}</div>
            <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px;">
              <div style="font-size:28px;font-weight:700;color:${NAVY};letter-spacing:-0.03em;line-height:1;">${_e(r.appliedNum)}</div>
              <div style="font-size:13px;color:#374151;font-weight:500;">${_e(r.appliedLabel)}</div>
            </div>
            <div style="font-size:12px;color:${GRAY};line-height:1.55;">${r.body}</div>
          </div>
        </div>`).join("");

  const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;flex-direction:row;padding:0;overflow:hidden;">
    <!-- LEFT: study context + raw findings -->
    <div style="width:42%;background:${NAVY};display:flex;flex-direction:column;justify-content:space-between;padding:40px 34px;flex-shrink:0;">
      <div>
        <div style="font-size:10px;font-weight:600;letter-spacing:0.14em;color:rgba(255,255,255,0.40);text-transform:uppercase;margin-bottom:16px;">Flex-commissioned Research</div>
        <div style="font-size:30px;font-weight:700;color:#fff;line-height:1.15;letter-spacing:-0.02em;margin-bottom:6px;">Rethinking Rent</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.42);margin-bottom:16px;">MetroSight \u00b7 June 2026</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.48);line-height:1.6;margin-bottom:24px;">Flex commissioned MetroSight, an independent economic research firm, to study the impact of rent flexibility on multifamily outcomes. The study covered 488 real properties across 25 states, ~75,000 units total.</div>
        <div style="height:1px;background:rgba(255,255,255,0.10);margin-bottom:20px;"></div>
        <div style="font-size:11px;font-weight:600;letter-spacing:0.10em;color:rgba(255,255,255,0.40);text-transform:uppercase;margin-bottom:16px;">What they found</div>
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div style="display:flex;align-items:center;gap:14px;">
            <div style="flex-shrink:0;width:36px;height:36px;border-radius:50%;background:${PURPLE};display:flex;align-items:center;justify-content:center;">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="6.5" stroke="white" stroke-width="1.6"/><path d="M9 6v3.5l2 1.2" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
            <div>
              <div style="font-size:20px;font-weight:700;color:#fff;letter-spacing:-0.02em;line-height:1.1;">+3.0 pp</div>
              <div style="font-size:11.5px;color:rgba(255,255,255,0.55);margin-top:2px;">on-time rent payments</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:14px;">
            <div style="flex-shrink:0;width:36px;height:36px;border-radius:50%;background:${PURPLE};display:flex;align-items:center;justify-content:center;">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2 8.5L9 3l7 5.5V16H12v-4.5H6V16H2V8.5z" stroke="white" stroke-width="1.6" stroke-linejoin="round"/></svg>
            </div>
            <div>
              <div style="font-size:20px;font-weight:700;color:#fff;letter-spacing:-0.02em;line-height:1.1;">2.1 fewer</div>
              <div style="font-size:11.5px;color:rgba(255,255,255,0.55);margin-top:2px;">vacant units per 100 apartments</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:14px;">
            <div style="flex-shrink:0;width:36px;height:36px;border-radius:50%;background:${PURPLE};display:flex;align-items:center;justify-content:center;">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2.5" y="4.5" width="13" height="11" rx="1.5" stroke="white" stroke-width="1.6"/><path d="M2.5 8.5h13M6 2.5v4M12 2.5v4" stroke="white" stroke-width="1.6" stroke-linecap="round"/></svg>
            </div>
            <div>
              <div style="font-size:20px;font-weight:700;color:#fff;letter-spacing:-0.02em;line-height:1.1;">+3.7 mo</div>
              <div style="font-size:11.5px;color:rgba(255,255,255,0.55);margin-top:2px;">longer resident tenure</div>
            </div>
          </div>
        </div>
      </div>
      <div style="margin-top:24px;padding-top:18px;border-top:1px solid rgba(255,255,255,0.12);font-size:11px;color:rgba(255,255,255,0.38);line-height:1.6;font-style:italic;">
        &ldquo;For property operators, longer tenure and lower vacancy can reduce leasing friction, improve revenue predictability, and lower the operating burden associated with replacing residents.&rdquo;
      </div>
      <div style="margin-top:14px;">
        <a class="metrosight-link" href="https://getflex.com/reports/rethinking-rent-report" target="_blank" rel="noopener noreferrer" style="font-size:10.5px;color:rgba(255,255,255,0.5);text-decoration:underline;">Link to full report &rarr;</a>
      </div>
    </div>
    <!-- RIGHT: applied to their portfolio -->
    <div style="flex:1;display:flex;flex-direction:column;padding:36px 38px 28px;">
      <div class="slide-label" style="margin-bottom:6px;">WHAT THIS MEANS FOR YOU</div>
      <div class="slide-title" style="margin-bottom:4px;">${_e(rightHeader)}</div>
      <div style="font-size:13px;color:${GRAY};margin-bottom:18px;">The study's estimates applied to your ${_e(portfolioLabel)}.</div>
      <div style="display:flex;flex-direction:column;gap:10px;flex:1;">
        ${rightRowsHtml}
      </div>
      <div style="margin-top:12px;font-size:10px;color:#9ca3af;line-height:1.5;">
        Projections apply MetroSight matched estimates to portfolio size. Actual results will vary.
      </div>
    </div>
  </div>`;

  return { html, js: "" };
}

// ─────────────────────────────────────────────────────────────────────────
// RENT BUCKETS SLIDE — bar chart showing distribution by rent range
// ─────────────────────────────────────────────────────────────────────────

export interface RentBucketData {
  bucket: string;
  rank: number;
  billsPaid: number;
  rentPaid: number;
  billsPaidPct: number;
  rentPaidPct: number;
}

export function renderRentBuckets(input: {
  slideId: number;
  pmcName: string;
  latestMonth: string;
  buckets: RentBucketData[];
}): SlideResult {
  const { slideId, pmcName, latestMonth, buckets } = input;
  const pmc = _e(pmcName);
  const validBuckets = buckets.filter((b) => b.bucket && b.billsPaid > 0);
  if (validBuckets.length === 0) return { html: "", js: "" };

  const monthLabel = (() => {
    const d = new Date(latestMonth + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  })();

  const chartConfig = JSON.stringify({
    labels: validBuckets.map((b) => b.bucket),
    datasets: [
      {
        label: "Bills Paid %",
        data: validBuckets.map((b) => +(b.billsPaidPct * 100).toFixed(1)),
        backgroundColor: "#8D70EE",
        borderRadius: 4,
      },
      {
        label: "Rent Paid %",
        data: validBuckets.map((b) => +(b.rentPaidPct * 100).toFixed(1)),
        backgroundColor: "#C4B5FD",
        borderRadius: 4,
      },
    ],
  });

  const html = `<section id="slide-${slideId}" class="slide">
  <div style="padding:44px;height:100%;display:flex;flex-direction:column;">
    <div style="font-size:9px;letter-spacing:0.18em;text-transform:uppercase;color:#8D70EE;font-weight:600;margin-bottom:8px;">RENT DISTRIBUTION</div>
    <div style="font-size:28px;font-weight:700;color:#2C194D;line-height:1.2;margin-bottom:4px;">Rent by Bucket</div>
    <div style="font-size:13px;color:#6b7280;margin-bottom:24px;">${pmc} \u00b7 ${monthLabel}</div>
    <div style="flex:1;position:relative;min-height:0;">
      <canvas id="rent-bucket-chart-${slideId}" style="width:100%;height:100%;"></canvas>
    </div>
    <div style="margin-top:16px;display:flex;gap:24px;font-size:11px;color:#6b7280;">
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#8D70EE;margin-right:4px;"></span>Bills Paid %</span>
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#C4B5FD;margin-right:4px;"></span>Rent Paid %</span>
    </div>
  </div>
  </section>`;

  const js = `
(function(){
  var ctx = document.getElementById('rent-bucket-chart-${slideId}');
  if (!ctx) return;
  var cfg = ${chartConfig};
  new Chart(ctx, {
    type: 'bar',
    data: cfg,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: function(v){return v+'%';} }, grid: { color: '#f3f4f6' } },
        x: { grid: { display: false } }
      }
    }
  });
})();`;

  return { html, js };
}

// ─────────────────────────────────────────────────────────────────────────
// NEW VS RECURRING RESIDENTS — stacked bar chart (render_new_vs_recurring)
// ─────────────────────────────────────────────────────────────────────────

interface NewVsRecurringMonth {
  month: string;
  newSignups: number;
  recurring: number;
}

export function renderNewVsRecurring(input: {
  slideId: number;
  monthly: NewVsRecurringMonth[];
  mode?: "came_back" | "consecutive";
}): SlideResult {
  const { slideId, monthly, mode = "came_back" } = input;
  if (monthly.length < 2) return { html: "", js: "" };

  const months = monthly.map((r) => monthLabel(r.month));
  const newVals = monthly.map((r) => r.newSignups);
  const recVals = monthly.map((r) => r.recurring);

  // Compute retention % headline from last 3 months (or last 1 if fewer)
  let slideTitle: string;
  let slideLabel: string;
  let recLabel: string;

  if (mode === "consecutive") {
    slideTitle = "Consecutive Repeat Usage";
    slideLabel = "Loyalty";
    recLabel = "Paid last month too";
  } else {
    slideLabel = "Resident Retention";
    recLabel = "Returning (any prior month)";
    const tail = monthly.slice(-3);
    const qNew = tail.reduce((s, m) => s + m.newSignups, 0);
    const qRec = tail.reduce((s, m) => s + m.recurring, 0);
    const qTot = qNew + qRec;
    const retPct = qTot > 0 ? Math.round((qRec / qTot) * 100) : 0;
    slideTitle = tail.length >= 3
      ? `${retPct}% of this quarter's users have used Flex before.`
      : `${retPct}% of this month's users have used Flex before.`;
  }

  const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;">
    <div class="slide-header">
      <div class="slide-label">${_e(slideLabel)}</div>
      <div class="slide-title">${_e(slideTitle)}</div>
    </div>
    <div class="chart-wrap"><canvas id="chart${slideId}"></canvas></div>
  </div>`;

  const js = `
window['initSlide${slideId}'] = (function() {
  let done = false;
  return function() {
    if (done) return; done = true;
    const newData = ${JSON.stringify(newVals)};
    const recData = ${JSON.stringify(recVals)};
    new Chart(document.getElementById('chart${slideId}'), {
      type: 'bar',
      data: { labels: ${JSON.stringify(months)}, datasets: [
        { label: 'New', data: newData, backgroundColor: 'rgba(106,61,184,0.85)', borderRadius: 6,
           datalabels: {
             color: '#fff', font: { size: 11, weight: '600', family: 'ABCDiatype' },
             anchor: 'center', align: 'center',
             formatter: (value, ctx) => {
               const total = newData[ctx.dataIndex] + recData[ctx.dataIndex];
               const pct = total > 0 ? Math.round(value / total * 100) : 0;
               return value > 0 && pct >= 8 ? pct + '%' : '';
             }
           }
        },
        { label: ${JSON.stringify(recLabel)}, data: recData, backgroundColor: 'rgba(26,158,106,0.80)', borderRadius: 6,
           datalabels: {
             color: '#fff', font: { size: 11, weight: '600', family: 'ABCDiatype' },
             anchor: 'center', align: 'center',
             formatter: (value, ctx) => {
               const total = newData[ctx.dataIndex] + recData[ctx.dataIndex];
               const pct = total > 0 ? Math.round(value / total * 100) : 0;
               return value > 0 && pct >= 8 ? pct + '%' : '';
             }
           }
        }
      ] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: true, labels: { color: '#524e5b', font: { size: 12, family: 'ABCDiatype' } } },
          datalabels: { display: true }
        },
        layout: { padding: { left: 16 } },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: '#524e5b', font: { size: 12, family: 'ABCDiatype' } } },
          y: { stacked: true, beginAtZero: true, grid: { color: '#f3f4f6' }, ticks: { color: '#524e5b', font: { size: 12, family: 'ABCDiatype' } } }
        }
      }
    });
  };
})();`;

  return { html, js };
}

// ─────────────────────────────────────────────────────────────────────────
// PEER BENCHMARKS SLIDE — "How [PMC] stacks up" (render_multi_benchmark)
// 3-column grid: Metric | Your Rate | Peer Distribution slider
// ─────────────────────────────────────────────────────────────────────────

export interface BenchmarkMetric {
  metric: string;
  p25: number;
  p50: number;
  p75: number;
  /** null when there's no real subject value to show (e.g. no trendRawRows data for signup
   * timing) — sliderRow already hides a row whose pmcValue is null; don't default to 0, which
   * would render as a real (misleading) result rather than "no data." */
  pmcValue: number | null;
  /** Optional human label override for the PMC value (e.g. "12" instead of auto-format) */
  pmcLabel?: string;
  /** If absolute value >= this, soften "Bottom quartile" to "Below peers" */
  highAbsThreshold?: number;
  /** True for metrics where a SMALLER number is the better outcome (e.g. time-to-first-signup,
   * lower = faster). Flips which quartile comparison counts as "Top"/"Bottom" — without this,
   * a metric like time-to-signup would show its fastest (best) PMCs as "Bottom quartile" in red. */
  lowerIsBetter?: boolean;
}

interface MetricMeta {
  label: string;
  definition: string;
  format: (v: number) => string;
}

const METRIC_META: Record<string, MetricMeta> = {
  NAR: {
    label: "Adoption Rate",
    definition: "Active Flex users \u00f7 total enrolled units",
    format: (v) => `${(v * 100).toFixed(1)}%`,
  },
  ENGAGEMENT: {
    label: "Engagement (per 100 units)",
    definition: "New bill connections per 100 enrolled units \u2013 trailing 12 months",
    format: (v) => `${Math.round(v * 100)}`,
  },
  REPEAT_RATE: {
    label: "Resident Retention",
    definition: "Of residents who previously used Flex, % who came back \u2013 trailing 12 months",
    format: (v) => `${Math.round(v * 100)}%`,
  },
  NEW_CONNECTIONS: {
    label: "Engagement (per 100 units)",
    definition: "New bill connections per 100 enrolled units \u2013 trailing 12 months",
    format: (v) => `${Math.round(v)}`,
  },
  PENETRATION: {
    label: "Portfolio Penetration",
    definition: "Enrolled units \u00f7 total portfolio units",
    format: (v) => `${Math.round(v * 100)}%`,
  },
  SIGNUP_TIMING: {
    label: "Time to First Sign-Up",
    // Days, not months (Kevin's catch) - real day-level rollout/connection timestamps from
    // RENTERS, not the old BP_MONTH-granularity calc that made every same-month result read
    // as an uninformative "0.0 months" regardless of whether it took 1 day or 29.
    definition: "Avg days from property rollout to first resident bill connection – trailing 12 months",
    format: (v) => `${Math.round(v)} day${Math.round(v) === 1 ? "" : "s"}`,
  },
};

// Display order for the Peer Benchmarks slide (Kevin's call, 2026-08-19): Engagement first,
// then Adoption, Retention, Penetration. Anything not in this list (shouldn't happen given
// METRIC_META above, but keeps this future-proof) sorts to the end in its original order.
const METRIC_DISPLAY_ORDER = ["NEW_CONNECTIONS", "ENGAGEMENT", "NAR", "REPEAT_RATE", "PENETRATION", "SIGNUP_TIMING"];

export function renderPeerBenchmarks(input: {
  slideId: number;
  pmcName: string;
  segment: string;
  metrics: BenchmarkMetric[];
  peerCount?: number;
  /** Which optional metric keys to show initially (null = show all). Adoption is always shown. */
  visibleMetrics?: Set<string> | null;
}): SlideResult {
  const { slideId, pmcName, segment, metrics, peerCount, visibleMetrics } = input;
  const pmc = _e(pmcName);
  if (metrics.length === 0) {
    return { html: "", js: "" };
  }

  const subtitlePeers = peerCount
    ? `${peerCount} comparable PMCs (${_e(segment)})`
    : _e(segment);

  // Track toggleable rows for the control bar
  const toggleable: { key: string; label: string; rowId: string; hidden: boolean }[] = [];

  function sliderRow(m: BenchmarkMetric): string {
    const meta = METRIC_META[m.metric] || { label: m.metric, definition: "", format: (v: number) => v.toFixed(2) };
    if (m.pmcValue == null || m.p50 === 0) return "";

    // Determine initial visibility for toggleable metrics (non-anchor). Real metric key is
    // "NAR" (see METRIC_META above) — this compared against "adoption_rate", which no metric
    // ever actually has, so isAnchor was silently always false and Adoption could get toggled
    // off like any other row despite the comment above saying it's always shown.
    const isAnchor = m.metric === "NAR";
    let initiallyHidden = false;
    const rowId = isAnchor ? "" : `bm-${m.metric}-${slideId}`;
    if (!isAnchor && visibleMetrics != null) {
      initiallyHidden = !visibleMetrics.has(m.metric);
    }

    // --- Zoom logic (match Python) ---
    const allVals = [m.p25, m.p50, m.p75, m.pmcValue].filter((v) => v != null && v >= 0);
    const lo = Math.min(...allVals);
    const hi = Math.max(...allVals);
    const span = hi - lo;
    const mid = (hi + lo) / 2;
    let scaleMin: number;
    let scaleMax: number;
    let zoomed = false;
    if (mid > 0 && span / mid < 0.20) {
      const zoomFactor = span / mid < 0.08 ? 6 : 4;
      scaleMin = Math.max(0, mid - span * zoomFactor);
      scaleMax = mid + span * zoomFactor;
      zoomed = scaleMin > 0;
    } else {
      scaleMin = 0;
      scaleMax = Math.max(hi * 1.4, m.pmcValue * 1.1, 0.001);
    }

    function pct(v: number): number {
      return Math.min(Math.max(Math.round(((v - scaleMin) / Math.max(scaleMax - scaleMin, 0.001)) * 1000) / 10, 0), 100);
    }
    const p25Pct = pct(m.p25);
    const p50Pct = pct(m.p50);
    const p75Pct = pct(m.p75);
    const dotPct = pct(m.pmcValue);

    // --- Quartile color & dot style (5-tier with ±0.5pp "at median" band) ---
    // "At median" checked FIRST, before the quartile branches — a near-exact tie (p50 and p75
    // within 0.5pp of each other) must never fall into "Above median"/"Top quartile" by a
    // rounding hair, matching Flask's exact branch order.
    const AT_MEDIAN_TOL = 0.005; // ±0.5pp
    const lowerIsBetter = m.lowerIsBetter === true;
    let perfLbl: string;
    let lblColor: string;
    let dotColor: string;
    if (Math.abs(m.pmcValue - m.p50) <= AT_MEDIAN_TOL) {
      perfLbl = "At median"; lblColor = "#1a9e6a"; dotColor = "#1a9e6a";
    } else if (lowerIsBetter ? m.pmcValue <= m.p25 : m.pmcValue >= m.p75) {
      perfLbl = "★ Top quartile"; lblColor = "#d4af37"; dotColor = "#d4af37";
    } else if (lowerIsBetter ? m.pmcValue <= m.p50 : m.pmcValue >= m.p50) {
      perfLbl = "★ Above median"; lblColor = "#d4af37"; dotColor = "#d4af37";
    } else if (lowerIsBetter ? m.pmcValue <= m.p75 : m.pmcValue >= m.p25) {
      perfLbl = "Below median"; lblColor = "#d97706"; dotColor = "#d97706";
    } else {
      perfLbl = "Bottom quartile"; lblColor = "#dc5050"; dotColor = "#dc5050";
    }
    const useStar = dotColor === "#d4af37";

    const displayVal = m.pmcLabel ?? meta.format(m.pmcValue);
    const zoomNote = zoomed
      ? '<div style="position:absolute;top:14px;left:-2px;font-size:8px;color:#a09cb0;">~</div>'
      : "";

    // Suppress P25/P75 labels when too close to P50
    const showP25Label = Math.abs(p25Pct - p50Pct) > 5;
    const showP75Label = Math.abs(p75Pct - p50Pct) > 5;

    // Track toggleable row for the control bar
    if (!isAnchor) {
      toggleable.push({ key: m.metric, label: meta.label, rowId, hidden: initiallyHidden });
    }

    const rowIdAttr = rowId ? ` id="${rowId}"` : "";
    const rowDisplay = initiallyHidden ? "none" : "grid";

    return `
        <div${rowIdAttr} style="display:${rowDisplay};grid-template-columns:190px 96px 1fr;gap:12px;align-items:center;
                    flex:1;border-bottom:1px solid #f0edff;padding:0 0;">
          <div>
            <div style="font-size:13px;font-weight:700;color:#1D1D1D;">${_e(meta.label)}</div>
            <div style="font-size:9px;color:#a09cb0;margin-top:3px;line-height:1.3;">${_e(meta.definition)}</div>
          </div>
          <div>
            <div style="font-size:24px;font-weight:700;color:${lblColor};letter-spacing:-0.02em;line-height:1;">${_e(displayVal)}</div>
            <div style="font-size:9px;color:${lblColor};font-weight:600;margin-top:3px;">${perfLbl}</div>
          </div>
          <div style="position:relative;height:52px;padding:0 6px;">
            ${zoomNote}
            <!-- P-level labels ABOVE the track -->
            ${showP25Label ? `<div style="position:absolute;top:0;left:${p25Pct}%;font-size:8px;color:#a09cb0;transform:translateX(-50%);">P25</div>` : ""}
            <div style="position:absolute;top:0;left:${p50Pct}%;font-size:8px;color:#6A3DB8;font-weight:700;transform:translateX(-50%);">P50</div>
            ${showP75Label ? `<div style="position:absolute;top:0;left:${p75Pct}%;font-size:8px;color:#a09cb0;transform:translateX(-50%);">P75</div>` : ""}
            <!-- Track background -->
            <div style="position:absolute;top:18px;left:0;right:0;height:4px;background:#f0edff;border-radius:2px;"></div>
            <!-- IQR band -->
            <div style="position:absolute;top:18px;left:${p25Pct}%;width:${p75Pct - p25Pct}%;height:4px;background:#DDC6F9;border-radius:2px;"></div>
            <!-- P25 / P75 ticks -->
            <div style="position:absolute;top:15px;left:${p25Pct}%;width:1.5px;height:10px;background:#c4b8e8;border-radius:1px;transform:translateX(-50%);"></div>
            <div style="position:absolute;top:15px;left:${p75Pct}%;width:1.5px;height:10px;background:#c4b8e8;border-radius:1px;transform:translateX(-50%);"></div>
            <!-- P50 tick -->
            <div style="position:absolute;top:13px;left:${p50Pct}%;width:2px;height:14px;background:#6A3DB8;border-radius:1px;transform:translateX(-50%);"></div>
            <!-- PMC marker: gold star badge for Above median/Top quartile, plain dot otherwise -->
            ${useStar
              ? `<div style="position:absolute;top:11px;left:${dotPct}%;width:16px;height:16px;border-radius:50%;
                        background:#fff;border:2.5px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,0.3);
                        transform:translateX(-50%);display:flex;align-items:center;justify-content:center;">
                   <svg viewBox="0 0 24 24" width="13" height="13" style="display:block;">
                     <path fill="${dotColor}" d="M12 1.5l3.09 6.26 6.91 1-5 4.87 1.18 6.88L12 17.27l-6.18 3.24L7 13.63l-5-4.87 6.91-1z"/>
                   </svg>
                 </div>`
              : `<div style="position:absolute;top:11px;left:${dotPct}%;width:16px;height:16px;border-radius:50%;background:${dotColor};border:2.5px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,0.3);transform:translateX(-50%);"></div>`
            }
            <!-- Values BELOW the track -->
            ${showP25Label ? `<div style="position:absolute;top:33px;left:${p25Pct}%;font-size:9px;color:#a09cb0;transform:translateX(-50%);">${_e(meta.format(m.p25))}</div>` : ""}
            <div style="position:absolute;top:33px;left:${p50Pct}%;font-size:9px;color:#6A3DB8;font-weight:700;transform:translateX(-50%);">${_e(meta.format(m.p50))}</div>
            ${showP75Label ? `<div style="position:absolute;top:33px;left:${p75Pct}%;font-size:9px;color:#a09cb0;transform:translateX(-50%);">${_e(meta.format(m.p75))}</div>` : ""}
          </div>
        </div>`;
  }

  const orderedMetrics = [...metrics].sort((a, b) => {
    const ai = METRIC_DISPLAY_ORDER.indexOf(a.metric);
    const bi = METRIC_DISPLAY_ORDER.indexOf(b.metric);
    return (ai === -1 ? METRIC_DISPLAY_ORDER.length : ai) - (bi === -1 ? METRIC_DISPLAY_ORDER.length : bi);
  });
  const rows = orderedMetrics.map(sliderRow).filter(Boolean).join("");
  if (!rows) return { html: "", js: "" };

  // Toggle control bar — one button per optional metric that rendered
  let bmCtrlHtml = "";
  let bmCtrlJs = "";
  if (toggleable.length > 0) {
    const btns = toggleable.map(({ label, rowId: rid, hidden }) => {
      const cls = hidden ? "spark-ctrl-btn is-hidden" : "spark-ctrl-btn";
      return `<button class="${cls}" onclick="flexToggleBenchRow('${rid}',this)">${_e(label)}</button>`;
    }).join("");
    bmCtrlHtml = `<div class="presenter-control bm-metric-toggles">${btns}</div>`;
    bmCtrlJs = `if(!window.flexToggleBenchRow){window.flexToggleBenchRow=function(id,btn){` +
      `var el=document.getElementById(id);if(!el)return;` +
      `var h=el.style.display==="none";el.style.display=h?"grid":"none";` +
      `btn.classList.toggle("is-hidden",!h);};}`;
  }

  const html = `<div class="slide" id="slide-${slideId}" style="background:#fff;position:relative;">
    <div class="slide-header" style="margin-bottom:8px;flex-shrink:0;">
      <div class="slide-label">PERFORMANCE BENCHMARKS</div>
      <div class="slide-title" style="font-size:28px;">How ${pmc} stacks up.</div>
      <div style="font-size:11px;color:#a09cb0;margin-top:4px;">
        Benchmarked against ${_e(subtitlePeers)} \u00b7 Dot = where ${pmc} falls
      </div>
    </div>
    <div style="flex:1;overflow:hidden;margin-top:18px;display:flex;flex-direction:column;">
      <!-- Column headers -->
      <div style="display:grid;grid-template-columns:190px 96px 1fr;gap:12px;
                  padding:0 0 8px;border-bottom:2px solid #f0edff;flex-shrink:0;">
        <div style="font-size:9px;font-weight:700;color:#a09cb0;text-transform:uppercase;letter-spacing:0.1em;">Metric</div>
        <div style="font-size:9px;font-weight:700;color:#a09cb0;text-transform:uppercase;letter-spacing:0.1em;">Your Rate</div>
        <div style="font-size:9px;font-weight:700;color:#a09cb0;text-transform:uppercase;letter-spacing:0.1em;">Peer Distribution \u00b7 P25\u2013P75 band</div>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;">
        ${rows}
      </div>
    </div>
    ${bmCtrlHtml}
  </div>`;

  return { html, js: bmCtrlJs };
}


// ─── render_launch_snapshot (Slide 38 — New Logo deck) ──────────────────────

interface LaunchSnapshotInput {
  slideId: number;
  pmcName: string;
  partnerSince: string | null;
  propertyCount: number;
  totalUnits: number;
  monthCount: number;
  totalRent: number;
  totalBills: number;
  totalSignups: number;
  latestNar: number;
}

export function renderLaunchSnapshot(input: LaunchSnapshotInput): { html: string; js: string } {
  const { slideId, pmcName, partnerSince, propertyCount, totalUnits, monthCount, totalRent, totalBills, totalSignups, latestNar } = input;
  const pmc = _e(pmcName);
  const avgRentMo = totalRent / Math.max(monthCount, 1);
  const avgResidents = Math.round(totalBills / Math.max(monthCount, 1));

  let sinceLbl = "—";
  if (partnerSince) {
    try {
      const d = new Date(partnerSince + "T00:00:00Z");
      sinceLbl = d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
    } catch { sinceLbl = partnerSince.slice(0, 7); }
  }

  const periodLbl = monthCount <= 12
    ? `First ${monthCount} ${monthCount === 1 ? "Month" : "Months"}`
    : `Last ${monthCount} Months`;

  function tile(value: string, label: string, sublabel: string, color = "#2C194D"): string {
    return `
      <div style="background:#f9f8ff;border:1px solid #e8e4f5;border-radius:14px;padding:20px 22px;">
        <div style="font-size:9px;letter-spacing:0.14em;text-transform:uppercase;color:#a09cb0;margin-bottom:10px;">${label}</div>
        <div style="font-size:34px;font-weight:400;color:${color};letter-spacing:-0.02em;line-height:1;font-family:'ABCDiatype',sans-serif;">${value}</div>
        ${sublabel ? `<div style="font-size:10px;color:#a09cb0;margin-top:8px;">${sublabel}</div>` : ""}
      </div>`;
  }

  const fmtPct = (v: number) => (v * 100).toFixed(1) + "%";

  const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;padding:0;">
    <div style="background:#2C194D;padding:28px 40px 22px;">
      <div style="font-size:9px;letter-spacing:0.18em;text-transform:uppercase;color:#DDC6F9;font-weight:600;margin-bottom:8px;">LAUNCH SUMMARY · ${periodLbl.toUpperCase()}</div>
      <div style="font-size:28px;font-weight:400;color:#fff;font-family:'ABCDiatype',sans-serif;line-height:1.1;">${pmc}</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.45);margin-top:8px;">
        On Flex since ${sinceLbl} &nbsp;·&nbsp; ${propertyCount} ${propertyCount === 1 ? "property" : "properties"} &nbsp;·&nbsp; ${totalUnits.toLocaleString()} units
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:24px 40px 0;">
      ${tile(fmtCurrency(avgRentMo) + "/mo", "Avg Monthly Rent Guaranteed", `Total ${fmtCurrency(totalRent)} over ${monthCount}mo`, PURPLE)}
      ${tile(avgResidents.toLocaleString(), "Avg Active Residents", `${totalBills.toLocaleString()} bills paid in period`)}
      ${tile(fmtPct(latestNar), "Adoption Rate", "most recent month", NAVY)}
      ${tile(totalSignups.toLocaleString(), "New Signups", `enrolled over ${monthCount} months`)}
    </div>
  </div>`;

  return { html, js: "" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Property Trend Flags — decline/improve detection
// ─────────────────────────────────────────────────────────────────────────────

export interface TrendFlag {
  direction: "decline" | "improve";
  pctChange: number;
  basis: "yoy" | "peak" | "outperform";
  referenceNar: number | null;
  currentNar: number | null;
  referenceWindow: string | null;
}

interface TrendRow {
  PROPERTY_NAME: string;
  BP_MONTH: string;
  BILLS_PAID_COUNT: number | null;
  PROPERTY_UNIT_COUNT: number | null;
  ROLLOUT_MONTH: string | null;
  PMC_NAME?: string;
}

/**
 * Compute trend flags for properties (decline/improve badges).
 * Mirrors the Python `pull_property_trend_flags` logic:
 * - DECLINE: YoY trailing-3-month NAR drop ≥20% relative AND ≥3pp absolute (or peak-based for <18mo)
 * - IMPROVE: 6-month NAR gain exceeding min_outperform_excess (3pp) — simplified (no age curve)
 */
export function computePropertyTrendFlags(
  rows: TrendRow[],
  cutoffStr: string,
  minDecline = 0.20,
  minDeclinePeak = 0.25,
  minDeclinePp = 0.03,
  minOutperformExcess = 0.03,
): Map<string, TrendFlag> {
  const flags = new Map<string, TrendFlag>();
  if (!rows.length) return flags;

  const cutoff = new Date(cutoffStr + "T00:00:00Z");

  // Detect ambiguous property names (same name across 2+ PMCs) — skip them entirely
  const pmcsByName = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.PMC_NAME) {
      if (!pmcsByName.has(r.PROPERTY_NAME)) pmcsByName.set(r.PROPERTY_NAME, new Set());
      pmcsByName.get(r.PROPERTY_NAME)!.add(r.PMC_NAME);
    }
  }
  const ambiguousNames = new Set(
    [...pmcsByName].filter(([, pmcs]) => pmcs.size > 1).map(([name]) => name)
  );

  // Group by property
  const byProp = new Map<string, TrendRow[]>();
  for (const r of rows) {
    const arr = byProp.get(r.PROPERTY_NAME) || [];
    arr.push(r);
    byProp.set(r.PROPERTY_NAME, arr);
  }

  for (const [name, propRows] of byProp) {
    if (ambiguousNames.has(name)) continue;
    const sorted = propRows.sort((a, b) => a.BP_MONTH.localeCompare(b.BP_MONTH));
    const units = sorted[sorted.length - 1].PROPERTY_UNIT_COUNT || 0;
    if (units <= 0) continue;

    const nar = (avgBills: number) => avgBills / units;

    // Trailing 3 months ending at cutoff
    const cur3 = sorted.filter((r) => {
      const d = new Date(r.BP_MONTH + "T00:00:00Z");
      return d <= cutoff && d > new Date(cutoff.getFullYear(), cutoff.getMonth() - 3, cutoff.getDate());
    });
    if (cur3.length === 0) continue;
    const curAvg = cur3.reduce((s, r) => s + (r.BILLS_PAID_COUNT ?? 0), 0) / cur3.length;
    const curNarVal = nar(curAvg);

    // Months live
    const rolloutStr = sorted[0].ROLLOUT_MONTH;
    let monthsLive = 0;
    if (rolloutStr) {
      const rollout = new Date(rolloutStr + "T00:00:00Z");
      monthsLive = (cutoff.getFullYear() - rollout.getFullYear()) * 12 + (cutoff.getMonth() - rollout.getMonth());
    }

    // ── Decline check ──
    let declined = false;
    if (monthsLive >= 18) {
      // YoY: trailing 3 months ending same month last year
      const pyEnd = new Date(cutoff.getFullYear() - 1, cutoff.getMonth(), cutoff.getDate());
      const py3 = sorted.filter((r) => {
        const d = new Date(r.BP_MONTH + "T00:00:00Z");
        return d <= pyEnd && d > new Date(pyEnd.getFullYear(), pyEnd.getMonth() - 3, pyEnd.getDate());
      });
      if (py3.length >= 2) {
        const pyAvg = py3.reduce((s, r) => s + (r.BILLS_PAID_COUNT ?? 0), 0) / py3.length;
        if (pyAvg > 0) {
          const pctChange = (curAvg - pyAvg) / pyAvg;
          const pyNarVal = nar(pyAvg);
          if (pctChange <= -minDecline && (pyNarVal - curNarVal) >= minDeclinePp) {
            const refMonth = pyEnd.toISOString().slice(0, 7);
            flags.set(name, {
              direction: "decline", pctChange, basis: "yoy",
              referenceNar: pyNarVal, currentNar: curNarVal,
              referenceWindow: refMonth,
            });
            declined = true;
          }
        }
      }
    } else {
      // Peak-based for properties <18mo
      const rolling: { month: string; avg: number }[] = [];
      for (let i = 1; i < sorted.length; i++) {
        const window = sorted.slice(Math.max(0, i - 2), i + 1);
        const avg = window.reduce((s, r) => s + (r.BILLS_PAID_COUNT ?? 0), 0) / window.length;
        rolling.push({ month: sorted[i].BP_MONTH, avg });
      }
      if (rolling.length > 0) {
        let peakIdx = 0;
        for (let i = 1; i < rolling.length; i++) {
          if (rolling[i].avg > rolling[peakIdx].avg) peakIdx = i;
        }
        const peak = rolling[peakIdx].avg;
        if (peak > 0) {
          const pctVsPeak = (curAvg - peak) / peak;
          const peakNar = nar(peak);
          if (pctVsPeak <= -minDeclinePeak && (peakNar - curNarVal) >= minDeclinePp) {
            flags.set(name, {
              direction: "decline", pctChange: pctVsPeak, basis: "peak",
              referenceNar: peakNar, currentNar: curNarVal,
              referenceWindow: rolling[peakIdx].month.slice(0, 7),
            });
            declined = true;
          }
        }
      }
    }
    if (declined) continue;

    // ── Improve check (simplified: 6-month NAR gain exceeding threshold) ──
    if (monthsLive < 6) continue;
    const sixEnd = new Date(cutoff.getFullYear(), cutoff.getMonth() - 6, cutoff.getDate());
    const six3 = sorted.filter((r) => {
      const d = new Date(r.BP_MONTH + "T00:00:00Z");
      return d <= sixEnd && d > new Date(sixEnd.getFullYear(), sixEnd.getMonth() - 3, sixEnd.getDate());
    });
    if (six3.length < 2) continue;
    const sixAvg = six3.reduce((s, r) => s + (r.BILLS_PAID_COUNT ?? 0), 0) / six3.length;
    const narNow = nar(curAvg);
    const nar6moAgo = nar(sixAvg);
    const actualGain = narNow - nar6moAgo;
    if (actualGain >= minOutperformExcess) {
      flags.set(name, {
        direction: "improve", pctChange: actualGain, basis: "outperform",
        referenceNar: nar6moAgo, currentNar: narNow,
        referenceWindow: sixEnd.toISOString().slice(0, 7),
      });
    }
  }

  return flags;
}

// ─────────────────────────────────────────────────────────────────────────────
// Property Deep Dive — render_nar_by_property (Top/Bottom bar-row layout)
// ─────────────────────────────────────────────────────────────────────────────

interface PropertyRow {
  propertyName: string;
  units: number;
  billsPaid: number;
  newSignups: number;
  adoptionRate: number;
  propertyState?: string;
  monthsLive?: number;
  rentPaid?: number;
  avgRent?: number;
  trendFlag?: TrendFlag;
  t12EngPer100?: number;
  hasMarketingIntegration?: boolean;
  // Actual direct-to-resident marketing opt-in (Flask: is_marketing_opt_in) - the real driver
  // of the "Direct Marketing on/off" badge and its sort tiebreaker below. Distinct from
  // hasMarketingIntegration (integration wired up ≠ opted in) - see the schema comment in
  // get-pmc-monthly-report.ts for the bug this fixed.
  isMarketingOptIn?: boolean;
  peerNar?: number | null;
  peerNarCriteria?: string;
  peerNarCount?: number;
  peerEng?: number | null;
  peerEngCriteria?: string;
  peerEngCount?: number;
}

/**
 * Live 7+ months, (10+ units OR 0% adoption), $700–$2,500 avg rent (bypassed when the
 * property has too few payers — under 3 bills paid — to trust the estimate). Mirrors Flask's
 * `_build_established_pool` (generator/data.py:4306-4416) — the shared population both
 * "Properties Worth Celebrating" and "These Properties Need Our Attention" rank within, so the
 * two slides are always drawn from the same baseline and can never silently disagree on what
 * "average" means for this portfolio. Without this shared pool, a genuine 0%-adoption laggard
 * (or a small property whose one-resident rent sample lands just outside the rent band) can be
 * silently invisible on both slides — confirmed real cases in Flask's own commit history.
 *
 * portfolioAvgNar is unit-weighted (sum(billsPaid) / sum(units) across the established pool),
 * not a simple mean of each property's own adoptionRate — a few small, extreme-rate properties
 * shouldn't move the average as much as portfolio-wide unit share does.
 */
function buildEstablishedPool(propertySnapshot: PropertyRow[]): {
  established: PropertyRow[];
  portfolioAvgNar: number;
  portfolioAvgEng: number;
} {
  const established = propertySnapshot.filter((p) => {
    const monthsLive = p.monthsLive ?? 0;
    if (monthsLive < 7) return false;
    const unitsOk = p.adoptionRate === 0 || p.units >= 10;
    if (!unitsOk) return false;
    const avgRent = p.avgRent ?? 0;
    const rentOk = p.billsPaid < 3 || (avgRent >= 700 && avgRent <= 2500);
    return rentOk;
  });

  if (established.length === 0) return { established: [], portfolioAvgNar: 0, portfolioAvgEng: 0 };

  const estBills = established.reduce((s, p) => s + p.billsPaid, 0);
  const estUnits = established.reduce((s, p) => s + p.units, 0);
  const portfolioAvgNar = estUnits > 0 ? estBills / estUnits : 0;

  const engValues = established
    .map((p) => p.t12EngPer100 ?? (p.newSignups / Math.max(p.units, 1) * 100))
    .sort((a, b) => a - b);
  const mid = Math.floor(engValues.length / 2);
  const portfolioAvgEng = engValues.length === 0
    ? 0
    : engValues.length % 2 !== 0
      ? engValues[mid]
      : (engValues[mid - 1] + engValues[mid]) / 2;

  return { established, portfolioAvgNar, portfolioAvgEng };
}

// ── Benchmark column visibility (Kevin's ask) ────────────────────────────────
// Shared by renderPropertiesWorthCelebrating and renderAdoptionOpportunities - both tables
// have the identical Adoption Rate / Engagement column-group structure (Observed always shown,
// Portfolio Avg + Peer Median each independently toggleable), so the header/colgroup/row-cell
// construction lives here once rather than duplicated per renderer. Chosen at generation time,
// not a live post-generation toggle - same reasoning as hidden_kpi_tiles on the exec-summary
// input schema (get-pmc-monthly-report.ts): the download button re-serializes this API's
// original response string, not whatever's currently in the preview iframe.
export interface BenchmarkColumnVisibility {
  showAdoptionPortfolioAvg?: boolean;
  showAdoptionPeerMedian?: boolean;
  // Adoption's Observed column has no toggle (unlike Engagement's, below) - it's the metric
  // that decided which properties made it onto this table in the first place, so hiding it
  // would leave a flagged property with no visible number explaining why it's there.
  showEngagementObserved?: boolean;
  showEngagementPortfolioAvg?: boolean;
  showEngagementPeerMedian?: boolean;
}

function benchmarkTableHeader(v: BenchmarkColumnVisibility): { colgroupHtml: string; theadHtml: string; adoptionCols: number; engagementCols: number } {
  const showAPA = v.showAdoptionPortfolioAvg !== false;
  const showAPM = v.showAdoptionPeerMedian !== false;
  const showEO = v.showEngagementObserved !== false;
  const showEPA = v.showEngagementPortfolioAvg !== false;
  const showEPM = v.showEngagementPeerMedian !== false;
  const adoptionCols = 1 + Number(showAPA) + Number(showAPM);
  const engagementCols = Number(showEO) + Number(showEPA) + Number(showEPM);
  const th = (label: string) => `<th style="padding:2px 8px 4px;font-size:8px;font-weight:600;color:#6b7280;text-align:right;text-transform:uppercase;letter-spacing:0.04em;">${label}</th>`;

  const colgroupHtml = `
          <col style="width:150px;">
          <col style="width:60px;">
          ${showAPA ? '<col style="width:66px;">' : ""}
          ${showAPM ? '<col style="width:66px;">' : ""}
          ${showEO ? '<col style="width:60px;">' : ""}
          ${showEPA ? '<col style="width:66px;">' : ""}
          ${showEPM ? '<col style="width:66px;">' : ""}`;

  // engagementCols can be 0 if all three of that group's columns are toggled off - a
  // colspan="0" group header is invalid HTML, so omit the group header entirely in that case
  // rather than render a zero-width th.
  const engagementHeaderHtml = engagementCols > 0
    ? `<th colspan="${engagementCols}" style="padding:4px 8px 3px;font-size:9px;font-weight:800;color:#374151;text-align:center;text-transform:uppercase;letter-spacing:0.08em;border-bottom:2px solid #9ca3af;">Engagement (per 100 units)</th>`
    : "";

  const theadHtml = `
        <thead style="background:#fff;position:sticky;top:0;z-index:1;">
          <tr>
            <th rowspan="2" style="padding:5px 8px 5px 4px;font-size:8px;font-weight:600;color:#9ca3af;text-align:left;text-transform:uppercase;letter-spacing:0.06em;vertical-align:bottom;">Property</th>
            <th colspan="${adoptionCols}" style="padding:4px 8px 3px;font-size:9px;font-weight:800;color:#374151;text-align:center;text-transform:uppercase;letter-spacing:0.08em;border-bottom:2px solid #9ca3af;">Adoption Rate</th>
            ${engagementHeaderHtml}
          </tr>
          <tr style="border-bottom:2px solid #e5e7eb;">
            ${th("Observed")}
            ${showAPA ? th("Portfolio Avg") : ""}
            ${showAPM ? th("Peer Median") : ""}
            ${showEO ? th("Observed") : ""}
            ${showEPA ? th("Portfolio Avg") : ""}
            ${showEPM ? th("Peer Median") : ""}
          </tr>
        </thead>`;

  return { colgroupHtml, theadHtml, adoptionCols, engagementCols };
}

// Builds the data <td>s for one row, in column order, omitting whichever cells are toggled
// off. Each *Html arg is a complete <td>...</td> string (or "-" content already baked in) —
// this function only decides which ones survive.
function benchmarkRowCells(v: BenchmarkColumnVisibility, cells: {
  adoptionObserved: string; adoptionPortfolioAvg: string; adoptionPeerMedian: string;
  engagementObserved: string; engagementPortfolioAvg: string; engagementPeerMedian: string;
}): string {
  const showAPA = v.showAdoptionPortfolioAvg !== false;
  const showAPM = v.showAdoptionPeerMedian !== false;
  const showEO = v.showEngagementObserved !== false;
  const showEPA = v.showEngagementPortfolioAvg !== false;
  const showEPM = v.showEngagementPeerMedian !== false;
  return [
    cells.adoptionObserved,
    showAPA ? cells.adoptionPortfolioAvg : "",
    showAPM ? cells.adoptionPeerMedian : "",
    showEO ? cells.engagementObserved : "",
    showEPA ? cells.engagementPortfolioAvg : "",
    showEPM ? cells.engagementPeerMedian : "",
  ].join("");
}

export function renderPropertiesWorthCelebrating(input: {
  slideId: number;
  propertySnapshot: PropertyRow[];
  targetNar: number;
  peerMedianNar?: number;
  peerMedianEngagement?: number;
} & BenchmarkColumnVisibility): { html: string; js: string } {
  const { slideId, propertySnapshot, targetNar, peerMedianNar, peerMedianEngagement } = input;
  const { colgroupHtml, theadHtml } = benchmarkTableHeader(input);

  // Shared established-property pool (live 7+mo, meaningful size/rent sample) — same baseline
  // "These Properties Need Our Attention" ranks within, so the two slides can never silently
  // disagree on what "average" means for this portfolio. Also fixes real cases where a genuine
  // 0%-adoption laggard was invisible on both slides purely for being under the 10-unit floor.
  const { established, portfolioAvgNar, portfolioAvgEng } = buildEstablishedPool(propertySnapshot);

  // Top performers: above portfolio average by a meaningful margin. Selection (which
  // properties make the top-12 pool) still uses impact_score = units × outperformance -
  // Flask: "the biggest, most replicable wins surface first - not just whichever single small
  // property happens to have the highest raw NAR." Display order is separate: sorted by
  // observed adoption rate, highest to lowest (Kevin's ask, mirroring the identical fix on
  // Flask's render_properties_worth_celebrating) - a straight adoption-rate sort BEFORE the
  // slice would have changed which 12 properties get selected, not just their order.
  const celebrationDf = established
    .filter((p) => p.adoptionRate > portfolioAvgNar)
    .sort((a, b) => {
      const aImpact = a.units * (a.adoptionRate - portfolioAvgNar);
      const bImpact = b.units * (b.adoptionRate - portfolioAvgNar);
      return bImpact - aImpact;
    })
    .slice(0, 12)
    .sort((a, b) => b.adoptionRate - a.adoptionRate);

  if (celebrationDf.length === 0) return { html: "", js: "" };

  const hasTrend = celebrationDf.some((p) => p.trendFlag);

  const rowsHtml = celebrationDf.map((p) => {
    const eng = p.t12EngPer100 ?? (p.newSignups / Math.max(p.units, 1)) * 100;
    // Per-property peer NAR (geography/rent/time-aware) — falls back to slide-level peerMedianNar
    const pNar = p.peerNar ?? peerMedianNar;
    const peerNarTitle = p.peerNarCriteria && p.peerNarCount
      ? `${_e(p.peerNarCriteria)} · ${p.peerNarCount} peers`
      : (p.peerNar == null && peerMedianNar != null ? "Network-wide median" : "");
    const peerNarCell = pNar != null
      ? `<span style="text-decoration:underline dotted #9ca3af;text-underline-offset:2px;cursor:help;" title="${peerNarTitle}">${(pNar * 100).toFixed(1)}%</span>`
      : "-";
    // Per-property peer engagement
    const pEng = p.peerEng ?? peerMedianEngagement;
    const peerEngTitle = p.peerEngCriteria && p.peerEngCount
      ? `${_e(p.peerEngCriteria)} · ${p.peerEngCount} peers`
      : (p.peerEng == null && peerMedianEngagement != null ? "Network-wide median" : "");
    const peerEngCell = pEng != null
      ? `<span style="text-decoration:underline dotted #9ca3af;text-underline-offset:2px;cursor:help;" title="${peerEngTitle}">${pEng.toFixed(0)}</span>`
      : "-";
    const badge = p.trendFlag ? _trendBadgeHtml(p.trendFlag, p.monthsLive) : "";
    const dataCells = benchmarkRowCells(input, {
      adoptionObserved: `<td style="padding:6px 8px;text-align:right;font-size:13px;font-weight:700;color:#1a9e6a;">${(p.adoptionRate * 100).toFixed(1)}%</td>`,
      adoptionPortfolioAvg: `<td style="padding:6px 8px;text-align:right;font-size:12px;color:#6b7280;">${(portfolioAvgNar * 100).toFixed(1)}%</td>`,
      adoptionPeerMedian: `<td style="padding:6px 8px;text-align:right;font-size:12px;color:#6b7280;">${peerNarCell}</td>`,
      engagementObserved: `<td style="padding:6px 8px;text-align:right;font-size:12px;color:#374151;">${eng.toFixed(0)}</td>`,
      engagementPortfolioAvg: `<td style="padding:6px 8px;text-align:right;font-size:12px;color:#6b7280;">${portfolioAvgEng.toFixed(0)}</td>`,
      engagementPeerMedian: `<td style="padding:6px 8px;text-align:right;font-size:12px;color:#6b7280;">${peerEngCell}</td>`,
    });
    return `
      <tr style="border-bottom:1px solid #f0f0f4;">
        <td style="padding:6px 8px 6px 4px;">
          <div style="font-size:11px;font-weight:600;color:#1D1D1D;line-height:1.3;">${_e(p.propertyName)}${badge}</div>
          <div style="font-size:9px;color:#a09cb0;margin-top:1px;">${_e(p.propertyState || "")} · ${p.units.toLocaleString()} units${p.monthsLive ? ` · ${p.monthsLive}mo` : ""}</div>
        </td>
        ${dataCells}
      </tr>`;
  }).join("");

  const trendToggle = hasTrend ? `
    <style>#slide-${slideId}.trend-hidden .trend-badge { display: none; }</style>
    <button class="spark-ctrl-btn presenter-control" style="margin-left:8px;"
            onclick="document.getElementById('slide-${slideId}').classList.toggle('trend-hidden'); this.classList.toggle('is-active');"
            title="Show/hide the declining/improving badges">Trend badges</button>` : "";

  const tableHtml = `
    <div style="flex:1;overflow-y:auto;min-height:0;">
      <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
        <colgroup>${colgroupHtml}
        </colgroup>
        ${theadHtml}
        <tbody>${rowsHtml}</tbody>
      </table>
      <div style="font-size:9px;color:#9ca3af;margin-top:5px;font-style:italic;">Portfolio avg = this portfolio's own average · Peer median = comparable properties network-wide (same state/size/rent) · Engagement = new bill connections per 100 units</div>
    </div>`;

  const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;justify-content:flex-start;">
    <div class="slide-header" style="margin-bottom:8px;">
      <div class="slide-label">PROPERTY DEEP DIVE</div>
      <div class="slide-title" style="display:flex;align-items:center;">Properties worth celebrating — what can we learn?${trendToggle}</div>
    </div>
    <div style="font-size:10px;color:#a09cb0;margin:-4px 0 8px;">Peer comparisons are drawn from a capped sample of the network, not the full population — hover a value for its exact match criteria and peer count.</div>
    ${tableHtml}
    <div style="flex-shrink:0;padding-top:10px;border-top:1px solid #eceaf2;margin-top:8px;">
      <div style="font-size:11px;color:#524e5b;">These properties are beating the portfolio average by a meaningful margin — worth asking what they're doing differently (marketing cadence, move-in process, team engagement) and whether it can travel to other properties.</div>
    </div>
  </div>`;

  return { html, js: "" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Adoption Opportunities — bottom performers needing attention
// ─────────────────────────────────────────────────────────────────────────────

export interface NewRolloutCandidate {
  propertyName: string;
  propertyState?: string;
  units: number;
  ageMonths: number;
  adoptionRate: number;
  benchNar: number;
  observedEngPer100: number;
  expectedEngPer100: number;
  hasMarketingIntegration?: boolean;
  // Actual direct-to-resident marketing opt-in (Flask: is_marketing_opt_in) - the real driver
  // of this row's "Direct Marketing on/off" badge. See slide-renderers.ts's other
  // isMarketingOptIn comment / get-pmc-monthly-report.ts's schema comment for why this is a
  // separate field from hasMarketingIntegration.
  isMarketingOptIn?: boolean;
}

export interface DisabledPropertyRow {
  propertyName: string;
  units: number;
  deactivationLabel: string;
  lastSeenMonth?: string | null;
}

export function renderAdoptionOpportunities(input: {
  slideId: number;
  propertySnapshot: PropertyRow[];
  targetNar: number;
  peerMedianNar?: number;
  peerMedianEngagement?: number;
  /** Properties rolled out in the last 6 months, below their age-matched benchmark. */
  newRolloutCandidates?: NewRolloutCandidate[];
  /** Deactivated properties (churn/transfer/API-access/enrollment), partner-relevant reasons only. */
  disabledProperties?: DisabledPropertyRow[];
  /** Live presenting has no fixed-height/no-scroll PDF export constraint, so row caps lift. */
  presentingMode?: boolean;
} & BenchmarkColumnVisibility): { html: string; js: string } {
  const {
    slideId, propertySnapshot, targetNar: _targetNar, peerMedianNar, peerMedianEngagement,
    newRolloutCandidates = [], disabledProperties = [], presentingMode = false,
  } = input;
  const { colgroupHtml, theadHtml } = benchmarkTableHeader(input);

  // Shared established-property pool (live 7+mo, meaningful size/rent sample) — same baseline
  // "Properties Worth Celebrating" ranks within, so the two slides can never silently disagree
  // on what "average" means for this portfolio. Also fixes real cases where a genuine
  // 0%-adoption laggard was invisible on both slides purely for being under the 10-unit floor,
  // or a property whose rent estimate (from a single payer) landed just outside the rent band.
  const { established, portfolioAvgNar, portfolioAvgEng } = buildEstablishedPool(propertySnapshot);

  // Row-budget split between the New Rollouts and Established sections. Mirrors Flask's
  // real split (generator/slides.py:5215-5223): 11 total when only one section has content,
  // 5 (new-rollout) + 7 (established) when both do — the proven-safe combined total for the
  // fixed-height slide with no scroll fallback in the static/PDF export path. Both caps lift
  // entirely when presenting live in-browser (scrolling works fine there).
  const totalRowBudget = 11;
  const estHasCandidates = established.some((p) => p.adoptionRate < portfolioAvgNar);

  // ── New Rollouts — Below Benchmark ──────────────────────────────────────
  // Flask: render_adoption_opportunities, generator/slides.py:5226-5318. Properties rolled
  // out in the last 6 months, compared against an age-since-rollout benchmark (network-wide,
  // not geo-matched — the established peer pool excludes anything under 7mo live, so it has
  // no candidates this young). Filtered to age>=2mo, adoption<50% of benchmark, and skips
  // anything already at/above expected engagement (that gap is Flex-side, not PMC-actionable).
  // Sorted by engagement gap descending — the easiest, most concrete conversation first.
  const nrCap = presentingMode ? Infinity : (estHasCandidates ? 5 : totalRowBudget);
  const nrConcern = newRolloutCandidates
    .filter((c) => c.ageMonths >= 2 && c.benchNar > 0 && c.adoptionRate < c.benchNar * 0.5
      && !(c.expectedEngPer100 > 0 && c.observedEngPer100 >= c.expectedEngPer100))
    .sort((a, b) => (b.expectedEngPer100 - b.observedEngPer100) - (a.expectedEngPer100 - a.observedEngPer100));
  const nrShown = Number.isFinite(nrCap) ? nrConcern.slice(0, nrCap) : nrConcern;
  const nrOnTrackCount = Math.max(0, newRolloutCandidates.length - nrConcern.length);

  let newRolloutSection = "";
  if (nrShown.length > 0) {
    const nrRowsHtml = nrShown.map((c) => {
      const d2c = c.isMarketingOptIn
        ? '<span class="mktg-badge" style="font-size:8px;font-weight:600;color:#15803d;background:#dcfce7;border:1px solid #bbf7d0;border-radius:3px;padding:1px 5px;margin-left:5px;">Direct Marketing on</span>'
        : '<span class="mktg-badge" style="font-size:8px;font-weight:600;color:#dc2626;background:#fee2e2;border:1px solid #fecaca;border-radius:3px;padding:1px 5px;margin-left:5px;">Direct Marketing off</span>';
      return `
      <tr style="border-bottom:1px solid #f0f0f4;">
        <td style="padding:5px 8px 5px 4px;">
          <div style="font-size:11px;font-weight:600;color:#1D1D1D;line-height:1.3;">${_e(c.propertyName)}${d2c}</div>
          <div style="font-size:9px;color:#a09cb0;margin-top:1px;">${_e(c.propertyState || "")} · ${c.units.toLocaleString()} units · mo ${c.ageMonths}</div>
        </td>
        <td style="padding:5px 8px;text-align:right;font-size:13px;font-weight:700;color:#dc2626;">${(c.adoptionRate * 100).toFixed(1)}%</td>
        <td style="padding:5px 8px;text-align:right;font-size:12px;color:#6b7280;">${(c.benchNar * 100).toFixed(1)}%</td>
        <td style="padding:5px 8px;text-align:right;font-size:12px;color:#374151;">${c.observedEngPer100.toFixed(0)}</td>
        <td style="padding:5px 8px;text-align:right;font-size:12px;color:#9ca3af;">${c.expectedEngPer100 > 0 ? c.expectedEngPer100.toFixed(0) : "-"}</td>
      </tr>`;
    }).join("");
    const onTrackNote = nrOnTrackCount > 0
      ? ` · <span style="color:#16a34a;font-weight:600;">${nrOnTrackCount} on track</span>`
      : "";
    newRolloutSection = `
    <div style="flex-shrink:0;margin-bottom:12px;">
      <div style="background:#fff7ed;border-left:4px solid #d97706;border-radius:0 6px 6px 0;padding:6px 12px;margin-bottom:8px;display:flex;align-items:baseline;gap:8px;">
        <span style="font-size:11px;font-weight:700;color:#d97706;text-transform:uppercase;letter-spacing:0.06em;">New Rollouts - Below Benchmark</span>
        <span style="font-size:10px;color:#a09cb0;">${newRolloutCandidates.length} launched last 6 months · ${nrConcern.length} below benchmark${onTrackNote}</span>
      </div>
      <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
        <colgroup><col style="width:190px;"><col style="width:68px;"><col style="width:75px;"><col style="width:80px;"><col style="width:88px;"></colgroup>
        <thead>
          <tr>
            <th rowspan="2" style="padding:3px 8px 3px 4px;font-size:8px;font-weight:600;color:#9ca3af;text-align:left;text-transform:uppercase;letter-spacing:0.06em;vertical-align:bottom;">Property</th>
            <th colspan="2" style="padding:4px 8px 3px;font-size:9px;font-weight:800;color:#374151;text-align:center;text-transform:uppercase;letter-spacing:0.08em;border-bottom:2px solid #9ca3af;">Adoption Rate</th>
            <th colspan="2" style="padding:4px 8px 3px;font-size:9px;font-weight:800;color:#374151;text-align:center;text-transform:uppercase;letter-spacing:0.08em;border-bottom:2px solid #9ca3af;">Engagement (per 100, T12)</th>
          </tr>
          <tr style="border-bottom:1px solid #e5e7eb;">
            <th style="padding:2px 8px 3px;font-size:8px;font-weight:600;color:#6b7280;text-align:right;text-transform:uppercase;letter-spacing:0.04em;">Observed</th>
            <th style="padding:2px 8px 3px;font-size:8px;font-weight:600;color:#6b7280;text-align:right;text-transform:uppercase;letter-spacing:0.04em;">Expected</th>
            <th style="padding:2px 8px 3px;font-size:8px;font-weight:600;color:#6b7280;text-align:right;text-transform:uppercase;letter-spacing:0.04em;">Observed</th>
            <th style="padding:2px 8px 3px;font-size:8px;font-weight:600;color:#6b7280;text-align:right;text-transform:uppercase;letter-spacing:0.04em;">Expected</th>
          </tr>
        </thead>
        <tbody>${nrRowsHtml}</tbody>
      </table>
      <div style="font-size:9px;color:#9ca3af;margin-top:5px;font-style:italic;">Adoption expected = network P50 at same months since rollout · Engagement = new bill connections per 100 units, T12 · Expected = network P50</div>
    </div>`;
  }

  // ── Established — Lagging ───────────────────────────────────────────────
  // Sort: biggest gap to portfolio avg first, then 0%-adoption, then D2C-off, then
  // opportunity score (gap × units) as the final tiebreaker — matches Flask's real priority
  // order (generator/slides.py:5388-5390) exactly. Was previously sorted by opportunity score
  // (gap × units) alone, which could bury a severe (large-gap, small-property) laggard under
  // several milder-gap-but-larger ones.
  const ranked = established
    .filter((p) => p.adoptionRate < portfolioAvgNar)
    .map((p) => {
      const narGap = portfolioAvgNar - p.adoptionRate;
      const isZero = p.adoptionRate === 0;
      const noD2c = p.isMarketingOptIn !== true;
      const opportunityScore = p.units * narGap;
      const eng = p.t12EngPer100 ?? (p.newSignups / Math.max(p.units, 1)) * 100;
      const expEng = p.peerEng ?? peerMedianEngagement ?? 0;
      return { p, narGap, isZero, noD2c, opportunityScore, eng, expEng };
    })
    .sort((a, b) => {
      if (b.narGap !== a.narGap) return b.narGap - a.narGap;
      if (Number(b.isZero) !== Number(a.isZero)) return Number(b.isZero) - Number(a.isZero);
      if (Number(b.noD2c) !== Number(a.noD2c)) return Number(b.noD2c) - Number(a.noD2c);
      return b.opportunityScore - a.opportunityScore;
    });

  // Zero-adoption rows capped at 3 (content curation — matches Flask's _MAX_ZERO), and any
  // row where engagement is already at/above peer-expected is skipped entirely — that gap is
  // Flex-side (underwriting/UX/pricing), not something the PMC can act on. Total row budget
  // shrinks to 7 when the New Rollouts section also has content; both caps lift when
  // presenting live.
  const maxTotal = presentingMode ? Infinity : (newRolloutSection ? 7 : totalRowBudget);
  const maxZero = 3;
  let zeroShown = 0;
  let totalShown = 0;
  const laggards: typeof ranked = [];
  for (const r of ranked) {
    if (totalShown >= maxTotal) continue;
    if (r.isZero) {
      if (zeroShown >= maxZero) continue;
      zeroShown++;
    }
    if (r.expEng > 0 && r.eng >= r.expEng) continue;
    totalShown++;
    laggards.push(r);
  }

  // Display order is separate from selection order: `ranked`'s priority sort (narGap, then
  // isZero/noD2c/opportunityScore) decided WHICH properties made it into `laggards` via the
  // capping loop above - that must stay untouched. For display, re-sort the already-selected
  // set by observed adoption rate, highest to lowest (Kevin's ask, mirroring the identical fix
  // on Flask's render_adoption_opportunities).
  laggards.sort((a, b) => b.p.adoptionRate - a.p.adoptionRate);

  // ── Disabled Properties ─────────────────────────────────────────────────
  const disabledRowsHtml = disabledProperties.map((d) => `
    <tr style="border-bottom:1px solid #f0f0f4;">
      <td style="padding:5px 8px 5px 4px;">
        <div style="font-size:11px;font-weight:600;color:#6b7280;">${_e(d.propertyName)}</div>
        <div style="font-size:9px;color:#a09cb0;margin-top:1px;">${d.units.toLocaleString()} units${d.lastSeenMonth ? ` · left ${_e(d.lastSeenMonth)}` : ""}</div>
      </td>
      <td style="padding:5px 8px;font-size:11px;color:#6b7280;" colspan="3">${_e(d.deactivationLabel)}</td>
    </tr>`).join("");
  const disabledSection = disabledRowsHtml ? `
    <div style="flex-shrink:0;padding-top:8px;border-top:1px solid #f0f0f4;margin-top:6px;">
      <div style="font-size:8px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">No Longer Active</div>
      <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
        <colgroup><col style="width:220px;"><col></colgroup>
        <tbody>${disabledRowsHtml}</tbody>
      </table>
    </div>` : "";

  // ── Early exit if nothing to show ───────────────────────────────────────
  if (laggards.length === 0 && !newRolloutSection && !disabledSection) return { html: "", js: "" };

  const hasTrend = laggards.some((r) => r.p.trendFlag);

  const rowsHtml = laggards.map(({ p, eng, expEng }) => {
    // Per-property peer NAR (geography/rent/time-aware) — falls back to slide-level peerMedianNar
    const pNar = p.peerNar ?? peerMedianNar;
    const peerNarTitle = p.peerNarCriteria && p.peerNarCount
      ? `${_e(p.peerNarCriteria)} · ${p.peerNarCount} peers`
      : (p.peerNar == null && peerMedianNar != null ? "Network-wide median" : "");
    const peerNarCell = pNar != null
      ? `<span style="text-decoration:underline dotted #9ca3af;text-underline-offset:2px;cursor:help;" title="${peerNarTitle}">${(pNar * 100).toFixed(1)}%</span>`
      : "-";
    // Per-property peer engagement
    const peerEngTitle = p.peerEngCriteria && p.peerEngCount
      ? `${_e(p.peerEngCriteria)} · ${p.peerEngCount} peers`
      : (p.peerEng == null && peerMedianEngagement != null ? "Network-wide median" : "");
    const peerEngCell = (p.peerEng ?? peerMedianEngagement) != null
      ? `<span style="text-decoration:underline dotted #9ca3af;text-underline-offset:2px;cursor:help;" title="${peerEngTitle}">${expEng.toFixed(0)}</span>`
      : "-";
    const d2cBadge = p.isMarketingOptIn
      ? '<span class="mktg-badge" style="font-size:8px;font-weight:600;color:#15803d;background:#dcfce7;border:1px solid #bbf7d0;border-radius:3px;padding:1px 5px;margin-left:5px;vertical-align:middle;">Direct Marketing on</span>'
      : '<span class="mktg-badge" style="font-size:8px;font-weight:600;color:#dc2626;background:#fee2e2;border:1px solid #fecaca;border-radius:3px;padding:1px 5px;margin-left:5px;vertical-align:middle;">Direct Marketing off</span>';
    // Reconcile contradiction: "improving" badge on a "needs attention" property
    let trendBadge = p.trendFlag ? _trendBadgeHtml(p.trendFlag, p.monthsLive) : "";
    if (trendBadge && p.trendFlag?.direction === "improve") {
      trendBadge += `<span style="font-size:8px;color:#6b7280;margin-left:3px;">(still below avg)</span>`;
    }
    const dataCells = benchmarkRowCells(input, {
      adoptionObserved: `<td style="padding:6px 8px;text-align:right;font-size:13px;font-weight:700;color:#dc5050;">${(p.adoptionRate * 100).toFixed(1)}%</td>`,
      adoptionPortfolioAvg: `<td style="padding:6px 8px;text-align:right;font-size:12px;color:#6b7280;">${(portfolioAvgNar * 100).toFixed(1)}%</td>`,
      adoptionPeerMedian: `<td style="padding:6px 8px;text-align:right;font-size:12px;color:#6b7280;">${peerNarCell}</td>`,
      engagementObserved: `<td style="padding:6px 8px;text-align:right;font-size:12px;color:#374151;">${eng.toFixed(0)}</td>`,
      engagementPortfolioAvg: `<td style="padding:6px 8px;text-align:right;font-size:12px;color:#6b7280;">${portfolioAvgEng.toFixed(0)}</td>`,
      engagementPeerMedian: `<td style="padding:6px 8px;text-align:right;font-size:12px;color:#6b7280;">${peerEngCell}</td>`,
    });
    return `
      <tr style="border-bottom:1px solid #f0f0f4;">
        <td style="padding:6px 8px 6px 4px;">
          <div style="font-size:11px;font-weight:600;color:#1D1D1D;line-height:1.3;">${_e(p.propertyName)}${d2cBadge}${trendBadge}</div>
          <div style="font-size:9px;color:#a09cb0;margin-top:1px;">${_e(p.propertyState || "")} · ${p.units.toLocaleString()} units${p.monthsLive ? ` · ${p.monthsLive}mo` : ""}</div>
        </td>
        ${dataCells}
      </tr>`;
  }).join("");

  const establishedHeaderHtml = newRolloutSection ? `
      <div style="background:#f5f3ff;border-left:4px solid #6A3DB8;border-radius:0 6px 6px 0;padding:6px 12px;margin-bottom:8px;">
        <span style="font-size:11px;font-weight:700;color:#6A3DB8;text-transform:uppercase;letter-spacing:0.06em;">Established - Lagging</span>
      </div>` : "";

  const establishedSection = rowsHtml ? `
    <div style="flex:1;overflow-y:auto;min-height:0;">
      ${establishedHeaderHtml}
      <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
        <colgroup>${colgroupHtml}
        </colgroup>
        ${theadHtml}
        <tbody>${rowsHtml}</tbody>
      </table>
      <div style="font-size:9px;color:#9ca3af;margin-top:5px;font-style:italic;">Portfolio avg = this portfolio's own average · Peer median = comparable properties network-wide (same state/size/rent) · Engagement = new bill connections per 100 units</div>
    </div>` : "";

  const trendToggle = hasTrend ? `
    <style>#slide-${slideId}.trend-hidden .trend-badge { display: none; }</style>
    <button class="spark-ctrl-btn presenter-control" style="margin-left:8px;"
            onclick="document.getElementById('slide-${slideId}').classList.toggle('trend-hidden'); this.classList.toggle('is-active');"
            title="Show/hide the declining/improving badges">Trend badges</button>` : "";

  // Presenter-decided show/hide for the Direct Marketing on/off badges - lets you decide
  // whether they belong in the story before you're live, without re-generating the report.
  // Same .presenter-control semantics as trendToggle above: hidden automatically once
  // actually presenting. Mirrors Flask's _mktg_badge_toggle_html (generator/slides.py).
  const mktgToggle = `
    <style>#slide-${slideId}.mktg-hidden .mktg-badge { display: none; }</style>
    <button class="spark-ctrl-btn presenter-control" style="margin-left:8px;"
            onclick="document.getElementById('slide-${slideId}').classList.toggle('mktg-hidden'); this.classList.toggle('is-active');"
            title="Show/hide the Direct Marketing on/off badges - hidden automatically once presenting live">Marketing badges</button>`;

  // No summary line here — Flask's real header (generator/slides.py:5593-5601) goes straight
  // from the title to the sections with nothing in between; a "N properties below portfolio
  // avg · M potential new residents" line here had no basis in the reference.
  const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;justify-content:flex-start;">
    <div class="slide-header" style="margin-bottom:8px;">
      <div class="slide-label">PROPERTY DEEP DIVE</div>
      <div class="slide-title" style="display:flex;align-items:center;">These properties need our attention.${mktgToggle}${trendToggle}</div>
    </div>
    <div style="font-size:10px;color:#a09cb0;margin:-4px 0 8px;">Peer comparisons are drawn from a capped sample of the network, not the full population — hover a value for its exact match criteria and peer count.</div>
    ${newRolloutSection}
    ${establishedSection}
    ${disabledSection}
  </div>`;

  return { html, js: "" };
}

// ─────────────────────────────────────────────────────────────────────────────
// DELINQUENCY PROTECTION
// ─────────────────────────────────────────────────────────────────────────────

interface DelinquencyMonth {
  month: string;
  totalRentShielded: number;
  residentsShielded: number;
}

export function renderDelinquency(input: {
  slideId: number;
  months: DelinquencyMonth[];
  windowMonths: number;
}): SlideResult {
  const { slideId, months, windowMonths } = input;

  if (!months || months.length === 0) {
    const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;">
    <div class="slide-header">
      <div class="slide-label">Delinquency Protection</div>
      <div class="slide-title">Rent Guaranteed by Flex</div>
    </div>
    <div style="color:#524e5b;font-size:15px;padding:40px 0;">No delinquency data available for this PMC.</div>
  </div>`;
  return { html, js: "" };
  }

  const windowPhrase = windowMonths >= 12 ? "12 months" : `${windowMonths} months`;
  const windowTitle = windowMonths >= 12 ? "Trailing 12 Months" : `Trailing ${windowMonths} Months`;
  // Headline sum/count computed from the same windowMonths the label claims (Kevin's catch —
  // this used to sum every row `months` happened to contain, which can exceed windowMonths
  // thanks to the underlying pull's lag buffer, producing a $ figure that didn't match its own
  // "in the last N months" label). This slide is deliberately independent of the report's own
  // Full/Quarter/YTD period (matches Flask's render_delinquency) — always a trailing-12-months-
  // or-full-tenure headline, not scoped to lookback_months.
  //
  // Windowed by calendar date, not array position (Kevin's catch, round 2) — a positional
  // `.slice(-windowMonths)` assumes `months` has exactly one contiguous row per calendar month,
  // but DQ_PROPERTY's GROUP BY simply omits a month with zero shielded rows for this PMC rather
  // than emitting a zero row for it. When that happens, slicing by array position reaches back
  // one extra calendar month past the true trailing-N-months boundary to fill the count,
  // silently including a month's total that's outside the window the label claims — exactly
  // what let this slide's headline ($1.6M) disagree with the exec-summary tile's date-bounded
  // figure ($1.51M) even though both nominally used the same 12-month window. Anchor is
  // defensively re-derived as the max month actually present (not assumed from array order),
  // same pattern as the exec-summary tile's own dqLatestMonth in get-pmc-monthly-report.ts.
  const dqLatestMonth = months.reduce<string | null>(
    (latest, m) => (m.month != null && (latest == null || m.month > latest) ? m.month : latest),
    null
  );
  const windowedMonths = (() => {
    if (dqLatestMonth == null) return months;
    const windowStartDate = new Date(dqLatestMonth + "T00:00:00Z");
    windowStartDate.setUTCMonth(windowStartDate.getUTCMonth() - (windowMonths - 1));
    const windowStart = windowStartDate.toISOString().slice(0, 10);
    return months.filter((m) => m.month >= windowStart);
  })();
  const lifetimeShielded = windowedMonths.reduce((s, m) => s + m.totalRentShielded, 0);
  const totalResidents = windowedMonths.reduce((s, m) => s + m.residentsShielded, 0);

  // Pad short histories so the chart has at least 3 slots
  const padCount = Math.max(0, 3 - months.length);
  const chartMonths: string[] = [];
  const chartVals: (number | null)[] = [];
  const residentsVals: (number | null)[] = [];

  if (padCount > 0) {
    const earliest = months[0].month;
    const [ey, em] = earliest.split("-").map(Number);
    for (let i = padCount; i > 0; i--) {
      const d = new Date(ey, em - 1 - i, 1);
      const lbl = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
      chartMonths.push(lbl);
      chartVals.push(null);
      residentsVals.push(null);
    }
  }

  for (const m of months) {
    chartMonths.push(monthLabel(m.month).slice(0, 3) + " " + m.month.slice(0, 4));
    chartVals.push(Math.round(m.totalRentShielded));
    residentsVals.push(m.residentsShielded);
  }

  const realResidents = residentsVals.filter((v): v is number => v !== null && v > 0);
  const resMax = realResidents.length > 0 ? Math.max(...realResidents) : 100;
  const y2Max = Math.round(resMax / 0.20);

  const monthsJs = JSON.stringify(chartMonths);
  const valsJs = JSON.stringify(chartVals);
  const residentsJs = JSON.stringify(residentsVals);

  const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;">
    <div class="slide-header" style="margin-bottom:16px;flex-shrink:0;">
      <div class="slide-label">Delinquency Protection</div>
      <div class="slide-title">Flex guaranteed ${fmtCurrency(lifetimeShielded)} across ${totalResidents.toLocaleString()} resident payments in the last ${windowPhrase}.</div>
      <div style="font-size:13px;color:#524e5b;line-height:1.6;margin-top:8px;">
        Flex guarantees rent to you <strong>regardless of whether the resident pays</strong>. Every dollar below was money you received even though residents missed their payment to Flex.
      </div>
    </div>
    <div style="flex:1;min-height:0;background:#f7f7f7;border:1px solid #eceaf2;border-radius:14px;padding:16px 20px;display:flex;flex-direction:column;">
      <div style="font-size:9px;font-weight:600;color:#524e5b;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:10px;flex-shrink:0;">
        Monthly Rent Guaranteed - ${windowTitle}
      </div>
      <div style="flex:1;min-height:0;position:relative;">
        <div style="position:absolute;top:8px;left:0;right:0;z-index:5;display:flex;justify-content:center;gap:16px;align-items:center;pointer-events:none;">
          <span style="display:flex;align-items:center;gap:5px;"><span style="display:inline-block;width:18px;height:2px;background:#1a9e6a;border-radius:1px;position:relative;"><span style="position:absolute;top:-3px;left:50%;transform:translateX(-50%);width:6px;height:6px;background:#1a9e6a;border-radius:50%;"></span></span><span style="font-size:11px;color:#524e5b;">Payments Shielded</span></span>
        </div>
        <canvas id="dqchart${slideId}"></canvas>
      </div>
    </div>
  </div>`;

  const js = `
window['initSlide${slideId}'] = (function() {
  let done = false;
  return function() {
    if (done) return; done = true;
    var fmtK = function(v) { return v >= 1e6 ? '$'+(v/1e6).toFixed(1)+'M' : v >= 1000 ? '$'+(v/1000).toFixed(1)+'K' : '$'+v; };
    new Chart(document.getElementById('dqchart${slideId}'), {
      type: 'bar',
      data: {
        labels: ${monthsJs},
        datasets: [{
          type: 'bar',
          data: ${valsJs},
          backgroundColor: 'rgba(106,61,184,0.25)',
          borderColor: '#6A3DB8',
          borderWidth: 1.5,
          borderRadius: 6,
          yAxisID: 'y',
          datalabels: {
            anchor: 'end', align: 'top',
            formatter: function(v) { return v > 0 ? fmtK(v) : ''; },
            color: '#6A3DB8', font: { size: 10, weight: '600' }
          }
        }, {
          type: 'line',
          label: 'Payments Shielded',
          data: ${residentsJs},
          borderColor: 'rgba(26,158,106,0.75)',
          backgroundColor: 'transparent',
          borderWidth: 2,
          borderDash: [5, 3],
          pointRadius: 3,
          pointHoverRadius: 4,
          pointBackgroundColor: 'rgba(26,158,106,0.8)',
          tension: 0.35,
          yAxisID: 'y2',
          order: 0,
          datalabels: {
            anchor: 'center', align: 'bottom',
            formatter: function(v) { return v > 0 ? v : ''; },
            color: 'rgba(26,158,106,0.85)', font: { size: 9, weight: '600' }
          }
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 32 } },
        plugins: { legend: { display: false }, datalabels: {} },
        scales: {
          x: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { color: '#9ca3af', font: { size: 10 } } },
          y: { stacked: true, display: false, beginAtZero: true },
          y2: { display: false, beginAtZero: true, position: 'right', max: ${y2Max} }
        }
      }
    });
  };
})();`;

  return { html, js };
}

// ─────────────────────────────────────────────────────────────────────────────
// RESIDENT RETENTION
// ─────────────────────────────────────────────────────────────────────────────

interface RetentionMonth {
  month: string;
  rate: number;
}

interface LoyaltyBucket {
  name: string;
  description: string;
  count: number;
  color: string;
}

export function renderRetention(input: {
  slideId: number;
  pmcName: string;
  reportingMonth: string;
  trueRepeatRate: number | null;
  avgRetention: number;
  momRates: RetentionMonth[];
  loyaltyBuckets: LoyaltyBucket[] | null;
  loyaltyTotal: number;
  loyaltyTitle: string;
  newInMonth: number;
  avgPayment: number;
  slideTitle?: string;
}): SlideResult {
  const { slideId, reportingMonth, trueRepeatRate, avgRetention, momRates, loyaltyBuckets, loyaltyTotal, loyaltyTitle, newInMonth, avgPayment, slideTitle } = input;
  const resolvedSlideTitle = slideTitle || "Residents use Flex their own way, but once they start, most keep coming back.";

  // Hero metric
  const heroVal = trueRepeatRate !== null ? trueRepeatRate : avgRetention;
  const heroLabel = trueRepeatRate !== null ? "TRUE REPEAT RATE" : "MONTH-OVER-MONTH RETENTION";
  const heroSub = trueRepeatRate !== null
    ? "of eligible residents came back"
    : `avg over ${momRates.length} months`;
  const heroColor = heroVal >= 0.80 ? "#1a9e6a" : heroVal >= 0.65 ? "#d97706" : "#dc5050";

  // KPI cards
  const kpiCard = (title: string, val: string, sub: string, accent: string) =>
    `<div style="background:#f7f7f7;border:1px solid #eceaf2;border-radius:10px;padding:14px 16px;">
      <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:${accent};margin-bottom:6px;">${_e(title)}</div>
      <div style="font-size:24px;font-weight:700;color:#1d1d1d;letter-spacing:-0.02em;">${val}</div>
      <div style="font-size:11px;color:#a09cb0;margin-top:3px;">${_e(sub)}</div>
    </div>`;

  const topCardsHtml = "";
  // Note: show_top_cards=False in Python source for both QBR and expansion decks

  // Loyalty bars
  let cohortSection = "";
  if (loyaltyBuckets && loyaltyBuckets.length > 0 && loyaltyTotal > 0) {
    const bars = loyaltyBuckets.map((b) => {
      const pct = b.count / loyaltyTotal;
      const barWidth = Math.max(2, pct * 100);
      return `<div style="display:flex;align-items:center;gap:12px;flex:1;">
        <div style="width:190px;flex-shrink:0;">
          <div style="font-size:15px;font-weight:600;color:#1d1d1d;line-height:1.2;">${_e(b.name)}</div>
          <div style="font-size:12px;color:#a09cb0;margin-top:1px;">${_e(b.description)}</div>
        </div>
        <div style="flex:1;background:#eceaf2;border-radius:6px;height:12px;overflow:hidden;">
          <div style="background:${b.color};opacity:0.70;height:100%;width:${barWidth.toFixed(0)}%;border-radius:6px;"></div>
        </div>
        <div style="font-size:17px;font-weight:700;color:#1d1d1d;width:40px;text-align:right;">${b.count.toLocaleString()}</div>
        <div style="font-size:13px;color:#a09cb0;width:44px;">${(pct * 100).toFixed(1)}%</div>
      </div>`;
    }).join("");

    cohortSection = `
    <div style="display:flex;flex-direction:column;gap:8px;min-height:0;overflow:hidden;">
      <div style="flex-shrink:0;min-height:56px;">
        <div style="font-size:16px;font-weight:700;color:#1d1d1d;line-height:1.3;margin-bottom:4px;">${_e(loyaltyTitle)}</div>
        <div style="font-size:10px;color:#a09cb0;margin-top:2px;">Last 12 months &middot; active and former residents at your properties.</div>
      </div>
      <div style="font-size:9px;letter-spacing:0.12em;text-transform:uppercase;color:#8d70ee;font-weight:700;flex-shrink:0;padding-bottom:4px;">LOYALTY RATE</div>
      <div style="background:#f7f7f7;border:1px solid #eceaf2;border-radius:12px;padding:16px 18px;flex:1;min-height:0;display:flex;flex-direction:column;gap:10px;overflow:hidden;">
        <div style="flex:1;min-height:0;display:flex;flex-direction:column;gap:10px;">${bars}</div>
      </div>
    </div>`;
  }

  // MoM retention chart
  const displayRates = momRates.slice(-6);
  let retentionSection = "";
  let retentionJs = "";
  if (displayRates.length > 0) {
    const mths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const labels = JSON.stringify(displayRates.map((r, i) => {
      const parts = r.month.split("-");
      const curMonth = mths[parseInt(parts[1], 10) - 1];
      // Show "Prior → Current" format matching Python source
      if (i === 0 && momRates.length > displayRates.length) {
        const priorEntry = momRates[momRates.length - displayRates.length - 1 + i];
        if (priorEntry) {
          const priorParts = priorEntry.month.split("-");
          const priorMonth = mths[parseInt(priorParts[1], 10) - 1];
          return `${priorMonth} → ${curMonth}`;
        }
      }
      if (i > 0) {
        const prevParts = displayRates[i - 1].month.split("-");
        const prevMonth = mths[parseInt(prevParts[1], 10) - 1];
        return `${prevMonth} → ${curMonth}`;
      }
      return curMonth;
    }));
    const vals = JSON.stringify(displayRates.map((r) => Math.round(r.rate * 1000) / 10));
    const colors = JSON.stringify(displayRates.map((r) =>
      r.rate >= 0.80 ? "#1a9e6a" : r.rate >= 0.65 ? "#d97706" : "#dc5050"
    ));
    const yMin = Math.max(0, Math.floor(Math.min(...displayRates.map((r) => r.rate * 100)) / 5) * 5 - 5);

    retentionSection = `
    <div style="display:flex;flex-direction:column;gap:8px;min-height:0;overflow:hidden;">
      <div style="flex-shrink:0;min-height:56px;">
        <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;">
          <div style="font-size:46px;font-weight:400;color:${heroColor};letter-spacing:-0.03em;line-height:1;">${(heroVal * 100).toFixed(1)}%</div>
          <div style="font-size:11px;color:#6b7280;">${_e(heroSub)}</div>
        </div>
      </div>
      <div style="font-size:9px;letter-spacing:0.12em;text-transform:uppercase;color:#8d70ee;font-weight:700;flex-shrink:0;padding-bottom:4px;">${heroLabel}</div>
      <div style="background:#f7f7f7;border:1px solid #eceaf2;border-radius:12px;padding:16px 18px;flex:1;min-height:0;position:relative;overflow:hidden;">
        <canvas id="ret${slideId}"></canvas>
      </div>
    </div>`;

    retentionJs = `
(function() {
  var colors = ${colors};
  new Chart(document.getElementById('ret${slideId}'), {
    type: 'bar',
    data: {
      labels: ${labels},
      datasets: [{
        data: ${vals},
        backgroundColor: colors,
        borderRadius: 5,
        datalabels: {
          anchor: 'end', align: 'end',
          formatter: function(v) { return v.toFixed(1) + '%'; },
          color: '#374151', font: { size: 11, weight: '700' }
        }
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 24 } },
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: '#9ca3af', font: { size: 10 } } },
        y: { min: ${yMin}, max: 100, grid: { color: '#eceaf2' }, border: { display: false }, ticks: { color: '#9ca3af', font: { size: 10 }, stepSize: 5, callback: function(v) { return v + '%'; } } }
      }
    }
  });
})();`;
  }

  const bottomGrid = cohortSection
    ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;height:100%;min-height:0;overflow:hidden;">${cohortSection}${retentionSection}</div>`
    : `<div style="display:grid;grid-template-columns:1fr;gap:14px;height:100%;min-height:0;overflow:hidden;">${retentionSection}</div>`;

  const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;justify-content:flex-start;overflow:hidden;position:relative;">
    <div class="slide-header" style="margin-bottom:12px;flex-shrink:0;">
      <div class="slide-label">Resident Retention</div>
      <div class="slide-title">${_e(resolvedSlideTitle)}</div>
    </div>
    ${topCardsHtml}
    <div style="height:1px;background:#eceaf2;flex-shrink:0;margin-bottom:14px;"></div>
    <div style="flex:1;min-height:0;overflow:hidden;">${bottomGrid}</div>
  </div>`;

  return { html, js: retentionJs };
}


export interface StageBenchmarkRow {
  p50: number | null;
  peer_label?: string;
  /** How many peer PMCs actually had data at this specific tenure bucket - shown alongside
   * the label so a thin-sample month (e.g. 2 peers) isn't mistaken for the same confidence as
   * a well-populated one (Kevin's ask). */
  pmc_count?: number;
}

export interface AdoptionTrendKpis {
  pmc_name?: string;
  months_since_launch?: number;
  stage_benchmarks?: Record<number, StageBenchmarkRow>;
  rolling_peer_median?: Record<string, { p50: number } | number | null>;
  /** The SAME criteria string the Peer Benchmarks slide shows (e.g. "Southeast region,
   * comparable size & avg rent") — both slides read from the same lockedPeers cohort, so their
   * criteria descriptions should always agree. Without this, the label below defaulted to a
   * generic hardcoded string that never reflected which tier actually matched. */
  locked_peers_criteria?: string;
}

export interface MonthlySplitEntry {
  name?: string;
  monthly?: AdoptionTrendMonthly[];
}

export function renderAdoptionTrend(input: {
  slideId: number;
  monthly: AdoptionTrendMonthly[];
  kpis?: AdoptionTrendKpis | null;
  monthlySplit?: MonthlySplitEntry[] | null;
}): SlideResult {
  const { slideId, monthly, kpis, monthlySplit } = input;

  const months = monthly.map((r) => monthLabel(r.month));
  const allVals = monthly.map((r) => Math.round(r.adoptionRate * 1000) / 10);

  // ─── Peer cohort benchmark ──────────────────────────────────────────────
  let benchmarkVals: (number | null)[] = [];
  let benchmarkLabel = "Peer Median";
  let benchmarkLabelTooltip = ""; // set only for the calendar-time rolling variant below
  let _mslIsCapped = false;

  if (kpis) {
    const sbm = kpis.stage_benchmarks ?? {};
    const msl = kpis.months_since_launch ?? 0;
    const n = monthly.length;
    // Real tenure gate — was previously only set as a side effect of stage_benchmarks having
    // data, so when stage_benchmarks was empty (as it always is now — SEGMENT_NAR_AVG comes
    // from a table with no real Flask equivalent), _mslIsCapped stayed false forever and the
    // rolling_peer_median block below never ran, even though it had real, correct data. This
    // was the actual reason the peer-median line never appeared on this chart.
    _mslIsCapped = msl >= 36;
    if (Object.keys(sbm).length > 0 && msl > 0) {
      for (let i = 0; i < n; i++) {
        const mn = msl - (n - 1 - i);
        const mnLookup = Math.max(1, Math.min(36, mn));
        const brow = sbm[mnLookup];
        const p50 = brow?.p50;
        benchmarkVals.push(p50 ? Math.round(p50 * 1000) / 10 : null);
      }
      // Find peer label - pmc_count comes from the SAME bucket the label itself is drawn
      // from, so "how many peers" always describes the number actually behind the label
      // shown, not some other month's count (Kevin's ask - thin months shouldn't read with
      // the same confidence as well-populated ones).
      for (let mn = Math.max(1, msl - n + 1); mn < Math.min(msl + 1, 37); mn++) {
        const row = sbm[mn];
        if (row?.peer_label) {
          const countSuffix = row.pmc_count ? ` · ${row.pmc_count} PMC${row.pmc_count === 1 ? "" : "s"}` : "";
          benchmarkLabel = `Peer Median (${row.peer_label}${countSuffix})`;
          break;
        }
      }
      if (benchmarkLabel === "Peer Median" && msl > 36) {
        const row = sbm[36];
        if (row?.peer_label) {
          const countSuffix = row.pmc_count ? ` · ${row.pmc_count} PMC${row.pmc_count === 1 ? "" : "s"}` : "";
          benchmarkLabel = `Peer Median (${row.peer_label}${countSuffix})`;
        }
      }
    }
  }

  // Rolling peer median for established PMCs
  if (_mslIsCapped && kpis) {
    const rolling = kpis.rolling_peer_median ?? {};
    if (Object.keys(rolling).length > 0) {
      const newBvals: (number | null)[] = [];
      for (const m of monthly) {
        const ms = m.month.slice(0, 10);
        const row = rolling[ms];
        let p50: number | null = null;
        if (row != null) {
          p50 = typeof row === "number" ? row : (row as { p50: number }).p50;
        }
        newBvals.push(p50 ? Math.round(p50 * 1000) / 10 : null);
      }
      if (newBvals.some((v) => v != null)) {
        benchmarkVals = newBvals;
        benchmarkLabel = kpis.locked_peers_criteria
          ? `Peer Median \u00b7 ${kpis.locked_peers_criteria}`
          : "Peer Median \u00b7 similar PMCs \u00b7 same time period";
        // Peers here are matched on geography/size/rent, NOT on how long they've been on
        // Flex - this line tracks each peer's OWN value in the same real-world month as the
        // point beside it, not an age-matched comparison the way the stage-benchmark label
        // above is. "same calendar months" tried to say that but read as unexplained jargon
        // (Kevin's catch, mirrored from the identical fix in Flask's render_adoption_trend) -
        // "same time period" says the same thing in plain English; the fuller technical
        // distinction lives in the hover tooltip instead of the visible chip.
        benchmarkLabelTooltip = kpis.locked_peers_criteria
          ? ""
          : "Each point compares your adoption rate to comparable PMCs' median in that same " +
            "real-world month - not to how long those PMCs have been on Flex.";
      }
    }
  }

  const showBenchmark = benchmarkVals.length > 0 && benchmarkVals.some((v) => v != null);

  // ─── Peer outlier note ──────────────────────────────────────────────────
  let peerOutlierNote = "";
  if (showBenchmark && allVals.length > 0) {
    const bvValid = benchmarkVals.filter((v): v is number => v != null);
    const avValid = allVals.filter((v) => v != null);
    if (bvValid.length > 0 && avValid.length > 0) {
      const peerLatest = bvValid[bvValid.length - 1];
      const pmcCompare = avValid[avValid.length - 1]; // latest month, not 6-month median
      const monthsAbove = allVals.reduce((cnt, pv, i) => {
        const bv = benchmarkVals[i];
        return pv != null && bv != null && pv > bv ? cnt + 1 : cnt;
      }, 0);
      const monthsCompared = allVals.reduce((cnt, pv, i) => {
        const bv = benchmarkVals[i];
        return pv != null && bv != null ? cnt + 1 : cnt;
      }, 0);

      if (peerLatest > 0) {
        const ratio = pmcCompare / peerLatest;
        const gapPpAbove = pmcCompare - peerLatest;
        const aboveNote = monthsCompared >= 6 && monthsAbove >= Math.floor(monthsCompared / 2)
          ? ` \u00b7 above median in ${monthsAbove} of last ${monthsCompared} months`
          : "";
        const noteId = `peerOutlierNote${slideId}`;

        if (ratio >= 1.5) {
          peerOutlierNote = `<div id="${noteId}" style="font-size:13px;color:#15803d;font-weight:700;">${ratio.toFixed(1)}\u00d7 above comparable peer median (${peerLatest.toFixed(1)}%)${aboveNote}</div>`;
        } else if (gapPpAbove > 0.5) {
          peerOutlierNote = `<div id="${noteId}" style="font-size:13px;color:#15803d;font-weight:700;">+${gapPpAbove.toFixed(1)}pp above comparable peer median (${peerLatest.toFixed(1)}%)${aboveNote}</div>`;
        } else if (gapPpAbove >= -0.5) {
          peerOutlierNote = `<div id="${noteId}" style="font-size:13px;color:#6b7280;">At comparable peer median (${peerLatest.toFixed(1)}%)</div>`;
        } else {
          const gapPp = peerLatest - pmcCompare;
          peerOutlierNote = `<div id="${noteId}" style="font-size:13px;color:#dc2626;font-weight:700;">${gapPp.toFixed(1)}pp below comparable peer median (${peerLatest.toFixed(1)}%)</div>`;
        }
      }
    }
  }

  // ─── Established NAR series ─────────────────────────────────────────────
  const hasEstCol = monthly.some((r) => r.establishedNar != null);
  const estValsList: (number | null)[] = hasEstCol
    ? monthly.map((r) => {
        const v = r.establishedNar;
        return v != null && !isNaN(v) ? Math.round(v * 1000) / 10 : null;
      })
    : [];

  const DIVERGE_THRESHOLD = 1.5;
  const paired = allVals.map((a, i) => [a, estValsList[i]] as const).filter(([, e]) => e != null);
  const avgDivergence = paired.length > 0
    ? paired.reduce((s, [a, e]) => s + Math.abs(a - (e as number)), 0) / paired.length
    : 0;
  const showEstablished = paired.length > 0 && avgDivergence > DIVERGE_THRESHOLD;
  // Label collision is handled at runtime via pixel positions (Flask approach)
  // The `estLabelPosition` static array is only used for display gating (hide nulls)
  const estLabelDisplay = estValsList.map((ev) => ev != null ? "show" : "hide");

  // ─── Y-axis bounds ──────────────────────────────────────────────────────
  const allPts = [
    ...allVals.filter((v) => v != null),
    ...(showEstablished ? estValsList.filter((v): v is number => v != null) : []),
    ...(showBenchmark ? benchmarkVals.filter((v): v is number => v != null) : []),
  ];
  // Flask's REAL formula (generator/slides.py:1331-1332 — verified directly against live
  // source, not this repo's CLAUDE.md, which documents "+1" and is stale on this specific
  // point): y_min = max(0, int(min(all_pts)) - 1), y_max = int(max(all_pts)) + 2. The earlier
  // fix this session ("+1") was itself wrong, based on that stale doc — it just happened to
  // still look like an improvement over the previous "ceil(max)+2" bug (22% axis with data
  // nowhere near it), without landing on Flask's actual number.
  const yMin = allPts.length > 0 ? Math.max(0, Math.floor(Math.min(...allPts)) - 1) : 0;
  const yMax = allPts.length > 0 ? Math.floor(Math.max(...allPts)) + 2 : 15;

  // ─── Expansion note ─────────────────────────────────────────────────────
  let expansionNote = "";
  if (monthly.length >= 2) {
    const last = monthly[monthly.length - 1];
    const prev = monthly[monthly.length - 2];
    const propDelta = (last.propertyCount ?? 0) - (prev.propertyCount ?? 0);
    const lastNar = last.adoptionRate;
    const prevNar = prev.adoptionRate;
    const lastEst = last.establishedNar;
    const estOk = lastEst != null && !isNaN(lastEst);
    if (propDelta >= 10 && lastNar < prevNar && estOk && (lastEst - lastNar) >= 0.02) {
      expansionNote =
        `<div style="font-size:10px;color:#7c5308;background:#fffbeb;border:1px solid #fde68a;` +
        `border-radius:6px;padding:6px 14px;margin-top:8px;text-align:center;line-height:1.5;">` +
        `<strong>${monthLabel(last.month)}:</strong> +${propDelta.toLocaleString()} net-new properties added - ` +
        `the "All Properties" dip is a denominator effect, not adoption decline. ` +
        `The dashed line shows established properties at ${(lastEst * 100).toFixed(1)}%.` +
        `</div>`;
    }
  }

  // ─── Split series (multi-PMC) ───────────────────────────────────────────
  let splitSeriesJs = "";
  let splitLegendItems = "";
  const splitColors = ["#0891b2", "#f59e0b"];
  if (monthlySplit && monthlySplit.length >= 2) {
    const combinedBp = monthly.map((r) => r.month);
    monthlySplit.forEach((sp, si) => {
      const spMo = sp.monthly;
      if (!spMo || spMo.length === 0) return;
      const spMap: Record<string, number> = {};
      for (const row of spMo) {
        spMap[row.month.slice(0, 7)] = Math.round(row.adoptionRate * 1000) / 10;
      }
      const spVals = combinedBp.map((m) => spMap[m.slice(0, 7)] ?? null);
      const spCol = splitColors[si % splitColors.length];
      const spLabel = _e(sp.name || `PMC ${si + 1}`);
      const dlJs = si === 0
        ? "{ display: false }"
        : `{ anchor: 'end', align: 'top', offset: 4, color: '${spCol}', font: { size: 9, weight: '600', family: 'Lexend' }, formatter: v => v != null ? v + '%' : '' }`;
      splitSeriesJs += `
    datasets.push({
      label: '${spLabel}',
      data: ${JSON.stringify(spVals)},
      borderColor: '${spCol}',
      backgroundColor: 'transparent',
      fill: false,
      tension: 0.35,
      pointRadius: 4,
      pointBackgroundColor: '${spCol}',
      pointBorderColor: '#fff',
      pointBorderWidth: 1.5,
      borderWidth: 2,
      datalabels: ${dlJs}
    });`;
      splitLegendItems +=
        `<span style="display:flex;align-items:center;gap:6px;">` +
        `<span style="display:inline-block;width:22px;height:3px;background:${spCol};border-radius:2px;"></span>` +
        `<span style="font-size:12px;color:#524e5b;">${spLabel}</span>` +
        `</span>`;
    });
  }

  // ─── Legend overlay ─────────────────────────────────────────────────────
  let bmLegend = "";
  if (showBenchmark) {
    const bmLabelSpan = benchmarkLabelTooltip
      ? `<span style="font-size:13px;color:#524e5b;text-decoration:underline dotted #9ca3af;` +
        `text-underline-offset:2px;cursor:help;" title="${_e(benchmarkLabelTooltip)}">${_e(benchmarkLabel)}</span>`
      : `<span style="font-size:13px;color:#524e5b;">${_e(benchmarkLabel)}</span>`;
    bmLegend =
      `<span id="bmLegend${slideId}" style="display:flex;align-items:center;gap:7px;">` +
      `<span style="display:inline-block;width:28px;height:0;border-top:2px dashed rgba(100,116,139,0.6);"></span>` +
      bmLabelSpan +
      `</span>`;
  }

  let estLegend = "";
  let estToggle = "";
  if (hasEstCol && showEstablished) {
    estLegend =
      `<span id="estLegend${slideId}" style="display:flex;align-items:center;gap:7px;">` +
      `<span style="display:inline-block;width:28px;height:0;border-top:2.5px dashed rgba(26,158,106,0.6);"></span>` +
      `<span style="font-size:13px;color:#524e5b;">Established Properties <span style="color:#a09cb0;">(excl. first 3 months)</span></span>` +
      `</span>`;
    estToggle =
      `<button onclick="toggleEstablished${slideId}(this)" ` +
      `style="pointer-events:auto;padding:3px 9px;border-radius:5px;border:1px solid #e5e7eb;` +
      `background:#fff;color:#524e5b;font-size:10px;font-weight:600;cursor:pointer;` +
      `font-family:'ABCDiatype',sans-serif;letter-spacing:0.04em;">Hide established line</button>`;
  }

  let bmToggle = "";
  if (showBenchmark) {
    bmToggle =
      `<button class="presenter-control" onclick="toggleBenchmark${slideId}(this)" ` +
      `style="pointer-events:auto;padding:3px 9px;border-radius:5px;border:1px solid #e5e7eb;` +
      `background:#fff;color:#524e5b;font-size:10px;font-weight:600;cursor:pointer;` +
      `font-family:'ABCDiatype',sans-serif;letter-spacing:0.04em;">Hide peer median</button>`;
  }

  const pmcDisplay = kpis?.pmc_name ?? "";
  const primaryLabel = !monthlySplit
    ? "All Properties"
    : (pmcDisplay ? `${_e(pmcDisplay)} (Total)` : "Combined");

  const legendOverlay =
    `<div style="position:absolute;top:10px;left:0;right:0;z-index:5;` +
    `display:flex;justify-content:center;gap:24px;align-items:center;pointer-events:none;flex-wrap:wrap;">` +
    `<span style="display:flex;align-items:center;gap:7px;">` +
    `<span style="display:inline-block;width:26px;height:12px;background:rgba(141,112,238,0.15);border:2px solid #8D70EE;border-radius:2px;"></span>` +
    `<span style="font-size:13px;color:#524e5b;">${primaryLabel}</span>` +
    `</span>` +
    splitLegendItems +
    estLegend +
    estToggle +
    bmLegend +
    bmToggle +
    `</div>`;

  // ─── Established footnote ───────────────────────────────────────────────
  let estFootnote = "";
  if (showEstablished) {
    estFootnote =
      `<div id="estFootnote${slideId}" style="font-size:10px;color:#a09cb0;text-align:center;margin-top:4px;">` +
      `Dashed line excludes properties in their first 3 months - separates portfolio expansion dilution from organic adoption change.` +
      `</div>`;
  }

  // ─── HTML ───────────────────────────────────────────────────────────────
  const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;">
    <div class="slide-header">
      <div class="slide-label">Adoption Rate</div>
      <div class="slide-title">Adoption Rate by Month</div>
      ${peerOutlierNote}
    </div>
    <div class="chart-wrap" style="position:relative;height:460px;padding:12px;">${legendOverlay}<canvas id="chart${slideId}"></canvas></div>
    ${expansionNote}
    ${estFootnote}
  </div>`;

  // ─── JS ─────────────────────────────────────────────────────────────────
  const js = `
window['initSlide${slideId}'] = (function() {
  let done = false;
  return function() {
    if (done) return; done = true;
    const allData = ${JSON.stringify(allVals)};
    const estData = ${JSON.stringify(estValsList)};
    // Pixel-based label collision helpers (Flask approach)
    const lineY = (chart, label, idx) => {
      const ds = chart.data.datasets.findIndex(d => d.label === label);
      if (ds < 0) return null;
      const meta = chart.getDatasetMeta(ds);
      if (!meta || !meta.data || !meta.data[idx]) return null;
      return meta.data[idx].y;
    };
    const isClose = (chart, idx) => {
      const allY = lineY(chart, 'All Properties', idx);
      const estY = lineY(chart, 'Established Properties', idx);
      return allY != null && estY != null && Math.abs(allY - estY) <= 20;
    };
    const estAlign = (chart, idx) => {
      if (isClose(chart, idx)) return 'top';
      const allY = lineY(chart, 'All Properties', idx);
      const estY = lineY(chart, 'Established Properties', idx);
      if (allY == null || estY == null) return 'top';
      return estY > allY ? 'bottom' : 'top';
    };
    const estOffset = (chart, idx) => estAlign(chart, idx) === 'bottom' ? 10 : 18;
    const allAlign = (chart, idx) => isClose(chart, idx) ? 'bottom' : 'top';
    const allOffset = (chart, idx) => allAlign(chart, idx) === 'bottom' ? 10 : 4;
    const datasets = [
      {
        label: 'All Properties',
        data: allData,
        borderColor: '#8D70EE',
        backgroundColor: 'rgba(141,112,238,0.08)',
        fill: true,
        tension: 0.35,
        pointRadius: 5,
        pointBackgroundColor: '#8D70EE',
        borderWidth: 2,
        datalabels: {
          color: '#1D1D1D',
          font: { size: 13, weight: '700', family: 'ABCDiatype' },
          anchor: ctx => allAlign(ctx.chart, ctx.dataIndex) === 'bottom' ? 'start' : 'end',
          align: ctx => allAlign(ctx.chart, ctx.dataIndex),
          offset: ctx => allOffset(ctx.chart, ctx.dataIndex),
          formatter: v => v != null ? v + '%' : ''
        }
      }
    ];
    ${splitSeriesJs}
    if (${showEstablished} && estData.length > 0 && estData.some(v => v != null)) {
      datasets.push({
        label: 'Established Properties',
        data: estData,
        borderColor: 'rgba(26,158,106,0.65)',
        backgroundColor: 'transparent',
        fill: false,
        tension: 0.35,
        pointRadius: 4,
        pointBackgroundColor: 'rgba(26,158,106,0.65)',
        pointBorderColor: 'rgba(26,158,106,0.65)',
        borderWidth: 1.5,
        borderDash: [5, 4],
        datalabels: {
          color: 'rgba(26,158,106,0.85)',
          font: { size: 10, weight: '500', family: 'ABCDiatype' },
          anchor: ctx => estAlign(ctx.chart, ctx.dataIndex) === 'bottom' ? 'start' : 'end',
          align: ctx => estAlign(ctx.chart, ctx.dataIndex),
          offset: ctx => estOffset(ctx.chart, ctx.dataIndex),
          display: ctx => ${JSON.stringify(estLabelDisplay)}[ctx.dataIndex] !== 'hide',
          formatter: v => v != null ? v + '%' : ''
        }
      });
    }
    if (${showBenchmark}) {
      const bmData = ${JSON.stringify(benchmarkVals)};
      if (bmData.some(v => v != null)) {
        datasets.push({
          label: ${JSON.stringify(benchmarkLabel)},
          data: bmData,
          borderColor: 'rgba(100,116,139,0.55)',
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 1.5,
          borderDash: [3, 3],
          datalabels: { display: false }
        });
      }
    }
    new Chart(document.getElementById('chart${slideId}'), {
      type: 'line',
      data: { labels: ${JSON.stringify(months)}, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          datalabels: { display: true }
        },
        layout: { padding: { top: 36, bottom: 10, right: 10, left: 4 } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#524e5b', font: { size: 13, family: 'ABCDiatype' } } },
          y: {
            grid: { color: '#eceaf2' },
            ticks: {
              color: '#524e5b', font: { size: 13, family: 'ABCDiatype' },
              callback: v => v + '%'
            },
            beginAtZero: false,
            suggestedMin: ${yMin},
            suggestedMax: ${yMax}
          }
        }
      }
    });
  };
})();
window['toggleEstablished${slideId}'] = function(btn) {
  const chart = Chart.getChart('chart${slideId}');
  if (!chart) return;
  const idx = chart.data.datasets.findIndex(d => d.label === 'Established Properties');
  if (idx < 0) return;
  const nowVisible = !chart.isDatasetVisible(idx);
  chart.setDatasetVisibility(idx, nowVisible);
  chart.update();
  btn.textContent = nowVisible ? 'Hide established line' : 'Show established line';
  const legend = document.getElementById('estLegend${slideId}');
  if (legend) legend.style.display = nowVisible ? 'flex' : 'none';
  const footnote = document.getElementById('estFootnote${slideId}');
  if (footnote) footnote.style.display = nowVisible ? 'block' : 'none';
};
window['toggleBenchmark${slideId}'] = function(btn) {
  const chart = Chart.getChart('chart${slideId}');
  if (!chart) return;
  const idx = chart.data.datasets.findIndex(d => d.label === ${JSON.stringify(benchmarkLabel)});
  if (idx < 0) return;
  const nowVisible = !chart.isDatasetVisible(idx);
  chart.setDatasetVisibility(idx, nowVisible);
  chart.update();
  btn.textContent = nowVisible ? 'Hide peer median' : 'Show peer median';
  const legend = document.getElementById('bmLegend${slideId}');
  if (legend) legend.style.display = nowVisible ? 'flex' : 'none';
  const note = document.getElementById('peerOutlierNote${slideId}');
  if (note) note.style.display = nowVisible ? 'block' : 'none';
};`;

  return { html, js };
}


// ─── render_high_rent_adoption (Slide 39 — Rent by Bucket) ──────────────────

interface RentBucketInput {
  slideId: number;
  pmcName: string;
  propertySnapshot: { propertyName: string; units: number; billsPaid: number; rentPaid: number; adoptionRate: number }[];
  /** Optional resident-level rent amounts for last month (more accurate than property averages) */
  residentRents?: number[];
  /** Optional all-time resident-level rent averages (enables All-Time toggle) */
  alltimeResidentRents?: { amountPaid: number; totalPaid: number }[];
}

export function renderHighRentAdoption(input: RentBucketInput): { html: string; js: string } {
  const { slideId, pmcName, propertySnapshot, residentRents, alltimeResidentRents } = input;
  const pmc = _e(pmcName);

  // Need properties with meaningful data
  const active = propertySnapshot.filter((p) => p.billsPaid > 0 && p.units > 0);
  if (active.length < 2) return { html: "", js: "" };

  // Compute per-property avg rent and monthly active users
  const propsWithRent = active.map((p) => ({
    ...p,
    avgRent: p.rentPaid / Math.max(p.billsPaid, 1),
    avgMonthlyUsers: p.billsPaid,
    nar: p.billsPaid / Math.max(p.units, 1),
  })).sort((a, b) => a.avgRent - b.avgRent);

  // Prefer resident-level data for bucketing when available (more accurate)
  const hasResident = residentRents && residentRents.length >= 4;
  const rentsForBreaks = hasResident
    ? residentRents.filter((r) => r > 0)
    : propsWithRent.map((p) => p.avgRent);

  if (rentsForBreaks.length < 2) return { html: "", js: "" };

  // Dynamic bucketing: equal-dollar-width bins spanning P5-P95
  const sorted = [...rentsForBreaks].sort((a, b) => a - b);
  const percentile = (arr: number[], p: number) => {
    const idx = (p / 100) * (arr.length - 1);
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return lo === hi ? arr[lo] : arr[lo] + (arr[hi] - arr[lo]) * (idx - lo);
  };
  const p5val = percentile(sorted, 5);
  const p95val = percentile(sorted, 95);
  const medianRent = percentile(sorted, 50);
  const snap = medianRent >= 2000 ? 500 : 250;
  const loSnap = Math.max(snap, Math.round(p5val / snap) * snap);
  const hiSnap = Math.max(loSnap + snap, Math.round(p95val / snap) * snap);
  const targetBuckets = 5;
  const bucketWidth = Math.max(snap, Math.round((hiSnap - loSnap) / targetBuckets / snap) * snap);

  const bucketBreaks: number[] = [];
  for (let b = loSnap; b < hiSnap && bucketBreaks.length < targetBuckets; b += bucketWidth) {
    bucketBreaks.push(b);
  }
  if (bucketBreaks.length < 2) bucketBreaks.splice(0, bucketBreaks.length, 1000, 1500, 2000);

  const bucketOrder = [
    `Under $${bucketBreaks[0].toLocaleString()}`,
    ...bucketBreaks.slice(0, -1).map((b, i) => `$${b.toLocaleString()}–$${bucketBreaks[i + 1].toLocaleString()}`),
    `$${bucketBreaks[bucketBreaks.length - 1].toLocaleString()}+`,
  ];

  function bucketLabel(r: number): string {
    for (let i = 0; i < bucketBreaks.length; i++) {
      if (r < bucketBreaks[i]) return i === 0 ? `Under $${bucketBreaks[0].toLocaleString()}` : `$${bucketBreaks[i - 1].toLocaleString()}–$${bucketBreaks[i].toLocaleString()}`;
    }
    return `$${bucketBreaks[bucketBreaks.length - 1].toLocaleString()}+`;
  }

  const bucketAgg: Record<string, { users: number; rent: number }> = {};
  bucketOrder.forEach((l) => { bucketAgg[l] = { users: 0, rent: 0 }; });

  if (hasResident) {
    // Bucket individual residents by their actual payment amount
    for (const r of residentRents) {
      if (r <= 0) continue;
      const lbl = bucketLabel(r);
      if (bucketAgg[lbl]) { bucketAgg[lbl].users += 1; bucketAgg[lbl].rent += r; }
    }
  } else {
    // Fallback to property-level (weighted by avg monthly users)
    for (const p of propsWithRent) {
      const lbl = bucketLabel(p.avgRent);
      if (bucketAgg[lbl]) { bucketAgg[lbl].users += p.avgMonthlyUsers; bucketAgg[lbl].rent += p.rentPaid; }
    }
  }

  // Filter empty buckets and compute shares
  const filledLabels = bucketOrder.filter((l) => bucketAgg[l].users > 0);
  if (filledLabels.length === 0) return { html: "", js: "" };

  const totalUsers = filledLabels.reduce((s, l) => s + bucketAgg[l].users, 0) || 1;
  // Largest remainder method for integer percentages that sum to exactly 100
  const rawShares = filledLabels.map((l) => bucketAgg[l].users / totalUsers * 100);
  const floored = rawShares.map((v) => Math.floor(v));
  const deficit = 100 - floored.reduce((s, v) => s + v, 0);
  const byRemainder = floored.map((_, i) => i).sort((a, b) => (rawShares[b] - floored[b]) - (rawShares[a] - floored[a]));
  for (let k = 0; k < deficit; k++) floored[byRemainder[k]] += 1;
  const chartVals = floored;
  const rentVals = filledLabels.map((l) => Math.round(bucketAgg[l].rent));

  const chartMax = Math.ceil((Math.max(...chartVals) + 5) / 10) * 10;
  // Rent axis headroom: 30% above the tallest bar, snapped to $25K increments
  const rentChartMax = rentVals.length > 0 ? Math.ceil(Math.max(...rentVals) * 1.3 / 25_000) * 25_000 : 100_000;

  // Dynamic subtitle
  const topBucketShare = chartVals[chartVals.length - 1];
  const r75 = bucketBreaks[bucketBreaks.length - 1];
  const adoptCopy = topBucketShare > 0
    ? `<strong>${topBucketShare}% of ${pmc}'s active Flex users pay $${r75.toLocaleString()}+/month in rent.</strong> Flex isn't just for rent-burdened residents — residents choose it for the timing flexibility, regardless of what they pay.`
    : `Flex users span every rent level — the timing problem doesn't care how much rent costs.`;

  const labelsJs = JSON.stringify(filledLabels);
  const valsJs = JSON.stringify(chartVals);
  const rentJs = JSON.stringify(rentVals);

  // Gradient purple colors (ascending intensity)
  const purpleColors = filledLabels.map((_, i) => {
    const opacity = 0.25 + (i / Math.max(filledLabels.length - 1, 1)) * 0.65;
    return `rgba(106,61,184,${opacity.toFixed(2)})`;
  });

  // --- Raw data for client-side period toggle (Last Month / All-Time) ---
  const lastRents: number[] = hasResident ? residentRents.filter((r) => r > 0) : propsWithRent.filter((p) => p.avgRent > 0).map((p) => p.avgRent);
  const lastWeights: number[] = hasResident ? lastRents.map(() => 1) : propsWithRent.filter((p) => p.avgRent > 0).map((p) => p.avgMonthlyUsers);
  const hasAlltime = alltimeResidentRents && alltimeResidentRents.length >= 4;
  const allRents = hasAlltime ? alltimeResidentRents.filter((r) => r.amountPaid > 0).map((r) => r.amountPaid) : null;
  const allWeights = hasAlltime ? alltimeResidentRents.filter((r) => r.amountPaid > 0).map(() => 1) : null;
  const allTotals = hasAlltime ? alltimeResidentRents.filter((r) => r.amountPaid > 0).map((r) => r.totalPaid) : null;
  const hrDataJs = JSON.stringify(hasAlltime
    ? { last: { rents: lastRents, weights: lastWeights }, all: { rents: allRents, weights: allWeights, totals: allTotals } }
    : { last: { rents: lastRents, weights: lastWeights }, all: null });

  // Period toggle HTML (only when all-time data exists)
  const periodToggleHtml = hasAlltime ? `
      <div class="presenter-control" style="display:flex;gap:16px;align-items:center;margin-bottom:8px;flex-shrink:0;">
        <div id="hr-period-btns-${slideId}" style="display:flex;gap:4px;align-items:center;">
          <span style="text-transform:uppercase;letter-spacing:0.05em;font-size:9px;color:#9ca3af;">Period</span>
          <button class="spark-ctrl-btn is-active" data-hr-period="last" onclick="flexRentBucket(${slideId},'last')">Last Month</button>
          <button class="spark-ctrl-btn" data-hr-period="all" onclick="flexRentBucket(${slideId},'all')">All-Time</button>
        </div>
      </div>` : "";

  const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;">
    <div class="slide-header" style="margin-bottom:12px;flex-shrink:0;">
      <div class="slide-label">FLEX IS FOR EVERYONE</div>
      <div class="slide-title">Your residents use Flex across every rent level — some just use it more.</div>
      <div style="font-size:13px;color:#524e5b;margin-top:6px;">${adoptCopy}</div>
    </div>
    <div style="flex:1;min-height:0;background:#f7f7f7;border:1px solid #eceaf2;border-radius:14px;padding:16px 24px 12px;display:flex;flex-direction:column;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-shrink:0;">
        <div style="font-size:9px;font-weight:600;color:#524e5b;text-transform:uppercase;letter-spacing:0.1em;">
          FLEX USERS BY RENT LEVEL · ${pmc} · SHARE OF ACTIVE FLEX USERS
        </div>
        <div style="display:flex;gap:14px;align-items:center;font-size:10px;color:#524e5b;flex-shrink:0;margin-left:16px;">
          <span><span style="display:inline-block;width:10px;height:10px;background:rgba(106,61,184,0.7);border-radius:2px;margin-right:4px;vertical-align:middle;"></span>% of Flex users</span>
          <span><span style="display:inline-block;width:10px;height:10px;background:rgba(26,158,106,0.4);border:1px solid #1a9e6a;border-radius:2px;margin-right:4px;vertical-align:middle;"></span><span id="hr-rent-legend-${slideId}">Rent Paid / mo</span></span>
        </div>
      </div>${periodToggleHtml}
      <div style="flex:1;min-height:0;position:relative;">
        <canvas id="hrchart${slideId}"></canvas>
      </div>
    </div>
  </div>`;

  const js = `
window['initSlide${slideId}'] = (function() {
  let done = false;
  return function() {
    if (done) return; done = true;
    var fmtRent = function(v) { if (!v) return '$0'; return v < 1e6 ? '$' + Math.round(v / 1e3) + 'K' : '$' + (v / 1e6).toFixed(1) + 'M'; };
    window['hrChart${slideId}'] = new Chart(document.getElementById('hrchart${slideId}'), {
      type: 'bar',
      data: {
        labels: ${labelsJs},
        datasets: [
          {
            label: '% of Flex users',
            data: ${valsJs},
            backgroundColor: ${JSON.stringify(purpleColors)},
            borderColor: '#6A3DB8', borderWidth: 1.5, borderRadius: 4,
            yAxisID: 'y',
            datalabels: { anchor: 'end', align: 'end', formatter: function(v) { return v + '% of users'; }, color: '#2C194D',
                          font: { size: 12, weight: '700' }, backgroundColor: 'rgba(255,255,255,0.85)',
                          borderRadius: 4, padding: { top: 2, bottom: 2, left: 5, right: 5 } }
          },
          {
            label: 'Rent Paid / mo',
            data: ${rentJs},
            backgroundColor: 'rgba(26,158,106,0.20)',
            borderColor: '#1a9e6a', borderWidth: 1.5, borderRadius: 4,
            yAxisID: 'y2',
            datalabels: { anchor: 'end', align: 'end', formatter: function(v) { return fmtRent(v); }, color: '#1a9e6a', font: { size: 11, weight: '600' } }
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 28, right: 8, bottom: 20 } },
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: '#524e5b', font: { size: 12, weight: '600' } } },
          y: { min: 0, max: ${chartMax}, position: 'left', grid: { color: '#f3f4f6' }, border: { display: false },
               ticks: { color: '#9ca3af', font: { size: 10 }, callback: function(v) { return v + '%'; } }, title: { display: true, text: '% of Flex users', color: '#9ca3af', font: { size: 9 } } },
          y2: { min: 0, max: ${rentChartMax}, position: 'right', grid: { display: false }, border: { display: false },
                ticks: { color: '#1a9e6a', font: { size: 10 }, callback: function(v) { return fmtRent(v); } } }
        }
      }
    });
    window['hrState${slideId}'] = { period: 'last', data: ${hrDataJs} };
    requestAnimationFrame(function() { window['hrChart${slideId}'].resize(); });
  };
})();

// ── Rent-bucket period toggle (client-side re-bucketing + Y-axis rescale) ──
function flexRentPercentile(sorted, p) {
  if (!sorted.length) return 0;
  var idx = (p / 100) * (sorted.length - 1);
  var lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
function flexRentBreaks(rents) {
  var sorted = rents.slice().sort(function(a, b) { return a - b; });
  var lo = flexRentPercentile(sorted, 5);
  var hi = flexRentPercentile(sorted, 95);
  if (hi <= lo) return [1000, 1500, 2000];
  var med = flexRentPercentile(sorted, 50);
  var snap = med >= 2000 ? 500 : 250;
  var loSnap = Math.max(snap, Math.round(lo / snap) * snap);
  var hiSnap = Math.max(loSnap + snap, Math.round(hi / snap) * snap);
  var targetBuckets = 5;
  var width = Math.max(snap, Math.round((hiSnap - loSnap) / targetBuckets / snap) * snap);
  var raw = [];
  for (var b = loSnap; b < hiSnap && raw.length < targetBuckets; b += width) { raw.push(b); }
  var deduped = Array.from(new Set(raw)).sort(function(a, b) { return a - b; });
  return deduped.length >= 2 ? deduped : [1000, 1500, 2000];
}
function flexRentBucketLabel(r, breaks) {
  for (var i = 0; i < breaks.length; i++) {
    if (r < breaks[i]) return i === 0 ? ('Under $' + breaks[i].toLocaleString()) : ('$' + breaks[i - 1].toLocaleString() + '\\u2013$' + breaks[i].toLocaleString());
  }
  return '$' + breaks[breaks.length - 1].toLocaleString() + '+';
}
function flexRentBucketData(dataset, breaks) {
  var order = ['Under $' + breaks[0].toLocaleString()]
    .concat(breaks.slice(0, -1).map(function(b, i) { return '$' + b.toLocaleString() + '\\u2013$' + breaks[i + 1].toLocaleString(); }))
    .concat(['$' + breaks[breaks.length - 1].toLocaleString() + '+']);
  var agg = {};
  order.forEach(function(l) { agg[l] = { users: 0, rent: 0 }; });
  for (var i = 0; i < dataset.rents.length; i++) {
    var r = dataset.rents[i], w = dataset.weights[i];
    if (!(r > 0)) continue;
    var lbl = flexRentBucketLabel(r, breaks);
    agg[lbl].users += w;
    agg[lbl].rent += dataset.totals ? dataset.totals[i] : r * w;
  }
  var labels = order.filter(function(l) { return agg[l].users > 0; });
  if (!labels.length) return { labels: [], userShare: [], rentRaw: [] };
  var totalUsers = labels.reduce(function(s, l) { return s + agg[l].users; }, 0) || 1;
  var raw2 = labels.map(function(l) { return agg[l].users / totalUsers * 100; });
  var floored2 = raw2.map(Math.floor);
  var deficit2 = 100 - floored2.reduce(function(a, b) { return a + b; }, 0);
  var byRem = labels.map(function(l, i) { return i; }).sort(function(a, b) { return (raw2[b] - floored2[b]) - (raw2[a] - floored2[a]); });
  for (var k = 0; k < deficit2; k++) { floored2[byRem[k]] += 1; }
  var rentRaw = labels.map(function(l) { return agg[l].rent; });
  return { labels: labels, userShare: floored2, rentRaw: rentRaw };
}
function flexRentGradient(n) {
  var colors = [];
  for (var i = 0; i < n; i++) {
    var opacity = 0.25 + (i / Math.max(n - 1, 1)) * 0.65;
    colors.push('rgba(106,61,184,' + opacity.toFixed(2) + ')');
  }
  return colors;
}
function flexRentBucket(sid, period) {
  var st = window['hrState' + sid];
  var chart = window['hrChart' + sid];
  if (!st || !chart) return;
  st.period = period;
  var ds = st.data[st.period];
  if (!ds) return;
  var posRents = ds.rents.filter(function(r) { return r > 0; });
  if (posRents.length < 4) return;
  var breaks = flexRentBreaks(posRents);
  var bucketed = flexRentBucketData(ds, breaks);
  if (!bucketed.labels.length) return;
  chart.data.labels = bucketed.labels;
  chart.data.datasets[0].data = bucketed.userShare;
  // Re-derive the purple gradient for the new bucket count — re-toggling between periods can
  // produce a different number of buckets (a wider All-Time rent spread bins differently than
  // Last Month), and the bar colors never got recomputed to match, so they went stale/misaligned
  // with the new data (this is the "shading doesn't update" bug).
  chart.data.datasets[0].backgroundColor = flexRentGradient(bucketed.labels.length);
  chart.data.datasets[1].data = bucketed.rentRaw;
  // Update legend: "Rent Paid / mo" vs "Total Rent Paid" depending on period
  var rentLabel = st.period === 'all' ? 'Total Rent Paid' : 'Rent Paid / mo';
  chart.data.datasets[1].label = rentLabel;
  var legendEl = document.getElementById('hr-rent-legend-' + sid);
  if (legendEl) legendEl.textContent = rentLabel;
  // Rescale Y-axis (% of users) to fit new data
  var maxV = Math.max.apply(null, bucketed.userShare.concat([10]));
  chart.options.scales.y.max = Math.ceil((maxV + 5) / 10) * 10;
  // Rescale Y2-axis (rent) with 30% headroom
  var maxRent = Math.max.apply(null, bucketed.rentRaw.concat([1]));
  chart.options.scales.y2.max = Math.ceil(maxRent * 1.3 / 25000) * 25000;
  chart.update();
  // Toggle button active states. Scoped to a dedicated id (hr-period-btns-{sid}) instead of
  // slide-{sid} -- slide-{sid} can resolve to a different/duplicate DOM node (same class of
  // id-collision bug found elsewhere this session).
  var btnCtrl = document.getElementById('hr-period-btns-' + sid);
  if (btnCtrl) {
    var btns = btnCtrl.querySelectorAll('[data-hr-period]');
    btns.forEach(function(b) { b.classList.toggle('is-active', b.dataset.hrPeriod === st.period); });
  }
}`;

  return { html, js };
}

// ─── render_residents_units_combo (Slide 54) ────────────────────────────────

export interface ResidentsUnitsInput {
  slideId: number;
  monthlyTotals: MonthlyTotal[];
}

export function renderResidentsUnitsCombo(input: ResidentsUnitsInput): SlideResult {
  const { slideId, monthlyTotals } = input;

  if (monthlyTotals.length < 2) {
    const val = monthlyTotals.length > 0 ? monthlyTotals[monthlyTotals.length - 1].billsPaid : 0;
    return {
      html: `
  <div class="slide" id="slide-${slideId}" style="background:#fff;">
    <div class="slide-header">
      <div class="slide-label">Portfolio</div>
      <div class="slide-title">Residents, Units &amp; Rent</div>
    </div>
    <div style="display:flex;align-items:center;justify-content:center;height:320px;flex-direction:column;gap:8px;">
      <div style="font-size:64px;font-weight:400;color:#6A3DB8;letter-spacing:-0.03em;">${val.toLocaleString()}</div>
      <div style="font-size:14px;color:#a09cb0;">Only one month of data - increase lookback for trend view</div>
    </div>
  </div>`,
      js: "",
    };
  }

  const months = monthlyTotals.map(m => monthLabel(m.month));
  const residents = monthlyTotals.map(m => m.billsPaid);
  const units = monthlyTotals.map(m => m.units);
  const rent = monthlyTotals.map(m => Math.round(m.rentPaid * 100) / 100);

  const monthsJson = JSON.stringify(months);
  const residentsJson = JSON.stringify(residents);
  const unitsJson = JSON.stringify(units);
  const rentJson = JSON.stringify(rent);

  // Rent axis padding
  const rentMin = Math.min(...rent);
  const rentMax = Math.max(...rent);
  const rentSpan = rentMax - rentMin;
  const rentPad = rentSpan > 0 ? rentSpan * 0.6 : Math.max(rentMax * 0.15, 1);
  const y2Min = Math.max(0, rentMin - rentPad);
  const y2Max = rentMax + rentPad;

  const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;">
    <div class="slide-header">
      <div class="slide-label">Portfolio</div>
      <div class="slide-title">Residents paying against your unit base, plus the rent behind it.</div>
    </div>
    <div style="display:flex;gap:16px;font-size:11px;color:#524e5b;margin:-6px 0 6px;">
      <span><span style="display:inline-block;width:14px;height:3px;background:#6A3DB8;border-radius:2px;margin-right:5px;vertical-align:middle;"></span>Residents Paying</span>
      <span><span style="display:inline-block;width:14px;height:3px;background:#2563EB;border-radius:2px;margin-right:5px;vertical-align:middle;"></span>Units in Network</span>
      <span><span style="display:inline-block;width:14px;height:3px;background:#1a9e6a;border-radius:2px;margin-right:5px;vertical-align:middle;"></span>Rent Collected</span>
    </div>
    <div class="chart-wrap"><canvas id="chart${slideId}"></canvas></div>
  </div>`;

  const js = `
window['initSlide${slideId}'] = (function() {
  let done = false;
  return function() {
    if (done) return; done = true;
    const fmtRent = v => '$' + (v >= 1000000 ? (v/1000000).toFixed(2)+'M' : (v/1000).toFixed(0)+'K');
    const lineY = (chart, label, idx) => {
      const dsIdx = chart.data.datasets.findIndex(d => d.label === label);
      const meta = dsIdx >= 0 ? chart.getDatasetMeta(dsIdx) : null;
      return meta && meta.data[idx] ? meta.data[idx].y : null;
    };
    const unitsRentAlign = (chart, idx, label) => {
      const uY = lineY(chart, 'Units in Network', idx);
      const gY = lineY(chart, 'Rent Collected', idx);
      if (uY == null || gY == null) return 'top';
      if (Math.abs(uY - gY) >= 45) return 'top';
      const selfY = label === 'Units in Network' ? uY : gY;
      const otherY = label === 'Units in Network' ? gY : uY;
      return selfY > otherY ? 'bottom' : 'top';
    };
    const residentsRentAlign = (chart, idx, label) => {
      const rY = lineY(chart, 'Residents Paying', idx);
      const gY = lineY(chart, 'Rent Collected', idx);
      if (rY == null || gY == null) return 'top';
      if (Math.abs(rY - gY) >= 45) return 'top';
      if (rY === gY) return label === 'Residents Paying' ? 'bottom' : 'top';
      const selfY = label === 'Residents Paying' ? rY : gY;
      const otherY = label === 'Residents Paying' ? gY : rY;
      return selfY > otherY ? 'bottom' : 'top';
    };
    const residentsAlign = (chart, idx) => residentsRentAlign(chart, idx, 'Residents Paying');
    const rentAlign = (chart, idx) => {
      const gY = lineY(chart, 'Rent Collected', idx);
      if (gY == null) return 'top';
      if (unitsRentAlign(chart, idx, 'Rent Collected') === 'bottom') return 'bottom';
      if (residentsRentAlign(chart, idx, 'Rent Collected') === 'bottom') return 'bottom';
      return 'top';
    };
    const rentOffset = (chart, idx) => {
      const align = rentAlign(chart, idx);
      if (align === 'top') {
        const gY = lineY(chart, 'Rent Collected', idx);
        const rY = lineY(chart, 'Residents Paying', idx);
        if (rY != null && gY != null && rY === gY) {
          const uY = lineY(chart, 'Units in Network', idx);
          let offset = 20;
          if (uY != null) {
            const clearance = gY - uY;
            if (clearance > 0) offset = Math.min(offset, Math.max(8, clearance - 20));
          }
          return offset;
        }
      }
      return 6;
    };
    const _comboChart = new Chart(document.getElementById('chart${slideId}'), {
      type: 'line',
      data: {
        labels: ${monthsJson},
        datasets: [
          {
            label: '_residentsBaseline',
            data: ${residentsJson},
            borderWidth: 0, pointRadius: 0, pointHoverRadius: 0,
            backgroundColor: 'rgba(106,61,184,0.38)', fill: 'origin',
            tension: 0.4, yAxisID: 'y',
            datalabels: { display: false }
          },
          {
            label: 'Units in Network',
            data: ${unitsJson},
            borderColor: '#2563EB', backgroundColor: 'rgba(106,61,184,0.16)', borderWidth: 2,
            borderDash: [5, 4],
            pointBackgroundColor: '#2563EB', pointBorderColor: '#fff', pointBorderWidth: 2,
            pointRadius: 4, fill: 0, tension: 0.4, yAxisID: 'y',
            datalabels: { align: ctx => unitsRentAlign(ctx.chart, ctx.dataIndex, 'Units in Network'), anchor: 'end', color: '#2563EB',
              font: { size: 10, weight: '600', family: 'Lexend' },
              formatter: v => v.toLocaleString(), offset: 6,
              display: true }
          },
          {
            label: 'Residents Paying',
            data: ${residentsJson},
            borderColor: '#6A3DB8', backgroundColor: 'transparent', borderWidth: 3,
            pointBackgroundColor: '#6A3DB8', pointBorderColor: '#fff', pointBorderWidth: 2,
            pointRadius: 7, fill: false, tension: 0.4, yAxisID: 'y',
            datalabels: { align: ctx => residentsAlign(ctx.chart, ctx.dataIndex), anchor: 'end', color: '#6A3DB8',
              font: { size: 10, weight: '600', family: 'Lexend' },
              formatter: v => v.toLocaleString(), offset: 12,
              display: true }
          },
          {
            label: 'Rent Collected',
            data: ${rentJson},
            borderColor: '#1a9e6a', backgroundColor: 'transparent', borderWidth: 2,
            pointBackgroundColor: '#1a9e6a', pointBorderColor: '#fff', pointBorderWidth: 2,
            pointRadius: 5, fill: false, tension: 0.4, yAxisID: 'y2',
            datalabels: {
              align: ctx => rentAlign(ctx.chart, ctx.dataIndex), anchor: 'end', color: '#1a9e6a',
              font: { size: 10, weight: '600', family: 'Lexend' },
              formatter: v => fmtRent(v),
              offset: ctx => rentOffset(ctx.chart, ctx.dataIndex),
              display: true }
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 32, left: 56, right: 16 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false }, datalabels: {},
          tooltip: {
            filter: item => !item.dataset.label.startsWith('_'),
            callbacks: {
              label: ctx => {
                const v = ctx.parsed.y;
                const fmt = ctx.dataset.label === 'Rent Collected' ? fmtRent(v) : v.toLocaleString();
                return ctx.dataset.label + ': ' + fmt;
              },
              afterLabel: ctx => {
                const i = ctx.dataIndex;
                if (i === 0) return '';
                const data = ctx.dataset.data;
                const cur = data[i], prev = data[i - 1];
                if (!prev) return '';
                const pct = (cur - prev) / prev * 100;
                const sign = pct >= 0 ? '+' : '';
                return sign + pct.toFixed(1) + '% vs prior month';
              }
            }
          }
        },
        scales: {
          x: { grid: { color: '#eceaf2' }, ticks: { color: '#524e5b', font: { size: 12, family: 'Lexend' }, padding: 8 } },
          y: { position: 'left', beginAtZero: true, grid: { color: '#eceaf2' },
               ticks: { color: '#524e5b', font: { size: 11, family: 'Lexend' }, callback: v => v.toLocaleString(), padding: 4 },
               title: { display: true, text: 'Residents / Units', color: '#524e5b', font: { size: 9 } } },
          y2: { position: 'right', min: ${y2Min}, max: ${y2Max}, display: false }
        }
      }
    });
    requestAnimationFrame(() => { _comboChart.resize(); });
  };
})();
`;

  return { html, js };
}

// ─── render_since_inception (Slide 56) ──────────────────────────────────────

export interface YearlyData {
  year: number;
  totalRent: number;
  billsPaid: number;
  monthsActive: number;
  ytdRent: number;
  ytdBills: number;
  ytdMonthsActive: number;
}

export interface SinceInceptionInput {
  slideId: number;
  pmcName: string;
  reportingMonth: string; // YYYY-MM-DD
  yearlyData: YearlyData[]; // full history from unbounded query
  monthlyTotals: MonthlyTotal[]; // recent monthly for projection run-rate
  /** Same canonical value the Cover slide uses (earliest of Salesforce closed-won or first
   * rollout, or a manual override) — see the firstYear comment below for why this must be
   * threaded through rather than re-derived from yearlyData. */
  partnerSince?: string | null;
}

export function renderSinceInception(input: SinceInceptionInput): SlideResult {
  const { slideId, pmcName, reportingMonth, yearlyData, monthlyTotals, partnerSince } = input;
  if (yearlyData.length === 0) return { html: "", js: "" };

  const years = yearlyData.map(y => y.year);
  const rentRaw = yearlyData.map(y => y.totalRent);
  const billsPaid = yearlyData.map(y => y.billsPaid);
  const monthsActive = yearlyData.map(y => y.monthsActive);

  const labels = years.map(y => String(y));
  // "Joined Flex in {year}" must respect partnerSince — the same Cover-slide value (Salesforce
  // closed-won date or first rollout, or a manual override) — matching Flask's fix (generator/
  // slides.py render_since_inception): this used to always use years[0], the raw earliest year
  // with billing data in PROPERTY_BP_MONTH_STATS, which ignores a manual override and the
  // documented case where a transferred property's rollout_month is inherited from its PRIOR,
  // unrelated owner. That's exactly why this slide could disagree with the Cover slide on the
  // partner-since year. Falls back to years[0] only when partnerSince isn't available at all.
  const firstYear = partnerSince ? new Date(partnerSince + "T00:00:00Z").getUTCFullYear() : years[0];
  const totalRentAll = rentRaw.reduce((s, v) => s + v, 0);
  const totalBillsAll = billsPaid.reduce((s, v) => s + v, 0);
  const currentYear = parseInt(reportingMonth.slice(0, 4), 10);

  const subtitle = `<strong>${fmtCurrency(totalRentAll)} guaranteed</strong> and <strong>${totalBillsAll.toLocaleString()} bills paid</strong> since ${_e(pmcName)} joined Flex in ${firstYear}.`;

  // Projection for incomplete current year
  const lastMonthsActive = monthsActive[monthsActive.length - 1];
  const hasProjection = years[years.length - 1] === currentYear && lastMonthsActive > 0 && lastMonthsActive < 12;
  let projRentVal: number | null = null;
  let projBillsVal: number | null = null;
  let ghostPctText = "";

  if (hasProjection) {
    const remaining = 12 - lastMonthsActive;
    // Trailing 3-month run rate
    const recent = monthlyTotals.slice(-3);
    const nRecent = recent.length;
    const avgRecentRent = nRecent > 0 ? recent.reduce((s, m) => s + m.rentPaid, 0) / nRecent : rentRaw[rentRaw.length - 1] / lastMonthsActive;
    const avgRecentBills = nRecent > 0 ? recent.reduce((s, m) => s + m.billsPaid, 0) / nRecent : billsPaid[billsPaid.length - 1] / lastMonthsActive;
    projRentVal = rentRaw[rentRaw.length - 1] + avgRecentRent * remaining;
    projBillsVal = Math.round(billsPaid[billsPaid.length - 1] + avgRecentBills * remaining);

    // % change vs prior full year
    if (years.length >= 2) {
      const priorIdx = years.length - 2;
      if (rentRaw[priorIdx] > 0) {
        const pct = (projRentVal - rentRaw[priorIdx]) / rentRaw[priorIdx] * 100;
        ghostPctText = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% vs ${labels[priorIdx]}`;
      }
    }
  }

  const yMaxVal = Math.max(...rentRaw, ...(projRentVal ? [projRentVal] : []));
  const yMax = yMaxVal > 0 ? yMaxVal * 1.22 : 1;

  const nReal = rentRaw.length;
  const chartLabels = hasProjection ? [...labels, ""] : labels;
  const rentSolidChart = hasProjection ? [...rentRaw, null] : rentRaw;

  const labelsJs = JSON.stringify(chartLabels);
  const rentSolidJs = JSON.stringify(rentSolidChart);
  const billsActualJs = JSON.stringify(billsPaid);
  const projRentJs = projRentVal !== null ? JSON.stringify(projRentVal) : "null";
  const projBillsJs = projBillsVal !== null ? JSON.stringify(projBillsVal) : "null";
  const ghostPctJs = JSON.stringify(ghostPctText);

  // ── YTD data: use pre-computed ytd values from yearly query ────
  const reportMonth = parseInt(reportingMonth.slice(5, 7), 10);
  const monthLbl = new Date(reportingMonth + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const ytdYears = yearlyData.filter(y => y.ytdMonthsActive > 0).map(y => y.year);
  const ytdRent = ytdYears.map(y => yearlyData.find(d => d.year === y)!.ytdRent);
  const ytdBills = ytdYears.map(y => yearlyData.find(d => d.year === y)!.ytdBills);
  const ytdLabels = ytdYears.map(y => String(y));
  const hasYtdToggle = ytdYears.length >= 1;
  const ytdLabelsJs = JSON.stringify(ytdLabels);
  const ytdRentJs = JSON.stringify(ytdRent);
  const ytdBillsJs = JSON.stringify(ytdBills);
  const ytdNReal = ytdYears.length;
  const ytdYMaxVal = ytdRent.length > 0 ? Math.max(...ytdRent) : 1;
  const ytdYMax = ytdYMaxVal > 0 ? ytdYMaxVal * 1.22 : 1;

  const toggleHtml = hasYtdToggle
    ? `<div class="pdf-export-hide" style="margin-left:12px;flex-shrink:0;">
        <button class="spark-ctrl-btn is-active" id="si-btn-full-${slideId}" onclick="flexToggleSIView('${slideId}','full')" style="padding:3px 9px;border-radius:5px;border:1px solid #e5e7eb;background:#8D70EE;color:#fff;font-size:10px;font-weight:600;cursor:pointer;margin-right:4px;">Full Year</button>
        <button class="spark-ctrl-btn" id="si-btn-ytd-${slideId}" onclick="flexToggleSIView('${slideId}','ytd')" style="padding:3px 9px;border-radius:5px;border:1px solid #e5e7eb;background:#fff;color:#524e5b;font-size:10px;font-weight:600;cursor:pointer;">YTD through ${_e(monthLbl)}</button>
      </div>`
    : "";

  const projLegend = hasProjection
    ? `<span id="si-proj-legend-${slideId}"><span style="display:inline-block;width:10px;height:10px;background:rgba(106,61,184,0.22);border:1px dashed #6A3DB8;border-radius:2px;margin-right:4px;vertical-align:middle;"></span>Projected (full ${currentYear})</span>`
    : `<span id="si-proj-legend-${slideId}" style="display:none;"></span>`;

  const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;">
    <div class="slide-header" style="margin-bottom:12px;flex-shrink:0;">
      <div class="slide-label">SINCE INCEPTION</div>
      <div class="slide-title">${_e(pmcName)}'s full history on Flex.</div>
      <div style="font-size:13px;color:#524e5b;margin-top:6px;">${subtitle}</div>
    </div>
    <div style="flex:1;min-height:0;background:#f7f7f7;border:1px solid #eceaf2;border-radius:14px;padding:16px 24px 12px;display:flex;flex-direction:column;overflow:hidden;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-shrink:0;">
        <div style="font-size:9px;font-weight:600;color:#524e5b;text-transform:uppercase;letter-spacing:0.1em;"><span id="si-eyebrow-full-${slideId}">RENT PAID &amp; BILLS PAID BY YEAR</span><span id="si-eyebrow-ytd-${slideId}" style="display:none;">RENT PAID &amp; BILLS PAID, YTD THROUGH ${_e(monthLbl).toUpperCase()}</span> - ${_e(pmcName)}</div>
        <div style="display:flex;align-items:center;flex-shrink:0;margin-left:16px;">
          <div style="display:flex;gap:14px;font-size:10px;color:#524e5b;">
            <span><span style="display:inline-block;width:10px;height:10px;background:rgba(106,61,184,0.6);border-radius:2px;margin-right:4px;vertical-align:middle;"></span>Rent paid / year</span>
            <span><span style="display:inline-block;width:8px;height:8px;background:#1a9e6a;border-radius:50%;margin-right:4px;vertical-align:middle;"></span>Bills paid / year</span>
            ${projLegend}
          </div>
          ${toggleHtml}
        </div>
      </div>
      <div style="flex:1;min-height:0;position:relative;overflow:hidden;">
        <canvas id="sichart${slideId}"></canvas>
      </div>
    </div>
    <div id="si-footnote-${slideId}" style="font-size:10px;color:#a09cb0;margin-top:6px;flex-shrink:0;font-style:italic;${hasProjection ? '' : 'display:none;'}">Projected figures extrapolate from year-to-date performance (trailing 3-month run-rate); actual results will vary.</div>
  </div>`;

  const js = `
window['initSlide${slideId}'] = (function() {
  let done = false;
  return function() {
    if (done) return; done = true;
    const fmtRent = v => {
      if (!v) return '$0';
      return v < 1e6 ? '$' + Math.round(v / 1e3) + 'K' : '$' + (v / 1e6).toFixed(1) + 'M';
    };
    // Mutable state the drawing plugin reads every redraw
    window['siState${slideId}'] = {
      billsActual: ${billsActualJs}, projBills: ${projBillsJs}, projRent: ${projRentJs},
      ghostPctText: ${ghostPctJs}, nReal: ${nReal},
    };
    const centerDots = {
      id: 'centerDots${slideId}',
      afterDatasetsDraw(chart) {
        const ctx = chart.ctx;
        const barMeta = chart.getDatasetMeta(0);
        const st = window['siState${slideId}'];
        const billsActual = st.billsActual;
        const projBills = st.projBills;
        const projRent = st.projRent;
        const ghostPctText = st.ghostPctText;
        const nReal = st.nReal;
        let ghostRect = null;
        if (projRent != null) {
          const el = barMeta.data[nReal];
          if (el) {
            const gw = el.width;
            const x0 = el.x - gw / 2;
            const topY = chart.scales.y.getPixelForValue(projRent);
            ghostRect = { x0, x1: x0 + gw, cx: el.x, top: topY, base: el.base };
            ctx.save();
            ctx.fillStyle = 'rgba(106,61,184,0.22)';
            ctx.strokeStyle = 'rgba(106,61,184,0.55)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.roundRect(ghostRect.x0, ghostRect.top, gw, ghostRect.base - ghostRect.top, 4);
            ctx.fill(); ctx.stroke();
            ctx.setLineDash([]);
            ctx.font = "700 12px 'ABCDiatype', sans-serif";
            ctx.fillStyle = '#6A3DB8';
            ctx.textAlign = 'center';
            ctx.fillText(fmtRent(projRent), ghostRect.cx, ghostRect.top - 10);
            if (ghostPctText) {
              ctx.font = "600 10px 'ABCDiatype', sans-serif";
              ctx.fillStyle = 'rgba(106,61,184,0.75)';
              ctx.fillText(ghostPctText, ghostRect.cx, ghostRect.top - 24);
            }
            ctx.restore();
          }
        }
        const pts = [];
        billsActual.forEach((val, i) => {
          if (val == null) return;
          const el = barMeta.data[i];
          if (!el) return;
          pts.push({ x: el.x, y: (el.y + el.base) / 2, val, projected: false, base: el.base });
        });
        if (projBills != null && ghostRect) {
          pts.push({ x: ghostRect.cx, y: (ghostRect.top + ghostRect.base) / 2, val: projBills, projected: true, base: ghostRect.base });
        }
        if (!pts.length) return;
        ctx.save();
        const realPts = pts.filter(p => !p.projected);
        if (realPts.length > 1) {
          ctx.lineWidth = 2; ctx.strokeStyle = '#1a9e6a';
          ctx.beginPath();
          realPts.forEach((p, idx) => idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
          ctx.stroke();
        }
        const projPt = pts.find(p => p.projected);
        if (projPt && realPts.length) {
          const last = realPts[realPts.length - 1];
          ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(26,158,106,0.5)'; ctx.setLineDash([6,4]);
          ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(projPt.x, projPt.y); ctx.stroke();
          ctx.setLineDash([]);
        }
        pts.forEach(p => {
          ctx.beginPath();
          ctx.fillStyle = p.projected ? 'rgba(26,158,106,0.55)' : '#1a9e6a';
          ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.lineWidth = 1.5; ctx.strokeStyle = '#f7f7f7'; ctx.stroke();
          ctx.font = "600 11px 'ABCDiatype', sans-serif";
          ctx.fillStyle = p.projected ? 'rgba(21,128,61,0.8)' : '#15803d';
          ctx.textAlign = 'center';
          const nearBaseline = p.base != null && (p.base - p.y) < 24;
          ctx.fillText(p.val.toLocaleString(), p.x, nearBaseline ? p.y - 10 : p.y + 16);
        });
        ctx.restore();
      }
    };
    window['siChart${slideId}'] = new Chart(document.getElementById('sichart${slideId}'), {
      type: 'bar',
      plugins: [centerDots],
      data: {
        labels: ${labelsJs},
        datasets: [{
          type: 'bar', label: 'Rent paid / year',
          data: ${rentSolidJs},
          backgroundColor: 'rgba(106,61,184,0.55)',
          borderColor: '#6A3DB8', borderWidth: 1.5, borderRadius: 4,
          yAxisID: 'y',
          datalabels: { anchor: 'end', align: 'end', offset: 10, formatter: v => v == null ? '' : fmtRent(v), color: '#2C194D', font: { size: 12, weight: '700' } }
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 34, right: 8, bottom: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: item => item.parsed.y != null,
            callbacks: {
              label: ctx => ctx.dataset.label + ': ' + fmtRent(ctx.parsed.y),
              afterLabel: ctx => {
                const i = ctx.dataIndex;
                const solidData = ctx.chart.data.datasets[0].data;
                if (i === 0) return '';
                const prev = solidData[i - 1];
                if (prev == null) return '';
                const pct = (ctx.parsed.y - prev) / prev * 100;
                return (pct >= 0 ? '+' : '') + pct.toFixed(1) + '% vs ' + ctx.chart.data.labels[i - 1];
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: '#524e5b', font: { size: 12, weight: '600' } } },
          y: { position: 'left', min: 0, suggestedMax: ${yMax}, grid: { color: '#f3f4f6' }, border: { display: false },
              ticks: { color: '#9ca3af', font: { size: 10 }, callback: v => fmtRent(v) },
              title: { display: true, text: 'Rent paid / year', color: '#9ca3af', font: { size: 9 } } }
        }
      }
    });
  };
})();
if (!window.flexToggleSIView) {
  window.flexToggleSIView = function(sid, which) {
    const chart = window['siChart' + sid];
    const st = window['siState' + sid];
    if (!chart || !st) return;
    const showYtd = which === 'ytd';
    const full = window['siFull' + sid], ytd = window['siYtd' + sid];
    const active = showYtd ? ytd : full;
    if (!active) return;
    chart.data.labels = active.labels;
    chart.data.datasets[0].data = active.rent;
    chart.options.scales.y.suggestedMax = active.yMax;
    st.billsActual = active.bills;
    st.projRent = active.projRent;
    st.projBills = active.projBills;
    st.ghostPctText = active.ghostPctText;
    st.nReal = active.nReal;
    chart.update();
    var bFull = document.getElementById('si-btn-full-' + sid), bYtd = document.getElementById('si-btn-ytd-' + sid);
    if (bFull) { bFull.style.background = showYtd ? '#fff' : '#8D70EE'; bFull.style.color = showYtd ? '#524e5b' : '#fff'; }
    if (bYtd) { bYtd.style.background = showYtd ? '#8D70EE' : '#fff'; bYtd.style.color = showYtd ? '#fff' : '#524e5b'; }
    var projLegend = document.getElementById('si-proj-legend-' + sid);
    if (projLegend) projLegend.style.display = showYtd ? 'none' : '';
    var eFull = document.getElementById('si-eyebrow-full-' + sid), eYtd = document.getElementById('si-eyebrow-ytd-' + sid);
    if (eFull) eFull.style.display = showYtd ? 'none' : 'inline';
    if (eYtd) eYtd.style.display = showYtd ? 'inline' : 'none';
    var footnote = document.getElementById('si-footnote-' + sid);
    if (footnote) footnote.style.display = (showYtd || !active.hasFootnote) ? 'none' : '';
  };
}
window['siFull${slideId}'] = {
  labels: ${labelsJs}, rent: ${rentSolidJs}, bills: ${billsActualJs},
  projRent: ${projRentJs}, projBills: ${projBillsJs}, ghostPctText: ${ghostPctJs},
  nReal: ${nReal}, yMax: ${yMax}, hasFootnote: ${hasProjection},
};
window['siYtd${slideId}'] = {
  labels: ${ytdLabelsJs}, rent: ${ytdRentJs}, bills: ${ytdBillsJs},
  projRent: null, projBills: null, ghostPctText: '',
  nReal: ${ytdNReal}, yMax: ${ytdYMax}, hasFootnote: false,
};
`;

  return { html, js };
}

// ─── render_qbr_close (Slide 47 - always last) ─────────────────────────────

export interface QbrCloseInput {
  slideId: number;
  pmcName: string;
  currentNar: number;
  currentRent: number;
  lifetimeRent: number;
  currentResidents: number;
  propertyCount: number;
  partnerSince: string | null;
  benchmarkNar: number; // default 0.085
  benchmarkP75?: number | null; // P75 NAR for top-quartile detection
  trueRepeatRate: number | null;
  newPropertiesCount: number;
  monthlyTotals: MonthlyTotal[];
  milestoneYears?: number | null; // partnership anniversary years (e.g. 5)
  lifetimeDqShielded?: number; // total DQ shielded for win2 body
  optInPct?: number; // marketing opt-in % for co-marketing action
  showAdoptionPeerMedian?: boolean; // default true - mirrors Flask's render_qbr_close
}

export function renderQbrClose(input: QbrCloseInput): SlideResult {
  const {
    slideId, pmcName, currentNar, currentRent, lifetimeRent,
    currentResidents, propertyCount, partnerSince, benchmarkNar,
    benchmarkP75, trueRepeatRate, newPropertiesCount, monthlyTotals,
    milestoneYears, lifetimeDqShielded, optInPct,
  } = input;
  const showAdoptionPeerMedian = input.showAdoptionPeerMedian !== false;

  const pmc = _e(pmcName);
  const bNar = benchmarkNar || 0.085;
  const bP75 = benchmarkP75 ?? bNar * 1.3;
  const AT_MEDIAN_TOL = 0.005; // 0.5pp
  const atMedian = Math.abs(currentNar - bNar) <= AT_MEDIAN_TOL;
  const aboveMedian = !atMedian && currentNar >= bNar;
  const nearP75 = benchmarkP75 != null && currentNar >= bP75;
  const mostlyOptIn = (optInPct ?? 0) > 0.70;

  const sinceLbl = partnerSince ? monthLabel(partnerSince) : "launch";

  // Repeat rate
  let momRetStr = "";
  if (trueRepeatRate !== null) {
    momRetStr = `${(trueRepeatRate * 100).toFixed(0)}%`;
  } else if (monthlyTotals.length >= 2) {
    const prev = monthlyTotals[monthlyTotals.length - 2];
    const cur = monthlyTotals[monthlyTotals.length - 1];
    const currentNewSignups = cur.newSignups;
    const prevCharged = prev.chargedUsers ?? prev.billsPaid;
    if (prevCharged > 0) {
      const ret = (currentResidents - currentNewSignups) / prevCharged;
      momRetStr = `${Math.round(Math.max(0, Math.min(ret, 1)) * 100)}%`;
    }
  }

  // Win 1: NAR vs benchmark (with top-quartile check)
  const narPct = fmtPct(currentNar);
  const bPct = fmtPct(bNar);

  // Portfolio-level adoption growth over the same ~6-month window as the per-property trend
  // badges - a benchmark-independent win for the "upside ahead" branch below, which otherwise
  // has nothing to say if the peer-median toggle hides the one number its whole framing is
  // built on (Kevin's catch, mirrored from the identical fix in Flask's render_qbr_close). null
  // if there isn't enough monthly history, or the growth is too small to be worth claiming
  // (same 0.5pp tolerance as AT_MEDIAN_TOL above).
  let ownGrowthPp: number | null = null;
  let growthLookback = 0;
  if (monthlyTotals.length >= 2) {
    growthLookback = Math.min(6, monthlyTotals.length - 1);
    const refNar = monthlyTotals[monthlyTotals.length - 1 - growthLookback].adoptionRate;
    const growth = currentNar - refNar;
    if (growth > AT_MEDIAN_TOL) ownGrowthPp = growth;
  }

  // "Peer median is {bPct}." is the one clause that leaks a number the Property Deep Dive
  // tables' show_adoption_peer_median toggle already decided should be hidden - drop it
  // entirely rather than let this slide show a figure the rest of the deck just hid.
  const peerClause = showAdoptionPeerMedian ? `Peer median is ${bPct}. ` : "";

  let win1Head: string, win1Body: string;
  if (nearP75) {
    win1Head = `Top-quartile adoption at ${narPct}`;
    // "across your peer group," not "across the Flex network" - nearP75/bNar come from the
    // same geo/size/rent/tenure-matched peer benchmark the other branches here correctly call
    // "peer median" - claiming network-wide overstated what this number actually measures
    // (Kevin's catch, mirrored from the identical fix in Flask's render_qbr_close).
    win1Body = `Your adoption rate puts you in the top 25% across your peer group. Residents are finding value and coming back - that's the signal.`;
  } else if (aboveMedian) {
    win1Head = `Above-average adoption at ${narPct}`;
    // "You're above it" -> "You're above average for your peer group" when the peer-median
    // clause is dropped - "it" has no referent left to point at otherwise.
    const aboveClause = showAdoptionPeerMedian ? "You're above it" : "You're above average for your peer group";
    win1Body = `${peerClause}${aboveClause} - room to grow by driving activation at lower-performing properties.`;
  } else if (atMedian) {
    win1Head = `At median adoption at ${narPct}`;
    win1Body = `${peerClause}You're right in line with comparable PMCs - a focused push on your lower-performing properties can move you above.`;
  } else {
    win1Head = `Adoption at ${narPct} - upside ahead`;
    const growthClause = ownGrowthPp !== null
      ? `Adoption has grown ${(ownGrowthPp * 100).toFixed(1)}pp over the last ${growthLookback} months - `
      : "";
    if (showAdoptionPeerMedian) {
      // Both stories at once when there's real growth to point to - the peer-median gap
      // framing doesn't have to be the only thing this card says.
      const closeClause = ownGrowthPp !== null ? "closing the rest of that gap" : "Closing that gap";
      win1Body = `${peerClause}${growthClause}${closeClause} typically comes down to resident outreach and consistent on-site activation.`;
    } else if (ownGrowthPp !== null) {
      win1Body = `${growthClause}keep that momentum going with consistent resident outreach and on-site activation.`;
    } else {
      // No peer number to cite and no growth to point to - fall back to the plain lever, no
      // comparison claim at all.
      win1Body = "Resident outreach and consistent on-site activation are the levers most likely to move this.";
    }
  }

  // Win 2: guaranteed rent (with DQ shielded clause)
  const win2Head = `${fmtCurrency(currentRent)} guaranteed this month`;
  const dqClause = lifetimeDqShielded && lifetimeDqShielded > 0
    ? ` Of that, ${fmtCurrency(lifetimeDqShielded)} was delinquent.`
    : "";
  const win2Body = `${fmtCurrency(lifetimeRent)} guaranteed since ${sinceLbl}.${dqClause} That's real rent Flex advanced to you regardless of what happened on the resident side.`;

  function _win(headline: string, body: string): string {
    return `
        <li style="background:#f8f7ff;border:1px solid #ede9fe;border-radius:10px;padding:18px 22px;">
          <div style="font-size:13px;font-weight:700;color:#2C194D;margin-bottom:6px;">${headline}</div>
          <div style="font-size:12px;color:#6b7280;line-height:1.6;">${body}</div>
        </li>`;
  }

  // Milestone years win
  const milestoneWin = milestoneYears
    ? _win(`${milestoneYears} years of partnership`, `Since ${sinceLbl}, ${pmc} has been one of Flex's earliest and most committed partners. A milestone worth recognizing.`)
    : "";

  const newPropsWin = newPropertiesCount > 0
    ? _win(
        `${newPropertiesCount} new propert${newPropertiesCount === 1 ? "y" : "ies"} onboarded this quarter`,
        "Fresh rollouts add runway for future growth - worth checking in on how quickly they're ramping.",
      )
    : "";

  // Cap total wins at 4 to avoid overflow - drop tenure win if both milestone + new props
  const showTenureWin = !(milestoneYears && newPropertiesCount > 0);
  const tenureWin = showTenureWin
    ? (momRetStr
      ? _win(`${momRetStr} of residents use Flex again`, "Once they start, most keep going. That retention is the foundation everything else builds on.")
      : _win(`${propertyCount.toLocaleString()} active properties`, "Strong coverage across your portfolio - every enrolled property is on the clock."))
    : "";

  function _action(title: string, desc: string): string {
    return `
        <li>
          <div style="font-size:13px;font-weight:700;color:#2C194D;margin-bottom:2px;">${_e(title)}</div>
          <div style="font-size:12px;color:#6b7280;line-height:1.5;">${_e(desc)}</div>
        </li>`;
  }

  const belowAvgPhrase = currentNar < 0.05 ? "your lowest-performing properties" : "properties below 5% adoption";
  const action1 = _action("Review underperforming properties",
    mostlyOptIn
      ? `Pull ${belowAvgPhrase} and run a property-level coaching session - look at on-site visibility, leasing staff awareness, and move-in touchpoints.`
      : `Pull ${belowAvgPhrase} and run a coaching playbook - identify what's different about those properties and build a plan to close the gap.`
  );
  const action2 = mostlyOptIn
    ? _action("Drive co-marketing", "With Flex Direct Marketing enabled across most of your portfolio, the next lever is PMC-driven outreach: on-site signage, resident email campaigns, and leasing staff mentions at move-in. Properties that do this consistently see 2\u20133pp adoption lifts.")
    : "";
  const action3 = _action("Schedule next QBR", "Lock in the next quarterly touchpoint - keeps the momentum going and gives us a forcing function to track progress.");

  const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;flex-direction:row;padding:0;overflow:hidden;">
    <!-- Left: wins this quarter -->
    <div style="flex:1;padding:44px 40px 36px;display:flex;flex-direction:column;border-right:1px solid #f0edff;">
      <div style="flex-shrink:0;margin-bottom:24px;">
        <div style="font-size:9px;letter-spacing:0.18em;text-transform:uppercase;color:#8D70EE;font-weight:600;margin-bottom:10px;">WHAT'S WORKING</div>
        <div style="font-size:28px;font-weight:700;color:#2C194D;line-height:1.2;letter-spacing:-0.02em;">Wins this quarter.</div>
      </div>
      <style>
        #slide-${slideId} .qbr-wins { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:12px; }
      </style>
      <ul class="qbr-wins">
        ${milestoneWin}
        ${_win(win1Head, win1Body)}
        ${_win(win2Head, win2Body)}
        ${newPropsWin}
        ${tenureWin}
      </ul>
    </div>
    <!-- Right: what we're working on -->
    <div style="flex:1;padding:44px 44px 36px;display:flex;flex-direction:column;">
      <div style="flex-shrink:0;margin-bottom:24px;">
        <div style="font-size:9px;letter-spacing:0.18em;text-transform:uppercase;color:#8D70EE;font-weight:600;margin-bottom:10px;">WHAT WE'RE WORKING ON TOGETHER</div>
        <div style="font-size:28px;font-weight:700;color:#2C194D;line-height:1.2;letter-spacing:-0.02em;">Next quarter focus.</div>
      </div>
      <style>
        #slide-${slideId} .qbr-actions { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:20px; }
        #slide-${slideId} .qbr-actions li { position:relative; padding-left:18px; }
        #slide-${slideId} .qbr-actions li::before { content:''; position:absolute; left:0; top:6px; width:6px; height:6px; border-radius:50%; background:#8D70EE; }
      </style>
      <ul class="qbr-actions">
        ${action1}
        ${action2}
        ${action3}
      </ul>
      <div style="margin-top:24px;padding-top:20px;border-top:1px solid #f0edff;font-size:11px;color:#9ca3af;line-height:1.5;">
        ${pmc} \u00b7 Flex partnership since ${sinceLbl}
      </div>
    </div>
  </div>`;

  return { html, js: "" };
}

// ─── IMPORTED SLIDE (PDF upload) ────────────────────────────────────────────

/** Full-bleed slide for one page pulled in from an uploaded PDF. Mirrors Flask's
 * render_imported_slide (generator/slides.py) exactly, including the "start"/"end"-only
 * anchor scope for this first Superblocks pass - Flask supports anchoring after any specific
 * catalog slide too, but replicating that here would mean hand-verifying a full Flask-
 * catalog-id ↔ Superblocks-slidesOrdered-position map with no way to click through and
 * confirm it live (no local dev server, no Superblocks preview access from this session).
 * start/end covers the real use case (drop a slide into a bigger shared deck) without that
 * risk; a specific-slide anchor can be added later once someone can verify it live.
 *
 * `imageSrc` is normally a `data:{mime};base64,...` URI, but during deck assembly it's an
 * opaque placeholder token instead - the caller (get-pmc-monthly-report.ts) swaps that for
 * the real data URI only AFTER applyTerminology runs, same as Flask's app.py. Skipping that
 * indirection here and embedding the raw base64 directly would be a real bug, not a
 * simplification: applyTerminology does a `\bword\b`-boundary regex replace over the entire
 * assembled deck HTML, and a base64 payload's `+`/`/`/`=` alphabet can satisfy that pattern
 * and get silently corrupted (exactly what Flask's own comment on this warns about). This
 * function doesn't need to know or care which kind of string it's holding - it just embeds
 * it verbatim as the <img> src.
 *
 * Deliberately no inline `display:` on the .slide root - same reasoning as every other slide
 * in this file (an inline display would beat `.slide{display:none}` / `.slide.active
 * {display:flex}` and leave the slide permanently visible on top of everything before it).
 * The dark letterbox background (rather than white) is so a legacy 4:3 source slide reads as
 * an intentional inset, not a layout mistake. */
export function renderImportedSlide(
  slideId: number,
  imageSrc: string,
  sourceTitle: string,
  deckTitle: string,
): SlideResult {
  const label = deckTitle ? _e(deckTitle) : "Imported slide";
  const title = sourceTitle ? _e(sourceTitle) : `Slide ${slideId}`;
  const html = `
  <div class="slide" id="slide-${slideId}" style="padding:0;background:#0f0f12;">
    <div class="slide-label" style="position:absolute;width:1px;height:1px;overflow:hidden;">${label}</div>
    <div class="slide-title" style="position:absolute;width:1px;height:1px;overflow:hidden;">${title}</div>
    <img src="${imageSrc}" alt="${title}" style="width:100%;min-height:720px;object-fit:contain;display:block;" />
  </div>`;
  return { html, js: "" };
}

// ─── TESTIMONIALS ────────────────────────────────────────────────────────────

export interface Testimonial {
  name: string;
  property: string;
  quote: string;
  role?: string;
}

/** Sentence-case normalizer for testimonial quotes */
function _normalizeCase(text: string): string {
  const t = text.trim();
  if (!t) return t;
  const hasAlpha = /[a-zA-Z]/.test(t);
  if (!hasAlpha) return t;
  const isAllCaps = t === t.toUpperCase();
  const isAllLower = t === t.toLowerCase();
  if (!isAllCaps && !isAllLower) return t;
  const lowered = t.toLowerCase();
  return lowered.replace(/(^|(?<=[.!?])\s+)([a-z])/g, (_m, prefix, letter) => prefix + letter.toUpperCase());
}

export interface ResidentTrend {
  csatByMonth: { month: string; nTotal: number; nGood: number }[];
  responseByMonth: { month: string; nTickets: number; avgReplyMin: number | null }[];
}

function _fmtMinutes(v: number): string {
  if (v >= 60) return `${(v / 60).toFixed(1)}h`;
  return `${Math.round(v)} min`;
}

function _monthLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function renderCustomerExperience(input: {
  slideId: number;
  testimonials: Testimonial[];
  trend: ResidentTrend;
  pmcName?: string;
}): SlideResult {
  const { slideId, testimonials, trend } = input;
  const csatMonths = [...(trend.csatByMonth || [])].sort((a, b) => a.month.localeCompare(b.month));
  const respMonths = [...(trend.responseByMonth || [])].sort((a, b) => a.month.localeCompare(b.month));

  // ── Calendar midpoint split ──
  const allMonthStrs = [...csatMonths.map((r) => r.month), ...respMonths.map((r) => r.month)];
  let midpoint: string | null = null;
  if (allMonthStrs.length > 0) {
    const sorted = [...allMonthStrs].sort();
    const minM = sorted[0];
    const maxM = sorted[sorted.length - 1];
    const minT = new Date(minM + "T00:00:00Z").getTime();
    const maxT = new Date(maxM + "T00:00:00Z").getTime();
    midpoint = new Date((minT + maxT) / 2).toISOString().slice(0, 10);
  }

  function splitCalendar<T extends { month: string }>(rows: T[]): [T[], T[]] {
    if (!midpoint) {
      const n = Math.floor(rows.length / 2);
      return [rows.slice(0, n), rows.slice(n)];
    }
    return [rows.filter((r) => r.month <= midpoint!), rows.filter((r) => r.month > midpoint!)];
  }

  const [csatFirst, csatSecond] = splitCalendar(csatMonths);
  const [respFirst, respSecond] = splitCalendar(respMonths);

  function csatPct(rows: typeof csatMonths): [number | null, number] {
    const total = rows.reduce((s, r) => s + r.nTotal, 0);
    const good = rows.reduce((s, r) => s + r.nGood, 0);
    return [total > 0 ? good / total : null, total];
  }

  function weightedAvgReply(rows: typeof respMonths): [number | null, number] {
    const valid = rows.filter((r) => r.avgReplyMin != null);
    const totalN = valid.reduce((s, r) => s + r.nTickets, 0);
    if (totalN === 0) return [null, 0];
    const wAvg = valid.reduce((s, r) => s + (r.avgReplyMin! * r.nTickets), 0) / totalN;
    return [wAvg, totalN];
  }

  const [csatPctFirst, csatNFirst] = csatPct(csatFirst);
  const [csatPctSecond, csatNSecond] = csatPct(csatSecond);
  const [replyFirst, replyNFirst] = weightedAvgReply(respFirst);
  const [replySecond, replyNSecond] = weightedAvgReply(respSecond);

  const csatHasData = csatNFirst >= 5 && csatNSecond >= 5;
  const replyHasData = replyNFirst >= 5 && replyNSecond >= 5;

  const csatDeltaPp = csatHasData && csatPctFirst != null && csatPctSecond != null
    ? (csatPctSecond - csatPctFirst) * 100 : null;
  const replyPctChange = replyHasData && replyFirst != null && replySecond != null && replyFirst > 0
    ? (replyFirst - replySecond) / replyFirst : null;

  const trendDeclining = (
    (csatHasData && csatDeltaPp != null && csatDeltaPp < -1.0) ||
    (replyHasData && replyPctChange != null && replyPctChange < -0.05)
  );
  const csatImproved = csatHasData && csatDeltaPp != null && csatDeltaPp >= 3.0;
  const replyImproved = replyHasData && replyPctChange != null && replyPctChange >= 0.10;
  const trendQualifies = (csatHasData || replyHasData) && !trendDeclining && (csatImproved || replyImproved);

  const nQuotes = testimonials.length;
  if (!trendQualifies && nQuotes === 0) return { html: "", js: "" };

  // ── Header ──
  const label = "Customer Experience";
  const title = "Flex prioritizes the customer experience.";
  let subtitle: string;
  if (trendQualifies) {
    const leadIsReply = replyImproved && (!csatImproved || (replyPctChange ?? 0) >= (csatDeltaPp ?? 0) / 100);
    const csatSince = csatSecond.length > 0 ? _monthLabel(csatSecond[0].month) : "";
    const respSince = respSecond.length > 0 ? _monthLabel(respSecond[0].month) : "";
    if (leadIsReply) {
      subtitle = `Avg. first response time down ${Math.round((replyPctChange ?? 0) * 100)}% since ${respSince} \u2014 sourced from resident support tickets.`;
    } else {
      subtitle = `Resident satisfaction (CSAT) up ${Math.round(csatDeltaPp ?? 0)}pp since ${csatSince} \u2014 sourced from resident support tickets.`;
    }
  } else {
    subtitle = "Sourced from customer support tickets submitted via Zendesk, our third-party customer service vendor.";
  }

  // ── KPI tiles (only when trend qualifies) ──
  function kpiCard(value: string, cardLabel: string, sub: string, color: string, highlight: boolean): string {
    const subHtml = highlight
      ? `<div style="display:inline-block;font-size:12px;font-weight:700;color:${color};background:${color}18;padding:4px 10px;border-radius:6px;margin-top:10px;">${sub}</div>`
      : `<div style="font-size:10px;color:#8d85a0;margin-top:5px;">${sub}</div>`;
    return `
      <div style="background:#fff;border:1px solid #e5e0f5;border-radius:14px;padding:22px 26px;flex:1;min-width:0;">
        <div style="font-size:32px;font-weight:800;color:${color};letter-spacing:-0.02em;line-height:1;">${value}</div>
        <div style="font-size:12px;font-weight:600;color:#374151;margin-top:8px;">${cardLabel}</div>
        ${subHtml}
      </div>`;
  }

  let kpiHtml = "";
  if (trendQualifies) {
    const totalTickets = respMonths.reduce((s, r) => s + r.nTickets, 0) || csatMonths.reduce((s, r) => s + r.nTotal, 0);
    const tiles: string[] = [];
    if (csatHasData && csatPctSecond != null) {
      const csatSince = csatSecond.length > 0 ? _monthLabel(csatSecond[0].month) : "";
      const sub = csatDeltaPp != null && csatDeltaPp >= 0.5
        ? `+${Math.round(csatDeltaPp)}pp since ${csatSince}`
        : `steady since ${csatSince}`;
      tiles.push(kpiCard(`${Math.round(csatPctSecond * 100)}%`, "Resident satisfaction (CSAT)", sub, "#1a9e6a", true));
    }
    if (replyHasData && replySecond != null) {
      const respSince = respSecond.length > 0 ? _monthLabel(respSecond[0].month) : "";
      const sub = replyPctChange != null && replyPctChange >= 0.02
        ? `down ${Math.round(replyPctChange * 100)}% since ${respSince}`
        : `steady since ${respSince}`;
      tiles.push(kpiCard(_fmtMinutes(replySecond), "Avg. first response time", sub, "#6A3DB8", true));
    }
    tiles.push(kpiCard(totalTickets.toLocaleString(), "Support tickets reviewed", "across the full window", "#d97706", false));
    kpiHtml = `<div style="display:flex;gap:16px;flex-shrink:0;">${tiles.join("")}</div>`;
  }

  // ── Quote cards (only when testimonials exist) ──
  let quotesHtml = "";
  if (nQuotes > 0) {
    const AVATAR_PALETTE = ["#6A3DB8", "#1a9e6a", "#d97706", "#2563eb", "#0891b2", "#9d174d", "#7c3aed"];
    const roleColors: Record<string, string> = {
      Resident: "#1a9e6a",
      "Property Manager": "#6A3DB8",
      "Regional Manager": "#d97706",
      "Owner / Investor": "#2C194D",
    };

    function quoteCard(t: Testimonial, idx: number): string {
      const firstName = (t.name || "").trim().split(/\s+/)[0] || "Resident";
      const initial = firstName[0]?.toUpperCase() || "?";
      const role = t.role || "Resident";
      const color = roleColors[role] || "#6A3DB8";
      const avatarColor = AVATAR_PALETTE[idx % AVATAR_PALETTE.length];
      const quote = _e(_normalizeCase(t.quote));
      const escapedName = _e(firstName);
      const prop = _e(t.property || "");
      const attribution = [
        escapedName ? `<span style="font-weight:600;">${escapedName}</span>` : "",
        prop ? `<span style="color:#a09cb0;">\u00b7 ${prop}</span>` : "",
      ].filter(Boolean).join(" ");
      return `
        <div style="background:#f7f7f7;border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:8px;border:1px solid #eceaf2;min-height:0;overflow:hidden;">
          <div style="font-size:24px;line-height:1;color:#8d70ee;font-family:'ABCDiatype',sans-serif;margin-bottom:-6px;flex-shrink:0;">\u201c</div>
          <p style="font-size:14px;line-height:1.55;color:#1d1d1d;font-style:italic;flex:1;min-height:0;overflow:hidden;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;text-overflow:ellipsis;">${quote}<span style="font-size:22px;line-height:0;vertical-align:-0.3em;color:#8d70ee;font-family:'ABCDiatype',sans-serif;margin-left:2px;">\u201d</span></p>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
            <div style="width:28px;height:28px;border-radius:50%;background:${avatarColor};display:flex;align-items:center;justify-content:center;font-size:12px;color:#fff;font-weight:700;flex-shrink:0;">${initial}</div>
            <div>
              <div style="font-size:11px;color:#1d1d1d;">${attribution}</div>
              <div style="margin-top:2px;"><span style="font-size:9px;font-weight:600;padding:1px 7px;border-radius:4px;background:${color}22;color:${color};">${_e(role)}</span></div>
            </div>
          </div>
        </div>`;
    }

    const cards = testimonials.map((t, i) => quoteCard(t, i)).join("");
    const quotesAlone = !trendQualifies;
    if (nQuotes > 2) {
      const fill = quotesAlone ? "flex:1;" : "";
      const gridStyle = `display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:12px;${fill}min-height:0;overflow:hidden;`;
      quotesHtml = `<div style="${gridStyle}">${cards}</div>`;
    } else {
      const fill = quotesAlone ? "flex:1;" : "";
      const innerCols = nQuotes === 2 ? "1fr 1fr" : "1fr";
      const maxW = nQuotes === 2 ? "900px" : "560px";
      const gridStyle = `display:flex;align-items:center;justify-content:center;${fill}min-height:0;`;
      quotesHtml = `<div style="${gridStyle}"><div style="display:grid;grid-template-columns:${innerCols};gap:16px;width:100%;max-width:${maxW};max-height:220px;">${cards}</div></div>`;
    }
  }

  const quotesFootnote = nQuotes > 0 && trendQualifies
    ? `<div style="font-size:10px;color:#a09cb0;flex-shrink:0;">Quotes sourced from customer support tickets submitted via Zendesk.</div>`
    : "";

  const contentHtml = `<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-start;gap:28px;min-height:0;padding-top:16px;">${kpiHtml}${quotesHtml}</div>`;

  const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;padding:44px 64px;flex-direction:column;overflow:hidden;">
    <div class="slide-header" style="margin-bottom:0;">
      <div class="slide-label">${label}</div>
      <div class="slide-title">${_e(title)}</div>
      <div style="font-size:13px;color:#6b7280;margin-top:8px;">${_e(subtitle)}</div>
    </div>
    ${contentHtml}
    ${quotesFootnote}
  </div>`;

  return { html, js: "" };
}
