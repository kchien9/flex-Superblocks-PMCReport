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
  Legend,
} from "recharts";
import { TrendingUp } from "lucide-react";

type ViewMode = "sales" | "rko";

type HistoryRecord = {
  snapDate: string;
  rkoTeam: string;
  repName: string;
  dqPct: number;
  opps: number;
};

interface WeekOverWeekChartProps {
  historyRecords: HistoryRecord[];
  view: ViewMode;
  snapshotLabel?: string;
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
}

function weightedAvg(records: HistoryRecord[]): number {
  const totalOpps = records.reduce((s, r) => s + r.opps, 0);
  if (totalOpps === 0) return 0;
  return records.reduce((s, r) => s + r.dqPct * r.opps, 0) / totalOpps;
}

export default function WeekOverWeekChart({ historyRecords, view, snapshotLabel }: WeekOverWeekChartProps) {
  const { chartData, allTimePeak } = useMemo(() => {
    if (!historyRecords.length) return { chartData: [], allTimePeak: { value: 0, date: "" } };

    // Get unique snapDates in order
    const dates = [...new Set(historyRecords.map((r) => r.snapDate))].sort();

    let peakValue = 0;
    let peakDate = "";

    const chartData = dates.map((date) => {
      const weekRecords = historyRecords.filter((r) => r.snapDate === date);
      const companyAvg = Math.round(weightedAvg(weekRecords) * 10) / 10;

      if (companyAvg > peakValue) {
        peakValue = companyAvg;
        peakDate = date;
      }

      if (view === "rko") {
        const red = weekRecords.filter((r) => r.rkoTeam === "Red");
        const blue = weekRecords.filter((r) => r.rkoTeam === "Blue");
        const green = weekRecords.filter((r) => r.rkoTeam === "Green");
        return {
          date,
          label: formatDateLabel(date),
          red: Math.round(weightedAvg(red) * 10) / 10,
          blue: Math.round(weightedAvg(blue) * 10) / 10,
          green: Math.round(weightedAvg(green) * 10) / 10,
        };
      }

      return {
        date,
        label: formatDateLabel(date),
        company: companyAvg,
      };
    });

    return { chartData, allTimePeak: { value: peakValue, date: peakDate } };
  }, [historyRecords, view]);

  if (!chartData.length) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-50">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-800">
            Data quality – week over week
          </h3>
          <span className="text-[9px] font-bold uppercase tracking-wider bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
            snapshot
          </span>
          {snapshotLabel && (
            <span className="text-[10px] text-gray-400">as of {snapshotLabel}</span>
          )}
        </div>

        {/* All-time peak callout */}
        {allTimePeak.value > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <TrendingUp size={12} className="text-green-600" />
            <span>
              All-time peak:{" "}
              <span className="font-semibold text-gray-800">{allTimePeak.value.toFixed(1)}%</span>
              {" · "}
              <span className="text-gray-400">{formatDateLabel(allTimePeak.date)}</span>
            </span>
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="px-4 py-4">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "#6B7280" }}
              axisLine={false}
              tickLine={false}
              interval={Math.max(0, Math.floor(chartData.length / 8))}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 11, fill: "#6B7280" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `${v}%`}
              width={40}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "white",
                border: "1px solid #E5E7EB",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value: number) => [`${value.toFixed(1)}%`]}
              labelFormatter={(label: string) => label}
            />
            <ReferenceLine
              y={80}
              stroke="#D97706"
              strokeDasharray="6 4"
              strokeWidth={1.5}
              label={{ value: "80% target", position: "right", fontSize: 10, fill: "#D97706" }}
            />

            {view === "sales" ? (
              <Line
                type="monotone"
                dataKey="company"
                name="Company Avg"
                stroke="#6A3DB8"
                strokeWidth={2.5}
                dot={{ r: 3, fill: "#6A3DB8", stroke: "white", strokeWidth: 1.5 }}
                activeDot={{ r: 5, fill: "#6A3DB8", stroke: "white", strokeWidth: 2 }}
              />
            ) : (
              <>
                <Line
                  type="monotone"
                  dataKey="red"
                  name="Red"
                  stroke="#E24B4A"
                  strokeWidth={2}
                  dot={{ r: 2.5, fill: "#E24B4A", stroke: "white", strokeWidth: 1 }}
                  activeDot={{ r: 4, fill: "#E24B4A", stroke: "white", strokeWidth: 2 }}
                />
                <Line
                  type="monotone"
                  dataKey="blue"
                  name="Blue"
                  stroke="#185FA5"
                  strokeWidth={2}
                  dot={{ r: 2.5, fill: "#185FA5", stroke: "white", strokeWidth: 1 }}
                  activeDot={{ r: 4, fill: "#185FA5", stroke: "white", strokeWidth: 2 }}
                />
                <Line
                  type="monotone"
                  dataKey="green"
                  name="Green"
                  stroke="#1D9E75"
                  strokeWidth={2}
                  dot={{ r: 2.5, fill: "#1D9E75", stroke: "white", strokeWidth: 1 }}
                  activeDot={{ r: 4, fill: "#1D9E75", stroke: "white", strokeWidth: 2 }}
                />
                <Legend
                  iconSize={10}
                  wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                />
              </>
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
