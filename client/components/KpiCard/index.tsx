type KpiCardProps = {
  label: string;
  value?: string;
  trend?: string;
  trendColor?: string;
  note?: string;
};

export default function KpiCard({ label, value, trend, trendColor = "#16A34A", note }: KpiCardProps) {
  const isLoading = value === undefined;

  return (
    <div
      className="flex flex-col gap-2"
      style={{
        backgroundColor: "white",
        border: "1px solid #E5E7EB",
        borderRadius: 8,
        padding: 20,
      }}
    >
      <span style={{ fontSize: 11, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 500 }}>
        {label}
      </span>
      {isLoading ? (
        <div className="h-8 w-24 bg-gray-100 animate-pulse rounded" />
      ) : (
        <span style={{ fontSize: 28, color: "#1D1D1D", fontWeight: 700 }}>
          {value}
        </span>
      )}
      {isLoading ? (
        <div className="h-4 w-20 bg-gray-50 animate-pulse rounded" />
      ) : trend ? (
        <span style={{ fontSize: 12, color: trendColor }}>
          {trend}
        </span>
      ) : null}
      {note && (
        <span style={{ fontSize: 11, color: "#6B7280", fontStyle: "italic" }}>
          {note}
        </span>
      )}
    </div>
  );
}
