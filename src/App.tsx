import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, MouseEvent, SyntheticEvent } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import type { CreatorProject } from './types'
import './App.css'
import { projects } from './data/demoData'
import {
  installerDownloadUrl,
  installerFileName,
  isInstallerUploaded,
  isSupabaseConfigured,
  supabase,
} from './lib/supabase'
import { PrivacyPolicyPage } from './pages/PrivacyPolicyPage'
import { WebsiteHeader, WindowsDownloadPage } from './pages/WindowsDownloadPage'

type DesktopRoute = 'dashboard' | 'video' | 'thumbnail' | 'projects' | 'export' | 'settings'
type WebsiteRoute = 'home' | 'signup' | 'login' | 'dashboard' | 'download' | 'privacy'

const desktopRouteHashes: Record<DesktopRoute, string> = {
  dashboard: '#/dashboard',
  video: '#/video-editor',
  thumbnail: '#/thumbnail-maker',
  projects: '#/projects',
  export: '#/export',
  settings: '#/settings',
}

const sidebarItems: Array<{ route: DesktopRoute; label: string; marker: string }> = [
  { route: 'dashboard', label: 'Dashboard', marker: '01' },
  { route: 'video', label: 'Video Editor', marker: '02' },
  { route: 'thumbnail', label: 'Thumbnail Maker', marker: '03' },
  { route: 'projects', label: 'Projects', marker: '04' },
  { route: 'export', label: 'Export', marker: '05' },
  { route: 'settings', label: 'Settings', marker: '06' },
]

const dashboardCards = [
  { label: 'Recent Projects', value: '8', detail: '4 updated this week' },
  { label: 'Draft Videos', value: '5', detail: '2 ready for review' },
  { label: 'Thumbnails Created', value: '12', detail: '3 need final text' },
  { label: 'Exports', value: '4', detail: '1 waiting in queue' },
]

type EditorClip = {
  id: number
  label: string
  sourceStart: number
  sourceEnd: number
  timelineStart: number
  duration: number
  speed: number
}

type EditedTimelineSegment = {
  id: number
  label: string
  sourceStart: number
  sourceEnd: number
  timelineStart: number
  timelineEnd: number
  speed: number
}

type ExportResolution = {
  id: string
  label: string
  width: number
  height: number
}

type TextOverlay = {
  id: number
  text: string
  start: number
  end: number
}

type CloudProjectSummary = {
  key: string
  name: string
  size?: number
  uploaded?: string
}

type CloudProjectPayload = {
  id: string | number
  title?: string
  [key: string]: unknown
}

type EditorProjectFile = {
  version: number
  mediaName: string
  duration: number
  playhead: number
  clips: EditorClip[]
  textOverlays: TextOverlay[]
  exportSettings: {
    title: string
    resolutionId: string
    frameRate: number
  }
  savedAt: string
}

const speedOptions = [0.25, 0.5, 1, 1.25, 1.5, 2]
const exportFrameRates = [24, 30, 60]
const exportResolutions: ExportResolution[] = [
  { id: '720p', label: 'HD 720p - 1280x720', width: 1280, height: 720 },
  { id: '1080p', label: 'Full HD 1080p - 1920x1080', width: 1920, height: 1080 },
  { id: 'shorts', label: 'Shorts vertical - 1080x1920', width: 1080, height: 1920 },
]
const megaProStorageKey = 'skyCreatorProMegaProTestActive'

function clipEditedDuration(clip: Pick<EditorClip, 'sourceStart' | 'sourceEnd' | 'speed'>) {
  return Math.max((clip.sourceEnd - clip.sourceStart) / Math.max(clip.speed, 0.25), 0)
}

function normalizeEditorClips(clips: EditorClip[]) {
  let nextTimelineStart = 0

  return clips
    .filter((clip) => clip.sourceEnd - clip.sourceStart > 0.05)
    .map((clip) => {
      const duration = Number(clipEditedDuration(clip).toFixed(3))
      const normalizedClip = {
        ...clip,
        timelineStart: Number(nextTimelineStart.toFixed(3)),
        duration,
      }

      nextTimelineStart += duration
      return normalizedClip
    })
}

function getEditedTimelineSegments(clips: EditorClip[]): EditedTimelineSegment[] {
  // TODO: Wire this into the real export/render pipeline when FFmpeg export is added.
  return normalizeEditorClips(clips).map((clip) => ({
    id: clip.id,
    label: clip.label,
    sourceStart: clip.sourceStart,
    sourceEnd: clip.sourceEnd,
    timelineStart: clip.timelineStart,
    timelineEnd: Number((clip.timelineStart + clip.duration).toFixed(3)),
    speed: clip.speed,
  }))
}

function findClipAtEditedTime(clips: EditorClip[], editedTime: number) {
  if (clips.length === 0) {
    return undefined
  }

  const clip = clips.find((item) => editedTime >= item.timelineStart && editedTime < item.timelineStart + item.duration)

  if (clip) {
    return clip
  }

  const lastClip = clips.at(-1)
  const totalDuration = lastClip ? lastClip.timelineStart + lastClip.duration : 0
  return editedTime >= totalDuration ? lastClip : undefined
}

function mapEditedTimeToSourceTime(clips: EditorClip[], editedTime: number) {
  const clip = findClipAtEditedTime(clips, editedTime)

  if (!clip) {
    return undefined
  }

  const clipOffset = Math.max(0, Math.min(editedTime - clip.timelineStart, clip.duration))
  return {
    clip,
    sourceTime: Number((clip.sourceStart + clipOffset * clip.speed).toFixed(3)),
  }
}

function getSupportedMp4MimeType() {
  if (typeof MediaRecorder === 'undefined') {
    return ''
  }

  return (
    [
      'video/mp4;codecs="avc1.42E01E"',
      'video/mp4;codecs=avc1.42E01E',
      'video/mp4;codecs=h264',
      'video/mp4',
    ].find((mimeType) =>
      MediaRecorder.isTypeSupported(mimeType),
    ) ?? ''
  )
}

function sanitizeExportFileName(title: string) {
  return title
    .trim()
    .replace(/[^a-z0-9-_ ]/gi, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 64) || 'sky-creator-pro-export'
}

function waitForVideoSeek(video: HTMLVideoElement, time: number) {
  const safeTime = Math.max(0, Math.min(time, Number.isFinite(video.duration) ? video.duration : time))

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener('seeked', handleSeeked)
      video.removeEventListener('error', handleError)
      window.clearTimeout(timeout)
    }
    const handleSeeked = () => {
      cleanup()
      resolve()
    }
    const handleError = () => {
      cleanup()
      reject(new Error('Video seek failed during export.'))
    }
    const timeout = window.setTimeout(() => {
      cleanup()
      resolve()
    }, 2200)

    if (Math.abs(video.currentTime - safeTime) < 0.04 && video.readyState >= 2) {
      cleanup()
      resolve()
      return
    }

    video.addEventListener('seeked', handleSeeked, { once: true })
    video.addEventListener('error', handleError, { once: true })
    video.currentTime = safeTime
  })
}

function nextAnimationFrame() {
  return new Promise<number>((resolve) => requestAnimationFrame(resolve))
}

function drawEditedVideoFrame(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  text?: string,
) {
  context.fillStyle = '#050609'
  context.fillRect(0, 0, canvas.width, canvas.height)

  const videoWidth = video.videoWidth || 16
  const videoHeight = video.videoHeight || 9
  const canvasRatio = canvas.width / canvas.height
  const videoRatio = videoWidth / videoHeight
  const drawWidth = videoRatio > canvasRatio ? canvas.width : canvas.height * videoRatio
  const drawHeight = videoRatio > canvasRatio ? canvas.width / videoRatio : canvas.height
  const drawX = (canvas.width - drawWidth) / 2
  const drawY = (canvas.height - drawHeight) / 2

  context.drawImage(video, drawX, drawY, drawWidth, drawHeight)

  if (!text) {
    return
  }

  let fontSize = Math.max(24, Math.round(canvas.width * 0.046))
  const maxTextWidth = canvas.width * 0.78
  context.font = `900 ${fontSize}px Arial, sans-serif`

  while (context.measureText(text).width > maxTextWidth && fontSize > 18) {
    fontSize -= 2
    context.font = `900 ${fontSize}px Arial, sans-serif`
  }

  const textWidth = Math.min(context.measureText(text).width, maxTextWidth)
  const paddingX = Math.round(fontSize * 0.55)
  const paddingY = Math.round(fontSize * 0.32)
  const boxWidth = textWidth + paddingX * 2
  const boxHeight = fontSize + paddingY * 2
  const boxX = (canvas.width - boxWidth) / 2
  const boxY = canvas.height * 0.78 - boxHeight / 2

  context.fillStyle = 'rgba(0, 0, 0, 0.72)'
  context.fillRect(boxX, boxY, boxWidth, boxHeight)
  context.fillStyle = '#ffffff'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.shadowColor = 'rgba(0, 0, 0, 0.55)'
  context.shadowBlur = 12
  context.fillText(text, canvas.width / 2, boxY + boxHeight / 2, maxTextWidth)
  context.shadowBlur = 0
}

function readMegaProTestState() {
  if (typeof window === 'undefined') {
    return false
  }

  return window.localStorage.getItem(megaProStorageKey) === 'true'
}

function isDesktopExperience() {
  if (typeof window === 'undefined') {
    return false
  }

  return Boolean(window.skyCreatorPro?.desktop) || window.location.hash.startsWith('#/')
}

function routeFromHash(hash: string): DesktopRoute {
  const normalizedHash = hash || '#/dashboard'
  const match = Object.entries(desktopRouteHashes).find(([, routeHash]) => routeHash === normalizedHash)
  return (match?.[0] as DesktopRoute | undefined) ?? 'dashboard'
}

function App() {
  const [desktopMode] = useState(isDesktopExperience)

  if (!desktopMode) {
    return <WebsiteApp />
  }

  return <DesktopApp />
}

function WebsiteApp() {
  const [activeRoute, setActiveRoute] = useState<WebsiteRoute>(() => routeFromWebsitePath(window.location.pathname))
  const [session, setSession] = useState<Session | null>(null)
  const [profileName, setProfileName] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const user = session?.user ?? null

  useEffect(() => {
    const handlePopState = () => setActiveRoute(routeFromWebsitePath(window.location.pathname))
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured) {
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!user || !isSupabaseConfigured) {
      setProfileName('')
      return
    }

    supabase
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        setProfileName(data?.display_name || user.email || '')
      })
  }, [user])

  const navigate = (route: WebsiteRoute) => {
    const path = websiteRoutePath(route)
    window.history.pushState({}, '', path)
    setActiveRoute(route)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const logout = async () => {
    if (!isSupabaseConfigured) {
      setStatusMessage('Supabase is not configured yet.')
      return
    }

    await supabase.auth.signOut()
    setStatusMessage('Logged out.')
    navigate('home')
  }

  const trackDownload = async () => {
    const installerReady = await isInstallerUploaded()

    if (!installerReady) {
      setStatusMessage(
        'The Windows installer is not uploaded yet. Upload release/SkyCreatorProSetup.exe to Supabase Storage as downloads/sky-creator-pro-setup.exe.',
      )
      return false
    }

    if (!isSupabaseConfigured) {
      return true
    }

    await supabase.from('downloads').insert({
      user_id: user?.id ?? null,
      file_name: installerFileName,
      platform: 'windows',
      source: user ? 'website_authenticated' : 'website_public',
    })

    return true
  }

  const commonProps = {
    user,
    profileName,
    onNavigate: navigate,
    onDownload: trackDownload,
    onLogout: logout,
  }

  return (
    <div className="website-shell">
      {renderWebsitePage(activeRoute, commonProps, statusMessage, setStatusMessage)}
      <WebsiteFooter onNavigate={navigate} />
    </div>
  )
}

function routeFromWebsitePath(pathname: string): WebsiteRoute {
  switch (pathname) {
    case '/create-account':
      return 'signup'
    case '/login':
      return 'login'
    case '/dashboard':
      return 'dashboard'
    case '/download':
      return 'download'
    case '/privacy':
      return 'privacy'
    default:
      return 'home'
  }
}

function websiteRoutePath(route: WebsiteRoute) {
  switch (route) {
    case 'signup':
      return '/create-account'
    case 'login':
      return '/login'
    case 'dashboard':
      return '/dashboard'
    case 'download':
      return '/download'
    case 'privacy':
      return '/privacy'
    case 'home':
    default:
      return '/'
  }
}

function renderWebsitePage(
  route: WebsiteRoute,
  commonProps: {
    user: User | null
    profileName?: string
    onNavigate: (route: WebsiteRoute) => void
    onDownload: () => Promise<boolean>
    onLogout: () => void
  },
  statusMessage: string,
  setStatusMessage: (message: string) => void,
) {
  switch (route) {
    case 'signup':
      return <AuthPage mode="signup" {...commonProps} statusMessage={statusMessage} setStatusMessage={setStatusMessage} />
    case 'login':
      return <AuthPage mode="login" {...commonProps} statusMessage={statusMessage} setStatusMessage={setStatusMessage} />
    case 'dashboard':
      return <WebDashboard {...commonProps} statusMessage={statusMessage} />
    case 'download':
      return <DownloadOnlyPage {...commonProps} statusMessage={statusMessage} />
    case 'privacy':
      return <PrivacyPolicyPage {...commonProps} />
    case 'home':
    default:
      return <WindowsDownloadPage {...commonProps} />
  }
}

function WebsiteFooter({ onNavigate }: { onNavigate: (route: WebsiteRoute) => void }) {
  return (
    <footer className="site-footer">
      <div>
        <strong>Sky Creator Pro</strong>
        <span>Creator workflow desktop app</span>
      </div>
      <button type="button" onClick={() => onNavigate('privacy')}>
        Privacy Policy
      </button>
    </footer>
  )
}

function AuthPage({
  mode,
  user,
  profileName,
  onNavigate,
  onLogout,
  statusMessage,
  setStatusMessage,
}: {
  mode: 'signup' | 'login'
  user: User | null
  profileName?: string
  onNavigate: (route: WebsiteRoute) => void
  onLogout: () => void
  statusMessage: string
  setStatusMessage: (message: string) => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const title = mode === 'signup' ? 'Create your Sky Creator Pro account' : 'Login to Sky Creator Pro'

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!isSupabaseConfigured) {
      setStatusMessage('Account login is not connected in this build. Add the Supabase publishable key before building the website.')
      return
    }

    setIsSubmitting(true)
    setStatusMessage('')

    const response =
      mode === 'signup'
        ? await supabase.auth.signUp({
            email,
            password,
            options: {
              data: {
                display_name: displayName || email.split('@')[0],
              },
            },
          })
        : await supabase.auth.signInWithPassword({ email, password })

    setIsSubmitting(false)

    if (response.error) {
      setStatusMessage(response.error.message)
      return
    }

    setStatusMessage(mode === 'signup' ? 'Account created. Check your email if confirmation is enabled.' : 'Logged in.')
    onNavigate('dashboard')
  }

  return (
    <main className="download-page">
      <WebsiteHeader user={user} profileName={profileName} onNavigate={onNavigate} onLogout={onLogout} />
      <section className="auth-page">
        <form className="auth-card" onSubmit={submit}>
          <p className="eyebrow">{mode === 'signup' ? 'Create Account' : 'Login'}</p>
          <h1>{title}</h1>
          <p>Use email and password for now. Supabase handles the account session.</p>
          {mode === 'signup' && (
            <label>
              Display name
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Sky Creator" />
            </label>
          )}
          <label>
            Email
            <input value={email} type="email" onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label>
            Password
            <input
              value={password}
              type="password"
              minLength={6}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button className="button primary" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Working...' : mode === 'signup' ? 'Create Account' : 'Login'}
          </button>
          {statusMessage && <span className="form-status">{statusMessage}</span>}
          <button className="link-button" type="button" onClick={() => onNavigate(mode === 'signup' ? 'login' : 'signup')}>
            {mode === 'signup' ? 'Already have an account? Login' : 'Need an account? Create one'}
          </button>
        </form>
      </section>
    </main>
  )
}

function WebDashboard({
  user,
  profileName,
  onNavigate,
  onDownload,
  onLogout,
  statusMessage,
}: {
  user: User | null
  profileName?: string
  onNavigate: (route: WebsiteRoute) => void
  onDownload: () => Promise<boolean>
  onLogout: () => void
  statusMessage: string
}) {
  const cards = useMemo(
    () => [
      { label: 'Account', value: user ? 'Active' : 'Guest', detail: user?.email || 'Create an account to save activity later.' },
      { label: 'Installer', value: 'Windows', detail: 'Public download for now.' },
      { label: 'Storage', value: 'Supabase', detail: 'File hosted in the downloads bucket.' },
    ],
    [user],
  )

  return (
    <main className="download-page">
      <WebsiteHeader user={user} profileName={profileName} onNavigate={onNavigate} onLogout={onLogout} />
      <section className="web-dashboard">
        <div className="page-heading">
          <p className="eyebrow">Dashboard</p>
          <h1>Welcome{profileName ? `, ${profileName}` : ''}.</h1>
          <p>Basic user info and installer download controls are wired to Supabase.</p>
        </div>
        <div className="web-card-grid">
          {cards.map((card) => (
            <article className="desktop-stat-card" key={card.label}>
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              <small>{card.detail}</small>
            </article>
          ))}
        </div>
        <DownloadPanel onDownload={onDownload} />
        {statusMessage && <p className="config-note">{statusMessage}</p>}
      </section>
    </main>
  )
}

function DownloadOnlyPage({
  user,
  profileName,
  onNavigate,
  onDownload,
  onLogout,
  statusMessage,
}: {
  user: User | null
  profileName?: string
  onNavigate: (route: WebsiteRoute) => void
  onDownload: () => Promise<boolean>
  onLogout: () => void
  statusMessage: string
}) {
  return (
    <main className="download-page">
      <WebsiteHeader user={user} profileName={profileName} onNavigate={onNavigate} onLogout={onLogout} />
      <section className="web-dashboard">
        <div className="page-heading">
          <p className="eyebrow">Download</p>
          <h1>Download Sky Creator Pro for Windows.</h1>
          <p>The installer is served from Supabase Storage. Public downloads are enabled for now.</p>
        </div>
        <DownloadPanel onDownload={onDownload} />
        {statusMessage && <p className="config-note">{statusMessage}</p>}
      </section>
    </main>
  )
}

function DownloadPanel({ onDownload }: { onDownload: () => Promise<boolean> }) {
  const handleDownload = async (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    const canDownload = await onDownload()

    if (canDownload) {
      window.location.href = installerDownloadUrl
    }
  }

  return (
    <article className="download-panel">
      <div>
        <p className="eyebrow">Windows installer</p>
        <h2>sky-creator-pro-setup.exe</h2>
        <p>Hosted in the public Supabase Storage bucket named `downloads`.</p>
      </div>
      <a className="button primary" href={installerDownloadUrl} onClick={handleDownload}>
        Download Sky Creator Pro for Windows
      </a>
    </article>
  )
}

function DesktopApp() {
  const [activeRoute, setActiveRoute] = useState<DesktopRoute>(() => routeFromHash(window.location.hash))
  const [notice, setNotice] = useState('Demo desktop mode. Everything is local placeholder data for now.')
  const [isMegaProActive, setIsMegaProActive] = useState(readMegaProTestState)
  const [projectItems] = useState<CreatorProject[]>(projects)
  const [cloudProjects, setCloudProjects] = useState<CloudProjectSummary[]>([])
  const [selectedCloudProjectKey, setSelectedCloudProjectKey] = useState('')
  const [isCloudBusy, setIsCloudBusy] = useState(false)

  useEffect(() => {
    const handleHashChange = () => setActiveRoute(routeFromHash(window.location.hash))
    window.addEventListener('hashchange', handleHashChange)

    if (!window.location.hash) {
      window.location.hash = desktopRouteHashes.dashboard
    }

    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  useEffect(() => {
    window.skyCreatorPro?.cloudProjects
      ?.getConfigStatus()
      .then((status) => {
        if (status.configured) {
          refreshCloudProjects()
        }
      })
      .catch(() => setNotice('Cloud storage could not be loaded yet.'))
  }, [])

  const navigate = (route: DesktopRoute) => {
    window.location.hash = desktopRouteHashes[route]
    setActiveRoute(route)
  }

  const handlePlaceholderAction = (label: string) => {
    setNotice(`${label} is a placeholder in this first desktop version.`)
  }

  const activateMegaPro = () => {
    window.localStorage.setItem(megaProStorageKey, 'true')
    setIsMegaProActive(true)
    setNotice('Mega Pro Active - Test Mode. No payment method was used.')
  }

  const cancelMegaPro = () => {
    window.localStorage.removeItem(megaProStorageKey)
    setIsMegaProActive(false)
    setNotice('Mega Pro test plan canceled. Core features remain free.')
  }

  const refreshCloudProjects = async () => {
    const cloudApi = window.skyCreatorPro?.cloudProjects

    if (!cloudApi) {
      setNotice('Cloud projects are only available in the Windows desktop app.')
      return
    }

    setIsCloudBusy(true)
    try {
      const result = await cloudApi.listProjects()

      if (!result.ok) {
        setNotice(result.message || 'Cloud project list failed.')
        return
      }

      setCloudProjects(result.projects)
      setSelectedCloudProjectKey((currentKey) => currentKey || result.projects[0]?.key || '')
      setNotice(`Found ${result.projects.length} cloud project file${result.projects.length === 1 ? '' : 's'}.`)
    } finally {
      setIsCloudBusy(false)
    }
  }

  const saveProjectToCloud = async (project: CloudProjectPayload) => {
    const cloudApi = window.skyCreatorPro?.cloudProjects

    if (!cloudApi) {
      const message = 'Cloud projects are only available in the Windows desktop app.'
      setNotice(message)
      return { ok: false, message }
    }

    setIsCloudBusy(true)
    try {
      const result = await cloudApi.saveProject(project)
      setNotice(result.message)

      if (result.ok) {
        await refreshCloudProjects()
      }

      return {
        ok: result.ok,
        message: result.message || (result.ok ? 'Saved project file to cloud storage.' : 'Cloud save failed.'),
      }
    } finally {
      setIsCloudBusy(false)
    }
  }

  const loadCloudProject = async (projectKey: string) => {
    const cloudApi = window.skyCreatorPro?.cloudProjects

    if (!cloudApi) {
      const message = 'Cloud projects are only available in the Windows desktop app.'
      setNotice(message)
      return { ok: false, message }
    }

    setIsCloudBusy(true)
    try {
      const result = await cloudApi.loadProject(projectKey)

      if (!result.ok || !result.project) {
        const message = result.message || 'Could not load that cloud project.'
        setNotice(message)
        return { ok: false, message }
      }

      const loadedProject = result.project as CloudProjectPayload
      setNotice(`Loaded "${loadedProject.title || loadedProject.id}" from cloud storage.`)
      return { ok: true, message: 'Loaded cloud project file.', project: loadedProject }
    } finally {
      setIsCloudBusy(false)
    }
  }

  return (
    <div className="desktop-shell">
      <aside className="desktop-sidebar">
        <button className="desktop-brand" type="button" onClick={() => navigate('dashboard')}>
          <span className="brand-mark">SCP</span>
          <span>
            <strong>Sky Creator Pro</strong>
            <small>Desktop creator studio</small>
          </span>
        </button>

        <nav className="desktop-nav" aria-label="Desktop navigation">
          {sidebarItems.map((item) => (
            <button
              className={activeRoute === item.route ? 'desktop-nav-button active' : 'desktop-nav-button'}
              type="button"
              key={item.route}
              onClick={() => navigate(item.route)}
            >
              <span>{item.marker}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-status">
          <span>{isMegaProActive ? 'Mega Pro test active' : 'Core free'}</span>
          <strong>{isMegaProActive ? 'Mega Pro Active - Test Mode' : 'Local demo workspace'}</strong>
          <small>Core editing stays free forever. Mega Pro is optional and in test mode.</small>
        </div>
      </aside>

      <section className="desktop-main">
        <header className="desktop-topbar">
          <div>
            <p className="eyebrow">Sky Creator Pro</p>
            <h1>{pageTitle(activeRoute)}</h1>
          </div>
          <div className="desktop-auth-actions">
            {isMegaProActive && <span className="mega-pro-badge">Mega Pro Test Active</span>}
            <button className="button ghost" type="button" onClick={() => handlePlaceholderAction('Login')}>
              Login
            </button>
            <button className="button primary" type="button" onClick={() => handlePlaceholderAction('Create Account')}>
              Create Account
            </button>
          </div>
        </header>

        <main className="desktop-content">
          {renderDesktopPage(activeRoute, handlePlaceholderAction, {
            isMegaProActive,
            activateMegaPro,
            cancelMegaPro,
            projectItems,
            cloudProjects,
            selectedCloudProjectKey,
            setSelectedCloudProjectKey,
            isCloudBusy,
            refreshCloudProjects,
            saveProjectToCloud,
            loadCloudProject,
          })}
        </main>

        <div className="desktop-notice" role="status">
          {notice}
        </div>
      </section>
    </div>
  )
}

function pageTitle(route: DesktopRoute) {
  switch (route) {
    case 'video':
      return 'Video Editor'
    case 'thumbnail':
      return 'Thumbnail Maker'
    case 'projects':
      return 'Projects'
    case 'export':
      return 'Export'
    case 'settings':
      return 'Settings'
    case 'dashboard':
    default:
      return 'Dashboard'
  }
}

function renderDesktopPage(
  route: DesktopRoute,
  onPlaceholderAction: (label: string) => void,
  megaPro: {
    isMegaProActive: boolean
    activateMegaPro: () => void
    cancelMegaPro: () => void
    projectItems: CreatorProject[]
    cloudProjects: CloudProjectSummary[]
    selectedCloudProjectKey: string
    setSelectedCloudProjectKey: (value: string) => void
    isCloudBusy: boolean
    refreshCloudProjects: () => Promise<void>
    saveProjectToCloud: (project: CloudProjectPayload) => Promise<{ ok: boolean; message: string }>
    loadCloudProject: (projectKey: string) => Promise<{ ok: boolean; message: string; project?: CloudProjectPayload }>
  },
) {
  switch (route) {
    case 'video':
      return (
        <VideoEditorWorkspace
          onPlaceholderAction={onPlaceholderAction}
          cloudProjects={megaPro.cloudProjects}
          selectedCloudProjectKey={megaPro.selectedCloudProjectKey}
          setSelectedCloudProjectKey={megaPro.setSelectedCloudProjectKey}
          isCloudBusy={megaPro.isCloudBusy}
          refreshCloudProjects={megaPro.refreshCloudProjects}
          saveProjectToCloud={megaPro.saveProjectToCloud}
          loadCloudProject={megaPro.loadCloudProject}
        />
      )
    case 'thumbnail':
      return <ThumbnailWorkspace onPlaceholderAction={onPlaceholderAction} />
    case 'projects':
      return (
        <ProjectsWorkspace
          projectItems={megaPro.projectItems}
          onPlaceholderAction={onPlaceholderAction}
        />
      )
    case 'export':
      return <ExportWorkspace onPlaceholderAction={onPlaceholderAction} />
    case 'settings':
      return (
        <SettingsWorkspace
          onPlaceholderAction={onPlaceholderAction}
          isMegaProActive={megaPro.isMegaProActive}
          activateMegaPro={megaPro.activateMegaPro}
          cancelMegaPro={megaPro.cancelMegaPro}
        />
      )
    case 'dashboard':
    default:
      return <DashboardWorkspace projectItems={megaPro.projectItems} onPlaceholderAction={onPlaceholderAction} />
  }
}

function DashboardWorkspace({
  projectItems,
  onPlaceholderAction,
}: {
  projectItems: CreatorProject[]
  onPlaceholderAction: (label: string) => void
}) {
  return (
    <div className="desktop-page-grid">
      <section className="desktop-card-grid">
        {dashboardCards.map((card) => (
          <article className="desktop-stat-card" key={card.label}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.detail}</small>
          </article>
        ))}
      </section>

      <section className="desktop-panel wide">
        <div className="desktop-panel-heading">
          <div>
            <p className="eyebrow">Project dashboard</p>
            <h2>Recent creator projects</h2>
          </div>
          <button className="button secondary" type="button" onClick={() => onPlaceholderAction('New Project')}>
            New Project
          </button>
        </div>
        <ProjectTable compact projectItems={projectItems} />
      </section>

      <section className="desktop-panel">
        <div className="desktop-panel-heading">
          <div>
            <p className="eyebrow">Today</p>
            <h2>Focus queue</h2>
          </div>
        </div>
        <div className="focus-list">
          <span>Finish intro trim</span>
          <span>Choose thumbnail text</span>
          <span>Export 1080p review file</span>
          <span>Write pinned comment</span>
        </div>
      </section>
    </div>
  )
}

function ProjectsWorkspace({
  projectItems,
  onPlaceholderAction,
}: {
  projectItems: CreatorProject[]
  onPlaceholderAction: (label: string) => void
}) {
  return (
    <section className="desktop-panel full-height">
      <div className="desktop-panel-heading">
        <div>
          <p className="eyebrow">Projects</p>
          <h2>Native project list</h2>
        </div>
        <button className="button primary" type="button" onClick={() => onPlaceholderAction('Create Project')}>
          Create Project
        </button>
      </div>
      <ProjectTable projectItems={projectItems} />
    </section>
  )
}

function ProjectTable({
  compact = false,
  projectItems,
}: {
  compact?: boolean
  projectItems: CreatorProject[]
}) {
  return (
    <div className={compact ? 'desktop-project-table compact' : 'desktop-project-table'}>
      {projectItems.map((project) => (
        <article className="desktop-project-row" key={project.id}>
          <div>
            <span className={`status-pill ${project.status.toLowerCase().replaceAll(' ', '-')}`}>
              {project.status}
            </span>
            <h3>{project.title}</h3>
            <p>{project.nextAction}</p>
          </div>
          <div className="desktop-project-meta">
            <span>{project.platform}</span>
            <span>{project.dueDate}</span>
          </div>
          <div className="progress-track" aria-label={`${project.progress}% complete`}>
            <span style={{ width: `${project.progress}%` }} />
          </div>
        </article>
      ))}
    </div>
  )
}

function VideoEditorWorkspace({
  onPlaceholderAction,
  cloudProjects,
  selectedCloudProjectKey,
  setSelectedCloudProjectKey,
  isCloudBusy,
  refreshCloudProjects,
  saveProjectToCloud,
  loadCloudProject,
}: {
  onPlaceholderAction: (label: string) => void
  cloudProjects: CloudProjectSummary[]
  selectedCloudProjectKey: string
  setSelectedCloudProjectKey: (value: string) => void
  isCloudBusy: boolean
  refreshCloudProjects: () => Promise<void>
  saveProjectToCloud: (project: CloudProjectPayload) => Promise<{ ok: boolean; message: string }>
  loadCloudProject: (projectKey: string) => Promise<{ ok: boolean; message: string; project?: CloudProjectPayload }>
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const activePlaybackClipIdRef = useRef<number | null>(1)
  const [videoUrl, setVideoUrl] = useState('')
  const [mediaName, setMediaName] = useState('No media imported')
  const [duration, setDuration] = useState(30)
  const [playhead, setPlayhead] = useState(0)
  const [clips, setClips] = useState<EditorClip[]>([
    { id: 1, label: 'Hook', sourceStart: 0, sourceEnd: 6, timelineStart: 0, duration: 6, speed: 1 },
    { id: 2, label: 'Setup', sourceStart: 6, sourceEnd: 14, timelineStart: 6, duration: 8, speed: 1 },
    { id: 3, label: 'Demo', sourceStart: 14, sourceEnd: 25, timelineStart: 14, duration: 11, speed: 1 },
    { id: 4, label: 'CTA', sourceStart: 25, sourceEnd: 30, timelineStart: 25, duration: 5, speed: 1 },
  ])
  const [undoStack, setUndoStack] = useState<EditorClip[][]>([])
  const [redoStack, setRedoStack] = useState<EditorClip[][]>([])
  const [selectedClipId, setSelectedClipId] = useState(1)
  const [textOverlays, setTextOverlays] = useState<TextOverlay[]>([
    { id: 1, text: 'Budget desk setup', start: 1, end: 6 },
  ])
  const [draftText, setDraftText] = useState('New creator tip')
  const [exportTitle, setExportTitle] = useState('Sky Creator Pro edit')
  const [exportResolutionId, setExportResolutionId] = useState('1080p')
  const [exportFrameRate, setExportFrameRate] = useState(30)
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [exportStatus, setExportStatus] = useState('Choose export settings, then render the edited timeline.')
  const [exportUrl, setExportUrl] = useState('')
  const [cloudEditorStatus, setCloudEditorStatus] = useState(
    'Save your project file to cloud storage before export so you can keep working later.',
  )
  const selectedClip = clips.find((clip) => clip.id === selectedClipId)
  const activeText = textOverlays.find((overlay) => playhead >= overlay.start && playhead <= overlay.end)
  const exportSegments = getEditedTimelineSegments(clips)
  const selectedExportResolution =
    exportResolutions.find((resolution) => resolution.id === exportResolutionId) ?? exportResolutions[1]
  const exportFileName = `${sanitizeExportFileName(exportTitle)}.mp4`
  const totalTimelineDuration = exportSegments.at(-1)?.timelineEnd ?? 0
  const selectedClipDuration = selectedClip?.duration ?? 0
  const timelineSliderMax = Math.max(totalTimelineDuration, 0.1)

  useEffect(() => {
    return () => {
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl)
      }
    }
  }, [videoUrl])

  useEffect(() => {
    return () => {
      if (exportUrl) {
        URL.revokeObjectURL(exportUrl)
      }
    }
  }, [exportUrl])

  const commitClips = (nextClips: EditorClip[], nextSelectedClipId = selectedClipId) => {
    const normalizedClips = normalizeEditorClips(nextClips)
    const lastClip = normalizedClips.at(-1)
    const nextTotalDuration = lastClip ? lastClip.timelineStart + lastClip.duration : 0

    setUndoStack((currentStack) => [...currentStack.slice(-24), clips])
    setRedoStack([])
    setClips(normalizedClips)
    setSelectedClipId(normalizedClips.some((clip) => clip.id === nextSelectedClipId) ? nextSelectedClipId : (normalizedClips[0]?.id ?? 0))
    setPlayhead((currentPlayhead) => Math.min(currentPlayhead, nextTotalDuration))
  }

  const undo = () => {
    setUndoStack((currentStack) => {
      const previousClips = currentStack.at(-1)

      if (!previousClips) {
        return currentStack
      }

      setRedoStack((currentRedoStack) => [...currentRedoStack, clips])
      setClips(previousClips)
      setSelectedClipId(previousClips[0]?.id ?? 0)
      return currentStack.slice(0, -1)
    })
  }

  const redo = () => {
    setRedoStack((currentStack) => {
      const nextClips = currentStack.at(-1)

      if (!nextClips) {
        return currentStack
      }

      setUndoStack((currentUndoStack) => [...currentUndoStack, clips])
      setClips(nextClips)
      setSelectedClipId(nextClips[0]?.id ?? 0)
      return currentStack.slice(0, -1)
    })
  }

  const handleMediaImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    if (videoUrl) {
      URL.revokeObjectURL(videoUrl)
    }

    const nextUrl = URL.createObjectURL(file)
    const nextClipId = Date.now()
    setVideoUrl(nextUrl)
    setMediaName(file.name)
    setPlayhead(0)
    setUndoStack([])
    setRedoStack([])
    setClips([
      {
        id: nextClipId,
        label: file.name.replace(/\.[^.]+$/, '').slice(0, 22) || 'Clip 1',
        sourceStart: 0,
        sourceEnd: 30,
        timelineStart: 0,
        duration: 30,
        speed: 1,
      },
    ])
    setSelectedClipId(nextClipId)
    activePlaybackClipIdRef.current = nextClipId
  }

  const updateSelectedClip = (patch: Partial<EditorClip>) => {
    if (!selectedClip) {
      return
    }

    const nextClips = clips.map((clip) => {
      if (clip.id !== selectedClip.id) {
        return clip
      }

      const nextClip = { ...clip, ...patch }
      const safeSpeed = Math.max(nextClip.speed, 0.25)
      const safeSourceStart = Math.max(0, Math.min(nextClip.sourceStart, nextClip.sourceEnd - 0.25))
      const safeSourceEnd = Math.min(duration, Math.max(nextClip.sourceEnd, safeSourceStart + 0.25))

      return {
        ...nextClip,
        sourceStart: Number(safeSourceStart.toFixed(3)),
        sourceEnd: Number(safeSourceEnd.toFixed(3)),
        speed: safeSpeed,
      }
    })

    commitClips(nextClips)
  }

  const splitSelectedClip = () => {
    if (!selectedClip) {
      return
    }

    const splitPoint = Math.max(
      selectedClip.timelineStart + 0.25,
      Math.min(playhead, selectedClip.timelineStart + selectedClip.duration - 0.25),
    )

    if (splitPoint <= selectedClip.timelineStart || splitPoint >= selectedClip.timelineStart + selectedClip.duration) {
      onPlaceholderAction('Move playhead inside a clip before splitting')
      return
    }

    const splitOffset = splitPoint - selectedClip.timelineStart
    const sourceSplitPoint = Number((selectedClip.sourceStart + splitOffset * selectedClip.speed).toFixed(3))
    const firstClip: EditorClip = {
      ...selectedClip,
      sourceEnd: sourceSplitPoint,
      label: `${selectedClip.label} A`,
    }
    const secondClip: EditorClip = {
      ...selectedClip,
      id: Date.now(),
      sourceStart: sourceSplitPoint,
      label: `${selectedClip.label} B`,
    }

    commitClips(clips.flatMap((clip) => (clip.id === selectedClip.id ? [firstClip, secondClip] : [clip])), secondClip.id)
  }

  const deleteSelectedClip = () => {
    if (!selectedClip) {
      return
    }

    const selectedIndex = clips.findIndex((clip) => clip.id === selectedClip.id)
    const nextClips = clips.filter((clip) => clip.id !== selectedClip.id)
    const nextSelectedClip = nextClips[Math.min(selectedIndex, nextClips.length - 1)]
    commitClips(nextClips, nextSelectedClip?.id ?? 0)
    activePlaybackClipIdRef.current = nextSelectedClip?.id ?? null
  }

  const duplicateSelectedClip = () => {
    if (!selectedClip) {
      return
    }

    const duplicateClip: EditorClip = {
      ...selectedClip,
      id: Date.now(),
      label: `${selectedClip.label} copy`,
    }
    const selectedIndex = clips.findIndex((clip) => clip.id === selectedClip.id)
    const nextClips = [...clips]
    nextClips.splice(selectedIndex + 1, 0, duplicateClip)

    commitClips(nextClips, duplicateClip.id)
  }

  const renameSelectedClip = (label: string) => {
    if (!selectedClip) {
      return
    }

    updateSelectedClip({ label })
  }

  const addTextOverlay = () => {
    const trimmedText = draftText.trim()

    if (!trimmedText) {
      return
    }

    setTextOverlays((currentOverlays) => [
      ...currentOverlays,
      {
        id: Date.now(),
        text: trimmedText,
        start: Number(playhead.toFixed(1)),
        end: Number(Math.min(playhead + 4, totalTimelineDuration).toFixed(1)),
      },
    ])
    setDraftText('')
  }

  const seekTo = (time: number) => {
    const safeTime = Math.max(0, Math.min(time, totalTimelineDuration))
    setPlayhead(safeTime)

    if (videoRef.current && videoUrl) {
      const mappedTime = mapEditedTimeToSourceTime(clips, safeTime)

      if (!mappedTime) {
        videoRef.current.pause()
        activePlaybackClipIdRef.current = null
        return
      }

      activePlaybackClipIdRef.current = mappedTime.clip.id
      videoRef.current.playbackRate = mappedTime.clip.speed
      videoRef.current.currentTime = mappedTime.sourceTime
    }
  }

  const handlePreviewPlay = () => {
    if (!videoRef.current) {
      return
    }

    if (clips.length === 0 || totalTimelineDuration === 0) {
      videoRef.current.pause()
      return
    }

    const editedStartTime = playhead >= totalTimelineDuration ? 0 : playhead
    const mappedTime = mapEditedTimeToSourceTime(clips, editedStartTime)

    if (!mappedTime) {
      videoRef.current.pause()
      return
    }

    activePlaybackClipIdRef.current = mappedTime.clip.id
    videoRef.current.playbackRate = mappedTime.clip.speed
    videoRef.current.currentTime = mappedTime.sourceTime
    setPlayhead(editedStartTime)
  }

  const handlePreviewTimeUpdate = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget
    const activeClip =
      clips.find((clip) => clip.id === activePlaybackClipIdRef.current) ?? findClipAtEditedTime(clips, playhead)

    if (!activeClip) {
      setPlayhead(0)
      video.pause()
      return
    }

    if (video.currentTime < activeClip.sourceStart - 0.08) {
      video.currentTime = activeClip.sourceStart
      return
    }

    if (video.currentTime >= activeClip.sourceEnd - 0.04) {
      const activeClipIndex = clips.findIndex((clip) => clip.id === activeClip.id)
      const nextClip = clips[activeClipIndex + 1]

      if (!nextClip) {
        setPlayhead(totalTimelineDuration)
        video.pause()
        activePlaybackClipIdRef.current = null
        return
      }

      activePlaybackClipIdRef.current = nextClip.id
      video.playbackRate = nextClip.speed
      video.currentTime = nextClip.sourceStart
      setPlayhead(nextClip.timelineStart)
      return
    }

    const editedTime = activeClip.timelineStart + (video.currentTime - activeClip.sourceStart) / activeClip.speed
    setPlayhead(Number(Math.min(editedTime, totalTimelineDuration).toFixed(3)))
  }

  const buildEditorProjectFile = (): EditorProjectFile => ({
    version: 1,
    mediaName,
    duration,
    playhead: Number(playhead.toFixed(3)),
    clips: normalizeEditorClips(clips),
    textOverlays,
    exportSettings: {
      title: exportTitle,
      resolutionId: exportResolutionId,
      frameRate: exportFrameRate,
    },
    savedAt: new Date().toISOString(),
  })

  const saveEditorProjectToCloud = async () => {
    const projectTitle = exportTitle.trim() || mediaName.replace(/\.[^.]+$/, '') || 'Sky Creator Pro edit'
    const editorProject = buildEditorProjectFile()
    const result = await saveProjectToCloud({
      id: `editor-${sanitizeExportFileName(projectTitle)}`,
      title: projectTitle,
      platform: 'Video Editor',
      dueDate: 'Cloud project file',
      status: 'Editing',
      progress: Math.min(95, Math.max(10, clips.length * 18 + textOverlays.length * 5)),
      nextAction: 'Open in the Video Editor and continue editing.',
      thumbnailState: `${textOverlays.length} text layer${textOverlays.length === 1 ? '' : 's'}`,
      videoState: `${clips.length} timeline clip${clips.length === 1 ? '' : 's'}`,
      editorProject,
    })

    setCloudEditorStatus(
      result.ok
        ? `Saved "${projectTitle}" to cloud storage. You can refresh and load it from the file list.`
        : result.message,
    )
  }

  const loadEditorProjectFromCloud = async () => {
    if (!selectedCloudProjectKey) {
      setCloudEditorStatus('Choose a cloud project file to load first.')
      return
    }

    const result = await loadCloudProject(selectedCloudProjectKey)

    if (!result.ok || !result.project) {
      setCloudEditorStatus(result.message)
      return
    }

    const loadedProject = result.project as CloudProjectPayload & { editorProject?: Partial<EditorProjectFile> }
    const editorProject = loadedProject.editorProject

    if (!editorProject || !Array.isArray(editorProject.clips)) {
      setCloudEditorStatus('That cloud file does not contain a video editor timeline yet.')
      return
    }

    const loadedClips = normalizeEditorClips(
      editorProject.clips.map((clip, index) => ({
        id: Number(clip.id) || Date.now() + index,
        label: clip.label || `Clip ${index + 1}`,
        sourceStart: Number(clip.sourceStart) || 0,
        sourceEnd: Number(clip.sourceEnd) || 0.25,
        timelineStart: Number(clip.timelineStart) || 0,
        duration: Number(clip.duration) || 0.25,
        speed: Number(clip.speed) || 1,
      })),
    )

    setMediaName(editorProject.mediaName || 'Cloud project file')
    setDuration(Number(editorProject.duration) || duration)
    const loadedTimelineDuration = loadedClips.at(-1)
      ? (loadedClips.at(-1)?.timelineStart ?? 0) + (loadedClips.at(-1)?.duration ?? 0)
      : 0
    setPlayhead(Math.min(Number(editorProject.playhead) || 0, loadedTimelineDuration))
    setClips(loadedClips)
    setSelectedClipId(loadedClips[0]?.id ?? 0)
    setTextOverlays(Array.isArray(editorProject.textOverlays) ? editorProject.textOverlays : [])
    setExportTitle(editorProject.exportSettings?.title || String(loadedProject.title || 'Sky Creator Pro edit'))
    setExportResolutionId(editorProject.exportSettings?.resolutionId || '1080p')
    setExportFrameRate(Number(editorProject.exportSettings?.frameRate) || 30)
    setUndoStack([])
    setRedoStack([])
    activePlaybackClipIdRef.current = loadedClips[0]?.id ?? null
    setCloudEditorStatus(
      `Loaded "${loadedProject.title || loadedProject.id}" from cloud storage. Re-import the source video if you want preview/export playback.`,
    )
  }

  const exportEditedVideo = async () => {
    const video = videoRef.current
    const mimeType = getSupportedMp4MimeType()

    if (!video || !videoUrl) {
      setExportStatus('Import a video before exporting.')
      return
    }

    if (clips.length === 0 || totalTimelineDuration <= 0) {
      setExportStatus('There are no timeline clips to export.')
      return
    }

    if (typeof MediaRecorder === 'undefined' || !mimeType) {
      setExportStatus('MP4 export is not available on this system yet. A future FFmpeg exporter will handle this everywhere.')
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = selectedExportResolution.width
    canvas.height = selectedExportResolution.height
    const context = canvas.getContext('2d')

    if (!context || !canvas.captureStream) {
      setExportStatus('Canvas video export is not available in this build.')
      return
    }

    const stream = canvas.captureStream(exportFrameRate)
    const chunks: BlobPart[] = []
    const recorder = new MediaRecorder(stream, { mimeType })
    const previousPlaybackRate = video.playbackRate
    const previousMuted = video.muted
    const previousTime = video.currentTime
    const previousPlayhead = playhead
    const previousActiveClipId = activePlaybackClipIdRef.current

    setIsExporting(true)
    setExportProgress(0)
    setExportStatus(`Rendering ${exportFileName} as ${selectedExportResolution.label} at ${exportFrameRate} FPS.`)

    const recordingFinished = new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data)
        }
      }
      recorder.onerror = () => reject(new Error('The local video recorder failed during export.'))
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }))
    })

    try {
      video.pause()
      video.muted = true
      recorder.start(500)
      recorder.pause()

      for (const clip of clips) {
        setExportStatus(`Rendering clip: ${clip.label || 'Untitled clip'}`)
        await waitForVideoSeek(video, clip.sourceStart)
        video.playbackRate = clip.speed

        const firstOverlay = textOverlays.find(
          (overlay) => clip.timelineStart >= overlay.start && clip.timelineStart <= overlay.end,
        )
        drawEditedVideoFrame(canvas, context, video, firstOverlay?.text)

        if (recorder.state === 'paused') {
          recorder.resume()
        }

        await video.play()

        while (video.currentTime < clip.sourceEnd - 0.04 && recorder.state === 'recording') {
          const editedTime = clip.timelineStart + (video.currentTime - clip.sourceStart) / clip.speed
          const overlay = textOverlays.find((item) => editedTime >= item.start && editedTime <= item.end)

          drawEditedVideoFrame(canvas, context, video, overlay?.text)
          setExportProgress(Math.min(99, Math.round((editedTime / totalTimelineDuration) * 100)))
          await nextAnimationFrame()
        }

        video.pause()

        if (recorder.state === 'recording') {
          recorder.pause()
        }
      }

      setExportProgress(100)

      if (recorder.state === 'paused') {
        recorder.resume()
      }

      recorder.stop()
      const exportBlob = await recordingFinished
      const nextExportUrl = URL.createObjectURL(exportBlob)

      setExportUrl((currentUrl) => {
        if (currentUrl) {
          URL.revokeObjectURL(currentUrl)
        }

        return nextExportUrl
      })

      const downloadLink = document.createElement('a')
      downloadLink.href = nextExportUrl
      downloadLink.download = exportFileName
      downloadLink.click()
      setExportStatus(`Export complete: ${exportFileName}`)
    } catch (error) {
      if (recorder.state !== 'inactive') {
        recorder.stop()
      }

      setExportStatus(error instanceof Error ? error.message : 'Export failed. Try a shorter edit or lower resolution.')
    } finally {
      stream.getTracks().forEach((track) => track.stop())
      video.pause()
      video.muted = previousMuted
      video.playbackRate = previousPlaybackRate
      activePlaybackClipIdRef.current = previousActiveClipId
      setPlayhead(previousPlayhead)
      await waitForVideoSeek(video, previousTime)
      setIsExporting(false)
    }
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const targetTag = target?.tagName ?? ''
      const isTyping =
        target?.isContentEditable || targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT'

      if (isTyping) {
        return
      }

      const key = event.key.toLowerCase()

      if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) {
          setRedoStack((currentStack) => {
            const nextClips = currentStack.at(-1)

            if (!nextClips) {
              return currentStack
            }

            setUndoStack((currentUndoStack) => [...currentUndoStack, clips])
            setClips(nextClips)
            setSelectedClipId(nextClips[0]?.id ?? 0)
            return currentStack.slice(0, -1)
          })
        } else {
          setUndoStack((currentStack) => {
            const previousClips = currentStack.at(-1)

            if (!previousClips) {
              return currentStack
            }

            setRedoStack((currentRedoStack) => [...currentRedoStack, clips])
            setClips(previousClips)
            setSelectedClipId(previousClips[0]?.id ?? 0)
            return currentStack.slice(0, -1)
          })
        }
        return
      }

      if ((event.ctrlKey || event.metaKey) && key === 'y') {
        event.preventDefault()
        setRedoStack((currentStack) => {
          const nextClips = currentStack.at(-1)

          if (!nextClips) {
            return currentStack
          }

          setUndoStack((currentUndoStack) => [...currentUndoStack, clips])
          setClips(nextClips)
          setSelectedClipId(nextClips[0]?.id ?? 0)
          return currentStack.slice(0, -1)
        })
        return
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedClip) {
        event.preventDefault()
        const selectedIndex = clips.findIndex((clip) => clip.id === selectedClip.id)
        const nextClips = clips.filter((clip) => clip.id !== selectedClip.id)
        const normalizedNextClips = normalizeEditorClips(nextClips)
        const nextSelectedClip = normalizedNextClips[Math.min(selectedIndex, normalizedNextClips.length - 1)]
        const lastClip = normalizedNextClips.at(-1)
        const nextTotalDuration = lastClip ? lastClip.timelineStart + lastClip.duration : 0

        setUndoStack((currentStack) => [...currentStack.slice(-24), clips])
        setRedoStack([])
        setClips(normalizedNextClips)
        setSelectedClipId(nextSelectedClip?.id ?? 0)
        setPlayhead((currentPlayhead) => Math.min(currentPlayhead, nextTotalDuration))
        activePlaybackClipIdRef.current = nextSelectedClip?.id ?? null
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [clips, selectedClip])

  return (
    <div className="editor-workspace">
      <section className="desktop-panel media-bin">
        <div className="desktop-panel-heading">
          <div>
            <p className="eyebrow">Media import</p>
            <h2>Import video</h2>
          </div>
        </div>
        <input ref={fileInputRef} hidden type="file" accept="video/*" onChange={handleMediaImport} />
        <div
          className="drop-zone video-drop-zone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            const file = event.dataTransfer.files?.[0]
            if (file && file.type.startsWith('video/')) {
              handleMediaImport({ target: { files: event.dataTransfer.files } } as ChangeEvent<HTMLInputElement>)
            }
          }}
        >
          <strong>{videoUrl ? 'Video loaded' : 'Drop video here'}</strong>
          <span>{mediaName}</span>
          <button className="button secondary" type="button" onClick={() => fileInputRef.current?.click()}>
            Import Media
          </button>
        </div>
        <div className="media-summary">
          <span>Duration</span>
          <strong>{formatTime(totalTimelineDuration)}</strong>
          <span>Clips</span>
          <strong>{clips.length}</strong>
          <span>Export segments</span>
          <strong>{exportSegments.length}</strong>
        </div>
      </section>

      <section className="desktop-panel preview-panel">
        <div className="preview-window">
          {videoUrl ? (
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              onLoadedMetadata={(event) => {
                const nextDuration = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 30
                setDuration(nextDuration)
                setClips((currentClips) =>
                  currentClips.length === 1
                    ? normalizeEditorClips(
                        currentClips.map((clip) => ({
                          ...clip,
                          sourceEnd: Number(nextDuration.toFixed(1)),
                        })),
                      )
                    : currentClips,
                )
              }}
              onPlay={handlePreviewPlay}
              onTimeUpdate={handlePreviewTimeUpdate}
            />
          ) : (
            <div className="preview-empty-state">
              <span>16:9 preview window</span>
              <strong>Import a video to start editing</strong>
            </div>
          )}
          {activeText && <div className="video-text-overlay">{activeText.text}</div>}
        </div>
      </section>

      <section className="desktop-panel tools-panel">
        <div className="desktop-panel-heading">
          <div>
            <p className="eyebrow">Tools</p>
            <h2>Edit tools</h2>
          </div>
        </div>
        <div className="clip-inspector">
          {selectedClip ? (
            <>
              <label>
                Clip name
                <input value={selectedClip.label} onChange={(event) => renameSelectedClip(event.target.value)} />
              </label>

              <div className="selected-clip-info">
                <div>
                  <span>Clip name</span>
                  <strong>{selectedClip.label || 'Untitled clip'}</strong>
                </div>
                <div>
                  <span>Timeline start</span>
                  <strong>{formatTime(selectedClip.timelineStart)}</strong>
                </div>
                <div>
                  <span>Timeline end</span>
                  <strong>{formatTime(selectedClip.timelineStart + selectedClip.duration)}</strong>
                </div>
                <div>
                  <span>Source range</span>
                  <strong>
                    {formatTime(selectedClip.sourceStart)} - {formatTime(selectedClip.sourceEnd)}
                  </strong>
                </div>
                <div>
                  <span>Duration</span>
                  <strong>{formatTime(selectedClipDuration)}</strong>
                </div>
                <div>
                  <span>Speed</span>
                  <strong>{selectedClip.speed}x</strong>
                </div>
              </div>

              <label>
                Selected clip
                <select value={selectedClip.id} onChange={(event) => setSelectedClipId(Number(event.target.value))}>
                  {clips.map((clip) => (
                    <option value={clip.id} key={clip.id}>
                      {clip.label || 'Untitled clip'}
                    </option>
                  ))}
                </select>
              </label>

              <div className="tool-button-grid">
                <button type="button" onClick={splitSelectedClip}>
                  Split at playhead
                </button>
                <button type="button" onClick={() => updateSelectedClip({ sourceStart: selectedClip.sourceStart + 0.5 })}>
                  Trim start +0.5s
                </button>
                <button type="button" onClick={() => updateSelectedClip({ sourceStart: selectedClip.sourceStart - 0.5 })}>
                  Restore start -0.5s
                </button>
                <button type="button" onClick={() => updateSelectedClip({ sourceEnd: selectedClip.sourceEnd - 0.5 })}>
                  Trim end -0.5s
                </button>
                <button type="button" onClick={duplicateSelectedClip}>
                  Duplicate Clip
                </button>
                <button className="danger-button" type="button" onClick={deleteSelectedClip}>
                  Delete Clip
                </button>
                <button type="button" onClick={undo} disabled={undoStack.length === 0}>
                  Undo
                </button>
                <button type="button" onClick={redo} disabled={redoStack.length === 0}>
                  Redo
                </button>
              </div>

              <label>
                Speed
                <select value={selectedClip.speed} onChange={(event) => updateSelectedClip({ speed: Number(event.target.value) })}>
                  {speedOptions.map((speed) => (
                    <option value={speed} key={speed}>
                      {speed}x
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Add text
                <input
                  value={draftText}
                  onChange={(event) => setDraftText(event.target.value)}
                  placeholder="Text on video"
                />
              </label>
              <button className="button primary" type="button" onClick={addTextOverlay}>
                Add Text
              </button>
            </>
          ) : (
            <div className="editor-empty-state">
              <strong>Select a clip on the timeline to edit it.</strong>
              <span>Import media or click an existing clip to trim, split, rename, change speed, or add text.</span>
            </div>
          )}
        </div>
      </section>

      <section className="desktop-panel timeline-panel">
        <div className="desktop-panel-heading">
          <div>
            <p className="eyebrow">Timeline</p>
            <h2>{selectedClip ? `${selectedClip.label} selected` : 'Local edit timeline'}</h2>
          </div>
          <div className="timeline-readout">
            <span>{formatTime(playhead)}</span>
            <input
              type="range"
              min="0"
              max={timelineSliderMax}
              step="0.1"
              value={Math.min(playhead, totalTimelineDuration)}
              onChange={(event) => seekTo(Number(event.target.value))}
            />
          </div>
        </div>
        <div className="desktop-timeline editable-timeline">
          {clips.length > 0 ? (
            clips.map((clip) => (
              <button
                className={clip.id === selectedClip?.id ? 'timeline-clip active' : 'timeline-clip'}
                type="button"
                style={{ width: `${Math.max((clip.duration / timelineSliderMax) * 100, 8)}%` }}
                key={clip.id}
                onClick={() => {
                  setSelectedClipId(clip.id)
                  seekTo(clip.timelineStart)
                }}
              >
                <strong>{clip.label || 'Untitled clip'}</strong>
                <span>
                  {formatTime(clip.timelineStart)} - {formatTime(clip.timelineStart + clip.duration)}
                </span>
                <small>{clip.speed}x</small>
              </button>
            ))
          ) : (
            <div className="timeline-empty-state">Import a video to create your first timeline clip.</div>
          )}
        </div>
        <div className="text-layer-track">
          {textOverlays.map((overlay) => (
            <button
              type="button"
              key={overlay.id}
              style={{
                left: `${Math.max((overlay.start / timelineSliderMax) * 100, 0)}%`,
                width: `${Math.max(((overlay.end - overlay.start) / timelineSliderMax) * 100, 8)}%`,
              }}
              onClick={() => seekTo(overlay.start)}
            >
              {overlay.text}
            </button>
          ))}
        </div>
      </section>

      <section className="desktop-panel editor-cloud-panel">
        <div className="desktop-panel-heading">
          <div>
            <p className="eyebrow">Cloud storage</p>
            <h2>Save project before export?</h2>
          </div>
          <span className="status-pill test-plan">Project files</span>
        </div>
        <div className="editor-cloud-layout">
          <div>
            <p>
              Save your timeline, text layers, and export settings as a cloud project file. You can come back later,
              load the file, and keep editing.
            </p>
            <div className="cloud-action-row">
              <button className="button primary" type="button" disabled={isCloudBusy} onClick={saveEditorProjectToCloud}>
                Save Project to Cloud
              </button>
              <button className="button secondary" type="button" disabled={isCloudBusy} onClick={refreshCloudProjects}>
                Refresh Cloud Files
              </button>
            </div>
            <small>{cloudEditorStatus}</small>
          </div>

          <div className="cloud-file-picker">
            <label>
              Cloud project files
              <select
                value={selectedCloudProjectKey}
                onChange={(event) => setSelectedCloudProjectKey(event.target.value)}
                disabled={cloudProjects.length === 0}
              >
                {cloudProjects.length === 0 ? (
                  <option value="">No cloud files yet</option>
                ) : (
                  cloudProjects.map((project) => (
                    <option value={project.key} key={project.key}>
                      {project.name}
                    </option>
                  ))
                )}
              </select>
            </label>
            <button
              className="button secondary"
              type="button"
              disabled={isCloudBusy || !selectedCloudProjectKey}
              onClick={loadEditorProjectFromCloud}
            >
              Load Selected File
            </button>
          </div>
        </div>
      </section>

      <section className="desktop-panel editor-export-panel">
        <div className="desktop-panel-heading">
          <div>
            <p className="eyebrow">Export mode</p>
            <h2>Render edited video</h2>
          </div>
          <span className="status-pill test-plan">Local MP4 export</span>
        </div>
        <div className="editor-export-grid">
          <label>
            Video title
            <input value={exportTitle} onChange={(event) => setExportTitle(event.target.value)} />
          </label>
          <label>
            Resolution
            <select value={exportResolutionId} onChange={(event) => setExportResolutionId(event.target.value)}>
              {exportResolutions.map((resolution) => (
                <option value={resolution.id} key={resolution.id}>
                  {resolution.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Frame rate
            <select value={exportFrameRate} onChange={(event) => setExportFrameRate(Number(event.target.value))}>
              {exportFrameRates.map((frameRate) => (
                <option value={frameRate} key={frameRate}>
                  {frameRate} FPS
                </option>
              ))}
            </select>
          </label>
          <button
            className="button primary"
            type="button"
            disabled={isExporting || !videoUrl || clips.length === 0}
            onClick={exportEditedVideo}
          >
            {isExporting ? 'Exporting Video...' : 'Export Edited Video'}
          </button>
        </div>
        <div className="export-progress-panel">
          <div className="export-progress-track" aria-label={`${exportProgress}% export complete`}>
            <span style={{ width: `${exportProgress}%` }} />
          </div>
          <p>{exportStatus}</p>
          <small>
            Output file: {exportFileName}. Current local exporter renders the edited video timeline with text layers.
          </small>
          {exportUrl && (
            <a className="button secondary export-download-link" href={exportUrl} download={exportFileName}>
              Download Last Export
            </a>
          )}
        </div>
      </section>
    </div>
  )
}

function formatTime(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safeSeconds / 60)
  const remainder = safeSeconds % 60
  return `${minutes}:${remainder.toString().padStart(2, '0')}`
}

function ThumbnailWorkspace({ onPlaceholderAction }: { onPlaceholderAction: (label: string) => void }) {
  return (
    <div className="thumbnail-maker-layout">
      <section className="desktop-panel canvas-panel">
        <div className="thumbnail-canvas">
          <span className="thumbnail-badge">NEW</span>
          <h2>Creator setup</h2>
          <p>Under $500</p>
        </div>
      </section>

      <aside className="desktop-panel thumbnail-tool-panel">
        <div className="desktop-panel-heading">
          <div>
            <p className="eyebrow">Thumbnail maker</p>
            <h2>Design tools</h2>
          </div>
        </div>
        <label>
          Text tool
          <input value="Creator setup" readOnly />
        </label>
        <label>
          Image tool
          <input value="Face cutout placeholder" readOnly />
        </label>
        <label>
          Layout style
          <select value="bold" onChange={() => undefined}>
            <option value="bold">Bold creator text</option>
          </select>
        </label>
        <button className="button primary" type="button" onClick={() => onPlaceholderAction('Export Thumbnail')}>
          Export Thumbnail
        </button>
      </aside>
    </div>
  )
}

function ExportWorkspace({ onPlaceholderAction }: { onPlaceholderAction: (label: string) => void }) {
  return (
    <div className="export-layout">
      <section className="desktop-panel full-height">
        <div className="desktop-panel-heading">
          <div>
            <p className="eyebrow">Export</p>
            <h2>Render queue</h2>
          </div>
          <button className="button primary" type="button" onClick={() => onPlaceholderAction('Start Export')}>
            Start Export
          </button>
        </div>
        <div className="export-list">
          <article>
            <strong>Budget desk setup final</strong>
            <span>1080p MP4, waiting</span>
          </article>
          <article>
            <strong>Shorts batch preview</strong>
            <span>Vertical 1080x1920, draft</span>
          </article>
          <article>
            <strong>Thumbnail pack</strong>
            <span>PNG, 3 variants</span>
          </article>
        </div>
      </section>
    </div>
  )
}

function SettingsWorkspace({
  onPlaceholderAction,
  isMegaProActive,
  activateMegaPro,
  cancelMegaPro,
}: {
  onPlaceholderAction: (label: string) => void
  isMegaProActive: boolean
  activateMegaPro: () => void
  cancelMegaPro: () => void
}) {
  return (
    <div className="settings-layout">
      <section className="desktop-panel wide mega-pro-panel">
        <div className="desktop-panel-heading">
          <div>
            <p className="eyebrow">Test subscription</p>
            <h2>Sky Creator Pro Mega Pro</h2>
          </div>
          <span className={isMegaProActive ? 'status-pill active-plan' : 'status-pill test-plan'}>
            {isMegaProActive ? 'Mega Pro Active - Test Mode' : 'Test mode available'}
          </span>
        </div>
        <p>
          Try Mega Pro free during early testing. Mega Pro is optional and will later include AI tools, cloud features,
          project sync, and early access features. Sky Creator Pro Core stays free forever.
        </p>
        <div className="mega-pro-actions">
          <button className="button primary" type="button" onClick={activateMegaPro}>
            Try Mega Pro Free
          </button>
          <button className="button secondary" type="button" onClick={() => onPlaceholderAction('Manage Plan')}>
            Manage Plan
          </button>
          <button className="button ghost danger-action" type="button" onClick={cancelMegaPro}>
            Cancel Test Plan
          </button>
        </div>
        <p className="test-mode-note">No credit card required. Payments are not live yet.</p>
      </section>

      <section className="desktop-panel wide pricing-panel">
        <div className="desktop-panel-heading">
          <div>
            <p className="eyebrow">Plans</p>
            <h2>Pricing placeholder</h2>
          </div>
        </div>
        <p className="test-mode-note">Payments are not live yet. Mega Pro is currently available in test mode only.</p>
        <div className="plan-comparison">
          <article className="plan-card">
            <span>Core</span>
            <strong>Free forever</strong>
            <ul>
              <li>Full local editor</li>
              <li>No watermarks</li>
              <li>No export paywalls</li>
              <li>No locked basic editing tools</li>
            </ul>
          </article>
          <article className="plan-card highlighted">
            <span>Mega Pro</span>
            <strong>$9.99/month</strong>
            <ul>
              <li>$69.99/year</li>
              <li>$249.99 lifetime</li>
              <li>Launch trial: 30 days free</li>
              <li>Standard trial later: 14 days free</li>
              <li>Future AI tools, AI credits, cloud/project sync, and early access</li>
            </ul>
          </article>
        </div>
      </section>

      <section className="desktop-panel">
        <div className="desktop-panel-heading">
          <div>
            <p className="eyebrow">Appearance</p>
            <h2>Dark mode</h2>
          </div>
        </div>
        <button className="setting-toggle" type="button" onClick={() => onPlaceholderAction('Dark Mode Toggle')}>
          <span>Dark mode placeholder</span>
          <strong>On</strong>
        </button>
      </section>

      <section className="desktop-panel">
        <div className="desktop-panel-heading">
          <div>
            <p className="eyebrow">Exports</p>
            <h2>Quality options</h2>
          </div>
        </div>
        <div className="settings-options">
          <button type="button" onClick={() => onPlaceholderAction('720p Export')}>
            720p Fast Draft
          </button>
          <button type="button" onClick={() => onPlaceholderAction('1080p Export')}>
            1080p YouTube
          </button>
          <button type="button" onClick={() => onPlaceholderAction('4K Export')}>
            4K Local Draft
          </button>
        </div>
      </section>

      <section className="desktop-panel wide">
        <div className="desktop-panel-heading">
          <div>
            <p className="eyebrow">Account</p>
            <h2>Account section placeholder</h2>
          </div>
          <button className="button secondary" type="button" onClick={() => onPlaceholderAction('Account Setup')}>
            Connect Later
          </button>
        </div>
        <p>
          Supabase Auth, account sync, and real Mega Pro billing are intentionally not connected in this desktop build yet.
        </p>
      </section>
    </div>
  )
}

export default App
