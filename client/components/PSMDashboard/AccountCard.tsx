import { useState, useCallback } from "react";
import { Sparkles, Check, Loader2 } from "lucide-react";
import { SupportHealthSection, type SupportHealthData } from "./SupportHealthSection";

export type AccountData = {
  pmcId: string;
  pmcName: string;
  salesforceId: string | null;
  psm: string | null;
  psmEmail: string | null;
  pms: string | null;
  current: {
    adoptionRate: number | null;
    billsPaid: number;
    units: number;
    properties: number;
    rentPaid: number | null;
    newActivations: number;
    repeatUsers: number;
    newActivationsPct: number | null;
    repeatUsersPct: number | null;
    monthsFromRollout: number | null;
    month: string;
  } | null;
  trendDelta: number;
  health: "Critical" | "At Risk" | "Healthy";
  vsTarget: number | null;
  history: { month: string; adoptionRate: number | null; billsPaid: number; units: number }[];
};

export type ActionItem = {
  priority: string;
  category: string;
  action: string;
  rationale?: string;
  isAI?: boolean;
};

type Props = {
  account: AccountData;
  onGenerateActions: (account: AccountData) => Promise<ActionItem[] | null>;
  generatingId: string | null;
  onOpen?: (account: AccountData) => void;
  supportHealth?: SupportHealthData | null;
};

const HEALTH_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  Healthy: { bg: "#ECFDF5", text: "#059669", border: "#A7F3D0" },
  "At Risk": { bg: "#FFFBEB", text: "#D97706", border: "#FDE68A" },
  Critical: { bg: "#FEF2F2", text: "#DC2626", border: "#FECACA" },
};

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  activation: { bg: "#EFF6FF", text: "#1D4ED8" },
  ops: { bg: "#EFF6FF", text: "#1D4ED8" },
  risk: { bg: "#FEE2E2", text: "#DC2626" },
  growth: { bg: "#DCFCE7", text: "#16A34A" },
  engagement: { bg: "#EEE2FC", text: "#6A3DB8" },
  retention: { bg: "#EEE2FC", text: "#6A3DB8" },
  escalation: { bg: "#FFF7ED", text: "#C2410C" },
};

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function getRuleBasedActions(a: AccountData): ActionItem[] {
  const items: ActionItem[] = [];
  const rate = a.current?.adoptionRate || 0;
  const trend = a.trendDelta;
  const months = a.current?.monthsFromRollout || 0;
  const newActPct = a.current?.newActivationsPct || 0;

  if (rate < 0.02) {
    items.push({ priority: "high", category: "escalation", action: "Critical adoption — schedule emergency call with leasing office this week" });
  }
  if (trend < -0.03) {
    items.push({ priority: "high", category: "risk", action: "Sharp decline — diagnose root cause before next BP close" });
  }
  if (newActPct > 0.60) {
    items.push({ priority: "medium", category: "retention", action: "High new-user dependency — launch re-engagement for existing residents" });
  }
  if (months < 3 && months > 0) {
    items.push({ priority: "medium", category: "activation", action: "New rollout — confirm leasing team training and D2C marketing setup" });
  }
  if (months > 12 && rate < 0.05) {
    items.push({ priority: "high", category: "escalation", action: "Stalled account — escalate for manager review" });
  }
  if (rate >= 0.10 && trend > 0.01) {
    items.push({ priority: "low", category: "growth", action: "Strong performer — candidate for case study or expansion push" });
  }
  if (items.length === 0 && rate >= 0.02 && rate < 0.10) {
    items.push({ priority: "medium", category: "engagement", action: "Below 10% NAR target — review rollout completeness and resident communication cadence with the leasing team" });
  }
  return items.slice(0, 3);
}

export function AccountCard({ account, onGenerateActions, generatingId, onOpen, supportHealth }: Props) {
  const a = account;
  const colors = HEALTH_COLORS[a.health] || HEALTH_COLORS.Healthy;
  const nar = ((a.current?.adoptionRate || 0) * 100).toFixed(1);
  const trend = (a.trendDelta * 100).toFixed(1);
  const trendDir = a.trendDelta >= 0 ? "+" : "";
  const trendColor = a.trendDelta >= 0 ? "#059669" : "#DC2626";
  const trendArrow = a.trendDelta >= 0 ? "↑" : "↓";
  const isGenerating = generatingId === a.pmcId;

  const [aiItems, setAiItems] = useState<ActionItem[] | null>(null);
  const [aiDone, setAiDone] = useState(false);

  const handleGenerate = useCallback(async () => {
    const result = await onGenerateActions(a);
    if (result) {
      setAiItems(result.map((item) => ({ ...item, isAI: true })));
      setAiDone(true);
    }
  }, [a, onGenerateActions]);

  const ruleItems = getRuleBasedActions(a);
  const displayItems = aiItems || ruleItems;

  const vsTarget = ((a.current?.adoptionRate || 0) - 0.10) * 100;
  const sfLink = a.salesforceId
    ? `https://getflex.lightning.force.com/lightning/r/Account/${a.salesforceId}/view`
    : null;

  return (
    <div
      className="bg-white border rounded-xl p-4 hover:shadow-md transition-shadow"
      style={{ borderColor: "#E5E7EB" }}
    >
      {/* HEADER */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {sfLink ? (
              <a
                href={sfLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[15px] font-bold text-gray-900 hover:underline truncate"
              >
                {a.pmcName}
              </a>
            ) : (
              <h3 className="text-[15px] font-bold text-gray-900 truncate">{a.pmcName}</h3>
            )}
            <span
              className="px-2 py-0.5 text-[10px] font-medium rounded-md shrink-0"
              style={{ backgroundColor: "#F3F4F6", color: "#4B5563", border: "1px solid #E5E7EB" }}
            >
              {a.pms || "Unknown"}
            </span>
            <span
              className="px-2 py-0.5 text-[10px] font-semibold rounded-full shrink-0"
              style={{ backgroundColor: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}
            >
              {a.health}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs font-medium" style={{ color: "#6A3DB8" }}>
              {a.psm || "Unassigned"}
            </span>
          </div>
        </div>
        {/* Right: NAR + Trend */}
        <div className="shrink-0 ml-4 text-right">
          <div className="text-[22px] font-bold" style={{ color: colors.text }}>
            {nar}%
          </div>
          <div className="text-xs font-medium" style={{ color: trendColor }}>
            {trendArrow} {trendDir}{trend}pp
          </div>
        </div>
      </div>

      {/* BAR CHART SPARKLINE */}
      {a.history.length > 1 && (
        <div className="mb-4">
          <NARBarChart history={a.history} />
        </div>
      )}

      {/* METRICS GRID */}
      <div className="grid grid-cols-3 gap-[6px] mb-4 pb-4 border-b border-gray-100">
        <MetricCell label="Properties" value={String(a.current?.properties || 0)} />
        <MetricCell label="Total Units" value={(a.current?.units || 0).toLocaleString()} />
        <MetricCell label="Bills Paid" value={(a.current?.billsPaid || 0).toLocaleString()} />
        <MetricCell
          label="New Activations"
          value={`${a.current?.newActivations || 0}`}
          sub={`${((a.current?.newActivationsPct || 0) * 100).toFixed(0)}% of bills`}
        />
        <MetricCell
          label="Repeat Users"
          value={`${a.current?.repeatUsers || 0}`}
          sub={`${((a.current?.repeatUsersPct || 0) * 100).toFixed(0)}% of bills`}
        />
        <MetricCell
          label="VS 10% Target"
          value={`${vsTarget >= 0 ? "+" : ""}${vsTarget.toFixed(1)}pp`}
          valueColor={vsTarget >= 0 ? "#059669" : "#DC2626"}
        />
      </div>

      {/* ACTION ITEMS */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
            Action Items
          </span>
          <button
            onClick={handleGenerate}
            disabled={isGenerating || aiDone}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors disabled:opacity-60"
            style={{ backgroundColor: "#EEE2FC", color: "#6A3DB8" }}
          >
            {isGenerating ? (
              <>
                <Loader2 size={11} className="animate-spin" />
                Generating...
              </>
            ) : aiDone ? (
              <>
                <Check size={11} />
                AI Insights Active
              </>
            ) : (
              <>
                <Sparkles size={11} />
                Generate AI Insights
              </>
            )}
          </button>
        </div>

        {displayItems.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No rule-based actions triggered for this account.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {displayItems.map((item, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-gray-300 mt-0.5">•</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {item.isAI && (
                      <span
                        className="px-1.5 py-0.5 text-[9px] font-bold rounded"
                        style={{ backgroundColor: "#EEE2FC", color: "#6A3DB8" }}
                      >
                        AI
                      </span>
                    )}
                    <CategoryPill category={item.category} />
                    <span className="text-[13px] text-gray-900">{item.action}</span>
                  </div>
                  {item.rationale && (
                    <p className="text-[11px] text-gray-400 italic mt-0.5 ml-0">{item.rationale}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SUPPORT HEALTH */}
      <SupportHealthSection data={supportHealth ?? null} trendDelta={a.trendDelta} />

      {/* Open detail button */}
      {onOpen && (
        <button
          onClick={() => onOpen(a)}
          className="w-full mt-3 pt-3 border-t border-gray-100 text-center text-[12px] font-medium hover:underline"
          style={{ color: "#6A3DB8" }}
        >
          Open →
        </button>
      )}
    </div>
  );
}

function CategoryPill({ category }: { category: string }) {
  const c = CATEGORY_COLORS[category.toLowerCase()] || { bg: "#F3F4F6", text: "#6B7280" };
  return (
    <span
      className="px-1.5 py-0.5 text-[9px] font-semibold rounded uppercase shrink-0"
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      {category}
    </span>
  );
}

function MetricCell({
  label,
  value,
  sub,
  valueColor,
}: {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
}) {
  return (
    <div
      className="flex flex-col"
      style={{
        backgroundColor: "#F9FAFB",
        border: "1px solid #F3F4F6",
        borderRadius: 6,
        padding: "10px 12px",
      }}
    >
      <span className="text-[10px] uppercase tracking-wide text-gray-500">{label}</span>
      <span className="text-[15px] font-bold" style={{ color: valueColor || "#1D1D1D" }}>
        {value}
      </span>
      {sub && <span className="text-[11px] text-gray-500">{sub}</span>}
    </div>
  );
}

function NARBarChart({ history }: { history: AccountData["history"] }) {
  const data = history.slice(-12);
  const barWidth = 100 / data.length;
  const maxRate = Math.max(...data.map((d) => d.adoptionRate || 0), 0.15);
  const chartHeight = 72;
  const targetPct = (0.10 / maxRate) * 100;

  return (
    <div className="relative" style={{ height: chartHeight }}>
      {/* Target line */}
      <div
        className="absolute left-0 right-0 border-t border-dashed"
        style={{ bottom: `${targetPct}%`, borderColor: "#6B7280", opacity: 0.4 }}
      >
        <span className="absolute -top-3 right-0 text-[9px] text-gray-400">10%</span>
      </div>
      {/* Bars */}
      <div className="flex items-end h-full gap-[2px]">
        {data.map((d, i) => {
          const rate = d.adoptionRate || 0;
          const heightPct = (rate / maxRate) * 100;
          const color = rate >= 0.10 ? "#059669" : rate >= 0.05 ? "#D97706" : "#DC2626";
          const monthIdx = new Date(d.month).getMonth();
          return (
            <div
              key={i}
              className="flex flex-col items-center flex-1"
              style={{ height: "100%" }}
            >
              <div className="flex-1 w-full flex items-end justify-center">
                <div
                  className="w-full max-w-[18px] rounded-t-sm transition-all"
                  style={{ height: `${Math.max(heightPct, 2)}%`, backgroundColor: color, opacity: 0.8 }}
                />
              </div>
              <span className="text-[8px] text-gray-400 mt-0.5 leading-none">
                {MONTH_ABBR[monthIdx]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AccountCardSkeleton() {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 animate-pulse">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="h-5 w-56 bg-gray-200 rounded mb-2" />
          <div className="h-3 w-28 bg-gray-100 rounded" />
        </div>
        <div className="text-right">
          <div className="h-7 w-16 bg-gray-200 rounded mb-1" />
          <div className="h-3 w-12 bg-gray-100 rounded ml-auto" />
        </div>
      </div>
      <div className="h-[72px] bg-gray-50 rounded mb-4" />
      <div className="grid grid-cols-3 gap-4 mb-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="flex flex-col gap-1">
            <div className="h-2 w-14 bg-gray-100 rounded" />
            <div className="h-4 w-10 bg-gray-200 rounded" />
          </div>
        ))}
      </div>
      <div className="h-16 bg-gray-50 rounded" />
    </div>
  );
}
