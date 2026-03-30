interface ScoreRingProps {
  score: number | null;
  size?: number;
  strokeWidth?: number;
}

export function ScoreRing({ score, size = 60, strokeWidth = 5 }: ScoreRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = score !== null ? circumference * (1 - score / 100) : circumference;
  const color = score === null ? "#6B7280" : score >= 80 ? "#10B981" : score >= 50 ? "#F59E0B" : "#E11D48";

  return (
    <svg width={size} height={size} className="shrink-0">
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeDasharray={circumference} strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="transition-all duration-1000"
      />
      <text
        x="50%" y="50%" dominantBaseline="central" textAnchor="middle"
        fill={color} className="font-mono font-bold"
        style={{ fontSize: size * 0.26 }}
      >
        {score !== null ? score : "—"}
      </text>
    </svg>
  );
}
