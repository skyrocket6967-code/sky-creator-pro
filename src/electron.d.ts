export {}

declare global {
  interface Window {
    skyCreatorPro?: {
      desktop: boolean
      platform: string
      version: string
      cloudProjects?: {
        getConfigStatus: () => Promise<{
          cloudProjectsUrl: string
          installId: string
          configured: boolean
        }>
        saveConfig: (config: { cloudProjectsUrl: string; installId?: string }) => Promise<{
          cloudProjectsUrl: string
          installId: string
          configured: boolean
        }>
        saveProject: (project: unknown) => Promise<{
          ok: boolean
          message: string
          key?: string
          project?: unknown
        }>
        listProjects: () => Promise<{
          ok: boolean
          message?: string
          projects: Array<{
            key: string
            name: string
            size?: number
            uploaded?: string
          }>
        }>
        loadProject: (key: string) => Promise<{
          ok: boolean
          message?: string
          project?: unknown
        }>
      }
    }
  }
}
