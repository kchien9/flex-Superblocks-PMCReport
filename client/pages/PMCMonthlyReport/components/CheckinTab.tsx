import { useState, useCallback } from "react";
import { Loader2, CalendarCheck } from "lucide-react";
import { ToggleGroup } from "./ToggleGroup.js";
import { PMCSearch } from "./PMCSearch.js";

/**
 * Check-in - "Adoption since our check-in" (Clark mirror of Flask's #checkinMode tab, 013c659;
 * spec: flex-pmc-reports docs/superpowers/specs/2026-09-09-adoption-checkin-design.md). One PMC per
 * deck, the standard PMC picker, plus the ONE extra input: the check-in date (snapped server-side
 * to its BP month). Fixed 2 slides (cover + wedge chart); the reporting month is the usual latest
 * completed BP month and the lookback is widened server-side to cover check-in - 2 months (min 6 /
 * max 24). No presets, slide picker or period controls. Generate enables only with BOTH a PMC and
 * a date; the server self-gates (date missing / not before the reporting month / outside the PMC's
 * history) with a message the results panel shows in the standard error box.
 */
export interface CheckinFormState {
  pmc_name: string;
  checkin_date: string;
  terminology: string;
}

interface CheckinTabProps {
  pmcNames: string[];
  pmcLoading: boolean;
  generating: boolean;
  onGenerate: (state: CheckinFormState) => void;
}

export function CheckinTab({ pmcNames, pmcLoading, generating, onGenerate }: CheckinTabProps) {
  const [selectedPMC, setSelectedPMC] = useState("");
  const [checkinDate, setCheckinDate] = useState("");
  const [terminology, setTerminology] = useState("resident");
  const ready = !!selectedPMC && !!checkinDate;

  const handleGenerate = useCallback(() => {
    if (!selectedPMC || !checkinDate) return;
    onGenerate({ pmc_name: selectedPMC, checkin_date: checkinDate, terminology });
  }, [selectedPMC, checkinDate, terminology, onGenerate]);

  const inputCls = "w-full px-3 py-2 text-sm border border-gray-200 rounded-[4px] focus:outline-none focus:ring-2 focus:ring-[#6A3DB8]/30 focus:border-[#6A3DB8]";

  return (
    <div className="space-y-4">
      {/* When to use this deck */}
      <div className="p-3 bg-[#F5F2FF] border border-[#DCC9F2] rounded-[4px] text-xs text-[#2C194D] leading-relaxed">
        A one-slide progress check against a prior working session or review: adoption gained since the check-in month,
        with an &quot;at this pace&quot; projection to the end of next quarter, capped at what peers achieve.
      </div>

      {/* PMC Search — required */}
      <div>
        <PMCSearch label="Property Management Company" placeholder="Search Flex customers…" value={selectedPMC} onChange={setSelectedPMC} pmcNames={pmcNames} loading={pmcLoading} />
        <p className="text-[10px] text-red-500 mt-0.5 font-medium">* Required</p>
      </div>

      {/* Check-in date — required */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Check-in date</label>
        <input type="date" value={checkinDate} onChange={(e) => setCheckinDate(e.target.value)} className={inputCls} />
        <p className="text-[10px] text-red-500 mt-0.5 font-medium">* Required</p>
        <p className="text-[11px] text-gray-400 mt-1">
          The working session or prior review you&apos;re measuring from. Snapped to its BP month; it must be at least
          one BP month before the reporting month (the latest settled BP month). Adoption gained since then is the
          slide, with an &quot;at this pace&quot; projection to the end of next quarter, capped at what peers achieve.
        </p>
      </div>

      {/* Terminology */}
      <div>
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700">Terminology</label>
          <ToggleGroup options={[{ value: "resident", label: "Resident" }, { value: "household", label: "Household" }]} value={terminology} onChange={setTerminology} />
        </div>
        <p className="text-[11px] text-gray-400 mt-1">Which word to use throughout the deck — some partners prefer one over the other.</p>
      </div>

      {/* Generate */}
      <div className="pt-2">
        <button onClick={handleGenerate} disabled={!ready || generating}
          className="w-full px-5 py-3 text-sm font-semibold text-white rounded-[4px] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          style={{ backgroundColor: !ready || generating ? "#9CA3AF" : "#6A3DB8" }}>
          {generating ? <><Loader2 className="h-4 w-4 animate-spin" />Generating...</> : <><CalendarCheck className="h-4 w-4" />Generate Check-in Deck</>}
        </button>
      </div>
    </div>
  );
}
