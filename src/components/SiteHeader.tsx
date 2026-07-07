import type { RouteKey } from '../types'

type SiteHeaderProps = {
  activeRoute: RouteKey
  onNavigate: (route: RouteKey) => void
  onAuthAction: (action: 'Create Account' | 'Login') => void
}

const navigationItems: Array<{ route: RouteKey; label: string }> = [
  { route: 'dashboard', label: 'Dashboard' },
  { route: 'thumbnail', label: 'Thumbnail Maker' },
  { route: 'video', label: 'Video Editor' },
  { route: 'pricing', label: 'Pricing' },
]

export function SiteHeader({ activeRoute, onNavigate, onAuthAction }: SiteHeaderProps) {
  return (
    <header className="site-header">
      <button className="brand-button" type="button" onClick={() => onNavigate('home')}>
        <span className="brand-mark"></span>
        <span>
          <strong>Sky Creator Pro</strong>
          <small>Creator workflow studio</small>
        </span>
      </button>

      <nav className="primary-nav" aria-label="Primary navigation">
        {navigationItems.map((item) => (
          <button
            className={activeRoute === item.route ? 'nav-link active' : 'nav-link'}
            key={item.route}
            type="button"
            onClick={() => onNavigate(item.route)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="auth-actions">
        <button className="button ghost" type="button" onClick={() => onAuthAction('Login')}>
          Login
        </button>
        <button className="button primary" type="button" onClick={() => onAuthAction('Create Account')}>
          Create Account
        </button>
      </div>
    </header>
  )
}
