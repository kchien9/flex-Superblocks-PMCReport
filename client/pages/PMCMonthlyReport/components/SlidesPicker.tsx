import { useState, useCallback } from "react";

export interface SlideOption {
  id: string;
  label: string;
  defaultOn: boolean;
}

/** All selectable QBR slides in SLIDE_ORDER (matches ALL_SLIDES in source) */
export const QBR_SLIDES: SlideOption[] = [
  { id: "cover", label: "Cover", defaultOn: true },
  { id: "exec_summary", label: "Exec Summary", defaultOn: true },
  { id: "peer_benchmarks", label: "Peer Benchmarks", defaultOn: true },
  { id: "properties_celebrating", label: "Properties Worth Celebrating", defaultOn: false },
  { id: "adoption_opportunities", label: "Adoption Opportunities", defaultOn: false },
  { id: "properties_offline", label: "Properties Offline", defaultOn: false },
  { id: "residents_units", label: "Residents, Units & Rent", defaultOn: true },
  { id: "adoption_trend", label: "Adoption Trend", defaultOn: true },
  { id: "d2c_split", label: "D2C Marketing Split", defaultOn: false },
  { id: "high_rent", label: "Flex For Everyone", defaultOn: true },
  { id: "by_state", label: "By State", defaultOn: true },
  { id: "retention", label: "Retention", defaultOn: false },
  { id: "delinquency", label: "Delinquency", defaultOn: false },
  { id: "rethinking_rent", label: "Rethinking Rent", defaultOn: true },
  { id: "portfolio_projection", label: "Portfolio Projection", defaultOn: true },
  { id: "integration_gap", label: "Integration Gap", defaultOn: false },
  { id: "customer_experience", label: "Customer Experience", defaultOn: false },
  { id: "adoption_ceiling", label: "Adoption Ceiling", defaultOn: false },
  { id: "cohort_overview", label: "Cohort Overview", defaultOn: true },
  { id: "full_property_table", label: "Full Property Table", defaultOn: true },
  { id: "since_inception", label: "Bills & Rent Since Inception", defaultOn: false },
];

export const NEW_LOGO_SLIDES: SlideOption[] = [
  { id: "cover", label: "Cover", defaultOn: true },
  { id: "peer_perf", label: "Peer Proof / Benchmarks", defaultOn: true },
  { id: "peer_retention", label: "Peer Retention", defaultOn: true },
  { id: "high_rent", label: "Flex For Everyone", defaultOn: true },
  { id: "metrosight", label: "MetroSight Research", defaultOn: true },
  { id: "ramp", label: "Ramp Curve", defaultOn: true },
  { id: "market_map", label: "Market Map", defaultOn: true },
  { id: "testimonials", label: "Testimonials", defaultOn: true },
  { id: "close", label: "Closing Slide", defaultOn: true },
];

export const EXPANSION_SLIDES: SlideOption[] = [
  { id: "cover", label: "Cover", defaultOn: true },
  { id: "exec_bottom_line", label: "Executive Bottom Line", defaultOn: true },
  { id: "by_state", label: "By State", defaultOn: true },
  { id: "residents_units", label: "Residents, Units & Rent", defaultOn: true },
  { id: "adoption_trend", label: "Adoption Trend", defaultOn: true },
  { id: "cohort_overview", label: "Cohort Overview", defaultOn: true },
  { id: "peer_benchmarks", label: "Peer Benchmarks", defaultOn: true },
  { id: "retention", label: "Retention", defaultOn: true },
  { id: "high_rent", label: "Flex For Everyone", defaultOn: true },
  { id: "delinquency", label: "Delinquency", defaultOn: true },
  { id: "expansion_metrosight", label: "MetroSight", defaultOn: true },
  { id: "expansion_gap", label: "Portfolio Gap", defaultOn: true },
  { id: "testimonials", label: "Testimonials", defaultOn: true },
  { id: "expansion_case_close", label: "Case for Expanding", defaultOn: true },
];

export const BENCHMARK_METRICS: SlideOption[] = [
  { id: "engagement", label: "Engagement", defaultOn: true },
  { id: "d2c", label: "D2C", defaultOn: true },
  { id: "retention", label: "Retention", defaultOn: true },
  { id: "penetration", label: "Penetration", defaultOn: true },
];

interface SlidesPickerProps {
  slides: SlideOption[];
  selectedSlides: Set<string>;
  onSlidesChange: (slides: Set<string>) => void;
  /** Optional benchmark metrics section */
  showMetrics?: boolean;
  selectedMetrics?: Set<string>;
  onMetricsChange?: (metrics: Set<string>) => void;
  /** Info box content */
  infoItems?: { label: string; text: string }[];
}

export function SlidesPicker({
  slides,
  selectedSlides,
  onSlidesChange,
  showMetrics = false,
  selectedMetrics,
  onMetricsChange,
  infoItems,
}: SlidesPickerProps) {
  const [expanded, setExpanded] = useState(false);

  const selectedCount = selectedSlides.size;
  const totalCount = slides.length;

  const toggleSlide = useCallback((id: string) => {
    const next = new Set(selectedSlides);
    if (next.has(id)) next.delete(id); else next.add(id);
    onSlidesChange(next);
  }, [selectedSlides, onSlidesChange]);

  const toggleMetric = useCallback((id: string) => {
    if (!selectedMetrics || !onMetricsChange) return;
    const next = new Set(selectedMetrics);
    if (next.has(id)) next.delete(id); else next.add(id);
    onMetricsChange(next);
  }, [selectedMetrics, onMetricsChange]);

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
        <button type="button" onClick={() => setExpanded(!expanded)} className="text-xs text-[#6A3DB8] hover:underline font-medium">
          {expanded ? "collapse" : "customize"}
        </button>
        <button type="button" onClick={selectAll} className="text-xs text-[#6A3DB8] hover:underline">all</button>
        <button type="button" onClick={selectNone} className="text-xs text-[#6A3DB8] hover:underline">none</button>
      </div>

      {/* Expanded chip grid */}
      {expanded && (
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

          {/* Benchmark Metrics sub-section */}
          {showMetrics && selectedMetrics && onMetricsChange && selectedSlides.has("peer_benchmarks") && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2">
                Benchmark Metrics
              </div>
              <div className="flex flex-wrap gap-2">
                {BENCHMARK_METRICS.map((metric) => {
                  const active = selectedMetrics.has(metric.id);
                  return (
                    <button
                      key={metric.id}
                      type="button"
                      onClick={() => toggleMetric(metric.id)}
                      className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                        active
                          ? "bg-[#2C194D] text-white border-[#2C194D]"
                          : "bg-white text-gray-500 border-gray-200 hover:border-[#2C194D]/40"
                      }`}
                    >
                      {metric.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Info box */}
          {infoItems && infoItems.length > 0 && (
            <div className="p-3 bg-gray-50 border border-gray-100 rounded-[4px] text-[11px] text-gray-500 leading-relaxed space-y-1">
              {infoItems.map((item, i) => (
                <p key={i}><strong>{item.label}</strong> — {item.text}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Helper: initialize selected slides from defaults */
export function defaultSlideSet(slides: SlideOption[]): Set<string> {
  return new Set(slides.filter((s) => s.defaultOn).map((s) => s.id));
}
