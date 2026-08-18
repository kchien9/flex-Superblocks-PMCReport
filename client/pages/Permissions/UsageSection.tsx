import { useState } from "react";
import { useApiData } from "@/hooks/useApiData.js";

type DateRange = "7" | "30" | "all";

const DATE_RANGE_OPTIONS: { label: string; value: DateRange }[] = [
  { label: "Last 7 days", value: "7" },
  { label: "Last 30 days", value: "30" },
  { label: "All time", value: "all" },
];

export function UsageSection() {
  const [dateRange, setDateRange] = useState<DateRange>("30");

  const days = dateRange === "all" ? null : parseInt(dateRange);
  const { data, loading, fetching } = useApiData("GetUsageStats", { days });

  const users = data?.stats ?? [];

  return (
    <div
      style={{
        backgroundColor: "white",
        border: "1px solid #E5E7EB",
        borderRadius: 8,
        padding: 20,
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-medium" style={{ color: "#1D1D1D" }}>
            Usage Tracking
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "#9CA3AF" }}>
            Per-user activity across all modules.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {DATE_RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setDateRange(opt.value)}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              style={{
                backgroundColor: dateRange === opt.value ? "#EEE2FC" : "#F9FAFB",
                color: dateRange === opt.value ? "#6A3DB8" : "#6B7280",
                border: dateRange === opt.value ? "1px solid #6A3DB8" : "1px solid #E5E7EB",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin w-5 h-5 border-2 border-gray-300 border-t-[#6A3DB8] rounded-full" />
        </div>
      ) : users.length === 0 ? (
        <div className="text-center py-8" style={{ color: "#9CA3AF", fontSize: 13 }}>
          No usage data recorded yet. Events will appear here as users navigate and generate content.
        </div>
      ) : (
        <div className={fetching ? "opacity-70" : ""}>
          {fetching && (
            <div className="text-xs mb-2" style={{ color: "#6A3DB8" }}>Updating…</div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid #E5E7EB" }}>
                <th className="text-left px-3 py-2 font-medium" style={{ color: "#6B7280", fontSize: 11 }}>
                  User
                </th>
                <th className="text-center px-3 py-2 font-medium" style={{ color: "#6B7280", fontSize: 11 }}>
                  Page Views
                </th>
                <th className="text-center px-3 py-2 font-medium" style={{ color: "#6B7280", fontSize: 11 }}>
                  PitchPrep Gens
                </th>
                <th className="text-center px-3 py-2 font-medium" style={{ color: "#6B7280", fontSize: 11 }}>
                  PMC Report Gens
                </th>
                <th className="text-center px-3 py-2 font-medium" style={{ color: "#6B7280", fontSize: 11 }}>
                  Total Events
                </th>
                <th className="text-left px-3 py-2 font-medium" style={{ color: "#6B7280", fontSize: 11 }}>
                  Modules Used
                </th>
                <th className="text-right px-3 py-2 font-medium" style={{ color: "#6B7280", fontSize: 11 }}>
                  Last Active
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.user_email} style={{ borderBottom: "1px solid #F3F4F6" }}>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col">
                      <span className="font-medium text-xs" style={{ color: "#1D1D1D" }}>
                        {user.user_name || user.user_email}
                      </span>
                      {user.user_name && user.user_name !== user.user_email && (
                        <span className="text-[10px]" style={{ color: "#9CA3AF" }}>
                          {user.user_email}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-center text-xs" style={{ color: "#4B5563" }}>
                    {user.page_views}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <GenBadge count={user.pitchprep_generations} />
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <GenBadge count={user.pmc_generations} />
                  </td>
                  <td className="px-3 py-2.5 text-center font-semibold text-xs" style={{ color: "#1D1D1D" }}>
                    {user.total_events}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {user.modules_used.split(", ").filter(Boolean).map((mod) => (
                        <span
                          key={mod}
                          className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium"
                          style={{ backgroundColor: "#F3F4F6", color: "#4B5563" }}
                        >
                          {mod}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs" style={{ color: "#9CA3AF" }}>
                    {formatDate(user.last_active)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GenBadge({ count }: { count: number }) {
  return (
    <span
      className="inline-flex px-2 py-0.5 rounded text-[11px] font-medium"
      style={{
        backgroundColor: count > 0 ? "#ECFDF5" : "#F3F4F6",
        color: count > 0 ? "#065F46" : "#9CA3AF",
      }}
    >
      {count}
    </span>
  );
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return dateStr;
  }
}
