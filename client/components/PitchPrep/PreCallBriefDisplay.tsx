import { useState, useCallback } from "react";

interface BriefData {
  company_name?: string;
  subtitle?: string;
  hero_stats?: { value: string; label: string }[];
  snapshot_cards?: { label: string; content: string; warning: boolean }[];
  account_status_bar?: string;
  value_pillars?: { title: string; stat_line: string; body: string; pull_quote: string }[];
  talking_points?: { type: "ask" | "point"; text: string }[];
  objections?: { objection: string; response: string }[];
  recommended_slides?: { slide_number: number; title: string; reason: string }[];
  sources?: { name: string; url: string }[];
}

interface PreCallBriefDisplayProps {
  data: BriefData;
  onPracticePitch: () => void;
}

function ObjectionItem({ objection, response }: { objection: string; response: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50 transition-colors text-left"
      >
        <span className="text-sm font-medium text-gray-900 pr-4">{objection}</span>
        <span className="flex-shrink-0 text-gray-400 text-lg leading-none">
          {open ? "−" : "+"}
        </span>
      </button>
      {open && (
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
          <p className="text-sm text-gray-700 leading-relaxed">{response}</p>
        </div>
      )}
    </div>
  );
}

export default function PreCallBriefDisplay({ data, onPracticePitch }: PreCallBriefDisplayProps) {
  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  return (
    <div className="space-y-8">
      {/* HERO BAR */}
      <section className="bg-[#0f1623] rounded-xl px-6 py-6 -mx-2">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-white">{data.company_name}</h2>
            {data.subtitle && (
              <p className="text-sm text-gray-300 mt-1 max-w-2xl">{data.subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={handlePrint}
            className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/10 text-white text-xs font-medium hover:bg-white/20 transition-colors"
          >
            Print / Save PDF
          </button>
        </div>
        {data.hero_stats && data.hero_stats.length > 0 && (
          <div className="flex flex-wrap gap-3 mt-4">
            {data.hero_stats.map((stat, i) => (
              <div
                key={i}
                className="bg-white/10 backdrop-blur-sm rounded-lg px-4 py-3 min-w-[140px]"
              >
                <span className="text-xl font-bold text-white block">{stat.value}</span>
                <span className="text-xs text-gray-300 block mt-0.5 leading-tight">{stat.label}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* SNAPSHOT CARDS */}
      {data.snapshot_cards && data.snapshot_cards.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Quick Snapshot
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.snapshot_cards.map((card, i) => (
              <div
                key={i}
                className={[
                  "rounded-lg px-4 py-3 border",
                  card.warning
                    ? "border-amber-200 border-l-4 border-l-amber-400 bg-amber-50/50"
                    : "border-gray-200 bg-white",
                ].join(" ")}
              >
                <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">
                  {card.label}
                </span>
                <p className="text-sm text-gray-800 leading-relaxed">{card.content}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ACCOUNT STATUS */}
      {data.account_status_bar && (
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Account Status
          </h3>
          <div className="bg-white border border-gray-200 rounded-lg px-5 py-4">
            <p className="text-sm text-gray-800 leading-relaxed pl-3 border-l-3 border-l-[#00c896]"
               style={{ borderLeftWidth: "3px", borderLeftColor: "#00c896" }}>
              {data.account_status_bar}
            </p>
          </div>
        </section>
      )}

      {/* VALUE PILLARS */}
      {data.value_pillars && data.value_pillars.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">
            Value Pillars
          </h3>
          <div className="space-y-6">
            {data.value_pillars.map((pillar, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-lg p-5">
                <h4 className="text-base font-semibold text-gray-900 mb-1">{pillar.title}</h4>
                <p className="text-lg font-bold text-[#00c896] mb-3">{pillar.stat_line}</p>
                <p className="text-sm text-gray-700 leading-relaxed mb-4">{pillar.body}</p>
                {pillar.pull_quote && (
                  <blockquote className="border-l-4 border-[#00c896] pl-4 py-1">
                    <p className="text-base text-gray-800 italic leading-relaxed">
                      "{pillar.pull_quote}"
                    </p>
                  </blockquote>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* TALKING POINTS */}
      {data.talking_points && data.talking_points.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Talking Points
          </h3>
          <div className="space-y-2">
            {data.talking_points.map((tp, i) => (
              <div
                key={i}
                className="flex items-start gap-3 bg-white border border-gray-200 rounded-lg px-4 py-3"
              >
                {tp.type === "ask" ? (
                  <span className="flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-[#0f1623] text-white mt-0.5">
                    ASK
                  </span>
                ) : (
                  <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-[#00c896] mt-2" />
                )}
                <p className="text-sm text-gray-800 leading-relaxed">{tp.text}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* OBJECTION PLAYBOOK */}
      {data.objections && data.objections.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Objection Playbook
          </h3>
          <div className="space-y-2">
            {data.objections.map((obj, i) => (
              <ObjectionItem key={i} objection={obj.objection} response={obj.response} />
            ))}
          </div>
        </section>
      )}

      {/* RECOMMENDED SLIDES */}
      {data.recommended_slides && data.recommended_slides.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Recommended Deck Slides
          </h3>
          <div className="space-y-2">
            {data.recommended_slides.map((slide, i) => (
              <div
                key={i}
                className="flex items-start gap-3 bg-white border border-gray-200 rounded-lg px-4 py-3"
              >
                <span className="flex-shrink-0 w-8 h-8 rounded-lg bg-[#0f1623] text-white text-xs font-bold flex items-center justify-center">
                  {slide.slide_number}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{slide.title}</p>
                  <p className="text-xs text-gray-500 leading-relaxed mt-0.5">{slide.reason}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* SOURCES */}
      {data.sources && data.sources.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Sources
          </h3>
          <ol className="list-decimal list-inside space-y-1">
            {data.sources.map((source, i) => (
              <li key={i} className="text-xs text-gray-600">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#00c896] hover:underline"
                >
                  {source.name}
                </a>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* PRACTICE THIS PITCH BUTTON */}
      <div className="pt-4 border-t border-gray-200">
        <button
          type="button"
          onClick={onPracticePitch}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[#00c896] text-white text-sm font-semibold hover:bg-[#00b386] transition-colors shadow-sm"
        >
          Practice This Pitch →
        </button>
      </div>
    </div>
  );
}
