import { useState } from 'react'
import { ChatHeader } from '@/components/ChatHeader'
import { ChatMessages } from '@/components/ChatMessages'
import { ChatInput } from '@/components/ChatInput'
import { useMessages } from '@/hooks/useMessages'
import { useViewportHeight } from '@/hooks/useViewportHeight'
import { sendChat } from '@/lib/api'
import type { ActiveTask, SlashCommand, Show } from '@/types'

const GREETING = "Hey. What do you need?"

export default function App() {
  const { messages, addMessage, clearMessages } = useMessages()
  const [isLoading, setIsLoading] = useState(false)
  const [activeTask, setActiveTask] = useState<ActiveTask | null>(null)
  const [inputValue, setInputValue] = useState('')

  useViewportHeight()

  const seedMsg = { role: 'assistant' as const, content: GREETING, timestamp: Date.now() }
  const displayMessages = messages.length === 0 ? [seedMsg] : messages

  async function handleSend(text: string) {
    if (!text.trim() || isLoading) return

    if (text.trim() === '/clear') {
      clearMessages()
      setInputValue('')
      setActiveTask(null)
      return
    }

    setInputValue('')
    const userMsg = { role: 'user' as const, content: text, timestamp: Date.now() }
    addMessage(userMsg)
    setIsLoading(true)

    try {
      const history = messages.length === 0 ? [seedMsg, userMsg] : [...messages, userMsg]
      const result = await sendChat(history, activeTask)
      addMessage({ role: 'assistant', content: result.reply, timestamp: Date.now() })
      if (result.taskDone) setActiveTask(null)
    } catch {
      addMessage({ role: 'assistant', content: "Something went wrong. Try again.", timestamp: Date.now() })
    } finally {
      setIsLoading(false)
    }
  }

  function handleSlashSelect(cmd: SlashCommand) {
    if (cmd.taskType === 'clear') {
      clearMessages()
      setInputValue('')
      setActiveTask(null)
      return
    }
    setActiveTask({ type: cmd.taskType, prefix: cmd.prefix })
    setInputValue(cmd.prefix)
  }

  function handleDeleteRequest(show: Show) {
    const id = show.id ? `#${show.id}` : show.program
    handleSend(`Delete show ${id} on ${show.event_date}`)
  }

  const lastUserMsg = [...displayMessages].reverse().find(m => m.role === 'user')?.content

  return (
    <div
      className="flex flex-col bg-eddy-cream overflow-hidden"
      style={{ height: 'var(--app-height, 100dvh)' }}
    >
      <ChatHeader />
      <ChatMessages
        messages={displayMessages}
        isLoading={isLoading}
        onSend={handleSend}
        onDeleteRequest={handleDeleteRequest}
        lastUserMessage={lastUserMsg}
      />
      <ChatInput
        value={inputValue}
        onChange={setInputValue}
        onSend={handleSend}
        onSlashSelect={handleSlashSelect}
        disabled={isLoading}
      />
    </div>
  )
}
