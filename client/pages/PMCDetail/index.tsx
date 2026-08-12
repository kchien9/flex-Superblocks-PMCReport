import { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router";
import { useApiData } from "@/hooks/useApiData.js";
import { ChevronLeft } from "lucide-react";
import FullFunnelCard from "@/components/PMCDetail/FullFunnelCard";
import ZendeskTicketsView from "@/components/PMCDetail/ZendeskTicketsView";

type Tab = "properties" | "zendesk";

function TabToggle({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <div
      className="inline-flex items-center gap-0.5 p-0.5 rounded-lg"
      style={{ backgroundColor: "#F3F4F6", border: "1px solid #E5E7EB" }}
    >
      <button
        onClick={() => onChange("properties")}
        className="px-3 py-1.5 rounded-md text-[13px] font-medium transition-all"
        style={
          active === "properties"
            ? { backgroundColor: "white", color: "#6A3DB8", boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }
            : { backgroundColor: "transparent", color: "#6B7280" }
        }
      >
        Properties
      </button>
      <button
        onClick={() => onChange("zendesk")}
        className="px-3 py-1.5 rounded-md text-[13px] font-medium transition-all"
        style={
          active === "zendesk"
            ? { backgroundColor: "white", color: "#6A3DB8", boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }
            : { backgroundColor: "transparent", color: "#6B7280" }
        }
      >
        Zendesk Tickets
      </button>
    </div>
  );
}

// Health thresholds (same as PSM Dashboard)
function getHealth(adoptionRate: number, trendDelta: number): "Critical" | "At Risk" | "Healthy" {
  const rate = adoptionRate * 100;
  const trend = trendDelta * 100;
  if (rate < 3) return "Critical";
  if (trend < -2 && rate < 8) return "Critical";
  if (rate < 8) return "At Risk";
  if (trend < -1) return "At Risk";
  return "Healthy";
}

const HEALTH_COLORS: Record<string, { bg: string; text: string }> = {
  Healthy: { bg: "#ECFDF5", text: "#059669" },
  "At Risk": { bg: "#FEF3C7", text: "#D97706" },
  Critical: { bg: "#FEE2E2", text: "#DC2626" },
};

const TIER_COLORS: Record<string, string> = {
  Platinum: "#6A3DB8",
  Gold: "#F4C430",
  Silver: "#C0C0C0",
  Bronze: "#CD7F32",
};

type PropertySummary = {
  propertyId: string;
  propertyName: string;
  city: string | null;
  state: string | null;
  tier: string | null;
  isIntegrated: boolean;
  rolledOut: number;
  engaged: number;
  engagementRate: number | null;
  newSignups: number;
  signupRate: number | null;
  billsPaid: number;
  bpRate: number | null;
  momChange: number | null;
  monthsLive: number | null;
};

export default function PMCDetailPage() {
  const { pmcId } = useParams<{ pmcId: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>("properties");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("bp-desc");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  // Get PMC name from URL search params
  const urlParams = new URLSearchParams(window.location.search);
  const pmcName = urlParams.get("name") || "PMC";
  const psm = urlParams.get("psm") || null;
  const pms = urlParams.get("pms") || null;
  const trendDelta = parseFloat(urlParams.get("trend") || "0");

  const { data, loading, isError } = useApiData(
    "GetPMCPropertyDetail",
    { pmc_id: pmcId || "" },
    { enabled: !!pmcId }
  );

  // Aggregate to latest month per property
  const properties: PropertySummary[] = useMemo(() => {
    if (!data?.properties) return [];
    // Group by PROPERTY_ID, take most recent month
    const byProperty = new Map<string, typeof data.properties>();
    for (const row of data.properties) {
      const existing = byProperty.get(row.PROPERTY_ID) || [];
      existing.push(row);
      byProperty.set(row.PROPERTY_ID, existing);
    }

    const result: PropertySummary[] = [];
    for (const [, rows] of byProperty) {
      // Sort by BP_MONTH descending, take latest
      const sorted = [...rows].sort((a, b) => b.BP_MONTH.localeCompare(a.BP_MONTH));
      const latest = sorted[0];
      result.push({
        propertyId: latest.PROPERTY_ID,
        propertyName: latest.PROPERTY_NAME || "Unknown Property",
        city: latest.PROPERTY_CITY,
        state: latest.PROPERTY_STATE,
        tier: latest.CURRENT_TIER,
        isIntegrated: latest.IS_INTEGRATED_TOTAL === true,
        rolledOut: latest.ROLLED_OUT,
        engaged: latest.ENGAGED_UNITS,
        engagementRate: latest.ENGAGEMENT_RATE,
        newSignups: latest.NEW_SIGNUPS_COUNT,
        signupRate: latest.SIGNUP_RATE,
        billsPaid: latest.BILLS_PAID_COUNT,
        bpRate: latest.BP_RATE,
        momChange: latest.ENGAGED_UNITS_MOM_CHANGE,
        monthsLive: latest.MONTHS_FROM_ROLLOUT != null ? Math.round(latest.MONTHS_FROM_ROLLOUT) : null,
      });
    }
    return result;
  }, [data]);

  // Funnel totals (current month)
  const funnel = useMemo(() => {
    const totalRolled = properties.reduce((s, p) => s + p.rolledOut, 0);
    const totalEngaged = properties.reduce((s, p) => s + p.engaged, 0);
    const totalSignups = properties.reduce((s, p) => s + p.newSignups, 0);
    const totalInits = properties.reduce((s, p) => s + (p.billsPaid > 0 ? p.newSignups : 0), 0);
    const totalBills = properties.reduce((s, p) => s + p.billsPaid, 0);
    // Use actual initiations from raw data
    let totalInitiations = 0;
    if (data?.properties) {
      // Get latest month per property and sum initiations
      const byProp = new Map<string, number>();
      for (const row of data.properties) {
        const existing = byProp.get(row.PROPERTY_ID);
        if (!existing || row.BP_MONTH > (data.properties.find(r => r.PROPERTY_ID === row.PROPERTY_ID && r.INITIATIONS_COUNT === existing)?.BP_MONTH || "")) {
          byProp.set(row.PROPERTY_ID, row.INITIATIONS_COUNT);
        }
      }
      totalInitiations = Array.from(byProp.values()).reduce((s, v) => s + v, 0);
    }
    return { rolledOut: totalRolled, engaged: totalEngaged, signups: totalSignups, initiations: totalInitiations, billsPaid: totalBills };
  }, [properties, data]);

  // Header metrics
  const totalUnits = properties.reduce((s, p) => s + p.rolledOut, 0);
  const totalBills = properties.reduce((s, p) => s + p.billsPaid, 0);
  const currentNAR = totalUnits > 0 ? totalBills / totalUnits : 0;
  const health = getHealth(currentNAR, trendDelta);
  const healthColors = HEALTH_COLORS[health];

  // Filter + sort
  const filtered = useMemo(() => {
    if (!search.trim()) return properties;
    const q = search.toLowerCase();
    return properties.filter((p) => p.propertyName.toLowerCase().includes(q));
  }, [properties, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sortBy) {
      case "bp-desc": return arr.sort((a, b) => b.billsPaid - a.billsPaid);
      case "engagement-desc": return arr.sort((a, b) => (b.engagementRate || 0) - (a.engagementRate || 0));
      case "name-asc": return arr.sort((a, b) => a.propertyName.localeCompare(b.propertyName));
      case "units-desc": return arr.sort((a, b) => b.rolledOut - a.rolledOut);
      default: return arr;
    }
  }, [filtered, sortBy]);

  const pageCount = Math.ceil(sorted.length / PAGE_SIZE);
  const paged = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  if (loading) {
    return (
      <div className="flex flex-col gap-4 p-6 h-full overflow-auto">
        <div className="h-6 w-32 bg-gray-100 animate-pulse rounded" />
        <div className="h-24 bg-white border border-gray-200 rounded-xl animate-pulse" />
        <div className="h-14 bg-purple-50 rounded-lg animate-pulse" />
        <div className="h-96 bg-white border border-gray-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <span className="text-sm text-gray-500">Failed to load property detail.</span>
        <button onClick={() => navigate("/psm-dashboard")} className="text-sm font-medium" style={{ color: "#6A3DB8" }}>
          ← Back to PSM Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 p-6 h-full overflow-auto">
      {/* Back button + Tab toggle row */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-[13px] font-medium hover:underline"
          style={{ color: "#6A3DB8" }}
        >
          <ChevronLeft size={14} />
          PSM Dashboard
        </button>
        <TabToggle active={activeTab} onChange={setActiveTab} />
      </div>

      {/* SECTION 1 — PMC HEADER */}
      <div
        className="flex items-center justify-between"
        style={{ backgroundColor: "white", border: "1px solid #E5E7EB", borderRadius: 12, padding: "20px 24px" }}
      >
        <div className="flex flex-col gap-1">
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1D1D1D" }}>{pmcName}</h1>
          {psm && <span style={{ fontSize: 13, color: "#6A3DB8", fontWeight: 500 }}>{psm}</span>}
          <div className="flex items-center gap-2 mt-1">
            {pms && (
              <span className="px-2 py-0.5 text-[11px] font-medium rounded-md" style={{ backgroundColor: "#F3F4F6", color: "#4B5563", border: "1px solid #E5E7EB" }}>
                {pms}
              </span>
            )}
            <span style={{ fontSize: 12, color: "#6B7280" }}>
              {properties.length} properties · {totalUnits.toLocaleString()} units
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span style={{ fontSize: 10, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>Current NAR</span>
          <span style={{ fontSize: 28, fontWeight: 700, color: healthColors.text }}>
            {(currentNAR * 100).toFixed(1)}%
          </span>
          <span style={{ fontSize: 13, fontWeight: 500, color: trendDelta >= 0 ? "#16A34A" : "#DC2626" }}>
            {trendDelta >= 0 ? "+" : ""}{(trendDelta * 100).toFixed(1)}pp MoM
          </span>
        </div>
      </div>

      {/* TAB CONTENT */}
      {activeTab === "zendesk" ? (
        <ZendeskTicketsView pmcId={pmcId || ""} />
      ) : (
        <>
      {/* SECTION 2 — FULL FUNNEL CARD */}
      <FullFunnelCard funnel={funnel} rawRows={data?.properties || []} />

      {/* SECTION 3 — PROPERTY TABLE */}
      <div style={{ backgroundColor: "white", border: "1px solid #E5E7EB", borderRadius: 12, padding: "16px 20px" }}>
        {/* Table header row */}
        <div className="flex items-center justify-between mb-4">
          <span style={{ fontSize: 11, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 500 }}>
            Properties ({sorted.length})
          </span>
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Search properties..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="px-3 py-1.5 text-sm border rounded-md outline-none focus:ring-1 focus:ring-purple-300"
              style={{ width: 200, borderColor: "#E5E7EB" }}
            />
            <select
              value={sortBy}
              onChange={(e) => { setSortBy(e.target.value); setPage(0); }}
              className="px-2 py-1.5 text-sm border rounded-md outline-none"
              style={{ borderColor: "#E5E7EB" }}
            >
              <option value="bp-desc">BP Rate High→Low</option>
              <option value="engagement-desc">Engagement Rate</option>
              <option value="name-asc">Name A–Z</option>
              <option value="units-desc">Units High→Low</option>
            </select>
          </div>
        </div>

        {/* Table */}
        {paged.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-sm text-gray-400">
            No properties found
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left" style={{ fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #E5E7EB" }}>
                    <th className="py-2 px-2 font-medium text-gray-500 text-[11px] uppercase">Property</th>
                    <th className="py-2 px-2 font-medium text-gray-500 text-[11px] uppercase">Tier</th>
                    <th className="py-2 px-2 font-medium text-gray-500 text-[11px] uppercase">Integration</th>
                    <th className="py-2 px-2 font-medium text-gray-500 text-[11px] uppercase text-right">Rolled Out</th>
                    <th className="py-2 px-2 font-medium text-gray-500 text-[11px] uppercase text-right">Engaged</th>
                    <th className="py-2 px-2 font-medium text-gray-500 text-[11px] uppercase text-right">New Signups</th>
                    <th className="py-2 px-2 font-medium text-gray-500 text-[11px] uppercase text-right">Bills Paid</th>
                    <th className="py-2 px-2 font-medium text-gray-500 text-[11px] uppercase text-center">MoM</th>
                    <th className="py-2 px-2 font-medium text-gray-500 text-[11px] uppercase text-center">Months Live</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((p, i) => (
                    <tr
                      key={p.propertyId}
                      style={{ height: 48, borderBottom: "1px solid #F3F4F6", backgroundColor: i % 2 === 1 ? "#F9FAFB" : "white" }}
                    >
                      <td className="px-2 py-2">
                        <div className="font-semibold text-[13px] text-gray-900">{p.propertyName}</div>
                        {(p.city || p.state) && (
                          <div className="text-[11px] text-gray-500">{[p.city, p.state].filter(Boolean).join(", ")}</div>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {p.tier ? (
                          <span
                            className="px-2 py-0.5 text-[10px] font-semibold rounded-full text-white"
                            style={{ backgroundColor: TIER_COLORS[p.tier] || "#9CA3AF" }}
                          >
                            {p.tier}
                          </span>
                        ) : (
                          <span className="text-[11px] text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <span
                          className="px-2 py-0.5 text-[10px] font-medium rounded-full"
                          style={p.isIntegrated
                            ? { backgroundColor: "#ECFDF5", color: "#059669" }
                            : { backgroundColor: "#F3F4F6", color: "#6B7280" }
                          }
                        >
                          {p.isIntegrated ? "Integrated" : "Non-Integrated"}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right">{p.rolledOut.toLocaleString()}</td>
                      <td className="px-2 py-2 text-right">
                        <div>{p.engaged.toLocaleString()}</div>
                        <div className="text-[11px] text-gray-500">{p.engagementRate != null ? `${(p.engagementRate * 100).toFixed(0)}%` : "—"}</div>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <div>{p.newSignups.toLocaleString()}</div>
                        <div className="text-[11px] text-gray-500">{p.signupRate != null ? `${(p.signupRate * 100).toFixed(0)}%` : "—"}</div>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <div className="font-semibold" style={{ color: "#6A3DB8" }}>{p.billsPaid.toLocaleString()}</div>
                        <div className="text-[11px] font-bold" style={{ color: "#6A3DB8" }}>{p.bpRate != null ? `${(p.bpRate * 100).toFixed(1)}%` : "—"}</div>
                      </td>
                      <td className="px-2 py-2 text-center">
                        {p.momChange != null && p.momChange !== 0 ? (
                          <span style={{ fontSize: 12, fontWeight: 600, color: p.momChange > 0 ? "#16A34A" : "#DC2626" }}>
                            {p.momChange > 0 ? `▲+${p.momChange}` : `▼${p.momChange}`}
                          </span>
                        ) : (
                          <span className="text-[11px] text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-center text-gray-700">{p.monthsLive ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pageCount > 1 && (
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
                <span className="text-xs text-gray-500">
                  Page {page + 1} of {pageCount} ({sorted.length} properties)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="px-3 py-1 text-xs font-medium rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                    disabled={page >= pageCount - 1}
                    className="px-3 py-1 text-xs font-medium rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
        </>
      )}
    </div>
  );
}
