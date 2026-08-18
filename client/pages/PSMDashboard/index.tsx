import { useState, useCallback, useMemo, useEffect } from "react";
import { useNavigate } from "react-router";
import { useApiData } from "@/hooks/useApiData.js";
import { useApi } from "@/hooks/useApi.js";
import { useUsageTracking } from "@/hooks/useUsageTracking";
import { FilterBar } from "@/components/PSMDashboard/FilterBar";
import { SettingsModal, DEFAULT_SETTINGS, type DashboardSettings } from "@/components/PSMDashboard/SettingsModal";
import { AccountCard, AccountCardSkeleton, type AccountData, type ActionItem } from "@/components/PSMDashboard/AccountCard";
import { Settings, RefreshCw, Download, AlertTriangle } from "lucide-react";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function PSMDashboardPage() {
  useUsageTracking("PSM Dashboard", { trackPageView: true });

  const navigate = useNavigate();
  const [settings, setSettings] = useState<DashboardSettings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedPSMEmails, setSelectedPSMEmails] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("nar-desc");
  const [supportFilter, setSupportFilter] = useState("all");
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(20);
  const [aiActionsMap, setAiActionsMap] = useState<Record<string, ActionItem[]>>({});

  // Reset pagination when filters/sort change
  const handlePSMChange = useCallback((emails: string[]) => { setSelectedPSMEmails(emails); setPageSize(20); }, []);
  const handleSearchChange = useCallback((q: string) => { setSearchQuery(q); setPageSize(20); }, []);
  const handleSortChange = useCallback((s: string) => { setSortBy(s); setPageSize(20); }, []);
  const handleSupportFilterChange = useCallback((v: string) => { setSupportFilter(v); setPageSize(20); }, []);

  // Fetch PSM list
  const { data: psmListData, loading: psmListLoading } = useApiData("GetPSMList", {});

  // Auto-select current user PSM
  useEffect(() => {
    if (psmListData && !initialized) {
      const currentEmail = (window as any).__SUPERBLOCKS_USER_EMAIL__ || "";
      const match = psmListData.psms.find(
        (p) => p.email.toLowerCase() === currentEmail.toLowerCase()
      );
      if (match) setSelectedPSMEmails([match.email]);
      setInitialized(true);
    }
  }, [psmListData, initialized]);

  // Fetch NAR data
  const psmEmailsJson = useMemo(() => JSON.stringify(selectedPSMEmails), [selectedPSMEmails]);
  const { data: narData, loading: narLoading, fetching: narFetching, refetch } = useApiData(
    "GetPSMNARData",
    { psm_emails_json: psmEmailsJson, months_back: 12 },
    { enabled: initialized }
  );

  // Fetch support health data (keyed by PMC ID)
  const pmcIdsJson = useMemo(() => {
    if (!narData?.accounts) return "[]";
    return JSON.stringify(narData.accounts.map((a) => a.pmcId));
  }, [narData]);

  const { data: supportHealthData } = useApiData(
    "GetPMCSupportHealth",
    { pmc_ids_json: pmcIdsJson },
    { enabled: !!narData?.accounts?.length }
  );

  const supportData = supportHealthData?.lookup ?? {};
  const supportDataLoading = !supportHealthData && !!narData?.accounts?.length;

  // Generate action items
  const { run: generateActions } = useApi("GeneratePSMActionItems");

  const handleGenerateActions = useCallback(
    async (account: AccountData): Promise<ActionItem[] | null> => {
      setGeneratingId(account.pmcId);
      try {
        const sh = supportData[account.pmcId] ?? null;
        const result = await generateActions({ account, supportHealth: sh });
        if (result && (result as any).items) {
          const items = (result as any).items as ActionItem[];
          setAiActionsMap((prev) => ({ ...prev, [account.pmcId]: items }));
          return items;
        }
        return null;
      } catch {
        return null;
      } finally {
        setGeneratingId(null);
      }
    },
    [generateActions, supportData]
  );

  const handleOpenAccount = useCallback((account: AccountData) => {
    const params = new URLSearchParams({
      name: account.pmcName,
      psm: account.psm || "",
      pms: account.pms || "",
      trend: String(account.trendDelta),
    });
    navigate(`/psm-dashboard/${account.pmcId}?${params.toString()}`);
  }, [navigate]);

  // Apply health classification
  const accounts = useMemo(() => {
    if (!narData?.accounts) return [];
    return narData.accounts.map((a) => {
      const rate = (a.current?.adoptionRate || 0) * 100;
      const trend = a.trendDelta * 100;
      let health: "Critical" | "At Risk" | "Healthy";
      if (rate < settings.atRiskThreshold) health = "Critical";
      else if (trend < settings.trendCritical && rate < settings.healthyThreshold) health = "Critical";
      else if (rate < settings.healthyThreshold) health = "At Risk";
      else if (trend < settings.trendAtRisk) health = "At Risk";
      else health = "Healthy";
      return { ...a, health } as AccountData;
    });
  }, [narData, settings]);

  // Filter
  const filtered = useMemo(() => {
    let arr = accounts;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      arr = arr.filter(
        (a) =>
          a.pmcName.toLowerCase().includes(q) ||
          (a.psm && a.psm.toLowerCase().includes(q)) ||
          (a.pms && a.pms.toLowerCase().includes(q))
      );
    }
    if (supportFilter !== "all") {
      arr = arr.filter((a) => {
        const s = supportData[a.pmcId];
        switch (supportFilter) {
          case "has-open": return s && s.openTickets > 0;
          case "ticket-spike": return s && s.momChange > s.ticketsPriorMonth;
          case "resident-issue": return s && s.residentIssuePct > 0.40;
          case "no-ticket-data": return !s;
          default: return true;
        }
      });
    }
    return arr;
  }, [accounts, searchQuery, supportFilter, supportData]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sortBy) {
      case "nar-asc": return arr.sort((a, b) => (a.current?.adoptionRate || 0) - (b.current?.adoptionRate || 0));
      case "nar-desc": return arr.sort((a, b) => (b.current?.adoptionRate || 0) - (a.current?.adoptionRate || 0));
      case "name-asc": return arr.sort((a, b) => a.pmcName.localeCompare(b.pmcName));
      case "units-desc": return arr.sort((a, b) => (b.current?.units || 0) - (a.current?.units || 0));
      case "trend-desc": return arr.sort((a, b) => b.trendDelta - a.trendDelta);
      default: return arr;
    }
  }, [filtered, sortBy]);

  // KPI stats
  const kpis = useMemo(() => {
    if (!sorted.length) return null;
    const avgNAR = sorted.reduce((s, a) => s + (a.current?.adoptionRate || 0), 0) / sorted.length;
    const growing = sorted.filter((a) => a.trendDelta > 0.005).length;
    const declining = sorted.filter((a) => a.trendDelta < -0.005).length;
    const flat = sorted.length - growing - declining;
    const highest = [...sorted].sort((a, b) => (b.current?.adoptionRate || 0) - (a.current?.adoptionRate || 0))[0];
    const needsAttention = sorted.filter((a) => a.health === "Critical" || a.health === "At Risk").length;
    const worst = [...sorted].sort((a, b) => (a.current?.adoptionRate || 0) - (b.current?.adoptionRate || 0))[0];
    return { avgNAR, growing, declining, flat, highest, needsAttention, worst, total: sorted.length };
  }, [sorted]);

  // Export CSV
  const handleExport = useCallback(() => {
    const headers = ["Account", "PSM", "PMS", "Health", "NAR%", "Trend pp", "Units", "Bills Paid", "New Act%", "Repeat%"];
    const rows = sorted.map((a) => [
      a.pmcName, a.psm || "", a.pms || "", a.health,
      ((a.current?.adoptionRate || 0) * 100).toFixed(1),
      (a.trendDelta * 100).toFixed(1),
      a.current?.units || 0, a.current?.billsPaid || 0,
      ((a.current?.newActivationsPct || 0) * 100).toFixed(0),
      ((a.current?.repeatUsersPct || 0) * 100).toFixed(0),
    ]);
    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `psm_dashboard_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [sorted]);

  const isLoading = psmListLoading || narLoading;
  const now = new Date();
  const currentMonth = `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#F7F7F7]">
      {/* Dark purple header */}
      <div
        className="flex items-center justify-between px-4 shrink-0"
        style={{ backgroundColor: "#1e1040", height: 50 }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold"
            style={{ backgroundColor: "#6A3DB8" }}
          >
            F
          </div>
          <div>
            <h1 className="text-white text-[15px] font-semibold leading-tight">
              NAR Account Dashboard
            </h1>
            <p className="text-white/50 text-[11px] leading-tight">
              Net Adoption Rate · Partner Account Management
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right mr-2">
            <p className="text-white text-xs font-medium">{currentMonth}</p>
            <p className="text-white/40 text-[10px]">
              Last refreshed: {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
          <button
            onClick={() => setShowSettings(true)}
            className="p-1.5 rounded-md hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            title="Settings"
          >
            <Settings size={16} />
          </button>
          <button
            onClick={handleExport}
            className="p-1.5 rounded-md hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            title="Export CSV"
          >
            <Download size={16} />
          </button>
          <button
            onClick={() => refetch()}
            disabled={narFetching}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md text-white transition-colors"
            style={{ backgroundColor: "#6A3DB8" }}
          >
            <RefreshCw size={12} className={narFetching ? "animate-spin" : ""} />
            Refresh Data
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <FilterBar
        psmOptions={psmListData?.psms || []}
        selectedPSMEmails={selectedPSMEmails}
        onPSMChange={handlePSMChange}
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        supportFilter={supportFilter}
        onSupportFilterChange={handleSupportFilterChange}
        supportDataLoading={supportDataLoading}
        sortBy={sortBy}
        onSortChange={handleSortChange}
        onExport={handleExport}
      />

      <div className="flex-1 overflow-y-auto">
        {/* Overall NAR & MoM Change stat cards */}
        <div className="grid grid-cols-2 gap-3 px-4 pt-3 pb-1">
          <div
            className="flex flex-col items-center justify-center"
            style={{ backgroundColor: "white", border: "1px solid #E5E7EB", borderRadius: 10, padding: 14 }}
          >
            {isLoading ? (
              <div className="h-10 w-20 bg-gray-100 animate-pulse rounded" />
            ) : (
              <>
                <span style={{ fontSize: 28, fontWeight: 700, color: "#6A3DB8" }}>
                  {(() => {
                    const totalBills = sorted.reduce((s, a) => s + (a.current?.billsPaid || 0), 0);
                    const totalUnits = sorted.reduce((s, a) => s + (a.current?.units || 0), 0);
                    return totalUnits > 0 ? ((totalBills / totalUnits) * 100).toFixed(1) : "0.0";
                  })()}%
                </span>
                <span style={{ fontSize: 11, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 4 }}>
                  Overall NAR
                </span>
              </>
            )}
          </div>
          <div
            className="flex flex-col items-center justify-center"
            style={{ backgroundColor: "white", border: "1px solid #E5E7EB", borderRadius: 10, padding: 14 }}
          >
            {isLoading ? (
              <div className="h-10 w-20 bg-gray-100 animate-pulse rounded" />
            ) : (
              <>
                {(() => {
                  const avgTrend = sorted.length > 0
                    ? sorted.reduce((s, a) => s + a.trendDelta, 0) / sorted.length
                    : 0;
                  const val = (avgTrend * 100).toFixed(1);
                  const isPositive = avgTrend > 0;
                  return (
                    <span style={{ fontSize: 28, fontWeight: 700, color: isPositive ? "#16A34A" : "#DC2626" }}>
                      {isPositive ? "+" : ""}{val}pp
                    </span>
                  );
                })()}
                <span style={{ fontSize: 11, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 4 }}>
                  MoM Change
                </span>
              </>
            )}
          </div>
        </div>

        {/* KPI Summary Strip */}
        <div className="grid grid-cols-4 gap-2 px-4 py-2">
          <KPICard label="Portfolio Avg NAR" loading={isLoading}>
            {kpis && (
              <>
                <span className="text-xl font-bold" style={{ color: "#6A3DB8" }}>
                  {(kpis.avgNAR * 100).toFixed(1)}%
                </span>
                <span className="text-[11px] text-gray-400">Target: {settings.targetNAR}%</span>
              </>
            )}
          </KPICard>
          <KPICard label="Accounts Shown" loading={isLoading}>
            {kpis && (
              <>
                <span className="text-xl font-bold text-gray-900">{kpis.total}</span>
                <span className="text-[11px] text-gray-400">
                  <span className="text-green-600">{kpis.growing}</span> growing · {kpis.flat} flat · <span className="text-red-600">{kpis.declining}</span> declining
                </span>
              </>
            )}
          </KPICard>
          <KPICard label="Highest NAR" loading={isLoading}>
            {kpis?.highest && (
              <>
                <span className="text-xl font-bold" style={{ color: "#059669" }}>
                  {((kpis.highest.current?.adoptionRate || 0) * 100).toFixed(1)}%
                </span>
                <span className="text-[11px] text-gray-500 truncate">
                  {kpis.highest.pmcName}
                </span>
              </>
            )}
          </KPICard>
          <KPICard label="Needs Attention" loading={isLoading}>
            {kpis && (
              <>
                <span
                  className="text-xl font-bold"
                  style={{ color: kpis.needsAttention > 0 ? "#DC2626" : "#6B7280" }}
                >
                  {kpis.needsAttention}
                </span>
                {kpis.worst && kpis.needsAttention > 0 && (
                  <span className="text-[11px] text-red-500 truncate">
                    ▼ {kpis.worst.pmcName} at {((kpis.worst.current?.adoptionRate || 0) * 100).toFixed(1)}%
                  </span>
                )}
              </>
            )}
          </KPICard>
        </div>

        {/* Account Cards - 3 column grid */}
        <div className="px-4 pb-4">
          {narFetching && !narLoading && (
            <div className="text-xs text-gray-500 text-center py-2">Updating…</div>
          )}
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {[...Array(6)].map((_, i) => (
                <AccountCardSkeleton key={i} />
              ))}
            </div>
          ) : sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-2">
              <AlertTriangle size={24} />
              <span className="text-sm">No accounts found for the selected filters</span>
            </div>
          ) : (
            <>
              <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 ${narFetching && !narLoading ? "opacity-70" : ""}`}>
                {sorted.slice(0, pageSize).map((account) => (
                  <AccountCard
                    key={account.pmcId}
                    account={account}
                    onGenerateActions={handleGenerateActions}
                    generatingId={generatingId}
                    onOpen={handleOpenAccount}
                    supportHealth={supportData[account.pmcId] || null}
                  />
                ))}
              </div>
              {pageSize < sorted.length && (
                <div className="flex justify-center mt-5">
                  <button
                    onClick={() => setPageSize((p) => p + 20)}
                    className="px-6 py-2 text-sm font-medium rounded-lg border border-gray-300 hover:bg-white text-gray-700 bg-white shadow-sm"
                  >
                    Show More ({sorted.length - pageSize} remaining)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showSettings && (
        <SettingsModal settings={settings} onSave={setSettings} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

function KPICard({
  label,
  loading,
  children,
}: {
  label: string;
  loading: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-lg px-4 py-3 border border-gray-100 shadow-sm">
      <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">{label}</span>
      {loading ? (
        <div className="h-6 w-16 bg-gray-100 rounded animate-pulse mt-1" />
      ) : (
        <div className="flex flex-col mt-0.5">{children}</div>
      )}
    </div>
  );
}
