export function Arrow({ className = "" }: { className?: string }) {
  return <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function Heart({ filled = false }: { filled?: boolean }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} aria-hidden="true"><path d="m12 20-8-7.5C-1 7 6 1 12 7c6-6 13 0 8 5.5L12 20Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>;
}

export function Close() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
}

export function Chevron({ dir = "right" }: { dir?: "left" | "right" | "down" | "up" }) {
  const d = { left: "m15 5-7 7 7 7", right: "m9 5 7 7-7 7", down: "m5 9 7 7 7-7", up: "m5 15 7-7 7 7" }[dir];
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={d} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function Pin() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><circle cx="12" cy="10" r="2.2" fill="currentColor" /></svg>;
}
