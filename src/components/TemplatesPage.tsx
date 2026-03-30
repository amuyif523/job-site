import { useState } from "react";
import { GlassCard } from "./GlassCard";

const templates = [
  { id: 1, name: "Modern", type: "CV", tags: ["ATS-Optimized", "English"], ranked: true, callback: "42%", users: 2847, color: "#3B82F6" },
  { id: 2, name: "Minimal", type: "CV", tags: ["Clean", "English"], ranked: false, callback: null, users: 1923, color: "#8B5CF6" },
  { id: 3, name: "Executive", type: "CV", tags: ["Professional", "English"], ranked: true, callback: "38%", users: 3102, color: "#10B981" },
  { id: 4, name: "ATS-Optimized", type: "CV", tags: ["Keyword-Dense", "English"], ranked: false, callback: null, users: 4215, color: "#06B6D4" },
  { id: 5, name: "German Lebenslauf", type: "CV", tags: ["Photo", "German"], ranked: false, callback: null, users: 1456, color: "#F59E0B" },
  { id: 6, name: "Tech Portfolio", type: "CV", tags: ["GitHub-Style", "English"], ranked: false, callback: null, users: 987, color: "#E11D48" },
  { id: 7, name: "Formal", type: "Cover Letter", tags: ["Business", "English"], ranked: true, callback: "35%", users: 2156, color: "#8B5CF6" },
  { id: 8, name: "Startup", type: "Cover Letter", tags: ["Casual", "English"], ranked: false, callback: null, users: 1789, color: "#3B82F6" },
  { id: 9, name: "Corporate", type: "Cover Letter", tags: ["Achievement-Focused", "English"], ranked: false, callback: null, users: 1234, color: "#10B981" },
  { id: 10, name: "Consulting", type: "Cover Letter", tags: ["STAR Format", "English"], ranked: false, callback: null, users: 876, color: "#06B6D4" },
];

const filters = ["ALL", "CV", "COVER LETTER"];

export function TemplatesPage() {
  const [filter, setFilter] = useState("ALL");
  const [selected, setSelected] = useState<number | null>(null);

  const filtered = filter === "ALL" ? templates : templates.filter(t => t.type === (filter === "CV" ? "CV" : "Cover Letter"));
  const communityPicks = templates.filter(t => t.ranked);

  return (
    <div className="animate-fade-up space-y-6 max-w-[1200px]">
      <div>
        <h1 className="text-gradient-purple font-display font-bold text-[22px] mb-1">TEMPLATE LIBRARY</h1>
        <p className="font-mono text-[11px] text-muted-foreground">Choose a template before generating. Community-ranked by real callback data.</p>
      </div>

      <div className="flex gap-2">
        {filters.map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`font-mono text-[10px] uppercase px-3 py-1.5 rounded-full transition-all ${filter === f ? "text-foreground" : "glass-surface text-muted-foreground hover:text-foreground"}`} style={filter === f ? { background: "linear-gradient(135deg, #8B5CF6, #3B82F6)" } : {}}>
            {f}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {filtered.map(t => (
          <GlassCard key={t.id} className={`p-5 cursor-pointer transition-all ${selected === t.id ? "shadow-[0_0_30px_rgba(139,92,246,0.5)] border-jarvis-purple/50" : ""}`} onClick={() => setSelected(t.id)}>
            {/* Preview thumbnail */}
            <div className="h-[140px] rounded-md mb-4 p-4 flex flex-col gap-2 overflow-hidden" style={{ background: `linear-gradient(135deg, ${t.color}15, ${t.color}08)`, border: `1px solid ${t.color}30` }}>
              <div className="h-2 rounded-full w-[60%]" style={{ background: t.color + "40" }} />
              <div className="h-1.5 rounded-full w-[80%]" style={{ background: t.color + "20" }} />
              <div className="h-1.5 rounded-full w-[45%]" style={{ background: t.color + "20" }} />
              <div className="h-1.5 rounded-full w-[70%]" style={{ background: t.color + "15" }} />
              <div className="h-1.5 rounded-full w-[55%]" style={{ background: t.color + "15" }} />
              <div className="h-1.5 rounded-full w-[65%]" style={{ background: t.color + "10" }} />
            </div>

            <p className="font-display font-semibold text-sm text-foreground mb-2">{t.name}</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              <span className="font-mono text-[9px] px-2 py-0.5 rounded-full" style={{ background: t.type === "CV" ? "rgba(59,130,246,0.15)" : "rgba(139,92,246,0.15)", color: t.type === "CV" ? "#3B82F6" : "#8B5CF6" }}>{t.type}</span>
              {t.tags.map(tag => (
                <span key={tag} className="font-mono text-[9px] px-2 py-0.5 rounded-full glass-surface text-muted-foreground">{tag}</span>
              ))}
            </div>
            {t.ranked && (
              <p className="font-mono text-[10px] text-jarvis-green mb-2">🏆 {t.callback} callback rate</p>
            )}
            <p className="font-mono text-[10px] text-muted-foreground mb-3">Used by {t.users.toLocaleString()} people</p>
            <div className="flex gap-2">
              <button className="flex-1 py-2 rounded-md font-display text-[11px] glass-surface text-muted-foreground hover:text-foreground transition-all">Preview</button>
              <button onClick={() => setSelected(t.id)} className="flex-1 py-2 rounded-md font-display text-[11px] font-semibold uppercase text-foreground transition-all hover:scale-[1.02]" style={{ background: "linear-gradient(135deg, #8B5CF6, #3B82F6)", boxShadow: "0 0 12px rgba(139,92,246,0.3)" }}>
                Use This
              </button>
            </div>
          </GlassCard>
        ))}
      </div>

      {/* Community Picks */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-jarvis-crimson mb-3">🏆 COMMUNITY TOP PICKS</p>
        <div className="grid grid-cols-3 gap-6">
          {communityPicks.map(t => (
            <GlassCard key={t.id} className="p-5" hover style={{ borderColor: "rgba(245,158,11,0.4)", boxShadow: "0 0 20px rgba(245,158,11,0.15)" }}>
              <div className="h-[100px] rounded-md mb-3 p-3 flex flex-col gap-1.5 overflow-hidden" style={{ background: `linear-gradient(135deg, ${t.color}15, ${t.color}08)`, border: `1px solid ${t.color}30` }}>
                <div className="h-2 rounded-full w-[60%]" style={{ background: t.color + "40" }} />
                <div className="h-1.5 rounded-full w-[80%]" style={{ background: t.color + "20" }} />
                <div className="h-1.5 rounded-full w-[45%]" style={{ background: t.color + "20" }} />
              </div>
              <p className="font-display font-semibold text-sm text-foreground">{t.name}</p>
              <p className="font-mono text-[10px] text-jarvis-green">🏆 TOP RATED — {t.callback} callback</p>
              <p className="font-mono text-[10px] text-muted-foreground">{t.users.toLocaleString()} users</p>
            </GlassCard>
          ))}
        </div>
      </div>
    </div>
  );
}
