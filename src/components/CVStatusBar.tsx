import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { uploadCV } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import { Upload, Check, Loader2, X } from "lucide-react";

interface CVParsedJson {
  summary?: string;
  education?: unknown[];
  experience?: unknown[];
  skills?: unknown[];
  languages?: unknown[];
  projects?: unknown[];
}

interface CVLatestResponse {
  parsed_json: CVParsedJson;
  suggestions: string[];
}

const SECTION_KEYS: { key: keyof CVParsedJson; label: string }[] = [
  { key: "summary", label: "Summary" },
  { key: "experience", label: "Experience" },
  { key: "education", label: "Education" },
  { key: "skills", label: "Skills" },
  { key: "languages", label: "Languages" },
  { key: "projects", label: "Projects" },
];

function sectionPresent(val: unknown): boolean {
  if (val === undefined || val === null) return false;
  if (typeof val === "string") return val.trim().length > 0;
  if (Array.isArray(val)) return val.length > 0;
  return true;
}

function deriveScore(parsed: CVParsedJson): number {
  const filled = SECTION_KEYS.filter((s) => sectionPresent(parsed[s.key])).length;
  return Math.round((filled / SECTION_KEYS.length) * 100);
}

function MiniScoreRing({ score, size = 28, strokeWidth = 3 }: { score: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const [offset, setOffset] = useState(circumference);
  const color = score >= 80 ? "hsl(var(--jarvis-green))" : score >= 60 ? "hsl(var(--jarvis-yellow))" : "hsl(var(--jarvis-crimson))";

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setOffset(circumference * (1 - score / 100));
    });
    return () => cancelAnimationFrame(id);
  }, [score, circumference]);

  return (
    <svg width={size} height={size} className="shrink-0 cursor-pointer">
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeDasharray={circumference} strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="transition-all duration-700"
      />
      <text
        x="50%" y="50%" dominantBaseline="central" textAnchor="middle"
        fill={color} className="font-mono font-bold" style={{ fontSize: size * 0.3 }}
      >
        {score}
      </text>
    </svg>
  );
}

export function CVStatusBar() {
  const [cvName, setCvName] = useState(() => localStorage.getItem("jarvis_cv_name") || "");
  const [panelOpen, setPanelOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadCV(file),
    onSuccess: () => {
      toast({ title: "CV uploaded successfully" });
      queryClient.invalidateQueries({ queryKey: ["latestCV"] });
    },
    onError: () => toast({ title: "Failed to upload CV", variant: "destructive" }),
  });

  const { data: cvData } = useQuery<CVLatestResponse>({
    queryKey: ["latestCV"],
    queryFn: async () => {
      const res = await fetch("http://localhost:8000/api/cv/latest", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch CV data");
      return res.json();
    },
    enabled: !!cvName,
  });

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCvName(file.name);
      localStorage.setItem("jarvis_cv_name", file.name);
      uploadMutation.mutate(file);
    }
  };

  // Close panel on outside click
  useEffect(() => {
    if (!panelOpen) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [panelOpen]);

  const score = cvData ? deriveScore(cvData.parsed_json) : null;
  const scoreColor = score !== null
    ? score >= 80 ? "text-jarvis-green" : score >= 60 ? "text-jarvis-yellow" : "text-jarvis-crimson"
    : "";

  return (
    <div className="relative" ref={panelRef}>
      <div className="glass-surface px-3 py-2 flex items-center gap-2 font-mono text-[11px]">
        {cvName ? (
          <>
            <div className="h-2 w-2 rounded-full bg-jarvis-green animate-pulse" />
            <span className="text-muted-foreground max-w-[120px] truncate">{cvName}</span>
            {score !== null && (
              <button onClick={() => setPanelOpen((v) => !v)} className="transition-transform hover:scale-110">
                <MiniScoreRing score={score} />
              </button>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              className="text-muted-foreground hover:text-foreground transition-colors underline"
            >
              Replace
            </button>
          </>
        ) : (
          <>
            <div className="h-2 w-2 rounded-full bg-jarvis-crimson" />
            <span className="text-muted-foreground">No CV</span>
            <button
              onClick={() => fileRef.current?.click()}
              className="border border-jarvis-crimson/40 text-jarvis-crimson px-2 py-0.5 rounded hover:bg-jarvis-crimson hover:text-foreground transition-all"
            >
              {uploadMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Upload"}
            </button>
          </>
        )}
        <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={handleFile} />
      </div>

      {/* Strength breakdown panel */}
      {panelOpen && cvData && score !== null && (
        <div
          className="absolute top-full right-0 mt-2 w-[260px] glass-surface rounded-xl p-3 font-mono text-[11px]"
          style={{ zIndex: 60 }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className={`font-bold text-[12px] ${scoreColor}`}>CV Strength: {score}%</span>
            <button onClick={() => setPanelOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Section checklist */}
          <div className="space-y-1 mb-3">
            {SECTION_KEYS.map((s) => {
              const present = sectionPresent(cvData.parsed_json[s.key]);
              return (
                <div key={s.key} className="flex items-center gap-2">
                  <span className={present ? "text-jarvis-green" : "text-jarvis-crimson"}>
                    {present ? "✓" : "✗"}
                  </span>
                  <span className={present ? "text-foreground" : "text-muted-foreground"}>{s.label}</span>
                </div>
              );
            })}
          </div>

          {/* Gemini suggestions */}
          {cvData.suggestions && cvData.suggestions.length > 0 && (
            <div className="border-t border-jarvis-purple/20 pt-2 space-y-1.5">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Suggestions</span>
              {cvData.suggestions.map((tip, i) => (
                <div key={i} className="text-muted-foreground">
                  <span className="text-jarvis-purple">→</span> {tip}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
