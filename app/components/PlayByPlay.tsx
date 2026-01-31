"use client";

export interface PlayEvent {
  time: string;
  text: string;
  type: "positive" | "negative" | "neutral";
}

const typeColors = {
  positive: "text-green-400",
  negative: "text-red-400",
  neutral: "text-white/60",
};

const typeDots = {
  positive: "bg-green-400",
  negative: "bg-red-400",
  neutral: "bg-white/40",
};

export function PlayByPlay({ events }: { events: PlayEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="bg-white/5 rounded-lg p-4">
        <div className="text-xs font-bold tracking-widest text-white/50 uppercase mb-3">
          Play-by-Play
        </div>
        <p className="text-white/30 text-sm italic">Waiting for notable moments...</p>
      </div>
    );
  }

  return (
    <div className="bg-white/5 rounded-lg p-4">
      <div className="text-xs font-bold tracking-widest text-white/50 uppercase mb-3">
        Play-by-Play
      </div>
      <div className="space-y-2 max-h-[180px] overflow-y-auto">
        {events.map((event, i) => (
          <div key={i} className="flex items-start gap-3 text-sm">
            <span className="text-white/40 font-mono text-xs mt-0.5 shrink-0">{event.time}</span>
            <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${typeDots[event.type]}`} />
            <span className={typeColors[event.type]}>{event.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
