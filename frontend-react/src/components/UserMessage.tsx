import { stripMarkdown } from '@/lib/formatters'

interface Props {
  content: string
  animationDelay?: number
}

export function UserMessage({ content, animationDelay = 0 }: Props) {
  return (
    <div
      className="flex items-end justify-end gap-2 px-3 py-1 animate-slide-up"
      style={{ animationDelay: `${animationDelay}ms`, opacity: 0 }}
    >
      <div className="max-w-[75%] relative">
        {/* Bubble */}
        <div className="relative bg-[#D4C4B9]/95 backdrop-blur-sm text-[#1a1a1a] rounded-2xl rounded-br-sm px-4 py-3 shadow-sm border border-[#C4B4A9]/40 text-sm leading-relaxed bubble-tail-right">
          {stripMarkdown(content)}
        </div>
      </div>
      {/* You badge */}
      <div className="shrink-0 w-8 h-8 rounded-full bg-[#E8944A] flex items-center justify-center text-white text-xs font-bold shadow">
        You
      </div>
    </div>
  )
}
