import { useState } from "react";
import { GlassCard } from "./GlassCard";
import { X, Eye, EyeOff } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [claudeKey, setClaudeKey] = useState(() => localStorage.getItem("jarvis_claude_key") || "");
  const [geminiKey, setGeminiKey] = useState(() => localStorage.getItem("jarvis_gemini_key") || "");
  const [showClaude, setShowClaude] = useState(false);
  const [showGemini, setShowGemini] = useState(false);
  const [threshold, setThreshold] = useState(() => Number(localStorage.getItem("jarvis_threshold") || "50"));
  const [saved, setSaved] = useState(false);

  if (!open) return null;

  const handleSave = () => {
    localStorage.setItem("jarvis_claude_key", claudeKey);
    localStorage.setItem("jarvis_gemini_key", geminiKey);
    localStorage.setItem("jarvis_threshold", String(threshold));
    setSaved(true);
    toast({ title: "Settings saved" });
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 100, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div onClick={e => e.stopPropagation()} className="w-[480px] animate-fade-up">
        <GlassCard className="p-6" hover={false}>
          <div className="flex justify-between items-center mb-5">
            <h2 className="text-gradient-purple font-display font-bold text-lg">Settings</h2>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
          </div>

          <div className="space-y-4">
            {/* Claude Key */}
            <div>
              <label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Claude API Key</label>
              <div className="relative mt-1">
                <input
                  type={showClaude ? "text" : "password"}
                  value={claudeKey}
                  onChange={e => setClaudeKey(e.target.value)}
                  placeholder="sk-ant-..."
                  className="w-full glass-surface px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:shadow-[0_0_0_2px_rgba(139,92,246,0.5)] rounded-lg pr-9"
                />
                <button onClick={() => setShowClaude(!showClaude)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {showClaude ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            {/* Gemini Key */}
            <div>
              <label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Gemini API Key</label>
              <div className="relative mt-1">
                <input
                  type={showGemini ? "text" : "password"}
                  value={geminiKey}
                  onChange={e => setGeminiKey(e.target.value)}
                  placeholder="AI..."
                  className="w-full glass-surface px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:shadow-[0_0_0_2px_rgba(139,92,246,0.5)] rounded-lg pr-9"
                />
                <button onClick={() => setShowGemini(!showGemini)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {showGemini ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            {/* Threshold */}
            <div>
              <label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Default Match Threshold: {threshold}</label>
              <input
                type="range" min={0} max={100} step={5} value={threshold}
                onChange={e => setThreshold(Number(e.target.value))}
                className="w-full mt-2 accent-jarvis-purple h-1"
              />
            </div>

            <button
              onClick={handleSave}
              className="w-full py-3 rounded-md font-display font-bold text-[13px] uppercase text-foreground transition-all"
              style={{ background: saved ? "#10B981" : "linear-gradient(135deg, #8B5CF6, #3B82F6)" }}
            >
              {saved ? "✓ SAVED" : "SAVE SETTINGS"}
            </button>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
