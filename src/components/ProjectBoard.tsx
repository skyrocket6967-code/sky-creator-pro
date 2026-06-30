import type { CreatorProject } from '../types'

type ProjectBoardProps = {
  projects: CreatorProject[]
}

export function ProjectBoard({ projects }: ProjectBoardProps) {
  return (
    <section className="panel project-board" aria-labelledby="project-area-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Project area</p>
          <h2 id="project-area-title">Creator projects</h2>
        </div>
        <button className="button secondary" type="button">
          New Project
        </button>
      </div>

      <div className="project-list">
        {projects.map((project) => (
          <article className="project-row" key={project.id}>
            <div className="project-main">
              <span className={`status-pill ${project.status.toLowerCase().replaceAll(' ', '-')}`}>
                {project.status}
              </span>
              <h3>{project.title}</h3>
              <p>{project.nextAction}</p>
            </div>
            <div className="project-meta">
              <span>{project.platform}</span>
              <span>{project.dueDate}</span>
            </div>
            <div className="progress-track" aria-label={`${project.progress}% complete`}>
              <span style={{ width: `${project.progress}%` }} />
            </div>
            <div className="asset-states">
              <small>{project.thumbnailState}</small>
              <small>{project.videoState}</small>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
