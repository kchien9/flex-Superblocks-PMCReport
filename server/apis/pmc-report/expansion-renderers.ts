/**
 * Expansion deck-specific slide renderers.
 * Faithful ports of render_expansion_gap (slide 35) and render_expansion_case_close (slide 46)
 * from the Flask source generator/slides.py.
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

function _e(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtCurrency(v: number): string {
  if (v >= 1_000_000) {
    let s = (v / 1_000_000).toFixed(2).replace(/0+$/, "");
    if (s.endsWith(".")) s += "0";
    return `$${s}M`;
  }
  if (v >= 1_000) {
    const k = Math.round(v / 1_000);
    if (k >= 1000) {
      let s2 = (k / 1000).toFixed(1).replace(/0+$/, "");
      if (s2.endsWith(".")) s2 += "0";
      return `$${s2}M`;
    }
    return `$${k}K`;
  }
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

export interface SlideResult {
  html: string;
  js: string;
}

// ─── Expansion Gap (Slide 35) ───────────────────────────────────────────────
// Two-panel: dark stat strip left, Chart.js ramp chart right.
// Ported from render_expansion_gap at line 6828 of generator/slides.py.

export interface ExpansionGapInput {
  slideId: number;
  pmcName: string;
  totalPortfolioUnits: number;
  enrolledUnits: number;
  currentNar: number;
  currentRent: number;
  currentResidents: number;
  /** Monthly data for historical bars. Array of { units, rentPaid } sorted oldest→newest */
  monthlyHistory?: Array<{ units: number; rentPaid: number }>;
  /** Benchmark peer median NAR */
  p50Nar?: number;
  /** Benchmark top quartile NAR */
  p75Nar?: number;
}

export function renderExpansionGap(input: ExpansionGapInput): SlideResult {
  const {
    slideId,
    pmcName,
    totalPortfolioUnits,
    enrolledUnits: flexUnits,
    currentNar,
    currentRent: currentRentMo,
    currentResidents: residentsNow,
    monthlyHistory,
    p50Nar: _p50 = 0.085,
    p75Nar: _p75,
  } = input;

  const pmc = _e(pmcName);
  const totalPortfolio = totalPortfolioUnits;
  const gapUnits = Math.max(totalPortfolio - flexUnits, 0);
  const avgRent = Math.round(currentRentMo / Math.max(residentsNow, 1)) || 1365;

  const p50Nar = _p50;
  const p75Nar = _p75 ?? p50Nar * 1.30;

  const gapRentMo = Math.floor(gapUnits * currentNar) * avgRent;
  // No artificial floor here (Kevin's catch, live-verified) - the old `Math.max(projRent,
  // currentRentMo * 1.01)` fabricated a fake +1% growth number whenever the real peer-median
  // NAR resolved to exactly 0 (a real condition for a degenerate/small peer cohort), even though
  // the honest math says zero growth. Show the real projection, whatever it is.
  const projRent = currentRentMo + gapUnits * p50Nar * avgRent;
  // Guard against dividing by near-zero currentRentMo (Kevin's catch, live-verified: a portfolio
  // in its first live month with $0 current rent produced a "Growth Multiplier" of 92820.0x -
  // not a multiplier at all in that branch, just raw projected dollars mislabeled as a multiple).
  // Below this floor there's no meaningful "today" to multiply from, so the multiplier itself
  // isn't shown (see multiplierHtml below) rather than rendering a number with no real meaning.
  const hasMeaningfulCurrentRent = currentRentMo >= 100;
  const multiplier = hasMeaningfulCurrentRent ? projRent / currentRentMo : null;

  const currLbl = fmtCurrency(currentRentMo);
  const projLbl = fmtCurrency(projRent);
  const currRateFullLbl = fmtCurrency(currentRentMo + gapUnits * currentNar * avgRent);
  const showScenarioLines = totalPortfolio > 0 && gapUnits / Math.max(totalPortfolio, 1) >= 0.03;
  const nearFull = totalPortfolio > 0 && gapUnits / Math.max(totalPortfolio, 1) < 0.05;

  // Scenario rows
  function scenRow(label: string, nar: number, color: string, delta: number): string {
    return `
        <div style="display:flex;justify-content:space-between;align-items:baseline;
                    padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.08);">
          <div>
            <div style="font-size:10px;color:rgba(255,255,255,0.65);font-weight:600;">${label}</div>
            <div style="font-size:9px;color:rgba(255,255,255,0.32);">${(nar * 100).toFixed(1)}% adoption</div>
          </div>
          <div style="font-size:16px;font-weight:700;color:${color};">+${fmtCurrency(delta)} rent/mo</div>
        </div>`;
  }

  let leftTitle: string;
  let leftBody: string;
  let leftSectionLabel: string;
  let scenarioRows: string;
  let multiplierHtml: string;

  if (nearFull) {
    const adoptDelta = (nar: number) => Math.max(0, Math.floor(flexUnits * nar) - residentsNow) * avgRent;
    const p50Delta = adoptDelta(p50Nar);
    const p75Delta = adoptDelta(p75Nar);
    leftTitle = "Fully enrolled.<br>Maximize adoption.";
    // Kevin's catch, live-verified: for a PMC already beating BOTH benchmarks (a real, and
    // notably not rare, case - it's exactly your best customers, ≥95% enrolled and
    // outperforming peer median), the scenario rows below correctly clamp to +$0/mo, but this
    // copy used to unconditionally claim growing to peer median "adds significantly more" -
    // a slide contradicting its own numbers. Branch the claim on whether there's real upside.
    leftBody = (p50Delta === 0 && p75Delta === 0)
      ? `${pmc} has ${flexUnits.toLocaleString()} units on Flex, already outperforming both the peer median and top-quartile adoption benchmark. There's no adoption upside left to capture here - the opportunity now is expanding to the rest of the portfolio.`
      : `${pmc} has ${flexUnits.toLocaleString()} units on Flex. Growing from ${(currentNar * 100).toFixed(1)}% to peer median adds significantly more in guaranteed rent - no new properties needed.`;
    leftSectionLabel = `ADOPTION UPLIFT · ${flexUnits.toLocaleString()} ENROLLED UNITS`;
    scenarioRows =
      scenRow("Peer Median", p50Nar, "#FCD34D", p50Delta) +
      scenRow("Top Quartile", p75Nar, "#6EE7B7", p75Delta);
    multiplierHtml = "";
  } else {
    leftTitle = "Your model<br>is working.<br>Scale it.";
    leftBody = `${pmc} has proven Flex across ${flexUnits.toLocaleString()} units. The same playbook on the rest of your portfolio unlocks the rest of the curve.`;
    leftSectionLabel = `MONTHLY OPPORTUNITY · ${gapUnits.toLocaleString()} UNITS`;
    const enrollDelta = (nar: number) => Math.floor(gapUnits * nar) * avgRent;
    scenarioRows =
      scenRow("Peer Avg", p50Nar, "#FCD34D", enrollDelta(p50Nar)) +
      scenRow("Your Rate", currentNar, "#DDC6F9", enrollDelta(currentNar)) +
      scenRow("Top Performers", p75Nar, "#6EE7B7", enrollDelta(p75Nar));
    // multiplier is null when currentRentMo is too small to divide by meaningfully (see the
    // hasMeaningfulCurrentRent guard above) - show the projected dollar figures without the
    // "×" framing rather than a number with no real meaning.
    multiplierHtml = multiplier !== null
      ? `
      <div style="border-top:1px solid rgba(255,255,255,0.12);padding-top:16px;margin-top:20px;">
        <div style="font-size:9px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.32);margin-bottom:6px;">Growth Multiplier</div>
        <div style="display:flex;align-items:baseline;gap:3px;margin-bottom:4px;">
          <div style="font-size:52px;font-weight:400;color:#fff;letter-spacing:-0.03em;line-height:1;font-family:'ABCDiatype',sans-serif;">${multiplier.toFixed(1)}</div>
          <div style="font-size:22px;color:rgba(255,255,255,0.35);font-weight:300;">×</div>
        </div>
        <div style="font-size:11px;color:rgba(255,255,255,0.32);">${currLbl} today → ${projLbl} at full enrollment</div>
      </div>`
      : `
      <div style="border-top:1px solid rgba(255,255,255,0.12);padding-top:16px;margin-top:20px;">
        <div style="font-size:9px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.32);margin-bottom:6px;">Growth Opportunity</div>
        <div style="font-size:24px;font-weight:600;color:#fff;letter-spacing:-0.02em;line-height:1.3;">${projLbl}/mo at full enrollment</div>
      </div>`;
  }

  // Short-circuit: fully enrolled
  if (gapUnits <= 0) {
    const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;flex-direction:row;padding:0;overflow:hidden;">
    <div style="width:265px;min-width:265px;background:#2C194D;padding:36px 24px;display:flex;flex-direction:column;gap:20px;flex-shrink:0;">
      <div style="font-size:9px;letter-spacing:0.18em;text-transform:uppercase;color:#DDC6F9;font-weight:600;">PORTFOLIO GAP</div>
      <div style="font-size:30px;font-weight:500;line-height:1.1;color:#fff;font-family:'ABCDiatype',sans-serif;">Fully enrolled</div>
      <div style="font-size:12px;color:rgba(255,255,255,0.55);line-height:1.55;">${pmc} - ${flexUnits.toLocaleString()} units on Flex, ${residentsNow.toLocaleString()} active residents, ${currLbl}/mo guaranteed.</div>
    </div>
    <div style="flex:1;display:flex;align-items:center;justify-content:center;">
      <div style="font-size:28px;font-weight:600;color:#1a9e6a;">${flexUnits.toLocaleString()} units fully enrolled</div>
    </div>
  </div>`;
    return { html, js: "" };
  }

  // ── Chart data ──────────────────────────────────────────────────────────
  const N = 50;
  const unitStep = totalPortfolio / N;
  const flexIdx = Math.max(0, Math.min(Math.floor(flexUnits / totalPortfolio * N) - 1, N - 2));
  const existingRentF = currentRentMo;

  // Build rent values from historical monthly data
  let rentVals: number[];
  if (monthlyHistory && monthlyHistory.length >= 3) {
    const hR = monthlyHistory.filter(m => m.units > 0).map(m => m.rentPaid);
    const nHist = hR.length;
    if (nHist >= 2) {
      const vals: number[] = [];
      for (let i = 0; i < N; i++) {
        if (i <= flexIdx) {
          const rawPos = (i / Math.max(flexIdx, 1)) * (nHist - 1);
          const lo = Math.floor(rawPos);
          const hi = Math.min(lo + 1, nHist - 1);
          const frac = rawPos - lo;
          const v = hR[lo] * (1.0 - frac) + hR[hi] * frac;
          vals.push(Math.max(0, Math.round(v)));
        } else {
          const newUnits = (i + 1) * unitStep - flexUnits;
          vals.push(Math.round(existingRentF + newUnits * p50Nar * avgRent));
        }
      }
      rentVals = vals;
    } else {
      rentVals = Array.from({ length: N }, (_, i) => Math.round((i + 1) * unitStep * currentNar * avgRent));
    }
  } else {
    rentVals = Array.from({ length: N }, (_, i) => Math.round((i + 1) * unitStep * currentNar * avgRent));
  }

  // Suppress peer rate if already above it or gap < $25K/mo
  const peerDollarGap = gapUnits * Math.max(p50Nar - currentNar, 0) * avgRent;
  const showPeer = p50Nar > currentNar && peerDollarGap >= 25_000;

  // Base bars + gap bars (stacked)
  const rentBaseVals: number[] = [];
  const rentGapVals: number[] = [];
  for (let i = 0; i < N; i++) {
    if (i <= flexIdx) {
      rentBaseVals.push(rentVals[i]);
      rentGapVals.push(0);
    } else {
      const newUnits = (i + 1) * unitStep - flexUnits;
      const yourVal = Math.round(existingRentF + newUnits * currentNar * avgRent);
      const peerVal = Math.round(existingRentF + newUnits * p50Nar * avgRent);
      rentBaseVals.push(yourVal);
      rentGapVals.push(showPeer ? Math.max(0, peerVal - yourVal) : 0);
    }
  }

  const barColors = JSON.stringify(
    Array.from({ length: N }, (_, i) => i <= flexIdx ? "rgba(106,61,184,0.85)" : "rgba(106,61,184,0.28)")
  );
  const barGapColors = JSON.stringify(
    Array.from({ length: N }, (_, i) => i <= flexIdx ? "rgba(0,0,0,0)" : "rgba(220,80,80,0.32)")
  );
  const barBorders = JSON.stringify(
    Array.from({ length: N }, (_, i) => i <= flexIdx ? "rgba(106,61,184,0)" : "rgba(106,61,184,0.15)")
  );
  const barGapBorders = JSON.stringify(
    Array.from({ length: N }, (_, i) => i <= flexIdx ? "rgba(0,0,0,0)" : "rgba(220,80,80,0.50)")
  );

  const rentBaseValsJs = JSON.stringify(rentBaseVals);
  const rentGapValsJs = JSON.stringify(rentGapVals);
  const rentValsJs = JSON.stringify(rentVals);
  const currLblJs = JSON.stringify(currLbl);
  const projLblJs = JSON.stringify(projLbl);
  const currRateFullLblJs = JSON.stringify(currRateFullLbl);
  const showPeerLabelJs = showPeer ? "true" : "false";

  const peerLegendHtml = showPeer
    ? `<div style="display:flex;align-items:center;gap:5px;"><div style="width:12px;height:12px;background:rgba(220,80,80,0.32);border-radius:2px;border:1px solid rgba(220,80,80,0.50);"></div><div style="font-size:10px;color:#524e5b;">Gap to peer median (${(p50Nar * 100).toFixed(1)}%)</div></div>`
    : "";

  const notEnrolledPct = totalPortfolio > 0 ? Math.round((totalPortfolio - flexUnits) / totalPortfolio * 100) : 0;

  const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;flex-direction:row;padding:0;overflow:hidden;">

    <!-- Left dark panel -->
    <div style="width:290px;min-width:290px;background:#2C194D;padding:40px 28px;display:flex;flex-direction:column;flex-shrink:0;">
      <div style="font-size:9px;letter-spacing:0.18em;text-transform:uppercase;color:#DDC6F9;font-weight:600;margin-bottom:16px;">PORTFOLIO GAP</div>
      <div style="font-size:34px;font-weight:500;line-height:1.1;color:#fff;letter-spacing:-0.02em;font-family:'ABCDiatype',sans-serif;margin-bottom:14px;">${leftTitle}</div>
      <div style="font-size:12px;color:rgba(255,255,255,0.55);line-height:1.6;margin-bottom:auto;">${leftBody}</div>
      ${multiplierHtml}
      <div style="border-top:1px solid rgba(255,255,255,0.12);padding-top:14px;margin-top:16px;">
        <div style="font-size:9px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.32);margin-bottom:10px;">${leftSectionLabel}</div>
        ${scenarioRows}
      </div>
    </div>

    <!-- Right chart panel -->
    <div style="flex:1;display:flex;flex-direction:column;padding:22px 24px 18px;min-width:0;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px;flex-shrink:0;">
        <div>
          <div style="font-size:19px;letter-spacing:0.06em;text-transform:uppercase;color:#2C194D;font-weight:700;margin-bottom:4px;">PATH TO FULL PORTFOLIO</div>
          <div style="font-size:13px;color:#a09cb0;margin-top:2px;">${totalPortfolio.toLocaleString()} total units · <span style="color:#dc5050;font-weight:500;">${notEnrolledPct}% not yet enrolled</span></div>
        </div>
        <div style="display:flex;gap:14px;align-items:center;flex-shrink:0;margin-left:16px;">
          <div style="display:flex;align-items:center;gap:5px;">
            <div style="width:12px;height:12px;background:rgba(106,61,184,0.85);border-radius:2px;"></div>
            <div style="font-size:10px;color:#524e5b;">On Flex today</div>
          </div>
          <div style="display:flex;align-items:center;gap:5px;">
            <div style="width:12px;height:12px;background:rgba(106,61,184,0.28);border-radius:2px;border:1px solid rgba(106,61,184,0.20);"></div>
            <div style="font-size:10px;color:#524e5b;">At your rate (${(currentNar * 100).toFixed(1)}%)</div>
          </div>
          ${peerLegendHtml}
        </div>
      </div>
      <div style="flex:1;position:relative;min-height:0;">
        <canvas id="chart${slideId}"></canvas>
      </div>
      <div style="font-size:10px;color:#b0adc0;margin-top:6px;flex-shrink:0;line-height:1.4;">
        Purple bars = actual adoption history. Scenario lines = steady-state potential at full ramp - not a time-bound forecast. New properties typically ramp 12–24 months. <em>Results will vary by portfolio.</em>
      </div>
    </div>
  </div>`;

  const js = `
window['initSlide${slideId}'] = (function() {
  let done = false;
  return function() {
    if (done) return; done = true;
    const N = ${N};
    const rentVals = ${rentValsJs};
    const flexIdx = ${flexIdx};
    const barColors = ${barColors};
    const barBorders = ${barBorders};
    const projRent = ${Math.round(projRent)};
    const currLbl = ${currLblJs};
    const projLbl = ${projLblJs};
    const currRateLbl = ${currRateFullLblJs};
    const showPeerLabel = ${showPeerLabelJs};
    const narPct = '${(currentNar * 100).toFixed(1)}';
    const totalUnits = ${totalPortfolio};

    const rentBaseVals = ${rentBaseValsJs};
    const rentGapVals  = ${rentGapValsJs};
    const barGapColors  = ${JSON.stringify(Array.from({ length: N }, (_, i) => i <= flexIdx ? "rgba(0,0,0,0)" : "rgba(220,80,80,0.32)"))};
    const barGapBorders = ${JSON.stringify(Array.from({ length: N }, (_, i) => i <= flexIdx ? "rgba(0,0,0,0)" : "rgba(220,80,80,0.50)"))};

    const fmtM = v => {
      if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
      if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
      if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
      return '$' + v.toFixed(0);
    };

    const gapLabelsPlugin = {
      id: 'gapLabels${slideId}',
      afterRender: function(chart) {
        const parent = chart.canvas.parentNode;
        parent.querySelectorAll('.gap-overlay-${slideId}').forEach(el => el.remove());

        const dsLen = chart.data.datasets[0].data.length;
        if (!dsLen) return;
        const meta0 = chart.getDatasetMeta(0);
        const meta1 = chart.getDatasetMeta(1);
        const ca    = chart.chartArea;
        const cw    = chart.canvas.offsetWidth;

        const BOX_H = 46;
        const PAD   = 6;

        const cands = [];

        if (flexIdx >= 0 && flexIdx < meta0.data.length) {
          const el = meta0.data[flexIdx];
          cands.push({
            yIdeal: el.y - 12,
            xRight: cw - el.x + 10,
            lines:  ['TODAY - ON FLEX', currLbl + ' rent/mo · ' + narPct + '%'],
            bg: 'white', border: '#6A3DB8', color: '#2C194D',
          });
        }

        const lastBase = meta0.data[dsLen - 1];
        if (lastBase) {
          cands.push({
            yIdeal: lastBase.y,
            xRight: cw - lastBase.x + 10,
            lines:  ['AT YOUR RATE', currRateLbl + ' rent/mo'],
            bg: '#f0edff', border: 'rgba(106,61,184,0.55)', color: '#2C194D',
          });
        }

        const lastGap = meta1 && meta1.data[dsLen - 1] ? meta1.data[dsLen - 1] : null;
        if (lastGap && showPeerLabel && lastBase) {
          cands.push({
            yIdeal: lastGap.y,
            xRight: cw - lastBase.x + 10,
            lines:  ['FULL PORTFOLIO · PEER RATE', projLbl + ' rent/mo'],
            bg: '#fff5f5', border: '#dc5050', color: '#dc5050',
          });
        }

        if (!cands.length) return;

        cands.sort((a, b) => a.yIdeal - b.yIdeal);

        const yFinal = cands.map(c => c.yIdeal);
        for (let i = 1; i < cands.length; i++) {
          const minY = yFinal[i - 1] + BOX_H + PAD;
          if (yFinal[i] < minY) yFinal[i] = minY;
        }

        for (let i = 0; i < cands.length; i++) {
          if (yFinal[i] - BOX_H < ca.top) yFinal[i] = ca.top + BOX_H;
          if (yFinal[i] > ca.bottom)       yFinal[i] = ca.bottom;
        }

        cands.forEach(function(c, i) {
          const d = document.createElement('div');
          d.className = 'gap-overlay-${slideId}';
          d.style.cssText =
            'position:absolute;right:' + c.xRight + 'px;top:' + yFinal[i] + 'px;' +
            'background:' + c.bg + ';border:1.5px solid ' + c.border + ';border-radius:8px;' +
            'color:' + c.color + ';font-size:10px;font-weight:700;' +
            "font-family:'ABCDiatype',sans-serif;" +
            'padding:6px 9px;white-space:nowrap;text-align:center;line-height:1.5;' +
            'pointer-events:none;transform:translateY(-100%);z-index:10;';
          d.innerHTML = c.lines.join('<br>');
          parent.appendChild(d);

          const boxW = d.offsetWidth;
          const maxRight = cw - boxW - 4;
          if (c.xRight > maxRight) {
            d.style.right = Math.max(maxRight, 4) + 'px';
          }
        });
      }
    };

    const ctx = document.getElementById('chart${slideId}');
    const _gapChart = new Chart(ctx, {
      data: {
        labels: rentBaseVals.map((_, i) => i),
        datasets: [
          {
            type: 'bar',
            label: 'Base',
            data: rentBaseVals,
            backgroundColor: barColors,
            borderColor: barBorders,
            borderWidth: 1,
            borderRadius: 0,
            categoryPercentage: 1.0,
            barPercentage: 0.94,
            stack: 'main',
            datalabels: { display: false },
          },
          {
            type: 'bar',
            label: 'Gap',
            data: rentGapVals,
            backgroundColor: barGapColors,
            borderColor: barGapBorders,
            borderWidth: 1,
            borderRadius: { topLeft: 2, topRight: 2, bottomLeft: 0, bottomRight: 0 },
            categoryPercentage: 1.0,
            barPercentage: 0.94,
            stack: 'main',
            datalabels: { display: false },
          },
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 88, right: 30, bottom: 0, left: 0 } },
        clip: false,
        plugins: {
          legend: { display: false },
          datalabels: { display: false },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            title: { display: true, text: 'Units enrolled', color: '#9ca3af', font: { size: 9 } },
            ticks: {
              color: '#9ca3af',
              font: { size: 10 },
              maxRotation: 0,
              autoSkip: false,
              callback: function(val, idx) {
                const units = (idx + 1) * (totalUnits / N);
                const fmt = u => u >= 1e6 ? (u/1e6).toFixed(1)+'M' : u >= 1000 ? Math.round(u/1000)+'k' : Math.round(u).toString();
                const checkpoints = [0, Math.round(N/4), Math.round(N/2), Math.round(3*N/4), N-1];
                if (checkpoints.includes(idx)) return fmt(units);
                return null;
              }
            }
          },
          y: {
            stacked: true,
            min: 0,
            max: Math.ceil(projRent * 1.10 / 500000) * 500000,
            grid: { color: '#f3f4f6' },
            border: { display: false },
            title: { display: true, text: 'Rent guaranteed / mo', color: '#9ca3af', font: { size: 9 } },
            ticks: {
              color: '#9ca3af',
              font: { size: 10 },
              callback: v => fmtM(v),
              maxTicksLimit: 6
            }
          }
        }
      },
      plugins: [gapLabelsPlugin],
    });
    requestAnimationFrame(() => { _gapChart.resize(); });
  };
})();`;

  return { html, js };
}


// ─── Expansion Case Close (Slide 46) ────────────────────────────────────────
// "THE CASE FOR EXPANDING: Four proof points" — white slide with numbered findings.
// Ported from render_expansion_case_close at line 7771 of generator/slides.py.

export interface ExpansionCaseCloseInput {
  slideId: number;
  pmcName: string;
  enrolledUnits: number;
  totalPortfolioUnits: number;
  currentNar: number;
  currentRent: number;
  currentResidents: number;
  /** "high_rent" | "affordable" */
  evidenceType?: string;
  /** Lifetime delinquency shielded ($) */
  lifetimeDqShielded?: number;
  /** Whether NIRO activity exists */
  hasNiroActivity?: boolean;
  /** Benchmark NAR for comparison */
  benchmarkNar?: number;
  /** True repeat rate (0–1) from cohort or aggregate */
  trueRepeatRate?: number | null;
  /** Window lifetimeDqShielded is actually summed over (the report's Full/Quarter/YTD period),
   * so proof-point 3's copy can name the real window instead of a hardcoded "12 months". */
  lookbackMonths?: number;
}

export function renderExpansionCaseClose(input: ExpansionCaseCloseInput): SlideResult {
  const {
    slideId,
    pmcName,
    enrolledUnits: flexUnits,
    totalPortfolioUnits: totalPort,
    currentNar,
    currentRent,
    currentResidents: residentsNow,
    evidenceType = "high_rent",
    lifetimeDqShielded = 0,
    hasNiroActivity = false,
    benchmarkNar = 0.085,
    lookbackMonths = 12,
  } = input;

  const pmc = _e(pmcName);
  const gapUnits = Math.max(totalPort - flexUnits, 0);
  const avgRentVal = Math.round(currentRent / Math.max(residentsNow, 1)) || 1365;
  const gapRentMo = Math.floor(gapUnits * currentNar) * avgRentVal;
  // Clamped to [0, 100] (Kevin's catch, live-verified) - totalPort comes from a manual AE field
  // or a Salesforce total-units pull that can legitimately be stale relative to actual
  // enrollment (e.g. SFDC not yet updated after a portfolio grew). Without the clamp, a stale
  // totalPort smaller than flexUnits renders "150% of your portfolio on Flex · -50% still to
  // go" - a nonsensical number on a slide the customer sees live. renderExpansionGap's
  // equivalent (`gapUnits = Math.max(totalPortfolio - flexUnits, 0)`) already guarded against
  // the same bad input; this slide was missed.
  const enrollPct = Math.max(0, Math.min(100, Math.round(flexUnits / Math.max(totalPort, 1) * 100)));

  function finding(n: string, headline: string, body: string): string {
    return `
        <div style="background:#f8f7ff;border:1px solid #ede9fe;
                    border-radius:10px;padding:16px 22px;display:flex;flex-direction:column;gap:8px;">
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="width:28px;height:28px;border-radius:50%;background:rgba(141,112,238,0.15);
                        display:flex;align-items:center;justify-content:center;flex-shrink:0;
                        font-size:12px;font-weight:700;color:#6A3DB8;">${n}</div>
            <div style="font-size:13px;font-weight:700;color:#1d1d1d;line-height:1.3;">${headline}</div>
          </div>
          <div style="font-size:12px;color:#6b7280;line-height:1.6;padding-left:40px;">${body}</div>
        </div>`;
  }

  const trueRepeat = input.trueRepeatRate;
  const f1 = trueRepeat != null && trueRepeat > 0
    ? finding("1",
        "Residents who use Flex keep coming back",
        `${(trueRepeat * 100).toFixed(1)}% of eligible residents came back in a given month \u2013 once residents start using Flex, most keep using it.`
      )
    : finding("1",
        "Residents who use Flex keep coming back",
        "Once residents start using Flex, most keep using it, month after month."
      );

  let f2: string;
  if (evidenceType === "affordable") {
    f2 = finding("2",
      "Flex works hardest for residents who need it most",
      "In affordable housing, 73% of residents said Flex helped them stay housed and avoid eviction. Your residents aren't just using a payment tool - they're using a housing stability tool."
    );
  } else {
    f2 = finding("2",
      "Your residents choose Flex at every rent level",
      "Flex usage isn't limited to rent-burdened residents. The driver is timing: payday and rent due dates don't line up regardless of income. It's a universal problem."
    );
  }

  let f3: string;
  if (lifetimeDqShielded > 0) {
    // "over the last 12 months" was hardcoded regardless of the actual window this dollar
    // figure is summed over (Kevin's catch, live-verified: lifetimeDqShielded is windowed to
    // the report's own Full/Quarter/YTD lookback_months upstream - a Quarter run sums 3 months
    // but the copy claimed 12, understating Flex's real annualized value by ~4x). Same "$
    // doesn't match its own label" bug class already fixed on the exec-summary tile and the
    // standalone Delinquency slide - naming the real window here too, same wording pattern.
    f3 = finding("3",
      `Flex has absorbed ${fmtCurrency(lifetimeDqShielded)} in delinquency risk over the trailing ${lookbackMonths} month${lookbackMonths === 1 ? "" : "s"} - money you kept`,
      "When residents missed payments, Flex paid you anyway. That guarantee extends across every enrolled unit - and compounds as more of your portfolio joins."
    );
  } else {
    f3 = finding("3",
      "Flex guarantees rent to you regardless of what residents pay",
      "Every enrolled unit carries the same protection: Flex covers rent when residents miss. You collect on-time rent without chasing individual payments."
    );
  }

  const lateCur = Math.max(1, Math.round(flexUnits * 0.03));
  const vacCur = Math.max(1, Math.round(flexUnits / 100 * 2.1));
  const turnsCur = Math.max(1, Math.round(flexUnits * (1 / 24.2 - 1 / 27.9) * 12));
  const f4 = finding("4",
    "Market research confirms the outcomes - and they compound with scale",
    `MetroSight studied 488 real properties across 25 states. Across your ${flexUnits.toLocaleString()} enrolled units, that's already ~${lateCur.toLocaleString()} fewer past-due payments, ~${vacCur.toLocaleString()} fewer vacant units, and ~${turnsCur.toLocaleString()} fewer resident turns per year.`
  );

  // Opportunity bar
  const oppNiro = hasNiroActivity ? " There's already proven demand at properties not yet on Flex." : "";
  const oppHtml = `
    <div style="background:#2C194D;border-radius:10px;padding:16px 24px;display:flex;
                align-items:center;justify-content:space-between;gap:16px;flex-shrink:0;margin-top:4px;">
      <div style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.55);text-transform:uppercase;letter-spacing:0.1em;flex-shrink:0;">
        The opportunity
      </div>
      <div style="font-size:13px;color:#fff;font-weight:600;flex:1;text-align:center;">
        ${enrollPct}% of your portfolio on Flex &nbsp;·&nbsp; ${100 - enrollPct}% still to go
      </div>
      <div style="font-size:13px;font-weight:700;color:#a78bfa;flex-shrink:0;white-space:nowrap;">
        +${fmtCurrency(gapRentMo)}/mo waiting${oppNiro}
      </div>
    </div>`;

  const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;flex-direction:column;padding:36px 56px 32px;overflow:hidden;">
    <div style="flex-shrink:0;margin-bottom:16px;">
      <div style="font-size:9px;letter-spacing:0.18em;text-transform:uppercase;
                  color:#6A3DB8;font-weight:600;margin-bottom:10px;">THE CASE FOR EXPANDING</div>
      <div style="font-size:32px;font-weight:700;color:#1d1d1d;line-height:1.15;
                  letter-spacing:-0.02em;margin-bottom:6px;">Four proof points.</div>
      <div style="font-size:12px;color:#9ca3af;">Repeat usage · Cross-rent adoption · Delinquency shield · Market research</div>
    </div>
    <div style="flex:1;display:grid;grid-template-columns:1fr;gap:10px;align-content:start;">
      ${f1}${f2}${f3}${f4}
    </div>
    ${oppHtml}
  </div>`;

  return { html, js: "" };
}


// ─── Expansion MetroSight (Slide 47) ────────────────────────────────────────
// Two-panel: MetroSight context left (dark), applied outcomes right.
// Ported from render_expansion_metrosight at line 7926 of generator/slides.py.

export interface ExpansionMetrosightInput {
  slideId: number;
  pmcName: string;
  /** Enrolled (Flex) units */
  enrolledUnits: number;
  /** Total portfolio units including unenrolled */
  totalPortfolioUnits: number;
  /** Average rent per paying resident (pre-computed) */
  avgRent: number;
}

export function renderExpansionMetrosight(input: ExpansionMetrosightInput): SlideResult {
  const { slideId, pmcName, enrolledUnits: flexUnits, totalPortfolioUnits: totalPort, avgRent } = input;
  const pmc = _e(pmcName);
  const gapUnits = Math.max(totalPort - flexUnits, 0);
  // Rounded (Kevin's catch, live-verified) - avgRent arrives unrounded from its call site
  // (rentPaid / billsPaid), and toLocaleString doesn't round on its own, so an unlucky division
  // rendered as "$1,427.432/mo" - fractional cents on a slide the customer sees live, right next
  // to properly-rounded dollar figures elsewhere in the same deck. Every other avg-rent
  // computation in this file already wraps this same formula in Math.round; this one was missed.
  const avgRentVal = Math.round(avgRent) || 1365;

  const lateCur  = Math.max(1, Math.round(flexUnits * 0.03));
  const vacCur   = Math.max(1, Math.round(flexUnits / 100 * 2.1));
  const turnsCur = Math.max(1, Math.round(flexUnits * (1 / 24.2 - 1 / 27.9) * 12));
  const vacAnnCur   = vacCur * avgRentVal * 12;
  const turnLoCur   = turnsCur * 1500;
  const turnHiCur   = turnsCur * 3500;

  const lateGap  = gapUnits > 50 ? Math.max(1, Math.round(gapUnits * 0.03)) : 0;
  const vacGap   = gapUnits > 50 ? Math.max(1, Math.round(gapUnits / 100 * 2.1)) : 0;
  const turnsGap = gapUnits > 50 ? Math.max(1, Math.round(gapUnits * (1 / 24.2 - 1 / 27.9) * 12)) : 0;
  const vacAnnGap   = vacGap * avgRentVal * 12;
  const turnLoGap   = turnsGap * 1500;
  const turnHiGap   = turnsGap * 3500;

  function fmt(n: number): string {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${Math.round(n / 1_000).toFixed(0)}k`;
    return `$${n.toLocaleString("en-US")}`;
  }

  const showGap = gapUnits > 50;
  const gridCols = showGap ? "100px 1fr 28px 1fr" : "100px 1fr";

  const svgClock = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="6.5" stroke="#6A3DB8" stroke-width="1.6"/><path d="M9 6v3.5l2 1.2" stroke="#6A3DB8" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const svgHouse = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2 8.5L9 3l7 5.5V16H12v-4.5H6V16H2V8.5z" stroke="#6A3DB8" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const svgCal   = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2.5" y="4.5" width="13" height="11" rx="1.5" stroke="#6A3DB8" stroke-width="1.6"/><path d="M2.5 8.5h13M6 2.5v4M12 2.5v4" stroke="#6A3DB8" stroke-width="1.6" stroke-linecap="round"/></svg>';
  const svgArrow = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 10h12M12 6l4 4-4 4" stroke="#c4b8e8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function iconLabel(svg: string, name: string): string {
    return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;padding-right:10px;">
      <div style="width:38px;height:38px;border-radius:50%;background:rgba(106,61,184,0.10);display:flex;align-items:center;justify-content:center;flex-shrink:0;">${svg}</div>
      <div style="font-size:11.5px;font-weight:600;color:#6A3DB8;text-align:center;line-height:1.3;">${name}</div>
    </div>`;
  }

  function cellCur(big: string, sub: string, detail: string): string {
    return `<div style="background:#f8f7ff;border:1px solid #ede9fe;border-radius:8px;padding:12px 14px;">
      <div style="font-size:24px;font-weight:700;color:#2C194D;letter-spacing:-0.03em;line-height:1.1;">${big}</div>
      <div style="font-size:11px;color:#374151;font-weight:500;margin-top:3px;">${sub}</div>
      <div style="font-size:10.5px;color:#6b7280;margin-top:6px;line-height:1.45;">${detail}</div>
    </div>`;
  }

  function cellGap(big: string, sub: string, detail: string): string {
    return `<div style="background:#e8fdf5;border:1px solid #bbf7d0;border-radius:8px;padding:12px 14px;">
      <div style="font-size:24px;font-weight:700;color:#15803d;letter-spacing:-0.03em;line-height:1.1;">${big}</div>
      <div style="font-size:11px;color:#374151;font-weight:500;margin-top:3px;">${sub}</div>
      <div style="font-size:10.5px;color:#6b7280;margin-top:6px;line-height:1.45;">${detail}</div>
    </div>`;
  }

  function arrowCell(): string {
    return `<div style="display:flex;align-items:center;justify-content:center;">${svgArrow}</div>`;
  }

  function row(iconHtml: string, curCell: string, gapCell: string): string {
    const arrow = showGap ? arrowCell() : "";
    const gap   = showGap ? gapCell : "";
    return `<div style="display:contents;">${iconHtml}${curCell}${arrow}${gap}</div>`;
  }

  const colHeaders = `<div></div>
    <div style="font-size:9px;font-weight:600;letter-spacing:0.10em;color:#6A3DB8;text-transform:uppercase;padding-bottom:4px;">ALREADY DELIVERING · ${flexUnits.toLocaleString("en-US")} ENROLLED</div>`
    + (showGap
      ? `<div></div><div style="font-size:9px;font-weight:600;letter-spacing:0.10em;color:#15803d;text-transform:uppercase;padding-bottom:4px;">EXPANDING ADDS · ${gapUnits.toLocaleString("en-US")} REMAINING</div>`
      : "");

  const rowsHtml = [
    row(
      iconLabel(svgClock, "On-Time<br>Rent"),
      cellCur(`~${lateCur.toLocaleString("en-US")}`, "fewer past-due payments/mo",
        "The study estimated Flex improved on-time payments 3 pp - fewer notices, fewer calls, fewer residents on a path toward move-out."),
      cellGap(`+${lateGap.toLocaleString("en-US")}`, "fewer past-due payments/mo",
        `From ${gapUnits.toLocaleString("en-US")} remaining units - same mechanism, more of your portfolio.`)
    ),
    row(
      iconLabel(svgHouse, "Vacancy<br>Reduction"),
      cellCur(`~${vacCur.toLocaleString("en-US")}`, "fewer vacant units",
        `At $${avgRentVal.toLocaleString("en-US")}/mo avg rent, those units could represent <b>~${fmt(vacAnnCur)}</b> in annual rent roll revenue.`),
      cellGap(`+${vacGap.toLocaleString("en-US")}`, "fewer vacant units",
        `<b>+~${fmt(vacAnnGap)}/yr</b> could be added to rent roll from unenrolled properties.`)
    ),
    row(
      iconLabel(svgCal, "Resident<br>Tenure"),
      cellCur(`~${turnsCur.toLocaleString("en-US")}`, "fewer resident turns/yr",
        `Avg tenure 24.2→27.9mo with Flex. At $1,500–$3,500 per turn (National Apartment Association), could save <b>~${fmt(turnLoCur)}–${fmt(turnHiCur)}/yr</b> in avoided make-ready cost.`),
      cellGap(`+${turnsGap.toLocaleString("en-US")}`, "fewer turns/yr",
        `At $1,500–$3,500 per turn (National Apartment Association), could save <b>+~${fmt(turnLoGap)}–${fmt(turnHiGap)}/yr</b> in additional avoided turnover cost.`)
    ),
  ].join("");

  const metrosightQuote = "For property operators, longer tenure and lower vacancy can reduce leasing friction, improve revenue predictability, and lower the operating burden associated with replacing residents.";

  const leftPanel = `
    <div style="width:34%;background:#2C194D;display:flex;flex-direction:column;justify-content:space-between;padding:40px 34px;flex-shrink:0;">
      <div>
        <div style="font-size:10px;font-weight:600;letter-spacing:0.14em;color:rgba(255,255,255,0.40);text-transform:uppercase;margin-bottom:16px;">Flex-commissioned Research</div>
        <div style="font-size:30px;font-weight:700;color:#fff;line-height:1.15;letter-spacing:-0.02em;margin-bottom:6px;">Rethinking Rent</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.42);margin-bottom:16px;">MetroSight · June 2026</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.48);line-height:1.6;margin-bottom:24px;">Flex commissioned MetroSight, an independent economic research firm, to study the impact of rent flexibility on multifamily outcomes. 488 real properties · 25 states · ~75,000 units total.</div>
        <div style="height:1px;background:rgba(255,255,255,0.10);margin-bottom:20px;"></div>
        <div style="font-size:11px;font-weight:600;letter-spacing:0.10em;color:rgba(255,255,255,0.40);text-transform:uppercase;margin-bottom:16px;">What they found</div>
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div style="display:flex;align-items:center;gap:14px;">
            <div style="flex-shrink:0;width:36px;height:36px;border-radius:50%;background:#6A3DB8;display:flex;align-items:center;justify-content:center;">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="6.5" stroke="white" stroke-width="1.6"/><path d="M9 6v3.5l2 1.2" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
            <div>
              <div style="font-size:20px;font-weight:700;color:#fff;letter-spacing:-0.02em;line-height:1.1;">+3.0 pp</div>
              <div style="font-size:11.5px;color:rgba(255,255,255,0.55);margin-top:2px;">on-time rent payments</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:14px;">
            <div style="flex-shrink:0;width:36px;height:36px;border-radius:50%;background:#6A3DB8;display:flex;align-items:center;justify-content:center;">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2 8.5L9 3l7 5.5V16H12v-4.5H6V16H2V8.5z" stroke="white" stroke-width="1.6" stroke-linejoin="round"/></svg>
            </div>
            <div>
              <div style="font-size:20px;font-weight:700;color:#fff;letter-spacing:-0.02em;line-height:1.1;">2.1 fewer</div>
              <div style="font-size:11.5px;color:rgba(255,255,255,0.55);margin-top:2px;">vacant units per 100 apartments</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:14px;">
            <div style="flex-shrink:0;width:36px;height:36px;border-radius:50%;background:#6A3DB8;display:flex;align-items:center;justify-content:center;">
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
        "${metrosightQuote}"
      </div>
      <div style="margin-top:14px;">
        <a class="metrosight-link" href="https://getflex.com/reports/rethinking-rent-report" target="_blank" rel="noopener noreferrer" style="font-size:10.5px;color:rgba(255,255,255,0.5);text-decoration:underline;">Link to full report &rarr;</a>
      </div>
    </div>`;

  const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;flex-direction:row;padding:0;overflow:hidden;">
    ${leftPanel}
    <div style="flex:1;display:flex;flex-direction:column;padding:28px 32px 20px;overflow:hidden;min-width:0;">
      <div style="font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#6A3DB8;margin-bottom:6px;">WHAT THIS MEANS FOR YOU</div>
      <div style="font-size:28px;font-weight:700;color:#2C194D;line-height:1.15;letter-spacing:-0.02em;margin-bottom:4px;">Applied to ${pmc}</div>
      <div style="font-size:12px;color:#9ca3af;margin-bottom:18px;">Projections apply MetroSight estimates to portfolio size. Actual results will vary.</div>
      <div style="display:grid;grid-template-columns:${gridCols};gap:10px;align-content:center;align-items:center;flex:1;">
        ${colHeaders}
        ${rowsHtml}
      </div>
    </div>
  </div>`;

  return { html, js: "" };
}




export interface AffordableHousingInput {
  slideId: number;
  pmcName: string;
  propertySnapshot: Array<{
    propertyName: string;
    units: number;
    billsPaid: number;
    rentPaid: number;
    adoptionRate: number;
  }>;
}

export function renderAffordableHousing(input: AffordableHousingInput): SlideResult {
  const { slideId, pmcName, propertySnapshot } = input;
  const pmc = _e(pmcName);

  const totalBills = propertySnapshot.reduce((s, p) => s + p.billsPaid, 0);
  const totalRent = propertySnapshot.reduce((s, p) => s + p.rentPaid, 0);
  const avgRent = totalBills > 0 ? Math.round(totalRent / totalBills) : 0;

  const html = `
  <div class="slide" id="slide-${slideId}" style="background:#fff;flex-direction:column;padding:40px 56px 32px;overflow:hidden;">
    <div class="slide-header" style="margin-bottom:24px;">
      <div style="font-size:9px;letter-spacing:0.18em;text-transform:uppercase;color:#6A3DB8;font-weight:600;margin-bottom:10px;">AFFORDABLE HOUSING EVIDENCE</div>
      <div style="font-size:26px;font-weight:700;color:#1d1d1d;line-height:1.2;letter-spacing:-0.02em;margin-bottom:6px;">Flex works hardest for residents who need it most</div>
      <div style="font-size:12px;color:#9ca3af;line-height:1.5;">At an average rent of ${fmtCurrency(avgRent)}/mo, ${pmc}'s residents are exactly who Flex was designed to serve.</div>
    </div>

    <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;gap:20px;align-content:start;">
      <div style="background:#f8f7ff;border:1px solid #ede9fe;border-radius:10px;padding:24px;">
        <div style="font-size:48px;font-weight:700;color:#6A3DB8;letter-spacing:-0.03em;line-height:1;">73%</div>
        <div style="font-size:13px;font-weight:600;color:#1d1d1d;margin-top:12px;">of residents said Flex helped them stay housed</div>
        <div style="font-size:11px;color:#6b7280;margin-top:8px;line-height:1.5;">In a 2024 survey of 3,200+ Flex users in affordable housing, nearly three-quarters reported that Flex directly prevented them from falling behind on rent or facing eviction proceedings.</div>
      </div>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:24px;">
        <div style="font-size:48px;font-weight:700;color:#15803d;letter-spacing:-0.03em;line-height:1;">89%</div>
        <div style="font-size:13px;font-weight:600;color:#1d1d1d;margin-top:12px;">would recommend Flex to a neighbor</div>
        <div style="font-size:11px;color:#6b7280;margin-top:8px;line-height:1.5;">Satisfaction is highest among residents paying under $1,200/mo. The value of payment flexibility increases as the gap between paycheck timing and rent due date grows more consequential.</div>
      </div>
    </div>

    <div style="margin-top:auto;padding-top:16px;border-top:1px solid #f0edff;">
      <div style="font-size:11px;color:#9ca3af;line-height:1.5;">
        Source: Flex Resident Impact Survey, Q3 2024 (n=3,247 respondents in LIHTC / Section 8 / workforce housing). Your residents aren't just using a payment tool — they're using a housing stability tool.
      </div>
    </div>
  </div>`;

  return { html, js: "" };
}
