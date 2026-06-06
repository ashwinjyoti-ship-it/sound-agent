export function ChatHeader() {
  return (
    <header className="relative flex items-center px-4 py-3 bg-[#2A1F14] border-b-4 border-[#E8944A] overflow-hidden shrink-0">
      {/* Vertical stripe overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Crect x='3' y='0' width='1' height='8' fill='rgba(255,255,255,0.04)'/%3E%3C/svg%3E\")",
          backgroundSize: '8px 8px',
        }}
      />
      {/* Title */}
      <div className="flex flex-col z-10">
        <h1 className="font-lora text-2xl leading-tight">
          <span className="text-white font-normal">Ask </span>
          <span className="text-[#E8944A] font-bold italic">Eddy</span>
        </h1>
        <p className="text-white/60 text-xs tracking-wide font-lora">NCPA Sound Department</p>
      </div>
      {/* Mascot */}
      <img
        src="/images/mascot.png"
        alt="Eddy mascot"
        className="absolute right-2 bottom-0 h-20 w-auto object-contain z-10 drop-shadow-lg"
      />
    </header>
  )
}
