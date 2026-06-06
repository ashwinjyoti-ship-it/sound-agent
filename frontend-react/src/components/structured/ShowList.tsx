import { Button } from '@/components/ui/button'
import { fmtDate, fmtTime24 } from '@/lib/formatters'
import type { Show } from '@/types'

interface Props {
  shows: Show[]
  showDelete?: boolean
  onDeleteRequest?: (show: Show) => void
}

export function ShowList({ shows, showDelete, onDeleteRequest }: Props) {
  if (!shows.length) return <p className="text-sm text-[#82857E] italic">No shows found.</p>

  return (
    <div className="flex flex-col gap-2 max-w-sm w-full">
      {shows.map((show, i) => (
        <div key={i} className="bg-white/80 backdrop-blur-sm rounded-xl border border-black/10 shadow overflow-hidden">
          <div className="bg-[#E8944A]/90 px-4 py-2 flex items-center justify-between">
            <span className="text-white font-semibold text-sm leading-tight">{show.program}</span>
            <span className="text-white/80 text-xs">{fmtDate(show.event_date)}</span>
          </div>
          <div className="px-4 py-3 space-y-1 text-xs text-[#1a1a1a]">
            {show.venue && (
              <div className="flex gap-2">
                <span className="text-[#82857E] w-16 shrink-0">Venue</span>
                <span>{show.venue}</span>
              </div>
            )}
            {show.call_time && (
              <div className="flex gap-2">
                <span className="text-[#82857E] w-16 shrink-0">Call Time</span>
                <span>{fmtTime24(show.call_time)}</span>
              </div>
            )}
            {show.foh_crew && (
              <div className="flex gap-2">
                <span className="text-[#82857E] w-16 shrink-0">FOH</span>
                <span>{show.foh_crew}</span>
              </div>
            )}
            {show.stage_crew && (
              <div className="flex gap-2">
                <span className="text-[#82857E] w-16 shrink-0">Stage</span>
                <span>{show.stage_crew}</span>
              </div>
            )}
            {show.sound_requirements && (
              <div className="flex gap-2">
                <span className="text-[#82857E] w-16 shrink-0">SR</span>
                <span>{show.sound_requirements}</span>
              </div>
            )}
          </div>
          {showDelete && onDeleteRequest && (
            <div className="px-4 pb-3">
              <Button
                size="sm"
                variant="destructive"
                className="w-full text-xs"
                onClick={() => onDeleteRequest(show)}
              >
                Delete Show
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
