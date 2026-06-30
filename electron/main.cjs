const { app, BrowserWindow, ipcMain, shell } = require('electron')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const isDev = !app.isPackaged && Boolean(process.env.VITE_DEV_SERVER_URL)
let mainWindow
const defaultCloudProjectsUrl =
  process.env.SKY_CREATOR_PRO_CLOUD_PROJECTS_URL || 'https://sky-creator-pro-cloud-projects.jolly-base-648f.workers.dev'

function r2ConfigPath() {
  return path.join(app.getPath('userData'), 'r2-cloud-projects.json')
}

async function readR2Config() {
  try {
    const rawConfig = await fs.readFile(r2ConfigPath(), 'utf8')
    const savedConfig = JSON.parse(rawConfig)
    return {
      cloudProjectsUrl: savedConfig.cloudProjectsUrl || defaultCloudProjectsUrl,
      installId: savedConfig.installId || randomUUID(),
    }
  } catch {
    return {
      cloudProjectsUrl: defaultCloudProjectsUrl,
      installId: randomUUID(),
    }
  }
}

async function writeR2Config(config) {
  const currentConfig = await readR2Config()
  const nextConfig = {
    cloudProjectsUrl: (config.cloudProjectsUrl || currentConfig.cloudProjectsUrl || defaultCloudProjectsUrl).replace(/\/$/, ''),
    installId: config.installId || currentConfig.installId || randomUUID(),
  }

  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(r2ConfigPath(), JSON.stringify(nextConfig, null, 2), 'utf8')
  return {
    cloudProjectsUrl: nextConfig.cloudProjectsUrl,
    installId: nextConfig.installId,
    configured: Boolean(nextConfig.cloudProjectsUrl),
  }
}

function projectIdFromKey(key) {
  return String(key || '')
    .split('/')
    .pop()
    ?.replace(/\.json$/, '')
}

async function cloudProjectsRequest({ method, path: requestPath = '/projects', body }) {
  const config = await readR2Config()

  if (!config.cloudProjectsUrl) {
    return {
      ok: false,
      status: 401,
      message: 'Cloud storage is not configured yet.',
    }
  }

  const response = await fetch(`${config.cloudProjectsUrl}${requestPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-scp-install-id': config.installId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const contentType = response.headers.get('content-type') || ''
  const payload = contentType.includes('application/json') ? await response.json() : await response.text()

  if (!response.ok || payload?.ok === false) {
    return {
      ok: false,
      status: response.status,
      message: payload?.message || 'Cloud project request failed.',
      payload,
    }
  }

  return { ok: true, status: response.status, payload }
}

function registerR2ProjectHandlers() {
  ipcMain.handle('r2:get-config-status', async () => {
    const config = await readR2Config()
    await writeR2Config(config)

    return {
      cloudProjectsUrl: config.cloudProjectsUrl,
      installId: config.installId,
      configured: Boolean(config.cloudProjectsUrl),
    }
  })

  ipcMain.handle('r2:save-config', async (_event, config) => writeR2Config(config || {}))

  ipcMain.handle('r2:save-project', async (_event, project) => {
    if (!project?.id) {
      return { ok: false, message: 'Project is missing an id.' }
    }

    const body = {
      ...project,
      savedAt: new Date().toISOString(),
      app: 'Sky Creator Pro',
    }
    const result = await cloudProjectsRequest({
      method: 'POST',
      path: '/projects',
      body,
    })

    return result.ok
      ? { ok: true, message: `Saved "${project.title}" to cloud storage.`, key: result.payload.key, project: result.payload.project }
      : { ok: false, message: result.message }
  })

  ipcMain.handle('r2:list-projects', async () => {
    const result = await cloudProjectsRequest({ method: 'GET' })

    if (!result.ok) {
      return { ok: false, message: result.message, projects: [] }
    }

    const objects = result.payload?.projects || []
    return {
      ok: true,
      projects: objects,
    }
  })

  ipcMain.handle('r2:load-project', async (_event, key) => {
    if (!key) {
      return { ok: false, message: 'Choose a cloud project to load.' }
    }

    const projectId = projectIdFromKey(key)
    const result = await cloudProjectsRequest({ method: 'GET', path: `/projects/${projectId}` })

    if (!result.ok) {
      return { ok: false, message: result.message }
    }

    return {
      ok: true,
      project: result.payload?.project || result.payload,
    }
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'Sky Creator Pro',
    autoHideMenuBar: true,
    backgroundColor: '#0f0f12',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: false,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    console.error(`Sky Creator Pro failed to load ${validatedUrl}: ${errorCode} ${errorDescription}`)
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`Sky Creator Pro renderer stopped: ${details.reason}`)
  })

  mainWindow.on('closed', () => {
    mainWindow = undefined
  })

  if (isDev) {
    mainWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}/#/dashboard`)
    return
  }

  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), {
    hash: '/dashboard',
  })
}

app.whenReady().then(() => {
  registerR2ProjectHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
