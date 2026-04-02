import { useEffect, useRef, useState } from "react";
import { GlassCard } from "./GlassCard";
import { Download, Pencil, Check } from "lucide-react";
import { UserData } from "./ProfileDropdown";
import { Job } from "@/types/job";

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

interface ProfilePageProps {
  user: UserData;
  jobs: Job[];
}

function formatActivityLabel(job: Job): string {
  const statusLabel = job.status.replace(/_/g, " ");
  return `${job.title} · ${job.company} · ${statusLabel}`;
}

function getLatestJobTimestamp(job: Job): number {
  const eventTimes = (job.events ?? [])
    .map((event) => new Date(event.timestamp).getTime())
    .filter((time) => Number.isFinite(time));
  if (eventTimes.length > 0) {
    return Math.max(...eventTimes);
  }
  const scrapedAt = new Date(job.date_scraped).getTime();
  return Number.isFinite(scrapedAt) ? scrapedAt : 0;
}

function hasReachedInterviewOrOffer(job: Job): boolean {
  const events = job.events ?? [];
  return events.some((event) => event.type === "interviewing" || event.type === "offered") || job.status === "interviewing" || job.status === "offered";
}

function wasApplied(job: Job): boolean {
  const events = job.events ?? [];
  return job.status === "applied" || events.some((event) => event.type === "applied");
}

export function ProfilePage({ user, jobs }: ProfilePageProps) {
  const initials = user.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  const applicationsSent = jobs.filter(j => j.status === "applied").length;
  const callbacks = jobs.filter(j => j.status === "interviewing").length;
  const appliedHistory = jobs.filter(wasApplied);
  const successfulApplications = appliedHistory.filter(hasReachedInterviewOrOffer).length;
  const successRate = appliedHistory.length > 0 ? Math.round((successfulApplications / appliedHistory.length) * 100) : 0;
  const avgMatchScore = jobs.length
    ? Math.round(jobs.filter(j => j.score !== null).reduce((sum, job) => sum + (job.score ?? 0), 0) / Math.max(1, jobs.filter(j => j.score !== null).length))
    : 0;

  const recentActivity = [...jobs]
    .sort((a, b) => getLatestJobTimestamp(b) - getLatestJobTimestamp(a))
    .slice(0, 3);

  const kpis = [
    { label: "APPLICATIONS SENT", value: applicationsSent },
    { label: "CALLBACKS / INTERVIEWS", value: callbacks },
    { label: "SUCCESS RATE", value: successRate, suffix: "%" },
    { label: "AVG MATCH SCORE", value: avgMatchScore },
  ];

  const linkedAccounts = [
    { name: "Google", connected: true },
    { name: "LinkedIn", connected: false },
    { name: "Apple", connected: false },
  ];

  return (
    <div className="animate-fade-up space-y-6 max-w-[1100px]">
      {/* Header */}
      <div className="flex items-center gap-5">
        <div className="h-20 w-20 rounded-full flex items-center justify-center font-display font-bold text-2xl text-foreground shrink-0" style={{ background: "linear-gradient(135deg, #8B5CF6, #3B82F6)" }}>
          {initials}
        </div>
        <div className="flex-1">
          <h1 className="font-display font-bold text-2xl text-foreground">{user.name}</h1>
          <p className="font-mono text-[13px] text-muted-foreground">{user.target_role}</p>
          <span className="font-mono text-[9px] uppercase px-2 py-0.5 rounded-full mt-1 inline-block" style={user.plan === "Pro" ? { background: "linear-gradient(135deg, #8B5CF6, #3B82F6)", color: "white" } : { background: "rgba(107,114,128,0.2)", color: "#6B7280" }}>
            {user.plan} Plan
          </span>
        </div>
        <button className="flex items-center gap-1.5 px-3 py-2 rounded-md font-display text-[11px] font-medium uppercase glass-surface text-muted-foreground hover:text-foreground transition-all">
          <Pencil className="h-3.5 w-3.5" /> Edit Profile
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        {kpis.map(k => (
          <GlassCard key={k.label} className="p-5 relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: "linear-gradient(to bottom, #8B5CF6, #E11D48)" }} />
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{k.label}</p>
            <p className="font-display font-bold text-[36px] text-foreground mt-1 leading-none">
              <AnimatedCounter value={k.value} />{k.suffix || ""}
            </p>
          </GlassCard>
        ))}
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-6">
          <GlassCard className="p-5" hover={false}>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-4">RECENT ACTIVITY</p>
            <div className="space-y-2">
              {recentActivity.length === 0 ? (
                <div className="rounded-md border border-dashed border-foreground/[0.06] px-3 py-6 text-center">
                  <p className="font-mono text-[10px] text-muted-foreground">No activity yet</p>
                </div>
              ) : recentActivity.map(job => (
                <div key={job.id} className="flex items-center gap-3 p-2.5 rounded-md hover:bg-foreground/[0.025] transition-colors">
                  <div className="h-8 w-8 rounded flex items-center justify-center glass-surface">
                    <Download className="h-3.5 w-3.5 text-jarvis-purple" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-[11px] text-foreground truncate">{job.title}</p>
                    <p className="font-mono text-[10px] text-muted-foreground truncate">{formatActivityLabel(job)}</p>
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground">{new Date(job.date_scraped).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </GlassCard>

          <GlassCard className="p-5" hover={false}>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-4">TOP PERFORMING TEMPLATES</p>
            {[{ name: "Modern CV", type: "CV", rate: "42%" }, { name: "Formal Cover Letter", type: "Cover Letter", rate: "38%" }].map(t => (
              <div key={t.name} className="flex items-center gap-3 p-2.5 rounded-md hover:bg-foreground/[0.025] transition-colors">
                <span className="font-display text-sm text-foreground">{t.name}</span>
                <span className="font-mono text-[9px] px-1.5 py-0.5 rounded-full glass-surface text-muted-foreground">{t.type}</span>
                <span className="font-mono text-[10px] text-jarvis-green ml-auto">🏆 {t.rate} callback rate</span>
              </div>
            ))}
          </GlassCard>
        </div>

        <div className="space-y-6">
          <GlassCard className="p-5" hover={false}>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-4">LINKED ACCOUNTS</p>
            <div className="space-y-2">
              {linkedAccounts.map(acc => (
                <div key={acc.name} className="flex items-center justify-between p-2.5 rounded-md">
                  <span className="font-display text-sm text-foreground">{acc.name}</span>
                  {acc.connected ? (
                    <span className="flex items-center gap-1 font-mono text-[10px] text-jarvis-green"><Check className="h-3 w-3" /> Connected</span>
                  ) : (
                    <button className="font-mono text-[10px] px-2 py-1 rounded glass-surface text-muted-foreground hover:text-foreground transition-all">Connect</button>
                  )}
                </div>
              ))}
            </div>
          </GlassCard>

          <GlassCard className="p-5" hover={false}>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-4">SUBSCRIPTION</p>
            <p className="text-gradient-purple font-display font-bold text-2xl mb-1">{user.plan.toUpperCase()}</p>
            <p className="font-mono text-[11px] text-muted-foreground mb-4">Billed monthly</p>
            <ul className="space-y-1.5 mb-4">
              {["Unlimited document generation", "All templates", "Priority AI processing", "Community leaderboard"].map(f => (
                <li key={f} className="flex items-center gap-2 font-display text-[12px] text-foreground">
                  <Check className="h-3.5 w-3.5 text-jarvis-green" /> {f}
                </li>
              ))}
            </ul>
            <button className="w-full py-2 rounded-md font-display text-[11px] font-medium uppercase border border-jarvis-purple/40 text-jarvis-purple hover:bg-jarvis-purple hover:text-foreground transition-all">
              Manage Plan
            </button>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
