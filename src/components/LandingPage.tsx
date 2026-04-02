import { useState } from "react";
import { Link } from "react-router-dom";
import { GlassCard } from "./GlassCard";
import { ParticleBackground } from "./ParticleBackground";
import { Eye, EyeOff, Zap, FileText, Globe, Trophy } from "lucide-react";
import { ApiError, apiLogin, apiRegister, UserData } from "@/lib/api.ts";

interface LandingPageProps {
  onLogin: (user: UserData) => void;
}

export function LandingPage({ onLogin }: LandingPageProps) {
  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [targetRole, setTargetRole] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError("");
    setLoading(true);
    try {
      let data;
      if (tab === "signin") {
        data = await apiLogin(email, password);
      } else {
        if (!name.trim()) { setError("Name is required"); setLoading(false); return; }
        data = await apiRegister(name, email, password, confirmPassword, targetRole);
      }
      onLogin({ ...data.user, avatar: null });
    } catch (err) {
      if (err instanceof ApiError || err instanceof Error) {
        setError(err.message || "Something went wrong");
      } else {
        setError("Something went wrong");
      }
    } finally {
      setLoading(false);
    }
  };

  // Google/LinkedIn/Apple → same real auth flow, just pre-fills the tab
  const handleProviderClick = (provider: string) => {
    setTab("signup");
    setError(`${provider} OAuth coming soon — create an account below.`);
  };

  const features = [
    { icon: Zap, text: "AI match scoring against your CV" },
    { icon: FileText, text: "Tailored CVs & cover letters in seconds" },
    { icon: Globe, text: "Multi-language output — EN, DE, FR, ES, AR, ZH" },
    { icon: Trophy, text: "Community-ranked templates with real callback data" },
  ];

  return (
    <div className="relative min-h-screen flex items-center justify-center" style={{ background: "#07070F" }}>
      <ParticleBackground />

      <div className="relative z-[1] flex w-full max-w-[1100px] mx-auto px-8 gap-12 items-center">
        {/* Left column */}
        <div className="w-[55%] space-y-8">
          <div>
            <h1 className="text-gradient-purple font-display font-bold text-[28px] tracking-[4px] mb-6">JARVIS</h1>
            <p className="font-display font-bold text-[48px] text-foreground leading-[1.1] mb-4">
              Your AI Job Search Copilot
            </p>
            <p className="font-display text-lg text-muted-foreground max-w-[480px]">
              Discovers jobs, scores matches, writes tailored CVs and cover letters. One click to apply.
            </p>
          </div>

          <div className="space-y-3">
            {features.map((f, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, #8B5CF6, #3B82F6)" }}>
                  <f.icon className="h-4 w-4 text-foreground" />
                </div>
                <span className="font-display text-sm text-foreground">{f.text}</span>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-4">
            <div className="flex -space-x-2">
              {["JS", "AK", "LM"].map((initials, i) => (
                <div key={i} className="h-7 w-7 rounded-full flex items-center justify-center font-mono text-[9px] font-bold text-foreground border-2 border-background"
                  style={{ background: `linear-gradient(135deg, ${i === 0 ? "#8B5CF6" : i === 1 ? "#3B82F6" : "#E11D48"}, ${i === 0 ? "#3B82F6" : i === 1 ? "#10B981" : "#8B5CF6"})` }}>
                  {initials}
                </div>
              ))}
            </div>
            <span className="font-mono text-[11px] text-muted-foreground">Trusted by job seekers across 12 countries</span>
          </div>
        </div>

        {/* Right column */}
        <div className="w-[45%]">
          <GlassCard className="p-8" hover={false}>
            {/* Tabs */}
            <div className="flex gap-6 mb-6 border-b border-border/30 pb-3">
              {(["signin", "signup"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => { setTab(t); setError(""); }}
                  className={`font-mono text-[11px] uppercase tracking-wider pb-1 transition-colors ${tab === t ? "text-foreground border-b-2 border-jarvis-purple" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {t === "signin" ? "Sign In" : "Sign Up"}
                </button>
              ))}
            </div>

            <div className="space-y-4">
              {tab === "signup" && (
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground block mb-1.5">Name</label>
                  <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name"
                    className="w-full px-3 py-2.5 bg-transparent glass-surface font-display text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:shadow-[0_0_0_2px_rgba(139,92,246,0.5)]" />
                </div>
              )}

              <div>
                <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground block mb-1.5">Email</label>
                <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="you@example.com"
                  className="w-full px-3 py-2.5 bg-transparent glass-surface font-display text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:shadow-[0_0_0_2px_rgba(139,92,246,0.5)]" />
              </div>

              <div>
                <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground block mb-1.5">Password</label>
                <div className="relative">
                  <input value={password} onChange={e => setPassword(e.target.value)} type={showPassword ? "text" : "password"} placeholder="••••••••"
                    className="w-full px-3 py-2.5 pr-10 bg-transparent glass-surface font-display text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:shadow-[0_0_0_2px_rgba(139,92,246,0.5)]"
                    onKeyDown={e => e.key === "Enter" && handleSubmit()} />
                  <button onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {tab === "signup" && (
                <>
                  <div>
                    <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground block mb-1.5">Confirm Password</label>
                    <input value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} type="password" placeholder="••••••••"
                      className="w-full px-3 py-2.5 bg-transparent glass-surface font-display text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:shadow-[0_0_0_2px_rgba(139,92,246,0.5)]" />
                  </div>
                  <div>
                    <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground block mb-1.5">Target Role</label>
                    <input value={targetRole} onChange={e => setTargetRole(e.target.value)} placeholder="e.g. Data Scientist, Product Manager"
                      className="w-full px-3 py-2.5 bg-transparent glass-surface font-display text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:shadow-[0_0_0_2px_rgba(139,92,246,0.5)]" />
                  </div>
                </>
              )}

              {/* Error message */}
              {error && (
                <p className="font-mono text-[11px] text-red-400 bg-red-400/10 border border-red-400/20 px-3 py-2 rounded">
                  {error}
                </p>
              )}

              <button
                onClick={handleSubmit}
                disabled={loading}
                className="w-full py-3 rounded-md font-display font-semibold text-[13px] uppercase text-foreground transition-all hover:scale-[1.01] disabled:opacity-60 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(135deg, #8B5CF6, #3B82F6)", boxShadow: "0 0 20px rgba(139,92,246,0.35)" }}
              >
                {loading ? "Please wait..." : tab === "signin" ? "Sign In" : "Create Account"}
              </button>

              <div className="flex items-center gap-3 my-2">
                <div className="flex-1 h-px bg-border/50" />
                <span className="font-mono text-[10px] text-muted-foreground">or continue with</span>
                <div className="flex-1 h-px bg-border/50" />
              </div>

              <div className="grid grid-cols-3 gap-2">
                {["Google", "LinkedIn", "Apple"].map(provider => (
                  <button key={provider} onClick={() => handleProviderClick(provider)}
                    className="glass-surface py-2.5 rounded-md font-display text-[12px] text-foreground hover:bg-foreground/[0.05] transition-all">
                    {provider}
                  </button>
                ))}
              </div>

              {tab === "signin" && (
                <div className="text-right mt-1">
                  <Link
                    to="/forgot-password"
                    className="font-mono text-[10px] text-muted-foreground hover:text-foreground underline"
                  >
                    Forgot password?
                  </Link>
                </div>
              )}
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
