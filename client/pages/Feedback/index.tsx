import { useState, useMemo } from "react";
import { useApiData } from "@/hooks/useApiData.js";
import { MessageSquare, Search } from "lucide-react";

export default function FeedbackPage() {
  const { data, loading, fetching, isError, error } = useApiData("GetFeedback", {});
  const [searchQuery, setSearchQuery] = useState("");
  const [pageFilter, setPageFilter] = useState<string>("all");

  // Extract unique page names for filter dropdown
  const pages = useMemo(() => {
    if (!data?.feedback) return [];
    const unique = [...new Set(data.feedback.map((f) => f.page))];
    return unique.sort();
  }, [data]);

  // Filter feedback
  const filtered = useMemo(() => {
    if (!data?.feedback) return [];
    return data.feedback.filter((f) => {
      const matchesSearch =
        !searchQuery ||
        f.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
        f.user_email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (f.user_name && f.user_name.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesPage = pageFilter === "all" || f.page === pageFilter;
      return matchesSearch && matchesPage;
    });
  }, [data, searchQuery, pageFilter]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-gray-200 rounded" />
          <div className="h-10 w-full bg-gray-200 rounded" />
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-16 w-full bg-gray-200 rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    const errorMessage =
      error && typeof error === "object" && "message" in error
        ? String((error as { message: unknown }).message)
        : typeof error === "string"
          ? error
          : "An unexpected error occurred. The FEEDBACK table may not exist yet — run the SetupFeedbackTable API first.";

    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm font-medium text-red-800 mb-1">Failed to load feedback</p>
          <p className="text-xs text-red-700">{errorMessage}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-lg bg-[#EEE2FC] flex items-center justify-center">
          <MessageSquare size={18} className="text-[#6A3DB8]" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-gray-900">User Feedback</h1>
          <p className="text-sm text-gray-500">
            {data?.feedback.length || 0} total submissions
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search feedback..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#6A3DB8]/30 focus:border-[#6A3DB8]"
          />
        </div>
        <select
          value={pageFilter}
          onChange={(e) => setPageFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#6A3DB8]/30 focus:border-[#6A3DB8]"
        >
          <option value="all">All pages</option>
          {pages.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        {fetching && (
          <span className="text-xs text-gray-400">Updating…</span>
        )}
      </div>

      {/* Table */}
      <div className={`bg-white rounded-lg border border-gray-200 overflow-hidden ${fetching ? "opacity-70" : ""}`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-600">User</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Page</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Message</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 w-36">Date</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                  {data?.feedback.length === 0 ? "No feedback yet" : "No results match your filters"}
                </td>
              </tr>
            ) : (
              filtered.map((f) => (
                <tr key={f.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 text-xs">
                      {f.user_name || f.user_email}
                    </div>
                    {f.user_name && (
                      <div className="text-xs text-gray-400">{f.user_email}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-[#EEE2FC] text-[#6A3DB8]">
                      {f.page}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700 max-w-md">
                    <p className="line-clamp-2">{f.message}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                    {formatDate(f.timestamp)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatDate(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
      " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch {
    return ts;
  }
}
