import { useEffect, useRef, useState } from "react";
import { Job } from "@/types/job";
import { GlassCard } from "./GlassCard";
import { ScoreRing } from "./ScoreRing";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Play } from "lucide-react";

interface DashboardProps {
  jobs: Job[];
  onGenerateForJob: (job: Job) => void;
}

function AnimatedCounter({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<number>();

  useEffect(() => {
    const start = performance.now();
    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / 900, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(eased * value));
      if (progress < 1) ref.current = requestAnimationFrame(animate);
    };
    ref.current = requestAnimationFrame(animate);
    return () => { if (ref.current) cancelAnimationFrame(ref.current); };
  }, [value]);

  return <span>{display}</span>;
}

export function Dashboard({ jobs, onGenerateForJob }: DashboardProps) {
  const scored = jobs.filter(j => j.score !== null);
  const kpis = [
    { label: "TOTAL JOBS", value: jobs.length },
    { label: "HIGH MATCHES", value: jobs.filter(j => (j.score ?? 0) >= 80).length },
    { label: "APPLIED", value: jobs.filter(j => j.status === "applied").length },
    { label: "AVG SCORE", value: scored.length ? Math.round(scored.reduce((a, j) => a + (j.score ?? 0), 0) / scored.length) : 0 },
  ];

  // Top matches: sort by score desc, take top 3 regardless of date. If fewer than 3 scored, fill with unscored
  const sortedByScore = [...jobs].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const topMatches = sortedByScore.slice(0, 3);

  const dist = [
    { range: "0–25", count: jobs.filter(j => j.score !== null && j.score <= 25).length, color: "#E11D48" },
    { range: "26–50", count: jobs.filter(j => j.score !== null && j.score > 25 && j.score <= 50).length, color: "#8B5CF6" },
    { range: "51–75", count: jobs.filter(j => j.score !== null && j.score > 50 && j.score <= 75).length, color: "#3B82F6" },
    { range: "76–100", count: jobs.filter(j => j.score !== null && j.score > 75).length, color: "#10B981" },
  ];

  const statusColor = (s: string) => {
    const map: Record<string, string> = { new: "#6B7280", scored: "#06B6D4", selected: "#3B82F6", applied: "#10B981", rejected: "#E11D48" };
    return map[s] || "#6B7280";
  };

  return (
    <div className="animate-fade-up space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-4">
        {kpis.map(k => (
          <GlassCard key={k.label} className="p-5 relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: "linear-gradient(to bottom, #8B5CF6, #E11D48)" }} />
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{k.label}</p>
            <p className="font-display font-bold text-[40px] text-foreground mt-1 leading-none">
              <AnimatedCounter value={k.value} />
            </p>
            <div className="mt-3 h-px w-full" style={{ background: "linear-gradient(to right, #8B5CF6, #3B82F6)", animation: "pulse-line 2.5s ease-in-out infinite" }} />
          </GlassCard>
        ))}
      </div>

      {/* Today's Top Matches */}
      {topMatches.length > 0 ? (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-3">TOP MATCHES</p>
          <div className="grid grid-cols-3 gap-4">
            {topMatches.map(job => (
              <GlassCard key={job.id} className="p-5 flex flex-col">
                <div className="flex justify-between items-start">
                  <div className="h-11 w-11 rounded-full flex items-center justify-center font-mono font-bold text-sm text-foreground shrink-0" style={{ background: "linear-gradient(135deg, #8B5CF6, #3B82F6)" }}>
                    {job.company.slice(0, 2).toUpperCase()}
                  </div>
                  <ScoreRing score={job.score} size={72} />
                </div>
                <p className="font-display font-semibold text-sm text-foreground mt-3 line-clamp-2">{job.title}</p>
                <p className="font-mono text-[11px] text-muted-foreground mt-1">{job.company} · {job.location}</p>
                <span className="mt-2 inline-block font-mono text-[10px] px-2 py-0.5 rounded-full" style={{ color: statusColor(job.status), background: statusColor(job.status) + "26" }}>
                  {job.status}
                </span>
                <button
                  onClick={() => onGenerateForJob(job)}
                  className="mt-auto pt-4 w-full py-2 rounded-md font-display font-semibold text-[11px] uppercase text-foreground transition-all duration-150 hover:scale-[1.02]"
                  style={{ background: "linear-gradient(135deg, #8B5CF6, #3B82F6)", boxShadow: "0 0 20px rgba(139,92,246,0.35)" }}
                >
                  Generate Application →
                </button>
              </GlassCard>
            ))}
          </div>
        </div>
      ) : jobs.length === 0 ? (
        <GlassCard className="p-8 text-center" hover={false}>
          <p className="font-display font-semibold text-foreground mb-2">No jobs yet</p>
          <p className="font-mono text-[11px] text-muted-foreground mb-4">Click SCRAPE in the sidebar to discover opportunities</p>
          <div className="flex items-center justify-center gap-2">
            <Play className="h-4 w-4 text-jarvis-crimson" />
            <span className="font-mono text-[11px] text-jarvis-crimson animate-pulse">Use the scraper to get started</span>
          </div>
        </GlassCard>
      ) : null}

      {/* Score Distribution — always show */}
      <GlassCard className="p-5" hover={false}>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-4">SCORE DISTRIBUTION</p>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={dist}>
            <XAxis dataKey="range" tick={{ fill: "#6B7280", fontSize: 11, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "#6B7280", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: "rgba(13,13,26,0.9)", border: "1px solid rgba(139,92,246,0.2)", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 11, color: "#F1F0FF" }} />
            <Bar dataKey="count" radius={[4, 4, 0, 0]} animationDuration={1000}>
              {dist.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </GlassCard>
    </div>
  );
}
