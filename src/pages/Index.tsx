import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchJobs, fetchLatestCV, fetchScoreAllStatus, scoreAll, type CVLatestResponse } from "@/lib/api";
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
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

export default function Index() {
  const [activeSection, setActiveSection] = useState<Section>("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generateJob, setGenerateJob] = useState<Job | null>(null);
  const [scoreTaskId, setScoreTaskId] = useState<string | null>(null);
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
      completionToastShownRef.current = false;
      setScoreTaskId(data.task_id);
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

  const { data: scoreTaskStatus } = useQuery({
    queryKey: ["scoreAllStatus", scoreTaskId],
    queryFn: () => fetchScoreAllStatus(scoreTaskId!),
    enabled: isAuthenticated && !!scoreTaskId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "SUCCESS" || status === "FAILURE" ? false : 3000;
    },
  });

  useEffect(() => {
    if (!scoreTaskId || !scoreTaskStatus || completionToastShownRef.current) {
      return;
    }

    if (scoreTaskStatus.status === "SUCCESS") {
      completionToastShownRef.current = true;
      setScoreTaskId(null);
      queryClient.invalidateQueries({ queryKey: ["jobs"] });

      const scored = scoreTaskStatus.result?.scored ?? 0;
      const errors = scoreTaskStatus.result?.errors ?? [];
      const errorSummary = errors.length ? ` ${errors.length} jobs returned errors.` : "";

      toast({
        title: "Scoring complete",
        description: `JARVIS finished scoring ${scored} job${scored === 1 ? "" : "s"}.${errorSummary}`,
      });
      return;
    }

    if (scoreTaskStatus.status === "FAILURE") {
      completionToastShownRef.current = true;
      setScoreTaskId(null);
      toast({
        title: "Scoring task failed",
        description: scoreTaskStatus.error || "The background scoring worker failed.",
        variant: "destructive",
      });
    }
  }, [queryClient, scoreTaskId, scoreTaskStatus]);

  const isScoringQueued = !!scoreTaskId;
  const isScoring = scoreMutation.isPending || isScoringQueued;
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

      {/* Top-right: CV status + Profile */}
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
          <div className="flex items-center justify-center h-[60vh]">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-jarvis-purple border-t-transparent" />
          </div>
        ) : (
          <>
            {activeSection === "dashboard" && (
              <Dashboard
                jobs={jobs}
                cvData={cvData ?? null}
                onGenerateForJob={j => setGenerateJob(j)}
              />
            )}
            {activeSection === "jobs" && (
              <JobFeed jobs={jobs} onGenerateForJob={j => setGenerateJob(j)} onScoreAll={() => scoreMutation.mutate()} isScoring={isScoring} />
            )}
            {activeSection === "applications" && (
              <Applications jobs={jobs} onViewJob={() => setActiveSection("jobs")} />
            )}
            {activeSection === "profile" && user && (
              <ProfilePage user={user} jobs={jobs} />
            )}
            {activeSection === "templates" && (
              <TemplatesPage />
            )}
            {activeSection === "leaderboard" && (
              <LeaderboardPage />
            )}
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
