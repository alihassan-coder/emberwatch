/** The EmberWatch mark: an ember rising from a mountain ridge, as seen from a lookout tower. */
export function LogoMark({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--foreground)" />
      <path d="M3 25 L11.5 14.5 L15.5 19 L20.5 12.5 L29 25 Z" fill="var(--background)" />
      <path
        d="M20.5 3.5 C23.6 6.6 24.2 9 23 10.9 C22.2 12.1 20.3 12.3 19.4 11.3 C18.3 10.1 18.8 8.4 19.9 7.3 C19.8 8.7 20.6 9.3 21.4 8.9 C22.4 8.3 22.1 6.2 20.5 3.5 Z"
        fill="var(--fire)"
      />
    </svg>
  );
}
