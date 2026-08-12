import { useMemo, useCallback } from "react";
import { useApiData } from "@/hooks/useApiData.js";
import { Icon } from "@/components/ui/icon";
import KpiCard from "@/components/KpiCard";
import PipelineChart from "@/components/PipelineChart";
import RecentClosedWon from "@/components/RecentClosedWon";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function fmt(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString();
}

export default function DashboardPage() {
  const { data: kpiData, loading: kpiLoading, fetching: kpiFetching, refetch: refetchKpis } = useApiData("GetDashboardKPIs", {});
  const { data: pipelineData, loading: pipelineLoading, fetching: pipelineFetching, refetch: refetchPipeline } = useApiData("GetDashboardPipelineData", {});

  const loading = kpiLoading || pipelineLoading;
  const fetching = kpiFetching || pipelineFetching;

  const handleRefresh = useCallback(() => {
    refetchKpis();
    refetchPipeline();
  }, [refetchKpis, refetchPipeline]);

  const now = new Date();
  // Query uses previous month's data
  const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
  const billingPeriodLabel = `${MONTH_NAMES[prevMonth]} ${prevMonth === 11 ? now.getFullYear() - 1 : now.getFullYear()}`;

  // Calculate pipeline coverage: total pipeline units / IU
  const pipelineCoverage = useMemo(() => {
    if (!pipelineData || !kpiData) return null;
    const totalPipeline = pipelineData.totalPipelineUnits;
    const iu = kpiData.iu;
    if (!iu || iu === 0) return null;
    return (totalPipeline / iu).toFixed(1);
  }, [pipelineData, kpiData]);

  return (
    <div className="flex flex-col gap-6 h-full overflow-auto p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <h1 style={{ fontSize: 20, fontWeight: 500, color: "#1D1D1D", whiteSpace: "nowrap" }}>
            Pipeline Overview
          </h1>
          <span style={{ fontSize: 13, color: "#6B7280" }}>
            Q2 FY2026 · {MONTH_NAMES[now.getMonth()]} {now.getFullYear()}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span style={{ fontSize: 12, color: "#6B7280" }}>
            Last updated: Today {now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </span>
          <button
            onClick={handleRefresh}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors hover:bg-gray-50"
            style={{ border: "1px solid #E5E7EB", fontSize: 13, color: "#1D1D1D" }}
          >
            <Icon icon="refresh-cw" className={`w-3.5 h-3.5 ${fetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Row 1 — KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard
          label="Integrated Units"
          value={kpiLoading ? undefined : fmt(kpiData?.iu ?? null)}
          trend={kpiLoading ? undefined : "IU portfolio"}
        />
        <KpiCard
          label="NIRO Units"
          value={kpiLoading ? undefined : fmt(kpiData?.niro ?? null)}
          trend={kpiLoading ? undefined : "Non-integrated rolled out"}
        />
        <KpiCard
          label="Net Annualized Revenue"
          value={kpiLoading ? undefined : kpiData?.annualizedRevenueM != null ? `$${kpiData.annualizedRevenueM}M` : "—"}
          trend={kpiLoading ? undefined : "Rent paid × 12"}
        />
        <KpiCard
          label="Pipeline Coverage"
          value={loading ? undefined : pipelineCoverage ? `${pipelineCoverage}x` : "—"}
          trend={loading ? undefined : "Pipeline units ÷ IU"}
          trendColor="#6A3DB8"
        />
      </div>

      {/* Last updated billing period */}
      <div style={{ fontSize: 12, color: "#6B7280", marginTop: -12 }}>
        Last updated: {billingPeriodLabel} billing period
        {fetching && !loading && <span className="ml-2 text-purple-500">Refreshing…</span>}
      </div>

      {/* Row 2 — Charts */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "3fr 2fr" }}>
        <PipelineChart
          stages={pipelineData?.stages ?? []}
          loading={pipelineLoading}
        />
        <RecentClosedWon
          deals={pipelineData?.recentClosedWon ?? []}
          loading={pipelineLoading}
        />
      </div>

    </div>
  );
}
