import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchJobs,
  fetchLatestCV,
  fetchScoreAllStatus,
  scoreAll,
  type CVLatestResponse,
  type ScoreTaskProgress,
  type ScoreTaskResult,
} from "@/lib/api";
import { Job } from "@/types/job";
import { ParticleBackground } from "@/components/ParticleBackground";
import { SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_EXPANDED_WIDTH, Sidebar, Section } from "@/components/JarvisSidebar";
import { CVStatusBar } from "@/components/CVStatusBar";
import { Dashboard } from "@/components/Dashboard";
import { JobFeed } from "@/components/JobFeed";
import { Applications } from "@/components/Applications";
import { GenerateModal } from "@/components/GenerateModal";
import { SettingsModal } from "@/components/SettingsModal";
import { JarvisChat } from "@/components/JarvisChat";
import { LandingPage } from "@/components/LandingPage";
import { ProfileDropdown, UserData } from "@/components/ProfileDropdown";
import { ProfilePage } from "@/components/ProfilePage";
import { TemplatesPage } from "@/components/TemplatesPage";
import { LeaderboardPage } from "@/components/LeaderboardPage";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { canGenerateForJob, getGenerationBlockReason } from "@/lib/jobScoring";
import { cn } from "@/lib/utils";

const ACTIVE_SCORE_TASK_KEY = "jarvis_active_score_task_id";
const ACTIVE_SCORE_PROGRESS_KEY = "jarvis_active_score_progress";
const LAST_SCORE_SUMMARY_KEY = "jarvis_last_score_summary";
const BASE_SCORE_POLL_INTERVAL_MS = 3000;
const MAX_SCORE_POLL_INTERVAL_MS = 30000;

interface ScoreRunSummary {
  status: "success" | "failure";
  timestamp: number;
  progress: ScoreTaskProgress;
  result: ScoreTaskResult | null;
  error?: string | null;
}

function getStorageKey(baseKey: string, userId: number | null | undefined): string {
  if (userId == null) {
    return baseKey;
  }
  return `${baseKey}:${userId}`;
}

function createQueuedScoreProgress(): ScoreTaskProgress {
  return {
    phase: "queued",
    total_jobs: 0,
    jobs_scored: 0,
    jobs_failed: 0,
    jobs_unscorable: 0,
  };
}

function getStoredScoreTaskId(userId: number | null | undefined): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(getStorageKey(ACTIVE_SCORE_TASK_KEY, userId));
}

function storeScoreTaskId(taskId: string | null, userId: number | null | undefined): void {
  if (typeof window === "undefined") return;
  const storageKey = getStorageKey(ACTIVE_SCORE_TASK_KEY, userId);
  if (!taskId) {
    window.localStorage.removeItem(storageKey);
    return;
  }
  window.localStorage.setItem(storageKey, taskId);
}

function getStoredScoreProgress(userId: number | null | undefined): ScoreTaskProgress | null {
  if (typeof window === "undefined") return null;
  const storageKey = getStorageKey(ACTIVE_SCORE_PROGRESS_KEY, userId);
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as ScoreTaskProgress;
  } catch {
    window.localStorage.removeItem(storageKey);
    return null;
  }
}

function storeScoreProgress(progress: ScoreTaskProgress | null, userId: number | null | undefined): void {
  if (typeof window === "undefined") return;
  const storageKey = getStorageKey(ACTIVE_SCORE_PROGRESS_KEY, userId);
  if (!progress) {
    window.localStorage.removeItem(storageKey);
    return;
  }
  window.localStorage.setItem(storageKey, JSON.stringify(progress));
}

function getLastScoreSummary(userId: number | null | undefined): ScoreRunSummary | null {
  if (typeof window === "undefined") return null;
  const storageKey = getStorageKey(LAST_SCORE_SUMMARY_KEY, userId);
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as ScoreRunSummary;
  } catch {
    window.localStorage.removeItem(storageKey);
    return null;
  }
}

function storeLastScoreSummary(summary: ScoreRunSummary | null, userId: number | null | undefined): void {
  if (typeof window === "undefined") return;
  const storageKey = getStorageKey(LAST_SCORE_SUMMARY_KEY, userId);
  if (!summary) {
    window.localStorage.removeItem(storageKey);
    return;
  }
  window.localStorage.setItem(storageKey, JSON.stringify(summary));
}

function clearActiveScoreStorage(userId: number | null | undefined): void {
  storeScoreTaskId(null, userId);
  storeScoreProgress(null, userId);
}

function getRemainingJobs(progress: ScoreTaskProgress | null): number {
  if (!progress) return 0;
  return Math.max(
    progress.total_jobs - progress.jobs_scored - progress.jobs_failed - progress.jobs_unscorable,
    0
  );
}

function getScoreProgressPercent(progress: ScoreTaskProgress | null): number {
  if (!progress) return 0;
  if (progress.phase === "completed" || progress.phase === "failed") return 100;
  if (progress.total_jobs <= 0) return progress.phase === "queued" ? 10 : 20;

  const processed = progress.jobs_scored + progress.jobs_failed + progress.jobs_unscorable;
  return Math.max(10, Math.min(100, Math.round((processed / progress.total_jobs) * 100)));
}

function getScorePanelTitle(
  scoring: boolean,
  progress: ScoreTaskProgress | null,
  lastSummary: ScoreRunSummary | null
): string {
  if (scoring) {
    return progress?.phase === "queued" ? "Score task queued" : "Scoring jobs";
  }
  if (!lastSummary) return "Ready to score jobs";
  return lastSummary.status === "success" ? "Last score run completed" : "Last score run failed";
}

function formatScoreTimestamp(timestamp: number | null): string {
  if (!timestamp) return "Not yet available";
  return new Date(timestamp).toLocaleString();
}

function getScoreFailureGuidance(error?: string | null): string {
  const message = (error || "").toLowerCase();

  if (message.includes("provider key") || message.includes("api key")) {
    return "Check the configured AI provider key and try again.";
  }
  if (message.includes("rate limit")) {
    return "Retry after the provider rate limit window resets.";
  }
  if (message.includes("redis") || message.includes("worker") || message.includes("connection refused")) {
    return "Check Redis and confirm the Celery worker is running.";
  }

  return "Retry the score task. If it keeps failing, inspect the backend worker logs.";
}

function getScoreRunSummaryText(summary: ScoreRunSummary | null): string {
  if (!summary) {
    return "No score run has completed yet.";
  }

  const result = summary.result;
  const progress = summary.progress;
  const scored = result?.scored ?? progress.jobs_scored ?? 0;
  const failed = progress.jobs_failed ?? 0;
  const skipped = result?.unscorable ?? progress.jobs_unscorable ?? 0;
  const total = progress.total_jobs ?? 0;

  if (summary.status === "failure") {
    return failed > 0
      ? `The last run failed after processing ${failed} job${failed === 1 ? "" : "s"}.`
      : "The last run failed before any jobs were scored.";
  }

  if (total === 0) {
    return "The last run did not find any jobs that needed scoring.";
  }

  if (scored === 0 && failed === 0 && skipped === 0) {
    return "The last run completed, but no jobs needed scoring.";
  }

  if (scored === 0 && failed > 0) {
    return `The last run did not score any jobs successfully. ${failed} job${failed === 1 ? "" : "s"} failed.`;
  }

  if (failed > 0 || skipped > 0) {
    return `The last run scored ${scored} job${scored === 1 ? "" : "s"}, with ${failed} failure${failed === 1 ? "" : "s"} and ${skipped} skipped.`;
  }

  return `The last run scored ${scored} job${scored === 1 ? "" : "s"} successfully.`;
}

function getScoreOutcomeGuidance(summary: ScoreRunSummary | null): { tone: "success" | "warning" | "failure"; message: string } | null {
  if (!summary) return null;

  if (summary.status === "failure") {
    return {
      tone: "failure",
      message: `${summary.error || "The score task failed."} ${getScoreFailureGuidance(summary.error)}`,
    };
  }

  const result = summary.result;
  const progress = summary.progress;
  const scored = result?.scored ?? progress.jobs_scored ?? 0;
  const failed = progress.jobs_failed ?? 0;
  const skipped = result?.unscorable ?? progress.jobs_unscorable ?? 0;
  const total = progress.total_jobs ?? 0;
  const errors = result?.errors ?? [];
  const combinedErrors = errors.join(" ").toLowerCase();

  if (total === 0 || (scored === 0 && failed === 0 && skipped === 0)) {
    return {
      tone: "success",
      message: "No jobs needed scoring. Existing scores are already up to date.",
    };
  }

  if (scored === 0 && failed > 0) {
    return {
      tone: "failure",
      message: `${failed} job${failed === 1 ? "" : "s"} failed during scoring. ${getScoreFailureGuidance(errors[0] ?? summary.error)}`,
    };
  }

  if (failed > 0 || skipped > 0) {
    let guidance = "Review skipped or failed jobs before relying on the match list.";
    if (combinedErrors.includes("provider key") || combinedErrors.includes("api key")) {
      guidance = "Check the configured AI provider key before retrying.";
    } else if (combinedErrors.includes("rate limit")) {
      guidance = "Retry after the provider rate limit window resets.";
    } else if (combinedErrors.includes("job description")) {
      guidance = "Jobs with incomplete descriptions may need a new scrape or manual review.";
    } else if (combinedErrors.includes("cv is not ready")) {
      guidance = "Re-upload the CV with readable text before retrying.";
    }

    return {
      tone: "warning",
      message: `${failed} failed, ${skipped} skipped. ${guidance}`,
    };
  }

  return {
    tone: "success",
    message: "All jobs in the last run scored successfully.",
  };
}

function ScoreStatusPanel({
  scoring,
  progress,
  lastSummary,
  statusUnavailable,
  pollFailures,
  jobs,
}: {
  scoring: boolean;
  progress: ScoreTaskProgress | null;
  lastSummary: ScoreRunSummary | null;
  statusUnavailable: boolean;
  pollFailures: number;
  jobs: Job[];
}) {
  if (!scoring && !lastSummary) {
    return null;
  }

  const activeProgress = scoring ? progress : lastSummary?.progress ?? null;
  const currentResult = scoring ? null : lastSummary?.result ?? null;
  const panelTitle = getScorePanelTitle(scoring, progress, lastSummary);
  const remaining = getRemainingJobs(activeProgress);
  const progressPercent = getScoreProgressPercent(activeProgress);
  const errorText = !scoring ? lastSummary?.error ?? null : null;
  const scoredJobs = jobs.filter((job) => job.score !== null || job.score_label === "Unscorable").length;
  const scoreFreshnessLabel = lastSummary ? `Visible scores last refreshed ${formatScoreTimestamp(lastSummary.timestamp)}` : "Visible scores have not been refreshed yet.";
  const outcomeGuidance = !scoring ? getScoreOutcomeGuidance(lastSummary) : null;
  const runSummaryText = getScoreRunSummaryText(lastSummary);

  return (
    <section className="mb-6 rounded-xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_10px_40px_rgba(0,0,0,0.2)]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground">Score Status</p>
          <h2 className="font-display text-lg font-semibold text-foreground">{panelTitle}</h2>
          <p className="font-mono text-[11px] text-muted-foreground">
            {scoring
              ? "JARVIS is keeping this scoring task visible across refreshes."
              : `Last update: ${formatScoreTimestamp(lastSummary?.timestamp ?? null)}`}
          </p>
          {!scoring && <p className="font-mono text-[11px] text-muted-foreground">{scoreFreshnessLabel}</p>}
        </div>
        <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2 font-mono text-[11px] text-muted-foreground">
          {scoring ? "Single scoring task per account" : lastSummary?.status === "success" ? "Last result: success" : "Last result: failure"}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <span>{scoring ? "Score progress" : "Last known score progress"}</span>
          <span>{progressPercent}%</span>
        </div>
        <Progress value={progressPercent} className="h-2 bg-white/10" />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Total</p>
          <p className="font-display text-lg font-semibold text-foreground">{activeProgress?.total_jobs ?? 0}</p>
        </div>
        <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Scored</p>
          <p className="font-display text-lg font-semibold text-foreground">{activeProgress?.jobs_scored ?? 0}</p>
        </div>
        <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Failed</p>
          <p className="font-display text-lg font-semibold text-foreground">{activeProgress?.jobs_failed ?? 0}</p>
        </div>
        <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Skipped</p>
          <p className="font-display text-lg font-semibold text-foreground">{activeProgress?.jobs_unscorable ?? 0}</p>
        </div>
        <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Remaining</p>
          <p className="font-display text-lg font-semibold text-foreground">{remaining}</p>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-white/10 bg-black/20 px-3 py-3 font-mono text-[11px] text-muted-foreground">
        <p>{scoring ? "This run is updating your visible match scores in real time." : runSummaryText}</p>
        <p className="mt-2">Score coverage: {scoredJobs} of {jobs.length} job{jobs.length === 1 ? "" : "s"} currently have a score or a recorded skip result.</p>
      </div>

      {statusUnavailable && (
        <div className="mt-4 rounded-md border border-amber-400/20 bg-amber-400/10 px-3 py-3 font-mono text-[11px] text-amber-200">
          Status temporarily unavailable. JARVIS is keeping the scoring task visible and retrying in the background.
          {pollFailures > 1 ? ` Retry attempt ${pollFailures}.` : ""}
        </div>
      )}

      {!scoring && outcomeGuidance && (
        <div
          className={cn(
            "mt-4 rounded-md px-3 py-3 font-mono text-[11px]",
            outcomeGuidance.tone === "success" && "border border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
            outcomeGuidance.tone === "warning" && "border border-amber-400/20 bg-amber-400/10 text-amber-200",
            outcomeGuidance.tone === "failure" && "border border-jarvis-crimson/20 bg-jarvis-crimson/10 text-jarvis-crimson"
          )}
        >
          {outcomeGuidance.message}
        </div>
      )}

      {!scoring && lastSummary?.status === "success" && currentResult?.errors?.length ? (
        <div className="mt-4 rounded-md border border-white/10 bg-black/20 px-3 py-3 font-mono text-[11px] text-muted-foreground">
          <p className="text-foreground">Error summary from the last run</p>
          <ul className="mt-2 space-y-1">
            {currentResult.errors.slice(0, 3).map((error, index) => (
              <li key={`${error}-${index}`}>• {error}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export default function Index() {
  const [activeSection, setActiveSection] = useState<Section>("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generateJob, setGenerateJob] = useState<Job | null>(null);
  const [scoreTaskId, setScoreTaskId] = useState<string | null>(() => getStoredScoreTaskId(null));
  const [scoreProgress, setScoreProgress] = useState<ScoreTaskProgress | null>(() => getStoredScoreProgress(null));
  const [scoreStatusUnavailable, setScoreStatusUnavailable] = useState(false);
  const [scorePollFailures, setScorePollFailures] = useState(0);
  const [lastScoreSummary, setLastScoreSummary] = useState<ScoreRunSummary | null>(() => getLastScoreSummary(null));
  const completionToastShownRef = useRef(false);
  const { isAuthenticated, isAuthLoading, authError, user, isLoggingOut, setAuthenticatedUser, retryAuth, logout } = useAuth();
  const queryClient = useQueryClient();

  const { data: jobsData, isLoading: isJobsLoading, isFetching: isJobsFetching } = useQuery({
    queryKey: ["jobs"],
    queryFn: fetchJobs,
    enabled: isAuthenticated,
  });

  const { data: cvData, isLoading: isCvLoading, isFetching: isCvFetching } = useQuery<CVLatestResponse>({
    queryKey: ["latestCV"],
    queryFn: fetchLatestCV,
    enabled: isAuthenticated,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const jobs = jobsData ?? [];
  const isInitialLoading = (isJobsLoading && !jobsData) || (isCvLoading && !cvData);
  const isRefreshing = !isInitialLoading && (isJobsFetching || isCvFetching);

  const scoreMutation = useMutation({
    mutationFn: scoreAll,
    onSuccess: (data) => {
      const queuedProgress = createQueuedScoreProgress();
      completionToastShownRef.current = false;
      setScoreTaskId(data.task_id);
      setScoreProgress(queuedProgress);
      setScoreStatusUnavailable(false);
      setScorePollFailures(0);
      storeScoreTaskId(data.task_id, user?.id ?? null);
      storeScoreProgress(queuedProgress, user?.id ?? null);
      toast({
        title: "Scoring task queued",
        description: data.message || "JARVIS has started scoring your jobs in the background.",
      });
    },
    onError: (error: Error) =>
      toast({
        title: "Failed to queue scoring",
        description: error.message || "Scoring failed",
        variant: "destructive",
      }),
  });

  useEffect(() => {
    setScoreTaskId(getStoredScoreTaskId(user?.id ?? null));
    setScoreProgress(getStoredScoreProgress(user?.id ?? null));
    setLastScoreSummary(getLastScoreSummary(user?.id ?? null));
    setScoreStatusUnavailable(false);
    setScorePollFailures(0);
  }, [user?.id]);

  useEffect(() => {
    if (!isAuthenticated || !scoreTaskId) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failureCount = 0;

    const scheduleNextPoll = (delayMs: number) => {
      if (cancelled) return;
      timer = setTimeout(() => {
        void pollStatus();
      }, delayMs);
    };

    const finishScoreTask = (
      summary: ScoreRunSummary,
      nextProgress: ScoreTaskProgress | null,
      result: ScoreTaskResult | null
    ) => {
      setScoreTaskId(null);
      setScoreProgress(nextProgress);
      setLastScoreSummary(summary);
      setScoreStatusUnavailable(false);
      setScorePollFailures(0);
      storeLastScoreSummary(summary, user?.id ?? null);
      clearActiveScoreStorage(user?.id ?? null);

      if (!completionToastShownRef.current) {
        completionToastShownRef.current = true;
        if (summary.status === "success") {
          queryClient.invalidateQueries({ queryKey: ["jobs"] });
          const scored = result?.scored ?? 0;
          const unscorable = result?.unscorable ?? 0;
          const errors = result?.errors ?? [];
          const errorSummary = errors.length ? ` ${errors.length} jobs returned errors.` : "";
          const skippedSummary = unscorable > 0 ? ` ${unscorable} job${unscorable === 1 ? "" : "s"} were skipped.` : "";

          toast({
            title: "Scoring complete",
            description: `JARVIS finished scoring ${scored} job${scored === 1 ? "" : "s"}.${skippedSummary}${errorSummary}`,
          });
        } else {
          const guidance = getScoreFailureGuidance(summary.error);
          toast({
            title: "Scoring task failed",
            description: summary.error ? `${summary.error} ${guidance}` : guidance,
            variant: "destructive",
          });
        }
      }
    };

    const pollStatus = async () => {
      try {
        const data = await fetchScoreAllStatus(scoreTaskId);
        if (cancelled) return;

        failureCount = 0;
        setScoreStatusUnavailable(false);
        setScorePollFailures(0);

        const nextProgress = data.progress ?? scoreProgress ?? createQueuedScoreProgress();
        setScoreProgress(nextProgress);
        storeScoreProgress(nextProgress, user?.id ?? null);

        if (data.status === "success") {
          finishScoreTask(
            {
              status: "success",
              timestamp: Date.now(),
              progress: data.result?.progress ?? nextProgress,
              result: data.result ?? null,
              error: null,
            },
            data.result?.progress ?? nextProgress,
            data.result ?? null
          );
          return;
        }

        if (data.status === "failure") {
          finishScoreTask(
            {
              status: "failure",
              timestamp: Date.now(),
              progress: nextProgress,
              result: data.result ?? null,
              error: data.error ?? null,
            },
            nextProgress,
            data.result ?? null
          );
          return;
        }

        scheduleNextPoll(BASE_SCORE_POLL_INTERVAL_MS);
      } catch {
        if (cancelled) return;
        failureCount += 1;
        const backoffMs = Math.min(BASE_SCORE_POLL_INTERVAL_MS * 2 ** (failureCount - 1), MAX_SCORE_POLL_INTERVAL_MS);
        setScoreStatusUnavailable(true);
        setScorePollFailures(failureCount);
        scheduleNextPoll(backoffMs);
      }
    };

    void pollStatus();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [isAuthenticated, queryClient, scoreTaskId, user?.id]);

  const isScoring = scoreMutation.isPending || !!scoreTaskId;
  const scoreButtonLabel =
    scoreMutation.isPending
      ? "Scoring..."
      : scoreTaskId && scoreProgress?.phase === "queued"
        ? "Queued..."
        : scoreTaskId
          ? `Scoring ${scoreProgress?.jobs_scored ?? 0}/${scoreProgress?.total_jobs ?? 0}`
          : "Score All";
  const sidebarWidth = sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH;

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncSidebarForViewport = () => {
      if (window.innerWidth < 1024) {
        setSidebarCollapsed(true);
      }
    };

    syncSidebarForViewport();
    window.addEventListener("resize", syncSidebarForViewport);
    return () => window.removeEventListener("resize", syncSidebarForViewport);
  }, []);

  const handleLogin = (userData: UserData) => {
    setAuthenticatedUser(userData);
  };

  const handleLogout = async () => {
    try {
      await logout();
      setActiveSection("dashboard");
    } catch (error) {
      toast({
        title: "Sign out failed",
        description: error instanceof Error ? error.message : "We couldn't sign you out right now. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleGenerateJob = (job: Job) => {
    if (!canGenerateForJob(job)) {
      toast({
        title: "Job not ready for generation",
        description: getGenerationBlockReason(job),
        variant: "destructive",
      });
      return;
    }

    setGenerateJob(job);
  };

  return (
    <ProtectedRoute
      isAuthenticated={isAuthenticated}
      isLoading={isAuthLoading}
      authError={authError}
      onRetry={() => {
        void retryAuth();
      }}
      fallback={<LandingPage onLogin={handleLogin} />}
    >
      <div className="relative min-h-screen" style={{ background: "#07070F" }}>
        <ParticleBackground />
        <Sidebar
          active={activeSection}
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
          onNavigate={setActiveSection}
          onOpenSettings={() => setSettingsOpen(true)}
          userId={user?.id ?? null}
          targetRole={user?.target_role ?? ""}
        />

        <div
          className="fixed top-3 right-3 flex flex-wrap items-center justify-end gap-2 sm:top-4 sm:right-6 sm:gap-3"
          style={{ left: sidebarWidth + 16, zIndex: 30 }}
        >
          <CVStatusBar />
          {user && (
            <ProfileDropdown
              user={user}
              onNavigate={setActiveSection}
              onOpenSettings={() => setSettingsOpen(true)}
              onLogout={() => {
                void handleLogout();
              }}
              isLoggingOut={isLoggingOut}
            />
          )}
        </div>

        <main
          className="relative min-w-0 pb-6 pr-3 pt-24 transition-all duration-250 ease-in-out sm:pr-6 sm:pt-20"
          style={{ paddingLeft: sidebarWidth + 16, zIndex: 1 }}
        >
          <div
            className="absolute left-0 right-0 top-0 h-0.5 overflow-hidden rounded-full bg-transparent"
            aria-hidden="true"
          >
            <div
              className={`h-full w-full bg-gradient-to-r from-jarvis-purple via-jarvis-blue to-jarvis-green transition-opacity duration-200 ${
                isRefreshing ? "opacity-100 animate-pulse" : "opacity-0"
              }`}
            />
          </div>

          {isInitialLoading ? (
            <div className="flex h-[60vh] items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-jarvis-purple border-t-transparent" />
            </div>
          ) : (
            <>
              <ScoreStatusPanel
                scoring={!!scoreTaskId}
                progress={scoreProgress}
                lastSummary={lastScoreSummary}
                statusUnavailable={scoreStatusUnavailable}
                pollFailures={scorePollFailures}
                jobs={jobs}
              />

              {activeSection === "dashboard" && (
                <Dashboard jobs={jobs} cvData={cvData ?? null} onGenerateForJob={handleGenerateJob} />
              )}
              {activeSection === "jobs" && (
                <JobFeed
                  jobs={jobs}
                  onGenerateForJob={handleGenerateJob}
                  onScoreAll={() => {
                    if (!isScoring) {
                      scoreMutation.mutate();
                    }
                  }}
                  isScoring={isScoring}
                  scoreButtonLabel={scoreButtonLabel}
                />
              )}
              {activeSection === "applications" && <Applications jobs={jobs} onViewJob={() => setActiveSection("jobs")} />}
              {activeSection === "profile" && user && <ProfilePage user={user} jobs={jobs} />}
              {activeSection === "templates" && <TemplatesPage />}
              {activeSection === "leaderboard" && <LeaderboardPage />}
            </>
          )}
        </main>

        <GenerateModal job={generateJob} open={!!generateJob} onClose={() => setGenerateJob(null)} />
        <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        <JarvisChat />
      </div>
    </ProtectedRoute>
  );
}
