import { useState, useCallback } from "react";
import { Loader2, TrendingUp } from "lucide-react";
import { ToggleGroup } from "./ToggleGroup.js";
import { PMCSearch } from "./PMCSearch.js";
import { OwnershipGroupProperties } from "./OwnershipGroupProperties.js";
import { SlidesPicker, EXPANSION_SLIDES, BENCHMARK_METRICS, defaultSlideSet } from "./SlidesPicker.js";
import { TestimonialsEditor, type Testimonial } from "./TestimonialsEditor.js";

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
  selected_slides: Set<string>;
  selected_metrics: Set<string>;
  testimonials: Testimonial[];
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
  const [delivery, setDelivery] = useState("sharing");
  const [selectedSlides, setSelectedSlides] = useState<Set<string>>(() => defaultSlideSet(EXPANSION_SLIDES));
  // Fixed — the picker for this was removed (server never reads it; the Peer Benchmarks slide
  // has its own inline toggle), but selected_metrics stays in the payload shape unchanged.
  const [selectedMetrics] = useState<Set<string>>(() => new Set(BENCHMARK_METRICS.map((m) => m.id)));
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);

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
      selected_slides: selectedSlides,
      selected_metrics: selectedMetrics,
      testimonials,
    });
  }, [selectedPMC, totalPortfolioUnits, propertyIds, ownershipReportName, reviewPeriod, comparisonMonths, delivery, selectedSlides, selectedMetrics, testimonials, onGenerate]);

  const inputCls = "w-full px-3 py-2 text-sm border border-gray-200 rounded-[4px] focus:outline-none focus:ring-2 focus:ring-[#6A3DB8]/30 focus:border-[#6A3DB8]";

  return (
    <div className="space-y-4">
      {/* PMC Search — existing customers only */}
      <PMCSearch label="Property Management Company" placeholder="Search existing Flex customers..." value={selectedPMC} onChange={setSelectedPMC} pmcNames={pmcNames} loading={pmcLoading} />

      {/* Total Portfolio Units */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">Total Portfolio Units</label>
        <input type="number" min={0} value={totalPortfolioUnits} onChange={(e) => setTotalPortfolioUnits(e.target.value)}
          placeholder="Full portfolio size from ALN/Salesforce"
          className={inputCls} />
        <p className="text-[10px] text-gray-400 mt-1">Includes properties not yet on Flex</p>
      </div>

      {/* Cross-PMC Properties (collapsed behind link) */}
      {!showCrossPMC ? (
        <button type="button" onClick={() => setShowCrossPMC(true)} className="text-xs text-[#6A3DB8] hover:underline">
          + Add cross-PMC properties
        </button>
      ) : (
        <div className="border border-gray-100 rounded-[4px] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-600">Cross-PMC Properties</span>
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
        <TestimonialsEditor testimonials={testimonials} onChange={setTestimonials} pmcName={selectedPMC} />
      </Section>

      {/* Toggles */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-gray-600">Review Period</label>
          <ToggleGroup options={[{ value: "full", label: "Full" }, { value: "quarter", label: "Quarter" }, { value: "ytd", label: "YTD" }]} value={reviewPeriod} onChange={setReviewPeriod} />
        </div>
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-gray-600">Compare deltas to</label>
          <ToggleGroup options={[{ value: "1", label: "1 mo" }, { value: "3", label: "3 mo" }, { value: "6", label: "6 mo" }, { value: "12", label: "12 mo" }]} value={String(comparisonMonths)} onChange={(v) => setComparisonMonths(parseInt(v))} />
        </div>
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-gray-600">Delivery</label>
          <ToggleGroup options={[{ value: "sharing", label: "Sharing" }, { value: "presenting", label: "Presenting" }]} value={delivery} onChange={setDelivery} />
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
