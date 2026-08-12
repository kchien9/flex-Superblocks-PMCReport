import { Icon } from "@/components/ui/icon";

type ImpersonationModalProps = {
  userName: string;
  userRole: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function ImpersonationModal({
  userName,
  userRole,
  onCancel,
  onConfirm,
}: ImpersonationModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />

      {/* Modal */}
      <div
        className="relative flex flex-col gap-4 w-full max-w-md mx-4"
        style={{
          backgroundColor: "white",
          borderRadius: 12,
          padding: 24,
          boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
        }}
      >
        {/* Title */}
        <div className="flex items-center gap-2">
          <Icon icon="eye" className="w-5 h-5" style={{ color: "#6A3DB8" }} />
          <h2 style={{ fontSize: 18, fontWeight: 600, color: "#1D1D1D" }}>
            Start Impersonation Session
          </h2>
        </div>

        {/* Body */}
        <p style={{ fontSize: 14, color: "#4B5563", lineHeight: 1.6 }}>
          You are about to view RevenueOS as{" "}
          <strong>{userName}</strong> · {userRole}. This session will be logged in the Audit Log.
          You must click Exit to end the session.
        </p>

        {/* Warning */}
        <div
          className="flex items-start gap-2 px-3 py-2.5 rounded-md"
          style={{ backgroundColor: "#FFFBEB", border: "1px solid #FDE68A" }}
        >
          <Icon icon="alert-triangle" className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#92400E" }} />
          <span style={{ fontSize: 13, color: "#92400E" }}>
            Impersonation sessions are recorded and visible to all admins.
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-gray-50"
            style={{ border: "1px solid #E5E7EB", color: "#1D1D1D" }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: "#6A3DB8" }}
          >
            Start Session
          </button>
        </div>
      </div>
    </div>
  );
}
