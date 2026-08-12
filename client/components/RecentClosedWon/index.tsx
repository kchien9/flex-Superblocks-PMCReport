type Deal = {
  accountName: string;
  units: number;
  closeDate: string;
  ownerName: string;
};

type RecentClosedWonProps = {
  deals: Deal[];
  loading?: boolean;
};

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
}

export default function RecentClosedWon({ deals, loading }: RecentClosedWonProps) {
  return (
    <div
      className="flex flex-col gap-4"
      style={{
        backgroundColor: "white",
        border: "1px solid #E5E7EB",
        borderRadius: 8,
        padding: 20,
      }}
    >
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "#1D1D1D" }}>
        Recent Closed Won
      </h3>

      {loading ? (
        <div className="flex flex-col gap-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex flex-col gap-1 py-3">
              <div className="h-4 w-3/4 bg-gray-100 rounded animate-pulse" />
              <div className="h-3 w-1/2 bg-gray-100 rounded animate-pulse" />
            </div>
          ))}
        </div>
      ) : deals.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-gray-400 text-sm">
          —
        </div>
      ) : (
        <div className="flex flex-col">
          {deals.map((deal, index) => (
            <div
              key={`${deal.accountName}-${deal.closeDate}`}
              className="flex flex-col gap-0.5 py-3"
              style={{
                borderBottom: index < deals.length - 1 ? "1px solid #E5E7EB" : undefined,
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 600, color: "#1D1D1D" }}>
                {deal.accountName}
              </span>
              <span style={{ fontSize: 12, color: "#6B7280" }}>
                {deal.units.toLocaleString()} units · {formatDate(deal.closeDate)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
