import { useEffect, useRef } from 'react'
import { UserMessage } from './UserMessage'
import { EddyMessage } from './EddyMessage'
import { LoadingMessage } from './LoadingMessage'
import type { Message, Show } from '@/types'

interface Props {
  messages: Message[]
  isLoading: boolean
  onSend: (text: string) => void
  onDeleteRequest: (show: Show) => void
  lastUserMessage?: string
}

export function ChatMessages({ messages, isLoading, onSend, onDeleteRequest, lastUserMessage }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  const deleteRegex = /\bdelete\b|\bremove\b|\bcancel\b/i
  const showDelete = lastUserMessage ? deleteRegex.test(lastUserMessage) : false

  return (
    <div className="flex-1 overflow-y-auto py-4 space-y-1">
      {messages.map((msg, i) =>
        msg.role === 'user' ? (
          <UserMessage key={i} content={msg.content} animationDelay={0} />
        ) : (
          <EddyMessage
            key={i}
            content={msg.content}
            animationDelay={0}
            onSend={onSend}
            onDeleteRequest={onDeleteRequest}
            showDelete={showDelete && i === messages.length - 1}
          />
        )
      )}
      {isLoading && <LoadingMessage />}
      <div ref={bottomRef} />
    </div>
  )
}
