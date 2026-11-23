/**
 * The EmberWatch mark: a camera's focus frame locked onto an ember. It is what
 * the product does: the tower cameras frame the hills and lock onto the first
 * sign of fire, the same red box the model draws around smoke.
 */
export function LogoMark({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--foreground)" />
      <path d="M7 11.5V7h4.5M20.5 7H25v4.5M25 20.5V25h-4.5M11.5 25H7v-4.5" stroke="var(--background)" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 9.6 C18.9 12 19.9 14.3 19.3 16.5 C18.8 18.5 17.5 19.6 16 19.6 C14.5 19.6 13.2 18.5 12.7 16.5 C12.4 15 13.1 13.4 14.2 12.7 C14.2 14.3 15 15.1 15.7 15.1 C16.3 13.5 16.4 11.6 16 9.6 Z" fill="var(--fire)" />
    </svg>
  );
}
