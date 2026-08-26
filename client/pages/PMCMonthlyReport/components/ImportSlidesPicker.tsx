import { useState, useCallback, useEffect } from "react";

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
//
// Extracted out of QBRTab.tsx into its own component (Kevin's ask: PDF upload across report
// types, not just QBR) so New Logo and Expansion can share the exact same picker instead of
// three copies of this drifting apart over time.
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

interface ImportSlidesPickerProps {
  /** Called whenever the checked/anchor selection changes, with the full computed payload
   * ready to drop straight into a generate-report args object. */
  onChange: (slides: ImportedSlide[]) => void;
}

/** Self-contained "Import Slides" section - PDF upload, thumbnail picker, start/end anchor
 * per page. Owns its own state; reports the computed ImportedSlide[] up via onChange rather
 * than being a fully controlled component, since the parent never needs to set pdfPages/
 * pdfDeckTitle directly - only read the derived result. */
export function ImportSlidesPicker({ onChange }: ImportSlidesPickerProps) {
  const [pdfDeckTitle, setPdfDeckTitle] = useState("");
  const [pdfPages, setPdfPages] = useState<PdfPageItem[]>([]);
  const [pdfStatus, setPdfStatus] = useState("");

  useEffect(() => {
    onChange(
      pdfPages
        .filter((p) => p.checked)
        .map((p) => ({ anchor: p.anchor, image_b64: p.data, image_mime: p.mime, source_title: p.label, deck_title: pdfDeckTitle }))
    );
    // onChange is expected to be a stable callback (useCallback at the call site) - including
    // it would re-run this effect every render otherwise, since inline arrow functions are a
    // new reference each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfPages, pdfDeckTitle]);

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

  return (
    <div>
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
    </div>
  );
}
