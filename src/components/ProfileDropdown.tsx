import { useState, useRef, useEffect } from "react";
import { User, FileText, Trophy, Settings, LogOut, LayoutTemplate } from "lucide-react";
import { Section } from "./JarvisSidebar";

export interface UserData {
  id: number;
  name: string;
  email: string;
  target_role: string;
  plan: string;
  avatar: null;
}

interface ProfileDropdownProps {
  user: UserData;
  onNavigate: (s: Section) => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}

export function ProfileDropdown({ user, onNavigate, onOpenSettings, onLogout }: ProfileDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const initials = user.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);

  const items = [
    { icon: User, label: "My Profile", action: () => { onNavigate("profile"); setOpen(false); } },
    { icon: FileText, label: "My Documents", action: () => { onNavigate("profile"); setOpen(false); } },
    { icon: Trophy, label: "Leaderboard", action: () => { onNavigate("leaderboard"); setOpen(false); } },
    { icon: LayoutTemplate, label: "Templates", action: () => { onNavigate("templates"); setOpen(false); } },
    { icon: Settings, label: "Settings", action: () => { onOpenSettings(); setOpen(false); } },
  ];

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className="h-9 w-9 rounded-full flex items-center justify-center font-display font-semibold text-[13px] text-foreground transition-all hover:scale-105" style={{ background: "linear-gradient(135deg, #8B5CF6, #3B82F6)" }}>
        {initials}
      </button>

      {open && (
        <div className="absolute top-12 right-0 w-[220px] glass-surface glow-purple p-3 space-y-1 animate-fade-up" style={{ zIndex: 100 }}>
          <div className="flex items-center gap-3 pb-3 border-b border-border/30 mb-1">
            <div className="h-10 w-10 rounded-full flex items-center justify-center font-display font-semibold text-sm text-foreground shrink-0" style={{ background: "linear-gradient(135deg, #8B5CF6, #3B82F6)" }}>
              {initials}
            </div>
            <div className="min-w-0">
              <p className="font-display font-semibold text-sm text-foreground truncate">{user.name}</p>
              <p className="font-mono text-[11px] text-muted-foreground truncate">{user.target_role}</p>
              <span className="font-mono text-[9px] uppercase px-1.5 py-0.5 rounded-full mt-0.5 inline-block"
                style={user.plan === "pro" || user.plan === "Pro"
                  ? { background: "linear-gradient(135deg, #8B5CF6, #3B82F6)", color: "white" }
                  : { background: "rgba(107,114,128,0.2)", color: "#6B7280" }}>
                {user.plan}
              </span>
            </div>
          </div>

          {items.map(item => (
            <button key={item.label} onClick={item.action} className="w-full flex items-center gap-2.5 px-3 py-2 rounded font-display text-[13px] text-foreground hover:bg-jarvis-purple/[0.07] transition-colors">
              <item.icon className="h-4 w-4 text-muted-foreground" />
              {item.label}
            </button>
          ))}

          <div className="border-t border-border/30 pt-1 mt-1">
            <button onClick={() => { onLogout(); setOpen(false); }} className="w-full flex items-center gap-2.5 px-3 py-2 rounded font-display text-[13px] text-jarvis-crimson hover:bg-jarvis-crimson/10 transition-colors">
              <LogOut className="h-4 w-4" />
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}