import { useState, useCallback } from "react";
import { Loader2, FileBarChart, ChevronDown, ChevronRight } from "lucide-react";
import { ToggleGroup } from "./ToggleGroup.js";
import { PMCSearch } from "./PMCSearch.js";
import { OwnershipGroupProperties } from "./OwnershipGroupProperties.js";
import { SlidesPicker, QBR_SLIDES, BENCHMARK_METRICS, defaultSlideSet } from "./SlidesPicker.js";
import { TestimonialsEditor, type Testimonial } from "./TestimonialsEditor.js";

// ── Import from an uploaded PDF (e.g. exported from Slides via File > Download > PDF) ──
// Runs entirely client-side, no Google auth, no OAuth Client ID needed - mirrors Flask's
// templates/index.html PDF-upload path exactly, minus the Google-Slides-link picker (Kevin's
// call: PDF upload is the move over chasing the OAuth Client ID setup) and minus anchoring
// after a specific slide (see ImportedSlide's comment below for why). Loaded via a runtime
// <script> tag, not an npm dependency - same reasoning Flask's build documents: this avoids
// depending on whatever this app's actual build/deploy pipeline allows adding, matching the
// "arbitrary npm packages aren't reliably available" precedent already established for
// market-map-data.ts's xlsx handling (that one was server-side; this sidesteps needing to
// find out whether the same is true client-side by just not needing to ask the question).
const PDFJS_VERSION = "3.11.174";
let pdfJsLoadPromise: Promise<void> | null = null;
function ensurePdfJsLoaded(): Promise<void> {
  const w = window as unknown as { pdfjsLib?: { GlobalWorkerOptions: { workerSrc: string } } };
  if (w.pdfjsLib) return Promise.resolve();
  if (pdfJsLoadPromise) return pdfJsLoadPromise;
  pdfJsLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.js`;
    script.onload = () => {
      const lib = (window as unknown as { pdfjsLib: { GlobalWorkerOptions: { workerSrc: string } } }).pdfjsLib;
      lib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js`;
      resolve();
    };
    script.onerror = () => reject(new Error("Failed to load pdf.js"));
    document.head.appendChild(script);
  });
  return pdfJsLoadPromise;
}

function blobToBase64(blob: Blob, mimeFallback: string): Promise<{ data: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const parts = (reader.result as string).split(",");
      resolve({ data: parts[1] || "", mime: blob.type || mimeFallback });
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export interface ImportedSlide {
  anchor: "start" | "end";
  image_b64: string;
  image_mime: string;
  source_title: string;
  deck_title: string;
}

interface PdfPageItem {
  key: string;
  data: string;
  mime: string;
  label: string;
  checked: boolean;
  anchor: "start" | "end";
}

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
  hidden_kpi_tiles: string[];
  show_adoption_portfolio_avg: boolean;
  show_adoption_peer_median: boolean;
  show_engagement_observed: boolean;
  show_engagement_portfolio_avg: boolean;
  show_engagement_peer_median: boolean;
  imported_slides: ImportedSlide[];
}

/** Exec-summary KPI tile keys — must match get-pmc-monthly-report.ts's hiddenTileSet checks.
 * Not exported — react-refresh/only-export-components flags a non-component export from a
 * component file, and nothing outside this file needs this list. */
const KPI_TILES: { id: string; label: string }[] = [
  { id: "active_properties", label: "Active properties" },
  { id: "residents_paying", label: "Residents paying" },
  { id: "new_residents", label: "New residents paying this month" },
  { id: "adoption_rate", label: "Adoption rate" },
  { id: "true_repeat_rate", label: "True repeat rate" },
  { id: "delinquency_shielded", label: "Delinquency shielded" },
];

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
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
  const [selectedSlides, setSelectedSlides] = useState<Set<string>>(() => defaultSlideSet(QBR_SLIDES));
  // Fixed — the picker for this was removed (server never reads it; the Peer Benchmarks slide
  // has its own inline toggle), but selected_metrics stays in the payload shape unchanged.
  const [selectedMetrics] = useState<Set<string>>(() => new Set(BENCHMARK_METRICS.map((m) => m.id)));
  // Which exec-summary KPI tiles to omit (Kevin's ask) — empty means show all 6.
  const [hiddenKpiTiles, setHiddenKpiTiles] = useState<Set<string>>(() => new Set());
  // Property Deep Dive benchmark columns (Kevin's ask) — full per-column control, all on by
  // default. Applies to both the celebrating and needs-attention tables.
  const [showAdoptionPortfolioAvg, setShowAdoptionPortfolioAvg] = useState(true);
  const [showAdoptionPeerMedian, setShowAdoptionPeerMedian] = useState(true);
  const [showEngagementObserved, setShowEngagementObserved] = useState(true);
  const [showEngagementPortfolioAvg, setShowEngagementPortfolioAvg] = useState(true);
  const [showEngagementPeerMedian, setShowEngagementPeerMedian] = useState(true);
  // Import Slides (PDF upload, Kevin's ask) — pages render client-side via pdf.js, no OAuth.
  const [pdfDeckTitle, setPdfDeckTitle] = useState("");
  const [pdfPages, setPdfPages] = useState<PdfPageItem[]>([]);
  const [pdfStatus, setPdfStatus] = useState("");

  const toggleKpiTile = useCallback((id: string) => {
    setHiddenKpiTiles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handlePdfFile = useCallback(async (file: File) => {
    setPdfStatus("Reading PDF…");
    setPdfPages([]);
    const deckTitle = file.name.replace(/\.pdf$/i, "");
    setPdfDeckTitle(deckTitle);
    try {
      await ensurePdfJsLoaded();
      const pdfjsLib = (window as unknown as { pdfjsLib: any }).pdfjsLib;
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const pages: PdfPageItem[] = [];
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        setPdfStatus(`Rendering page ${pageNum} of ${pdf.numPages}…`);
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 2 }); // sharp enough for a full-bleed slide
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        await page.render({ canvasContext: ctx, viewport }).promise;
        const { data, mime } = await new Promise<{ data: string; mime: string }>((resolve, reject) => {
          canvas.toBlob((blob) => {
            if (!blob) { reject(new Error("page render produced no image")); return; }
            blobToBase64(blob, "image/png").then(resolve);
          }, "image/png");
        });
        pages.push({ key: `pdfpage-${pageNum}`, data, mime, label: `Page ${pageNum}`, checked: false, anchor: "end" });
      }
      setPdfPages(pages);
      setPdfStatus(`Loaded "${deckTitle}" — ${pages.length} page(s). Check the ones to include and choose where each one goes.`);
    } catch (e) {
      setPdfStatus(`Couldn't read that PDF: ${(e as Error).message}`);
    }
  }, []);

  const togglePdfPage = useCallback((key: string) => {
    setPdfPages((prev) => prev.map((p) => (p.key === key ? { ...p, checked: !p.checked } : p)));
  }, []);

  const setPdfPageAnchor = useCallback((key: string, anchor: "start" | "end") => {
    setPdfPages((prev) => prev.map((p) => (p.key === key ? { ...p, anchor } : p)));
  }, []);

  const importedSlides: ImportedSlide[] = pdfPages
    .filter((p) => p.checked)
    .map((p) => ({ anchor: p.anchor, image_b64: p.data, image_mime: p.mime, source_title: p.label, deck_title: pdfDeckTitle }));

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
      hidden_kpi_tiles: Array.from(hiddenKpiTiles),
      show_adoption_portfolio_avg: showAdoptionPortfolioAvg,
      show_adoption_peer_median: showAdoptionPeerMedian,
      show_engagement_observed: showEngagementObserved,
      show_engagement_portfolio_avg: showEngagementPortfolioAvg,
      show_engagement_peer_median: showEngagementPeerMedian,
      imported_slides: importedSlides,
    });
  }, [canGenerate, reportBasis, selectedPMC, secondPMC, reportName, propertyIds, ownershipReportName, totalCompanyUnits, partnerSinceOverride, reviewPeriod, delivery, terminology, d2cMarketing, comparisonMonths, selectedSlides, selectedMetrics, testimonials, hiddenKpiTiles, showAdoptionPortfolioAvg, showAdoptionPeerMedian, showEngagementObserved, showEngagementPortfolioAvg, showEngagementPeerMedian, importedSlides, onGenerate]);

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
        <label className="text-sm font-medium text-gray-700">Report Basis</label>
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
                <span className="text-sm font-medium text-gray-700">Cross-PMC Properties</span>
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
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Report Name (deck cover label)</label>
            <input type="text" value={ownershipReportName} onChange={(e) => setOwnershipReportName(e.target.value)} placeholder="e.g. Avenue5 Ownership Group"
              className={inputCls} />
          </div>
        </>
      )}

      {/* Toggles */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700">Review Period</label>
          <ToggleGroup options={[{ value: "full", label: "Full" }, { value: "quarter", label: "Quarter" }, { value: "ytd", label: "YTD" }]} value={reviewPeriod} onChange={setReviewPeriod} />
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
            <label className="text-sm font-medium text-gray-700">Terminology</label>
            <ToggleGroup options={[{ value: "resident", label: "Resident" }, { value: "household", label: "Household" }]} value={terminology} onChange={setTerminology} />
          </div>
          <p className="text-[11px] text-gray-400 mt-1">Do you want to refer to paying users as "residents" or "households"?</p>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">Include D2C Marketing Language</label>
            <ToggleGroup options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} value={d2cMarketing} onChange={setD2cMarketing} />
          </div>
          <p className="text-[11px] text-gray-400 mt-1">Should the deck include references to their D2C-enabled properties?</p>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">Compare deltas to</label>
            <ToggleGroup options={[{ value: "1", label: "1 mo" }, { value: "3", label: "3 mo" }, { value: "6", label: "6 mo" }, { value: "12", label: "12 mo" }]} value={String(comparisonMonths)} onChange={(v) => setComparisonMonths(parseInt(v))} />
          </div>
          <p className="text-[11px] text-gray-400 mt-1">The slide computes changes vs. historical metrics — what time frame do you want to compare against?</p>
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

      {/* KPI tiles + Property Deep Dive benchmark columns */}
      <Section title="KPI Tiles & Benchmark Columns">
        <div className="mb-3">
          <p className="text-[11px] text-gray-400 mb-1.5">Uncheck any Executive Summary tile to leave it off the deck.</p>
          <div className="grid grid-cols-2 gap-1.5">
            {KPI_TILES.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                <input type="checkbox" checked={!hiddenKpiTiles.has(t.id)} onChange={() => toggleKpiTile(t.id)}
                  className="rounded border-gray-300 text-[#6A3DB8] focus:ring-[#6A3DB8]/30" />
                {t.label}
              </label>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[11px] text-gray-400 mb-1.5">Property Deep Dive tables (Properties Worth Celebrating / Need Attention) — hide a benchmark column when it isn't relevant, without losing the property listing itself.</p>
          <div className="grid grid-cols-2 gap-1.5">
            <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
              <input type="checkbox" checked={showAdoptionPortfolioAvg} onChange={() => setShowAdoptionPortfolioAvg((v) => !v)}
                className="rounded border-gray-300 text-[#6A3DB8] focus:ring-[#6A3DB8]/30" />
              Adoption — Portfolio Avg
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
              <input type="checkbox" checked={showAdoptionPeerMedian} onChange={() => setShowAdoptionPeerMedian((v) => !v)}
                className="rounded border-gray-300 text-[#6A3DB8] focus:ring-[#6A3DB8]/30" />
              Adoption — Peer Median
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
              <input type="checkbox" checked={showEngagementObserved} onChange={() => setShowEngagementObserved((v) => !v)}
                className="rounded border-gray-300 text-[#6A3DB8] focus:ring-[#6A3DB8]/30" />
              Engagement — Observed
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
              <input type="checkbox" checked={showEngagementPortfolioAvg} onChange={() => setShowEngagementPortfolioAvg((v) => !v)}
                className="rounded border-gray-300 text-[#6A3DB8] focus:ring-[#6A3DB8]/30" />
              Engagement — Portfolio Avg
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
              <input type="checkbox" checked={showEngagementPeerMedian} onChange={() => setShowEngagementPeerMedian((v) => !v)}
                className="rounded border-gray-300 text-[#6A3DB8] focus:ring-[#6A3DB8]/30" />
              Engagement — Peer Median
            </label>
          </div>
        </div>
      </Section>

      {/* Customer Testimonials */}
      <StaticSection title="Customer Testimonials">
        <p className="text-xs font-bold text-red-600 mb-2">Please read these tickets and make the call on if they should be included in the deck.</p>
        <TestimonialsEditor
          testimonials={testimonials}
          onChange={setTestimonials}
          pmcName={reportBasis === "pmc" ? selectedPMC : ""}
          secondPmcName={reportBasis === "pmc" ? secondPMC : ""}
        />
      </StaticSection>

      {/* "What's New at Flex" removed (Kevin's call) - PDF upload (below) covers the same need
          as a real custom slide instead of AI-polished bullets from rough notes. Was already
          fully dead here anyway: whats_new_text updated local state but was never actually
          read by index.tsx's handleQBRGenerate or present in the server's input schema at all -
          same silent-no-op bug class as the D2C toggle fixed this session. */}

      {/* Import Slides (PDF upload) */}
      <StaticSection title="Import Slides">
        <p className="text-[11px] text-gray-400 mb-2">Optional — pull pages from an existing deck into this one, untouched. Upload a PDF exported from Slides, PowerPoint, anywhere — no Google sign-in needed.</p>
        <label className="px-3 py-2 text-xs text-[#6A3DB8] border border-dashed border-[#6A3DB8]/40 rounded-[4px] cursor-pointer hover:bg-[#EEE2FC] transition-colors inline-flex items-center gap-1.5 w-fit">
          📄 Upload a PDF
          <input type="file" accept="application/pdf" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePdfFile(f); }} />
        </label>
        {pdfStatus && <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">{pdfStatus}</p>}
        {pdfPages.length > 0 && (
          <div className="mt-2 space-y-1.5 max-h-64 overflow-y-auto">
            {pdfPages.map((p) => (
              <div key={p.key} className="flex items-center gap-2.5 p-2 border border-gray-200 rounded-[4px]">
                <input type="checkbox" checked={p.checked} onChange={() => togglePdfPage(p.key)}
                  className="rounded border-gray-300 text-[#6A3DB8] focus:ring-[#6A3DB8]/30" />
                <img src={`data:${p.mime};base64,${p.data}`} alt={p.label}
                  className="w-16 h-9 object-cover rounded-[3px] bg-gray-100 flex-shrink-0" />
                <span className="text-xs text-gray-500 flex-shrink-0">{p.label}</span>
                <select value={p.anchor} disabled={!p.checked} onChange={(e) => setPdfPageAnchor(p.key, e.target.value as "start" | "end")}
                  className="ml-auto text-[11px] border border-gray-200 rounded-[4px] px-2 py-1 text-gray-700 bg-white disabled:opacity-50">
                  <option value="start">Start of deck</option>
                  <option value="end">End of deck</option>
                </select>
              </div>
            ))}
          </div>
        )}
      </StaticSection>

      {/* Overrides — edge-case fields most builds don't need */}
      <Section title="Overrides">
        <div className="space-y-3">
          {reportBasis === "pmc" && (
            <div>
              <div className="flex items-baseline gap-2 mb-1.5">
                <label className="block text-sm font-medium text-gray-700">Report Name</label>
                <span className="text-[10px] text-gray-400">optional</span>
              </div>
              <input type="text" value={reportName} onChange={(e) => setReportName(e.target.value)} placeholder="Override the PMC name on the deck"
                className={inputCls} />
            </div>
          )}
          <div>
            <div className="flex items-baseline gap-1 mb-1.5">
              <label className="block text-sm font-medium text-gray-700">Total Company Units</label>
              <span className="text-[10px] text-gray-400">optional</span>
            </div>
            <input type="number" min={0} value={totalCompanyUnits} onChange={(e) => setTotalCompanyUnits(e.target.value)} placeholder="—"
              className={inputCls} />
          </div>
          <div>
            <div className="flex items-baseline gap-2 mb-1.5">
              <label className="block text-sm font-medium text-gray-700">Partner Since Override</label>
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
