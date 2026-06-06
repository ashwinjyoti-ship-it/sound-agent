import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { fmtDate } from '@/lib/formatters'
import type { Show } from '@/types'

interface AssignedCrew { name: string; show: string }

interface Props {
  date: string
  available: string[]
  assigned: AssignedCrew[]
  unavailable: string[]
  conflicts: string[]
  shows: Show[]
  onAssign: (msg: string) => void
}

export function CrewPicker({ date, available, assigned, unavailable, conflicts, shows, onAssign }: Props) {
  const [selectedShow, setSelectedShow] = useState<number>(0)
  const [foh, setFoh] = useState<string>('')
  const [stage, setStage] = useState<string[]>([])

  const show = shows[selectedShow]

  const assignedNames = assigned.map(a => a.name)
  const unavailableNames = [...unavailable, ...conflicts]
  const stagePool = available.filter(n => n !== foh)

  function toggleStage(name: string) {
    setStage(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name])
  }

  function handleAssign() {
    if (!show) return
    const fohStr = foh || 'TBD'
    const stageStr = stage.length ? stage.join(', ') : 'TBD'
    const showId = show.id ? `#${show.id}` : show.program
    onAssign(`Assign crew for show ${showId} on ${date}: FOH=${fohStr}, Stage=${stageStr}`)
  }

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-xl border border-black/10 shadow overflow-hidden max-w-sm w-full">
      <div className="bg-[#E8944A]/90 px-4 py-2">
        <p className="text-white font-semibold text-sm">Crew for {fmtDate(date)}</p>
      </div>
      <div className="px-4 py-3 space-y-3">
        {/* Show selector */}
        {shows.length > 1 && (
          <div>
            <p className="text-[#82857E] text-xs mb-1 uppercase tracking-wider">Show</p>
            <div className="flex flex-col gap-1">
              {shows.map((s, i) => (
                <label key={i} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="crew-show"
                    checked={selectedShow === i}
                    onChange={() => setSelectedShow(i)}
                    className="accent-[#E8944A]"
                  />
                  <span className="text-xs">{s.program} — {s.venue}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* FOH */}
        <div>
          <p className="text-[#82857E] text-xs mb-1.5 uppercase tracking-wider">FOH Engineer</p>
          <div className="flex flex-wrap gap-1.5">
            {['None/TBD', ...available].map(name => (
              <button
                key={name}
                onClick={() => { setFoh(name === 'None/TBD' ? '' : name); setStage(prev => prev.filter(n => n !== name)) }}
                className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                  (name === 'None/TBD' && !foh) || foh === name
                    ? 'bg-[#E8944A] text-white border-[#E8944A]'
                    : 'bg-white text-[#1a1a1a] border-black/20 hover:border-[#E8944A]'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        {/* Stage */}
        <div>
          <p className="text-[#82857E] text-xs mb-1.5 uppercase tracking-wider">Stage Crew</p>
          <div className="flex flex-wrap gap-1.5">
            {stagePool.map(name => (
              <button
                key={name}
                onClick={() => toggleStage(name)}
                className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                  stage.includes(name)
                    ? 'bg-[#2A1F14] text-white border-[#2A1F14]'
                    : 'bg-white text-[#1a1a1a] border-black/20 hover:border-[#2A1F14]'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        {/* Exclusions */}
        {(assignedNames.length > 0 || unavailableNames.length > 0) && (
          <div>
            <p className="text-[#82857E] text-xs mb-1 uppercase tracking-wider">Unavailable</p>
            <div className="flex flex-wrap gap-1.5">
              {assigned.map(a => (
                <span key={a.name} className="px-2.5 py-1 rounded-full text-xs bg-amber-100 text-amber-700 border border-amber-200" title={`On: ${a.show}`}>
                  🔒 {a.name}
                </span>
              ))}
              {unavailableNames.map(name => (
                <span key={name} className="px-2.5 py-1 rounded-full text-xs bg-red-100 text-red-600 border border-red-200">
                  ✕ {name}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button size="sm" className="flex-1 text-xs" onClick={handleAssign}>
            Assign Crew
          </Button>
          <Button size="sm" variant="secondary" className="text-xs" onClick={() => onAssign('Skip crew assignment')}>
            Skip
          </Button>
        </div>
      </div>
    </div>
  )
}
