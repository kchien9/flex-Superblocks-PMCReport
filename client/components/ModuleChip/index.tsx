type ModuleChipProps = {
  label: string;
};

export default function ModuleChip({ label }: ModuleChipProps) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full"
      style={{
        backgroundColor: "#EEE2FC",
        color: "#6A3DB8",
        fontSize: 12,
        fontWeight: 500,
      }}
    >
      {label}
    </span>
  );
}
