import { stripMarkdown } from '@/lib/formatters'
import { tryParseStructured } from '@/lib/parseStructured'
import { QuoteCard } from './structured/QuoteCard'
import { ShowList } from './structured/ShowList'
import { CrewPicker } from './structured/CrewPicker'
import type { Show } from '@/types'

interface Props {
  content: string
  animationDelay?: number
  onSend?: (text: string) => void
  onDeleteRequest?: (show: Show) => void
  showDelete?: boolean
}

export function EddyMessage({ content, animationDelay = 0, onSend, onDeleteRequest, showDelete }: Props) {
  const structured = tryParseStructured(content)
  const plainText = content.replace(/```json[\s\S]*?```/g, '').trim()

  function renderStructured() {
    if (!structured) return null
    switch (structured.type) {
      case 'quote':
        return <QuoteCard {...structured} />
      case 'shows':
        return (
          <ShowList
            shows={structured.shows}
            showDelete={showDelete}
            onDeleteRequest={onDeleteRequest}
          />
        )
      case 'crew_availability':
        return (
          <CrewPicker
            date={structured.date}
            available={structured.available}
            assigned={structured.assigned}
            unavailable={structured.unavailable}
            conflicts={structured.conflicts}
            shows={[]}
            onAssign={onSend ?? (() => {})}
          />
        )
      case 'success':
        return (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700">
            <span className="text-lg">✓</span>
            <span>{structured.message}</span>
          </div>
        )
      default:
        return null
    }
  }

  const structuredEl = renderStructured()

  return (
    <div
      className="flex items-end gap-2 px-3 py-1 animate-slide-up"
      style={{ animationDelay: `${animationDelay}ms`, opacity: 0 }}
    >
      {/* Mascot avatar */}
      <img
        src="/images/mascot.png"
        alt="Eddy"
        className="w-10 h-10 object-contain shrink-0 self-end"
      />
      <div className="max-w-[80%] flex flex-col gap-2">
        {/* Text bubble (if there's plain text alongside or instead of structured) */}
        {plainText && (
          <div className="relative bg-slate-200/90 backdrop-blur-sm text-[#1a1a1a] rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm border border-slate-300/50 text-sm leading-relaxed whitespace-pre-wrap bubble-tail-left">
            {stripMarkdown(plainText)}
          </div>
        )}
        {/* Structured card */}
        {structuredEl}
      </div>
    </div>
  )
}
