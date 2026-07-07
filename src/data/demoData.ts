import type { CreatorProject, Metric, PricingPlan } from '../types'

export const metrics: Metric[] = [
  {
    label: 'Active projects',
    value: '8',
    detail: '3 ready this week',
    tone: 'teal',
  },
  {
    label: 'Videos in edit',
    value: '5',
    detail: '2 need final review',
    tone: 'blue',
  },
  {
    label: 'Thumbnails queued',
    value: '12',
    detail: '4 A/B ideas saved',
    tone: 'amber',
  },
  {
    label: 'Publish tasks',
    value: '6',
    detail: 'Titles, tags, and captions',
    tone: 'rose',
  },
]

export const projects: CreatorProject[] = [
  {
    id: 1,
    title: 'Budget desk setup for new creators',
    platform: 'YouTube',
    dueDate: 'Today',
    status: 'Editing',
    progress: 68,
    nextAction: 'Tighten intro and add lower thirds',
    thumbnailState: 'Two concepts drafted',
    videoState: 'Rough cut complete',
  },
  {
    id: 2,
    title: 'How I batch record a month of shorts',
    platform: 'Shorts',
    dueDate: 'Tomorrow',
    status: 'Planning',
    progress: 34,
    nextAction: 'Finalize hook list',
    thumbnailState: 'Not needed',
    videoState: 'Script outline ready',
  },
  {
    id: 3,
    title: 'Creator gear I stopped buying',
    platform: 'YouTube',
    dueDate: 'Friday',
    status: 'Ready to publish',
    progress: 94,
    nextAction: 'Schedule publish and pin comment',
    thumbnailState: 'Approved',
    videoState: 'Final export ready',
  },
  {
    id: 4,
    title: 'Thumbnail color tests for low-light videos',
    platform: 'YouTube',
    dueDate: 'Next week',
    status: 'Planning',
    progress: 22,
    nextAction: 'Pick three title angles',
    thumbnailState: 'Mood board started',
    videoState: 'Footage imported',
  },
]

export const workflowSteps = [
  'Capture idea',
  'Draft title and hook',
  'Edit video',
  'Design thumbnail',
  'Publish checklist',
]

export const thumbnailStyles = [
  'Face close-up',
  'Bold text',
  'Before and after',
  'Clean product shot',
]

export const timelineClips = [
  { label: 'Hook', width: '18%' },
  { label: 'Setup', width: '25%' },
  { label: 'Demo', width: '34%' },
  { label: 'CTA', width: '16%' },
]

export const pricingPlans: PricingPlan[] = [
  {
    name: 'Free',
    price: '$0',
    cadence: 'forever',
    description: 'Start organizing videos, thumbnails, and publishing tasks.',
    features: [
      '3 active creator projects',
      'Thumbnail draft workspace',
      'Video edit planning board',
      'Local demo data',
    ],
  },
  {
    name: 'Pro',
    price: '$12',
    cadence: 'per month',
    description: 'A planned upgrade for creators managing a repeatable workflow.',
    featured: true,
    features: [
      'Unlimited creator projects',
      'Advanced thumbnail and video workspaces',
      'Content workflow templates',
      'Future Supabase account and storage support',
    ],
  },
]
