import { useMemo } from "react";
import { useApiData } from "@/hooks/useApiData.js";
import { AlertTriangle } from "lucide-react";

type SupportHealth = {
  openTickets: number;
  ticketsLastMonth: number;
  ticketsPriorMonth: number;
  momChange: number;
  momChangePct: number | null;
  residentIssuePct: number;
  totalTickets3mo: number;
  avgCsat: number | null;
};

type Ticket = {
  ticketId: string;
  createdAt: string;
  status: string;
  category: string | null;
  subject: string | null;
  csatScore: number | null;
};

function formatCategory(raw: string | null): string {
  if (!raw) return "—";
  return raw
    .replace(/^ph_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const styles: Record<string, { bg: string; color: string }> = {
    new: { bg: "#DBEAFE", color: "#1D4ED8" },
    open: { bg: "#DBEAFE", color: "#1D4ED8" },
    pending: { bg: "#FEF3C7", color: "#D97706" },
    solved: { bg: "#D1FAE5", color: "#059669" },
    closed: { bg: "#F3F4F6", color: "#6B7280" },
  };
  const { bg, color } = styles[s] || styles.closed;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium"
      style={{ backgroundColor: bg, color }}
    >
      {status}
    </span>
  );
}

function CsatDisplay({ score }: { score: number | null }) {
  if (score === null) return <span className="text-gray-400">—</span>;
  if (score >= 4) return <span>👍</span>;
  if (score <= 2) return <span>👎</span>;
  return <span className="text-gray-500">{score}</span>;
}

function CsatMetric({ value }: { value: number | null }) {
  if (value === null) return <span className="text-gray-400">—</span>;
  const color = value >= 4.0 ? "#059669" : value >= 3.0 ? "#D97706" : "#DC2626";
  return <span style={{ color, fontWeight: 700 }}>{value.toFixed(1)}</span>;
}

export default function ZendeskTicketsView({ pmcId }: { pmcId: string }) {
  // Support health summary
  const { data: healthData, loading: healthLoading } = useApiData(
    "GetPMCSupportHealth",
    { pmc_ids_json: JSON.stringify([pmcId]) },
    { enabled: !!pmcId }
  );

  // Individual tickets
  const { data: ticketData, loading: ticketsLoading } = useApiData(
    "GetPMCTicketList",
    { pmc_id: pmcId },
    { enabled: !!pmcId }
  );

  const health: SupportHealth | null = useMemo(() => {
    if (!healthData?.lookup) return null;
    return healthData.lookup[pmcId] || null;
  }, [healthData, pmcId]);

  const tickets: Ticket[] = ticketData?.tickets || [];

  // Warning banner logic
  const showWarning = useMemo(() => {
    if (!health) return false;
    const residentIssueAndDecline = health.residentIssuePct > 0.4 && health.momChange < 0;
    const ticketSpike = health.momChange > health.ticketsPriorMonth;
    return residentIssueAndDecline || ticketSpike;
  }, [health]);

  const warningMessage = useMemo(() => {
    if (!health) return "";
    if (health.momChange > health.ticketsPriorMonth) {
      return `Ticket volume spiked: ${health.ticketsLastMonth} last month vs ${health.ticketsPriorMonth} prior month (+${health.momChange}).`;
    }
    return `High resident issue rate (${(health.residentIssuePct * 100).toFixed(0)}%) with declining ticket volume — possible under-reporting.`;
  }, [health]);

  if (healthLoading || ticketsLoading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-20 bg-white border border-gray-200 rounded-xl animate-pulse" />
        <div className="h-64 bg-white border border-gray-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Summary Strip */}
      <div
        className="grid grid-cols-5 gap-0 divide-x divide-gray-200"
        style={{ backgroundColor: "white", border: "1px solid #E5E7EB", borderRadius: 12, padding: "16px 0" }}
      >
        <SummaryCell label="Open Tickets" value={health?.openTickets ?? 0} />
        <SummaryCell label="Last Month" value={health?.ticketsLastMonth ?? 0} />
        <SummaryCell label="Total (3mo)" value={health?.totalTickets3mo ?? 0} />
        <div className="flex flex-col items-center gap-1 px-4">
          <span className="text-[10px] uppercase text-gray-500 font-medium tracking-wide">MoM Change</span>
          {health ? (
            <span
              className="text-lg font-bold"
              style={{ color: health.momChange > 0 ? "#DC2626" : health.momChange < 0 ? "#059669" : "#6B7280" }}
            >
              {health.momChange > 0 ? "+" : ""}{health.momChange}
            </span>
          ) : (
            <span className="text-lg font-bold text-gray-400">—</span>
          )}
        </div>
        <div className="flex flex-col items-center gap-1 px-4">
          <span className="text-[10px] uppercase text-gray-500 font-medium tracking-wide">CSAT</span>
          <span className="text-lg"><CsatMetric value={health?.avgCsat ?? null} /></span>
        </div>
      </div>

      {/* Warning Banner */}
      {showWarning && (
        <div
          className="flex items-start gap-2 px-4 py-3 rounded-lg"
          style={{ backgroundColor: "#FEF3C7", border: "1px solid #FDE68A" }}
        >
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" style={{ color: "#D97706" }} />
          <span style={{ fontSize: 13, color: "#92400E" }}>{warningMessage}</span>
        </div>
      )}

      {/* Tickets Table */}
      <div style={{ backgroundColor: "white", border: "1px solid #E5E7EB", borderRadius: 12, padding: "16px 20px" }}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] uppercase text-gray-500 font-medium tracking-wide">
            Tickets ({tickets.length})
          </span>
        </div>

        {tickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <span className="text-3xl">🎫</span>
            <span className="text-sm text-gray-400">No tickets in the last 3 months</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left" style={{ fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #E5E7EB" }}>
                  <th className="py-2 px-2 font-medium text-gray-500 text-[11px] uppercase">Date</th>
                  <th className="py-2 px-2 font-medium text-gray-500 text-[11px] uppercase">Status</th>
                  <th className="py-2 px-2 font-medium text-gray-500 text-[11px] uppercase">Category</th>
                  <th className="py-2 px-2 font-medium text-gray-500 text-[11px] uppercase">Subject</th>
                  <th className="py-2 px-2 font-medium text-gray-500 text-[11px] uppercase text-center">CSAT</th>
                  <th className="py-2 px-2 font-medium text-gray-500 text-[11px] uppercase text-right">Link</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t, i) => (
                  <tr
                    key={t.ticketId}
                    style={{ height: 44, borderBottom: "1px solid #F3F4F6", backgroundColor: i % 2 === 1 ? "#F9FAFB" : "white" }}
                  >
                    <td className="px-2 py-2 text-gray-700 whitespace-nowrap">{formatDate(t.createdAt)}</td>
                    <td className="px-2 py-2"><StatusBadge status={t.status} /></td>
                    <td className="px-2 py-2 text-gray-700">{formatCategory(t.category)}</td>
                    <td className="px-2 py-2 text-gray-900 max-w-[300px] truncate">{t.subject || "—"}</td>
                    <td className="px-2 py-2 text-center"><CsatDisplay score={t.csatScore} /></td>
                    <td className="px-2 py-2 text-right">
                      <a
                        href={`https://getflex.zendesk.com/agent/tickets/${t.ticketId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[12px] font-medium hover:underline"
                        style={{ color: "#6A3DB8" }}
                      >
                        #{t.ticketId} ↗
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4">
      <span className="text-[10px] uppercase text-gray-500 font-medium tracking-wide">{label}</span>
      <span className="text-lg font-bold text-gray-900">{value}</span>
    </div>
  );
}
