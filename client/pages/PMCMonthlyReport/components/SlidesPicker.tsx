import { useState, useCallback } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export interface SlideOption {
  id: string;
  label: string;
  defaultOn: boolean;
  // One plain, short phrase for an AE deciding whether to keep this slide - not a spec.
  // Kevin's catch: the first draft read like documentation. Reps skim, they don't read
  // paragraphs, so no jargon (no "true repeat rate," no P25/P50/P75).
  description: string;
}

/** All selectable QBR slides in SLIDE_ORDER (matches ALL_SLIDES in source). All default on —
 * this used to preselect only 11 of 21, silently leaving 10 real slides out of every report
 * unless someone happened to notice and hand-pick them. Auto-skip logic inside each renderer
 * (e.g. Adoption Ceiling's peer-set/already-beats-P75 checks) still applies regardless of
 * selection, so turning a slide on here doesn't force it to render if it has nothing to show. */
export const QBR_SLIDES: SlideOption[] = [
  { id: "cover", label: "Cover", defaultOn: true, description: "Title slide with partner name and dates." },
  { id: "exec_summary", label: "Exec Summary", defaultOn: true, description: "The big numbers at a glance." },
  { id: "peer_benchmarks", label: "Peer Benchmarks", defaultOn: true, description: "How they stack up against similar PMCs." },
  { id: "properties_celebrating", label: "Properties Worth Celebrating", defaultOn: true, description: "Your best-performing properties." },
  { id: "adoption_opportunities", label: "Adoption Opportunities", defaultOn: true, description: "Properties with the most room to grow." },
  { id: "properties_offline", label: "Properties Offline", defaultOn: true, description: "Properties that left the network this period." },
  { id: "residents_units", label: "Residents, Units & Rent", defaultOn: true, description: "Residents, units, and rent collected over time." },
  { id: "adoption_trend", label: "Adoption Trend", defaultOn: true, description: "Adoption rate over time, vs. similar PMCs." },
  { id: "d2c_split", label: "D2C Marketing Split", defaultOn: true, description: "How many properties have Flex marketing turned on." },
  { id: "high_rent", label: "Flex For Everyone", defaultOn: true, description: "Proof that even higher-rent residents use Flex." },
  { id: "by_state", label: "By State", defaultOn: true, description: "Adoption broken out by state." },
  { id: "retention", label: "Retention", defaultOn: true, description: "How many residents keep coming back." },
  { id: "delinquency", label: "Delinquency", defaultOn: true, description: "Rent Flex covered when residents fell behind." },
  { id: "rethinking_rent", label: "Rethinking Rent", defaultOn: true, description: "Outside research backing up why flexible rent works." },
  { id: "portfolio_projection", label: "Portfolio Projection", defaultOn: true, description: "What hitting a realistic adoption goal is worth in dollars." },
  { id: "integration_gap", label: "Integration Gap", defaultOn: true, description: "Where the tech setup is holding adoption back." },
  { id: "customer_experience", label: "Customer Experience", defaultOn: true, description: "What residents are saying, straight from support." },
  { id: "adoption_ceiling", label: "Adoption Ceiling", defaultOn: true, description: "How close they are to their realistic max." },
  { id: "cohort_overview", label: "Cohort Overview", defaultOn: true, description: "How each group of properties has grown since going live." },
  { id: "full_property_table", label: "Full Property Table", defaultOn: true, description: "Every property, every number. Reference only." },
  { id: "since_inception", label: "Bills & Rent Since Inception", defaultOn: true, description: "The whole relationship, year by year." },
];

export const NEW_LOGO_SLIDES: SlideOption[] = [
  { id: "cover", label: "Cover", defaultOn: true, description: "Title slide for the prospect." },
  { id: "peer_perf", label: "Peer Proof / Benchmarks", defaultOn: true, description: "Real numbers from similar PMCs already using Flex, kept anonymous." },
  { id: "peer_retention", label: "Peer Retention", defaultOn: true, description: "Proof that once residents try Flex, they stick with it." },
  { id: "high_rent", label: "Flex For Everyone", defaultOn: true, description: "Same \"works for every rent level\" slide." },
  { id: "metrosight", label: "MetroSight Research", defaultOn: true, description: "Outside research backing the pitch." },
  { id: "ramp", label: "Ramp Curve", defaultOn: true, description: "How fast similar PMCs saw adoption take off." },
  { id: "market_map", label: "Market Map", defaultOn: true, description: "Their own properties on a map, if they gave us a list." },
  { id: "testimonials", label: "Testimonials", defaultOn: true, description: "Real quotes, kept anonymous." },
  { id: "close", label: "Closing Slide", defaultOn: true, description: "What signing up actually looks like, step by step." },
];

// Order matches EXPANSION_SLIDE_ORDER below (deck render order) so the chips read top-to-bottom
// the same way the deck plays out — reordered 2026-08-19 alongside that change.
export const EXPANSION_SLIDES: SlideOption[] = [
  { id: "cover", label: "Cover", defaultOn: true, description: "Title slide with total units and units already live." },
  { id: "exec_bottom_line", label: "Executive Bottom Line", defaultOn: true, description: "The big numbers, framed to build the case for expanding." },
  { id: "residents_units", label: "Residents, Units & Rent", defaultOn: true, description: "Residents, units, and rent collected over time." },
  { id: "adoption_trend", label: "Adoption Trend", defaultOn: true, description: "Same chart as QBR — only shows the peer comparison when they're winning it." },
  { id: "cohort_overview", label: "Cohort Overview", defaultOn: true, description: "How each group of properties has grown since going live." },
  { id: "by_state", label: "By State", defaultOn: true, description: "Adoption broken out by state." },
  { id: "retention", label: "Retention", defaultOn: true, description: "How many residents keep coming back." },
  { id: "high_rent", label: "Flex For Everyone", defaultOn: true, description: "Proof that even higher-rent residents use Flex." },
  { id: "delinquency", label: "Delinquency", defaultOn: true, description: "Rent Flex covered when residents fell behind." },
  { id: "expansion_metrosight", label: "MetroSight", defaultOn: true, description: "Same outside research as QBR." },
  { id: "expansion_gap", label: "Portfolio Gap", defaultOn: true, description: "What the rest of the portfolio is worth once it's live." },
  { id: "testimonials", label: "Testimonials", defaultOn: true, description: "Real quotes, kept anonymous." },
  { id: "expansion_case_close", label: "Case for Expanding", defaultOn: true, description: "The closing ask: roll out the rest." },
];

// Never rendered via SlidesPicker's own description list (this array is never passed as its
// `slides` prop — see the comment at its two usages) - descriptions here are just to satisfy
// the shared SlideOption type.
export const BENCHMARK_METRICS: SlideOption[] = [
  { id: "engagement", label: "Engagement", defaultOn: true, description: "" },
  { id: "d2c", label: "D2C", defaultOn: true, description: "" },
  { id: "retention", label: "Retention", defaultOn: true, description: "" },
  { id: "penetration", label: "Penetration", defaultOn: true, description: "" },
];

interface SlidesPickerProps {
  slides: SlideOption[];
  selectedSlides: Set<string>;
  onSlidesChange: (slides: Set<string>) => void;
  /** Info box content */
  infoItems?: { label: string; text: string }[];
}

// Always shows the full chip grid now — this used to be hidden behind a "customize" click
// (collapsed by default), which meant the actual slide selection was invisible on load. The
// benchmark-metrics sub-section that used to live here was removed too: the server never reads
// it (grep confirmed zero references anywhere in server/), and the Peer Benchmarks slide itself
// already has its own inline metric toggle, so the picker here was fully decorative.
export function SlidesPicker({
  slides,
  selectedSlides,
  onSlidesChange,
  infoItems,
}: SlidesPickerProps) {
  const selectedCount = selectedSlides.size;
  const totalCount = slides.length;
  // Collapsed by default (Kevin's ask) — this is a lookup an AE dips into occasionally, not
  // something that should push the rest of the form down every time.
  const [descriptionsOpen, setDescriptionsOpen] = useState(false);

  const toggleSlide = useCallback((id: string) => {
    const next = new Set(selectedSlides);
    if (next.has(id)) next.delete(id); else next.add(id);
    onSlidesChange(next);
  }, [selectedSlides, onSlidesChange]);

  const selectAll = useCallback(() => {
    onSlidesChange(new Set(slides.map((s) => s.id)));
  }, [slides, onSlidesChange]);

  const selectNone = useCallback(() => {
    onSlidesChange(new Set());
  }, [onSlidesChange]);

  return (
    <div>
      {/* Summary row */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-700 font-medium">
          {selectedCount} of {totalCount} selected
        </span>
        <button type="button" onClick={selectAll} className="text-xs text-[#6A3DB8] hover:underline">all</button>
        <button type="button" onClick={selectNone} className="text-xs text-[#6A3DB8] hover:underline">none</button>
      </div>

      {/* Chip grid */}
      <div className="mt-3 space-y-4">
        <div className="flex flex-wrap gap-2">
          {slides.map((slide) => {
            const active = selectedSlides.has(slide.id);
            return (
              <button
                key={slide.id}
                type="button"
                onClick={() => toggleSlide(slide.id)}
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                  active
                    ? "bg-[#6A3DB8] text-white border-[#6A3DB8]"
                    : "bg-white text-gray-500 border-gray-200 hover:border-[#6A3DB8]/40"
                }`}
              >
                {slide.label}
              </button>
            );
          })}
        </div>

        {/* What each slide shows — collapsed lookup, separate from the gotcha infoItems below */}
        <div>
          <button
            type="button"
            onClick={() => setDescriptionsOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-[#6A3DB8] hover:underline"
          >
            {descriptionsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            What each slide shows
          </button>
          {descriptionsOpen && (
            <div className="mt-2 p-3 bg-gray-50 border border-gray-100 rounded-[4px] text-[11px] text-gray-500 leading-relaxed space-y-1">
              {slides.map((slide) => (
                <p key={slide.id}><strong>{slide.label}</strong> — {slide.description}</p>
              ))}
            </div>
          )}
        </div>

        {/* Info box */}
        {infoItems && infoItems.length > 0 && (
          <div className="p-3 bg-gray-50 border border-gray-100 rounded-[4px] text-[11px] text-gray-500 leading-relaxed space-y-1">
            {infoItems.map((item, i) => (
              <p key={i}><strong>{item.label}</strong> — {item.text}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Helper: initialize selected slides from defaults */
export function defaultSlideSet(slides: SlideOption[]): Set<string> {
  return new Set(slides.filter((s) => s.defaultOn).map((s) => s.id));
}
