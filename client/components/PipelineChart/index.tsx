type Stage = {
  name: string;
  units: number;
};

type PipelineChartProps = {
  stages: Stage[];
  loading?: boolean;
};

export default function PipelineChart({ stages, loading }: PipelineChartProps) {
  const maxUnits = stages.length > 0 ? Math.max(...stages.map((s) => s.units)) : 0;

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
        New Logo Pipeline by Stage
      </h3>

      {loading ? (
        <div className="flex flex-col gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-[90px] h-4 bg-gray-100 rounded animate-pulse" />
              <div className="flex-1 h-7 bg-gray-100 rounded animate-pulse" />
            </div>
          ))}
        </div>
      ) : stages.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-gray-400 text-sm">
          —
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {stages.map((stage) => (
            <div key={stage.name} className="flex items-center gap-3">
              <span
                className="flex-shrink-0"
                style={{ fontSize: 13, color: "#6B7280", width: 90 }}
              >
                {stage.name}
              </span>
              <div className="flex-1 h-7 rounded overflow-hidden" style={{ backgroundColor: "#F3F4F6" }}>
                <div
                  className="h-full rounded flex items-center px-2 transition-all"
                  style={{
                    width: `${maxUnits > 0 ? (stage.units / maxUnits) * 100 : 0}%`,
                    backgroundColor: "#6A3DB8",
                    minWidth: stage.units > 0 ? 32 : 0,
                  }}
                >
                  <span style={{ fontSize: 11, color: "white", fontWeight: 600 }}>
                    {stage.units.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
