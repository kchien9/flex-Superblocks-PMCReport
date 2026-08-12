import { Icon } from "@/components/ui/icon";
import { useImpersonation, type AuditEntry } from "@/context/ImpersonationContext";

const staticEvents: AuditEntry[] = [
  {
    timestamp: "2026-05-31 14:35",
    actor: "Kumbi Murinda",
    action: "Ended impersonation",
    targetUser: "Lily Tran",
    sessionDuration: "13 min",
    details: "Verified module access",
  },
  {
    timestamp: "2026-05-31 14:22",
    actor: "Kumbi Murinda",
    action: "Started impersonation",
    targetUser: "Lily Tran",
    sessionDuration: "—",
    details: "—",
  },
  {
    timestamp: "2026-05-29 09:31",
    actor: "Kumbi Murinda",
    action: "Ended impersonation",
    targetUser: "Dan Reeves",
    sessionDuration: "17 min",
    details: "Troubleshooting dashboard",
  },
  {
    timestamp: "2026-05-29 09:14",
    actor: "Kumbi Murinda",
    action: "Started impersonation",
    targetUser: "Dan Reeves",
    sessionDuration: "—",
    details: "—",
  },
  {
    timestamp: "2026-05-28 16:05",
    actor: "Kumbi Murinda",
    action: "Started impersonation",
    targetUser: "Brandon Choi",
    sessionDuration: "—",
    details: "—",
  },
];

function ActionBadge({ action }: { action: AuditEntry["action"] }) {
  const isStarted = action === "Started impersonation";
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
      style={{
        backgroundColor: isStarted ? "#FEF3C7" : "#D1FAE5",
        color: isStarted ? "#D97706" : "#059669",
      }}
    >
      {action}
    </span>
  );
}

export default function AuditLogPage() {
  const { auditEntries } = useImpersonation();

  // Merge dynamic entries (newest first) with static mock data
  const allEvents = [...auditEntries, ...staticEvents];

  return (
    <div className="flex flex-col gap-5 h-full overflow-auto p-6">
      {/* Title */}
      <h1 style={{ fontSize: 20, fontWeight: 500, color: "#1D1D1D" }}>
        Audit Log
      </h1>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <Icon
            icon="calendar"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400"
          />
          <input
            type="text"
            placeholder="Date range"
            className="pl-8 pr-3 py-1.5 text-xs rounded-md outline-none focus:ring-2 focus:ring-[#6A3DB8]/30"
            style={{ border: "1px solid #E5E7EB", width: 140 }}
            readOnly
            defaultValue="May 2026"
          />
        </div>
        <select
          className="px-3 py-1.5 text-xs rounded-md outline-none focus:ring-2 focus:ring-[#6A3DB8]/30 appearance-none pr-7 bg-white"
          style={{ border: "1px solid #E5E7EB" }}
          defaultValue="all"
        >
          <option value="all">All Actors</option>
          <option value="kumbi">Kumbi Murinda</option>
        </select>
        <select
          className="px-3 py-1.5 text-xs rounded-md outline-none focus:ring-2 focus:ring-[#6A3DB8]/30 appearance-none pr-7 bg-white"
          style={{ border: "1px solid #E5E7EB" }}
          defaultValue="all"
        >
          <option value="all">All Actions</option>
          <option value="started">Started impersonation</option>
          <option value="ended">Ended impersonation</option>
        </select>
      </div>

      {/* Table */}
      <div
        className="overflow-hidden"
        style={{
          backgroundColor: "white",
          border: "1px solid #E5E7EB",
          borderRadius: 8,
        }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid #E5E7EB" }}>
              <th className="text-left px-5 py-3 font-medium" style={{ color: "#6B7280", fontSize: 12 }}>
                Timestamp
              </th>
              <th className="text-left px-5 py-3 font-medium" style={{ color: "#6B7280", fontSize: 12 }}>
                Actor
              </th>
              <th className="text-left px-5 py-3 font-medium" style={{ color: "#6B7280", fontSize: 12 }}>
                Action
              </th>
              <th className="text-left px-5 py-3 font-medium" style={{ color: "#6B7280", fontSize: 12 }}>
                Target User
              </th>
              <th className="text-left px-5 py-3 font-medium" style={{ color: "#6B7280", fontSize: 12 }}>
                Session Duration
              </th>
              <th className="text-left px-5 py-3 font-medium" style={{ color: "#6B7280", fontSize: 12 }}>
                Details
              </th>
            </tr>
          </thead>
          <tbody>
            {allEvents.map((event, index) => (
              <tr
                key={`${event.timestamp}-${event.action}-${event.targetUser}-${index}`}
                style={{
                  backgroundColor: index % 2 === 1 ? "#FAFAFA" : "white",
                  borderBottom: index < allEvents.length - 1 ? "1px solid #F3F4F6" : undefined,
                }}
              >
                <td className="px-5 py-3 whitespace-nowrap" style={{ color: "#6B7280", fontSize: 13 }}>
                  {event.timestamp}
                </td>
                <td className="px-5 py-3" style={{ color: "#1D1D1D" }}>
                  {event.actor}
                </td>
                <td className="px-5 py-3">
                  <ActionBadge action={event.action} />
                </td>
                <td className="px-5 py-3" style={{ color: "#1D1D1D" }}>
                  {event.targetUser}
                </td>
                <td className="px-5 py-3" style={{ color: "#6B7280" }}>
                  {event.sessionDuration}
                </td>
                <td className="px-5 py-3" style={{ color: "#6B7280", fontSize: 13 }}>
                  {event.details}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
