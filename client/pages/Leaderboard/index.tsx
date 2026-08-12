import { useState, useCallback, useEffect, useMemo } from "react";
import { useApiData } from "@/hooks/useApiData.js";
import { useCountUp } from "../../hooks/useCountUp";
import { RefreshCw, TrendingUp } from "lucide-react";

const PERIODS = ["This Month", "Last Month", "This Quarter"] as const;

type RepData = {
  name: string;
  initials: string;
  email: string;
  team: string;
  closedWon: number;
  pipeline: number;
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// --- Sub-components ---
function AnimatedUnits({ target, delay = 0, className }: { target: number; delay?: number; className?: string }) {
  const value = useCountUp(target, 1000, delay);
  return <span className={className}>{value.toLocaleString()}</span>;
}

function BarFillInner({ pct, delay }: { pct: number; delay: number }) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setWidth(pct), delay + 100);
    return () => clearTimeout(t);
  }, [pct, delay]);

  return (
    <div className="w-[200px] h-2 rounded-full bg-[#EEE2FC] overflow-hidden">
      <div
        className="h-full rounded-full bg-[#6A3DB8] transition-all duration-[800ms] ease-out"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

function FilterBar({
  period,
  setPeriod,
  team,
  setTeam,
  teams,
  refreshing,
  onRefresh,
}: {
  period: string;
  setPeriod: (p: string) => void;
  team: string;
  setTeam: (t: string) => void;
  teams: string[];
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-center justify-between bg-white border-b border-[#E5E7EB] px-5 py-3">
      {/* Period toggle */}
      <div className="flex gap-1">
        {PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors ${
              period === p
                ? "bg-[#6A3DB8] text-white"
                : "bg-white text-[#6B7280] border border-[#E5E7EB] hover:bg-gray-50"
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3">
        {/* Team filter */}
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-[#6B7280]">Team:</span>
          <select
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            className="bg-white border border-[#E5E7EB] rounded-lg px-3 py-1.5 text-[13px] text-[#1D1D1D] outline-none focus:ring-1 focus:ring-[#6A3DB8]"
          >
            <option value="All Teams">All Teams</option>
            {teams.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        {/* Refresh button */}
        <button
          onClick={onRefresh}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E5E7EB] text-[#6B7280] hover:bg-gray-50 transition-colors text-[13px]"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>
    </div>
  );
}

function SummaryStrip({ totalClosed, totalPipeline, period }: { totalClosed: number; totalPipeline: number; period: string }) {
  return (
    <div className="flex items-center justify-center h-10 bg-[#EEE2FC] w-full">
      <p className="text-[13px] text-[#6A3DB8] font-medium">
        Total Closed Units: <span className="font-bold">{totalClosed.toLocaleString()}</span>  ·  Total Pipeline: <span className="font-bold">{totalPipeline.toLocaleString()} units</span>  ·  {period}  ·  Flex Rent
      </p>
    </div>
  );
}

function Podium({ reps }: { reps: RepData[] }) {
  const first = reps[0];
  const second = reps[1];
  const third = reps[2];

  if (!first) return null;

  return (
    <div className="bg-[#F9FAFB] rounded-2xl p-4">
      <div className="flex items-end gap-2">
        {/* #2 — Silver (left) */}
        <div className="flex flex-col items-center" style={{ width: "30%" }}>
          {second ? (
            <>
              <div
                className="bg-white rounded-xl p-3 text-center w-full mb-1.5"
                style={{ boxShadow: "0 4px 16px rgba(44,25,77,0.12)" }}
              >
                <div className="w-9 h-9 rounded-full bg-[#2C194D] flex items-center justify-center mx-auto">
                  <span className="text-white text-[13px] font-bold">{second.initials}</span>
                </div>
                <h3 className="text-[14px] font-bold text-[#1D1D1D] mt-1.5">{second.name}</h3>
                <p className="text-[10px] text-[#6B7280]">{second.team}</p>
                <AnimatedUnits target={second.closedWon} className="text-[26px] font-bold text-[#6A3DB8] block mt-0.5" />
                <p className="text-[11px] text-[#6B7280]">↗ {second.pipeline.toLocaleString()} in pipeline</p>
              </div>
              <div className="w-full h-[44px] bg-[#C0C0C0] rounded-t-lg flex items-center justify-center">
                <span className="text-[#1D1D1D] text-[18px] font-bold">#2</span>
              </div>
            </>
          ) : (
            <div className="w-full h-[44px]" />
          )}
        </div>

        {/* #1 — Gold (center, tallest) */}
        <div className="flex flex-col items-center" style={{ width: "38%" }}>
          <div
            className="bg-white rounded-xl p-3 text-center w-full mb-1.5"
            style={{ boxShadow: "0 4px 16px rgba(44,25,77,0.12)" }}
          >
            <span className="text-[16px] block">🏆</span>
            <div className="w-9 h-9 rounded-full bg-[#2C194D] flex items-center justify-center mx-auto mt-0.5">
              <span className="text-white text-[14px] font-bold">{first.initials}</span>
            </div>
            <h3 className="text-[14px] font-bold text-[#1D1D1D] mt-1.5">{first.name}</h3>
            <p className="text-[10px] text-[#6B7280]">{first.team}</p>
            <AnimatedUnits target={first.closedWon} className="text-[34px] font-bold text-[#6A3DB8] block mt-0.5" />
            <p className="text-[10px] text-[#6B7280] uppercase tracking-wide">units closed</p>
            <p className="text-[11px] text-[#6B7280]">↗ {first.pipeline.toLocaleString()} in pipeline</p>
          </div>
          <div
            className="w-full h-[64px] rounded-t-lg flex items-center justify-center"
            style={{ background: "linear-gradient(180deg, #6A3DB8 0%, #2C194D 100%)" }}
          >
            <span className="text-white text-[24px] font-bold">#1</span>
          </div>
        </div>

        {/* #3 — Bronze (right) */}
        <div className="flex flex-col items-center" style={{ width: "30%" }}>
          {third ? (
            <>
              <div
                className="bg-white rounded-xl p-3 text-center w-full mb-1.5"
                style={{ boxShadow: "0 4px 16px rgba(44,25,77,0.12)" }}
              >
                <div className="w-9 h-9 rounded-full bg-[#2C194D] flex items-center justify-center mx-auto">
                  <span className="text-white text-[13px] font-bold">{third.initials}</span>
                </div>
                <h3 className="text-[14px] font-bold text-[#1D1D1D] mt-1.5">{third.name}</h3>
                <p className="text-[10px] text-[#6B7280]">{third.team}</p>
                <AnimatedUnits target={third.closedWon} className="text-[26px] font-bold text-[#6A3DB8] block mt-0.5" />
                <p className="text-[11px] text-[#6B7280]">↗ {third.pipeline.toLocaleString()} in pipeline</p>
              </div>
              <div className="w-full h-[32px] bg-[#CD7F32] rounded-t-lg flex items-center justify-center">
                <span className="text-white text-[16px] font-bold">#3</span>
              </div>
            </>
          ) : (
            <div className="w-full h-[32px]" />
          )}
        </div>
      </div>

      {/* Base bar */}
      <div className="w-full h-3 bg-[#EEE2FC] rounded-b-lg" />
    </div>
  );
}

function RankedTable({ reps, maxUnits }: { reps: RepData[]; maxUnits: number }) {
  // Show ranks 4+ in the table
  const tableReps = reps.slice(3);

  if (tableReps.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
      <p className="text-[11px] text-[#6B7280] uppercase tracking-wider font-medium mb-4">Full Rankings</p>

      {/* Header */}
      <div className="grid grid-cols-[48px_1fr_160px_100px_100px_200px] items-center h-10 border-b border-[#E5E7EB] text-[11px] text-[#6B7280] uppercase tracking-wider font-medium">
        <span>Rank</span>
        <span>Rep</span>
        <span>Team</span>
        <span>Closed</span>
        <span>Pipeline</span>
        <span>Bar</span>
      </div>

      {/* Rows */}
      {tableReps.map((rep, idx) => {
        const rank = idx + 4;
        return (
          <div
            key={rep.email}
            className={`grid grid-cols-[48px_1fr_160px_100px_100px_200px] items-center h-12 border-b border-[#F3F4F6] ${
              idx % 2 === 1 ? "bg-[#F9FAFB]" : ""
            }`}
          >
            <span className="text-[14px] text-[#6B7280]">{rank}</span>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-[#EEE2FC] flex items-center justify-center">
                <span className="text-[#6A3DB8] text-[11px] font-bold">{rep.initials}</span>
              </div>
              <span className="text-[14px] font-bold text-[#1D1D1D]">{rep.name}</span>
            </div>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[#F3F4F6] text-[12px] text-[#6B7280] w-fit truncate max-w-[150px]">
              {rep.team}
            </span>
            <AnimatedUnits target={rep.closedWon} delay={50 * idx} className="text-[15px] font-bold text-[#1D1D1D]" />
            <span className="text-[13px] text-[#6B7280]">{rep.pipeline.toLocaleString()}</span>
            <BarFillInner pct={maxUnits > 0 ? (rep.closedWon / maxUnits) * 100 : 0} delay={100 + 50 * idx} />
          </div>
        );
      })}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4 p-5">
      {/* Podium skeleton */}
      <div className="bg-[#F9FAFB] rounded-2xl p-4">
        <div className="flex items-end gap-2">
          <div className="flex flex-col items-center" style={{ width: "30%" }}>
            <div className="w-full h-[140px] bg-gray-100 rounded-xl animate-pulse" />
            <div className="w-full h-[44px] bg-gray-200 rounded-t-lg mt-1.5 animate-pulse" />
          </div>
          <div className="flex flex-col items-center" style={{ width: "38%" }}>
            <div className="w-full h-[180px] bg-gray-100 rounded-xl animate-pulse" />
            <div className="w-full h-[64px] bg-gray-200 rounded-t-lg mt-1.5 animate-pulse" />
          </div>
          <div className="flex flex-col items-center" style={{ width: "30%" }}>
            <div className="w-full h-[140px] bg-gray-100 rounded-xl animate-pulse" />
            <div className="w-full h-[32px] bg-gray-200 rounded-t-lg mt-1.5 animate-pulse" />
          </div>
        </div>
      </div>
      {/* Table skeleton */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] p-5 space-y-3">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
        ))}
      </div>
    </div>
  );
}

// --- Main Page ---
export default function Leaderboard() {
  const [period, setPeriod] = useState<string>("This Month");
  const [team, setTeam] = useState<string>("All Teams");

  // Fetch closed won data
  const {
    data: closedWonData,
    loading: closedWonLoading,
    fetching: closedWonFetching,
    refetch: refetchClosedWon,
  } = useApiData("GetLeaderboardClosedWon", { period });

  // Fetch pipeline data
  const {
    data: pipelineData,
    loading: pipelineLoading,
    fetching: pipelineFetching,
    refetch: refetchPipeline,
  } = useApiData("GetLeaderboardPipeline", { period });

  const isLoading = closedWonLoading || pipelineLoading;
  const isFetching = closedWonFetching || pipelineFetching;

  const handleRefresh = useCallback(() => {
    refetchClosedWon();
    refetchPipeline();
  }, [refetchClosedWon, refetchPipeline]);

  // Aggregate by rep
  const reps = useMemo((): RepData[] => {
    const closedOpps = closedWonData?.opportunities ?? [];
    const pipelineOpps = pipelineData?.opportunities ?? [];

    const repMap = new Map<string, RepData>();

    for (const opp of closedOpps) {
      const existing = repMap.get(opp.ownerName);
      if (existing) {
        existing.closedWon += opp.flexUnits;
      } else {
        repMap.set(opp.ownerName, {
          name: opp.ownerName,
          initials: getInitials(opp.ownerName),
          email: opp.ownerEmail,
          team: opp.teamName,
          closedWon: opp.flexUnits,
          pipeline: 0,
        });
      }
    }

    for (const opp of pipelineOpps) {
      const existing = repMap.get(opp.ownerName);
      if (existing) {
        existing.pipeline += opp.flexUnits;
      } else {
        repMap.set(opp.ownerName, {
          name: opp.ownerName,
          initials: getInitials(opp.ownerName),
          email: opp.ownerEmail,
          team: opp.teamName,
          closedWon: 0,
          pipeline: opp.flexUnits,
        });
      }
    }

    return Array.from(repMap.values()).sort((a, b) => b.closedWon - a.closedWon);
  }, [closedWonData, pipelineData]);

  // Get distinct teams from results
  const teams = useMemo(() => {
    const teamSet = new Set<string>();
    for (const rep of reps) {
      if (rep.team && rep.team !== "Unassigned") teamSet.add(rep.team);
    }
    return Array.from(teamSet).sort();
  }, [reps]);

  // Filter by team
  const filteredReps = useMemo(() => {
    if (team === "All Teams") return reps;
    return reps.filter((r) => r.team === team);
  }, [reps, team]);

  // Totals
  const totalClosed = useMemo(() => filteredReps.reduce((s, r) => s + r.closedWon, 0), [filteredReps]);
  const totalPipeline = useMemo(() => filteredReps.reduce((s, r) => s + r.pipeline, 0), [filteredReps]);
  const maxUnits = filteredReps.length > 0 ? filteredReps[0].closedWon : 0;

  return (
    <div className="flex flex-col h-full">
      <FilterBar
        period={period}
        setPeriod={setPeriod}
        team={team}
        setTeam={setTeam}
        teams={teams}
        refreshing={isFetching}
        onRefresh={handleRefresh}
      />
      <SummaryStrip totalClosed={totalClosed} totalPipeline={totalPipeline} period={period} />

      <div className="flex-1 overflow-y-auto bg-[#F7F7F7]">
        {isLoading ? (
          <LoadingSkeleton />
        ) : filteredReps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-3">
            <TrendingUp size={32} />
            <span className="text-sm font-medium">No data for this period</span>
            <span className="text-xs">Try selecting a different period or team filter</span>
          </div>
        ) : (
          <div className={`p-5 space-y-4 ${isFetching && !isLoading ? "opacity-70" : ""}`}>
            {isFetching && !isLoading && (
              <div className="text-xs text-center text-gray-500">Updating…</div>
            )}
            <Podium reps={filteredReps} />
            <RankedTable reps={filteredReps} maxUnits={maxUnits} />
          </div>
        )}
      </div>
    </div>
  );
}
