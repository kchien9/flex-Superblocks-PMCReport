import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import type { IconName } from "lucide-react/dynamic";
import NewPricingCalc from "@/components/NewPricingCalc";
import LegacyCompareCalc from "@/components/LegacyCompareCalc";
import LateFeeCalc from "@/components/LateFeeCalc";

type Calculator = {
  id: "new-pricing" | "legacy" | "late-fee";
  title: string;
  badge: string;
  icon: IconName;
  description: string;
};

const calculators: Calculator[] = [
  {
    id: "new-pricing",
    title: "New Pricing",
    badge: "Current",
    icon: "credit-card",
    description: "See the exact fee breakdown for Flex's current pricing structure in real time.",
  },
  {
    id: "legacy",
    title: "New vs. Legacy",
    badge: "Compare",
    icon: "scale",
    description: "Compare current Flex pricing side-by-side with the legacy fee structure.",
  },
  {
    id: "late-fee",
    title: "Flex vs. Late Fee",
    badge: "Save",
    icon: "calendar-clock" as IconName,
    description: "Show residents how Flex compares to the real cost of paying late.",
  },
];

export default function PricingCalculatorPage() {
  const [activeCalculator, setActiveCalculator] = useState<"new-pricing" | "legacy" | "late-fee" | null>(null);

  if (activeCalculator) {
    const handleBack = () => setActiveCalculator(null);
    switch (activeCalculator) {
      case "new-pricing":
        return <NewPricingCalc onBack={handleBack} />;
      case "legacy":
        return <LegacyCompareCalc onBack={handleBack} />;
      case "late-fee":
        return <LateFeeCalc onBack={handleBack} />;
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: "#1D1D1D" }}>Pricing Calculators</h1>
        <p style={{ color: "#6B7280", fontSize: 13, marginTop: 4 }}>Select a calculator to get started</p>
      </div>

      {/* Card grid */}
      <div className="grid grid-cols-3 gap-6">
        {calculators.map((calc) => (
          <button
            key={calc.id}
            onClick={() => setActiveCalculator(calc.id)}
            className="flex flex-col items-start gap-4 text-left transition-all duration-200 hover:shadow-lg group"
            style={{
              backgroundColor: "#FFFFFF",
              border: "1px solid #E5E7EB",
              borderRadius: 16,
              padding: 24,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "#6A3DB8";
              e.currentTarget.style.transform = "translateY(-2px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "#E5E7EB";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            {/* Icon and badge row */}
            <div className="flex items-center gap-3 w-full">
              <div
                className="flex items-center justify-center w-10 h-10 rounded-lg"
                style={{ backgroundColor: "#F3F0FF" }}
              >
                <Icon icon={calc.icon} className="w-5 h-5" style={{ color: "#6A3DB8" }} />
              </div>
              <span
                className="px-2 py-0.5 rounded-full text-xs font-medium"
                style={{ backgroundColor: "#EEE2FC", color: "#6A3DB8", fontSize: 12 }}
              >
                {calc.badge}
              </span>
            </div>

            {/* Title */}
            <h3 style={{ fontSize: 16, fontWeight: 600, color: "#1D1D1D" }}>{calc.title}</h3>

            {/* Description */}
            <p style={{ fontSize: 13, color: "#6B7280", lineHeight: 1.5 }}>{calc.description}</p>

            {/* CTA */}
            <span style={{ fontSize: 13, fontWeight: 500, color: "#6A3DB8", marginTop: "auto" }}>
              Open Calculator →
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
