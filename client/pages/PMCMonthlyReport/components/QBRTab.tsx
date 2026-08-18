import { useState, useCallback } from "react";
import { Loader2, FileBarChart, ChevronDown, ChevronRight } from "lucide-react";
import { ToggleGroup } from "./ToggleGroup.js";
import { PMCSearch } from "./PMCSearch.js";
import { OwnershipGroupProperties } from "./OwnershipGroupProperties.js";
import { SlidesPicker, QBR_SLIDES, BENCHMARK_METRICS, defaultSlideSet } from "./SlidesPicker.js";
import { TestimonialsEditor, type Testimonial } from "./TestimonialsEditor.js";

function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-gray-100 pb-3">
      <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1.5 w-full text-left py-1">
        {open ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">{title}</span>
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

/** Always-visible section — same label styling as Section, no collapse. For fields used on
 * most builds (Slides, Testimonials, What's New) that shouldn't be buried behind a click. */
function StaticSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-gray-100 pb-3">
      <span className="block text-xs font-semibold uppercase tracking-wider text-gray-500 py-1">{title}</span>
      <div className="mt-2">{children}</div>
    </div>
  );
}

export interface QBRFormState {
  pmc_name: string;
  second_pmc: string;
  report_name: string;
  property_ids: string[];
  ownership_report_name: string;
  adoption_target: number;
  total_company_units: string;
  partner_since_override: string;
  review_period: string;
  delivery: string;
  terminology: string;
  d2c_marketing: string;
  comparison_months: number;
  selected_slides: Set<string>;
  selected_metrics: Set<string>;
  testimonials: Testimonial[];
  whats_new_text: string;
}

interface QBRTabProps {
  pmcNames: string[];
  pmcLoading: boolean;
  generating: boolean;
  onGenerate: (state: QBRFormState) => void;
}

export function QBRTab({ pmcNames, pmcLoading, generating, onGenerate }: QBRTabProps) {
  const [reportBasis, setReportBasis] = useState<"pmc" | "ownership">("pmc");
  const [selectedPMC, setSelectedPMC] = useState("");
  const [showSecondPMC, setShowSecondPMC] = useState(false);
  const [secondPMC, setSecondPMC] = useState("");
  const [reportName, setReportName] = useState("");
  const [showCrossPMC, setShowCrossPMC] = useState(false);
  const [propertyIds, setPropertyIds] = useState<string[]>([]);
  const [ownershipReportName, setOwnershipReportName] = useState("");
  const [totalCompanyUnits, setTotalCompanyUnits] = useState("");
  const [partnerSinceOverride, setPartnerSinceOverride] = useState("");
  const [reviewPeriod, setReviewPeriod] = useState("full");
  const [delivery, setDelivery] = useState("presenting");
  const [terminology, setTerminology] = useState("resident");
  const [d2cMarketing, setD2cMarketing] = useState("no");
  const [comparisonMonths, setComparisonMonths] = useState(3);
  const [whatsNewText, setWhatsNewText] = useState("");
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
  const [selectedSlides, setSelectedSlides] = useState<Set<string>>(() => defaultSlideSet(QBR_SLIDES));
  // Fixed — the picker for this was removed (server never reads it; the Peer Benchmarks slide
  // has its own inline toggle), but selected_metrics stays in the payload shape unchanged.
  const [selectedMetrics] = useState<Set<string>>(() => new Set(BENCHMARK_METRICS.map((m) => m.id)));

  const canGenerate = reportBasis === "pmc"
    ? !!selectedPMC || propertyIds.length > 0
    : propertyIds.length > 0;

  const handleGenerate = useCallback(() => {
    if (!canGenerate) return;
    onGenerate({
      pmc_name: reportBasis === "pmc" ? selectedPMC : "",
      second_pmc: reportBasis === "pmc" ? secondPMC : "",
      report_name: reportBasis === "pmc" ? reportName : ownershipReportName,
      property_ids: propertyIds,
      ownership_report_name: reportBasis === "ownership" ? ownershipReportName : "",
      adoption_target: 15,
      total_company_units: totalCompanyUnits,
      partner_since_override: partnerSinceOverride,
      review_period: reviewPeriod,
      delivery,
      terminology,
      d2c_marketing: d2cMarketing,
      comparison_months: comparisonMonths,
      selected_slides: selectedSlides,
      selected_metrics: selectedMetrics,
      testimonials,
      whats_new_text: whatsNewText,
    });
  }, [canGenerate, reportBasis, selectedPMC, secondPMC, reportName, propertyIds, ownershipReportName, totalCompanyUnits, partnerSinceOverride, reviewPeriod, delivery, terminology, d2cMarketing, comparisonMonths, selectedSlides, selectedMetrics, testimonials, whatsNewText, onGenerate]);

  const handleBasisChange = useCallback((v: string) => {
    setReportBasis(v as "pmc" | "ownership");
    // Clear PMC fields when switching to ownership mode
    if (v === "ownership") {
      setSelectedPMC("");
      setSecondPMC("");
      setShowSecondPMC(false);
      setReportName("");
    }
  }, []);

  const inputCls = "w-full px-3 py-2 text-sm border border-gray-200 rounded-[4px] focus:outline-none focus:ring-2 focus:ring-[#6A3DB8]/30 focus:border-[#6A3DB8]";

  return (
    <div className="space-y-4">
      {/* Report Basis Toggle */}
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-gray-600">Report Basis</label>
        <ToggleGroup
          options={[
            { value: "pmc", label: "PMC" },
            { value: "ownership", label: "Ownership Group" },
          ]}
          value={reportBasis}
          onChange={handleBasisChange}
        />
      </div>

      {/* PMC Mode */}
      {reportBasis === "pmc" && (
        <>
          {/* PMC Search — required */}
          <div>
            <PMCSearch label="PMC" placeholder="Search for a PMC..." value={selectedPMC} onChange={setSelectedPMC} pmcNames={pmcNames} loading={pmcLoading} />
            <p className="text-[10px] text-red-500 mt-0.5 font-medium">* Required</p>
          </div>

          {/* Second PMC */}
          {!showSecondPMC ? (
            <button type="button" onClick={() => setShowSecondPMC(true)} className="text-xs text-[#6A3DB8] hover:underline">
              + Add Second PMC
            </button>
          ) : (
            <div className="relative">
              <PMCSearch label="Second PMC" placeholder="Combine with another PMC record..." value={secondPMC} onChange={setSecondPMC} pmcNames={pmcNames} loading={pmcLoading} optional />
              {!secondPMC && (
                <button type="button" onClick={() => setShowSecondPMC(false)} className="absolute top-0 right-0 text-[10px] text-gray-400 hover:text-gray-600">cancel</button>
              )}
            </div>
          )}

          {/* Cross-PMC Properties (collapsed link) */}
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
              <OwnershipGroupProperties propertyIds={propertyIds} onPropertyIdsChange={setPropertyIds} reportName="" onReportNameChange={() => {}} hasPmcSelected={!!selectedPMC} />
            </div>
          )}
        </>
      )}

      {/* Ownership Group Mode */}
      {reportBasis === "ownership" && (
        <>
          <OwnershipGroupProperties propertyIds={propertyIds} onPropertyIdsChange={setPropertyIds} reportName={ownershipReportName} onReportNameChange={setOwnershipReportName} hasPmcSelected={false} />
          {/* Always show Report Name in ownership mode */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Report Name (deck cover label)</label>
            <input type="text" value={ownershipReportName} onChange={(e) => setOwnershipReportName(e.target.value)} placeholder="e.g. Avenue5 Ownership Group"
              className={inputCls} />
          </div>
        </>
      )}

      {/* Toggles */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-gray-600">Review Period</label>
          <ToggleGroup options={[{ value: "full", label: "Full" }, { value: "quarter", label: "Quarter" }, { value: "ytd", label: "YTD" }]} value={reviewPeriod} onChange={setReviewPeriod} />
        </div>
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-gray-600">Delivery</label>
          <ToggleGroup options={[{ value: "sharing", label: "Sharing" }, { value: "presenting", label: "Presenting" }]} value={delivery} onChange={setDelivery} />
        </div>
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-gray-600">Terminology</label>
          <ToggleGroup options={[{ value: "resident", label: "Resident" }, { value: "household", label: "Household" }]} value={terminology} onChange={setTerminology} />
        </div>
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-gray-600">Include D2C Marketing Language</label>
          <ToggleGroup options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} value={d2cMarketing} onChange={setD2cMarketing} />
        </div>
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-gray-600">Compare deltas to</label>
          <ToggleGroup options={[{ value: "1", label: "1 mo" }, { value: "3", label: "3 mo" }, { value: "6", label: "6 mo" }, { value: "12", label: "12 mo" }]} value={String(comparisonMonths)} onChange={(v) => setComparisonMonths(parseInt(v))} />
        </div>
      </div>

      {/* Slides Picker */}
      <StaticSection title="Slides">
        <SlidesPicker
          slides={QBR_SLIDES}
          selectedSlides={selectedSlides}
          onSlidesChange={setSelectedSlides}
          infoItems={[
            { label: "Adoption Ceiling", text: "May not appear even when selected — auto-skipped if partner already markets to residents, peer set is too thin (<5), or they already beat P75." },
            { label: "Delinquency", text: "off by default; framing is being reconsidered for partner sensitivity." },
          ]}
        />
      </StaticSection>

      {/* Customer Testimonials */}
      <StaticSection title="Customer Testimonials">
        <TestimonialsEditor
          testimonials={testimonials}
          onChange={setTestimonials}
          pmcName={reportBasis === "pmc" ? selectedPMC : ""}
          secondPmcName={reportBasis === "pmc" ? secondPMC : ""}
        />
      </StaticSection>

      {/* What's New at Flex */}
      <StaticSection title="What's New at Flex">
        <textarea value={whatsNewText} onChange={(e) => setWhatsNewText(e.target.value)} placeholder="Rough bullets — AI polishes into partner-facing copy" rows={3}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-[4px] focus:outline-none focus:ring-2 focus:ring-[#6A3DB8]/30 focus:border-[#6A3DB8] resize-y" />
        <label className="flex items-center gap-2 mt-2 px-3 py-2 text-xs text-[#6A3DB8] border border-[#6A3DB8]/30 rounded-[4px] cursor-pointer hover:bg-[#EEE2FC] transition-colors w-fit">
          Attach image
          <input type="file" accept="image/*" className="hidden" />
        </label>
      </StaticSection>

      {/* Overrides — edge-case fields most builds don't need */}
      <Section title="Overrides">
        <div className="space-y-3">
          {reportBasis === "pmc" && (
            <div>
              <div className="flex items-baseline gap-2 mb-1.5">
                <label className="block text-xs font-medium text-gray-600">Report Name</label>
                <span className="text-[10px] text-gray-400">optional</span>
              </div>
              <input type="text" value={reportName} onChange={(e) => setReportName(e.target.value)} placeholder="Override the PMC name on the deck"
                className={inputCls} />
            </div>
          )}
          <div>
            <div className="flex items-baseline gap-1 mb-1.5">
              <label className="block text-xs font-medium text-gray-600">Total Company Units</label>
              <span className="text-[10px] text-gray-400">optional</span>
            </div>
            <input type="number" min={0} value={totalCompanyUnits} onChange={(e) => setTotalCompanyUnits(e.target.value)} placeholder="—"
              className={inputCls} />
          </div>
          <div>
            <div className="flex items-baseline gap-2 mb-1.5">
              <label className="block text-xs font-medium text-gray-600">Partner Since Override</label>
              <span className="text-[10px] text-gray-400">optional</span>
            </div>
            <input type="month" value={partnerSinceOverride} onChange={(e) => setPartnerSinceOverride(e.target.value)}
              className={inputCls} />
          </div>
        </div>
      </Section>

      {/* Generate */}
      <div className="pt-2">
        <button onClick={handleGenerate} disabled={!canGenerate || generating}
          className="w-full px-5 py-3 text-sm font-semibold text-white rounded-[4px] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          style={{ backgroundColor: !canGenerate || generating ? "#9CA3AF" : "#6A3DB8" }}>
          {generating ? <><Loader2 className="h-4 w-4 animate-spin" />Generating...</> : <><FileBarChart className="h-4 w-4" />Generate Report</>}
        </button>
      </div>
    </div>
  );
}
