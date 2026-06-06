import { useState, useRef, useEffect } from 'react'
import { Mic, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SlashMenu } from './SlashMenu'
import { SLASH_COMMANDS } from '@/constants/slashCommands'
import { useAudioRecorder } from '@/hooks/useAudioRecorder'
import type { SlashCommand } from '@/types'

interface Props {
  value: string
  onChange: (v: string) => void
  onSend: (text: string) => void
  onSlashSelect: (cmd: SlashCommand) => void
  disabled?: boolean
}

export function ChatInput({ value, onChange, onSend, onSlashSelect, disabled }: Props) {
  const [showSlash, setShowSlash] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const { isRecording, isTranscribing, toggleRecording } = useAudioRecorder({
    onTranscript: (text) => { onChange(text); inputRef.current?.focus() },
    onError: (msg) => { onChange(msg) },
  })

  const filteredCmds = value.startsWith('/')
    ? SLASH_COMMANDS.filter(c => c.cmd.startsWith(value.toLowerCase()))
    : []

  useEffect(() => {
    setShowSlash(value.startsWith('/') && filteredCmds.length > 0)
  }, [value, filteredCmds.length])

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
    if (e.key === 'Escape') setShowSlash(false)
  }

  function handleSend() {
    const text = value.trim()
    if (!text || disabled) return
    onSend(text)
  }

  return (
    <div className="relative shrink-0 px-3 py-3 bg-[#F5EDE0]/90 backdrop-blur-sm border-t border-black/10"
      style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
      {showSlash && (
        <SlashMenu
          commands={filteredCmds}
          onSelect={(cmd) => { onSlashSelect(cmd); onChange(cmd.prefix); setShowSlash(false); inputRef.current?.focus() }}
          onClose={() => setShowSlash(false)}
        />
      )}
      <div className="flex items-center gap-2">
        {/* Mic button */}
        <Button
          size="icon"
          variant="default"
          className={`rounded-full w-11 h-11 shrink-0 bg-[#E8944A] hover:bg-[#D4833A] active:scale-95 transition-transform ${isRecording ? 'animate-pulse' : ''}`}
          onClick={toggleRecording}
          aria-label={isRecording ? 'Stop recording' : 'Start voice input'}
          disabled={disabled}
        >
          <Mic className="w-5 h-5" />
        </Button>

        {/* Text input */}
        <div className="flex-1 relative">
          <Input
            ref={inputRef}
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isTranscribing ? 'Transcribing…' : isRecording ? 'Listening…' : 'Type or hold mic...'}
            disabled={disabled || isTranscribing}
            aria-label="Message input"
            aria-autocomplete="list"
            aria-controls="slash-menu"
            className="rounded-full bg-white/80 border-black/15 focus-visible:ring-[#E8944A] pr-3 text-sm"
          />
        </div>

        {/* Send button */}
        <Button
          size="icon"
          variant="secondary"
          className="rounded-full w-11 h-11 shrink-0 bg-[#C9C7C1] hover:bg-[#B5B3AD] hover:scale-105 active:scale-95 transition-transform"
          onClick={handleSend}
          disabled={!value.trim() || disabled}
          aria-label="Send message"
        >
          <ArrowRight className="w-5 h-5 text-[#1a1a1a]" />
        </Button>
      </div>
    </div>
  )
}
