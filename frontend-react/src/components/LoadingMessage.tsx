export function LoadingMessage() {
  return (
    <div className="flex items-end gap-2 px-3 py-1">
      <img
        src="/images/mascot.png"
        alt="Eddy thinking"
        className="w-10 h-10 object-contain shrink-0 self-end animate-think-swirl"
      />
      <div className="bg-slate-200/90 backdrop-blur-sm rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm border border-slate-300/50 flex items-center gap-2">
        <span className="text-sm text-[#82857E] italic">On it…</span>
        <span className="flex gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#82857E] animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-[#82857E] animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-[#82857E] animate-bounce" style={{ animationDelay: '300ms' }} />
        </span>
      </div>
    </div>
  )
}
