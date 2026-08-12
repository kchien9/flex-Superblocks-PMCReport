import { useState, useRef, useEffect, useCallback } from "react";
import { Search, ChevronDown, Download, X, Loader2 } from "lucide-react";

type PSMOption = { name: string; email: string };

type Props = {
  psmOptions: PSMOption[];
  selectedPSMEmails: string[];
  onPSMChange: (emails: string[]) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  supportFilter: string;
  onSupportFilterChange: (v: string) => void;
  supportDataLoading: boolean;
  sortBy: string;
  onSortChange: (s: string) => void;
  onExport: () => void;
};

const SUPPORT_OPTIONS = [
  { value: "all", label: "All Accounts" },
  { value: "has-open", label: "Has Open Tickets" },
  { value: "ticket-spike", label: "Ticket Spike" },
  { value: "resident-issue", label: "Resident Issue Signal" },
  { value: "no-ticket-data", label: "No Ticket Data" },
];

const SORT_OPTIONS = [
  { value: "nar-desc", label: "NAR High→Low" },
  { value: "nar-asc", label: "NAR Low→High" },
  { value: "name-asc", label: "Name A–Z" },
  { value: "units-desc", label: "Units High→Low" },
  { value: "trend-desc", label: "Trend Best→Worst" },
];

export function FilterBar({
  psmOptions,
  selectedPSMEmails,
  onPSMChange,
  searchQuery,
  onSearchChange,
  supportFilter,
  onSupportFilterChange,
  supportDataLoading,
  sortBy,
  onSortChange,
  onExport,
}: Props) {
  const [psmOpen, setPsmOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const psmRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const supportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (psmRef.current && !psmRef.current.contains(e.target as Node)) setPsmOpen(false);
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false);
      if (supportRef.current && !supportRef.current.contains(e.target as Node)) setSupportOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selectedCount = selectedPSMEmails.length;
  const psmLabel =
    selectedCount === 0
      ? "All PSMs"
      : selectedCount === 1
        ? psmOptions.find((p) => p.email === selectedPSMEmails[0])?.name || "1 PSM"
        : `${selectedCount} PSMs`;

  const togglePSM = useCallback(
    (email: string) => {
      if (selectedPSMEmails.includes(email)) {
        onPSMChange(selectedPSMEmails.filter((e) => e !== email));
      } else {
        onPSMChange([...selectedPSMEmails, email]);
      }
    },
    [selectedPSMEmails, onPSMChange]
  );

  return (
    <div
      className="flex items-center gap-3 px-4 bg-white border-b"
      style={{ height: 44, borderColor: "#E5E7EB" }}
    >
      {/* Left: PSM + Account */}
      <div className="flex items-center gap-4">
        {/* PSM Multi-select */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">PSM:</span>
          <div ref={psmRef} className="relative">
            <button
              onClick={() => setPsmOpen(!psmOpen)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-gray-300 rounded-md hover:border-gray-400 bg-white"
            >
              <span className="max-w-[140px] truncate">{psmLabel}</span>
              <ChevronDown size={12} className="text-gray-400" />
            </button>
            {psmOpen && (
              <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden z-50">
                <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
                  <button
                    onClick={() => onPSMChange(psmOptions.map((p) => p.email))}
                    className="text-[11px] text-purple-600 hover:underline"
                  >
                    Select All
                  </button>
                  <button
                    onClick={() => onPSMChange([])}
                    className="text-[11px] text-purple-600 hover:underline"
                  >
                    Clear All
                  </button>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {psmOptions.map((psm) => (
                    <label
                      key={psm.email}
                      className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedPSMEmails.includes(psm.email)}
                        onChange={() => togglePSM(psm.email)}
                        className="w-3.5 h-3.5 rounded border-gray-300 accent-purple-600"
                      />
                      <span className="text-xs text-gray-700 truncate">{psm.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Account search */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Account:</span>
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search accounts..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-6 pr-6 py-1.5 w-44 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-purple-400 focus:border-purple-400 outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
        {/* Support filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Support:</span>
          <div ref={supportRef} className="relative">
            <button
              disabled={supportDataLoading}
              onClick={() => setSupportOpen(!supportOpen)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-gray-300 rounded-md hover:border-gray-400 bg-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {supportDataLoading && <Loader2 size={10} className="animate-spin text-gray-400" />}
              <span className="max-w-[140px] truncate">
                {SUPPORT_OPTIONS.find((s) => s.value === supportFilter)?.label || "All Accounts"}
              </span>
              {supportFilter !== "all" && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 ml-0.5" />}
              <ChevronDown size={12} className="text-gray-400" />
            </button>
            {supportOpen && !supportDataLoading && (
              <div className="absolute top-full left-0 mt-1 w-52 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                {SUPPORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      onSupportFilterChange(opt.value);
                      setSupportOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${
                      supportFilter === opt.value ? "text-purple-700 font-medium bg-purple-50" : "text-gray-700"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1" />

      {/* Right: Sort + Export */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Sort:</span>
          <div ref={sortRef} className="relative">
            <button
              onClick={() => setSortOpen(!sortOpen)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-gray-300 rounded-md hover:border-gray-400 bg-white"
            >
              <span>{SORT_OPTIONS.find((s) => s.value === sortBy)?.label || "NAR High→Low"}</span>
              <ChevronDown size={12} className="text-gray-400" />
            </button>
            {sortOpen && (
              <div className="absolute top-full right-0 mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      onSortChange(opt.value);
                      setSortOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${sortBy === opt.value ? "text-purple-700 font-medium bg-purple-50" : "text-gray-700"}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <button
          onClick={onExport}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-md hover:bg-gray-50 text-gray-700"
        >
          <Download size={12} />
          Export CSV
        </button>
      </div>
    </div>
  );
}
