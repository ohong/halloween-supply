import type { ReactNode } from "react";

export function Message({ from, children }: { from: "user" | "assistant"; children: ReactNode }) {
  return (
    <div className={`flex flex-col gap-2 ${from === "user" ? "items-end" : "items-start"}`}>
      {children}
    </div>
  );
}

export function MessageText({ from, children }: { from: "user" | "assistant"; children: ReactNode }) {
  const user = from === "user";
  return (
    <p
      className={`m-0 max-w-[88%] whitespace-pre-wrap rounded-[4px] px-3 py-2 text-[14px] leading-[1.5] tracking-[0.005em] ${
        user ? "bg-[#111] text-white" : "bg-[#EFEEEF] text-[#333]"
      }`}
    >
      {children}
    </p>
  );
}
