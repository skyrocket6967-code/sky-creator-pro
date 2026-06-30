import { MetricCard } from '../components/MetricCard'
import { ProjectBoard } from '../components/ProjectBoard'
import { metrics, projects, workflowSteps } from '../data/demoData'
import type { RouteKey } from '../types'

type DashboardPageProps = {
  onNavigate: (route: RouteKey) => void
}

export function DashboardPage({ onNavigate }: DashboardPageProps) {
  return (
    <section className="page-shell">
      <div className="page-heading">
        <p className="eyebrow">Dashboard</p>
        <h1>Creator command center</h1>
        <p>Track upcoming videos, thumbnails, edits, and publishing tasks from one workspace.</p>
      </div>

      <div className="metric-grid">
        {metrics.map((metric) => (
          <MetricCard metric={metric} key={metric.label} />
        ))}
      </div>

      <div className="dashboard-grid">
        <ProjectBoard projects={projects} />

        <aside className="panel workflow-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Workflow</p>
              <h2>Next upload</h2>
            </div>
          </div>

          <ol className="workflow-list">
            {workflowSteps.map((step, index) => (
              <li key={step}>
                <span>{index + 1}</span>
                <p>{step}</p>
              </li>
            ))}
          </ol>

          <div className="quick-actions">
            <button className="button secondary" type="button" onClick={() => onNavigate('thumbnail')}>
              Open Thumbnail Maker
            </button>
            <button className="button secondary" type="button" onClick={() => onNavigate('video')}>
              Open Video Editor
            </button>
          </div>
        </aside>
      </div>
    </section>
  )
}
