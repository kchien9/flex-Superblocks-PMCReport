import { useState, useCallback } from "react";
import { Loader2, Megaphone } from "lucide-react";
import { ToggleGroup } from "./ToggleGroup.js";
import { PMCSearch } from "./PMCSearch.js";
import { useApiData } from "@/hooks/useApiData.js";

/**
 * Platinum - "The Case for Marketing" (Clark mirror of Flask's #platinumMode tab, 0de2310; spec:
 * flex-pmc-reports docs/superpowers/specs/2026-09-09-platinum-deck-design.md). One PMC per deck:
 * the picker is fed by GetPMCNames { mode: "platinum" } (only PMCs with 3+ silver properties
 * in-network at the latest completed BP month). Deliberately NO "+ Add another PMC", presets,
 * slide picker, review-period / growth / quarter controls - the deck is a fixed 4 slides (cover,
 * Adoption Trend + toggle, Residents/Units & Rent + toggle, conclusion). The server self-gates
 * (fewer than 3 silver properties / no platinum peer pool / nothing to sell) with a message the
 * results panel shows in the same error box every other tab uses.
 */
export interface PlatinumFormState {
  pmc_name: string;
  terminology: string;
}

interface PlatinumTabProps {
  generating: boolean;
  onGenerate: (state: PlatinumFormState) => void;
}

export function PlatinumTab({ generating, onGenerate }: PlatinumTabProps) {
  // Own picker list - fetched only while this tab is mounted, so the other tabs never pay for it.
  const { data: pmcData, loading: pmcLoading } = useApiData("GetPMCNames", { mode: "platinum" });
  const pmcNames = pmcData?.pmcNames ?? [];
  const [selectedPMC, setSelectedPMC] = useState("");
  const [terminology, setTerminology] = useState("resident");

  const handleGenerate = useCallback(() => {
    if (!selectedPMC) return;
    onGenerate({ pmc_name: selectedPMC, terminology });
  }, [selectedPMC, terminology, onGenerate]);

  return (
    <div className="space-y-4">
      {/* When to use this deck - same copy as Flask's Platinum tab helper text */}
      <div className="p-3 bg-[#F5F2FF] border border-[#DCC9F2] rounded-[4px] text-xs text-[#2C194D] leading-relaxed">
        Lists PMCs with 3+ silver properties (direct integration, not opted in to marketing). One PMC per deck.
        The deck compares their silver properties to their own platinum properties when they have 3+ that
        outperform, otherwise to platinum peers - and skips itself if there&apos;s nothing to sell.
      </div>

      {/* PMC Search — required */}
      <div>
        <PMCSearch label="Property Management Company" placeholder="Search silver-heavy Flex customers…" value={selectedPMC} onChange={setSelectedPMC} pmcNames={pmcNames} loading={pmcLoading} />
        <p className="text-[10px] text-red-500 mt-0.5 font-medium">* Required</p>
        {!pmcLoading && pmcNames.length === 0 && (
          <p className="text-[11px] text-gray-400 mt-1">No PMCs with 3+ silver properties found.</p>
        )}
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
        <button onClick={handleGenerate} disabled={!selectedPMC || generating}
          className="w-full px-5 py-3 text-sm font-semibold text-white rounded-[4px] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          style={{ backgroundColor: !selectedPMC || generating ? "#9CA3AF" : "#6A3DB8" }}>
          {generating ? <><Loader2 className="h-4 w-4 animate-spin" />Generating...</> : <><Megaphone className="h-4 w-4" />Generate Platinum Deck</>}
        </button>
      </div>
    </div>
  );
}
