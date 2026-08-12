import { useState, useCallback, useEffect } from "react";
import { useApiData } from "@/hooks/useApiData.js";
import { useApi } from "@/hooks/useApi.js";
import { toast } from "sonner";
import { Icon } from "@/components/ui/icon";

type ContentDoc = {
  ID: string;
  NAME: string;
  DISPLAY_NAME: string;
  DESCRIPTION: string | null;
  CONTENT: string | null;
  CATEGORY: string;
  LINKED_SKILL: string | null;
  UPDATED_BY: string | null;
  UPDATED_AT: string | null;
};

function CategoryBadge({ category }: { category: string }) {
  const colorMap: Record<string, { bg: string; color: string }> = {
    playbook: { bg: "#EFF6FF", color: "#1D4ED8" },
    prompt: { bg: "#EEE2FC", color: "#6A3DB8" },
    instruction: { bg: "#F3F4F6", color: "#6B7280" },
  };
  const { bg, color } = colorMap[category] ?? colorMap.instruction;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ backgroundColor: bg, color }}
    >
      {category}
    </span>
  );
}

function EditorPanel({
  doc,
  onSave,
  onCancel,
  saving,
}: {
  doc: ContentDoc;
  onSave: (updates: { display_name: string; description: string; content: string }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [displayName, setDisplayName] = useState(doc.DISPLAY_NAME);
  const [description, setDescription] = useState(doc.DESCRIPTION ?? "");
  const [content, setContent] = useState(doc.CONTENT ?? "");

  return (
    <div className="flex flex-col gap-4 p-6">
      {/* Warning callout */}
      <div
        className="flex items-start gap-2 px-4 py-3 rounded-md"
        style={{
          backgroundColor: "#FFFBEB",
          border: "1px solid #FDE68A",
          color: "#92400E",
          fontSize: 12,
        }}
      >
        <Icon icon="alert-triangle" className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#92400E" }} />
        <span>
          Changes publish immediately and affect all active users. Double-check before saving. (Staging promotion coming in V2.)
        </span>
      </div>

      {/* Display Name */}
      <div className="flex flex-col gap-1">
        <label style={{ fontSize: 12, color: "#6B7280", fontWeight: 500 }}>Display Name</label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full px-3 py-2 rounded-md text-sm"
          style={{ border: "1px solid #E5E7EB", fontSize: 14 }}
        />
      </div>

      {/* Description */}
      <div className="flex flex-col gap-1">
        <label style={{ fontSize: 12, color: "#6B7280", fontWeight: 500 }}>Description</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full px-3 py-2 rounded-md text-sm"
          style={{ border: "1px solid #E5E7EB", fontSize: 14 }}
        />
      </div>

      {/* Content */}
      <div className="flex flex-col gap-1">
        <label style={{ fontSize: 12, color: "#6B7280", fontWeight: 500 }}>Content</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="w-full px-3 py-3 rounded-md resize-y"
          style={{
            border: "1px solid #E5E7EB",
            fontFamily: "'Roboto Mono', ui-monospace, monospace",
            fontSize: 14,
            minHeight: 400,
            lineHeight: 1.5,
          }}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => onSave({ display_name: displayName, description, content })}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: "#6A3DB8" }}
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-gray-100"
          style={{ border: "1px solid #E5E7EB", color: "#6B7280" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function ContentLibraryPage() {
  const [editingDoc, setEditingDoc] = useState<ContentDoc | null>(null);
  const [setupDone, setSetupDone] = useState(false);

  const { data, loading, fetching, isError, error, refetch } = useApiData("GetContentLibrary", {}, { enabled: setupDone });
  const { run: setupLibrary } = useApi("SetupContentLibrary");
  const { run: updateDoc, loading: saving } = useApi("UpdateContentDocument");

  // Auto-setup on mount
  useEffect(() => {
    if (!setupDone) {
      setupLibrary({}).then(() => {
        setSetupDone(true);
      }).catch(() => setSetupDone(true));
    }
  }, [setupDone, setupLibrary]);

  const handleSave = useCallback(
    async (updates: { display_name: string; description: string; content: string }) => {
      if (!editingDoc) return;
      try {
        await updateDoc({
          id: editingDoc.ID,
          display_name: updates.display_name,
          description: updates.description,
          content: updates.content,
        });
        toast.success("Content saved");
        setEditingDoc(null);
        await refetch();
      } catch (err) {
        const message = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : String(err);
        toast.error("Save failed: " + message);
      }
    },
    [editingDoc, updateDoc, refetch]
  );

  if (!setupDone || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-2">
          <div className="animate-spin w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full" />
          <span style={{ fontSize: 14, color: "#6B7280" }}>Loading content library...</span>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col gap-4 h-full overflow-auto p-6">
        <div className="flex flex-col gap-1">
          <h1 style={{ fontSize: 20, fontWeight: 500, color: "#1D1D1D" }}>Content Library</h1>
          <span style={{ fontSize: 13, color: "#6B7280" }}>
            Instructional documents used by Intelligence Skills. Edit to update AI behavior without touching Workflow code.
          </span>
        </div>
        <div
          className="flex flex-col items-center gap-4 py-12"
          style={{ backgroundColor: "white", border: "1px solid #E5E7EB", borderRadius: 8 }}
        >
          <Icon icon="alert-circle" className="w-8 h-8" style={{ color: "#DC2626" }} />
          <span style={{ fontSize: 14, color: "#6B7280", textAlign: "center", maxWidth: 400 }}>
            {String(error ?? "Could not load content library.")}
          </span>
        </div>
      </div>
    );
  }

  const documents = data?.documents ?? [];

  return (
    <div className="flex flex-col gap-5 h-full overflow-auto p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <h1 style={{ fontSize: 20, fontWeight: 500, color: "#1D1D1D" }}>Content Library</h1>
          <span style={{ fontSize: 13, color: "#6B7280" }}>
            Instructional documents used by Intelligence Skills. Edit to update AI behavior without touching Workflow code.
          </span>
        </div>
      </div>

      {/* Table */}
      <div
        className="overflow-hidden"
        style={{ backgroundColor: "white", border: "1px solid #E5E7EB", borderRadius: 8 }}
      >
        {fetching && !loading && (
          <div className="text-xs text-center py-1" style={{ color: "#6B7280", backgroundColor: "#F9FAFB" }}>
            Updating…
          </div>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid #E5E7EB" }}>
              <th className="text-left px-5 py-3 font-medium" style={{ color: "#6B7280", fontSize: 12 }}>Display Name</th>
              <th className="text-left px-5 py-3 font-medium" style={{ color: "#6B7280", fontSize: 12 }}>Category</th>
              <th className="text-left px-5 py-3 font-medium" style={{ color: "#6B7280", fontSize: 12 }}>Linked Skill</th>
              <th className="text-left px-5 py-3 font-medium" style={{ color: "#6B7280", fontSize: 12 }}>Last Updated By</th>
              <th className="text-left px-5 py-3 font-medium" style={{ color: "#6B7280", fontSize: 12 }}>Last Updated</th>
              <th className="text-left px-5 py-3 font-medium" style={{ color: "#6B7280", fontSize: 12 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {documents.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center" style={{ color: "#6B7280" }}>
                  No documents found. Click "Setup Table" to initialize the content library.
                </td>
              </tr>
            ) : (
              documents.map((doc, index) => (
                <tr
                  key={doc.ID}
                  style={{
                    backgroundColor: index % 2 === 1 ? "#FAFAFA" : "white",
                    borderBottom: index < documents.length - 1 ? "1px solid #F3F4F6" : undefined,
                  }}
                >
                  <td className="px-5 py-3 font-medium" style={{ color: "#1D1D1D" }}>{doc.DISPLAY_NAME}</td>
                  <td className="px-5 py-3"><CategoryBadge category={doc.CATEGORY} /></td>
                  <td
                    className="px-5 py-3"
                    style={{ fontFamily: "'Roboto Mono', ui-monospace, monospace", fontSize: 13, color: "#6B7280" }}
                  >
                    {doc.LINKED_SKILL ?? "—"}
                  </td>
                  <td className="px-5 py-3" style={{ color: "#6B7280" }}>{doc.UPDATED_BY ?? "—"}</td>
                  <td className="px-5 py-3" style={{ color: "#6B7280" }}>{doc.UPDATED_AT ?? "—"}</td>
                  <td className="px-5 py-3">
                    <button
                      onClick={() => setEditingDoc(doc)}
                      className="text-sm font-medium px-3 py-1 rounded-md transition-colors hover:bg-[#EEE2FC]"
                      style={{ color: "#6A3DB8" }}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Editor Panel */}
      {editingDoc && (
        <div
          style={{ backgroundColor: "white", border: "1px solid #E5E7EB", borderRadius: 8, padding: 20 }}
        >
          <h2 className="text-sm font-medium mb-4" style={{ color: "#1D1D1D" }}>
            Editing: {editingDoc.DISPLAY_NAME}
          </h2>
          <EditorPanel
            doc={editingDoc}
            onSave={handleSave}
            onCancel={() => setEditingDoc(null)}
            saving={saving}
          />
        </div>
      )}
    </div>
  );
}
