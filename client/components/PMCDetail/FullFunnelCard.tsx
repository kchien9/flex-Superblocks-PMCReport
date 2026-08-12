import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

type FunnelData = {
  rolledOut: number;
  engaged: number;
  signups: number;
  initiations: number;
  billsPaid: number;
};

type MonthlyRow = {
  BP_MONTH: string;
  ROLLED_OUT: number;
  BILLS_PAID_COUNT: number;
};

type Props = {
  funnel: FunnelData;
  rawRows: MonthlyRow[];
};

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatMonthLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return MONTH_NAMES[d.getMonth()];
}

function formatMonthFull(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

export default function FullFunnelCard({ funnel, rawRows }: Props) {
  // Determine most recent month from raw data
  const latestMonth = useMemo(() => {
    if (!rawRows.length) return "";
    const months = rawRows.map((r) => r.BP_MONTH);
    months.sort((a, b) => b.localeCompare(a));
    return months[0];
  }, [rawRows]);

  const headerLabel = latestMonth ? formatMonthFull(latestMonth).toUpperCase() : "";

  // Build monthly NAR trend from raw rows
  const chartData = useMemo(() => {
    const byMonth = new Map<string, { totalRolled: number; totalBills: number }>();
    for (const row of rawRows) {
      const existing = byMonth.get(row.BP_MONTH) || { totalRolled: 0, totalBills: 0 };
      existing.totalRolled += row.ROLLED_OUT;
      existing.totalBills += row.BILLS_PAID_COUNT;
      byMonth.set(row.BP_MONTH, existing);
    }
    const entries = Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    return entries.map(([month, { totalRolled, totalBills }]) => ({
      month,
      label: formatMonthFull(month),
      nar: totalRolled > 0 ? (totalBills / totalRolled) * 100 : 0,
    }));
  }, [rawRows]);

  const minNar = useMemo(() => {
    if (!chartData.length) return 0;
    const min = Math.min(...chartData.map((d) => d.nar));
    return Math.max(0, Math.floor(min - 2));
  }, [chartData]);

  const maxNar = useMemo(() => {
    if (!chartData.length) return 12;
    const max = Math.max(...chartData.map((d) => d.nar));
    return Math.ceil(max + 2);
  }, [chartData]);

  const stages = [
    { label: "ROLLED OUT", value: funnel.rolledOut, highlight: false },
    { label: "ENGAGED", value: funnel.engaged, highlight: false },
    { label: "NEW SIGNUPS", value: funnel.signups, highlight: false },
    { label: "BP INITS", value: funnel.initiations, highlight: false },
    { label: "BILLS PAID", value: funnel.billsPaid, highlight: true },
  ];

  return (
    <div
      style={{
        backgroundColor: "white",
        border: "1px solid #E5E7EB",
        borderRadius: 12,
        padding: 24,
      }}
    >
      {/* Card header */}
      <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", marginBottom: 20 }}>
        FULL FUNNEL — {headerLabel}
      </div>

      {/* Funnel stages */}
      <div className="flex items-center w-full">
        {stages.map((stage, i) => (
          <div key={stage.label} className="flex items-center" style={{ flex: i < stages.length - 1 ? 1 : undefined }}>
            {/* Stage box */}
            <div
              className="flex flex-col items-center justify-center"
              style={{
                backgroundColor: stage.highlight ? "#2C194D" : "#F5F0FE",
                borderRadius: 10,
                padding: "16px 20px",
                minWidth: 110,
              }}
            >
              <span style={{ fontSize: 18, fontWeight: 700, color: stage.highlight ? "white" : "#2C194D" }}>
                {stage.value.toLocaleString()}
              </span>
              <span style={{ fontSize: 11, color: stage.highlight ? "rgba(255,255,255,0.8)" : "#6B7280", textTransform: "uppercase", marginTop: 4 }}>
                {stage.label}
              </span>
            </div>

            {/* Arrow with conversion % */}
            {i < stages.length - 1 && (
              <div className="flex flex-col items-center justify-center flex-1 min-w-[40px]">
                <ConversionArrow upstream={stage.value} downstream={stages[i + 1].value} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* NAR Trend Chart */}
      {chartData.length > 1 && (
        <div style={{ marginTop: 16 }}>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid horizontal vertical={false} strokeDasharray="4 4" stroke="#F3F4F6" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "#6B7280" }}
                axisLine={false}
                tickLine={false}
                interval={0}
                angle={-20}
                dy={6}
              />
              <YAxis
                domain={[minNar, maxNar]}
                tick={{ fontSize: 11, fill: "#6B7280" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `${v}%`}
                width={44}
              />
              <ReferenceLine
                y={10}
                stroke="#F59E0B"
                strokeDasharray="4 4"
                strokeWidth={1.5}
              />
              <Tooltip content={<NarTooltip />} />
              <Line
                type="monotone"
                dataKey="nar"
                stroke="#6A3DB8"
                strokeWidth={2}
                dot={{ r: 3, fill: "#6A3DB8", stroke: "white", strokeWidth: 1.5 }}
                activeDot={{ r: 5, fill: "#6A3DB8", stroke: "white", strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function ConversionArrow({ upstream, downstream }: { upstream: number; downstream: number }) {
  const showPct = upstream > 0 && downstream <= upstream;
  const pct = upstream > 0 ? Math.round((downstream / upstream) * 100) : 0;

  return (
    <div className="flex flex-col items-center gap-0.5">
      {showPct && (
        <span style={{ fontSize: 12, color: "#6A3DB8", fontWeight: 600 }}>{pct}%</span>
      )}
      <span style={{ fontSize: 18, color: "#6A3DB8", lineHeight: 1 }}>→</span>
    </div>
  );
}

function NarTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { month: string; nar: number } }> }) {
  if (!active || !payload?.length) return null;
  const { month, nar } = payload[0].payload;
  return (
    <div
      style={{
        backgroundColor: "#2C194D",
        color: "white",
        padding: "8px 12px",
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
    >
      {formatMonthFull(month)} · NAR: {nar.toFixed(1)}%
    </div>
  );
}
