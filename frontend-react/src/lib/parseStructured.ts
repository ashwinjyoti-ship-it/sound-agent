import type { StructuredData } from '@/types'

export function tryParseStructured(text: string): StructuredData | null {
  const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/g)]
  if (!matches.length) return null
  const last = matches[matches.length - 1][1].trim()
  try {
    const data = JSON.parse(last) as StructuredData
    if (data && typeof data === 'object' && 'type' in data) return data
    return null
  } catch {
    return null
  }
}
