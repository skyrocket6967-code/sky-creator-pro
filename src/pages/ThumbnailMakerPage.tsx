import { ToolPlaceholder } from '../components/ToolPlaceholder'
import { thumbnailStyles } from '../data/demoData'

type ThumbnailMakerPageProps = {
  onPlaceholderAction: (label: string) => void
}

export function ThumbnailMakerPage({ onPlaceholderAction }: ThumbnailMakerPageProps) {
  return (
    <section className="page-shell">
      <ToolPlaceholder
        eyebrow="Thumbnail maker"
        title="Draft thumbnail concepts before the full editor lands."
        description="Use this placeholder page to review the layout for future image uploads, text layers, style presets, and export actions."
        actionLabel="Save Thumbnail Draft"
        onAction={() => onPlaceholderAction('Save Thumbnail Draft')}
      >
        <div className="thumbnail-workspace">
          <div className="thumbnail-preview">
            <div className="thumbnail-badge">NEW</div>
            <h2>Creator setup</h2>
            <p>Under $500</p>
          </div>
          <div className="tool-controls">
            <label>
              Title text
              <input value="Creator setup" readOnly />
            </label>
            <label>
              Accent color
              <select value="teal" onChange={() => undefined}>
                <option value="teal">Teal</option>
              </select>
            </label>
            <div className="chip-group">
              {thumbnailStyles.map((style) => (
                <button className="chip" type="button" key={style}>
                  {style}
                </button>
              ))}
            </div>
          </div>
        </div>
      </ToolPlaceholder>
    </section>
  )
}
