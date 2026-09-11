import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Loader2, Plug, Search, Upload, X } from "lucide-react";
import * as XLSX from "xlsx";
import { ToggleGroup } from "./ToggleGroup.js";
import { useApiData } from "@/hooks/useApiData.js";
import { useApi } from "@/hooks/useApi.js";

/**
 * Embed → Direct Integration (Clark mirror of Flask's #embedMode tab; spec: flex-pmc-reports
 * docs/superpowers/specs/2026-09-10-embed-deck-design.md). One embed-only PMC per deck: the picker
 * is fed by GetPMCNames { mode: "embed" } - every PMC with embed bills in the last 12 BP months
 * across the Yardi / AppFolio / MRI / Zego lists plus the legacy dim-name path - and badges each
 * row with its MSP and property count.
 *
 * Total units is required (embed doesn't report unit counts for every MSP): it prefills from the
 * exactly-matching Salesforce account's TOTAL_COMPANY_UNITS__C when there is one, and the server
 * falls back to the MSP list total / the sum of real dim unit counts before gating. Avg rent and
 * the property-list upload are optional - the upload only overrides addresses and unit counts, it
 * never adds or drops properties.
 */
export interface EmbedFormState {
  pmc_name: string;
  total_units: string;
  avg_rent: string;
  delivery: string;
  terminology: string;
  /** Parsed upload rows ({header: cell}), the shape applyPropertyUpload expects. */
  properties: Record<string, unknown>[];
}

interface EmbedTabProps {
  generating: boolean;
  onGenerate: (state: EmbedFormState) => void;
}

interface EmbedPmcRow {
  name: string;
  msp: string;
  property_count: number;
}

const MSP_BADGE: Record<string, string> = {
  yardi: "Yardi", appfolio: "AppFolio", mri: "MRI", zego: "Zego", legacy: "Embed",
};

/** Header→cell rows from a CSV / XLSX buffer - the same shape Flask's parse_property_upload hands
 * apply_property_upload (Property Name / Street / City / State / Zip / Units columns). */
function parseRows(data: ArrayBuffer | string): Record<string, unknown>[] {
  const wb = typeof data === "string" ? XLSX.read(data, { type: "string" }) : XLSX.read(data, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
}

export function EmbedTab({ generating, onGenerate }: EmbedTabProps) {
  // Own picker list - fetched only while this tab is mounted, so the other tabs never pay for it.
  const { data: pmcData, loading: pmcLoading } = useApiData("GetPMCNames", { mode: "embed" });
  const embedPmcs = useMemo<EmbedPmcRow[]>(() => (pmcData?.embedPmcs ?? []) as EmbedPmcRow[], [pmcData]);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<EmbedPmcRow | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [totalUnits, setTotalUnits] = useState("");
  const [unitsSource, setUnitsSource] = useState<string>("");
  const [avgRent, setAvgRent] = useState("");
  const [delivery, setDelivery] = useState("sharing");
  const [terminology, setTerminology] = useState("resident");
  const [uploadRows, setUploadRows] = useState<Record<string, unknown>[]>([]);
  const [uploadName, setUploadName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { run: searchAccounts } = useApi("SearchProspectAccounts");

  // The list is ~15k rows live, so never render it whole - match on the typed query and cap.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return embedPmcs.slice(0, 25);
    return embedPmcs.filter((r) => r.name.toLowerCase().includes(q)).slice(0, 25);
  }, [embedPmcs, query]);

  // Prefill total units from the exactly-matching SF account (Flask's tab does the same through
  // /api/search-accounts). Soft: any failure / no exact match leaves the field for the user.
  const handleSelect = useCallback(async (row: EmbedPmcRow) => {
    setSelected(row);
    setQuery(row.name);
    setShowDropdown(false);
    setTotalUnits("");
    setUnitsSource("");
    try {
      const response = await searchAccounts({ query: row.name });
      const hit = (response?.results ?? []).find(
        (r: { account_name: string; total_units: number }) =>
          r.account_name.trim().toUpperCase() === row.name.trim().toUpperCase() && r.total_units > 0,
      );
      if (hit) {
        setTotalUnits(String(hit.total_units));
        setUnitsSource(`Prefilled from Salesforce (${hit.account_name})`);
      }
    } catch {
      // Leave the field empty - the server still falls back to the MSP list total / dim units.
    }
  }, [searchAccounts]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadName(file.name);
    const ext = file.name.toLowerCase().split(".").pop() || "";
    try {
      const rows = ext === "xlsx" || ext === "xls"
        ? parseRows(await file.arrayBuffer())
        : parseRows(await file.text());
      setUploadRows(rows);
    } catch {
      setUploadRows([]);
    }
  }, []);

  const handleRemoveFile = useCallback(() => {
    setUploadRows([]);
    setUploadName("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleGenerate = useCallback(() => {
    if (!selected) return;
    onGenerate({
      pmc_name: selected.name,
      total_units: totalUnits,
      avg_rent: avgRent,
      delivery,
      terminology,
      properties: uploadRows,
    });
  }, [selected, totalUnits, avgRent, delivery, terminology, uploadRows, onGenerate]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setShowDropdown(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const inputCls = "w-full px-3 py-2 text-sm border border-gray-200 rounded-[4px] focus:outline-none focus:ring-2 focus:ring-[#6A3DB8]/30 focus:border-[#6A3DB8]";

  return (
    <div className="space-y-4">
      {/* When to use this deck - same framing as Flask's Embed tab helper text */}
      <div className="p-3 bg-[#F5F2FF] border border-[#DCC9F2] rounded-[4px] text-xs text-[#2C194D] leading-relaxed">
        For a PMC whose residents already use Flex through their PMS embed (Yardi / AppFolio / MRI / Zego) and
        who says &ldquo;it already works.&rdquo; Shows their embed today, the same-properties before/after-DI
        curve, a floor&rarr;ceiling projection, their markets, and what a direct integration would show them.
        One PMC per deck; needs at least 3 months of embed activity.
      </div>

      {/* PMC picker - MSP badged */}
      <div ref={containerRef} className="relative">
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Embed PMC</label>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          {pmcLoading && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 animate-spin" />}
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(null); setShowDropdown(true); }}
            onFocus={() => setShowDropdown(true)}
            placeholder="Search PMCs with embed activity…"
            className={`${inputCls} pl-8`}
          />
        </div>
        <p className="text-[10px] text-red-500 mt-0.5 font-medium">* Required</p>
        {selected && (
          <p className="text-[10px] text-emerald-600 mt-1">
            Selected: {selected.name} · {MSP_BADGE[selected.msp] ?? selected.msp} embed · {selected.property_count.toLocaleString()} properties
          </p>
        )}
        {!pmcLoading && embedPmcs.length === 0 && (
          <p className="text-[11px] text-gray-400 mt-1">No PMCs with embed activity in the last 12 BP months.</p>
        )}
        {showDropdown && matches.length > 0 && (
          <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-64 overflow-y-auto">
            {matches.map((row) => (
              <button
                key={`${row.msp}:${row.name}`}
                type="button"
                onClick={() => handleSelect(row)}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-50 last:border-0 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-gray-900 truncate">{row.name}</span>
                  <span className="text-[10px] font-semibold text-[#6A3DB8] bg-[#F0EDFF] rounded-full px-2 py-0.5 shrink-0">
                    {MSP_BADGE[row.msp] ?? row.msp}
                  </span>
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5">{row.property_count.toLocaleString()} properties</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Total units + avg rent */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Total units</label>
          <input type="number" min="0" value={totalUnits} onChange={(e) => { setTotalUnits(e.target.value); setUnitsSource(""); }}
            placeholder="e.g. 1162" className={inputCls} />
          <p className="text-[11px] text-gray-400 mt-1">
            {unitsSource || "Embed doesn't report unit counts for every MSP — adoption is units-based, so this drives the whole deck."}
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Average monthly rent</label>
          <input type="number" min="0" value={avgRent} onChange={(e) => setAvgRent(e.target.value)}
            placeholder="Optional" className={inputCls} />
          <p className="text-[11px] text-gray-400 mt-1">Optional — the peer median is used when blank.</p>
        </div>
      </div>

      {/* Property list upload (optional) */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Property list (optional)</label>
        {uploadName ? (
          <div className="flex items-center justify-between px-3 py-2 border border-gray-200 rounded-[4px] text-sm">
            <span className="text-gray-700 truncate">{uploadName} · {uploadRows.length.toLocaleString()} rows</span>
            <button type="button" onClick={handleRemoveFile} className="text-gray-400 hover:text-gray-700">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-[4px] text-sm text-gray-500 hover:border-[#6A3DB8] hover:text-[#6A3DB8] transition-colors">
            <Upload className="h-4 w-4" />Upload CSV / XLSX
          </button>
        )}
        <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange} className="hidden" />
        <p className="text-[11px] text-gray-400 mt-1">
          Matched to their embed properties by property name — overrides addresses and unit counts only, never adds or drops properties.
        </p>
      </div>

      {/* Delivery + terminology */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">Delivery</label>
            <ToggleGroup options={[{ value: "sharing", label: "Sharing" }, { value: "presenting", label: "Presenting" }]} value={delivery} onChange={setDelivery} />
          </div>
          <p className="text-[11px] text-gray-400 mt-1">Speaker notes are always generated for this deck.</p>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">Terminology</label>
            <ToggleGroup options={[{ value: "resident", label: "Resident" }, { value: "household", label: "Household" }]} value={terminology} onChange={setTerminology} />
          </div>
          <p className="text-[11px] text-gray-400 mt-1">Which word to use throughout the deck.</p>
        </div>
      </div>

      {/* Generate */}
      <div className="pt-2">
        <button onClick={handleGenerate} disabled={!selected || generating}
          className="w-full px-5 py-3 text-sm font-semibold text-white rounded-[4px] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          style={{ backgroundColor: !selected || generating ? "#9CA3AF" : "#6A3DB8" }}>
          {generating ? <><Loader2 className="h-4 w-4 animate-spin" />Generating...</> : <><Plug className="h-4 w-4" />Generate Embed Deck</>}
        </button>
      </div>
    </div>
  );
}
