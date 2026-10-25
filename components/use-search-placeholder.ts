"use client";

import { useEffect, useRef } from "react";

const examples = ["An elegant vampire", "Space cowboy", "A woodland creature", "Sherlock Holmes", "Waldo"];
export const searchPlaceholder = examples[0];

/** Hints never enter the query or trigger a search; keep animation outside gallery renders. */
export function useSearchPlaceholder(enabled: boolean) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const field = input.current;
    if (!field) return;
    field.placeholder = searchPlaceholder;
    if (!enabled) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let index = 0;
    let length = examples[0].length;
    let phase: "hold" | "erase" | "type" = "hold";
    let visible = true;
    let timer: number | undefined;

    function stop() { window.clearTimeout(timer); }
    function canAnimate() {
      return !field!.value && !field!.matches(":focus") && visible && !document.hidden && !reducedMotion.matches;
    }
    function schedule(delay: number) {
      stop();
      if (canAnimate()) timer = window.setTimeout(tick, delay);
    }
    function tick() {
      if (!canAnimate()) return;
      if (phase === "hold") phase = "erase";
      length += phase === "erase" ? -1 : 1;
      field!.placeholder = examples[index].slice(0, length);
      if (length === 0) {
        index = (index + 1) % examples.length;
        phase = "type";
        schedule(300);
      } else if (phase === "type" && length === examples[index].length) {
        phase = "hold";
        schedule(2200);
      } else schedule(phase === "erase" ? 40 : 80);
    }
    function sync() {
      // Pause on a readable, complete example rather than a half-written word.
      length = examples[index].length;
      phase = "hold";
      field!.placeholder = examples[index];
      schedule(2200);
    }

    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    observer.observe(field);
    field.addEventListener("focus", sync);
    field.addEventListener("blur", sync);
    document.addEventListener("visibilitychange", sync);
    reducedMotion.addEventListener("change", sync);
    schedule(2200);
    return () => {
      stop();
      observer.disconnect();
      field.removeEventListener("focus", sync);
      field.removeEventListener("blur", sync);
      document.removeEventListener("visibilitychange", sync);
      reducedMotion.removeEventListener("change", sync);
      field.placeholder = searchPlaceholder;
    };
  }, [input, enabled]);
  return input;
}
