import { Icon } from "@/components/ui/icon";
import { useImpersonation } from "@/context/ImpersonationContext";

export default function ImpersonationBanner() {
  const { impersonating, endImpersonation } = useImpersonation();

  if (!impersonating) return null;

  return (
    <div
      className="relative flex items-center w-full flex-shrink-0 px-4"
      style={{
        height: 40,
        backgroundColor: "#FEF3C7",
        borderBottom: "1px solid #FDE68A",
      }}
    >
      {/* Center content */}
      <div className="flex items-center gap-2 flex-1 justify-center">
        <Icon icon="eye" className="w-4 h-4" style={{ color: "#92400E" }} />
        <span style={{ color: "#92400E", fontSize: 14, fontWeight: 500 }}>
          Viewing as: {impersonating.name} · {impersonating.role}
        </span>
      </div>

      {/* Exit button — positioned right */}
      <button
        onClick={endImpersonation}
        className="flex items-center gap-1 px-3 py-1 text-sm font-medium transition-opacity hover:opacity-80"
        style={{
          color: "#92400E",
          backgroundColor: "#FEF3C7",
          border: "1px solid #FDE68A",
          borderRadius: 8,
        }}
      >
        Exit
      </button>
    </div>
  );
}
