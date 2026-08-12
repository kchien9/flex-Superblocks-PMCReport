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

export default function LateFeeCalc({ onBack }: Props) {
  const [rent, setRent] = useState(1500);
  const [daysLate, setDaysLate] = useState(5);
  const [flatFee, setFlatFee] = useState(100);
  const [dailyAccrual, setDailyAccrual] = useState(10);
  const [rateIndex, setRateIndex] = useState(0);
  const [splitIndex, setSplitIndex] = useState(1);
  const [months, setMonths] = useState(12);

  const rate = splitRates[rateIndex].value;
  const repayPct = 1 - splitOptions[splitIndex].down;

  const calc = useMemo(() => {
    const repayment = rent * repayPct;
    const flexMembership = 5.99;
    const flexSplitFee = repayment * rate;
    const flexProcessingFee = rent * 0.005;
    const flexTotal = flexMembership + flexSplitFee + flexProcessingFee;
    const lateTotal = flatFee + dailyAccrual * daysLate;
    const difference = lateTotal - flexTotal;
    const flexWins = difference > 0;
    return { flexMembership, flexSplitFee, flexProcessingFee, flexTotal, lateTotal, difference, flexWins };
  }, [rent, rate, repayPct, flatFee, dailyAccrual, daysLate]);

  const fmt = (n: number) => "$" + n.toFixed(2);

  return (
    <div className="flex flex-col gap-6 max-w-[960px] mx-auto w-full">
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
        <h1 style={{ fontSize: 20, fontWeight: 500, color: "#6A3DB8" }}>Flex vs. Late Fee</h1>
        <p style={{ color: "#6B7280", fontSize: 13, marginTop: 4 }}>
          Show residents how Flex compares to the real cost of paying late.
        </p>
      </div>

      {/* Inputs card */}
      <div style={{ backgroundColor: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 12, padding: 24 }}>
        <div className="grid grid-cols-2 gap-6">
          {/* Rent slider */}
          <div>
            <label className="text-xs font-medium uppercase tracking-wide" style={{ color: "#6B7280" }}>Monthly Rent</label>
            <input type="range" min={500} max={5000} step={50} value={rent} onChange={(e) => setRent(Number(e.target.value))} className="w-full mt-2 accent-[#6A3DB8]" />
            <div className="flex justify-between text-xs mt-1" style={{ color: "#9CA3AF" }}>
              <span>$500</span><span>$5,000</span>
            </div>
            <p className="text-right text-sm font-bold mt-1" style={{ color: "#1D1D1D" }}>${rent.toLocaleString()}</p>
          </div>

          {/* Days late slider */}
          <div>
            <label className="text-xs font-medium uppercase tracking-wide" style={{ color: "#6B7280" }}>Days Late</label>
            <input type="range" min={1} max={30} step={1} value={daysLate} onChange={(e) => setDaysLate(Number(e.target.value))} className="w-full mt-2 accent-[#6A3DB8]" />
            <div className="flex justify-between text-xs mt-1" style={{ color: "#9CA3AF" }}>
              <span>1 day</span><span>30 days</span>
            </div>
            <p className="text-right text-sm font-bold mt-1" style={{ color: "#1D1D1D" }}>{daysLate} days</p>
          </div>

          {/* Flat late fee */}
          <div>
            <label className="text-xs font-medium uppercase tracking-wide" style={{ color: "#6B7280" }}>Flat Late Fee</label>
            <div className="flex items-center mt-1 border rounded-lg overflow-hidden" style={{ borderColor: "#E5E7EB" }}>
              <span className="px-3 py-2 text-sm bg-gray-50" style={{ color: "#6B7280" }}>$</span>
              <input type="number" value={flatFee} onChange={(e) => setFlatFee(Number(e.target.value))} className="flex-1 px-3 py-2 text-sm outline-none" />
            </div>
          </div>

          {/* Daily accrual */}
          <div>
            <label className="text-xs font-medium uppercase tracking-wide" style={{ color: "#6B7280" }}>Daily Accrual</label>
            <div className="flex items-center mt-1 border rounded-lg overflow-hidden" style={{ borderColor: "#E5E7EB" }}>
              <span className="px-3 py-2 text-sm bg-gray-50" style={{ color: "#6B7280" }}>$</span>
              <input type="number" value={dailyAccrual} onChange={(e) => setDailyAccrual(Number(e.target.value))} className="flex-1 px-3 py-2 text-sm outline-none" />
            </div>
          </div>

          {/* Split rate */}
          <div>
            <label className="text-xs font-medium uppercase tracking-wide" style={{ color: "#6B7280" }}>Split fee rate</label>
            <select value={rateIndex} onChange={(e) => setRateIndex(Number(e.target.value))} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" style={{ borderColor: "#E5E7EB" }}>
              {splitRates.map((r, i) => (<option key={i} value={i}>{r.label}</option>))}
            </select>
          </div>

          {/* Split toggle */}
          <div>
            <label className="text-xs font-medium uppercase tracking-wide" style={{ color: "#6B7280" }}>Payment split</label>
            <div className="flex gap-1 mt-2 bg-gray-100 p-1 rounded-lg w-fit">
              {splitOptions.map((opt, i) => (
                <button key={opt.label} onClick={() => setSplitIndex(i)} className="px-4 py-1.5 rounded-md text-sm font-medium transition-colors" style={{ backgroundColor: splitIndex === i ? "#6A3DB8" : "transparent", color: splitIndex === i ? "#FFFFFF" : "#6B7280" }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Winner banner */}
      <div className="rounded-xl p-4" style={{ backgroundColor: "#EEE2FC", border: "1px solid #DDC6F9" }}>
        <p className="text-sm font-medium" style={{ color: "#2C194D" }}>
          {calc.flexWins
            ? `Flex costs ${fmt(calc.difference)} less than a single late payment. For your residents, that's the difference between a penalty and a service — every single month.`
            : `Flex costs ${fmt(Math.abs(calc.difference))} more than one late payment at current inputs. Try increasing the late fee or daily accrual to reflect your actual policy.`}
        </p>
      </div>

      {/* Comparison panels */}
      <div className="grid grid-cols-2 gap-4">
        {/* Late payment */}
        <div className="rounded-xl p-5" style={{ backgroundColor: "#FEF2F2", border: "1px solid #FECACA" }}>
          <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "#DC2626" }}>Late payment cost</p>
          <p className="text-2xl font-bold mt-2" style={{ color: "#DC2626" }}>{fmt(calc.lateTotal)}</p>
          <div className="mt-4 flex flex-col gap-2 text-xs" style={{ color: "#991B1B" }}>
            <div className="flex justify-between">
              <span>Flat fee</span>
              <span>{fmt(flatFee)}</span>
            </div>
            <div className="flex justify-between">
              <span>Daily accrual ({daysLate} days × ${dailyAccrual})</span>
              <span>{fmt(dailyAccrual * daysLate)}</span>
            </div>
          </div>
        </div>

        {/* Flex */}
        <div className="rounded-xl p-5" style={{ backgroundColor: "#F5F0FF", border: "1px solid #DDC6F9" }}>
          <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "#6A3DB8" }}>Flex monthly cost</p>
          <p className="text-2xl font-bold mt-2" style={{ color: "#6A3DB8" }}>{fmt(calc.flexTotal)}</p>
          <div className="mt-4 flex flex-col gap-2 text-xs" style={{ color: "#4C1D95" }}>
            <div className="flex justify-between">
              <span>Membership</span>
              <span>{fmt(calc.flexMembership)}</span>
            </div>
            <div className="flex justify-between">
              <span>Split fee</span>
              <span>{fmt(calc.flexSplitFee)}</span>
            </div>
            <div className="flex justify-between">
              <span>Processing fee</span>
              <span>{fmt(calc.flexProcessingFee)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Period comparison */}
      <div style={{ backgroundColor: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 12, padding: 24 }}>
        <h3 className="text-sm font-semibold mb-4" style={{ color: "#1D1D1D" }}>Period Comparison</h3>
        <div className="grid grid-cols-3 gap-4">
          {/* Months selector */}
          <div className="rounded-lg p-4" style={{ backgroundColor: "#F7F7F7" }}>
            <label className="text-xs font-medium uppercase tracking-wide" style={{ color: "#6B7280" }}>Months</label>
            <input type="range" min={1} max={24} step={1} value={months} onChange={(e) => setMonths(Number(e.target.value))} className="w-full mt-2 accent-[#6A3DB8]" />
            <p className="text-center text-lg font-bold mt-1" style={{ color: "#1D1D1D" }}>{months} mo</p>
          </div>

          {/* Flex over period */}
          <div className="rounded-lg p-4" style={{ backgroundColor: "#F5F0FF" }}>
            <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "#6A3DB8" }}>Flex over period</p>
            <p className="text-xl font-bold mt-2" style={{ color: "#6A3DB8" }}>{fmt(calc.flexTotal * months)}</p>
          </div>

          {/* Late fees over period */}
          <div className="rounded-lg p-4" style={{ backgroundColor: "#FEF2F2" }}>
            <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "#DC2626" }}>Late fees over period</p>
            <p className="text-xl font-bold mt-2" style={{ color: "#DC2626" }}>{fmt(calc.lateTotal * months)}</p>
          </div>
        </div>

        {/* Net difference */}
        <div className="mt-4 text-center rounded-lg p-4" style={{ backgroundColor: calc.flexWins ? "#DCFCE7" : "#FEF2F2" }}>
          <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "#6B7280" }}>Net difference over {months} months</p>
          <p className="text-2xl font-bold mt-1" style={{ color: calc.flexWins ? "#16A34A" : "#DC2626" }}>
            {calc.flexWins ? "Saves " : "Costs extra "}{fmt(Math.abs(calc.difference * months))}
          </p>
        </div>
      </div>
    </div>
  );
}
