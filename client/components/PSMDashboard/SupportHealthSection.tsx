import { useState } from "react";
import { ChevronDown, ChevronRight, Ticket, AlertTriangle } from "lucide-react";

export type SupportHealthData = {
  openTickets: number;
  ticketsLastMonth: number;
  ticketsPriorMonth: number;
  momChange: number;
  momChangePct: number | null;
  residentIssuePct: number;
  bankChangePct: number;
  totalTickets3mo: number;
  avgCsat: number | null;
  topCategory: string | null;
};

type Props = {
  data: SupportHealthData | null;
  trendDelta: number;
};

function formatCategory(raw: string | null): string {
  if (!raw) return "Unknown";
  // Remove "ph_" prefix and convert underscores to spaces, title case
  const cleaned = raw.replace(/^ph_/, "").replace(/_/g, " ");
  return cleaned
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function SupportHealthSection({ data, trendDelta }: Props) {
  const [expanded, setExpanded] = useState(false);

  // Warning condition: ticket friction + NAR declining OR tickets more than doubled
  const showWarning =
    data &&
    ((data.residentIssuePct > 0.4 && trendDelta < 0) ||
      (data.momChange > data.ticketsPriorMonth));

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      {/* Header toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full text-left group"
      >
        <Ticket size={12} style={{ color: "#6B7280" }} />
        <span
          className="text-[10px] uppercase tracking-wider font-semibold"
          style={{ color: "#6B7280" }}
        >
          Support Health
        </span>
        {expanded ? (
          <ChevronDown size={12} style={{ color: "#6B7280" }} />
        ) : (
          <ChevronRight size={12} style={{ color: "#6B7280" }} />
        )}
        {/* Quick indicator when collapsed */}
        {!expanded && data && data.openTickets > 0 && (
          <span className="ml-auto text-[10px] text-gray-400">
            {data.openTickets} open
          </span>
        )}
      </button>

      {expanded && (
        <div className="mt-2.5 flex flex-col gap-2.5">
          {!data ? (
            <p className="text-xs italic" style={{ color: "#6B7280" }}>
              No ticket data available
            </p>
          ) : (
            <>
              {/* Warning banner */}
              {showWarning && (
                <div
                  className="flex items-center gap-2 px-3 py-2 rounded-md text-[11px]"
                  style={{ backgroundColor: "#FEF3C7", color: "#92400E" }}
                >
                  <AlertTriangle size={12} style={{ color: "#F59E0B" }} />
                  <span>
                    ⚠ Support signal may be impacting NAR — review before
                    running activation campaigns.
                  </span>
                </div>
              )}

              {/* Row 1: Open tickets + MoM */}
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-bold text-gray-900">
                  Open tickets: {data.openTickets}
                </span>
                <MoMBadge momChange={data.momChange} />
              </div>

              {/* Row 2: Resident issue rate bar */}
              <div>
                <div className="flex items-center gap-2">
                  <div
                    className="flex-1 h-2 rounded-full overflow-hidden"
                    style={{ backgroundColor: "#F3F4F6" }}
                  >
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(data.residentIssuePct * 100, 100)}%`,
                        backgroundColor: getIssueBarColor(data.residentIssuePct),
                      }}
                    />
                  </div>
                </div>
                <span className="text-[12px]" style={{ color: "#6B7280" }}>
                  Resident issues: {(data.residentIssuePct * 100).toFixed(0)}% of
                  tickets
                </span>
              </div>

              {/* Row 3: CSAT + Top category */}
              <div className="flex items-center justify-between">
                <CsatDisplay value={data.avgCsat} />
                {data.topCategory && (
                  <span
                    className="px-2 py-0.5 text-[10px] rounded-full"
                    style={{
                      backgroundColor: "#F3F4F6",
                      color: "#6B7280",
                    }}
                  >
                    {formatCategory(data.topCategory)}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MoMBadge({ momChange }: { momChange: number }) {
  if (momChange > 0) {
    return (
      <span className="text-[11px] font-medium" style={{ color: "#DC2626" }}>
        ↑ +{momChange} this month
      </span>
    );
  }
  if (momChange < 0) {
    return (
      <span className="text-[11px] font-medium" style={{ color: "#16A34A" }}>
        ↓ {momChange} this month
      </span>
    );
  }
  return (
    <span className="text-[11px] font-medium" style={{ color: "#6B7280" }}>
      — flat
    </span>
  );
}

function CsatDisplay({ value }: { value: number | null }) {
  if (value == null) {
    return (
      <span className="text-[12px]" style={{ color: "#6B7280" }}>
        CSAT: —
      </span>
    );
  }
  let color = "#DC2626"; // red < 3.0
  if (value >= 4.0) color = "#16A34A";
  else if (value >= 3.0) color = "#F59E0B";

  return (
    <span className="text-[12px] font-medium" style={{ color }}>
      CSAT: {value.toFixed(1)} / 5
    </span>
  );
}

function getIssueBarColor(pct: number): string {
  if (pct > 0.4) return "#DC2626";
  if (pct > 0.2) return "#F59E0B";
  return "#16A34A";
}
