import { useNavigate } from "react-router";
import { Icon } from "@/components/ui/icon";
import type { IconName } from "lucide-react/dynamic";

type ModuleCardProps = {
  icon: IconName;
  name: string;
  description: string;
  path: string;
};

export default function ModuleCard({ icon, name, description, path }: ModuleCardProps) {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate(path)}
      className="flex flex-col items-start gap-3 p-5 rounded-lg border border-gray-200 bg-white hover:border-[#6A3DB8]/40 hover:shadow-md transition-all text-left group"
    >
      <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-[#EEE2FC] group-hover:bg-[#6A3DB8]/15 transition-colors">
        <Icon icon={icon} className="w-5 h-5 text-[#6A3DB8]" />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold text-gray-900">{name}</span>
        <span className="text-xs text-gray-500 leading-relaxed">{description}</span>
      </div>
    </button>
  );
}
