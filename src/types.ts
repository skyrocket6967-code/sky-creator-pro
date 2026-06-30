export type RouteKey = 'home' | 'dashboard' | 'thumbnail' | 'video' | 'pricing' | 'projects' | 'export' | 'settings'

export type ProjectStatus = 'Planning' | 'Editing' | 'Ready to publish'

export type CreatorProject = {
  id: number
  title: string
  platform: string
  dueDate: string
  status: ProjectStatus
  progress: number
  nextAction: string
  thumbnailState: string
  videoState: string
}

export type Metric = {
  label: string
  value: string
  detail: string
  tone: 'teal' | 'rose' | 'amber' | 'blue'
}

export type PricingPlan = {
  name: string
  price: string
  cadence: string
  description: string
  features: string[]
  featured?: boolean
}
