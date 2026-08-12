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

export default function NewPricingCalc({ onBack }: Props) {
  const [rent, setRent] = useState(1500);
  const [rateIndex, setRateIndex] = useState(0);
  const [splitIndex, setSplitIndex] = useState(1); // default 60/40

  const rate = splitRates[rateIndex].value;
  const downPct = splitOptions[splitIndex].down;
  const repayPct = 1 - downPct;

  const calc = useMemo(() => {
    const downPayment = rent * downPct;
    const repayment = rent * repayPct;
    const splitFee = repayment * rate;
    const processingFee = rent * 0.005;
    const membership = 5.99;
    const total = membership + splitFee + processingFee;
    return { downPayment, repayment, splitFee, processingFee, membership, total };
  }, [rent, rate, downPct, repayPct]);

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
        <h1 style={{ fontSize: 20, fontWeight: 500, color: "#6A3DB8" }}>What does Flex cost your residents?</h1>
        <p style={{ color: "#6B7280", fontSize: 13, marginTop: 4 }}>
          Configure the rent amount and payment split to see an exact Flex fee breakdown in real time.
        </p>
      </div>

      {/* Inputs card */}
      <div style={{ backgroundColor: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 12, padding: 24 }}>
        <div className="flex flex-col gap-6">
          {/* Rent slider */}
          <div className="flex items-center gap-6">
            <div className="flex-1">
              <label className="text-xs font-medium uppercase tracking-wide" style={{ color: "#6B7280" }}>
                Monthly Rent
              </label>
              <input
                type="range"
                min={500}
                max={5000}
                step={50}
                value={rent}
                onChange={(e) => setRent(Number(e.target.value))}
                className="w-full mt-2 accent-[#6A3DB8]"
              />
              <div className="flex justify-between text-xs mt-1" style={{ color: "#9CA3AF" }}>
                <span>$500</span>
                <span>$5,000</span>
              </div>
            </div>
            <div className="text-right">
              <span style={{ fontSize: 28, fontWeight: 700, color: "#1D1D1D" }}>
                ${rent.toLocaleString()}
              </span>
            </div>
          </div>

          {/* Split rate dropdown */}
          <div>
            <label className="text-xs font-medium uppercase tracking-wide" style={{ color: "#6B7280" }}>
              Split fee rate
            </label>
            <select
              value={rateIndex}
              onChange={(e) => setRateIndex(Number(e.target.value))}
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              style={{ borderColor: "#E5E7EB" }}
            >
              {splitRates.map((r, i) => (
                <option key={i} value={i}>{r.label}</option>
              ))}
            </select>
          </div>

          {/* Split toggle */}
          <div>
            <label className="text-xs font-medium uppercase tracking-wide" style={{ color: "#6B7280" }}>
              Payment split
            </label>
            <div className="flex gap-1 mt-2 bg-gray-100 p-1 rounded-lg w-fit">
              {splitOptions.map((opt, i) => (
                <button
                  key={opt.label}
                  onClick={() => setSplitIndex(i)}
                  className="px-4 py-1.5 rounded-md text-sm font-medium transition-colors"
                  style={{
                    backgroundColor: splitIndex === i ? "#6A3DB8" : "transparent",
                    color: splitIndex === i ? "#FFFFFF" : "#6B7280",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Visual split indicator */}
          <div className="flex gap-1 w-full h-10 rounded-lg overflow-hidden">
            <div
              className="flex items-center justify-center text-white text-xs font-medium"
              style={{ width: `${downPct * 100}%`, backgroundColor: "#2C194D" }}
            >
              {Math.round(downPct * 100)}% · {fmt(calc.downPayment)}
            </div>
            <div
              className="flex items-center justify-center text-white text-xs font-medium"
              style={{ width: `${repayPct * 100}%`, backgroundColor: "#6A3DB8" }}
            >
              {Math.round(repayPct * 100)}% · {fmt(calc.repayment)}
            </div>
          </div>
        </div>
      </div>

      {/* Payment flow panels */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl p-5" style={{ backgroundColor: "#2C194D" }}>
          <p className="text-white/60 text-xs uppercase tracking-wide font-medium">1st payment – due date</p>
          <p className="text-white text-2xl font-bold mt-2">{fmt(calc.downPayment)}</p>
          <p className="text-white/60 text-xs mt-2">Down payment sent to Flex</p>
        </div>
        <div className="rounded-xl p-5" style={{ backgroundColor: "#EEE2FC" }}>
          <p className="text-xs uppercase tracking-wide font-medium" style={{ color: "#6A3DB8", opacity: 0.7 }}>2nd payment – mid-month</p>
          <p className="text-2xl font-bold mt-2" style={{ color: "#6A3DB8" }}>{fmt(calc.repayment)}</p>
          <p className="text-xs mt-2" style={{ color: "#6A3DB8", opacity: 0.7 }}>Repayment + fees to Flex</p>
        </div>
      </div>

      {/* Fee breakdown */}
      <div style={{ backgroundColor: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 12, padding: 24 }}>
        <h3 className="text-sm font-semibold mb-4" style={{ color: "#1D1D1D" }}>Fee Breakdown</h3>
        <div className="flex flex-col gap-3">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm" style={{ color: "#1D1D1D" }}>Membership fee</p>
              <p className="text-xs" style={{ color: "#6B7280" }}>$5.99/mo flat · includes rent reporting</p>
            </div>
            <span className="text-sm font-medium" style={{ color: "#1D1D1D" }}>$5.99</span>
          </div>
          <div className="border-t" style={{ borderColor: "#F3F4F6" }} />
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm" style={{ color: "#1D1D1D" }}>Split fee</p>
              <p className="text-xs" style={{ color: "#6B7280" }}>{(rate * 100).toFixed(2)}% on repayment amount</p>
            </div>
            <span className="text-sm font-medium" style={{ color: "#1D1D1D" }}>{fmt(calc.splitFee)}</span>
          </div>
          <div className="border-t" style={{ borderColor: "#F3F4F6" }} />
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm" style={{ color: "#1D1D1D" }}>Processing fee</p>
              <p className="text-xs" style={{ color: "#6B7280" }}>0.5% of total rent, at down payment</p>
            </div>
            <span className="text-sm font-medium" style={{ color: "#1D1D1D" }}>{fmt(calc.processingFee)}</span>
          </div>
          <div className="border-t border-dashed" style={{ borderColor: "#E5E7EB" }} />
          <div className="flex justify-between items-center pt-1">
            <span className="text-sm font-semibold" style={{ color: "#1D1D1D" }}>Total monthly cost</span>
            <span className="text-lg font-bold" style={{ color: "#6A3DB8" }}>{fmt(calc.total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
