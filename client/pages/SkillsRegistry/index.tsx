import { useState, useCallback, useEffect } from "react";
import { useApiData } from "@/hooks/useApiData.js";
import { useApi } from "@/hooks/useApi.js";
import { toast } from "sonner";
import { Icon } from "@/components/ui/icon";
import ModuleChip from "@/components/ModuleChip";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useNavigate } from "react-router";

type Skill = {
  ID: string;
  NAME: string;
  DESCRIPTION: string | null;
  SKILL_TYPE: string;
  DATA_SOURCE: string | null;
  CODE_OR_QUERY: string | null;
  CONTENT_LIBRARY_DOC: string | null;
  MODULES_USING: string | null;
  OWNER: string | null;
  UPDATED_BY: string | null;
  UPDATED_AT: string | null;
};

function TypeBadge({ type }: { type: string }) {
  const isIntelligence = type === "intelligence";
  const bg = isIntelligence ? "#EEE2FC" : "#EFF6FF";
  const color = isIntelligence ? "#6A3DB8" : "#1D4ED8";
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap"
      style={{ backgroundColor: bg, color, fontSize: 12 }}
    >
      {type === "data" ? "Data" : "Intelligence"}
    </span>
  );
}

function DataSourceBadge({ source }: { source: string | null }) {
  if (!source) return null;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap"
      style={{ backgroundColor: "#F3F4F6", color: "#4B5563", fontSize: 11 }}
    >
      {source}
    </span>
  );
}

function SkillRow({
  skill,
  expanded,
  onToggle,
  onSave,
  saving,
}: {
  skill: Skill;
  expanded: boolean;
  onToggle: () => void;
  onSave: (id: string, description: string, modulesUsing: string) => void;
  saving: boolean;
}) {
  const navigate = useNavigate();
  const [editDesc, setEditDesc] = useState(skill.DESCRIPTION || "");
  const [editModules, setEditModules] = useState(skill.MODULES_USING || "");

  useEffect(() => {
    setEditDesc(skill.DESCRIPTION || "");
    setEditModules(skill.MODULES_USING || "");
  }, [skill.DESCRIPTION, skill.MODULES_USING]);

  const modules = skill.MODULES_USING ? skill.MODULES_USING.split(",").map((m) => m.trim()) : [];

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={onToggle}
        style={{ borderBottom: "1px solid #F3F4F6" }}
      >
        <td className="px-5 py-3">
          <div className="flex items-center gap-2">
            {expanded ? (
              <ChevronDown size={14} className="text-gray-400 shrink-0" />
            ) : (
              <ChevronRight size={14} className="text-gray-400 shrink-0" />
            )}
            <span
              className="font-medium"
              style={{ color: "#1D1D1D", fontFamily: "'Roboto Mono', ui-monospace, monospace", fontSize: 13 }}
            >
              {skill.NAME}
            </span>
          </div>
        </td>
        <td className="px-5 py-3" style={{ color: "#6B7280", maxWidth: 320, fontSize: 13 }}>
          <span className="line-clamp-2">{skill.DESCRIPTION}</span>
        </td>
        <td className="px-5 py-3">
          <DataSourceBadge source={skill.DATA_SOURCE} />
        </td>
        <td className="px-5 py-3">
          <div className="flex flex-wrap gap-1">
            {modules.map((m) => (
              <ModuleChip key={m} label={m} />
            ))}
          </div>
        </td>
        <td className="px-5 py-3" style={{ color: "#6B7280", fontSize: 12 }}>
          {skill.UPDATED_BY || "—"}
        </td>
      </tr>
      {expanded && (
        <tr style={{ backgroundColor: "#FAFBFC" }}>
          <td colSpan={5} className="px-8 py-5">
            <div className="flex flex-col gap-4 max-w-3xl">
              {/* Editable Description */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                  Description
                </label>
                <input
                  type="text"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-purple-400 focus:border-purple-400 outline-none"
                />
              </div>

              {/* Editable Modules Using */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                  Modules Using It
                </label>
                <input
                  type="text"
                  value={editModules}
                  onChange={(e) => setEditModules(e.target.value)}
                  placeholder="Comma-separated module names"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-purple-400 focus:border-purple-400 outline-none"
                />
              </div>

              {/* Type-specific panel */}
              {skill.SKILL_TYPE === "data" && skill.CODE_OR_QUERY && (
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                    Query / Code
                  </label>
                  <div
                    className="overflow-auto"
                    style={{
                      backgroundColor: "#F9FAFB",
                      border: "1px solid #E5E7EB",
                      borderRadius: 8,
                      padding: 16,
                      maxHeight: 200,
                      fontFamily: "'Roboto Mono', ui-monospace, monospace",
                      fontSize: 13,
                      color: "#1D1D1D",
                      whiteSpace: "pre-wrap",
                      wordWrap: "break-word",
                    }}
                  >
                    {skill.CODE_OR_QUERY}
                  </div>
                  <span className="text-xs italic" style={{ color: "#6B7280" }}>
                    For reference only — update the API code to change live behavior.
                  </span>
                </div>
              )}

              {skill.SKILL_TYPE === "intelligence" && (
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                    Content Library Document
                  </label>
                  {skill.CONTENT_LIBRARY_DOC ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate("/content-library");
                      }}
                      className="text-sm font-medium hover:underline w-fit"
                      style={{ color: "#6A3DB8" }}
                    >
                      {skill.CONTENT_LIBRARY_DOC === "psm_playbook"
                        ? "PSM Playbook →"
                        : skill.CONTENT_LIBRARY_DOC === "call_prep_playbook"
                          ? "Call Prep Playbook →"
                          : `${skill.CONTENT_LIBRARY_DOC} →`}
                    </button>
                  ) : (
                    <span className="text-sm text-gray-400 italic">No document linked</span>
                  )}
                  <span className="text-xs italic" style={{ color: "#6B7280" }}>
                    Claude prompt is managed in Content Library. Click above to edit.
                  </span>
                </div>
              )}

              {/* Save button */}
              <div className="flex justify-end pt-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSave(skill.ID, editDesc, editModules);
                  }}
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium text-white rounded-md hover:opacity-90 disabled:opacity-60 transition-opacity"
                  style={{ backgroundColor: "#6A3DB8" }}
                >
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function RegisterSkillModal({
  onClose,
  onSave,
  saving,
}: {
  onClose: () => void;
  onSave: (data: { name: string; description: string; skill_type: string; data_source: string; modules_using: string }) => void;
  saving: boolean;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [skillType, setSkillType] = useState("data");
  const [dataSource, setDataSource] = useState("Snowflake Query");
  const [modulesUsing, setModulesUsing] = useState("");

  const handleSubmit = () => {
    if (!name.trim() || !description.trim()) {
      toast.error("Name and description are required");
      return;
    }
    onSave({ name: name.trim(), description: description.trim(), skill_type: skillType, data_source: dataSource, modules_using: modulesUsing.trim() });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative bg-white rounded-lg shadow-xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900">Register New Skill</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-700">Skill Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. getAccountMetrics"
              className="px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-purple-400 focus:border-purple-400 outline-none"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-700">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this skill do?"
              className="px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-purple-400 focus:border-purple-400 outline-none"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-700">Type</label>
            <select
              value={skillType}
              onChange={(e) => setSkillType(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-purple-400 focus:border-purple-400 outline-none bg-white"
            >
              <option value="data">Data</option>
              <option value="intelligence">Intelligence</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-700">Data Source</label>
            <select
              value={dataSource}
              onChange={(e) => setDataSource(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-purple-400 focus:border-purple-400 outline-none bg-white"
            >
              <option value="Snowflake Query">Snowflake Query</option>
              <option value="Salesforce Query">Salesforce Query</option>
              <option value="Database Read">Database Read</option>
              <option value="Claude Prompt">Claude Prompt</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-700">Modules Using It</label>
            <input
              type="text"
              value={modulesUsing}
              onChange={(e) => setModulesUsing(e.target.value)}
              placeholder="Comma-separated module names"
              className="px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-purple-400 focus:border-purple-400 outline-none"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2 text-sm text-white rounded-md hover:opacity-90 disabled:opacity-60"
            style={{ backgroundColor: "#6A3DB8" }}
          >
            {saving ? "Saving..." : "Register Skill"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SkillsRegistryPage() {
  const { data, loading, fetching, refetch } = useApiData("GetSkillRegistry", {});
  const { run: runSetup } = useApi("SetupSkillRegistry");
  const { run: runUpdate, loading: updating } = useApi("UpdateSkill");
  const { run: runInsert, loading: inserting } = useApi("InsertSkill");

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showRegister, setShowRegister] = useState(false);
  const [setupDone, setSetupDone] = useState(false);

  // Run setup on first load
  useEffect(() => {
    if (!setupDone) {
      runSetup({}).then(() => {
        setSetupDone(true);
        refetch();
      }).catch(() => setSetupDone(true));
    }
  }, [setupDone, runSetup, refetch]);

  const dataSkills = (data?.skills || []).filter((s) => s.SKILL_TYPE === "data");
  const intelligenceSkills = (data?.skills || []).filter((s) => s.SKILL_TYPE === "intelligence");

  const handleSave = useCallback(
    async (id: string, description: string, modulesUsing: string) => {
      try {
        await runUpdate({
          id,
          description,
          modules_using: modulesUsing,
          updated_by: "kumbi.murinda@getflex.com",
        });
        toast.success("Skill updated");
        await refetch();
      } catch (err) {
        const message = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : String(err);
        toast.error("Error updating skill: " + message);
      }
    },
    [runUpdate, refetch]
  );

  const handleRegister = useCallback(
    async (formData: { name: string; description: string; skill_type: string; data_source: string; modules_using: string }) => {
      try {
        await runInsert({
          id: formData.name,
          name: formData.name,
          description: formData.description,
          skill_type: formData.skill_type,
          data_source: formData.data_source,
          modules_using: formData.modules_using,
          owner: "kumbi.murinda@getflex.com",
        });
        toast.success("Skill registered");
        setShowRegister(false);
        await refetch();
      } catch (err) {
        const message = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : String(err);
        toast.error("Error registering skill: " + message);
      }
    },
    [runInsert, refetch]
  );

  return (
    <div className="flex flex-col gap-5 h-full overflow-auto p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <h1 style={{ fontSize: 20, fontWeight: 500, color: "#1D1D1D" }}>
            Skills Registry
          </h1>
          <span style={{ fontSize: 13, color: "#6B7280", maxWidth: 600 }}>
            Shared workflows and prompt templates used across RevenueOS modules. Extract logic here when two or more modules share the same pattern.
          </span>
        </div>
        <button
          onClick={() => setShowRegister(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-medium transition-opacity hover:opacity-90 flex-shrink-0"
          style={{ backgroundColor: "#6A3DB8", borderRadius: 8 }}
        >
          <Icon icon="plus" className="w-4 h-4" />
          Register Skill
        </button>
      </div>

      {/* Callout */}
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
          Skills are extracted when two or more modules share the same logic. Do not pre-register skills speculatively — run <code className="font-mono">/revenue-os-audit</code> to identify extraction candidates.
        </span>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full" />
        </div>
      )}

      {!loading && (
        <>
          {fetching && (
            <div className="text-xs text-gray-500 text-center">Updating…</div>
          )}

          {/* Section 1 — Data Skills */}
          <div className="flex flex-col gap-3">
            <span style={{ fontSize: 11, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500 }}>
              Data Skills ({dataSkills.length})
            </span>
            <SkillsTable
              skills={dataSkills}
              expandedId={expandedId}
              onToggle={(id) => setExpandedId(expandedId === id ? null : id)}
              onSave={handleSave}
              saving={updating}
            />
          </div>

          {/* Section 2 — Intelligence Skills */}
          <div className="flex flex-col gap-3">
            <span style={{ fontSize: 11, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500 }}>
              Intelligence Skills ({intelligenceSkills.length})
            </span>
            <SkillsTable
              skills={intelligenceSkills}
              expandedId={expandedId}
              onToggle={(id) => setExpandedId(expandedId === id ? null : id)}
              onSave={handleSave}
              saving={updating}
            />
          </div>
        </>
      )}

      {showRegister && (
        <RegisterSkillModal
          onClose={() => setShowRegister(false)}
          onSave={handleRegister}
          saving={inserting}
        />
      )}
    </div>
  );
}

function SkillsTable({
  skills,
  expandedId,
  onToggle,
  onSave,
  saving,
}: {
  skills: Skill[];
  expandedId: string | null;
  onToggle: (id: string) => void;
  onSave: (id: string, description: string, modulesUsing: string) => void;
  saving: boolean;
}) {
  if (skills.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg px-5 py-6 text-center text-sm text-gray-400">
        No skills registered in this category.
      </div>
    );
  }

  return (
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
              Skill Name
            </th>
            <th className="text-left px-5 py-3 font-medium" style={{ color: "#6B7280", fontSize: 12 }}>
              Description
            </th>
            <th className="text-left px-5 py-3 font-medium" style={{ color: "#6B7280", fontSize: 12 }}>
              Source
            </th>
            <th className="text-left px-5 py-3 font-medium" style={{ color: "#6B7280", fontSize: 12 }}>
              Modules Using It
            </th>
            <th className="text-left px-5 py-3 font-medium" style={{ color: "#6B7280", fontSize: 12 }}>
              Last Updated By
            </th>
          </tr>
        </thead>
        <tbody>
          {skills.map((skill) => (
            <SkillRow
              key={skill.ID}
              skill={skill}
              expanded={expandedId === skill.ID}
              onToggle={() => onToggle(skill.ID)}
              onSave={onSave}
              saving={saving}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
