# Multi-PMC Combining & Visualization — Design

## Context

Aaron (Slack) asked for a combined deck for Asset Living + 7 named
subsidiaries (First Communities, Asset Living Student, FPI/Asset Living
West, Strategic Management Partners, Echelon Property Group, Lund Company,
Trinity Multifamily). Today's combining mechanism (`second_pmc`) only
supports exactly two entities, was only ever wired into QBR's UI (Expansion
has no such field at all), and — investigated live — several of the
underlying queries never actually merge the second entity's data in the
first place, a silent gap in the existing 2-PMC path that this work also
closes.

Kevin's follow-up: both QBR and Expansion should get this, not just
Expansion.

## Scope

Both deck types. Replaces `second_pmc` (a single optional string) with
`additional_pmc_names: string[]` — a real array, no hardcoded limit.
`pmc_name` stays the "primary" entity for display purposes (cover title,
etc.); `additional_pmc_names` is everyone else being combined in.

## Data layer

**The merge.** The main raw property-month pull currently hand-duplicates
its entire query body for exactly one second PMC (and the two copies have
already drifted — one is missing 5 columns the other has). Rewritten to a
single query with a dynamic `IN (...)` clause sized to
`[pmc_name, ...additional_pmc_names]` — the same `.map(() => "?")` idiom
this file already uses elsewhere (`peerCandidateSubjectPmcs`,
`subjectPlaceholders`, `lockedPeers`) for arbitrary-length lists, so this
isn't new territory, just applying an existing pattern to the query that
never got it.

Every row keeps its own `PMC_NAME` column through the merge — this is what
lets per-entity breakdowns (stacked bars, the comparison table, the view
switcher) all be built from the *same* merged row set via a simple
`groupBy(PMC_NAME)`, rather than needing a separate per-entity query.

**Closing the other gaps.** Of the 14 single-PMC-only queries found (each
binds only `pmc_name`, no merge with additional entities at all), the ones
that feed slides either deck type actually renders get the same
generalization: Since Inception, the two rent-bucket queries (Last
Month/All-Time), retention/loyalty cohort, DQ shielded, partner-since, and
the Salesforce portfolio-units pull. Two array constructions
(`subjectPmcNames`/`excludedPmcNames`) already generalize to any array
length today — those need zero changes, just a longer array going in.

**Already correct with no changes.** Portfolio Projection is a pure
downstream consumer of the same merged totals (`latestMonth`,
`totalUnitsAll`, `monthlyTotals`) — confirmed it has no PMC-scoped query of
its own, so it reflects the combined portfolio automatically once the data
layer above is fixed.

## UI

One new repeatable field, in both `QBRTab.tsx` and `ExpansionTab.tsx`: "+
Add another PMC" adds a row (reusing the existing `PMCSearch` component
already used for QBR's old single second-PMC field); each row has its own
remove button. Replaces QBRTab's old single "+ Add Second PMC" toggle
outright — same underlying capability, just not capped at one.

## Per-slide visualization

| Slide | Design |
|---|---|
| Executive Bottom Line / Exec Summary | Default: combined numbers across every entity. A single-select switcher (not additive checkboxes — a tile grid can't show two entities' numbers in the same tiles anyway) flips to any one entity's own numbers. |
| Bills & Rent Since Inception | Stacked bar — each segment is one entity's contribution that year; the bar's full height is still the combined total. |
| Portfolio Projection | No changes — automatic (see above). |
| Adoption Trend | Every entity gets its own thin line; the combined line stays bold/distinct. All shown at once — at ~8 entities one metric per line is fine (unlike the 3-metric chart below). **Peer median: one line, matched against the combined portfolio's size/profile** — not one per subsidiary. The entity actually deciding whether to expand is the whole family, not each subsidiary independently, and a separately-matched line per subsidiary would add up to 8 more lines on an already-crowded chart. |
| Residents, Units & Rent | Single-select view switcher: "Viewing: Combined" or any one entity. Always exactly 3 lines — additive toggles were considered and rejected here specifically because 3 metrics × several toggled-on entities gets noisy fast (mocked up and compared live before this decision). |
| **New: Portfolio Comparison** | One row per entity + a Combined row. Columns, in order: Entity, Units on Flex, Paying Residents, Adoption Rate, Rent Paid, Trend sparkline (adoption rate over the report's own lookback window — same series Adoption Trend charts, just condensed per row). Sortable. |

Because Exec Summary / Since Inception / Adoption Trend / Residents-Units-
Rent are already shared render functions between QBR and Expansion, building
each visualization once at the render-function level gives both deck types
the same behavior for free — no per-deck-type duplication needed.

## Folded in from the deferred list (Kevin's call — moved in scope)

- **Bring the 3 growth-trend slides (Since Inception, Residents/Units/Rent,
  Adoption Trend) into every Expansion deck**, unconditionally — not just
  SMB. Removes the SMB-vs-MM+ segment gate entirely for Expansion; these
  three slides just always render there now.
- **Sparklines on the exec tile effectively disappear as a side effect, not
  a separate change.** The existing sparkline toggle already defaults to
  hidden whenever Growth Trend slides are on (the full chart makes the
  condensed tile version redundant) — once that's unconditionally true for
  Expansion, sparklines auto-hide through logic that already exists. The
  "Growth Trend Slides" Auto/Include/Exclude toggle itself comes out of the
  Expansion form too, since there's no more segment branching for it to
  control.

## Explicitly out of scope (separate, already-agreed-to-defer rounds)

- The 5th proof-point / "what if the metric didn't improve" conclusion-slide
  question (the conclusion slide's proof points ARE now filtered by which
  source slide rendered, per the separate AJH fix shipped same-day as this
  spec — that's a prerequisite this multi-PMC work doesn't need to redo, not
  the 5th-point design question itself).
- The "this quarter spotlight" slide alongside full-year.

## Verification

- `npm run typecheck` + `npx eslint` on every touched file, diffed against
  baseline (established discipline all session).
- Generate a real combined deck for Asset Living + all 7 named subsidiaries
  (Aaron's actual request) in both QBR and Expansion mode. Confirm: the
  main pull returns rows for all 8 entities (spot-check a row count against
  a direct Snowflake query summing each entity separately), Portfolio
  Projection's numbers match manual arithmetic on the combined totals, the
  Since Inception stacked bar's segments sum to the same total the old
  single-color version would have shown, the Residents/Units/Rent switcher
  never shows more than 3 lines regardless of which entity is selected, and
  the comparison table's Combined row matches the sum of its own entity
  rows for every column.
- Confirm QBR's old single-second-PMC decks (if any are re-run) still
  produce the same output as before — `additional_pmc_names: [oldSecondPmc]`
  should be behaviorally identical to the old `second_pmc: oldSecondPmc`.
