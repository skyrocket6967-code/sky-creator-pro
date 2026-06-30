import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const installerPath = path.join(root, 'release', 'SkyCreatorProSetup.exe')
const bucketName = 'downloads'
const storagePath = 'sky-creator-pro-setup.exe'

function readLocalEnv() {
  const envPath = path.join(root, '.env.local')

  if (!existsSync(envPath)) {
    return
  }

  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const separatorIndex = trimmed.indexOf('=')

    if (separatorIndex === -1) {
      continue
    }

    const key = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, '')

    if (!process.env[key]) {
      process.env[key] = value
    }
  }
}

readLocalEnv()

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://vzddjujoqrrwkezrbhfw.supabase.co'
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!serviceRoleKey) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY. Add it to .env.local or set it only for this command.')
}

if (!existsSync(installerPath)) {
  throw new Error(`Installer not found at ${installerPath}. Run pnpm desktop:build first.`)
}

const fileSize = statSync(installerPath).size
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

console.log(`Uploading ${installerPath}`)
console.log(`Destination: ${bucketName}/${storagePath}`)
console.log(`Size: ${(fileSize / (1024 * 1024)).toFixed(1)} MB`)

const { error } = await supabase.storage.from(bucketName).upload(storagePath, readFileSync(installerPath), {
  contentType: 'application/octet-stream',
  upsert: true,
})

if (error) {
  throw error
}

console.log('Upload complete.')
console.log(`${supabaseUrl}/storage/v1/object/public/${bucketName}/${storagePath}?download=SkyCreatorProSetup.exe`)
