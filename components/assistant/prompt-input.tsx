"use client";

import { useState } from "react";

export function PromptInput({
  onSubmit,
  disabled,
  busy,
  onStop,
  placeholder = "Ask about a piece, or tell me your sizes",
}: {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  busy?: boolean;
  onStop?: () => void;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  return (
    <form
      className="flex gap-2 border-t border-[#CCC] p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const text = value.trim();
        if (!text || disabled || busy) return;
        onSubmit(text);
        setValue("");
      }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label="Message the shopping assistant"
        disabled={disabled}
        className="min-h-[44px] min-w-0 flex-1 rounded-[4px] border border-[#CCC] bg-white px-3 text-[16px] text-[#333] outline-none transition-colors duration-150 ease-in-out placeholder:text-[#999] focus:border-[#333] disabled:bg-[#EFEEEF]"
      />
      {busy ? (
        <button
          type="button"
          onClick={onStop}
          className="min-h-[44px] rounded-[4px] border border-[#CCC] bg-white px-4 text-[14px] text-[#333] transition-colors duration-150 ease-in-out hover:border-[#333]"
        >
          Stop
        </button>
      ) : (
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className="min-h-[44px] rounded-[4px] bg-[#111] px-4 text-[14px] text-white transition-colors duration-150 ease-in-out hover:bg-[#333] disabled:bg-[#CCC]"
        >
          Send
        </button>
      )}
    </form>
  );
}
