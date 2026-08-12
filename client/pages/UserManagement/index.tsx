import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import ModuleChip from "@/components/ModuleChip";
import ImpersonationModal from "@/components/ImpersonationModal";
import { useImpersonation } from "@/context/ImpersonationContext";

type User = {
  name: string;
  email: string;
  role: string;
  modules: string[];
  lastActive: string;
};

const mockUsers: User[] = [
  {
    name: "Kumbi Murinda",
    email: "kumbi.murinda@getflex.com",
    role: "Admin",
    modules: ["Dashboard", "Pre-Call Prep", "Leaderboard"],
    lastActive: "Today",
  },
  {
    name: "Brandon Choi",
    email: "brandon@getflex.com",
    role: "Senior Manager",
    modules: ["Dashboard", "Leaderboard"],
    lastActive: "Today",
  },
  {
    name: "Lily Tran",
    email: "lily@getflex.com",
    role: "RevOps Lead",
    modules: ["Dashboard"],
    lastActive: "Yesterday",
  },
  {
    name: "Dan Reeves",
    email: "dan@getflex.com",
    role: "RevOps Lead",
    modules: ["Dashboard"],
    lastActive: "May 29",
  },
  {
    name: "Mock SDR",
    email: "sdr@getflex.com",
    role: "SDR",
    modules: ["Dashboard"],
    lastActive: "May 28",
  },
];

export default function UserManagementPage() {
  const [search, setSearch] = useState("");
  const [modalUser, setModalUser] = useState<User | null>(null);
  const { startImpersonation } = useImpersonation();

  const filteredUsers = mockUsers.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  );

  const handleStartSession = () => {
    if (!modalUser) return;
    startImpersonation({ name: modalUser.name, role: modalUser.role });
    setModalUser(null);
  };

  return (
    <div className="flex flex-col gap-5 h-full overflow-auto p-6">
      {/* Title */}
      <h1 style={{ fontSize: 20, fontWeight: 500, color: "#1D1D1D" }}>
        User Management
      </h1>

      {/* Search + Invite */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Icon
            icon="search"
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
          />
          <input
            type="text"
            placeholder="Search users..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-md outline-none focus:ring-2 focus:ring-[#6A3DB8]/30"
            style={{ border: "1px solid #E5E7EB" }}
          />
        </div>
        <button
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-medium transition-opacity hover:opacity-90"
          style={{ backgroundColor: "#6A3DB8", borderRadius: 8 }}
        >
          <Icon icon="plus" className="w-4 h-4" />
          Invite User
        </button>
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
                Name
              </th>
              <th className="text-left px-5 py-3 font-medium" style={{ color: "#6B7280", fontSize: 12 }}>
                Email
              </th>
              <th className="text-left px-5 py-3 font-medium" style={{ color: "#6B7280", fontSize: 12 }}>
                Role
              </th>
              <th className="text-left px-5 py-3 font-medium" style={{ color: "#6B7280", fontSize: 12 }}>
                Module Access
              </th>
              <th className="text-left px-5 py-3 font-medium" style={{ color: "#6B7280", fontSize: 12 }}>
                Last Active
              </th>
              <th className="text-left px-5 py-3 font-medium" style={{ color: "#6B7280", fontSize: 12 }}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((user, index) => (
              <tr
                key={user.email}
                style={{
                  backgroundColor: index % 2 === 1 ? "#FAFAFA" : "white",
                  borderBottom: index < filteredUsers.length - 1 ? "1px solid #F3F4F6" : undefined,
                }}
              >
                <td className="px-5 py-3 font-medium" style={{ color: "#1D1D1D" }}>
                  {user.name}
                </td>
                <td className="px-5 py-3" style={{ color: "#6B7280" }}>
                  {user.email}
                </td>
                <td className="px-5 py-3" style={{ color: "#1D1D1D" }}>
                  {user.role}
                </td>
                <td className="px-5 py-3">
                  <div className="flex flex-wrap gap-1">
                    {user.modules.map((m) => (
                      <ModuleChip key={m} label={m} />
                    ))}
                  </div>
                </td>
                <td className="px-5 py-3" style={{ color: "#6B7280" }}>
                  {user.lastActive}
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <button className="text-sm font-medium hover:underline" style={{ color: "#6A3DB8" }}>
                      Edit
                    </button>
                    <button className="text-sm font-medium hover:underline" style={{ color: "#DC2626" }}>
                      Remove
                    </button>
                    {user.role !== "Admin" && (
                      <button
                        onClick={() => setModalUser(user)}
                        className="px-2 py-1 rounded text-xs font-medium transition-colors hover:bg-[#6A3DB8]/5"
                        style={{ color: "#6A3DB8", border: "1px solid #6A3DB8", fontSize: 12 }}
                      >
                        View as
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Impersonation confirmation modal */}
      {modalUser && (
        <ImpersonationModal
          userName={modalUser.name}
          userRole={modalUser.role}
          onCancel={() => setModalUser(null)}
          onConfirm={handleStartSession}
        />
      )}
    </div>
  );
}
