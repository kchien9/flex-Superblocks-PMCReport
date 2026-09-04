import { Loader2, FileBarChart, Download, FileSpreadsheet, FileText, AlertTriangle, Copy, Check, RefreshCw, XCircle, Info } from "lucide-react";
import { useState, useCallback, useEffect, useRef } from "react";

// Blob + object-URL download instead of a `data:` URI href. A data: URI encodes the ENTIRE
// file content into the URL itself — for a full 21-slide deck (now the default selection) or a
// large speaker-notes doc, that URL gets long enough to trip a "414 URI Too Large" error.
// Object URLs are just an opaque reference (a few dozen bytes) regardless of the underlying
// content size, so there's no length ceiling to hit. Revoked right after the click so the blob
// doesn't leak memory for the life of the page.
function downloadHtml(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface ResultsPanelProps {
  generating: boolean;
  reportData: { html?: string; empty?: boolean; flags?: string[]; emailDraft?: string; notes_html?: string; skipped_slides?: { key: string; label: string }[] } | null;
  delivery: string;
  deckLabel: string;
  error?: unknown;
  onRetry?: () => void;
}

export function ResultsPanel({ generating, reportData, delivery, deckLabel, error, onRetry }: ResultsPanelProps) {
  const [copied, setCopied] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Track elapsed time while generating
  useEffect(() => {
    if (generating) {
      setElapsedSec(0);
      timerRef.current = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [generating]);

  const handleCopyEmail = useCallback(() => {
    if (reportData?.emailDraft) {
      navigator.clipboard.writeText(reportData.emailDraft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [reportData]);

  if (generating) {
    const showStillGenerating = elapsedSec >= 15;
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
        <Loader2 className="h-10 w-10 animate-spin mb-4" style={{ color: "#6A3DB8" }} />
        <p className="text-lg font-medium" style={{ color: "#2C194D" }}>Generating {deckLabel}...</p>
        {!showStillGenerating && (
          <p className="text-sm text-gray-400 mt-1">This may take 30–60 seconds</p>
        )}
        {showStillGenerating && (
          <div className="mt-2 text-center">
            <p className="text-sm text-[#6A3DB8] font-medium">Still working — crunching {elapsedSec}s of data</p>
            <p className="text-xs text-gray-400 mt-1">Large portfolios take longer. Hang tight.</p>
            <p className="text-xs text-gray-400 mt-2">If it times out, try again. If it still doesn't work, flag to RevOps.</p>
          </div>
        )}
      </div>
    );
  }

  if (error) {
    const message = error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error);
    const isTimeout = message.includes("Failed to fetch") || message.includes("timeout") || message.includes("EMPTY_RESPONSE");

    return (
      <div className="flex-1 flex flex-col items-center justify-center px-8">
        <div className="max-w-md w-full p-6 bg-white border border-red-200 rounded-[8px] shadow-sm">
          <div className="flex items-start gap-3 mb-4">
            <XCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-gray-900 mb-1">Generation failed</p>
              <p className="text-xs text-gray-600">
                {isTimeout
                  ? "The request timed out — this PMC may have too much data to process in the allowed window. Try selecting fewer slides or a smaller lookback period."
                  : message}
              </p>
              <p className="text-xs text-gray-400 mt-2">If it keeps failing after a retry, flag to RevOps.</p>
            </div>
          </div>
          {onRetry && (
            <button
              onClick={onRetry}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#6A3DB8] border border-[#6A3DB8]/30 rounded-[4px] hover:bg-[#EEE2FC] transition-colors w-full justify-center"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!reportData) {
    return null;
  }

  if (reportData.empty) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-16 text-gray-400">
        <FileBarChart className="h-10 w-10 mb-3 opacity-40" />
        <p className="text-sm">No data found for the selected parameters</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Download links + flags */}
      <div className="px-4 py-3 border-b border-gray-200 space-y-3">
        {/* Downloads row */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => downloadHtml(reportData.html || "", "slide-deck.html")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#6A3DB8] border border-[#6A3DB8]/30 rounded-[4px] hover:bg-[#EEE2FC] transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Slide Deck
          </button>
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-[4px] hover:bg-gray-50 transition-colors"
            title="Data Workbook (Excel) — coming soon"
            disabled
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Data Workbook
          </button>
          {delivery === "presenting" && (
            reportData.notes_html ? (
              <button
                type="button"
                onClick={() => downloadHtml(reportData.notes_html || "", "speaker-notes.html")}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#6A3DB8] border border-[#6A3DB8]/30 rounded-[4px] hover:bg-[#EEE2FC] transition-colors"
              >
                <FileText className="h-3.5 w-3.5" />
                Speaker Notes
              </button>
            ) : (
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-[4px] hover:bg-gray-50 transition-colors"
                title="Speaker Notes — not available for this deck type yet"
                disabled
              >
                <FileText className="h-3.5 w-3.5" />
                Speaker Notes
              </button>
            )
          )}
        </div>

        {/* Pre-meeting flags */}
        {reportData.flags && reportData.flags.length > 0 && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-[4px]">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-red-700 mb-1">Pre-meeting flags</p>
                <ul className="space-y-0.5">
                  {reportData.flags.map((flag, i) => (
                    <li key={i} className="text-xs text-red-600">&bull; {flag}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Slides auto-hidden for insufficient data (Kevin's ask) - calm/informational, not an
            error, so an AE who notices fewer slides than they selected isn't left guessing
            whether something's broken. */}
        {reportData.skipped_slides && reportData.skipped_slides.length > 0 && (
          <div className="p-3 bg-[#F5F2FF] border border-[#DCC9F2] rounded-[4px]">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-[#6A3DB8] mt-0.5 shrink-0" />
              <p className="text-xs text-[#2C194D]">
                <span className="font-semibold">
                  {reportData.skipped_slides.length} slide{reportData.skipped_slides.length === 1 ? "" : "s"} did not render
                </span>
                {" "}— not enough data yet to tell a reliable story: {reportData.skipped_slides.map((s) => s.label).join(", ")}.
              </p>
            </div>
          </div>
        )}

        {/* Email Draft */}
        {reportData.emailDraft && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Email Draft</span>
              <button
                onClick={handleCopyEmail}
                className="flex items-center gap-1 text-[10px] text-[#6A3DB8] hover:underline"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <textarea
              readOnly
              value={reportData.emailDraft}
              rows={4}
              className="w-full px-3 py-2 text-xs border border-gray-200 rounded-[4px] bg-gray-50 resize-y font-mono"
            />
          </div>
        )}
      </div>

      {/* Iframe */}
      <iframe
        srcDoc={reportData.html}
        className="flex-1 w-full border-0 min-h-[60vh]"
        sandbox="allow-scripts allow-same-origin allow-downloads allow-popups allow-presentation"
        allowFullScreen
        title="Report Deck"
      />
    </div>
  );
}
