import { useState, useMemo } from "react";
import { toast } from "sonner";
import { Icon } from "@/components/ui/icon";
import { usePermissions, defaultPermissions } from "@/context/PermissionsContext";
import { UsageSection } from "./UsageSection";

const modules = ["Leaderboard", "Opp Data Quality", "Pricing Calculator", "PitchPrep", "PMC Monthly Report", "PSM Dashboard"];
const roles = ["Admin", "Senior Manager", "RevOps Lead", "Sales Manager", "AE", "SDR", "PSM"];

// Registry of hidden components — add entries here when hiding features
const hiddenComponents = [
  {
    name: "Pitch Practice",
    module: "PitchPrep",
    status: "In Development",
    description: "AI-powered roleplay for pre-call pitch practice",
  },
];

type PermissionState = Record<string, Record<string, boolean>>;

export default function PermissionsPage() {
  const { savedPermissions, savePermissions } = usePermissions();
  const [permissions, setPermissions] = useState<PermissionState>(savedPermissions);

  const hasChanges = useMemo(() => {
    for (const module of modules) {
      for (const role of roles) {
        if ((permissions[module]?.[role] ?? false) !== (savedPermissions[module]?.[role] ?? false)) {
          return true;
        }
      }
    }
    return false;
  }, [permissions, savedPermissions]);

  const togglePermission = (module: string, role: string) => {
    setPermissions((prev) => ({
      ...prev,
      [module]: {
        ...prev[module],
        [role]: !prev[module][role],
      },
    }));
  };

  const handleSave = () => {
    savePermissions(permissions);
    toast.success("Permissions saved");
  };

  const handleDiscard = () => {
    setPermissions(savedPermissions);
  };

  return (
    <div className="flex flex-col gap-5 h-full p-6">
      {/* Title */}
      <div className="flex flex-col gap-1">
        <h1 style={{ fontSize: 20, fontWeight: 500, color: "#1D1D1D" }}>
          Permissions
        </h1>
        <span style={{ fontSize: 13, color: "#6B7280" }}>
          Control which roles have access to each module.
        </span>
      </div>

      {/* Matrix Table */}
      <div
        className="overflow-auto flex-1"
        style={{
          backgroundColor: "white",
          border: "1px solid #E5E7EB",
          borderRadius: 8,
          padding: 20,
        }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid #E5E7EB" }}>
              <th className="text-left px-4 py-3 font-medium" style={{ color: "#6B7280", fontSize: 12 }}>
                Module
              </th>
              {roles.map((role) => (
                <th
                  key={role}
                  className="text-center px-3 py-3 font-medium"
                  style={{ color: "#6B7280", fontSize: 12, minWidth: 100 }}
                >
                  {role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modules.map((module, index) => (
              <tr
                key={module}
                style={{
                  borderBottom: index < modules.length ? "1px solid #F3F4F6" : undefined,
                }}
              >
                <td className="px-4 py-4 font-medium" style={{ color: "#1D1D1D" }}>
                  {module}
                </td>
                {roles.map((role) => (
                  <td key={role} className="text-center px-3 py-4">
                    <Toggle
                      checked={permissions[module]?.[role] ?? false}
                      onChange={() => togglePermission(module, role)}
                    />
                  </td>
                ))}
              </tr>
            ))}
            {/* Coming soon placeholder row */}
            <tr>
              <td
                className="px-4 py-4"
                style={{ color: "#9CA3AF", fontSize: 13, fontStyle: "italic" }}
                colSpan={roles.length + 1}
              >
                — coming soon —
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Hidden Components Section */}
      <div
        style={{
          backgroundColor: "white",
          border: "1px solid #E5E7EB",
          borderRadius: 8,
          padding: 20,
        }}
      >
        <div className="flex items-center gap-2 mb-4">
          <Icon icon="eye-off" className="w-4 h-4 text-gray-500" />
          <h2 style={{ fontSize: 14, fontWeight: 600, color: "#1D1D1D" }}>
            Hidden Components
          </h2>
          <span
            className="ml-2 px-2 py-0.5 rounded-full text-xs font-medium"
            style={{ backgroundColor: "#EEE2FC", color: "#6A3DB8" }}
          >
            {hiddenComponents.length}
          </span>
        </div>
        <p style={{ fontSize: 12, color: "#6B7280", marginBottom: 12 }}>
          Components that are currently hidden from all users. These remain in the codebase for future re-enablement.
        </p>

        {hiddenComponents.length === 0 ? (
          <p style={{ fontSize: 13, color: "#9CA3AF", fontStyle: "italic" }}>
            No hidden components.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid #E5E7EB" }}>
                <th className="text-left px-4 py-2 font-medium" style={{ color: "#6B7280", fontSize: 12 }}>
                  Component
                </th>
                <th className="text-left px-4 py-2 font-medium" style={{ color: "#6B7280", fontSize: 12 }}>
                  Module
                </th>
                <th className="text-left px-4 py-2 font-medium" style={{ color: "#6B7280", fontSize: 12 }}>
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {hiddenComponents.map((component) => (
                <tr key={component.name} style={{ borderBottom: "1px solid #F3F4F6" }}>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium" style={{ color: "#1D1D1D" }}>{component.name}</span>
                      <span style={{ fontSize: 11, color: "#9CA3AF" }}>{component.description}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3" style={{ color: "#4B5563" }}>
                    {component.module}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                      style={{ backgroundColor: "#FEF3C7", color: "#92400E" }}
                    >
                      <Icon icon="eye-off" className="w-3 h-3" />
                      Hidden — {component.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Usage Tracking Section */}
      <UsageSection />

      {/* Sticky save/discard footer */}
      {hasChanges && (
        <div
          className="sticky bottom-0 flex items-center justify-between px-6 py-4"
          style={{
            backgroundColor: "#FFFFFF",
            borderTop: "1px solid #E5E7EB",
            marginLeft: -24,
            marginRight: -24,
            marginBottom: -24,
            paddingLeft: 24,
            paddingRight: 24,
          }}
        >
          <span style={{ fontSize: 13, color: "#92400E", fontWeight: 500 }}>
            You have unsaved changes
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={handleDiscard}
              className="px-4 py-2 rounded-lg text-sm font-medium border transition-opacity hover:opacity-80"
              style={{ color: "#6B7280", borderColor: "#E5E7EB" }}
            >
              Discard Changes
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: "#6A3DB8" }}
            >
              Save Changes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className="relative inline-flex items-center h-5 w-9 rounded-full transition-colors"
      style={{ backgroundColor: checked ? "#6A3DB8" : "#D1D5DB" }}
      role="switch"
      aria-checked={checked}
    >
      <span
        className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
        style={{ transform: checked ? "translateX(18px)" : "translateX(3px)" }}
      />
    </button>
  );
}
