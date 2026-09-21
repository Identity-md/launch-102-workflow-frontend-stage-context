import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function Panel({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="panel">
      <header className="panel__head">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p className="panel__subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="panel__actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="field">
      <dt>{label}</dt>
      <dd>
        {children}
        {hint ? <span className="field__hint">{hint}</span> : null}
      </dd>
    </div>
  )
}

export function Fields({ children }: { children: ReactNode }) {
  return <dl className="fields">{children}</dl>
}

export function Mono({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className="mono" title={title}>
      {children}
    </span>
  )
}

export function ExternalLink({ href, children }: { href: string | undefined; children: ReactNode }) {
  if (!href) return <>{children}</>
  return (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
      <span aria-hidden="true"> ↗</span>
    </a>
  )
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost'
  loading?: boolean
}

export function Button({ variant = 'primary', loading = false, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`button button--${variant}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  )
}

export type NoticeTone = 'info' | 'warn' | 'error' | 'success'

export function Notice({ tone = 'info', title, children }: { tone?: NoticeTone; title?: string; children: ReactNode }) {
  return (
    <div className={`notice notice--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {title ? <strong>{title}</strong> : null}
      <div>{children}</div>
    </div>
  )
}

export function Badge({ tone = 'info', children }: { tone?: NoticeTone; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>
}
