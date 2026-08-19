import { useState, useCallback, useRef } from "react";
import { Loader2, Rocket, Upload, X } from "lucide-react";
import * as XLSX from "xlsx";
import { ToggleGroup } from "./ToggleGroup.js";
import { SlidesPicker, NEW_LOGO_SLIDES, defaultSlideSet } from "./SlidesPicker.js";
import { TestimonialsEditor, type Testimonial } from "./TestimonialsEditor.js";
import { ProspectSearch, type ProspectResult } from "./ProspectSearch.js";

/**
 * Parse an Excel workbook ArrayBuffer into CSV text.
 * Mirrors the server-side logic: find the sheet with property-data headers,
 * skip leading title/note rows, then convert to CSV.
 */
function excelToCsv(buffer: ArrayBuffer): string {
  const wb = XLSX.read(buffer, { type: "array" });
  if (wb.SheetNames.length === 0) return "";

  const headerKeywords = ["address", "street", "city", "state", "zip", "units", "property"];

  let bestSheet: string | null = null;
  let bestRows: (string | number | null)[][] = [];
  let bestHeaderIdx = 0;

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rawRows: (string | number | null)[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    if (rawRows.length < 2) continue;

    // Detect header row (skip leading title/note rows)
    let headerIdx = 0;
    for (let i = 0; i < Math.min(rawRows.length, 5); i++) {
      const cells = (rawRows[i] || []).map(c => String(c || "").toLowerCase());
      const matches = cells.filter(c => headerKeywords.some(k => c.includes(k)));
      if (matches.length >= 1) { headerIdx = i; break; }
    }

    const headerCells = (rawRows[headerIdx] || []).map(c => String(c || "").toLowerCase());
    const matchCount = headerCells.filter(c => headerKeywords.some(k => c.includes(k))).length;

    if (matchCount >= 2) {
      bestSheet = sheetName;
      bestRows = rawRows;
      bestHeaderIdx = headerIdx;
      break;
    } else if (matchCount >= 1 && !bestSheet) {
      bestSheet = sheetName;
      bestRows = rawRows;
      bestHeaderIdx = headerIdx;
    }
  }

  // Fall back to first sheet
  if (!bestSheet) {
    bestSheet = wb.SheetNames[0];
    const sheet = wb.Sheets[bestSheet];
    bestRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    // detect header row on fallback
    for (let i = 0; i < Math.min(bestRows.length, 5); i++) {
      const cells = (bestRows[i] || []).map(c => String(c || "").toLowerCase());
      if (cells.filter(c => headerKeywords.some(k => c.includes(k))).length >= 1) {
        bestHeaderIdx = i;
        break;
      }
    }
  }

  if (bestRows.length < 2) return "";

  // Build CSV from headerIdx onward, skipping empty rows
  const dataRows = bestRows.slice(bestHeaderIdx);
  const csvLines: string[] = [];
  for (const row of dataRows) {
    if (!row || !row.some(cell => cell != null && String(cell).trim() !== "")) continue;
    const line = row.map(cell => {
      const val = String(cell ?? "");
      // Quote fields that contain commas, quotes, or newlines
      if (val.includes(",") || val.includes('"') || val.includes("\n")) {
        return '"' + val.replace(/"/g, '""') + '"';
      }
      return val;
    }).join(",");
    csvLines.push(line);
  }
  return csvLines.join("\n");
}

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

export interface NewLogoFormState {
  prospect_account: string;
  total_units: string;
  states: string;

  portfolio_type: string;
  property_type: string;
  portfolio_footprint: string;

  avg_monthly_rent: string;
  delivery: string;
  terminology: string;
  selected_slides: Set<string>;
  testimonials: Testimonial[];
  property_list_csv: string | null;
  property_list_filename: string | null;
}

interface NewLogoTabProps {
  generating: boolean;
  onGenerate: (state: NewLogoFormState) => void;
}

export function NewLogoTab({ generating, onGenerate }: NewLogoTabProps) {
  const [prospectAccount, setProspectAccount] = useState("");
  const [totalUnits, setTotalUnits] = useState("");
  const [states, setStates] = useState("");

  const [portfolioType, setPortfolioType] = useState("multi_family");
  const [propertyType, setPropertyType] = useState("conventional");
  const [portfolioFootprint, setPortfolioFootprint] = useState("not_specified");

  const [avgMonthlyRent, setAvgMonthlyRent] = useState("");
  const [delivery, setDelivery] = useState("presenting");
  const [terminology, setTerminology] = useState("resident");
  const [selectedSlides, setSelectedSlides] = useState<Set<string>>(() => defaultSlideSet(NEW_LOGO_SLIDES));
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
  const [propertyListFile, setPropertyListFile] = useState<File | null>(null);
  const [propertyListCsv, setPropertyListCsv] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleProspectSelect = useCallback((result: ProspectResult) => {
    setProspectAccount(result.account_name);
    if (result.total_units) setTotalUnits(String(result.total_units));
    if (result.state) setStates(result.state);
    if (result.portfolio_type) {
      const ptMap: Record<string, string> = {
        "Multi Family": "multi_family",
        "Single Family": "single_family",
      };
      setPortfolioType(ptMap[result.portfolio_type] ?? "multi_family");
    }
    if (result.asset_subtypes.length > 0) {
      const sub = result.asset_subtypes[0].toLowerCase();
      if (sub.includes("affordable") || sub.includes("hud")) setPropertyType("affordable");
      else if (sub.includes("student")) setPropertyType("student");
      else if (sub.includes("senior")) setPropertyType("senior");
      else setPropertyType("conventional");
    }
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPropertyListFile(file);

    const ext = file.name.toLowerCase().split(".").pop() || "";
    if (ext === "xlsx" || ext === "xls") {
      // Parse Excel client-side and convert to CSV text
      const buffer = await file.arrayBuffer();
      const csvText = excelToCsv(buffer);
      setPropertyListCsv(csvText || null);
    } else {
      // Read as text for CSV
      const text = await file.text();
      setPropertyListCsv(text);
    }
  }, []);

  const handleRemoveFile = useCallback(() => {
    setPropertyListFile(null);
    setPropertyListCsv(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleGenerate = useCallback(() => {
    if (!prospectAccount) return;
    onGenerate({
      prospect_account: prospectAccount,
      total_units: totalUnits,
      states,
      portfolio_type: portfolioType,
      property_type: propertyType,
      portfolio_footprint: portfolioFootprint,
      avg_monthly_rent: avgMonthlyRent,
      delivery,
      terminology,
      selected_slides: selectedSlides,
      testimonials,
      property_list_csv: propertyListCsv,
      // Always pass .csv extension since XLSX is pre-converted to CSV text client-side
      property_list_filename: propertyListFile
        ? propertyListFile.name.replace(/\.(xlsx|xls)$/i, ".csv")
        : null,
    });
  }, [prospectAccount, totalUnits, states, portfolioType, propertyType, portfolioFootprint, avgMonthlyRent, delivery, terminology, selectedSlides, testimonials, propertyListCsv, propertyListFile, onGenerate]);

  const inputCls = "w-full px-3 py-2 text-sm border border-gray-200 rounded-[4px] focus:outline-none focus:ring-2 focus:ring-[#6A3DB8]/30 focus:border-[#6A3DB8]";
  const selectCls = `${inputCls} bg-white`;

  return (
    <div className="space-y-4">
      {/* Prospect Account — only required field */}
      <div>
        <ProspectSearch onSelect={handleProspectSelect} />
        <p className="text-[10px] text-red-500 mt-0.5 font-medium">* Required</p>
      </div>

      {/* Auto-populated overrides */}
      <div>
        <div className="flex items-baseline gap-1 mb-1.5">
          <label className="block text-sm font-medium text-gray-700">Total Units</label>
          <span className="text-[10px] text-gray-400">override — auto-fills from Salesforce</span>
        </div>
        <input type="number" value={totalUnits} onChange={(e) => setTotalUnits(e.target.value)} placeholder="—" className={inputCls} />
      </div>

      <div>
        <div className="flex items-baseline gap-1 mb-1.5">
          <label className="block text-sm font-medium text-gray-700">State(s)</label>
          <span className="text-[10px] text-gray-400">auto-derived from property list upload</span>
        </div>
        {propertyListFile ? (
          <div className="relative">
            <input type="text" value={states} readOnly className={`${inputCls} bg-gray-50 text-gray-400 cursor-not-allowed`} />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[#6A3DB8]">Auto-derived from upload</span>
          </div>
        ) : (
          <input type="text" value={states} onChange={(e) => setStates(e.target.value)} placeholder="Comma-separated, e.g. TX, FL, GA" className={inputCls} />
        )}
      </div>



      {/* Dropdowns */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Portfolio Type</label>
          <select value={portfolioType} onChange={(e) => setPortfolioType(e.target.value)} className={selectCls}>
            <option value="multi_family">Multi Family</option>
            <option value="single_family">Single Family</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Property Type</label>
          <select value={propertyType} onChange={(e) => setPropertyType(e.target.value)} className={selectCls}>
            <option value="conventional">Conventional</option>
            <option value="affordable">Affordable/HUD</option>
            <option value="mixed">Mixed</option>
            <option value="student">Student Housing</option>
            <option value="senior">Senior Housing</option>
          </select>
        </div>
      </div>

      <div>
        <div className="flex items-baseline gap-1 mb-1.5">
          <label className="block text-sm font-medium text-gray-700">Portfolio Footprint</label>
          <span className="text-[10px] text-gray-400">optional — auto-derived from state(s)</span>
        </div>
        <select value={portfolioFootprint} onChange={(e) => setPortfolioFootprint(e.target.value)} className={selectCls}>
          <option value="not_specified">Not specified</option>
          <option value="single_market">Single Market</option>
          <option value="regional">Regional</option>
          <option value="multi_state">Multi-State</option>
          <option value="national">National</option>
        </select>
      </div>

      <div>
        <div className="flex items-baseline gap-1 mb-1.5">
          <label className="block text-sm font-medium text-gray-700">Avg Monthly Rent</label>
          <span className="text-[10px] text-gray-400">optional — defaults to matched peer group's median</span>
        </div>
        <input type="number" min={0} value={avgMonthlyRent} onChange={(e) => setAvgMonthlyRent(e.target.value)} placeholder="Peer median"
          className={inputCls} />
      </div>

      {/* Property List Upload */}
      <div>
        <div className="flex items-baseline gap-2 mb-1.5">
          <label className="block text-sm font-medium text-gray-700">Property List</label>
          <span className="text-[10px] text-gray-400">optional</span>
        </div>
        {propertyListFile ? (
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-[4px]">
            <Upload className="h-3.5 w-3.5 text-[#6A3DB8]" />
            <span className="text-sm text-gray-700 flex-1 truncate">{propertyListFile.name}</span>
            <button type="button" onClick={handleRemoveFile} className="p-0.5 hover:bg-gray-200 rounded">
              <X className="h-3.5 w-3.5 text-gray-500" />
            </button>
          </div>
        ) : (
          <label className="flex items-center gap-2 px-3 py-2.5 border border-dashed border-gray-300 rounded-[4px] cursor-pointer hover:border-[#6A3DB8] hover:bg-purple-50/30 transition-colors">
            <Upload className="h-3.5 w-3.5 text-gray-400" />
            <span className="text-sm text-gray-500">Upload CSV or Excel file</span>
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange} className="hidden" />
          </label>
        )}
        <p className="text-[10px] text-gray-400 mt-1">Accepts Address column or Street/City/State/Zip, plus optional Units. Top 5 markets show by default.</p>
      </div>

      {/* Testimonials */}
      <Section title="Testimonials">
        <TestimonialsEditor testimonials={testimonials} onChange={setTestimonials} pmcName="" fetchLabel="Fetch from peer group" />
      </Section>

      {/* Slides */}
      <Section title="Slides">
        <SlidesPicker slides={NEW_LOGO_SLIDES} selectedSlides={selectedSlides} onSlidesChange={setSelectedSlides} />
      </Section>

      {/* Delivery */}
      <div>
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700">Delivery</label>
          <ToggleGroup options={[{ value: "sharing", label: "Sharing" }, { value: "presenting", label: "Presenting" }]} value={delivery} onChange={setDelivery} />
        </div>
        <p className="text-[11px] text-gray-400 mt-1">Are you emailing this deck or presenting it live? Controls formatting.</p>
      </div>

      {/* Terminology */}
      <div>
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700">Terminology</label>
          <ToggleGroup options={[{ value: "resident", label: "Resident" }, { value: "household", label: "Household" }]} value={terminology} onChange={setTerminology} />
        </div>
        <p className="text-[11px] text-gray-400 mt-1">Which word to use throughout the deck and Excel workbook — some partners prefer one over the other.</p>
      </div>

      {/* Generate */}
      <div className="pt-2">
        <button onClick={handleGenerate} disabled={!prospectAccount || generating}
          className="w-full px-5 py-3 text-sm font-semibold text-white rounded-[4px] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          style={{ backgroundColor: !prospectAccount || generating ? "#9CA3AF" : "#6A3DB8" }}>
          {generating ? <><Loader2 className="h-4 w-4 animate-spin" />Generating...</> : <><Rocket className="h-4 w-4" />Generate Prospect Deck</>}
        </button>
      </div>
    </div>
  );
}
