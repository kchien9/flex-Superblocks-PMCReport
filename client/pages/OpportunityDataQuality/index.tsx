import { useState, useMemo, useEffect, useRef } from "react";
import { useApiData } from "@/hooks/useApiData.js";
import { useApi } from "@/hooks/useApi.js";
import TeamCard from "@/components/OpportunityDQ/TeamCard";
import RankedRepTable from "@/components/OpportunityDQ/RankedRepTable";
import WeekOverWeekChart from "@/components/OpportunityDQ/WeekOverWeekChart";
import { Trophy } from "lucide-react";

type ViewMode = "sales" | "rko";

type Rep = {
  ownerName: string;
  teamName: string;
  rkoTeam: string;
  opps: number;
  repDQ: number;
};

type TeamGroup = {
  name: string;
  dq: number;
  reps: Rep[];
  isWinner: boolean;
};

const SALES_TEAM_ORDER = [
  "Brandon's Team",
  "SMB Account Executives 1",
  "SMB Account Executives 2",
  "Strategic Team",
];
const RKO_TEAM_ORDER = ["Red", "Blue", "Green"];

function weightedAvg(reps: Rep[]): number {
  const totalOpps = reps.reduce((s, r) => s + r.opps, 0);
  if (totalOpps === 0) return 0;
  return reps.reduce((s, r) => s + r.repDQ * r.opps, 0) / totalOpps;
}

export default function OpportunityDataQualityPage() {
  const [view, setView] = useState<ViewMode>("sales");
  const { data, loading, fetching } = useApiData("GetOpportunityDQLive", {});
  const { data: historyData, loading: historyLoading } = useApiData("GetOpportunityDQHistory", {});

  // Log page view on mount
  const { run: logActivity } = useApi("LogConsoleActivity");
  const loggedRef = useRef(false);
  useEffect(() => {
    if (!loggedRef.current) {
      loggedRef.current = true;
      logActivity({ module: "Opportunity Data Quality", action: "viewed" });
    }
  }, [logActivity]);

  // Compute latest snapshot date for badges
  const latestSnapshotLabel = useMemo(() => {
    if (!historyData?.records?.length) return "";
    const dates = historyData.records.map((r) => r.snapDate);
    const latest = dates.sort().reverse()[0];
    const d = new Date(latest + "T00:00:00");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[d.getMonth()]} ${d.getDate()}`;
  }, [historyData]);

  const EXCLUDED_REPS = ["Brandon Nicastro", "Spencer Kendall"];
  const records: Rep[] = (data?.records ?? []).filter(
    (r) => !EXCLUDED_REPS.includes(r.ownerName)
  );

  // Build rep lookup map for the ranked table (maps repName → team info)
  const repLookup = useMemo(() => {
    const map = new Map<string, { teamName: string; rkoTeam: string }>();
    for (const r of records) {
      map.set(r.ownerName, { teamName: r.teamName, rkoTeam: r.rkoTeam });
    }
    return map;
  }, [records]);

  // Group reps by team according to current view
  const teams: TeamGroup[] = useMemo(() => {
    if (!records.length) return [];

    const order = view === "sales" ? SALES_TEAM_ORDER : RKO_TEAM_ORDER;
    const key = view === "sales" ? "teamName" : "rkoTeam";

    const groups = new Map<string, Rep[]>();
    for (const name of order) {
      groups.set(name, []);
    }
    for (const rep of records) {
      const groupName = rep[key];
      if (groups.has(groupName)) {
        groups.get(groupName)!.push(rep);
      }
    }

    // Calculate team DQ (opps-weighted)
    const result: TeamGroup[] = [];
    let bestDQ = -1;
    let bestIdx = 0;

    for (const [name, reps] of groups) {
      if (reps.length === 0) continue;
      const dq = weightedAvg(reps);
      if (dq > bestDQ) {
        bestDQ = dq;
        bestIdx = result.length;
      }
      result.push({ name, dq, reps, isWinner: false });
    }

    if (result.length > 0) {
      result[bestIdx].isWinner = true;
    }

    return result;
  }, [records, view]);

  // Company-wide KPIs
  const companyDQ = useMemo(() => weightedAvg(records), [records]);
  const bestTeam = useMemo(() => teams.find((t) => t.isWinner), [teams]);
  const vsTarget = companyDQ - 80;

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ fontFamily: "Arial, sans-serif" }}>
      {/* Deep purple header */}
      <div
        className="flex items-center justify-between px-5 shrink-0"
        style={{ backgroundColor: "#2C194D", height: 56 }}
      >
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-white text-[15px] font-semibold leading-tight">
              Opportunity Data Quality
            </h1>
            <p className="text-white/50 text-[11px] leading-tight mt-0.5">
              Open pipeline · Building Value → Deal Review
            </p>
          </div>
          {/* Winner badge in header */}
          {bestTeam && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ backgroundColor: "rgba(106,61,184,0.4)" }}>
              <Trophy size={11} className="text-yellow-400" />
              <span className="text-[11px] text-white/90 font-medium">{bestTeam.name}</span>
            </div>
          )}
        </div>

        {/* View toggle */}
        <div className="flex items-center gap-1 p-0.5 rounded-lg" style={{ backgroundColor: "rgba(255,255,255,0.1)" }}>
          <button
            onClick={() => setView("sales")}
            className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
            style={{
              backgroundColor: view === "sales" ? "#6A3DB8" : "transparent",
              color: view === "sales" ? "white" : "rgba(255,255,255,0.7)",
            }}
          >
            Sales Teams
          </button>
          <button
            onClick={() => setView("rko")}
            className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
            style={{
              backgroundColor: view === "rko" ? "#6A3DB8" : "transparent",
              color: view === "rko" ? "white" : "rgba(255,255,255,0.7)",
            }}
          >
            RKO Teams
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto bg-[#F7F7F7] p-5">
        {loading ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 bg-white rounded-xl animate-pulse" />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-48 bg-white rounded-xl animate-pulse" />
              ))}
            </div>
          </div>
        ) : (
          <div className={`flex flex-col gap-4 ${fetching ? "opacity-70" : ""}`}>
            {/* Callout tiles */}
            <div className="grid grid-cols-3 gap-3">
              {/* Company DQ */}
              <div
                className="rounded-xl px-5 py-4 flex flex-col justify-center relative overflow-hidden"
                style={{ backgroundColor: "#2C194D" }}
              >
                <span className="absolute top-2 right-3 text-[9px] font-bold uppercase tracking-wider text-white/40 bg-white/10 px-1.5 py-0.5 rounded">
                  live
                </span>
                <span className="text-2xl font-bold text-white">
                  {companyDQ.toFixed(1)}%
                </span>
                <span className="text-[11px] text-white/60 mt-0.5">
                  Company DQ
                </span>
                <span className="text-[10px] text-white/40 mt-1">
                  Target: 80% · {vsTarget >= 0 ? `${vsTarget.toFixed(1)} pts above` : `${Math.abs(vsTarget).toFixed(1)} pts below`}
                </span>
              </div>

              {/* Best Team */}
              <div className="bg-white rounded-xl px-5 py-4 flex flex-col justify-center border border-gray-100">
                <span className="text-2xl font-bold" style={{ color: "#6A3DB8" }}>
                  {bestTeam ? `${bestTeam.dq.toFixed(1)}%` : "—"}
                </span>
                <span className="text-[11px] text-gray-500 mt-0.5">
                  Best Team
                </span>
                <span className="text-[10px] text-gray-400 mt-1 flex items-center gap-1">
                  <Trophy size={10} className="text-yellow-500" />
                  {bestTeam?.name ?? "—"}
                </span>
              </div>

              {/* vs. Target */}
              <div className="bg-white rounded-xl px-5 py-4 flex flex-col justify-center border border-gray-100">
                <span
                  className="text-2xl font-bold"
                  style={{ color: vsTarget >= 0 ? "#16A34A" : "#DC2626" }}
                >
                  {vsTarget >= 0 ? "+" : ""}{vsTarget.toFixed(1)} pts
                </span>
                <span className="text-[11px] text-gray-500 mt-0.5">
                  vs. Target (80%)
                </span>
                <span
                  className="text-[10px] mt-1"
                  style={{ color: vsTarget >= 0 ? "#16A34A" : "#DC2626" }}
                >
                  {vsTarget >= 0 ? "On track ✓" : "Below target ⚠"}
                </span>
              </div>
            </div>

            {/* Team cards */}
            <div className={`grid gap-4 ${view === "sales" ? "grid-cols-2" : "grid-cols-3"}`}>
              {teams.map((team) => (
                <TeamCard key={team.name} group={team} />
              ))}
            </div>

            {/* 90-day ranked table */}
            {historyLoading ? (
              <div className="h-40 bg-white rounded-xl animate-pulse" />
            ) : historyData?.records?.length ? (
              <RankedRepTable
                historyRecords={historyData.records.filter(
                  (r) => !EXCLUDED_REPS.includes(r.repName)
                )}
                repLookup={repLookup}
                view={view}
                snapshotLabel={latestSnapshotLabel}
              />
            ) : null}

            {/* Week over week trend chart */}
            {historyLoading ? (
              <div className="h-64 bg-white rounded-xl animate-pulse" />
            ) : historyData?.records?.length ? (
              <WeekOverWeekChart
                historyRecords={historyData.records.filter(
                  (r) => !EXCLUDED_REPS.includes(r.repName)
                )}
                view={view}
                snapshotLabel={latestSnapshotLabel}
              />
            ) : null}

            {fetching && (
              <div className="text-xs text-center text-gray-400 mt-1">Updating…</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
