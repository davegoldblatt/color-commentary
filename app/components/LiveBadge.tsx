"use client";

import { useEffect, useState } from "react";

export function LiveBadge({ startTime }: { startTime: number | null }) {
  const [elapsed, setElapsed] = useState("00:00");

  useEffect(() => {
    if (!startTime) return;
    const interval = setInterval(() => {
      const diff = Math.floor((Date.now() - startTime) / 1000);
      const mins = Math.floor(diff / 60).toString().padStart(2, "0");
      const secs = (diff % 60).toString().padStart(2, "0");
      setElapsed(`${mins}:${secs}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2 bg-red-600 px-3 py-1 rounded text-sm font-bold tracking-wider">
        <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
        LIVE
      </div>
      <span className="text-white/60 font-mono text-sm">{elapsed}</span>
    </div>
  );
}
