'use client';

export function LandingSvgDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true">
      <defs>
        <linearGradient id="velaris-grad-1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00F2FE" />
          <stop offset="50%" stopColor="#4FACFE" />
          <stop offset="100%" stopColor="#6B11FF" />
        </linearGradient>
        <linearGradient id="velaris-grad-2" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#7F00FF" />
          <stop offset="100%" stopColor="#E100FF" />
        </linearGradient>
        <filter id="velaris-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="4" stdDeviation="8" floodColor="#4FACFE" floodOpacity="0.35" />
        </filter>
      </defs>
    </svg>
  );
}
