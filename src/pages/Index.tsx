import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchJobs, scoreAll } from "@/lib/api";
import { Job } from "@/types/job";
import { ParticleBackground } from "@/components/ParticleBackground";
import { Sidebar, Section } from "@/components/JarvisSidebar";
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generateJob, setGenerateJob] = useState<Job | null>(null);
  const { isAuthenticated, isAuthLoading, user, setAuthenticatedUser, logout } = useAuth();
  const queryClient = useQueryClient();

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["jobs"],
    queryFn: fetchJobs,
    enabled: isAuthenticated,
  });

  const scoreMutation = useMutation({
    mutationFn: scoreAll,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast({ title: `Scored ${data.scored} jobs` });
    },
    onError: () => toast({ title: "Scoring failed", variant: "destructive" }),
  });

  const handleLogin = (userData: UserData) => {
    setAuthenticatedUser(userData);
  };

  const handleLogout = () => {
    logout();
    setActiveSection("dashboard");
  };

  return (
    <ProtectedRoute
      isAuthenticated={isAuthenticated}
      isLoading={isAuthLoading}
      fallback={<LandingPage onLogin={handleLogin} />}
    >
    <div className="relative min-h-screen" style={{ background: "#07070F" }}>
      <ParticleBackground />
      <Sidebar active={activeSection} onNavigate={setActiveSection} onOpenSettings={() => setSettingsOpen(true)} />

      {/* Top-right: CV status + Profile */}
      <div className="fixed top-4 right-6 flex items-center gap-3" style={{ zIndex: 30 }}>
        <CVStatusBar />
        {user && (
          <ProfileDropdown
            user={user}
            onNavigate={setActiveSection}
            onOpenSettings={() => setSettingsOpen(true)}
            onLogout={handleLogout}
          />
        )}
      </div>

      <main
        className="relative transition-all duration-250 ease-in-out pt-4 px-6 pb-6"
        style={{ marginLeft: 200, zIndex: 1 }}
      >
        {/* Spacer for top bar */}
        <div className="h-10" />

        {isLoading ? (
          <div className="flex items-center justify-center h-[60vh]">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-jarvis-purple border-t-transparent" />
          </div>
        ) : (
          <>
            {activeSection === "dashboard" && (
              <Dashboard jobs={jobs} onGenerateForJob={j => setGenerateJob(j)} />
            )}
            {activeSection === "jobs" && (
              <JobFeed jobs={jobs} onGenerateForJob={j => setGenerateJob(j)} onScoreAll={() => scoreMutation.mutate()} isScoring={scoreMutation.isPending} />
            )}
            {activeSection === "applications" && (
              <Applications jobs={jobs} onViewJob={() => setActiveSection("jobs")} />
            )}
            {activeSection === "profile" && user && (
              <ProfilePage user={user} />
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
