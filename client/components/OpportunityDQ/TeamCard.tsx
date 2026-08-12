import { useMemo } from "react";
import { Star } from "lucide-react";

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

type Props = {
  group: TeamGroup;
};

function dqColor(dq: number): string {
  if (dq >= 70) return "#16A34A";
  if (dq >= 50) return "#D97706";
  return "#DC2626";
}

export default function TeamCard({ group }: Props) {
  const sortedReps = useMemo(
    () => [...group.reps].sort((a, b) => b.repDQ - a.repDQ),
    [group.reps]
  );

  return (
    <div
      className="bg-white rounded-xl overflow-hidden"
      style={{
        border: group.isWinner ? "2px solid #6A3DB8" : "1px solid #E5E7EB",
      }}
    >
      {/* Card header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">{group.name}</span>
          {group.isWinner && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full text-white"
              style={{ backgroundColor: "#6A3DB8" }}
            >
              ★ Team of the week
            </span>
          )}
        </div>
        <span
          className="text-lg font-bold"
          style={{ color: dqColor(group.dq) }}
        >
          {group.dq.toFixed(1)}%
        </span>
      </div>

      {/* Rep list */}
      <div className="px-4 py-2">
        {sortedReps.map((rep, idx) => (
          <div
            key={rep.ownerName}
            className="flex items-center gap-2 py-1.5"
          >
            {/* Star for top rep */}
            <div className="w-4 flex-shrink-0 flex items-center justify-center">
              {idx === 0 ? (
                <Star size={12} fill="#F59E0B" stroke="#F59E0B" />
              ) : (
                <span className="text-[10px] text-gray-400">{idx + 1}</span>
              )}
            </div>

            {/* Name */}
            <span className="text-xs text-gray-700 w-32 truncate flex-shrink-0">
              {rep.ownerName}
            </span>

            {/* Bar */}
            <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden relative">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(rep.repDQ, 100)}%`,
                  backgroundColor: dqColor(rep.repDQ),
                  opacity: 0.8,
                }}
              />
            </div>

            {/* Score */}
            <span
              className="text-xs font-semibold w-12 text-right flex-shrink-0"
              style={{ color: dqColor(rep.repDQ) }}
            >
              {rep.repDQ.toFixed(1)}%
            </span>

            {/* Opps count */}
            <span className="text-[10px] text-gray-400 w-8 text-right flex-shrink-0">
              {rep.opps} opp{rep.opps !== 1 ? "s" : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
