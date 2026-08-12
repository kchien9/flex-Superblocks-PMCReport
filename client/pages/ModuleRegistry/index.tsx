import { toast } from "sonner";
import { Icon } from "@/components/ui/icon";
import ModuleChip from "@/components/ModuleChip";

type Module = {
  name: string;
  status: "Active" | "Coming Soon";
  description: string;
  roles: string[];
  lastUpdated: string;
};

const mockModules: Module[] = [
  {
    name: "Dashboard",
    status: "Active",
    description: "Pipeline overview with KPI metrics and stage distribution",
    roles: ["Admin", "Senior Manager", "RevOps Lead", "Sales Manager", "AE", "SDR"],
    lastUpdated: "May 31, 2026",
  },
  {
    name: "Pre-Call Prep",
    status: "Coming Soon",
    description: "AI-generated call briefs pulling Salesforce and conversation data",
    roles: ["Admin", "Senior Manager", "AE", "SDR"],
    lastUpdated: "—",
  },
  {
    name: "Leaderboard",
    status: "Coming Soon",
    description: "Live Salesforce pipeline and closed units tracker for Flex Rent reps",
    roles: ["Admin", "Senior Manager", "Sales Manager", "AE"],
    lastUpdated: "—",
  },
  {
    name: "Pricing Calculator",
    status: "Active",
    description: "Internal fee calculator for New Pricing, New vs. Legacy, and Flex vs. Late Fee scenarios",
    roles: ["Admin", "Senior Manager", "RevOps Lead", "Sales Manager", "AE", "SDR"],
    lastUpdated: "June 1, 2026",
  },
  {
    name: "PSM Dashboard",
    status: "Active",
    description: "PMC adoption health dashboard for PSMs — tracks Net Adoption Rate, billing trends, and AI-generated account action items per billing period",
    roles: ["Admin", "Senior Manager", "PSM"],
    lastUpdated: "June 2, 2026",
  },
];

function StatusBadge({ status }: { status: Module["status"] }) {
  const isActive = status === "Active";
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
      style={{
        backgroundColor: isActive ? "#DCFCE7" : "#F3F4F6",
        color: isActive ? "#16A34A" : "#6B7280",
        fontSize: 12,
      }}
    >
      {status}
    </span>
  );
}

export default function ModuleRegistryPage() {
  return (
    <div className="flex flex-col gap-5 h-full overflow-auto p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <h1 style={{ fontSize: 20, fontWeight: 500, color: "#1D1D1D" }}>
            Module Registry
          </h1>
          <span style={{ fontSize: 13, color: "#6B7280" }}>
            All modules registered in RevenueOS and their access configuration.
          </span>
        </div>
        <button
          onClick={() => toast("Coming soon")}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-medium transition-opacity hover:opacity-90"
          style={{ backgroundColor: "#6A3DB8", borderRadius: 8 }}
        >
          <Icon icon="plus" className="w-4 h-4" />
          Register Module
        </button>
      </div>

      {/* Table */}
      <div
        className="overflow-hidden"
        style={{
          backgroundColor: "white",
          border: "1px solid #E5E7EB",
          borderRadius: 8,
        }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid #E5E7EB" }}>
              <th className="text-left px-5 py-3 font-medium" style={{ color: "#6B7280", fontSize: 12 }}>
                Module
              </th>
              <th className="text-left px-5 py-3 font-medium" style={{ color: "#6B7280", fontSize: 12 }}>
                Status
              </th>
              <th className="text-left px-5 py-3 font-medium" style={{ color: "#6B7280", fontSize: 12 }}>
                Description
              </th>
              <th className="text-left px-5 py-3 font-medium" style={{ color: "#6B7280", fontSize: 12 }}>
                Roles With Access
              </th>
              <th className="text-left px-5 py-3 font-medium" style={{ color: "#6B7280", fontSize: 12 }}>
                Last Updated
              </th>
            </tr>
          </thead>
          <tbody>
            {mockModules.map((module, index) => (
              <tr
                key={module.name}
                style={{
                  backgroundColor: index % 2 === 1 ? "#FAFAFA" : "white",
                  borderBottom: index < mockModules.length - 1 ? "1px solid #F3F4F6" : undefined,
                }}
              >
                <td className="px-5 py-3 font-medium" style={{ color: "#1D1D1D" }}>
                  {module.name}
                </td>
                <td className="px-5 py-3">
                  <StatusBadge status={module.status} />
                </td>
                <td className="px-5 py-3" style={{ color: "#6B7280", maxWidth: 300 }}>
                  {module.description}
                </td>
                <td className="px-5 py-3">
                  <div className="flex flex-wrap gap-1">
                    {module.roles.length === 6 ? (
                      <ModuleChip label="All roles" />
                    ) : (
                      module.roles.map((role) => (
                        <ModuleChip key={role} label={role} />
                      ))
                    )}
                  </div>
                </td>
                <td className="px-5 py-3" style={{ color: "#6B7280" }}>
                  {module.lastUpdated}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
