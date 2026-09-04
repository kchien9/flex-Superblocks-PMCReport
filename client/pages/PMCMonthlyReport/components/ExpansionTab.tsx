import { useState, useCallback } from "react";
import { Loader2, TrendingUp } from "lucide-react";
import { ToggleGroup } from "./ToggleGroup.js";
import { PMCSearch } from "./PMCSearch.js";
import { OwnershipGroupProperties } from "./OwnershipGroupProperties.js";
import { SlidesPicker, EXPANSION_SLIDES, BENCHMARK_METRICS, defaultSlideSet } from "./SlidesPicker.js";
import { TestimonialsEditor, type Testimonial } from "./TestimonialsEditor.js";
import { ImportSlidesPicker, type ImportedSlide } from "./ImportSlidesPicker.js";

/** Always-visible section — Slides and Testimonials are used on most builds and shouldn't be
 * buried behind a click. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-gray-100 pb-3">
      <span className="block text-xs font-semibold uppercase tracking-wider text-gray-500 py-1">{title}</span>
      <div className="mt-2">{children}</div>
    </div>
  );
}

export interface ExpansionFormState {
  pmc_name: string;
  total_portfolio_units: string;
  property_ids: string[];
  ownership_report_name: string;
  review_period: string;
  comparison_months: number;
  delivery: string;
  growth_slides: string;
  sparklines: string;
  period_comparison: string;
  terminology: string;
  selected_slides: Set<string>;
  selected_metrics: Set<string>;
  testimonials: Testimonial[];
  imported_slides: ImportedSlide[];
}

interface ExpansionTabProps {
  pmcNames: string[];
  pmcLoading: boolean;
  generating: boolean;
  onGenerate: (state: ExpansionFormState) => void;
}

export function ExpansionTab({ pmcNames, pmcLoading, generating, onGenerate }: ExpansionTabProps) {
  const [selectedPMC, setSelectedPMC] = useState("");
  const [totalPortfolioUnits, setTotalPortfolioUnits] = useState("");
  const [showCrossPMC, setShowCrossPMC] = useState(false);
  const [propertyIds, setPropertyIds] = useState<string[]>([]);
  const [ownershipReportName, setOwnershipReportName] = useState("");
  const [reviewPeriod, setReviewPeriod] = useState("full");
  const [comparisonMonths, setComparisonMonths] = useState(3);
  const [delivery, setDelivery] = useState("presenting");
  const [growthSlides, setGrowthSlides] = useState("auto");
  const [sparklines, setSparklines] = useState("auto");
  const [periodComparison, setPeriodComparison] = useState("auto");
  const [terminology, setTerminology] = useState("resident");
  const [selectedSlides, setSelectedSlides] = useState<Set<string>>(() => defaultSlideSet(EXPANSION_SLIDES));
  // Fixed — the picker for this was removed (server never reads it; the Peer Benchmarks slide
  // has its own inline toggle), but selected_metrics stays in the payload shape unchanged.
  const [selectedMetrics] = useState<Set<string>>(() => new Set(BENCHMARK_METRICS.map((m) => m.id)));
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
  const [importedSlides, setImportedSlides] = useState<ImportedSlide[]>([]);

  const handleGenerate = useCallback(() => {
    if (!selectedPMC) return;
    onGenerate({
      pmc_name: selectedPMC,
      total_portfolio_units: totalPortfolioUnits,
      property_ids: propertyIds,
      ownership_report_name: ownershipReportName,
      review_period: reviewPeriod,
      comparison_months: comparisonMonths,
      delivery,
      growth_slides: growthSlides,
      sparklines,
      period_comparison: periodComparison,
      terminology,
      selected_slides: selectedSlides,
      selected_metrics: selectedMetrics,
      testimonials,
      imported_slides: importedSlides,
    });
  }, [selectedPMC, totalPortfolioUnits, propertyIds, ownershipReportName, reviewPeriod, comparisonMonths, delivery, growthSlides, sparklines, periodComparison, terminology, selectedSlides, selectedMetrics, testimonials, importedSlides, onGenerate]);

  const inputCls = "w-full px-3 py-2 text-sm border border-gray-200 rounded-[4px] focus:outline-none focus:ring-2 focus:ring-[#6A3DB8]/30 focus:border-[#6A3DB8]";

  return (
    <div className="space-y-4">
      {/* When to use this deck (Kevin's ask) */}
      <div className="p-3 bg-[#F5F2FF] border border-[#DCC9F2] rounded-[4px] text-xs text-[#2C194D] leading-relaxed">
        Use this when you want to make the case for growing an account&apos;s portfolio. Works best when there&apos;s real whitespace left. Not much left to expand into? Use a QBR instead.
      </div>

      {/* PMC Search — required */}
      <div>
        <PMCSearch label="Property Management Company" placeholder="Search existing Flex customers..." value={selectedPMC} onChange={setSelectedPMC} pmcNames={pmcNames} loading={pmcLoading} />
        <p className="text-[10px] text-red-500 mt-0.5 font-medium">* Required</p>
      </div>

      {/* Total Portfolio Units */}
      <div>
        <div className="flex items-baseline gap-1 mb-1.5">
          <label className="block text-sm font-medium text-gray-700">Total Portfolio Units</label>
          <span className="text-[10px] text-gray-400">override — auto-fills from Salesforce</span>
        </div>
        <input type="number" min={0} value={totalPortfolioUnits} onChange={(e) => setTotalPortfolioUnits(e.target.value)}
          placeholder="Pulls from Salesforce automatically"
          className={inputCls} />
        <p className="text-[10px] text-gray-400 mt-1">Only override if the Salesforce value is incorrect</p>
      </div>

      {/* Cross-PMC Properties (collapsed behind link) */}
      {!showCrossPMC ? (
        <button type="button" onClick={() => setShowCrossPMC(true)} className="text-xs text-[#6A3DB8] hover:underline">
          + Add cross-PMC properties
        </button>
      ) : (
        <div className="border border-gray-100 rounded-[4px] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Cross-PMC Properties</span>
            {propertyIds.length === 0 && (
              <button type="button" onClick={() => setShowCrossPMC(false)} className="text-[10px] text-gray-400 hover:text-gray-600">close</button>
            )}
          </div>
          <OwnershipGroupProperties propertyIds={propertyIds} onPropertyIdsChange={setPropertyIds} reportName={ownershipReportName} onReportNameChange={setOwnershipReportName} hasPmcSelected={!!selectedPMC} />
        </div>
      )}

      {/* Slides */}
      <Section title="Slides">
        <SlidesPicker
          slides={EXPANSION_SLIDES}
          selectedSlides={selectedSlides}
          onSlidesChange={setSelectedSlides}
        />
      </Section>

      {/* Testimonials */}
      <Section title="Customer Testimonials">
        <p className="text-xs font-bold text-red-600 mb-2">Please read these tickets and make the call on if they should be included in the deck.</p>
        <TestimonialsEditor testimonials={testimonials} onChange={setTestimonials} pmcName={selectedPMC} />
      </Section>

      {/* Import Slides (PDF upload, Kevin's ask: not just QBR) */}
      <Section title="Import Slides">
        <ImportSlidesPicker onChange={setImportedSlides} />
      </Section>

      {/* Toggles */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700">Review Period</label>
          <ToggleGroup options={[{ value: "full", label: "Full" }, { value: "quarter", label: "Quarter" }, { value: "ytd", label: "YTD" }]} value={reviewPeriod} onChange={setReviewPeriod} />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">Compare deltas to</label>
            <ToggleGroup options={[{ value: "1", label: "1 mo" }, { value: "3", label: "3 mo" }, { value: "6", label: "6 mo" }, { value: "12", label: "12 mo" }]} value={String(comparisonMonths)} onChange={(v) => setComparisonMonths(parseInt(v))} />
          </div>
          <p className="text-[11px] text-gray-400 mt-1">The slide computes changes vs. historical metrics — what time frame do you want to compare against?</p>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">Delivery</label>
            <ToggleGroup options={[{ value: "sharing", label: "Sharing" }, { value: "presenting", label: "Presenting" }]} value={delivery} onChange={setDelivery} />
          </div>
          <p className="text-[11px] text-gray-400 mt-1">Are you emailing this deck or presenting it live? Controls formatting.</p>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">Growth trend slides</label>
            <ToggleGroup options={[{ value: "auto", label: "Auto" }, { value: "include", label: "Include" }, { value: "exclude", label: "Exclude" }]} value={growthSlides} onChange={setGrowthSlides} />
          </div>
          <p className="text-[11px] text-gray-400 mt-1">Auto: on for SMB (no AM running a separate QBR, so this deck doubles as their performance review), off for MM+/Enterprise (their AM already covers performance in a dedicated QBR, so this stays focused on the expansion ask). Include if this account has no AM, or you want to show the historic trend anyway.</p>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">Exec tile sparklines</label>
            <ToggleGroup options={[{ value: "auto", label: "Auto" }, { value: "include", label: "Include" }, { value: "exclude", label: "Exclude" }]} value={sparklines} onChange={setSparklines} />
          </div>
          <p className="text-[11px] text-gray-400 mt-1">Auto: shows on the exec tile whenever Growth trend slides above are off (a condensed stand-in for the full charts), hidden when they are on (no need for both). Override either way independent of that setting.</p>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">Exec tile period comparison</label>
            <ToggleGroup options={[{ value: "auto", label: "Auto" }, { value: "include", label: "Include" }, { value: "exclude", label: "Exclude" }]} value={periodComparison} onChange={setPeriodComparison} />
          </div>
          <p className="text-[11px] text-gray-400 mt-1">Auto/Include: the &quot;vs last period&quot; change pills on the exec tile start visible (AEs can still hide them live in the deck). Exclude starts them hidden instead - useful when you do not want a change callout in front of the room by default.</p>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">Terminology</label>
            <ToggleGroup options={[{ value: "resident", label: "Resident" }, { value: "household", label: "Household" }]} value={terminology} onChange={setTerminology} />
          </div>
          <p className="text-[11px] text-gray-400 mt-1">Which word to use throughout the deck and Excel workbook — some partners prefer one over the other.</p>
        </div>
      </div>

      {/* Generate */}
      <div className="pt-2">
        <button onClick={handleGenerate} disabled={!selectedPMC || generating}
          className="w-full px-5 py-3 text-sm font-semibold text-white rounded-[4px] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          style={{ backgroundColor: !selectedPMC || generating ? "#9CA3AF" : "#6A3DB8" }}>
          {generating ? <><Loader2 className="h-4 w-4 animate-spin" />Generating...</> : <><TrendingUp className="h-4 w-4" />Generate Expansion Deck</>}
        </button>
      </div>
    </div>
  );
}
