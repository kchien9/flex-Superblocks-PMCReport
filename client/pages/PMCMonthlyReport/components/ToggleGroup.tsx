import { useCallback } from "react";

interface ToggleOption {
  value: string;
  label: string;
}

interface ToggleGroupProps {
  options: ToggleOption[];
  value: string;
  onChange: (value: string) => void;
  size?: "sm" | "md";
}

export function ToggleGroup({ options, value, onChange, size = "sm" }: ToggleGroupProps) {
  const handleClick = useCallback((v: string) => {
    onChange(v);
  }, [onChange]);

  const pad = size === "md" ? "px-4 py-1.5 text-sm" : "px-3 py-1 text-xs";

  return (
    <div className="inline-flex rounded-[4px] border border-gray-200 overflow-hidden">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => handleClick(opt.value)}
            className={`${pad} font-medium transition-colors border-r border-gray-200 last:border-r-0 ${
              active
                ? "bg-[#6A3DB8] text-white"
                : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
