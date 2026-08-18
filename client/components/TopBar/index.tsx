import { useLocation } from "react-router";
import { useSuperblocksUser } from "@superblocksteam/library";
import { Icon } from "@/components/ui/icon";

const pageTitles: Record<string, string> = {
  "/": "Home",
  "/pricing-calculator": "Pricing Calculator",
  "/leaderboard": "Leaderboard",
  "/psm-dashboard": "PSM Dashboard",
  "/user-management": "User Management",
  "/permissions": "Permissions",
  "/audit-log": "Audit Log",
  "/module-registry": "Module Registry",
  "/skills-registry": "Skills Registry",
  "/content-library": "Content Library",
  "/opportunity-data-quality": "Opp Data Quality",
  "/pitch-prep": "PitchPrep",
  "/pmc-monthly-report": "PMC Report",
  "/feedback": "Feedback",
};

export default function TopBar() {
  const location = useLocation();
  const user = useSuperblocksUser();

  const title = pageTitles[location.pathname]
    || (location.pathname.startsWith("/psm-dashboard/") ? "PMC Detail" : "Page");
  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "U";

  return (
    <header className="flex items-center justify-between h-14 bg-white border-b border-border px-6 flex-shrink-0">
      {/* Left - Page title */}
      <h1 className="text-base font-medium" style={{ color: "#1D1D1D" }}>
        {title}
      </h1>

      {/* Right - Actions */}
      <div className="flex items-center gap-4">
        <button className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-gray-100 transition-colors">
          <Icon icon="bell" className="w-4 h-4 text-gray-600" />
        </button>
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium" style={{ backgroundColor: "#6A3DB8" }}>
          {initials}
        </div>
      </div>
    </header>
  );
}
