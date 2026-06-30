import type { MouseEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { installerDownloadUrl } from '../lib/supabase'

type WebsiteRoute = 'home' | 'signup' | 'login' | 'dashboard' | 'download' | 'privacy'

type WindowsDownloadPageProps = {
  user: User | null
  profileName?: string
  onNavigate: (route: WebsiteRoute) => void
  onDownload: () => Promise<boolean>
  onLogout: () => void
  statusMessage?: string
}

export function WindowsDownloadPage({
  user,
  profileName,
  onNavigate,
  onDownload,
  onLogout,
  statusMessage,
}: WindowsDownloadPageProps) {
  const handleDownload = async (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    const canDownload = await onDownload()

    if (canDownload) {
      window.location.href = installerDownloadUrl
    }
  }

  return (
    <main className="download-page">
      <WebsiteHeader user={user} profileName={profileName} onNavigate={onNavigate} onLogout={onLogout} />
      <section className="download-hero">
        <div className="download-hero-art" aria-hidden="true">
          <div className="download-window">
            <div className="scene-toolbar">
              <span />
              <span />
              <span />
              <strong>Sky Creator Pro desktop</strong>
            </div>
            <div className="download-window-grid">
              <div className="download-preview">
                <div className="preview-header-row">
                  <span>Video editor</span>
                  <small>1080p / 30 FPS</small>
                </div>
                <strong>Creator setup</strong>
                <div className="preview-player-bar">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="preview-timeline">
                  <i>Hook</i>
                  <i>Setup</i>
                  <i>Demo</i>
                </div>
              </div>
              <div className="download-rail">
                <span>
                  <strong>Project board</strong>
                  <small>3 drafts ready</small>
                </span>
                <span>
                  <strong>Thumbnail maker</strong>
                  <small>Bold text layouts</small>
                </span>
                <span>
                  <strong>Cloud project files</strong>
                  <small>Save edits for later</small>
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="download-copy">
          <p className="eyebrow">Sky Creator Pro for Windows</p>
          <h1>Sky Creator Pro for Windows.</h1>
          <p>
            A desktop creator workspace for small YouTubers to plan videos, draft thumbnails,
            organize projects, and prepare exports.
          </p>
          <div className="download-actions">
            <a className="button primary" href={installerDownloadUrl} onClick={handleDownload}>
              Download Sky Creator Pro for Windows
            </a>
            {!user && (
              <button className="button ghost" type="button" onClick={() => onNavigate('signup')}>
                Create Account
              </button>
            )}
            <span>Mobile apps and cloud accounts are coming later.</span>
          </div>
          <div className="download-stat-strip" aria-label="Sky Creator Pro highlights">
            <span>
              <strong>Local editor</strong>
              <small>Timeline, cuts, text, export</small>
            </span>
            <span>
              <strong>Free core</strong>
              <small>No watermark lock-in</small>
            </span>
            <span>
              <strong>Windows EXE</strong>
              <small>Desktop creator workspace</small>
            </span>
          </div>
          {statusMessage && <p className="config-note">{statusMessage}</p>}
        </div>
      </section>

      <section className="download-details" aria-label="Sky Creator Pro features">
        <article>
          <h2>Video editor</h2>
          <p>Import media, preview your edit, organize a timeline, and plan exports with placeholder tools.</p>
        </article>
        <article>
          <h2>Thumbnail maker</h2>
          <p>Sketch thumbnail layouts with canvas, text, image, and export controls ready for later upgrades.</p>
        </article>
        <article>
          <h2>Creator project dashboard</h2>
          <p>Track recent projects, draft videos, thumbnails, and export tasks from one desktop app.</p>
        </article>
        <article>
          <h2>Free version</h2>
          <p>Start with a local demo workspace and no required cloud account.</p>
        </article>
        <article>
          <h2>Pro version coming later</h2>
          <p>Cloud accounts, storage, sync, and paid plans will be connected after this desktop version.</p>
        </article>
      </section>
    </main>
  )
}

export function WebsiteHeader({
  user,
  profileName,
  onNavigate,
  onLogout,
}: Omit<WindowsDownloadPageProps, 'onDownload' | 'statusMessage'>) {
  return (
    <header className="website-header">
      <button className="brand-button" type="button" onClick={() => onNavigate('home')}>
        <span className="brand-mark">SCP</span>
        <span>
          <strong>Sky Creator Pro</strong>
          <small>Creator workflow desktop app</small>
        </span>
      </button>

      <nav className="website-nav" aria-label="Website navigation">
        <button type="button" onClick={() => onNavigate('download')}>
          Download
        </button>
        {user ? (
          <>
            <button type="button" onClick={() => onNavigate('dashboard')}>
              Dashboard
            </button>
            <span>{profileName || user.email}</span>
            <button className="button ghost" type="button" onClick={onLogout}>
              Logout
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => onNavigate('login')}>
              Login
            </button>
            <button className="button primary" type="button" onClick={() => onNavigate('signup')}>
              Create Account
            </button>
          </>
        )}
      </nav>
    </header>
  )
}
