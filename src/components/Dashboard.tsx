import { ChangeEvent, useEffect, useRef, useState } from "react";
import { Job } from "@/types/job";
import { GlassCard } from "./GlassCard";
import { ScoreRing } from "./ScoreRing";
import { getCVUiState, uploadCV, type CVLatestResponse, type CVUiState } from "@/lib/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Loader2, Play, Upload } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { canGenerateForJob, getGenerationBlockReason, isReliableTopMatch } from "@/lib/jobScoring";

interface DashboardProps {
  jobs: Job[];
  onGenerateForJob: (job: Job) => void;
  cvData?: CVLatestResponse | null;
}

type DashboardView = "recovery" | "step_two" | "ready_with_jobs";

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


function StepTwoCard() {
  return (
    <GlassCard className="p-8 md:p-10 min-h-[220px] flex items-center justify-between gap-6 overflow-hidden relative" hover={false}>
      <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-jarvis-blue via-jarvis-purple to-jarvis-green" />
      <div className="max-w-2xl space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-jarvis-blue">Step 2: Find Opportunities</p>
        <h2 className="font-display font-bold text-3xl md:text-5xl text-foreground leading-tight">
          Start the job scraper next
        </h2>
        <p className="font-display text-sm md:text-base text-muted-foreground max-w-xl">
          Click the Play icon in the sidebar to start the job scraper.
        </p>
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-jarvis-blue/30 bg-jarvis-blue/10 text-jarvis-blue font-mono text-[11px] uppercase tracking-[0.25em]">
          <Play className="h-4 w-4" />
          Use the sidebar Play action
        </div>
      </div>
      <div className="hidden md:flex flex-col items-end text-right gap-2 text-muted-foreground font-mono text-[11px]">
        <span>Resume parsed</span>
        <span>Now discover jobs</span>
        <span>Then apply faster</span>
      </div>
    </GlassCard>
  );
}

function getDashboardView(cvState: CVUiState, jobs: Job[]): DashboardView {
  if (cvState !== "ready") {
    return "recovery";
  }

  if (jobs.length === 0) {
    return "step_two";
  }

  return "ready_with_jobs";
}

function CVRecoveryState({
  title,
  description,
  actionLabel,
  recoveryHint,
}: {
  title: string;
  description: string;
  actionLabel: string;
  recoveryHint: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadCV(file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["latestCV"] });
      toast({ title: "CV uploaded successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "CV upload failed",
        description: error.message || "Failed to upload CV",
        variant: "destructive",
      });
    },
  });

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadMutation.mutate(file);
    }
  };

  return (
    <GlassCard className="p-8 md:p-10 min-h-[220px] flex items-center justify-between gap-6 overflow-hidden relative" hover={false}>
      <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-jarvis-purple via-jarvis-blue to-jarvis-green" />
      <div className="max-w-2xl space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-jarvis-purple">CV Status</p>
        <h2 className="font-display font-bold text-3xl md:text-5xl text-foreground leading-tight">
          {title}
        </h2>
        <p className="font-display text-sm md:text-base text-muted-foreground max-w-xl">
          {description}
        </p>
        <p className="font-mono text-[11px] text-muted-foreground max-w-xl">
          {recoveryHint}
        </p>
        <button
          disabled={uploadMutation.isPending}
          onClick={() => {
            fileRef.current?.click();
          }}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-md font-display font-semibold text-[12px] uppercase text-foreground transition-all hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-80 disabled:hover:scale-100"
          style={{ background: "linear-gradient(135deg, #8B5CF6, #3B82F6)", boxShadow: "0 0 20px rgba(139,92,246,0.35)" }}
        >
          {uploadMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {uploadMutation.isPending ? "JARVIS is analyzing your CV..." : actionLabel}
        </button>
        <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={handleFile} />
      </div>
      <div className="hidden md:flex flex-col items-end text-right gap-2 text-muted-foreground font-mono text-[11px]">
        <span>Upload</span>
        <span>Review</span>
        <span>Recover fast</span>
      </div>
    </GlassCard>
  );
}

export function Dashboard({ jobs, onGenerateForJob, cvData }: DashboardProps) {
  const cvState = getCVUiState(cvData, false);
  const dashboardView = getDashboardView(cvState, jobs);
  const scored = jobs.filter(j => j.score !== null && isReliableTopMatch(j));
  const trustedTopMatches = [...jobs]
    .filter((job) => isReliableTopMatch(job))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    .slice(0, 3);
  const kpis = [
    { label: "TOTAL JOBS", value: jobs.length },
    { label: "HIGH MATCHES", value: jobs.filter(j => isReliableTopMatch(j) && (j.score ?? 0) >= 80).length },
    { label: "APPLIED", value: jobs.filter(j => j.status === "applied").length },
    { label: "AVG SCORE", value: scored.length ? Math.round(scored.reduce((a, j) => a + (j.score ?? 0), 0) / scored.length) : 0 },
  ];

  const dist = [
    { range: "0–25", count: jobs.filter(j => isReliableTopMatch(j) && j.score !== null && j.score <= 25).length, color: "#E11D48" },
    { range: "26–50", count: jobs.filter(j => isReliableTopMatch(j) && j.score !== null && j.score > 25 && j.score <= 50).length, color: "#8B5CF6" },
    { range: "51–75", count: jobs.filter(j => isReliableTopMatch(j) && j.score !== null && j.score > 50 && j.score <= 75).length, color: "#3B82F6" },
    { range: "76–100", count: jobs.filter(j => isReliableTopMatch(j) && j.score !== null && j.score > 75).length, color: "#10B981" },
  ];

  const statusColor = (s: string) => {
    const map: Record<string, string> = { new: "#6B7280", scored: "#06B6D4", selected: "#3B82F6", applied: "#10B981", interviewing: "#F59E0B", offered: "#8B5CF6", rejected: "#E11D48" };
    return map[s] || "#6B7280";
  };

  if (dashboardView === "recovery" && cvState === "no_cv") {
    return (
      <div className="animate-fade-up space-y-6">
        <CVRecoveryState
          title="Upload Your Resume to Begin"
          description="Upload your resume to unlock AI parsing, strength scoring, and tailored job recommendations."
          actionLabel="Upload Your Resume to Begin"
          recoveryHint="Use a PDF resume with selectable text so JARVIS can read it reliably."
        />
      </div>
    );
  }

  if (dashboardView === "recovery" && cvState === "uploading") {
    return (
      <div className="animate-fade-up space-y-6">
        <CVRecoveryState
          title="Your CV is being processed"
          description="JARVIS is parsing your uploaded resume right now. This should only take a moment."
          actionLabel="Processing CV..."
          recoveryHint="Keep this tab open. If this state persists, try uploading the PDF again."
        />
      </div>
    );
  }

  if (dashboardView === "recovery" && cvState === "incomplete") {
    return (
      <div className="animate-fade-up space-y-6">
        <CVRecoveryState
          title="Your CV needs a cleaner upload"
          description="The file uploaded, but JARVIS could not extract enough structured resume data to build your dashboard yet."
          actionLabel="Upload a Better PDF"
          recoveryHint="Try a PDF with selectable text, clear section headings, and less visual complexity."
        />
      </div>
    );
  }

  if (dashboardView === "recovery" && cvState === "invalid") {
    return (
      <div className="animate-fade-up space-y-6">
        <CVRecoveryState
          title="We could not read your current CV"
          description="Your last upload is stored, but the parsed resume data is invalid, so JARVIS cannot trust it."
          actionLabel="Re-upload CV"
          recoveryHint="Upload a fresh PDF resume to recover and unlock scoring and job matching again."
        />
      </div>
    );
  }

  return (
    <div className="animate-fade-up space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        {kpis.map(k => (
          <GlassCard key={k.label} className="relative overflow-hidden p-4 sm:p-5">
            <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: "linear-gradient(to bottom, #8B5CF6, #E11D48)" }} />
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{k.label}</p>
            <p className="mt-1 font-display text-[34px] font-bold leading-none text-foreground sm:text-[40px]">
              <AnimatedCounter value={k.value} />
            </p>
            <div className="mt-3 h-px w-full" style={{ background: "linear-gradient(to right, #8B5CF6, #3B82F6)", animation: "pulse-line 2.5s ease-in-out infinite" }} />
          </GlassCard>
        ))}
      </div>

      {/* Dashboard focus area */}
      {dashboardView === "ready_with_jobs" ? (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-3">TOP MATCHES</p>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {trustedTopMatches.map(job => (
              <GlassCard key={job.id} className="flex h-full flex-col p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="h-11 w-11 rounded-full flex items-center justify-center font-mono font-bold text-sm text-foreground shrink-0" style={{ background: "linear-gradient(135deg, #8B5CF6, #3B82F6)" }}>
                    {job.company.slice(0, 2).toUpperCase()}
                  </div>
                  <ScoreRing score={job.score} size={72} />
                </div>
                <p className="font-display font-semibold text-sm text-foreground mt-3 line-clamp-2">{job.title}</p>
                <p className="mt-1 break-words font-mono text-[11px] text-muted-foreground">{job.company} · {job.location}</p>
                <span className="mt-2 inline-block font-mono text-[10px] px-2 py-0.5 rounded-full" style={{ color: statusColor(job.status), background: statusColor(job.status) + "26" }}>
                  {job.status}
                </span>
                <button
                  onClick={() => onGenerateForJob(job)}
                  disabled={!canGenerateForJob(job)}
                  className="mt-auto pt-4 w-full py-2 rounded-md font-display font-semibold text-[11px] uppercase text-foreground transition-all duration-150 hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
                  style={{ background: "linear-gradient(135deg, #8B5CF6, #3B82F6)", boxShadow: "0 0 20px rgba(139,92,246,0.35)" }}
                >
                  Generate Application →
                </button>
                {!canGenerateForJob(job) && (
                  <p className="mt-2 font-mono text-[10px] text-amber-200">
                    {getGenerationBlockReason(job)}
                  </p>
                )}
              </GlassCard>
            ))}
            {trustedTopMatches.length === 0 && (
              <GlassCard className="p-5 lg:col-span-2 2xl:col-span-3" hover={false}>
                <p className="font-display text-lg font-semibold text-foreground">Top matches will appear after trustworthy scoring is ready</p>
                <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                  JARVIS only promotes jobs here once they have a usable full description and a completed score. Run scoring after enrichment finishes, then review the Jobs view for any skipped listings.
                </p>
              </GlassCard>
            )}
          </div>
        </div>
      ) : (
        <StepTwoCard />
      )}

      {/* Score Distribution — always show */}
      <GlassCard className="overflow-hidden p-4 sm:p-5" hover={false}>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-4">SCORE DISTRIBUTION</p>
        <div className="h-[220px] w-full min-w-0 sm:h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dist} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <XAxis dataKey="range" tick={{ fill: "#6B7280", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} interval={0} />
              <YAxis tick={{ fill: "#6B7280", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} width={28} />
              <Tooltip contentStyle={{ background: "rgba(13,13,26,0.9)", border: "1px solid rgba(139,92,246,0.2)", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 11, color: "#F1F0FF" }} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} animationDuration={1000}>
                {dist.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </GlassCard>
    </div>
  );
}
