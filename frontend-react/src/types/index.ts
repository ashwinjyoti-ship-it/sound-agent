export interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp?: number
}

export interface ActiveTask {
  type: string
  prefix: string
}

export interface SlashCommand {
  cmd: string
  desc: string
  prefix: string
  taskType: string
}

export interface QuoteItem {
  name: string
  qty: number
  rate: number
  total: number
}

export interface Show {
  id?: number
  event_date: string
  program: string
  venue: string
  call_time: string
  foh_crew: string
  stage_crew: string
  sound_requirements: string
}

export interface CrewAvailability {
  date: string
  available: string[]
  assigned: Array<{ name: string; show: string }>
  unavailable: string[]
  conflicts: string[]
}

export type StructuredData =
  | { type: 'quote'; items: QuoteItem[]; subtotal: number; gst: number; total: number }
  | { type: 'shows'; shows: Show[]; showDelete?: boolean }
  | { type: 'crew_availability'; date: string; available: string[]; assigned: Array<{ name: string; show: string }>; unavailable: string[]; conflicts: string[] }
  | { type: 'success'; message: string }
