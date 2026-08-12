import { useState, useEffect } from "react";

const STEPS = [
  "Assembling knowledge base…",
  "Generating brief…",
  "Structuring insights…",
];

interface BriefLoadingIndicatorProps {
  /** The current step label to display (overrides auto-cycling when provided) */
  step?: string;
}

export default function BriefLoadingIndicator({ step }: BriefLoadingIndicatorProps) {
  const [cycleIndex, setCycleIndex] = useState(0);

  useEffect(() => {
    if (step) return; // Don't cycle if a fixed step is provided
    const interval = setInterval(() => {
      setCycleIndex((prev) => Math.min(prev + 1, STEPS.length - 1));
    }, 8000);
    return () => clearInterval(interval);
  }, [step]);

  const displayStep = step || STEPS[cycleIndex];

  return (
    <div className="flex flex-col items-center justify-center py-16 px-6">
      {/* Spinner */}
      <div className="relative mb-6">
        <div className="h-12 w-12 border-4 border-gray-200 border-t-[#00c896] rounded-full animate-spin" />
      </div>

      {/* Current step */}
      <p className="text-sm font-medium text-gray-700 mb-1">{displayStep}</p>
      <p className="text-xs text-gray-400">This usually takes 20–40 seconds</p>

      {/* Step dots */}
      <div className="flex items-center gap-2 mt-6">
        {STEPS.map((s, i) => {
          const stepIdx = step ? STEPS.indexOf(step) : cycleIndex;
          const isActive = i <= stepIdx;
          return (
            <div
              key={s}
              className={[
                "w-2 h-2 rounded-full transition-colors duration-300",
                isActive ? "bg-[#00c896]" : "bg-gray-200",
              ].join(" ")}
            />
          );
        })}
      </div>
    </div>
  );
}
