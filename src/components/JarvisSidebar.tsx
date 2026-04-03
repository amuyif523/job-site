import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Briefcase,
  CheckSquare,
  Settings,
  ChevronLeft,
  Play,
  Loader2,
  Trophy,
  LayoutTemplate,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Radar,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { fetchScrapeStatus, runScraper, type ScrapeTaskProgress } from "@/lib/api";
import { Progress } from "@/components/ui/progress";

export type Section = "dashboard" | "jobs" | "applications" | "profile" | "templates" | "leaderboard";
export const SIDEBAR_EXPANDED_WIDTH = 200;
export const SIDEBAR_COLLAPSED_WIDTH = 52;

interface SidebarProps {
  active: Section;
  collapsed: boolean;
  onNavigate: (s: Section) => void;
  onOpenSettings: () => void;
  onCollapsedChange: (collapsed: boolean) => void;
  userId?: number | null;
  targetRole?: string;
}

interface ScrapeRunSummary {
  status: "success" | "failure";
  timestamp: number;
  source: string;
  targetRole: string;
  jobsFound: number;
  jobsSaved: number;
  error?: string | null;
}

const navItems: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "jobs", label: "Jobs", icon: Briefcase },
  { id: "applications", label: "Applications", icon: CheckSquare },
  { id: "leaderboard", label: "Leaderboard", icon: Trophy },
  { id: "templates", label: "Templates", icon: LayoutTemplate },
];

const SCRAPE_KEY = "jarvis_last_scrape";
const ACTIVE_SCRAPE_TASK_KEY = "jarvis_active_scrape_task_id";
const ACTIVE_SCRAPE_PROGRESS_KEY = "jarvis_active_scrape_progress";
const LAST_SCRAPE_SUMMARY_KEY = "jarvis_last_scrape_summary";
const BASE_POLL_INTERVAL_MS = 3000;
const MAX_POLL_INTERVAL_MS = 30000;
const PHASE_STEPS: ScrapeTaskProgress["phase"][] = [
  "queued",
  "launching_browser",
  "loading_page",
  "extracting_jobs",
  "saving_jobs",
  "completed",
];

function getStorageKey(baseKey: string, userId: number | null | undefined): string {
  if (userId == null) {
    return baseKey;
  }
  return `${baseKey}:${userId}`;
}

function getLastScrape(userId: number | null | undefined): number | null {
  const value = localStorage.getItem(getStorageKey(SCRAPE_KEY, userId));
  return value ? Number.parseInt(value, 10) : null;
}

function getStoredTaskId(userId: number | null | undefined): string | null {
  return localStorage.getItem(getStorageKey(ACTIVE_SCRAPE_TASK_KEY, userId));
}

function storeTaskId(taskId: string | null, userId: number | null | undefined): void {
  const storageKey = getStorageKey(ACTIVE_SCRAPE_TASK_KEY, userId);
  if (!taskId) {
    localStorage.removeItem(storageKey);
    return;
  }
  localStorage.setItem(storageKey, taskId);
}

function getStoredProgress(userId: number | null | undefined): ScrapeTaskProgress | null {
  const storageKey = getStorageKey(ACTIVE_SCRAPE_PROGRESS_KEY, userId);
  const raw = localStorage.getItem(storageKey);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as ScrapeTaskProgress;
  } catch {
    localStorage.removeItem(storageKey);
    return null;
  }
}

function storeProgress(progress: ScrapeTaskProgress | null, userId: number | null | undefined): void {
  const storageKey = getStorageKey(ACTIVE_SCRAPE_PROGRESS_KEY, userId);
  if (!progress) {
    localStorage.removeItem(storageKey);
    return;
  }
  localStorage.setItem(storageKey, JSON.stringify(progress));
}

function getLastRunSummary(userId: number | null | undefined): ScrapeRunSummary | null {
  const storageKey = getStorageKey(LAST_SCRAPE_SUMMARY_KEY, userId);
  const raw = localStorage.getItem(storageKey);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as ScrapeRunSummary;
  } catch {
    localStorage.removeItem(storageKey);
    return null;
  }
}

function storeLastRunSummary(summary: ScrapeRunSummary | null, userId: number | null | undefined): void {
  const storageKey = getStorageKey(LAST_SCRAPE_SUMMARY_KEY, userId);
  if (!summary) {
    localStorage.removeItem(storageKey);
    return;
  }
  localStorage.setItem(storageKey, JSON.stringify(summary));
}

function canScrape(userId: number | null | undefined): boolean {
  const last = getLastScrape(userId);
  if (!last) return true;
  return Date.now() - last > 24 * 60 * 60 * 1000;
}

function timeUntilNextScrape(userId: number | null | undefined): string {
  const last = getLastScrape(userId);
  if (!last) return "";
  const ms = 24 * 60 * 60 * 1000 - (Date.now() - last);
  if (ms <= 0) return "";
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

function formatScrapePhase(progress: ScrapeTaskProgress | null): string {
  if (!progress) return "Scraping...";

  switch (progress.phase) {
    case "queued":
      return "Queued...";
    case "launching_browser":
      return "Launching browser...";
    case "loading_page":
      return progress.page > 0 ? `Loading page ${progress.page}` : "Loading listings...";
    case "extracting_jobs":
      return progress.jobs_found > 0 ? `Found ${progress.jobs_found} jobs` : "Extracting jobs...";
    case "saving_jobs":
      return progress.jobs_saved > 0 ? `Saving ${progress.jobs_saved} jobs` : "Saving jobs...";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    default:
      return "Scraping...";
  }
}

function getApproximateProgress(progress: ScrapeTaskProgress | null): number {
  if (!progress) return 10;
  if (progress.phase === "failed") return 100;

  const stepIndex = Math.max(PHASE_STEPS.indexOf(progress.phase), 0);
  return Math.round((stepIndex / (PHASE_STEPS.length - 1)) * 100);
}

function formatTimestamp(timestamp: number | null): string {
  if (!timestamp) return "Not yet available";
  return new Date(timestamp).toLocaleString();
}

function getFailureGuidance(error?: string | null): { label: string; guidance: string } {
  const message = (error || "").toLowerCase();

  if (
    message.includes("executable doesn't exist") ||
    message.includes("browserType.launch".toLowerCase()) ||
    message.includes("playwright")
  ) {
    return {
      label: "Browser setup issue",
      guidance: "Install Playwright browsers, then retry the scrape.",
    };
  }

  if (
    message.includes("redis") ||
    message.includes("worker") ||
    message.includes("broker") ||
    message.includes("connection refused")
  ) {
    return {
      label: "Worker unavailable",
      guidance: "Check Redis and confirm the Celery worker is running before retrying.",
    };
  }

  if (
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("navigation") ||
    message.includes("net::") ||
    message.includes("dns")
  ) {
    return {
      label: "Network or site issue",
      guidance: "Retry later or check network access to JobTeaser.",
    };
  }

  return {
    label: "Parsing failure",
    guidance: "Retry the scrape. If it keeps failing, the JobTeaser page structure may have changed.",
  };
}

function buildRunSummary(
  status: "success" | "failure",
  progress: ScrapeTaskProgress | null,
  fallbackRole: string,
  error?: string | null
): ScrapeRunSummary {
  return {
    status,
    timestamp: Date.now(),
    source: progress?.source || "JobTeaser",
    targetRole: progress?.target_role || fallbackRole,
    jobsFound: progress?.jobs_found ?? 0,
    jobsSaved: progress?.jobs_saved ?? 0,
    error: error || null,
  };
}

function clearActiveScrapeStorage(userId: number | null | undefined): void {
  storeTaskId(null, userId);
  storeProgress(null, userId);
}

function getStatusPanelTitle(scraping: boolean, progress: ScrapeTaskProgress | null, lastRunSummary: ScrapeRunSummary | null): string {
  if (scraping) {
    return formatScrapePhase(progress);
  }

  if (!lastRunSummary) {
    return "Ready to scan JobTeaser";
  }

  if (lastRunSummary.status === "success") {
    if (lastRunSummary.jobsFound === 0) {
      return "Last scrape found no matching jobs";
    }

    return `Last scrape saved ${lastRunSummary.jobsSaved} jobs`;
  }

  return "Last scrape failed";
}

export function Sidebar({
  active,
  collapsed,
  onNavigate,
  onOpenSettings,
  onCollapsedChange,
  userId = null,
  targetRole = "",
}: SidebarProps) {
  const [scraping, setScraping] = useState(Boolean(getStoredTaskId(userId)));
  const [scrapeTaskId, setScrapeTaskId] = useState<string | null>(() => getStoredTaskId(userId));
  const [scrapeProgress, setScrapeProgress] = useState<ScrapeTaskProgress | null>(() => getStoredProgress(userId));
  const [cooldown, setCooldown] = useState(!canScrape(userId));
  const [timeLeft, setTimeLeft] = useState(timeUntilNextScrape(userId));
  const [pollFailures, setPollFailures] = useState(0);
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const [lastRunSummary, setLastRunSummary] = useState<ScrapeRunSummary | null>(() => getLastRunSummary(userId));
  const queryClient = useQueryClient();

  useEffect(() => {
    const storedTaskId = getStoredTaskId(userId);
    setScrapeTaskId(storedTaskId);
    setScraping(Boolean(storedTaskId));
    setScrapeProgress(getStoredProgress(userId));
    setLastRunSummary(getLastRunSummary(userId));
    setCooldown(!canScrape(userId));
    setTimeLeft(timeUntilNextScrape(userId));
    setStatusUnavailable(false);
    setPollFailures(0);
  }, [userId]);

  useEffect(() => {
    const interval = setInterval(() => {
      const available = canScrape(userId);
      setCooldown(!available);
      setTimeLeft(timeUntilNextScrape(userId));
    }, 60000);
    return () => clearInterval(interval);
  }, [userId]);

  useEffect(() => {
    if (!scrapeTaskId) return;

    setScraping(true);
    if (!scrapeProgress) {
      const queuedProgress: ScrapeTaskProgress = {
        phase: "queued",
        page: 0,
        jobs_found: 0,
        jobs_saved: 0,
        target_role: targetRole,
        source: "JobTeaser",
      };
      setScrapeProgress(queuedProgress);
      storeProgress(queuedProgress, userId);
    }
  }, [scrapeProgress, scrapeTaskId, targetRole, userId]);

  useEffect(() => {
    if (!scrapeTaskId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failureCount = 0;

    const scheduleNextPoll = (delayMs: number) => {
      if (cancelled) return;
      timer = setTimeout(() => {
        void pollStatus();
      }, delayMs);
    };

    const finishScrape = (summary: ScrapeRunSummary, progress: ScrapeTaskProgress | null) => {
      setScraping(false);
      setScrapeTaskId(null);
      setScrapeProgress(progress);
      setStatusUnavailable(false);
      setPollFailures(0);
      setLastRunSummary(summary);
      storeLastRunSummary(summary, userId);
      clearActiveScrapeStorage(userId);
    };

    const pollStatus = async () => {
      try {
        const data = await fetchScrapeStatus(scrapeTaskId);
        if (cancelled) return;

        failureCount = 0;
        setPollFailures(0);
        setStatusUnavailable(false);
        setScrapeProgress(data.progress);
        storeProgress(data.progress, userId);

        if (data.status === "success") {
          const summary = buildRunSummary("success", data.progress, targetRole);
          finishScrape(summary, data.progress);
          localStorage.setItem(getStorageKey(SCRAPE_KEY, userId), Date.now().toString());
          setCooldown(true);
          setTimeLeft(timeUntilNextScrape(userId));
          queryClient.invalidateQueries({ queryKey: ["jobs"] });

          if ((data.progress.jobs_found ?? 0) === 0) {
            toast({
              title: "JobTeaser finished with no matches",
              description: "Try broadening your target role, relaxing your search terms, or retrying later.",
            });
          } else {
            toast({
              title: "Scrape complete",
              description: `JobTeaser found ${data.progress.jobs_found} jobs and saved ${data.progress.jobs_saved}.`,
            });
          }
          return;
        }

        if (data.status === "failure") {
          const guidance = getFailureGuidance(data.error);
          const summary = buildRunSummary("failure", data.progress, targetRole, data.error);
          finishScrape(summary, data.progress);
          toast({
            title: guidance.label,
            description: data.error ? `${data.error} ${guidance.guidance}` : guidance.guidance,
            variant: "destructive",
          });
          return;
        }

        scheduleNextPoll(BASE_POLL_INTERVAL_MS);
      } catch {
        if (cancelled) return;

        failureCount += 1;
        const backoffMs = Math.min(BASE_POLL_INTERVAL_MS * 2 ** (failureCount - 1), MAX_POLL_INTERVAL_MS);
        setPollFailures(failureCount);
        setStatusUnavailable(true);
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
  }, [queryClient, scrapeTaskId, targetRole, userId]);

  const handleScrape = async () => {
    if (scrapeTaskId || !canScrape(userId)) return;

    try {
      const data = await runScraper();

      if ((data.status === "queued" || data.status === "started") && data.task_id) {
        const queuedProgress: ScrapeTaskProgress = {
          phase: "queued",
          page: 0,
          jobs_found: 0,
          jobs_saved: 0,
          target_role: targetRole,
          source: "JobTeaser",
        };

        setScraping(true);
        setScrapeTaskId(data.task_id);
        setScrapeProgress(queuedProgress);
        setStatusUnavailable(false);
        setPollFailures(0);
        storeTaskId(data.task_id, userId);
        storeProgress(queuedProgress, userId);
        toast({
          title: "JobTeaser scrape queued",
          description: data.message || "JARVIS will scan JobTeaser in the background.",
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "The scraper could not be queued.";
      const guidance = getFailureGuidance(message);
      toast({
        title: "Failed to start scraper",
        description: `${message} ${guidance.guidance}`,
        variant: "destructive",
      });
    }
  };

  const scrapeDisabled = Boolean(scrapeTaskId) || cooldown;
  const scrapeButtonLabel = scrapeTaskId ? formatScrapePhase(scrapeProgress) : cooldown ? timeLeft : "Scrape";
  const approximateProgress = getApproximateProgress(scrapeProgress);
  const currentTargetRole = scrapeProgress?.target_role || lastRunSummary?.targetRole || targetRole || "your target role";
  const currentSource = scrapeProgress?.source || lastRunSummary?.source || "JobTeaser";
  const failureGuidance = lastRunSummary?.status === "failure" ? getFailureGuidance(lastRunSummary.error) : null;
  const showStatusPanel = !collapsed;

  return (
    <aside
      className="fixed left-0 top-0 flex h-screen flex-col transition-all duration-250 ease-in-out"
      style={{
        width: collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH,
        zIndex: 10,
        background: "#090912",
        borderRight: "1px solid rgba(139,92,246,0.12)",
      }}
    >
      <div className="flex h-14 items-center justify-between p-3">
        {!collapsed ? (
          <span className="text-gradient-purple font-display text-[17px] font-bold tracking-[4px]">JARVIS</span>
        ) : (
          <span className="text-gradient-purple mx-auto font-display text-[17px] font-bold">J</span>
        )}
        <button
          onClick={() => onCollapsedChange(!collapsed)}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <ChevronLeft className={cn("h-4 w-4 transition-transform duration-200", collapsed && "rotate-180")} />
        </button>
      </div>

      <nav className="mt-2 flex flex-1 flex-col gap-1 px-2">
        {navItems.map((item) => {
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={cn(
                "flex items-center gap-3 rounded-md transition-all duration-150",
                collapsed ? "justify-center px-0 py-3" : "px-4 py-[11px]",
                isActive
                  ? "border-l-[3px] border-jarvis-purple bg-jarvis-purple/[0.09] text-foreground"
                  : "border-l-[3px] border-transparent text-muted-foreground hover:bg-jarvis-purple/[0.05] hover:text-foreground"
              )}
            >
              <item.icon className="h-[18px] w-[18px] shrink-0" />
              {!collapsed && <span className="font-display text-[13px] font-medium">{item.label}</span>}
            </button>
          );
        })}
      </nav>

      <div className="flex flex-col gap-2 p-2">
        <button
          onClick={() => {
            void handleScrape();
          }}
          disabled={scrapeDisabled}
          title={
            scrapeTaskId
              ? "A JobTeaser scrape is already running"
              : cooldown
                ? `Next scrape in ${timeLeft}`
                : "Scrape jobs"
          }
          className={cn(
            "flex items-center gap-2 rounded-md border py-2 transition-all duration-150",
            collapsed ? "justify-center px-0" : "px-3",
            scrapeDisabled
              ? "cursor-not-allowed border-muted/20 text-muted-foreground opacity-50"
              : "border-jarvis-crimson/40 text-jarvis-crimson hover:bg-jarvis-crimson hover:text-foreground"
          )}
        >
          {scrapeTaskId ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : cooldown ? (
            <Clock className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {!collapsed && <span className="font-display text-[11px] font-medium uppercase">{scrapeButtonLabel}</span>}
        </button>

        {showStatusPanel && (
          <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground">Scrape Status</p>
                <p className="font-display text-[13px] font-semibold text-foreground">
                  {getStatusPanelTitle(scraping, scrapeProgress, lastRunSummary)}
                </p>
              </div>
              {scraping ? (
                <Radar className="mt-0.5 h-4 w-4 text-jarvis-blue" />
              ) : lastRunSummary?.status === "failure" ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 text-jarvis-crimson" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-jarvis-green" />
              )}
            </div>

            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                <span>{scraping ? "Approximate progress" : "Last known result"}</span>
                <span>{scraping ? `${approximateProgress}%` : lastRunSummary ? lastRunSummary.status : "idle"}</span>
              </div>
              <Progress value={scraping ? approximateProgress : lastRunSummary?.status === "failure" ? 100 : 0} className="h-2 bg-white/10" />
              {scraping && (
                <p className="font-mono text-[10px] text-muted-foreground">
                  Phase-based tracker. Progress is approximate while JobTeaser pages are still loading.
                </p>
              )}
            </div>

            <div className="mt-3 space-y-1.5 font-mono text-[11px] text-muted-foreground">
              <p>Source: {currentSource}</p>
              <p>Target role: {currentTargetRole}</p>
              <p>Filters: recent graduate and early-career listings are applied automatically.</p>
              {scraping && (
                <>
                  <p>Phase: {scrapeProgress?.phase || "queued"}</p>
                  <p>Page: {scrapeProgress?.page || 0}</p>
                  <p>Jobs found: {scrapeProgress?.jobs_found || 0}</p>
                  <p>Jobs saved: {scrapeProgress?.jobs_saved || 0}</p>
                  <p>Rule: one scrape runs at a time per browser session.</p>
                </>
              )}
              {!scraping && lastRunSummary && (
                <>
                  <p>Last run: {formatTimestamp(lastRunSummary.timestamp)}</p>
                  <p>Jobs found: {lastRunSummary.jobsFound}</p>
                  <p>Jobs saved: {lastRunSummary.jobsSaved}</p>
                  <p>Last successful scrape: {formatTimestamp(getLastScrape(userId))}</p>
                </>
              )}
              {!scraping && !lastRunSummary && (
                <>
                  <p>Source: JobTeaser job listings</p>
                  <p>Use the scrape action to look for roles matching {currentTargetRole}.</p>
                </>
              )}
            </div>

            {statusUnavailable && (
              <div className="mt-3 rounded-md border border-amber-400/20 bg-amber-400/10 px-2 py-2 font-mono text-[10px] text-amber-200">
                Status temporarily unavailable. JARVIS is keeping the task visible and retrying in the background.
                {pollFailures > 1 ? ` Retry attempt ${pollFailures}.` : ""}
              </div>
            )}

            {!scraping && lastRunSummary?.status === "success" && lastRunSummary.jobsFound === 0 && (
              <div className="mt-3 rounded-md border border-jarvis-blue/20 bg-jarvis-blue/10 px-2 py-2 font-mono text-[10px] text-jarvis-blue">
                No jobs were found this run. Try adjusting your target role, broadening search terms, or retrying later.
              </div>
            )}

            {!scraping && lastRunSummary?.status === "failure" && failureGuidance && (
              <div className="mt-3 rounded-md border border-jarvis-crimson/20 bg-jarvis-crimson/10 px-2 py-2 font-mono text-[10px] text-jarvis-crimson">
                {failureGuidance.label}: {lastRunSummary.error || "The background scrape failed."} {failureGuidance.guidance}
              </div>
            )}

            {!scraping && cooldown && (
              <div className="mt-3 rounded-md border border-white/10 bg-black/20 px-2 py-2 font-mono text-[10px] text-muted-foreground">
                Cooldown active. You can run the next JobTeaser scrape in {timeLeft}.
              </div>
            )}
          </div>
        )}

        <button
          onClick={onOpenSettings}
          className={cn(
            "flex items-center gap-2 rounded-md py-2 text-muted-foreground transition-colors hover:text-foreground",
            collapsed ? "justify-center px-0" : "px-3"
          )}
        >
          <Settings className="h-4 w-4" />
          {!collapsed && <span className="font-display text-[11px]">Settings</span>}
        </button>
      </div>
    </aside>
  );
}
