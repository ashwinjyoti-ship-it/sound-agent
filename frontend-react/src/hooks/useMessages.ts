import { useState, useEffect, useCallback } from 'react'
import type { Message } from '@/types'

const STORAGE_KEY = 'eddy_msgs'
const MAX_MSGS = 40

function load(): Message[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Message[]) : []
  } catch {
    return []
  }
}

export function useMessages() {
  const [messages, setMessages] = useState<Message[]>(load)

  useEffect(() => {
    const toSave = messages.slice(-MAX_MSGS)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
  }, [messages])

  const addMessage = useCallback((msg: Message) => {
    setMessages(prev => [...prev, msg])
  }, [])

  const clearMessages = useCallback(() => {
    setMessages([])
  }, [])

  return { messages, setMessages, addMessage, clearMessages }
}
