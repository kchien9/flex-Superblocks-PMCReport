import { useSuperblocksUser } from "@superblocksteam/library";
import { useImpersonation } from "@/context/ImpersonationContext";
import { usePermissions } from "@/context/PermissionsContext";
import ModuleCard from "./ModuleCard";
import type { IconName } from "lucide-react/dynamic";

type ModuleDefinition = {
  icon: IconName;
  name: string;
  description: string;
  path: string;
  permissionKey?: string; // maps to PermissionsContext key; always visible if omitted
};

const modules: ModuleDefinition[] = [
  {
    icon: "trophy",
    name: "Leaderboard",
    description: "Track rep performance and closed-won rankings across the team.",
    path: "/leaderboard",
    permissionKey: "Leaderboard",
  },
  {
    icon: "badge-check",
    name: "Opp Data Quality",
    description: "Surface and fix CRM hygiene issues across your pipeline.",
    path: "/opportunity-data-quality",
  },
  {
    icon: "calculator",
    name: "Pricing Calculator",
    description: "Model deal pricing with margin guardrails and approval flows.",
    path: "/pricing-calculator",
    permissionKey: "Pricing Calculator",
  },
  {
    icon: "target",
    name: "PitchPrep",
    description: "AI-powered pre-call research and practice for your next meeting.",
    path: "/pitch-prep",
  },
  {
    icon: "trending-up",
    name: "PSM Dashboard",
    description: "Monitor NAR, support health, and action items for your properties.",
    path: "/psm-dashboard",
    permissionKey: "PSM Dashboard",
  },
  {
    icon: "file-bar-chart",
    name: "PMC Automated Reporting",
    description: "Generate full performance reports for partners, reports for expansion opportunities, and prospect reporting.",
    path: "/pmc-monthly-report",
  },
];

export default function Home() {
  const user = useSuperblocksUser();
  const { impersonating } = useImpersonation();
  const { savedPermissions } = usePermissions();

  const displayName = impersonating
    ? impersonating.name
    : user?.name || "there";
  const currentRole = impersonating ? impersonating.role : "Admin";

  const firstName = displayName.split(" ")[0];

  const visibleModules = modules.filter((mod) => {
    if (!mod.permissionKey) return true;
    return savedPermissions[mod.permissionKey]?.[currentRole] ?? true;
  });

  return (
    <div className="flex flex-col gap-8 max-w-5xl mx-auto w-full py-10 px-6">
      {/* Welcome header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-gray-900" style={{ fontFamily: "Georgia, serif" }}>
          Welcome back, {firstName}
        </h1>
        <p className="text-sm text-gray-500">
          Choose a module to get started.
        </p>
      </div>

      {/* Module cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visibleModules.map((mod) => (
          <ModuleCard
            key={mod.path}
            icon={mod.icon}
            name={mod.name}
            description={mod.description}
            path={mod.path}
          />
        ))}
      </div>
    </div>
  );
}
