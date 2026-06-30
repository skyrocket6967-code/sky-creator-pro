import { workflowSteps } from '../data/demoData'
import type { RouteKey } from '../types'

type LandingPageProps = {
  onNavigate: (route: RouteKey) => void
  onAuthAction: (action: 'Create Account' | 'Login') => void
}

export function LandingPage({ onNavigate, onAuthAction }: LandingPageProps) {
  return (
    <>
      <section className="hero-section">
        <div className="hero-scene" aria-hidden="true">
          <div className="scene-toolbar">
            <span />
            <span />
            <span />
            <strong>Campaign: creator desk setup</strong>
          </div>
          <div className="scene-grid">
            <div className="scene-preview">
              <div className="preview-frame" />
              <div className="mini-timeline">
                <span />
                <span />
                <span />
              </div>
            </div>
            <div className="scene-stack">
              <div className="scene-card accent-teal">Video edit 68%</div>
              <div className="scene-card accent-amber">Title ideas 5</div>
              <div className="scene-card accent-rose">Publish checklist</div>
            </div>
          </div>
        </div>

        <div className="hero-content">
          <p className="eyebrow">For small YouTubers and creators</p>
          <h1>Sky Creator Pro</h1>
          <p>
            Plan content, organize creator projects, sketch thumbnails, and keep video edits moving
            from idea to publish.
          </p>
          <div className="hero-actions">
            <button className="button primary" type="button" onClick={() => onAuthAction('Create Account')}>
              Create Account
            </button>
            <button className="button ghost" type="button" onClick={() => onNavigate('dashboard')}>
              View Dashboard
            </button>
          </div>
        </div>
      </section>

      <section className="content-section feature-strip" aria-label="Creator workflow">
        {workflowSteps.map((step, index) => (
          <article key={step}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <h2>{step}</h2>
          </article>
        ))}
      </section>

      <section className="content-section split-section">
        <div>
          <p className="eyebrow">Starter workspace</p>
          <h2>One calm place for the work around the upload.</h2>
        </div>
        <p>
          This first version uses local demo data and placeholder actions, so the frontend can be
          reviewed before Supabase accounts, storage, database records, and paid plans are added.
        </p>
      </section>
    </>
  )
}
