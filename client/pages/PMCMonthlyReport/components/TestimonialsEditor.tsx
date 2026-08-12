import { useState, useCallback, useEffect, useRef } from "react";
import { Plus, Trash2, MessageSquare, Loader2, Check } from "lucide-react";
import { useApi } from "@/hooks/useApi.js";
import { toast } from "sonner";

export interface Testimonial {
  id: string;
  name: string;
  propertyName: string;
  role: string;
  quote: string;
}

interface ZendeskCandidate {
  name: string;
  propertyName: string;
  quote: string;
  score: number;
  createdAt: string | null;
  selected: boolean;
}

const ROLE_OPTIONS = ["Resident", "Property Manager", "Regional Manager", "VP/Director", "Other"];

interface TestimonialsEditorProps {
  testimonials: Testimonial[];
  onChange: (testimonials: Testimonial[]) => void;
  pmcName: string;
  fetchLabel?: string;
  autoFetch?: boolean;
}

export function TestimonialsEditor({ testimonials, onChange, pmcName, fetchLabel, autoFetch = true }: TestimonialsEditorProps) {
  const [candidates, setCandidates] = useState<ZendeskCandidate[]>([]);
  const [showCandidates, setShowCandidates] = useState(false);
  const { run: fetchTestimonials, loading: fetching } = useApi("GetPMCTestimonials");
  const lastAutoFetchedRef = useRef<string>("");

  // Auto-fetch testimonials when pmcName changes (deduped)
  useEffect(() => {
    if (!autoFetch || !pmcName || pmcName === lastAutoFetchedRef.current) return;
    lastAutoFetchedRef.current = pmcName;
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchTestimonials({ pmc_name: pmcName });
        if (cancelled) return;
        if (result && result.testimonials.length > 0) {
          setCandidates(result.testimonials.map((t) => ({ ...t, selected: true })));
          setShowCandidates(true);
        }
      } catch {
        // silent — user can still manually fetch
      }
    })();
    return () => { cancelled = true; };
  }, [pmcName, autoFetch, fetchTestimonials]);

  const addEntry = useCallback(() => {
    onChange([...testimonials, { id: crypto.randomUUID(), name: "", propertyName: "", role: "Resident", quote: "" }]);
  }, [testimonials, onChange]);

  const removeEntry = useCallback((id: string) => {
    onChange(testimonials.filter((t) => t.id !== id));
  }, [testimonials, onChange]);

  const updateEntry = useCallback((id: string, field: keyof Testimonial, value: string) => {
    onChange(testimonials.map((t) => t.id === id ? { ...t, [field]: value } : t));
  }, [testimonials, onChange]);

  const handleFetchFromZendesk = useCallback(async () => {
    if (!pmcName) {
      toast.error("Select a PMC first");
      return;
    }
    try {
      const result = await fetchTestimonials({ pmc_name: pmcName });
      if (result && result.testimonials.length > 0) {
        setCandidates(result.testimonials.map((t) => ({ ...t, selected: true })));
        setShowCandidates(true);
        toast.success(`Found ${result.testimonials.length} testimonials`);
      } else {
        toast.info("No Zendesk testimonials found for this PMC");
        setCandidates([]);
      }
    } catch {
      toast.error("Failed to fetch testimonials from Zendesk");
    }
  }, [pmcName, fetchTestimonials]);

  const toggleCandidate = useCallback((idx: number) => {
    setCandidates((prev) => prev.map((c, i) => i === idx ? { ...c, selected: !c.selected } : c));
  }, []);

  const addSelectedCandidates = useCallback(() => {
    const selected = candidates.filter((c) => c.selected);
    const newEntries: Testimonial[] = selected.map((c) => ({
      id: crypto.randomUUID(),
      name: c.name,
      propertyName: c.propertyName,
      role: "Resident",
      quote: c.quote,
    }));
    onChange([...testimonials, ...newEntries]);
    setShowCandidates(false);
    setCandidates([]);
    toast.success(`Added ${selected.length} testimonials`);
  }, [candidates, testimonials, onChange]);

  return (
    <div className="space-y-3">
      {/* Existing manual entries */}
      {testimonials.map((entry, idx) => (
        <div key={entry.id} className="p-3 border border-gray-200 rounded-[4px] bg-white space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Testimonial {idx + 1}</span>
            <button type="button" onClick={() => removeEntry(entry.id)} className="text-gray-400 hover:text-red-500 transition-colors">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input
              type="text"
              value={entry.name}
              onChange={(e) => updateEntry(entry.id, "name", e.target.value)}
              placeholder="Name"
              className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-[4px] focus:outline-none focus:ring-1 focus:ring-[#6A3DB8]/30"
            />
            <input
              type="text"
              value={entry.propertyName}
              onChange={(e) => updateEntry(entry.id, "propertyName", e.target.value)}
              placeholder="Property name"
              className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-[4px] focus:outline-none focus:ring-1 focus:ring-[#6A3DB8]/30"
            />
            <select
              value={entry.role}
              onChange={(e) => updateEntry(entry.id, "role", e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-[4px] focus:outline-none focus:ring-1 focus:ring-[#6A3DB8]/30 bg-white"
            >
              {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <textarea
            value={entry.quote}
            onChange={(e) => updateEntry(entry.id, "quote", e.target.value)}
            placeholder="Quote text..."
            rows={2}
            className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-[4px] focus:outline-none focus:ring-1 focus:ring-[#6A3DB8]/30 resize-y"
          />
        </div>
      ))}

      {/* Zendesk candidates panel */}
      {showCandidates && candidates.length > 0 && (
        <div className="border border-[#6A3DB8]/30 rounded-[4px] bg-[#F9F5FF] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#6A3DB8]">
              Zendesk Testimonials ({candidates.filter((c) => c.selected).length}/{candidates.length} selected)
            </span>
            <button
              type="button"
              onClick={() => setCandidates((prev) => prev.map((c) => ({ ...c, selected: !prev.every((p) => p.selected) })))}
              className="text-[10px] text-[#6A3DB8] hover:underline"
            >
              {candidates.every((c) => c.selected) ? "Deselect all" : "Select all"}
            </button>
          </div>

          <div className="max-h-[300px] overflow-y-auto space-y-1.5">
            {candidates.map((c, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => toggleCandidate(idx)}
                className={`w-full text-left p-2.5 rounded-[4px] border transition-all ${
                  c.selected
                    ? "border-[#6A3DB8]/40 bg-white shadow-sm"
                    : "border-gray-200 bg-gray-50 opacity-60"
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                    c.selected ? "bg-[#6A3DB8] border-[#6A3DB8]" : "border-gray-300 bg-white"
                  }`}>
                    {c.selected && <Check className="h-2.5 w-2.5 text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-700 line-clamp-2">&ldquo;{c.quote}&rdquo;</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-gray-500 font-medium">{c.name}</span>
                      {c.propertyName && (
                        <span className="text-[10px] text-gray-400">• {c.propertyName}</span>
                      )}
                      <span className="text-[10px] text-[#6A3DB8]/60 ml-auto">score: {c.score}</span>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={addSelectedCandidates}
              disabled={candidates.filter((c) => c.selected).length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#6A3DB8] rounded-[4px] hover:bg-[#5A2DA8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check className="h-3.5 w-3.5" />
              Add {candidates.filter((c) => c.selected).length} selected
            </button>
            <button
              type="button"
              onClick={() => { setShowCandidates(false); setCandidates([]); }}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-[4px] hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={addEntry}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#6A3DB8] border border-[#6A3DB8]/30 rounded-[4px] hover:bg-[#EEE2FC] transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Add manually
        </button>
        <button
          type="button"
          onClick={handleFetchFromZendesk}
          disabled={fetching || !pmcName}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-[4px] hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {fetching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <MessageSquare className="h-3.5 w-3.5" />
          )}
          {fetching ? "Pulling..." : (fetchLabel || "Pull from Zendesk")}
        </button>
      </div>
    </div>
  );
}
