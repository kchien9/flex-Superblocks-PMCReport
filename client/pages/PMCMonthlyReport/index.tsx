import { useCallback, useRef, useMemo, useEffect } from "react";
import { useSessionState } from "@/hooks/useSessionState";
import { useApiData } from "@/hooks/useApiData.js";
import { useApi } from "@/hooks/useApi.js";
import { useUsageTracking } from "@/hooks/useUsageTracking";
import { QBRTab, type QBRFormState } from "./components/QBRTab.js";
import { NewLogoTab, type NewLogoFormState } from "./components/NewLogoTab.js";
import { ExpansionTab, type ExpansionFormState } from "./components/ExpansionTab.js";
import { ResultsPanel } from "./components/ResultsPanel.js";
import { wrapSlidesHtml } from "./utils/wrap-slides-html.js";

type TabId = "qbr" | "new_logo" | "expansion";

const TABS: { id: TabId; label: string }[] = [
  { id: "qbr", label: "QBR" },
  { id: "new_logo", label: "New Logo" },
  { id: "expansion", label: "Expansion" },
];

export default function PMCMonthlyReportPage() {
  const { track } = useUsageTracking("PMC Report", { trackPageView: true });

  const [activeTab, setActiveTab] = useSessionState<TabId>("pmcreport:activeTab", "qbr");
  const [delivery, setDelivery] = useSessionState<string>("pmcreport:delivery", "sharing");

  // ─── API Hooks ──────────────────────────────────────────────────────────────
  const { data: pmcData, loading: pmcLoading } = useApiData("GetPMCNames", {});
  const { run: generateReport, loading: generating, data: reportData, error: reportError } = useApi("GetPMCMonthlyReport");
  const { run: generateProspectDeck, loading: prospectGenerating, data: prospectData, error: prospectError } = useApi("GetProspectDeck");
  const lastArgsRef = useRef<Parameters<typeof generateReport>[0] | null>(null);
  const lastProspectArgsRef = useRef<Parameters<typeof generateProspectDeck>[0] | null>(null);

  // ─── Session-cached report outputs ─────────────────────────────────────────
  const [cachedReportData, setCachedReportData] = useSessionState<any>("pmcreport:reportData", null);
  const [cachedProspectData, setCachedProspectData] = useSessionState<any>("pmcreport:prospectData", null);

  // Sync fresh API results into session cache
  useEffect(() => {
    if (reportData) setCachedReportData(reportData);
  }, [reportData, setCachedReportData]);

  useEffect(() => {
    if (prospectData) setCachedProspectData(prospectData);
  }, [prospectData, setCachedProspectData]);

  // Use fresh data if available, otherwise fall back to cached
  const effectiveReportData = reportData ?? cachedReportData;
  const effectiveProspectData = prospectData ?? cachedProspectData;

  const pmcNames = pmcData?.pmcNames ?? [];

  // ─── Handlers ───────────────────────────────────────────────────────────────
  const handleQBRGenerate = useCallback(async (state: QBRFormState) => {
    setDelivery(state.delivery);
    const lookback = state.review_period === "quarter" ? 3 : state.review_period === "ytd" ? new Date().getMonth() + 1 : 12;
    const args = {
      pmc_name: state.pmc_name || state.ownership_report_name || "Custom Portfolio",
      second_pmc: state.second_pmc || "",
      report_name: state.report_name || "",
      lookback_months: lookback,
      deck_mode: "qbr" as const,
      adoption_target: state.adoption_target,
      testimonials: state.testimonials.map((t) => ({ name: t.name, propertyName: t.propertyName, quote: t.quote })),
      total_portfolio_units: 0,
      presenting_mode: state.delivery === "presenting",
      comparison_months: state.comparison_months ?? 1,
    };
    lastArgsRef.current = args;
    try {
      await generateReport(args);
      track("report_generated", { deck_mode: "qbr", pmc_name: args.pmc_name });
    } catch {
      // Error is in useApi state
    }
  }, [generateReport, track]);

  const handleNewLogoGenerate = useCallback(async (state: NewLogoFormState) => {
    setDelivery(state.delivery);
    // Map the form state to the GetProspectDeck input schema
    const units = parseInt(state.total_units) || 0;
    const stateVal = state.states.trim();
    const assetSubtypes: string[] = [];
    if (state.property_type && state.property_type !== "conventional") {
      assetSubtypes.push(state.property_type);
    }
    const args = {
      prospect_name: state.prospect_account,
      units,
      state: stateVal,
      pms: state.pms || null,
      segment: null as string | null,
      asset_subtypes: assetSubtypes.length > 0 ? assetSubtypes : null,
      avg_rent: state.avg_monthly_rent ? parseFloat(state.avg_monthly_rent) : null,
      footprint: state.portfolio_footprint !== "not_specified" ? state.portfolio_footprint : null,
      opp_stage: null as string | null,
      portfolio_type: state.portfolio_type === "multi_family" ? "Multi Family" : state.portfolio_type === "single_family" ? "Single Family" : null,
      testimonials: state.testimonials.length > 0
        ? state.testimonials.map((t) => ({ quote: t.quote, source: t.name || t.propertyName || undefined }))
        : null,
      property_list_csv: state.property_list_csv || null,
      property_list_filename: state.property_list_filename || null,
      prospect_slides: [...state.selected_slides],
      presenting_mode: state.delivery === "presenting",
    };
    lastProspectArgsRef.current = args;
    try {
      await generateProspectDeck(args);
      track("report_generated", { deck_mode: "new_logo", prospect: args.prospect_name });
    } catch {
      // Error is in useApi state
    }
  }, [generateProspectDeck, track]);

  const handleExpansionGenerate = useCallback(async (state: ExpansionFormState) => {
    setDelivery(state.delivery);
    const lookback = state.review_period === "quarter" ? 3 : state.review_period === "ytd" ? new Date().getMonth() + 1 : 12;
    const args = {
      pmc_name: state.pmc_name,
      second_pmc: "",
      report_name: "",
      lookback_months: lookback,
      deck_mode: "expansion" as const,
      adoption_target: 15,
      testimonials: state.testimonials.map((t) => ({ name: t.name, propertyName: t.propertyName, quote: t.quote })),
      total_portfolio_units: parseInt(state.total_portfolio_units) || 0,
      expansion_slides: [...state.selected_slides],
      presenting_mode: state.delivery === "presenting",
      comparison_months: state.comparison_months ?? 1,
    };
    lastArgsRef.current = args;
    try {
      await generateReport(args);
      track("report_generated", { deck_mode: "expansion", pmc_name: args.pmc_name });
    } catch {
      // Error is in useApi state
    }
  }, [generateReport, track]);

  const handleRetry = useCallback(async () => {
    if (activeTab === "new_logo" && lastProspectArgsRef.current) {
      try {
        await generateProspectDeck(lastProspectArgsRef.current);
      } catch {
        // Error is in useApi state
      }
    } else if (lastArgsRef.current) {
      try {
        await generateReport(lastArgsRef.current);
      } catch {
        // Error is in useApi state
      }
    }
  }, [activeTab, generateReport, generateProspectDeck]);

  const deckLabel = activeTab === "qbr" ? "report" : activeTab === "new_logo" ? "prospect deck" : "expansion deck";

  // Log geocode diagnostic to browser console for debugging
  useEffect(() => {
    if (effectiveProspectData?.geocode_diagnostic) {
      console.log("[GEOCODE DIAGNOSTIC]", JSON.stringify(effectiveProspectData.geocode_diagnostic, null, 2));
    }
  }, [effectiveProspectData]);

  // Normalize prospect deck response into ResultsPanel format
  const normalizedProspectData = useMemo(() => {
    if (!effectiveProspectData) return null;
    if (effectiveProspectData.error) return { html: "", empty: false, flags: [], emailDraft: effectiveProspectData.email_draft || "" };
    if (!effectiveProspectData.slides || effectiveProspectData.slides.length === 0) return { html: "", empty: true };
    const html = wrapSlidesHtml(effectiveProspectData.slides, {
      defaultHiddenSlides: effectiveProspectData.default_hidden_slides || [],
      pdfFilename: effectiveProspectData.slides.length > 0 ? "prospect_deck" : undefined,
    });
    // market_map_warning and geocode_diagnostic were both computed server-side but never
    // surfaced anywhere the user could actually see (market_map_warning wasn't read at all;
    // geocode_diagnostic only went to the browser console via the effect above) - reusing the
    // same flags[] mechanism QBR already uses for "Pre-meeting flags" so a bad property-list
    // upload (e.g. addresses that fail to geocode) is visible on the report itself instead of
    // silently producing a Market Map slide that just looks broken with no explanation.
    const flags: string[] = [];
    if (effectiveProspectData.market_map_warning) flags.push(effectiveProspectData.market_map_warning);
    const gd = effectiveProspectData.geocode_diagnostic;
    if (gd && gd.failed > 0) {
      const allFailed = gd.failed === gd.total;
      let msg = `${gd.failed} of ${gd.total} uploaded addresses could not be geocoded and won't appear as pins on the Market Map (property/unit counts are unaffected).`;
      if (allFailed) {
        msg += " Every address failed - check the upload's address format (needs a full street address, or Street/City/State/Zip columns).";
      }
      if (gd.errors && gd.errors.length > 0) {
        msg += ` First error: ${gd.errors[0]}`;
      }
      flags.push(msg);
    }
    return {
      html,
      empty: false,
      flags: flags.length > 0 ? flags : undefined,
      emailDraft: effectiveProspectData.email_draft || undefined,
      notes_html: effectiveProspectData.notes_html || undefined,
    };
  }, [effectiveProspectData]);

  // Pick the right data/error/generating state based on active tab
  const isGenerating = activeTab === "new_logo" ? prospectGenerating : generating;
  const currentReportData = activeTab === "new_logo" ? normalizedProspectData : effectiveReportData;
  const currentError = activeTab === "new_logo" ? (effectiveProspectData?.error || prospectError) : reportError;

  return (
    <div className="flex-1 flex flex-col overflow-y-auto bg-white">
      {/* ─── Top: Tabbed Customizer ──────────────────────────────────────── */}
      <div className="shrink-0 border-b border-gray-200">
        {/* Tab bar */}
        <div className="flex border-b border-gray-200">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-6 py-3 text-sm font-medium transition-colors relative ${
                activeTab === tab.id
                  ? "text-[#6A3DB8]"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.label}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#6A3DB8]" />
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-5 max-w-6xl">
          {activeTab === "qbr" && (
            <QBRTab pmcNames={pmcNames} pmcLoading={pmcLoading} generating={generating} onGenerate={handleQBRGenerate} />
          )}
          {activeTab === "new_logo" && (
            <NewLogoTab generating={generating} onGenerate={handleNewLogoGenerate} />
          )}
          {activeTab === "expansion" && (
            <ExpansionTab pmcNames={pmcNames} pmcLoading={pmcLoading} generating={generating} onGenerate={handleExpansionGenerate} />
          )}
        </div>
      </div>

    {/* ─── Below: Results (fills remaining space) ──────────────────────── */}
    {(isGenerating || currentReportData || !!currentError) && (
        <div className="min-h-[600px] flex flex-col">
          <ResultsPanel
            generating={isGenerating}
            reportData={currentReportData ?? null}
            delivery={delivery}
            deckLabel={deckLabel}
            error={currentError}
            onRetry={handleRetry}
          />
        </div>
      )}
    </div>
  );
}
