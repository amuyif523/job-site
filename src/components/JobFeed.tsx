import { useState, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Job, JobStatus } from "@/types/job";
import { updateJobStatus, updateJobNotes } from "@/lib/api";
import { GlassCard } from "./GlassCard";
import { ScoreRing } from "./ScoreRing";
import { toast } from "@/hooks/use-toast";
import { Search, Loader2, ExternalLink, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface JobFeedProps {
  jobs: Job[];
  onGenerateForJob: (job: Job) => void;
  onScoreAll?: () => void;
  isScoring?: boolean;
}

const statusColors: Record<string, string> = {
  new: "#6B7280", scored: "#06B6D4", selected: "#3B82F6", applied: "#10B981", interviewing: "#F59E0B", offered: "#8B5CF6", rejected: "#E11D48",
};
const allStatuses = ["all", "new", "scored", "selected", "applied", "interviewing", "offered", "rejected"];

export function JobFeed({ jobs, onGenerateForJob, onScoreAll, isScoring }: JobFeedProps) {
  const [search, setSearch] = useState("");
  const [scoreMin, setScoreMin] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("description");
  const [notes, setNotes] = useState("");
  const queryClient = useQueryClient();

  const filtered = useMemo(() => {
    return jobs.filter(j => {
      const q = search.toLowerCase();
      if (q && !j.title.toLowerCase().includes(q) && !j.company.toLowerCase().includes(q)) return false;
      if (j.score !== null && j.score < scoreMin) return false;
      if (scoreMin > 0 && j.score === null) return false;
      if (statusFilter !== "all" && j.status !== statusFilter) return false;
      return true;
    }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  }, [jobs, search, scoreMin, statusFilter]);

  const selected = filtered.find(j => j.id === selectedId) || null;

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: JobStatus }) => updateJobStatus(id, status),
    onSuccess: (_, v) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast({ title: `Status → ${v.status}` });
    },
  });

  const notesMutation = useMutation({
    mutationFn: ({ id, notes }: { id: number; notes: string }) => updateJobNotes(id, notes),
    onSuccess: () => toast({ title: "Notes saved" }),
  });

  const scoreColor = (s: number | null) => s === null ? "#6B7280" : s >= 80 ? "#10B981" : s >= 50 ? "#F59E0B" : "#E11D48";

  const tabs = ["description", "score breakdown", "red flags", "notes"];

  return (
    <div className="animate-fade-up flex gap-0 h-[calc(100vh-64px)]">
      {/* Left panel */}
      <div className="w-[36%] flex flex-col border-r border-border/30">
        {/* Toolbar */}
        <div className="p-3 space-y-3 border-b border-border/30">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search jobs..."
              className="w-full pl-9 pr-3 py-2 bg-transparent glass-surface font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:shadow-[0_0_0_2px_rgba(139,92,246,0.5)]"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-muted-foreground whitespace-nowrap">MATCH ≥ {scoreMin}</span>
            <input
              type="range" min={0} max={100} step={5} value={scoreMin}
              onChange={e => setScoreMin(Number(e.target.value))}
              className="flex-1 accent-jarvis-purple h-1"
            />
          </div>
          <div className="flex gap-1 flex-wrap">
            {allStatuses.map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  "font-mono text-[10px] uppercase px-2 py-1 rounded transition-all",
                  statusFilter === s
                    ? "text-foreground" : "text-muted-foreground glass-surface hover:text-foreground"
                )}
                style={statusFilter === s ? { background: "linear-gradient(135deg, #8B5CF6, #3B82F6)" } : {}}
              >
                {s}
              </button>
            ))}
          </div>
          {onScoreAll && (
            <button
              onClick={onScoreAll}
              disabled={isScoring}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md font-display text-[11px] font-medium uppercase border border-jarvis-purple/40 text-jarvis-purple hover:bg-jarvis-purple hover:text-foreground transition-all"
            >
              {isScoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              Score All
            </button>
          )}
        </div>

        {/* Job list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.map(job => (
            <button
              key={job.id}
              onClick={() => { setSelectedId(job.id); setNotes(job.notes || ""); setActiveTab("description"); }}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-3 text-left transition-all duration-100 border-b border-border/10",
                selectedId === job.id
                  ? "border-l-[3px] border-l-jarvis-purple bg-jarvis-purple/[0.07]"
                  : "border-l-[3px] border-l-transparent hover:bg-foreground/[0.025]"
              )}
            >
              <div className="h-[34px] w-[34px] rounded-full flex items-center justify-center font-mono font-bold text-[11px] text-foreground shrink-0" style={{ background: "linear-gradient(135deg, #8B5CF6, #3B82F6)" }}>
                {job.company.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-display text-[13px] font-medium text-foreground truncate">{job.title}</p>
                <p className="font-mono text-[10px] text-muted-foreground truncate">{job.company} · {job.location}</p>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded-full border" style={{ color: scoreColor(job.score), borderColor: scoreColor(job.score) + "4D", background: scoreColor(job.score) + "26" }}>
                  {job.score ?? "—"}
                </span>
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ color: statusColors[job.status], background: statusColors[job.status] + "26" }}>
                  {job.status}
                </span>
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="flex items-center justify-center h-full text-muted-foreground font-mono text-sm">
              No jobs match
            </div>
          )}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 overflow-y-auto p-4">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <span className="text-gradient-purple font-display font-bold text-6xl">J</span>
            <p className="font-display text-sm text-muted-foreground">Select a job to view details</p>
          </div>
        ) : (
          <div className="animate-fade-up space-y-4">
            <GlassCard className="p-5" hover={false}>
              <div className="flex gap-4">
                <ScoreRing score={selected.score} size={90} strokeWidth={6} />
                <div className="flex-1 min-w-0">
                  <h2 className="font-display font-bold text-xl text-foreground">{selected.title}</h2>
                  <p className="font-display font-medium text-sm text-jarvis-purple mt-0.5">{selected.company}</p>
                  <p className="font-mono text-[11px] text-muted-foreground mt-1">
                    {selected.location} · {new Date(selected.date_scraped).toLocaleDateString()}
                    {selected.url && (
                      <a href={selected.url} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center gap-1 text-jarvis-blue hover:underline">
                        Open <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </p>
                  {/* Action buttons */}
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => statusMutation.mutate({ id: selected.id, status: "selected" })}
                      className="px-3 py-2 rounded-md font-display text-xs font-semibold uppercase border border-jarvis-blue/50 text-jarvis-blue hover:bg-jarvis-blue hover:text-foreground transition-all hover:scale-[1.02]"
                    >
                      {statusMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "✓ Select"}
                    </button>
                    <button
                      onClick={() => onGenerateForJob(selected)}
                      className="px-5 py-2 rounded-md font-display text-xs font-semibold uppercase text-foreground transition-all hover:scale-[1.02] animate-glow-pulse"
                      style={{ background: "linear-gradient(135deg, #8B5CF6, #3B82F6)" }}
                    >
                      ⚡ Generate Application
                    </button>
                    <button
                      onClick={() => statusMutation.mutate({ id: selected.id, status: "interviewing" })}
                      className="px-3 py-2 rounded-md font-display text-xs font-semibold uppercase border border-jarvis-yellow/50 text-jarvis-yellow hover:bg-jarvis-yellow hover:text-foreground transition-all hover:scale-[1.02]"
                    >
                      ✓ Mark Interviewing
                    </button>
                    <button
                      onClick={() => statusMutation.mutate({ id: selected.id, status: "applied" })}
                      className="px-3 py-2 rounded-md font-display text-xs font-semibold uppercase border border-jarvis-green/50 text-jarvis-green hover:bg-jarvis-green hover:text-foreground transition-all hover:scale-[1.02]"
                    >
                      ✓ Mark Applied
                    </button>
                  </div>
                </div>
              </div>
            </GlassCard>

            {/* Tabs */}
            <div className="flex gap-4 border-b border-border/30 pb-0">
              {tabs.map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "font-mono text-[10px] uppercase tracking-wider pb-2 transition-colors",
                    activeTab === tab
                      ? "text-foreground border-b-2 border-jarvis-purple"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div className="max-h-[40vh] overflow-y-auto font-mono text-xs text-muted-foreground leading-relaxed">
              {activeTab === "description" && (
                <pre className="whitespace-pre-wrap">{selected.description}</pre>
              )}
              {activeTab === "score breakdown" && (
                selected.score_reasoning?.length ? (
                  <ul className="space-y-1">{selected.score_reasoning.map((r, i) => <li key={i}>• {r}</li>)}</ul>
                ) : <p>No score breakdown available</p>
              )}
              {activeTab === "red flags" && (
                selected.red_flags?.length ? (
                  <ul className="space-y-1 text-jarvis-crimson">{selected.red_flags.map((f, i) => <li key={i}>⚠ {f}</li>)}</ul>
                ) : <p>No red flags detected</p>
              )}
              {activeTab === "notes" && (
                <div className="space-y-2">
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    onBlur={() => notesMutation.mutate({ id: selected.id, notes })}
                    placeholder="Add notes..."
                    className="w-full h-24 bg-transparent glass-surface p-3 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:shadow-[0_0_0_2px_rgba(139,92,246,0.5)] resize-none rounded-lg"
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
