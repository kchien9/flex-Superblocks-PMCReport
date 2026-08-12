import { useMemo } from "react";

type ViewMode = "sales" | "rko";

type HistoryRecord = {
  snapDate: string;
  rkoTeam: string;
  repName: string;
  dqPct: number;
  opps: number;
};

type RepLookup = {
  teamName: string;
  rkoTeam: string;
};

interface RankedRepTableProps {
  historyRecords: HistoryRecord[];
  repLookup: Map<string, RepLookup>;
  view: ViewMode;
  snapshotLabel?: string;
}

// Team dot colors for Sales Teams view
const SALES_TEAM_COLORS: Record<string, string> = {
  "Brandon's Team": "#F59E0B",
  "SMB Account Executives 1": "#3B82F6",
  "SMB Account Executives 2": "#8B5CF6",
  "Strategic Team": "#10B981",
};

// RKO team dot colors
const RKO_TEAM_COLORS: Record<string, string> = {
  Red: "#EF4444",
  Blue: "#3B82F6",
  Green: "#10B981",
};

function getDQColor(dq: number): string {
  if (dq >= 70) return "#16A34A";
  if (dq >= 50) return "#D97706";
  return "#DC2626";
}

export default function RankedRepTable({ historyRecords, repLookup, view, snapshotLabel }: RankedRepTableProps) {
  const rankedReps = useMemo(() => {
    if (!historyRecords.length) return [];

    // Find latest snapDate
    const dates = historyRecords.map((r) => r.snapDate);
    const latestDate = dates.sort().reverse()[0];
    const latest = new Date(latestDate + "T00:00:00");
    const cutoff = new Date(latest);
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    // Filter to trailing 90 days
    const trailing = historyRecords.filter((r) => r.snapDate >= cutoffStr);

    // Group by repName and compute average dqPct
    const repMap = new Map<string, number[]>();
    for (const r of trailing) {
      if (!repMap.has(r.repName)) repMap.set(r.repName, []);
      repMap.get(r.repName)!.push(r.dqPct);
    }

    // Compute averages and rank
    const ranked: { repName: string; avg90: number; teamName: string; rkoTeam: string }[] = [];
    for (const [repName, scores] of repMap) {
      const avg90 = scores.reduce((s, v) => s + v, 0) / scores.length;
      const lookup = repLookup.get(repName);
      ranked.push({
        repName,
        avg90: Math.round(avg90 * 10) / 10,
        teamName: lookup?.teamName ?? "Unknown",
        rkoTeam: lookup?.rkoTeam ?? "Unknown",
      });
    }

    ranked.sort((a, b) => b.avg90 - a.avg90);
    return ranked;
  }, [historyRecords, repLookup]);

  if (!rankedReps.length) return null;

  const colorMap = view === "sales" ? SALES_TEAM_COLORS : RKO_TEAM_COLORS;

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      {/* Section header */}
      <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-50">
        <h3 className="text-sm font-semibold text-gray-800">
          90-day average – all reps ranked
        </h3>
        <span className="text-[9px] font-bold uppercase tracking-wider bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
          snapshot
        </span>
        {snapshotLabel && (
          <span className="text-[10px] text-gray-400">as of {snapshotLabel}</span>
        )}
      </div>

      {/* Ranked list */}
      <div className="divide-y divide-gray-50">
        {rankedReps.map((rep, idx) => {
          const teamKey = view === "sales" ? rep.teamName : rep.rkoTeam;
          const dotColor = colorMap[teamKey] ?? "#9CA3AF";
          const barColor = getDQColor(rep.avg90);

          return (
            <div key={rep.repName} className="flex items-center gap-3 px-5 py-2">
              {/* Rank */}
              <span className="text-xs font-medium text-gray-400 w-5 text-right shrink-0">
                {idx + 1}
              </span>

              {/* Team dot */}
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: dotColor }}
                title={teamKey}
              />

              {/* Rep name */}
              <span className="text-xs text-gray-700 w-36 truncate shrink-0">
                {rep.repName}
              </span>

              {/* Bar */}
              <div className="flex-1 h-4 bg-gray-50 rounded-full overflow-hidden relative">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${Math.min(rep.avg90, 100)}%`, backgroundColor: barColor }}
                />
              </div>

              {/* Value */}
              <span
                className="text-xs font-semibold w-12 text-right shrink-0"
                style={{ color: barColor }}
              >
                {rep.avg90.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
