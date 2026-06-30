import type { ReactNode } from 'react'

type ToolPlaceholderProps = {
  eyebrow: string
  title: string
  description: string
  actionLabel: string
  children: ReactNode
  onAction: () => void
}

export function ToolPlaceholder({
  eyebrow,
  title,
  description,
  actionLabel,
  children,
  onAction,
}: ToolPlaceholderProps) {
  return (
    <section className="tool-layout">
      <div className="tool-copy">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
        <button className="button primary" type="button" onClick={onAction}>
          {actionLabel}
        </button>
      </div>
      <div className="tool-surface">{children}</div>
    </section>
  )
}
