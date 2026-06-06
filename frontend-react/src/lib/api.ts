import type { Message, ActiveTask } from '@/types'

const API_BASE = 'https://sound-agent-api.onrender.com'

export async function sendChat(
  messages: Message[],
  activeTask: ActiveTask | null
): Promise<{ reply: string; taskDone?: boolean }> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, activeTask }),
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export async function transcribeAudio(blob: Blob): Promise<{ text: string }> {
  const form = new FormData()
  form.append('audio', blob, 'recording.webm')
  const res = await fetch(`${API_BASE}/api/transcribe`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`Transcribe error ${res.status}`)
  return res.json()
}
