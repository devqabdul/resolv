// Resolv mark: an R whose leg resolves into a check. The R uses currentColor (navy in light,
// light in dark via the parent's text colour); the check is always the cyan accent.
export default function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden className={className}>
      <path d="M8 26V7h7.5a5.5 5.5 0 0 1 0 11H8" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 18l4.5 7L27.5 11" stroke="#00BAF2" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
