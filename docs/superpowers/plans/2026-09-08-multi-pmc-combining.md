# Multi-PMC Combining & Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 2-PMC-only `second_pmc` combining mechanism with a real N-entity `additional_pmc_names[]` array, for both QBR and Expansion, and give the 5 affected slides (Exec Summary, Since Inception, Adoption Trend, Residents/Units/Rent, plus a new Portfolio Comparison slide) a way to show N entities without becoming unreadable.

**Architecture:** One shared array (`[pmc_name, ...additional_pmc_names]`) resolved once near the top of `run()`, used to build a single `IN (...)` query for the main data pull (replacing today's hand-duplicated 2-query version) and to extend the ~7 other single-PMC queries that feed slides either deck type renders. Every merged row keeps its own `PMC_NAME`, so per-entity breakdowns (stacked bars, the comparison table, view switchers) are built by grouping the already-merged rows — no new queries needed for those.

**Tech Stack:** TypeScript, Zod, Snowflake SQL (`ctx.integrations.snowflake_sso.query`), React/TSX client, Chart.js (client-side, via inline `<script>` in generated HTML).

**Verification discipline for every task** (matches this session's established pattern, no test framework exists in this repo): `npm run typecheck` (must stay clean) → `npx eslint <file>` diffed against `git show HEAD:<file>` baseline (only pre-existing errors with shifted line numbers acceptable, zero new ones) → a throwaway `npx tsx` scratch script reproducing the specific logic being changed, run and deleted → commit.

---

### Task 1: Schema — replace `second_pmc` with `additional_pmc_names`

**Files:**
- Modify: `server/apis/pmc-report/get-pmc-monthly-report.ts:1862`, `:1978`

- [ ] **Step 1: Change the input schema field**

At `get-pmc-monthly-report.ts:1862`, replace:
```ts
second_pmc: z.string().optional().default(""),
```
with:
```ts
// Replaces the old second_pmc (capped at exactly one extra entity) - a real array, no
// hardcoded limit. pmc_name stays the "primary" entity for display (cover title, etc.);
// this is everyone else being combined in. Plain .optional() + resolve the [] default at the
// call site below, NOT .optional().default([]) - that combo makes the field required in the
// generated call-site type, the same zod gotcha this file's other optional fields already
// avoid (see growth_slides for precedent).
additional_pmc_names: z.array(z.string()).optional(),
```

- [ ] **Step 2: Update the `run()` destructure and resolve the merged name list**

At `get-pmc-monthly-report.ts:1978`, replace `second_pmc` in the destructured parameter list with `additional_pmc_names`. Immediately after the destructure line, add:
```ts
// Single resolved list every downstream query/array-builder reads from - pmc_name first
// (the "primary" entity), then whatever else is being combined in. Replaces the old
// `second_pmc ? [pmc_name, second_pmc] : [pmc_name]` pattern repeated at 4 call sites below.
const allPmcNames = [pmc_name, ...(additional_pmc_names ?? [])];
```

- [ ] **Step 3: Typecheck + lint**

Run `npm run typecheck` (expect clean) and `npx eslint server/apis/pmc-report/get-pmc-monthly-report.ts`, diff against `git show HEAD:server/apis/pmc-report/get-pmc-monthly-report.ts` baseline. Expect the pre-existing 10 baseline errors only (line numbers may shift), zero new ones. Don't commit yet — Task 2 uses `allPmcNames` immediately and the two land together.

---

### Task 2: Rewrite the main data pull to a single N-way query

**Files:**
- Modify: `server/apis/pmc-report/get-pmc-monthly-report.ts:2157-2217`

- [ ] **Step 1: Replace the two-query-and-concat block with one `IN (...)` query**

Replace the full block from `const rows = await ctx.integrations.snowflake_sso.query(` (line 2157) through `allRows = [...rows, ...secondRows];\n    }` (line 2217) with:

```ts
    const pmcNamePlaceholders = allPmcNames.map(() => "?").join(", ");
    const allRows = await ctx.integrations.snowflake_sso.query(
      `SELECT
          TO_VARCHAR(BP_MONTH, 'YYYY-MM-DD') AS BP_MONTH,
          PROPERTY_NAME,
          PMC_NAME,
          PROPERTY_UNIT_COUNT,
          TO_VARCHAR(ROLLOUT_MONTH, 'YYYY-MM-DD') AS ROLLOUT_MONTH,
          CHARGED_USERS_COUNT AS CHARGED_USERS,
          COALESCE(NEW_SIGNUPS_COUNT, 0) AS NEW_SIGNUPS,
          BILLS_PAID_COUNT AS BILLS_PAID,
          COALESCE(RENT_PAID_AMOUNT, 0) AS RENT_PAID,
          PROPERTY_PUBLIC_ID,
          PROPERTY_STATE,
          IS_IN_NETWORK,
          COALESCE(NEW_BILL_CONNECTIONS_PROPERTY, 0) AS NEW_BILL_CONNECTIONS,
          HUBSPOT_DEAL_TOTAL_COMPANY_UNITS,
          STATIC_PARENT_TEAM_NAME_OPPORTUNITY AS SEGMENT_TEAM,
          HAS_MARKETING_INTEGRATION,
          IS_MARKETING_OPT_IN
       FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS
       WHERE PMC_NAME IN (${pmcNamePlaceholders})
         AND BP_MONTH >= DATEADD('month', -?, CURRENT_DATE())
         AND BP_MONTH < ?
       ORDER BY BP_MONTH, PROPERTY_NAME
       LIMIT 10000`,
      RawRowSchema,
      [...allPmcNames, lookback_months, cutoffStr],
      { label: "Fetch PMC monthly report data (all combined entities)" }
    );
```

Note this also fixes a real, pre-existing drift bug: the old second-PMC query was missing `SEGMENT_TEAM`/`HAS_MARKETING_INTEGRATION`/`IS_MARKETING_OPT_IN` relative to the first query (two independently-hand-maintained copies that had drifted). One query definition means that can't happen again.

- [ ] **Step 2: Fix the one remaining reference to `rows`**

Grep this function body for any other use of the old `rows` variable name (the pre-merge result) below this block - `allRows` was already the merged name everywhere downstream, so this should be a no-op, but confirm via `grep -n "\brows\b" server/apis/pmc-report/get-pmc-monthly-report.ts` scoped near this line to be sure nothing else in this function still expects the narrower `rows` binding.

- [ ] **Step 3: Typecheck + lint**

Same as Task 1 Step 3.

- [ ] **Step 4: Synthetic verification**

Write a scratch script that builds `pmcNamePlaceholders` for arrays of length 1, 2, and 8, and confirms the placeholder count matches and the bind-param array (`[...allPmcNames, lookback_months, cutoffStr]`) has the right length and order. Run with `npx tsx`, delete after.

- [ ] **Step 5: Commit**

```bash
git add server/apis/pmc-report/get-pmc-monthly-report.ts
git commit -m "feat: replace second_pmc with additional_pmc_names, N-way merge in main pull"
```

---

### Task 3: Generalize the 4 existing array-builders

**Files:**
- Modify: `server/apis/pmc-report/get-pmc-monthly-report.ts:2136, 2570, 3271, 3686`

- [ ] **Step 1: Update each of the 4 sites**

All 4 follow the exact same shape - replace the `second_pmc ? [pmc_name, second_pmc] : [pmc_name]` (or the `subjectPmcsForPool` variant that pads to length 2) with a reference to `allPmcNames` directly:

| Line | Current | New |
|---|---|---|
| 2136 | `const peerCandidateSubjectPmcs = second_pmc ? [pmc_name, second_pmc] : [pmc_name];` | `const peerCandidateSubjectPmcs = allPmcNames;` |
| 2570 | `const subjectPmcsForPool = [pmc_name, second_pmc \|\| pmc_name];` | `const subjectPmcsForPool = allPmcNames;` (also removes the now-pointless length-2 padding - see Task 4, this feeds dead code anyway) |
| 3271 | `const subjectPmcNames = second_pmc ? [pmc_name, second_pmc] : [pmc_name];` | `const subjectPmcNames = allPmcNames;` |
| 3686 | `const excludedPmcNames = second_pmc ? [pmc_name, second_pmc] : [pmc_name];` | `const excludedPmcNames = allPmcNames;` |

All 4 already feed either a `.map(() => "?")`-style dynamic placeholder list or a plain JS `.includes()`/`Set` check - confirmed N-ready with no other changes (see the architecture investigation this plan is based on).

- [ ] **Step 2: Typecheck + lint + commit**

```bash
npm run typecheck
npx eslint server/apis/pmc-report/get-pmc-monthly-report.ts
git add server/apis/pmc-report/get-pmc-monthly-report.ts
git commit -m "feat: point the 4 existing PMC-list builders at allPmcNames"
```

---

### Task 4: Delete the dead hardcoded-to-2 `NETWORK_POOL_SQL` path

**Files:**
- Modify: `server/apis/pmc-report/get-pmc-monthly-report.ts` (the `NETWORK_POOL_SQL` query, its `subject_rows`/`peer_candidates` CTEs using literal `(?, ?)`, and the `_networkPool` variable it populates)

- [ ] **Step 1: Confirm it's genuinely dead before touching it**

Grep `_networkPool` across the file - confirmed by the earlier investigation to have no reader anywhere (comments at its declaration already call it a "TEMPORARY diagnostic"/"write-only"). Re-confirm with a fresh grep before deleting, since this plan may be executed some time after that investigation.

- [ ] **Step 2: Remove it**

Delete the `NETWORK_POOL_SQL` query definition, its execution, and the `_networkPool` variable. This is the one place in the file with a hardcoded `(?, ?)` two-placeholder pattern tied to PMC names - since it's dead code, there's nothing to generalize, just remove it rather than spending effort making unused code N-ready.

- [ ] **Step 3: Typecheck + lint + commit**

```bash
npm run typecheck
npx eslint server/apis/pmc-report/get-pmc-monthly-report.ts
git add server/apis/pmc-report/get-pmc-monthly-report.ts
git commit -m "chore: remove dead hardcoded-to-2-PMC NETWORK_POOL_SQL diagnostic query"
```

---

### Task 5: Extend the 7 other queries that feed rendered slides

**Files:**
- Modify: `server/apis/pmc-report/get-pmc-monthly-report.ts` at each of the 7 query blocks below.

- [ ] **Step 1: Since Inception query (lines ~2880-2904, "Fetch since-inception yearly totals")**

Change `WHERE PMC_NAME = ?` to `WHERE PMC_NAME IN (${allPmcNames.map(() => "?").join(", ")})`, and the bind-param array from `[pmc_name, ...]` to `[...allPmcNames, ...]` (keep whatever other params follow in their existing order/position).

- [ ] **Step 2: Rent-bucket queries (lines ~3500-3564, both "Last month" and "All-time" resident-rent pulls)**

Same `= ?` → `IN (...)` change, same bind-param pattern, at both the Last Month query and the All-Time query.

- [ ] **Step 3: Retention/loyalty cohort query (lines ~2926-3019, "Compute loyalty buckets & true repeat rate")**

Same change. This query has multiple `?` placeholders already (reporting month, lookback, cutoff) at different positions - insert the PMC-name placeholders at the position the existing single `PMC_NAME = ?` occupies, don't just prepend to the params array blindly. Read the full query text before editing to get parameter order right.

- [ ] **Step 4: DQ shielded query (lines ~2858-2877, "Fetch DQ shielded data from DQ_PROPERTY")**

Same change.

- [ ] **Step 5: Partner-since query (lines ~3117-3178, both the Salesforce-opportunity path and the rollout-date fallback path)**

Same change, both paths.

- [ ] **Step 6: Salesforce portfolio-units query (lines ~3193-3200, "Subject PMC's true total company units")**

This one joins through `PMC_ID` via a subquery (`JOIN (SELECT DISTINCT PMC_ID FROM ... WHERE PMC_NAME = ? LIMIT 1) p`) rather than filtering `PMC_NAME` directly on the outer query. For N entities this needs to become `WHERE PMC_NAME IN (...)` (drop the `LIMIT 1`, since there are now potentially N distinct `PMC_ID`s to sum across) and the outer `SUM`/aggregation adjusted to total across all of them rather than assuming one row. Read this query's full current logic before changing it - it's structurally different from the other 6.

- [ ] **Step 7: Typecheck + lint after each query (not just at the end)**

Run `npm run typecheck` after every single query edit in this task, not once at the end - a parameter-order mistake in one query is much easier to spot immediately than after 7 edits are stacked.

- [ ] **Step 8: Synthetic verification**

For at least the retention/loyalty query (the most structurally complex one touched here), write a scratch script that constructs the final SQL string with a 3-name `allPmcNames` array and manually count that the number of `?` placeholders in the string equals the number of bound params in the array. Run, confirm, delete.

- [ ] **Step 9: Commit**

```bash
git add server/apis/pmc-report/get-pmc-monthly-report.ts
git commit -m "feat: extend since-inception/rent-bucket/retention/DQ/partner-since/SFDC-units queries to merge all combined entities"
```

---

### Task 6: Live verification of the data layer before building any visualization

**Files:** none (verification-only task)

- [ ] **Step 1: Generate a real combined QBR deck**

Using the actual Aaron/Asset Living request (`pmc_name: "Asset Living"`, `additional_pmc_names: ["First Communities", "Asset Living Student", "FPI", "Strategic Management Partners", "Echelon Property Group", "Lund Company", "Trinity Multifamily"]` — this can be done by calling the API directly with these args before the UI exists yet, e.g. via a temporary script hitting the endpoint, or by temporarily hardcoding the args in `index.tsx`'s QBR handler for one test run and reverting).

- [ ] **Step 2: Cross-check against direct Snowflake queries**

For at least 2 of the 8 entities, run a direct `SELECT SUM(BILLS_PAID_COUNT) FROM PRODUCTION.ANALYTICS.PROPERTY_BP_MONTH_STATS WHERE PMC_NAME = '<entity>' AND BP_MONTH = '<latest month>'`-style query and confirm it matches that entity's contribution to the combined total the deck produced (sum the per-entity breakdown once Task 8's grouping exists, or diff the combined total against 8 independent single-entity report runs summed by hand in the meantime).

- [ ] **Step 3: Confirm Portfolio Projection reflects the combined total with zero code changes**

Per the design spec, Portfolio Projection has no PMC-scoped query of its own - confirm its output on this combined deck looks like a plausible function of the combined `totalUnitsAll`/`latestMonth`, not any single entity's numbers.

- [ ] **Do NOT proceed to Task 7 until this passes.** Everything downstream assumes the merged data is correct.

---

### Task 7: UI — multi-PMC add/remove fields in both tabs

**Files:**
- Modify: `client/pages/PMCMonthlyReport/components/QBRTab.tsx` (replace the existing single "+ Add Second PMC" toggle)
- Modify: `client/pages/PMCMonthlyReport/components/ExpansionTab.tsx` (add fresh - no existing field)
- Modify: `client/pages/PMCMonthlyReport/index.tsx` (both generate handlers' `args` objects)

- [ ] **Step 1: Read `QBRTab.tsx`'s current second-PMC block in full before changing it**

The current block (around line 191-203 per earlier reads this session) uses a single `showSecondPMC`/`secondPMC` state pair and one `PMCSearch` field. Read the file fresh - it's been touched by other work since the last full read in this plan's research phase, confirm exact current line numbers before editing.

- [ ] **Step 2: Replace with a repeatable list, `QBRTab.tsx`**

Replace the single `secondPMC` state with `additionalPmcs: string[]` (`useState<string[]>([])`), and the single toggle+field with:
```tsx
<div className="space-y-2">
  <span className="text-sm font-medium text-gray-700">Additional PMCs to combine</span>
  {additionalPmcs.map((name, i) => (
    <div key={i} className="relative">
      <PMCSearch label={`PMC ${i + 2}`} placeholder="Search for a PMC..." value={name}
        onChange={(v) => setAdditionalPmcs((prev) => prev.map((p, j) => j === i ? v : p))}
        pmcNames={pmcNames} loading={pmcLoading} optional />
      <button type="button" onClick={() => setAdditionalPmcs((prev) => prev.filter((_, j) => j !== i))}
        className="absolute top-0 right-0 text-[10px] text-gray-400 hover:text-gray-600">remove</button>
    </div>
  ))}
  <button type="button" onClick={() => setAdditionalPmcs((prev) => [...prev, ""])}
    className="text-xs text-[#6A3DB8] hover:underline">+ Add another PMC</button>
</div>
```
Update `QBRFormState` to replace `second_pmc: string` with `additional_pmc_names: string[]`, and `handleGenerate`'s payload to send `additional_pmc_names: additionalPmcs.filter((n) => n.trim())` (drop empty rows from an add-then-cancel click).

- [ ] **Step 3: Same pattern, `ExpansionTab.tsx`**

Add the identical block (state, JSX, `ExpansionFormState` field) - this tab has no prior second-PMC field at all, so this is pure addition, not a replacement.

- [ ] **Step 4: Update `index.tsx`'s two generate handlers**

`handleQBRGenerate`: replace `second_pmc: ...` in the `args` object with `additional_pmc_names: state.additional_pmc_names`.
`handleExpansionGenerate`: replace the hardcoded `second_pmc: ""` with `additional_pmc_names: state.additional_pmc_names`.

- [ ] **Step 5: Typecheck + lint all 3 files, diffed against baseline**

- [ ] **Step 6: Commit**

```bash
git add client/pages/PMCMonthlyReport/components/QBRTab.tsx client/pages/PMCMonthlyReport/components/ExpansionTab.tsx client/pages/PMCMonthlyReport/index.tsx
git commit -m "feat: repeatable multi-PMC combining UI in both QBR and Expansion tabs"
```

---

### Task 8: Per-entity grouping helper

**Files:**
- Modify: `server/apis/pmc-report/get-pmc-monthly-report.ts` (add a small shared helper near where `monthlyTotals`/`propertySnapshot` are built)

- [ ] **Step 1: Add a `groupRowsByPmc` helper**

Every merged row already carries its own `PMC_NAME` (Task 2). Add one small function used by every visualization task below:
```ts
// Groups already-merged rows by their own PMC_NAME - no new queries needed, since Task 2's
// merge kept per-row entity attribution. Used by the Exec Summary switcher, Since Inception's
// stacked bar, Adoption Trend's per-entity lines, the Residents/Units/Rent switcher, and the
// new Portfolio Comparison table - one grouping utility, five consumers.
function groupRowsByPmc<T extends { PMC_NAME: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const list = map.get(r.PMC_NAME) ?? [];
    list.push(r);
    map.set(r.PMC_NAME, list);
  }
  return map;
}
```

- [ ] **Step 2: Typecheck + lint + commit**

```bash
npm run typecheck
npx eslint server/apis/pmc-report/get-pmc-monthly-report.ts
git add server/apis/pmc-report/get-pmc-monthly-report.ts
git commit -m "feat: add groupRowsByPmc helper for per-entity slide breakdowns"
```

---

### Task 9: Exec Summary — entity switcher

**Files:**
- Modify: `server/apis/pmc-report/get-pmc-monthly-report.ts` (`renderExecSummary` function and its inputs/call sites)

- [ ] **Step 1: Read `renderExecSummary`'s current full implementation fresh**

This function has been touched multiple times this session (sparklines, period comparison, delta toggle). Read it fresh before adding a 6th concern to it.

- [ ] **Step 2: Add per-entity data to `ExecSummaryInput`**

New field: `entityBreakdown?: { pmcName: string; currentResidents: number; currentRent: number; currentNar: number; propertyCount: number; totalUnits: number }[]` - one entry per combined entity (built by the call site via `groupRowsByPmc`, one aggregation pass per entity, reusing whatever aggregation logic already computes the combined `latestMonth`-equivalent totals, just scoped to one entity's rows at a time instead of all rows).

- [ ] **Step 3: Add the switcher UI + JS**

A small dropdown/pill row above the tile grid (same visual area as the existing `deltaToggle`/sparkline-toggle row moved there in an earlier commit this session): `<select>` or pill buttons, one option "Combined" (default, selected) plus one per entity name. On change, a small inline `<script>` function swaps the tile grid's displayed values between a `data-*`-embedded JSON blob per option (all entities' numbers are already in the HTML, hidden; the switcher just toggles which one's visible/active) - matches the existing pattern other toggles in this file use (embed all states in the HTML at generation time, JS just shows/hides, no re-fetch). Only render this switcher at all when `entityBreakdown` has more than 1 entry (a single-PMC report shows no switcher, unchanged from today).

- [ ] **Step 4: Wire the call site(s)**

Both QBR's and Expansion's `renderExecSummary({...})` calls need `entityBreakdown` built from `groupRowsByPmc(allRows)` plus whatever per-entity aggregation the tile numbers need (residents, rent, adoption rate, property count, units - the same shape `latestMonth`/`totalUnitsAll` computation already does for the combined case, just run once per entity too).

- [ ] **Step 5: Typecheck + lint**

- [ ] **Step 6: Synthetic verification**

Scratch script: build a fake 3-entity `entityBreakdown`, confirm the "Combined" option's numbers equal the sum of the 3 entities' numbers (a real correctness check - if the combined tile doesn't match the sum of the switcher's other options, something's wrong).

- [ ] **Step 7: Live verification**

Generate the real Asset Living combined deck, confirm the switcher shows all 8 entities plus Combined, and manually spot-check 2 entities' numbers against a direct Snowflake query.

- [ ] **Step 8: Commit**

```bash
git add server/apis/pmc-report/get-pmc-monthly-report.ts
git commit -m "feat: Exec Summary entity switcher for combined multi-PMC reports"
```

---

### Task 10: Since Inception — stacked bar by entity

**Files:**
- Modify: `server/apis/pmc-report/slide-renderers.ts:2893` (`renderSinceInception`)

- [ ] **Step 1: Read the current renderer in full** (confirm line 2893 still matches - earlier tasks in this plan land first and could shift it slightly)

- [ ] **Step 2: Change the Chart.js dataset from one bar series to N stacked series**

Chart.js stacked bars: give each entity's yearly-rent-by-year series its own `dataset` entry with the same `stack` group id, one color per entity (reuse the existing `AVATAR_PALETTE`-style color list already used elsewhere in this file for exactly this "N entities, N colors" need - don't invent a second palette). The combined total remains readable as the full stacked bar height - no separate "total" dataset needed, Chart.js sums stacked segments visually.

- [ ] **Step 3: Only stack when there's more than 1 entity**

A single-PMC report keeps today's single-color bar exactly as-is - only switch to the stacked/multi-color rendering when `groupRowsByPmc` finds more than one key.

- [ ] **Step 4: Typecheck + lint + live verification against the Asset Living deck + commit**

```bash
git add <the file this renderer lives in>
git commit -m "feat: Since Inception stacked bar by entity for combined multi-PMC reports"
```

---

### Task 11: Adoption Trend — all entity lines + distinct combined line + combined-portfolio peer median

**Files:**
- Modify: `server/apis/pmc-report/slide-renderers.ts` (`renderAdoptionTrend`, confirmed location from earlier session work)

- [ ] **Step 1: Read the current full implementation** (already read once this session - re-read fresh, since Task 9/10 may have introduced nearby changes)

- [ ] **Step 2: Add one thin line per entity**

Same per-entity grouping as Task 9/10. Each entity's own adoption-rate-by-month series gets a thin, muted line (same visual weight as the "hero + muted background lines" mockup validated live with Kevin). The existing combined-portfolio line stays exactly as thick/bold as today - no change to its own styling, just now drawn alongside the per-entity ones instead of alone.

- [ ] **Step 3: Peer median stays a single line, resolved against the combined portfolio**

Per the design spec's explicit resolution: do NOT compute a separate peer median per entity. The existing peer-median computation already resolves against the combined `totalUnitsAll`/tenure profile once `allPmcNames` feeds the upstream benchmark queries correctly (Task 5) - confirm this rather than adding new peer-matching logic here.

- [ ] **Step 4: Only show entity lines when there's more than 1 entity** (same guard as Task 10)

- [ ] **Step 5: Typecheck + lint + live verification + commit**

```bash
git add server/apis/pmc-report/slide-renderers.ts
git commit -m "feat: Adoption Trend per-entity lines + confirm combined-portfolio peer median"
```

---

### Task 12: Residents/Units/Rent — view switcher (Combined or one entity, always 3 lines)

**Files:**
- Modify: `server/apis/pmc-report/slide-renderers.ts:2666` (`renderResidentsUnitsCombo`)

- [ ] **Step 1: Read the current full implementation**

- [ ] **Step 2: Build per-entity data + a Combined dataset (same shape, either state)**

Reuse `groupRowsByPmc` again. Combined stays the default/first-shown state.

- [ ] **Step 3: Add the switcher (same UI pattern as Task 9's Exec Summary switcher, or as the existing Last Month/All-Time toggle already in this codebase - match whichever is closer once you're looking at the real surrounding markup)**

Explicitly NOT additive toggles - this was the one specifically compared live (mocked up both ways, Kevin picked the switcher) because 3 metrics × several toggled-on entities gets noisy fast. Always exactly 3 lines on screen, whichever option is active.

- [ ] **Step 4: Only show the switcher when there's more than 1 entity**

- [ ] **Step 5: Typecheck + lint + live verification + commit**

```bash
git add <the file this renderer lives in>
git commit -m "feat: Residents/Units/Rent view switcher for combined multi-PMC reports"
```

---

### Task 13: New Portfolio Comparison slide

**Files:**
- Modify: `server/apis/pmc-report/slide-renderers.ts` (new render function, pick the location alongside similar table-based slides like the Appendix/Full Property Table renderer)
- Modify: `server/apis/pmc-report/get-pmc-monthly-report.ts` (wire into both QBR's `slidesOrdered` array and Expansion's `activeOrder`/switch)
- Modify: `client/pages/PMCMonthlyReport/components/SlidesPicker.tsx` (new entry in both `QBR_SLIDES` and `EXPANSION_SLIDES`, with a plain-language description per this session's established convention)

- [ ] **Step 1: Write the new renderer**

`renderPortfolioComparison(input: { entities: { pmcName: string; unitsOnFlex: number; payingResidents: number; adoptionRate: number; rentPaid: number; monthlySeries: number[] }[] }): SlideResult`. Only renders (returns non-empty html) when `entities.length > 1` - a single-PMC report has nothing to compare, this slide should auto-skip via the same `pushSlide`-driven `expSkippedSlides`/QBR-equivalent mechanism every other conditionally-hidden slide in this file already uses.

Table columns, in order (per Kevin's explicit fix): Entity, Units on Flex, Paying Residents, Adoption Rate, Rent Paid, Trend (inline sparkline of `monthlySeries` - the adoption-rate-over-time series, same data Adoption Trend charts, condensed). Plus a Combined row (sum of units/residents/rent, weighted-average or recompute adoption rate from summed residents/units - don't average the per-entity percentages, that's mathematically wrong for a weighted total).

Sortable columns: reuse the exact sort-table JS pattern already in this codebase (`flexSortTable`/`flexNotesSortTable` - grep for the existing implementation and copy its approach rather than writing a third one).

- [ ] **Step 2: Wire into both deck types' slide order + the picker**

Add a new slide key (e.g. `"portfolio_comparison"`) to `QBR_SLIDES` and `EXPANSION_SLIDES` in `SlidesPicker.tsx` with a short plain-language description ("Every subsidiary side by side - units, residents, adoption, rent."), and wire the render call into both `slidesOrdered`/`activeOrder` at a sensible position (near the other entity-breakdown-relevant slides, e.g. right after Since Inception or right before the closing slide - use judgment on read, no strong constraint here).

- [ ] **Step 3: Typecheck + lint all 3 files**

- [ ] **Step 4: Synthetic verification**

Scratch script: build 3 fake entities, confirm the Combined row's adoption rate equals `sum(residents) / sum(units)`, NOT the average of the 3 individual percentages (these differ whenever entities have different unit counts - the classic weighted-average bug). Run, confirm, delete.

- [ ] **Step 5: Live verification + commit**

```bash
git add server/apis/pmc-report/slide-renderers.ts server/apis/pmc-report/get-pmc-monthly-report.ts client/pages/PMCMonthlyReport/components/SlidesPicker.tsx
git commit -m "feat: new Portfolio Comparison slide for combined multi-PMC reports"
```

---

### Task 14: Expansion — always-on growth-trend slides, remove the now-pointless toggle

**Files:**
- Modify: `server/apis/pmc-report/get-pmc-monthly-report.ts` (the `showGrowthSlides`/SMB-segment gate for Expansion)
- Modify: `client/pages/PMCMonthlyReport/components/ExpansionTab.tsx` (remove the "Growth trend slides" Auto/Include/Exclude `ToggleGroup` and its help text)

- [ ] **Step 1: Read the current `showGrowthSlides` resolution logic in `get-pmc-monthly-report.ts` fresh**

- [ ] **Step 2: Make it unconditionally true for Expansion**

Replace whatever SMB-segment-conditional logic currently resolves `showGrowthSlides` for Expansion with a flat `true` - Since Inception, Residents/Units/Rent, and Adoption Trend now always render for every Expansion deck, matching Kevin's ask ("bring in the inception slide, residents paying, and adoption slide" for everyone, not just SMB).

- [ ] **Step 3: Remove the input schema field(s) that drove this** (`growth_slides`) if nothing else reads them for Expansion - grep to confirm QBR doesn't share the same field name for a different purpose before deleting.

- [ ] **Step 4: Remove the toggle from `ExpansionTab.tsx`**

Delete the "Growth trend slides" `ToggleGroup` block and its help text (added earlier this session - now obsolete since there's no more segment branching for it to control), and the `growthSlides` state/payload field.

- [ ] **Step 5: Confirm sparklines auto-hide with zero new code**

The existing sparkline-visibility logic already defaults to hidden whenever growth trend slides are on (`sparklinesOverride ?? !(showGrowthSlides && ...)`, built earlier this session). With `showGrowthSlides` now always `true` for Expansion, generate a real Expansion deck and confirm the Exec Summary tile's sparklines are gone by default - if they're not, the existing conditional formula needs a look, but per the design spec this should already just work.

- [ ] **Step 6: Typecheck + lint both files + live verification + commit**

```bash
git add server/apis/pmc-report/get-pmc-monthly-report.ts client/pages/PMCMonthlyReport/components/ExpansionTab.tsx
git commit -m "feat: always render the 3 growth-trend slides in Expansion, drop the now-pointless toggle"
```

---

### Task 15: End-to-end verification with the real Asset Living request

**Files:** none

- [ ] **Step 1:** Generate the real combined deck (Asset Living + 7 named subsidiaries) in both QBR and Expansion mode.
- [ ] **Step 2:** Confirm every switcher (Exec Summary, Residents/Units/Rent) lists all 8 entities plus Combined, and that selecting each one changes only what that switcher controls.
- [ ] **Step 3:** Confirm the Since Inception stacked bar's 8 segments sum to the same total the old single-color version would have shown for the combined portfolio.
- [ ] **Step 4:** Confirm the new Portfolio Comparison table's Combined row matches hand-summed totals across its own 8 entity rows, for every numeric column.
- [ ] **Step 5:** Confirm Adoption Trend shows 8 thin entity lines + 1 bold combined line + exactly 1 peer-median line (not 8).
- [ ] **Step 6:** Confirm a single-PMC report (no `additional_pmc_names`) renders identically to before this plan - no switcher UI, no stacked bar, single adoption line, no Portfolio Comparison slide. This is the regression check: nothing about the single-PMC path should look different.
- [ ] **Step 7:** Rebuild the scoped Clark zip, remove the superseded one, report the new zip filename.

---

## Files touched (summary)

- `server/apis/pmc-report/get-pmc-monthly-report.ts` — schema, main pull, 4 array-builders, dead-code removal, 7 extended queries, groupRowsByPmc helper, Exec Summary wiring, growth-slides gate.
- `server/apis/pmc-report/slide-renderers.ts` — Adoption Trend, Residents/Units/Rent (`renderResidentsUnitsCombo`, line 2666), Since Inception (`renderSinceInception`, line 2893), new Portfolio Comparison renderer.
- `client/pages/PMCMonthlyReport/components/QBRTab.tsx`, `ExpansionTab.tsx` — multi-PMC UI, growth-slides toggle removal (Expansion only).
- `client/pages/PMCMonthlyReport/components/SlidesPicker.tsx` — new Portfolio Comparison slide entry.
- `client/pages/PMCMonthlyReport/index.tsx` — both generate handlers' args.
