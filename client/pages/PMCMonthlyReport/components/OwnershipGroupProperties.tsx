import { useState, useCallback } from "react";
import { Upload, Type } from "lucide-react";
import { ToggleGroup } from "./ToggleGroup.js";

type Mode = "csv" | "paste";

interface OwnershipGroupPropertiesProps {
  propertyIds: string[];
  onPropertyIdsChange: (ids: string[]) => void;
  reportName: string;
  onReportNameChange: (name: string) => void;
  hasPmcSelected: boolean;
}

export function OwnershipGroupProperties({
  propertyIds,
  onPropertyIdsChange,
  reportName,
  onReportNameChange,
  hasPmcSelected,
}: OwnershipGroupPropertiesProps) {
  const [mode, setMode] = useState<Mode>("paste");
  const [pasteText, setPasteText] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);

  const handlePasteChange = useCallback((text: string) => {
    setPasteText(text);
    // Auto-detect bv2... and reco... format IDs, or treat lines as property names
    const lines = text.split(/[\n,]/).map((l) => l.trim()).filter(Boolean);
    const ids = lines.filter((l) => /^(bv2|reco)/.test(l) || l.length > 2);
    onPropertyIdsChange(ids);
  }, [onPropertyIdsChange]);

  const handleCsvUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFile(file);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (!text) return;
      const lines = text.split("\n");
      const header = lines[0]?.toLowerCase() || "";
      // Find "property public id" column
      const cols = header.split(",");
      const idIdx = cols.findIndex((c) => c.includes("property public id") || c.includes("property_public_id"));
      if (idIdx === -1) {
        // Fallback: try first column
        const ids = lines.slice(1).map((l) => l.split(",")[0]?.trim()).filter(Boolean);
        onPropertyIdsChange(ids);
      } else {
        const ids = lines.slice(1).map((l) => l.split(",")[idIdx]?.trim()).filter(Boolean);
        onPropertyIdsChange(ids);
      }
    };
    reader.readAsText(file);
  }, [onPropertyIdsChange]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <ToggleGroup
          options={[
            { value: "paste", label: "Paste IDs" },
            { value: "csv", label: "Upload CSV" },
          ]}
          value={mode}
          onChange={(v) => setMode(v as Mode)}
        />
        {propertyIds.length > 0 && (
          <span className="text-xs text-[#6A3DB8] font-medium">{propertyIds.length} properties</span>
        )}
      </div>

      {mode === "paste" && (
        <textarea
          value={pasteText}
          onChange={(e) => handlePasteChange(e.target.value)}
          placeholder="Paste property names or IDs (bv2..., reco...) — one per line or comma-separated"
          rows={4}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-[4px] focus:outline-none focus:ring-2 focus:ring-[#6A3DB8]/30 focus:border-[#6A3DB8] font-mono resize-y"
        />
      )}

      {mode === "csv" && (
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[#6A3DB8] border border-[#6A3DB8]/30 rounded-[4px] cursor-pointer hover:bg-[#EEE2FC] transition-colors">
            <Upload className="h-4 w-4" />
            {csvFile ? csvFile.name : "Choose Sigma export CSV"}
            <input type="file" accept=".csv" className="hidden" onChange={handleCsvUpload} />
          </label>
          {csvFile && (
            <button
              type="button"
              onClick={() => { setCsvFile(null); onPropertyIdsChange([]); }}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Standalone report name — only when no PMC is selected */}
      {!hasPmcSelected && propertyIds.length > 0 && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Report Name (for cover)</label>
          <input
            type="text"
            value={reportName}
            onChange={(e) => onReportNameChange(e.target.value)}
            placeholder="Company name for the deck cover"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-[4px] focus:outline-none focus:ring-2 focus:ring-[#6A3DB8]/30 focus:border-[#6A3DB8]"
          />
        </div>
      )}
    </div>
  );
}
