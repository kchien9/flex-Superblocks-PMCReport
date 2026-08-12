import { useState, useMemo, useCallback } from "react";
import { Search } from "lucide-react";

interface PMCSearchProps {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  pmcNames: string[];
  loading?: boolean;
  optional?: boolean;
}

export function PMCSearch({ label, placeholder, value, onChange, pmcNames, loading, optional }: PMCSearchProps) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!pmcNames.length) return [];
    if (!query) return pmcNames.slice(0, 80);
    const q = query.toLowerCase();
    return pmcNames.filter((n) => n.toLowerCase().includes(q)).slice(0, 80);
  }, [pmcNames, query]);

  const handleSelect = useCallback((name: string) => {
    setQuery(name);
    onChange(name);
    setOpen(false);
  }, [onChange]);

  const handleClear = useCallback(() => {
    setQuery("");
    onChange("");
  }, [onChange]);

  return (
    <div className="relative">
      <div className="flex items-baseline gap-2 mb-1.5">
        <label className="block text-xs font-medium text-gray-600">{label}</label>
        {optional && <span className="text-[10px] text-gray-400">optional</span>}
        {!loading && pmcNames.length > 0 && (
          <span className="text-[10px] text-gray-400 ml-auto">{pmcNames.length} PMCs available</span>
        )}
      </div>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (!e.target.value) onChange("");
          }}
          onFocus={() => setOpen(true)}
          placeholder={loading ? "Loading..." : placeholder || "Search PMC..."}
          className="w-full pl-8 pr-8 py-2 text-sm border border-gray-200 rounded-[4px] focus:outline-none focus:ring-2 focus:ring-[#6A3DB8]/30 focus:border-[#6A3DB8]"
          disabled={loading}
        />
        {query && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
          >
            &times;
          </button>
        )}
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-[200px] overflow-auto bg-white border border-gray-200 rounded-[4px] shadow-lg">
          {filtered.map((name) => (
            <button
              key={name}
              type="button"
              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-[#EEE2FC] transition-colors truncate ${
                name === value ? "bg-[#EEE2FC] font-medium text-[#2C194D]" : ""
              }`}
              onClick={() => handleSelect(name)}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
    </div>
  );
}
