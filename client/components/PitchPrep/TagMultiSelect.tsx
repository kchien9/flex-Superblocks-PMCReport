import { memo, useCallback } from "react";

type TagMultiSelectProps = {
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
};

const TagMultiSelect = memo(function TagMultiSelect({
  options,
  selected,
  onChange,
}: TagMultiSelectProps) {
  const toggle = useCallback(
    (option: string) => {
      if (selected.includes(option)) {
        onChange(selected.filter((s) => s !== option));
      } else {
        onChange([...selected, option]);
      }
    },
    [selected, onChange]
  );

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const isActive = selected.includes(option);
        return (
          <button
            key={option}
            type="button"
            onClick={() => toggle(option)}
            className={[
              "px-3.5 py-1.5 rounded-full text-sm font-medium border transition-all",
              isActive
                ? "bg-[#6A3DB8] border-[#6A3DB8] text-white shadow-sm"
                : "bg-white border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50",
            ].join(" ")}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
});

export default TagMultiSelect;
