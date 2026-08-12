import { useState } from "react";
import { useNavigate, useLocation } from "react-router";
import { useSuperblocksUser } from "@superblocksteam/library";
import { Icon } from "@/components/ui/icon";
import { useImpersonation } from "@/context/ImpersonationContext";
import { usePermissions } from "@/context/PermissionsContext";
import type { IconName } from "lucide-react/dynamic";

type NavItem = {
  label: string;
  icon: IconName;
  path: string;
};

const settingsSubItems: NavItem[] = [
  { label: "User Management", icon: "users", path: "/user-management" },
  { label: "Permissions", icon: "shield", path: "/permissions" },
  { label: "Audit Log", icon: "list", path: "/audit-log" },
  { label: "Module Registry", icon: "layout-grid", path: "/module-registry" },
  { label: "Skills Registry", icon: "zap", path: "/skills-registry" },
  { label: "Content Library", icon: "file-text", path: "/content-library" },
];

// Roles that have admin access (can see Settings)
const adminRoles = ["Admin", "Senior Manager"];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [settingsExpanded, setSettingsExpanded] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const user = useSuperblocksUser();
  const { impersonating } = useImpersonation();
  const { savedPermissions } = usePermissions();

  const displayName = impersonating ? impersonating.name : (user?.name || "User");
  const currentRole = impersonating ? impersonating.role : "Admin";
  const showAdmin = !impersonating || adminRoles.includes(impersonating.role);

  // Check if a module is visible for the current role based on saved permissions
  const isModuleVisible = (moduleName: string) => {
    if (moduleName === "Dashboard") return true; // Dashboard always visible
    return savedPermissions[moduleName]?.[currentRole] ?? true;
  };

  const showPricingCalculator = isModuleVisible("Pricing Calculator");
  const showLeaderboard = isModuleVisible("Leaderboard");
  const showPSMDashboard = isModuleVisible("PSM Dashboard");

  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const isSettingsActive = settingsSubItems.some(
    (item) => item.path === location.pathname
  );

  return (
    <aside
      className="relative flex flex-col h-full transition-all duration-300 ease-in-out"
      style={{
        width: collapsed ? 60 : 240,
        minWidth: collapsed ? 60 : 240,
        backgroundColor: "#6A3DB8",
      }}
    >
      {/* Toggle button */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute top-4 right-2 z-10 flex items-center justify-center w-6 h-6 rounded hover:bg-white/10 transition-colors"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <Icon
          icon={collapsed ? "chevron-right" : "chevron-left"}
          className="w-4 h-4 text-white"
        />
      </button>

      {/* Top section */}
      <div className="flex flex-col px-4 pt-4 pb-6">
        <div className="flex items-center gap-2">
          <Icon icon="zap" className="w-4 h-4 text-white flex-shrink-0" />
          {!collapsed && (
            <span className="text-white text-sm font-medium whitespace-nowrap">
              RevenueOS
            </span>
          )}
        </div>
        {!collapsed && (
          <span className="text-white/60 text-xs mt-1 pl-6 flex items-center gap-1">
            {impersonating && <Icon icon="eye" className="w-3 h-3" />}
            {displayName}
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 flex flex-col gap-1 px-2">
        {/* Dashboard */}
        <button
          onClick={() => navigate("/")}
          className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-normal transition-colors w-full text-left
            ${location.pathname === "/" ? "bg-white/15 border-l-2 border-white text-white" : "text-white/80 border-l-2 border-transparent hover:bg-white/[0.08]"}
          `}
          title={collapsed ? "Dashboard" : undefined}
        >
          <Icon icon="layout-grid" className="w-4 h-4 flex-shrink-0 text-white" />
          {!collapsed && <span className="whitespace-nowrap">Dashboard</span>}
        </button>

        {/* Pricing Calculator - only shown if permitted */}
        {showPricingCalculator && (
        <button
          onClick={() => navigate("/pricing-calculator")}
          className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-normal transition-colors w-full text-left
            ${location.pathname === "/pricing-calculator" ? "bg-white/15 border-l-2 border-white text-white" : "text-white/80 border-l-2 border-transparent hover:bg-white/[0.08]"}
          `}
          title={collapsed ? "Pricing Calculator" : undefined}
        >
          <Icon icon="calculator" className="w-4 h-4 flex-shrink-0 text-white" />
          {!collapsed && <span className="whitespace-nowrap">Pricing Calculator</span>}
        </button>
        )}

        {/* Leaderboard - only shown if permitted */}
        {showLeaderboard && (
        <button
          onClick={() => navigate("/leaderboard")}
          className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-normal transition-colors w-full text-left
            ${location.pathname === "/leaderboard" ? "bg-white/15 border-l-2 border-white text-white" : "text-white/80 border-l-2 border-transparent hover:bg-white/[0.08]"}
          `}
          title={collapsed ? "Leaderboard" : undefined}
        >
          <Icon icon="trophy" className="w-4 h-4 flex-shrink-0 text-white" />
          {!collapsed && <span className="whitespace-nowrap">Leaderboard</span>}
        </button>
        )}

        {/* PitchPrep */}
        <button
          onClick={() => navigate("/pitch-prep")}
          className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-normal transition-colors w-full text-left
            ${location.pathname === "/pitch-prep" ? "bg-white/15 border-l-2 border-white text-white" : "text-white/80 border-l-2 border-transparent hover:bg-white/[0.08]"}
          `}
          title={collapsed ? "PitchPrep" : undefined}
        >
          <Icon icon="target" className="w-4 h-4 flex-shrink-0 text-white" />
          {!collapsed && <span className="whitespace-nowrap">PitchPrep</span>}
        </button>

        {/* PSM Dashboard - only shown if permitted */}
        {showPSMDashboard && (
        <>
        <button
          onClick={() => navigate("/psm-dashboard")}
          className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-normal transition-colors w-full text-left
            ${location.pathname === "/psm-dashboard" || location.pathname.startsWith("/psm-dashboard/") ? "bg-white/15 border-l-2 border-white text-white" : "text-white/80 border-l-2 border-transparent hover:bg-white/[0.08]"}
          `}
          title={collapsed ? "PSM Dashboard" : undefined}
        >
          <Icon icon="trending-up" className="w-4 h-4 flex-shrink-0 text-white" />
          {!collapsed && <span className="whitespace-nowrap">PSM Dashboard</span>}
        </button>
        {/* PMC Detail sub-item - only visible when on a PMC detail page */}
        {!collapsed && location.pathname.startsWith("/psm-dashboard/") && (
          <div className="ml-6 pl-3 border-l border-white/20">
            <span
              className="flex items-center gap-2 py-1.5 text-white text-[13px] font-normal"
            >
              <Icon icon="building-2" className="w-3.5 h-3.5 text-white/80" />
              PMC Detail
            </span>
          </div>
        )}
        </>
        )}

        {/* Opportunity Data Quality */}
        <button
          onClick={() => navigate("/opportunity-data-quality")}
          className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-normal transition-colors w-full text-left
            ${location.pathname === "/opportunity-data-quality" ? "bg-white/15 border-l-2 border-white text-white" : "text-white/80 border-l-2 border-transparent hover:bg-white/[0.08]"}
          `}
          title={collapsed ? "Opp Data Quality" : undefined}
        >
          <Icon icon="badge-check" className="w-4 h-4 flex-shrink-0 text-white" />
          {!collapsed && <span className="whitespace-nowrap">Opp Data Quality</span>}
        </button>

        {/* PMC Monthly Report */}
        <button
          onClick={() => navigate("/pmc-monthly-report")}
          className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-normal transition-colors w-full text-left
            ${location.pathname === "/pmc-monthly-report" ? "bg-white/15 border-l-2 border-white text-white" : "text-white/80 border-l-2 border-transparent hover:bg-white/[0.08]"}
          `}
          title={collapsed ? "PMC Report" : undefined}
        >
          <Icon icon="file-bar-chart" className="w-4 h-4 flex-shrink-0 text-white" />
          {!collapsed && <span className="whitespace-nowrap">PMC Report</span>}
        </button>

        {/* ADMIN section - only shown if user has admin access */}
        {showAdmin && (
          <>
            {/* ADMIN section header */}
            {!collapsed && (
              <span className="text-white/50 text-[10px] uppercase tracking-widest font-medium px-2 pt-4 pb-1">
                ADMIN
              </span>
            )}
            {collapsed && <div className="pt-4" />}

            {/* Settings group */}
            <div className="flex flex-col">
              <button
                onClick={() => {
                  if (collapsed) {
                    navigate("/user-management");
                  } else {
                    setSettingsExpanded(!settingsExpanded);
                  }
                }}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-normal transition-colors w-full text-left
                  ${isSettingsActive && !settingsExpanded ? "bg-white/15 border-l-2 border-white text-white" : "text-white/80 border-l-2 border-transparent hover:bg-white/[0.08]"}
                `}
                title={collapsed ? "Settings" : undefined}
              >
                <Icon icon="settings" className="w-4 h-4 flex-shrink-0 text-white" />
                {!collapsed && (
                  <>
                    <span className="whitespace-nowrap flex-1">Settings</span>
                    <Icon
                      icon="chevron-down"
                      className={`w-3.5 h-3.5 text-white/60 transition-transform duration-200 ${settingsExpanded ? "rotate-0" : "-rotate-90"}`}
                    />
                  </>
                )}
              </button>

              {/* Sub-items with animated expand/collapse */}
              {!collapsed && (
                <div
                  className="overflow-hidden transition-all duration-200 ease-in-out"
                  style={{
                    maxHeight: settingsExpanded ? `${settingsSubItems.length * 40}px` : "0px",
                    opacity: settingsExpanded ? 1 : 0,
                  }}
                >
                  <div className="flex flex-col gap-0.5 mt-1">
                    {settingsSubItems.map((item) => {
                      const isActive = location.pathname === item.path;
                      return (
                        <button
                          key={item.path}
                          onClick={() => navigate(item.path)}
                          className={`flex items-center gap-2.5 py-1.5 rounded-md transition-colors w-full text-left
                            ${isActive ? "bg-white/15 border-l-2 border-white text-white" : "text-white/80 border-l-2 border-transparent hover:bg-white/[0.08]"}
                          `}
                          style={{ paddingLeft: 32, fontSize: 13 }}
                        >
                          <Icon
                            icon={item.icon}
                            className="w-3.5 h-3.5 flex-shrink-0 text-white"
                          />
                          <span className="whitespace-nowrap">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </nav>

      {/* Bottom section - User */}
      <div className="flex items-center gap-3 px-3 py-4 border-t border-white/10">
        <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white text-xs font-medium flex-shrink-0">
          {initials}
        </div>
        {!collapsed && (
          <div className="flex flex-col min-w-0">
            <span className="text-white text-xs font-medium truncate flex items-center gap-1">
              {impersonating && <Icon icon="eye" className="w-3 h-3" />}
              {displayName}
            </span>
            <span className="text-white/60 text-[10px] truncate">
              {impersonating ? impersonating.role : "Member"}
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}
