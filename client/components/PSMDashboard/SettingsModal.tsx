import { useState } from "react";
import { X } from "lucide-react";

export type DashboardSettings = {
  healthyThreshold: number;
  atRiskThreshold: number;
  trendCritical: number;
  trendAtRisk: number;
  targetNAR: number;
};

export const DEFAULT_SETTINGS: DashboardSettings = {
  healthyThreshold: 10,
  atRiskThreshold: 2,
  trendCritical: -3,
  trendAtRisk: -1,
  targetNAR: 10,
};

type Props = {
  settings: DashboardSettings;
  onSave: (s: DashboardSettings) => void;
  onClose: () => void;
};

export function SettingsModal({ settings, onSave, onClose }: Props) {
  const [local, setLocal] = useState<DashboardSettings>(settings);

  const update = (key: keyof DashboardSettings, value: string) => {
    const num = parseFloat(value);
    if (!isNaN(num)) setLocal((p) => ({ ...p, [key]: num }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative bg-white rounded-lg shadow-xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900">Dashboard Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <SettingRow
            label="Healthy NAR threshold (%)"
            value={local.healthyThreshold}
            onChange={(v) => update("healthyThreshold", v)}
          />
          <SettingRow
            label="At-Risk NAR threshold (%)"
            value={local.atRiskThreshold}
            onChange={(v) => update("atRiskThreshold", v)}
          />
          <SettingRow
            label="Trend → Critical (pp)"
            value={local.trendCritical}
            onChange={(v) => update("trendCritical", v)}
          />
          <SettingRow
            label="Trend → At-Risk (pp)"
            value={local.trendAtRisk}
            onChange={(v) => update("trendAtRisk", v)}
          />
          <SettingRow
            label="Target NAR (%)"
            value={local.targetNAR}
            onChange={(v) => update("targetNAR", v)}
          />
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onSave(local);
              onClose();
            }}
            className="px-4 py-2 text-sm text-white rounded-md hover:opacity-90"
            style={{ backgroundColor: "#6A3DB8" }}
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <label className="text-sm text-gray-700">{label}</label>
      <input
        type="number"
        step="0.5"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-20 px-2 py-1.5 text-sm text-right border border-gray-300 rounded-md focus:ring-1 focus:ring-purple-400 focus:border-purple-400 outline-none"
      />
    </div>
  );
}
