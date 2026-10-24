/** One quiet status line for a tool call (look-ups, size saves, cart adds). */
export function ToolStatus({ label, state }: { label: string; state: "running" | "done" | "error" }) {
  return (
    <div className="flex items-center gap-2 font-mono text-[12px] tracking-[0.02em] text-[#666]" role="status">
      <span
        aria-hidden
        className={`inline-block h-[6px] w-[6px] rounded-full ${
          state === "running" ? "animate-pulse bg-[#999]" : state === "done" ? "bg-[#333]" : "bg-[#CCC]"
        }`}
      />
      {label}
    </div>
  );
}
