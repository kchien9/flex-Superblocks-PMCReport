import { useState, useCallback, useRef, useEffect } from "react";
import { useApi } from "@/hooks/useApi.js";
import { Loader2, Search } from "lucide-react";

export interface ProspectResult {
  account_id: string;
  account_name: string;
  total_units: number;
  state: string;
  segment: string;
  pms: string;
  portfolio_type: string;
  asset_subtypes: string[];
  opp_stage: string;
  opp_id: string;
}

interface ProspectSearchProps {
  onSelect: (result: ProspectResult) => void;
  className?: string;
}

export function ProspectSearch({ onSelect, className }: ProspectSearchProps) {
  const [inputValue, setInputValue] = useState("");
  const [results, setResults] = useState<ProspectResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedName, setSelectedName] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { run: search, loading } = useApi("SearchProspectAccounts");

  const doSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setResults([]);
      setShowDropdown(false);
      return;
    }
    try {
      const response = await search({ query: query.trim() });
      if (response && response.results) {
        setResults(response.results);
        setShowDropdown(true);
      }
    } catch {
      setResults([]);
    }
  }, [search]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    setSelectedName("");

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doSearch(value);
    }, 300);
  }, [doSearch]);

  const handleSelect = useCallback((result: ProspectResult) => {
    setSelectedName(result.account_name);
    setInputValue(result.account_name);
    setShowDropdown(false);
    setResults([]);
    onSelect(result);
  }, [onSelect]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const inputCls = "w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-[4px] focus:outline-none focus:ring-2 focus:ring-[#6A3DB8]/30 focus:border-[#6A3DB8]";

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`}>
      <label className="block text-xs font-medium text-gray-600 mb-1.5">Prospect Account</label>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
        {loading && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 animate-spin" />}
        <input
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={() => { if (results.length > 0 && !selectedName) setShowDropdown(true); }}
          placeholder="Search Salesforce prospect accounts..."
          className={inputCls}
        />
      </div>
      {selectedName && (
        <p className="text-[10px] text-emerald-600 mt-1">Selected: {selectedName}</p>
      )}
      {!selectedName && (
        <p className="text-[10px] text-gray-400 mt-1">Type to search — matches Prospect accounts (PMC type)</p>
      )}

      {/* Dropdown */}
      {showDropdown && results.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-64 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.account_id}
              type="button"
              onClick={() => handleSelect(r)}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-50 last:border-0 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900 truncate">{r.account_name}</span>
                {r.total_units > 0 && (
                  <span className="text-xs text-gray-500 ml-2 shrink-0">{r.total_units.toLocaleString()} units</span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                {r.state && <span className="text-[10px] text-gray-400">{r.state}</span>}
                {r.segment && <span className="text-[10px] text-gray-400">· {r.segment}</span>}
                {r.opp_stage && <span className="text-[10px] text-gray-400">· {r.opp_stage}</span>}
                {r.pms && <span className="text-[10px] text-gray-400">· {r.pms}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
      {showDropdown && results.length === 0 && !loading && inputValue.trim().length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg px-3 py-3">
          <p className="text-xs text-gray-500">No prospect accounts found</p>
        </div>
      )}
    </div>
  );
}
