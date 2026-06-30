export {}

declare global {
  interface Window {
    SKY_CREATOR_PRO_CONFIG?: {
      SUPABASE_URL?: string
      SUPABASE_PUBLISHABLE_KEY?: string
      SUPABASE_ANON_KEY?: string
    }
  }
}
