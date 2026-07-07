import { ToolPlaceholder } from '../components/ToolPlaceholder'
import { timelineClips } from '../data/demoData'

type VideoEditorPageProps = {
  onPlaceholderAction: (label: string) => void
}

export function VideoEditorPage({ onPlaceholderAction }: VideoEditorPageProps) {
  return (
    <section className="page-shell">
      <ToolPlaceholder
        eyebrow="Video editor"
        title="A clean planning surface for the future editor."
        description="This placeholder keeps the product shape ready for media imports, cuts, captions, timeline editing, and export presets."
        actionLabel="Save Edit Plan"
        onAction={() => onPlaceholderAction('Save Edit Plan')}
      >
        <div className="video-workspace">
          <div className="video-preview">
            <span>16:9 preview</span>
            <strong>Budget desk setup</strong>
          </div>
          <div className="editor-rail">
            <button type="button">Cut</button>
            <button type="button">Text</button>
            <button type="button">Audio</button>
            <button type="button">Export</button>
          </div>
          <div className="timeline">
            {timelineClips.map((clip) => (
              <span style={{ width: clip.width }} key={clip.label}>
                {clip.label}
              </span>
            ))}
          </div>
        </div>
      </ToolPlaceholder>
    </section>
  )
}
