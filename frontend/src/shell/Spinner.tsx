// Circular loading indicator. Plain custom CSS (see `.mwl-spinner` in
// styles.css) rather than Tailwind utilities: the classic "ring with one
// transparent side" spinner needs a per-side border *color* utility
// (`border-t-transparent`) plus color-opacity slash syntax (`border-white/40`),
// neither of which exist in tailwindcss@2.2.19 (confirmed against the actual
// build — both are v3+ features). Used wherever content is (re)loading in
// place: switching the member/year selector, and saving a worklog entry.
// Respects prefers-reduced-motion via styles.css's existing reduced-motion block.
interface SpinnerProps {
  size?: 'sm' | 'md'
  tone?: 'default' | 'on-dark'
  className?: string
}

export function Spinner({ size = 'md', tone = 'default', className = '' }: SpinnerProps) {
  const sizeClass = size === 'sm' ? 'mwl-spinner--sm' : ''
  const toneClass = tone === 'on-dark' ? 'mwl-spinner--on-dark' : ''
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`mwl-spinner ${sizeClass} ${toneClass} ${className}`.trim()}
    />
  )
}
