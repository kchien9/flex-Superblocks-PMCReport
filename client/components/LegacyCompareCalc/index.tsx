import { useState, useMemo } from "react";
import { Icon } from "@/components/ui/icon";

const splitRates = [
  { label: "3.00% – Other States", value: 0.03 },
  { label: "1.75% – Colorado", value: 0.0175 },
  { label: "1.00% – Connecticut", value: 0.01 },
  { label: "1.50% – Maine", value: 0.015 },
  { label: "1.50% – Massachusetts", value: 0.015 },
  { label: "2.08% – New York", value: 0.0208 },
];

const splitOptions = [
  { label: "50/50", down: 0.5 },
  { label: "60/40", down: 0.6 },
  { label: "70/30", down: 0.7 },
];

type Props = { onBack: () => void };

export default function LegacyCompareCalc({ onBack }: Props) {
  const [rent, setRent] = useState(1500);
  const [rateIndex, setRateIndex] = useState(0);
  const [splitIndex, setSplitIndex] = useState(1);
  const [includePassThrough, setIncludePassThrough] = useState(true);

  const rate = splitRates[rateIndex].value;
  const downPct = splitOptions[splitIndex].down;
  const repayPct = 1 - downPct;

  const calc = useMemo(() => {
    const repayment = rent * repayPct;
    // Legacy
    const legacyMembership = 14.99;
    const legacyBpFee = rent * 0.01;
    const legacyPassThrough = includePassThrough ? 3.0 : 0;
    const legacyTotal = legacyMembership + legacyBpFee + legacyPassThrough;
    // New
    const newMembership = 5.99;
    const newSplitFee = repayment * rate;
    const newProcessingFee = rent * 0.005;
    const newTotal = newMembership + newSplitFee + newProcessingFee;
    return { repayment, legacyMembership, legacyBpFee, legacyPassThrough, legacyTotal, newMembership, newSplitFee, newProcessingFee, newTotal };
  }, [rent, rate, repayPct, includePassThrough]);

  const fmt = (n: number) => "$" + n.toFixed(2);

  return (
    <div className="flex flex-col gap-6 max-w-[760px] mx-auto w-full">
      {/* Back link */}
      <button
        onClick={onBack}
        className="flex items-center gap-1 self-start text-sm font-medium hover:opacity-80 transition-opacity"
        style={{ color: "#6A3DB8" }}
      >
        <Icon icon="arrow-left" className="w-4 h-4" />
        Back to Calculators
      </button>

      {/* Title */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: "#6A3DB8" }}>New vs. Legacy Pricing</h1>
        <p style={{ color: "#6B7280", fontSize: 13, marginTop: 4 }}>
          Compare current Flex pricing side-by-side with the legacy fee structure.
        </p>
      </div>

      {/* Inputs card */}
      <div style={{ backgroundColor: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 12, padding: 24 }}>
        <div className="flex flex-col gap-6">
          {/* Rent slider */}
          <div className="flex items-center gap-6">
            <div className="flex-1">
              <label className="text-xs font-medium uppercase tracking-wide" style={{ color: "#6B7280" }}>Monthly Rent</label>
              <input
                type="range" min={500} max={5000} step={50} value={rent}
                onChange={(e) => setRent(Number(e.target.value))}
                className="w-full mt-2 accent-[#6A3DB8]"
              />
              <div className="flex justify-between text-xs mt-1" style={{ color: "#9CA3AF" }}>
                <span>$500</span><span>$5,000</span>
              </div>
            </div>
            <span style={{ fontSize: 28, fontWeight: 700, color: "#1D1D1D" }}>${rent.toLocaleString()}</span>
          </div>

          {/* Split rate */}
          <div>
            <label className="text-xs font-medium uppercase tracking-wide" style={{ color: "#6B7280" }}>Split fee rate</label>
            <select
              value={rateIndex}
              onChange={(e) => setRateIndex(Number(e.target.value))}
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              style={{ borderColor: "#E5E7EB" }}
            >
              {splitRates.map((r, i) => (<option key={i} value={i}>{r.label}</option>))}
            </select>
          </div>

          {/* Split toggle */}
          <div>
            <label className="text-xs font-medium uppercase tracking-wide" style={{ color: "#6B7280" }}>Payment split</label>
            <div className="flex gap-1 mt-2 bg-gray-100 p-1 rounded-lg w-fit">
              {splitOptions.map((opt, i) => (
                <button
                  key={opt.label}
                  onClick={() => setSplitIndex(i)}
                  className="px-4 py-1.5 rounded-md text-sm font-medium transition-colors"
                  style={{ backgroundColor: splitIndex === i ? "#6A3DB8" : "transparent", color: splitIndex === i ? "#FFFFFF" : "#6B7280" }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Side-by-side comparison */}
      <div className="grid grid-cols-2 gap-4">
        {/* Legacy */}
        <div style={{ backgroundColor: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 12, padding: 24 }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: "#6B7280" }}>Legacy Pricing</h3>
          <div className="flex flex-col gap-3">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm" style={{ color: "#1D1D1D" }}>Membership fee</p>
                <p className="text-xs" style={{ color: "#6B7280" }}>$14.99/mo flat</p>
                <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: "#F3F4F6", color: "#6B7280" }}>Rent reporting: add-on</span>
              </div>
              <span className="text-sm font-medium" style={{ color: "#1D1D1D" }}>{fmt(calc.legacyMembership)}</span>
            </div>
            <div className="border-t" style={{ borderColor: "#F3F4F6" }} />
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm" style={{ color: "#1D1D1D" }}>BP fee</p>
                <p className="text-xs" style={{ color: "#6B7280" }}>1% of total rent</p>
              </div>
              <span className="text-sm font-medium" style={{ color: "#1D1D1D" }}>{fmt(calc.legacyBpFee)}</span>
            </div>
            <div className="border-t" style={{ borderColor: "#F3F4F6" }} />
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={includePassThrough}
                  onChange={(e) => setIncludePassThrough(e.target.checked)}
                  className="accent-[#6A3DB8]"
                />
                <div>
                  <p className="text-sm" style={{ color: "#1D1D1D" }}>Property pass-through fee</p>
                  <p className="text-xs" style={{ color: "#6B7280" }}>$3.00 flat</p>
                </div>
              </div>
              <span className="text-sm font-medium" style={{ color: includePassThrough ? "#1D1D1D" : "#9CA3AF" }}>{fmt(calc.legacyPassThrough)}</span>
            </div>
            <div className="border-t border-dashed" style={{ borderColor: "#E5E7EB" }} />
            <div className="flex justify-between items-center pt-1">
              <span className="text-sm font-semibold" style={{ color: "#1D1D1D" }}>Total monthly cost</span>
              <span className="text-lg font-bold" style={{ color: "#6B7280" }}>{fmt(calc.legacyTotal)}</span>
            </div>
          </div>
        </div>

        {/* New */}
        <div style={{ backgroundColor: "#FFFFFF", border: "2px solid #6A3DB8", borderRadius: 12, padding: 24 }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: "#6A3DB8" }}>New Pricing</h3>
          <div className="flex flex-col gap-3">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm" style={{ color: "#1D1D1D" }}>Membership fee</p>
                <p className="text-xs" style={{ color: "#6B7280" }}>$5.99/mo flat</p>
                <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: "#EEE2FC", color: "#6A3DB8" }}>Rent reporting included</span>
              </div>
              <span className="text-sm font-medium" style={{ color: "#1D1D1D" }}>{fmt(calc.newMembership)}</span>
            </div>
            <div className="border-t" style={{ borderColor: "#F3F4F6" }} />
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm" style={{ color: "#1D1D1D" }}>Split fee</p>
                <p className="text-xs" style={{ color: "#6B7280" }}>{(rate * 100).toFixed(2)}% on repayment amount</p>
              </div>
              <span className="text-sm font-medium" style={{ color: "#1D1D1D" }}>{fmt(calc.newSplitFee)}</span>
            </div>
            <div className="border-t" style={{ borderColor: "#F3F4F6" }} />
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm" style={{ color: "#1D1D1D" }}>Processing fee</p>
                <p className="text-xs" style={{ color: "#6B7280" }}>0.5% of total rent</p>
              </div>
              <span className="text-sm font-medium" style={{ color: "#1D1D1D" }}>{fmt(calc.newProcessingFee)}</span>
            </div>
            <div className="border-t border-dashed" style={{ borderColor: "#E5E7EB" }} />
            <div className="flex justify-between items-center pt-1">
              <span className="text-sm font-semibold" style={{ color: "#1D1D1D" }}>Total monthly cost</span>
              <span className="text-lg font-bold" style={{ color: "#6A3DB8" }}>{fmt(calc.newTotal)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
