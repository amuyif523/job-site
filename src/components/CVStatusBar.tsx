import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchLatestCV, getCVUiState, uploadCV, type CVLatestResponse } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import { Loader2, X } from "lucide-react";

const SECTION_KEYS: { key: keyof NonNullable<CVLatestResponse["parsed_json"]>; label: string }[] = [
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

function scoreSummary(summary?: string): number {
  const length = summary?.trim().length ?? 0;
  if (length >= 200) return 25;
  if (length >= 100) return 20;
  if (length >= 50) return 15;
  if (length >= 25) return 8;
  return 0;
}

function scoreSkills(skills?: unknown[]): number {
  const count = Array.isArray(skills) ? skills.length : 0;
  if (count >= 12) return 30;
  if (count >= 8) return 25;
  if (count >= 6) return 20;
  if (count >= 3) return 12;
  if (count >= 1) return 6;
  return 0;
}

function scoreListSection(items?: unknown[]): number {
  const count = Array.isArray(items) ? items.length : 0;
  if (count >= 3) return 15;
  if (count >= 1) return 10;
  return 0;
}

function calculateStrength(parsed?: CVLatestResponse["parsed_json"] | null): number {
  if (!parsed) return 0;
  const summaryScore = scoreSummary(parsed.summary);
  const skillsScore = scoreSkills(parsed.skills);
  const experienceScore = scoreListSection(parsed.experience);
  const educationScore = scoreListSection(parsed.education);
  const projectsScore = scoreListSection(parsed.projects);
  return Math.min(100, summaryScore + skillsScore + experienceScore + educationScore + projectsScore);
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

  const persistCvName = (name: string) => {
    const trimmed = name.trim();
    setCvName(trimmed);
    if (trimmed) {
      localStorage.setItem("jarvis_cv_name", trimmed);
    } else {
      localStorage.removeItem("jarvis_cv_name");
    }
  };

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadCV(file),
    onMutate: () => ({ previousCvName: cvName }),
    onSuccess: async (_data, file) => {
      persistCvName(file.name);
      toast({ title: "CV uploaded successfully" });
      await queryClient.invalidateQueries({ queryKey: ["latestCV"] });
    },
    onError: (error: Error, _file, context) => {
      persistCvName(context?.previousCvName ?? "");
      toast({
        title: "CV upload failed",
        description: error.message || "Failed to upload CV",
        variant: "destructive",
      });
    },
  });

  const { data: cvData, isLoading: isCVLoading } = useQuery<CVLatestResponse>({
    queryKey: ["latestCV"],
    queryFn: fetchLatestCV,
    enabled: true,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!isCVLoading && getCVUiState(cvData, false) === "no_cv") {
      persistCvName("");
      setPanelOpen(false);
    }
  }, [cvData, isCVLoading]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadMutation.mutate(file);
      e.target.value = "";
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

  const score = calculateStrength(cvData?.parsed_json ?? null);
  const scoreColor = score >= 80 ? "text-jarvis-green" : score >= 60 ? "text-jarvis-yellow" : "text-jarvis-crimson";
  const cvState = getCVUiState(cvData, uploadMutation.isPending);
  const hasStoredCv = cvState !== "no_cv";
  const displayName = cvName || (hasStoredCv ? "Uploaded CV" : "");
  const stateLabel = {
    no_cv: "No CV",
    uploading: "Uploading CV",
    ready: "CV ready",
    incomplete: "Needs review",
    invalid: "Upload issue",
  }[cvState];
  const stateDotClass = {
    no_cv: "bg-jarvis-crimson",
    uploading: "bg-jarvis-blue animate-pulse",
    ready: "bg-jarvis-green animate-pulse",
    incomplete: "bg-jarvis-yellow animate-pulse",
    invalid: "bg-jarvis-crimson animate-pulse",
  }[cvState];
  const actionLabel = {
    no_cv: "Upload",
    uploading: "Uploading...",
    ready: "Replace",
    incomplete: "Re-upload",
    invalid: "Try again",
  }[cvState];
  const helperText = {
    uploading: "We are parsing your CV now.",
    incomplete: "Your CV uploaded, but JARVIS could not build a strong profile yet.",
    invalid: "The uploaded CV could not be parsed correctly.",
  }[cvState];
  const recoveryText = {
    incomplete: "Try a cleaner PDF with selectable text and clearer section headings.",
    invalid: "Upload a fresh PDF resume to recover.",
  }[cvState];

  return (
    <div className="relative" ref={panelRef}>
      <div className="glass-surface px-3 py-2 flex items-center gap-2 font-mono text-[11px]">
        {cvState !== "no_cv" ? (
          <>
            <div className={`h-2 w-2 rounded-full ${stateDotClass}`} />
            <span className="text-muted-foreground max-w-[120px] truncate">{displayName}</span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{stateLabel}</span>
            {cvState === "ready" && score !== null && (
              <button onClick={() => setPanelOpen((v) => !v)} className="transition-transform hover:scale-110">
                <MiniScoreRing score={score} />
              </button>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploadMutation.isPending}
              className="text-muted-foreground hover:text-foreground transition-colors underline disabled:cursor-not-allowed disabled:opacity-60"
            >
              {actionLabel}
            </button>
          </>
        ) : (
          <>
            <div className={`h-2 w-2 rounded-full ${stateDotClass}`} />
            <span className="text-muted-foreground">{stateLabel}</span>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploadMutation.isPending}
              className="border border-jarvis-crimson/40 text-jarvis-crimson px-2 py-0.5 rounded hover:bg-jarvis-crimson hover:text-foreground transition-all"
            >
              {uploadMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : actionLabel}
            </button>
          </>
        )}
        <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={handleFile} />
      </div>

      {/* Strength breakdown panel */}
      {panelOpen && cvData && cvState === "ready" && score !== null && (
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
              const present = cvData.parsed_json ? sectionPresent(cvData.parsed_json[s.key]) : false;
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
          {cvData?.suggestions && cvData.suggestions.length > 0 && (
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

      {cvState !== "ready" && cvState !== "no_cv" && (
        <div className="mt-2 max-w-[260px] text-[10px] font-mono text-muted-foreground">
          {helperText}
          {recoveryText ? ` ${recoveryText}` : ""}
        </div>
      )}
    </div>
  );
}
