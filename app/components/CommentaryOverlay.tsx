"use client";

import { useEffect, useRef, useState } from "react";

export function CommentaryOverlay({ text }: { text: string }) {
  const [displayed, setDisplayed] = useState("");
  const prevTextRef = useRef("");

  useEffect(() => {
    if (!text || text === prevTextRef.current) return;
    prevTextRef.current = text;
    setDisplayed("");

    let i = 0;
    const interval = setInterval(() => {
      i++;
      if (i <= text.length) {
        setDisplayed(text.slice(0, i));
      } else {
        clearInterval(interval);
      }
    }, 25);

    return () => clearInterval(interval);
  }, [text]);

  if (!text) return null;

  return (
    <div className="absolute bottom-0 left-0 right-0 bg-black/80 backdrop-blur-sm border-l-4 border-[#00d4ff] p-4">
      <p className="text-white text-lg font-medium leading-relaxed">
        {displayed}
        <span className="inline-block w-0.5 h-5 bg-[#00d4ff] ml-1 animate-pulse align-middle" />
      </p>
    </div>
  );
}
