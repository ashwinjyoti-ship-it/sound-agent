import type { SlashCommand } from '@/types'

interface Props {
  commands: SlashCommand[]
  onSelect: (cmd: SlashCommand) => void
  onClose: () => void
}

export function SlashMenu({ commands, onSelect, onClose }: Props) {
  if (!commands.length) return null

  return (
    <div
      role="listbox"
      aria-label="Slash commands"
      className="absolute bottom-full left-0 right-0 mb-2 bg-white/95 backdrop-blur-sm border border-black/10 rounded-xl shadow-lg overflow-hidden max-h-56 overflow-y-auto z-50"
    >
      {commands.map((cmd, i) => (
        <button
          key={i}
          role="option"
          aria-selected={false}
          className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[#F5EDE0] text-left transition-colors focus:bg-[#F5EDE0] focus:outline-none"
          onClick={() => { onSelect(cmd); onClose() }}
        >
          <span className="text-[#E8944A] font-mono text-sm font-semibold w-32 shrink-0">{cmd.cmd}</span>
          <span className="text-[#82857E] text-xs">{cmd.desc}</span>
        </button>
      ))}
    </div>
  )
}
