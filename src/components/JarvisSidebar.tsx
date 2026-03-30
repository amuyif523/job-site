import { useState, useEffect } from "react";
import { LayoutDashboard, Briefcase, CheckSquare, Settings, ChevronLeft, Play, Loader2, Trophy, LayoutTemplate, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { getToken } from "@/lib/api";

export type Section = "dashboard" | "jobs" | "applications" | "profile" | "templates" | "leaderboard";

interface SidebarProps {
  active: Section;
  onNavigate: (s: Section) => void;
  onOpenSettings: () => void;
}

const navItems: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: "dashboard",    label: "Dashboard",    icon: LayoutDashboard },
  { id: "jobs",         label: "Jobs",         icon: Briefcase },
  { id: "applications", label: "Applications", icon: CheckSquare },
  { id: "leaderboard",  label: "Leaderboard",  icon: Trophy },
  { id: "templates",    label: "Templates",    icon: LayoutTemplate },
];

const SCRAPE_KEY = "jarvis_last_scrape";

function getLastScrape(): number | null {
  const v = localStorage.getItem(SCRAPE_KEY);
  return v ? parseInt(v) : null;
}

function canScrape(): boolean {
  const last = getLastScrape();
  if (!last) return true;
  return Date.now() - last > 24 * 60 * 60 * 1000;
}

function timeUntilNextScrape(): string {
  const last = getLastScrape();
  if (!last) return "";
  const ms = 24 * 60 * 60 * 1000 - (Date.now() - last);
  if (ms <= 0) return "";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

export function Sidebar({ active, onNavigate, onOpenSettings }: SidebarProps) {
  const [collapsed, setCollapsed]   = useState(false);
  const [scraping, setScraping]     = useState(false);
  const [cooldown, setCooldown]     = useState(!canScrape());
  const [timeLeft, setTimeLeft]     = useState(timeUntilNextScrape());
  const queryClient = useQueryClient();

  // Update cooldown timer every minute
  useEffect(() => {
    const interval = setInterval(() => {
      const can = canScrape();
      setCooldown(!can);
      setTimeLeft(timeUntilNextScrape());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Poll scrape status while running
  useEffect(() => {
    if (!scraping) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("http://localhost:8000/api/scrape/status", {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        const data = await res.json();

        if (data.status.startsWith("done:")) {
          const count = data.status.split(":")[1];
          setScraping(false);
          queryClient.invalidateQueries({ queryKey: ["jobs"] });
          toast({ title: `✅ Scrape complete — ${count} new jobs added` });
        } else if (data.status.startsWith("error:")) {
          setScraping(false);
          toast({ title: "Scraper failed", variant: "destructive" });
        }
      } catch {
        setScraping(false);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [scraping, queryClient]);

  const handleScrape = async () => {
    if (!canScrape() || scraping) return;

    try {
      const res = await fetch("http://localhost:8000/api/scrape", {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();

      if (data.status === "started") {
        setScraping(true);
        localStorage.setItem(SCRAPE_KEY, Date.now().toString());
        setCooldown(true);
        toast({ title: "🔍 Scraping jobs...", description: "This may take a minute" });
      } else if (data.status === "already_running") {
        setScraping(true);
        toast({ title: "Already scraping..." });
      }
    } catch {
      toast({ title: "Failed to start scraper", variant: "destructive" });
    }
  };

  const scrapeDisabled = scraping || cooldown;

  return (
    <aside
      className="fixed left-0 top-0 h-screen flex flex-col transition-all duration-250 ease-in-out"
      style={{
        width: collapsed ? 52 : 200,
        zIndex: 10,
        background: "#090912",
        borderRight: "1px solid rgba(139,92,246,0.12)",
      }}
    >
      {/* Logo + toggle */}
      <div className="flex items-center justify-between p-3 h-14">
        {!collapsed ? (
          <span className="text-gradient-purple font-display font-bold text-[17px] tracking-[4px]">JARVIS</span>
        ) : (
          <span className="text-gradient-purple font-display font-bold text-[17px] mx-auto">J</span>
        )}
        <button onClick={() => setCollapsed(!collapsed)} className="text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className={cn("h-4 w-4 transition-transform duration-200", collapsed && "rotate-180")} />
        </button>
      </div>

      {/* Nav items */}
      <nav className="flex-1 flex flex-col gap-1 px-2 mt-2">
        {navItems.map((item) => {
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={cn(
                "flex items-center gap-3 rounded-md transition-all duration-150",
                collapsed ? "justify-center py-3 px-0" : "py-[11px] px-4",
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

      {/* Bottom: scrape + settings */}
      <div className="p-2 flex flex-col gap-1">

        {/* Scrape button */}
        <button
          onClick={handleScrape}
          disabled={scrapeDisabled}
          title={cooldown && !scraping ? `Next scrape in ${timeLeft}` : "Scrape jobs"}
          className={cn(
            "flex items-center gap-2 rounded-md py-2 transition-all duration-150 border",
            collapsed ? "justify-center px-0" : "px-3",
            scrapeDisabled
              ? "border-muted/20 text-muted-foreground cursor-not-allowed opacity-50"
              : "border-jarvis-crimson/40 text-jarvis-crimson hover:bg-jarvis-crimson hover:text-foreground"
          )}
        >
          {scraping ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : cooldown ? (
            <Clock className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {!collapsed && (
            <span className="font-display text-[11px] font-medium uppercase">
              {scraping ? "Scraping..." : cooldown ? timeLeft : "Scrape"}
            </span>
          )}
        </button>

        <button
          onClick={onOpenSettings}
          className={cn(
            "flex items-center gap-2 rounded-md py-2 text-muted-foreground hover:text-foreground transition-colors",
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
