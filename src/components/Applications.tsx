import { Job } from "@/types/job";
import { GlassCard } from "./GlassCard";
import { ScoreRing } from "./ScoreRing";

interface ApplicationsProps {
  jobs: Job[];
  onViewJob: (job: Job) => void;
}

const columns = [
  { status: "selected", label: "SELECTED" },
  { status: "interviewing", label: "INTERVIEWING" },
  { status: "applied", label: "APPLIED" },
  { status: "rejected", label: "REJECTED" },
] as const;

export function Applications({ jobs, onViewJob }: ApplicationsProps) {
  return (
    <div className="animate-fade-up">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-4">MY APPLICATIONS</p>
      <div className="grid grid-cols-4 gap-4">
        {columns.map(col => {
          const colJobs = jobs.filter(j => j.status === col.status);
          return (
            <GlassCard key={col.status} className="p-4 flex flex-col min-h-[300px]" hover={false}>
              <div className="flex items-center gap-2 mb-3">
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{col.label}</span>
                <span className="glass-surface font-mono text-[10px] px-2 py-0.5 rounded-full text-muted-foreground">{colJobs.length}</span>
              </div>
              <div className="flex-1 space-y-2">
                {colJobs.length === 0 ? (
                  <div className="flex items-center justify-center h-full border border-dashed border-foreground/[0.06] rounded-lg">
                    <p className="font-mono text-[10px] text-muted-foreground">No jobs yet</p>
                  </div>
                ) : colJobs.map(job => (
                  <div key={job.id} className="glass-surface p-3 rounded-lg flex items-center gap-3">
                    <div className="h-7 w-7 rounded-full flex items-center justify-center font-mono font-bold text-[10px] text-foreground shrink-0" style={{ background: "linear-gradient(135deg, #8B5CF6, #3B82F6)" }}>
                      {job.company.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-display text-[13px] font-medium text-foreground truncate">{job.title}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">{job.company}</p>
                    </div>
                    <ScoreRing score={job.score} size={36} strokeWidth={3} />
                    <button
                      onClick={() => onViewJob(job)}
                      className="font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      VIEW
                    </button>
                  </div>
                ))}
              </div>
            </GlassCard>
          );
        })}
      </div>
    </div>
  );
}
