export function Arrow({ className = "" }: { className?: string }) {
  return <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function Heart({ filled = false }: { filled?: boolean }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} aria-hidden="true"><path d="m12 20-8-7.5C-1 7 6 1 12 7c6-6 13 0 8 5.5L12 20Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>;
}
