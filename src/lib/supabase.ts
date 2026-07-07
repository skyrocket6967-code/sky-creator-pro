import { createClient } from '@supabase/supabase-js'

const fallbackProjectUrl = 'https://vzddjujoqrrwkezrbhfw.supabase.co'
const runtimeConfig = typeof window === 'undefined' ? undefined : window.SKY_CREATOR_PRO_CONFIG

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || runtimeConfig?.SUPABASE_URL || fallbackProjectUrl
export const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY ||
  runtimeConfig?.SUPABASE_PUBLISHABLE_KEY ||
  runtimeConfig?.SUPABASE_ANON_KEY ||
  ''
export const installerFileName = 'sky-creator-pro-setup.exe'
export const installerPublicUrl = `${supabaseUrl}/storage/v1/object/public/downloads/${installerFileName}`
export const installerDownloadUrl = `${installerPublicUrl}?download=SkyCreatorProSetup.exe`
export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey)

export async function isInstallerUploaded() {
  try {
    const response = await fetch(installerPublicUrl, { method: 'HEAD' })
    return response.ok
  } catch {
    return false
  }
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey || 'missing-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
