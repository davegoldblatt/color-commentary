"use client";

function StatBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white/5 rounded-lg p-4 flex-1 min-w-[160px]">
      <div className="flex justify-between items-baseline mb-2">
        <span className="text-xs font-bold tracking-widest text-white/50 uppercase">{label}</span>
        <span className="text-2xl font-bold font-mono" style={{ color }}>
          {value}
        </span>
      </div>
      <div className="h-2 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{ width: `${value}%`, background: color }}
        />
      </div>
    </div>
  );
}

export function StatsPanel({
  engagement,
  skepticism,
  momentum,
}: {
  engagement: number;
  skepticism: number;
  momentum: "rising" | "falling" | "steady";
}) {
  const momentumConfig = {
    rising: { label: "RISING", icon: "▲", color: "#00ff88" },
    falling: { label: "FALLING", icon: "▼", color: "#ff4444" },
    steady: { label: "STEADY", icon: "▶", color: "#ffaa00" },
  };

  const m = momentumConfig[momentum];

  return (
    <div className="flex gap-3 flex-wrap">
      <StatBar label="Engagement" value={engagement} color="#00d4ff" />
      <StatBar label="Skepticism" value={skepticism} color="#ff0080" />
      <div className="bg-white/5 rounded-lg p-4 flex-1 min-w-[160px]">
        <div className="text-xs font-bold tracking-widest text-white/50 uppercase mb-2">
          Momentum
        </div>
        <div className="flex items-center gap-2">
          <span className="text-3xl" style={{ color: m.color }}>
            {m.icon}
          </span>
          <span className="text-xl font-bold font-mono" style={{ color: m.color }}>
            {m.label}
          </span>
        </div>
      </div>
    </div>
  );
}
