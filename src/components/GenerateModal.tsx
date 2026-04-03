import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Job } from "@/types/job";
import { generateDocuments } from "@/lib/api";
import { GlassCard } from "./GlassCard";
import { ScoreRing } from "./ScoreRing";
import { toast } from "@/hooks/use-toast";
import { X, Loader2, Download, FileText, Mail, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { canGenerateForJob, getGenerationBlockReason } from "@/lib/jobScoring";

interface GenerateModalProps {
  job: Job | null;
  open: boolean;
  onClose: () => void;
}

const languages = ["English", "German", "French", "Spanish", "Arabic", "Chinese"];

const cvTemplates = [
  { id: 1, name: "Modern", callback: "42%", ranked: true, color: "#3B82F6" },
  { id: 2, name: "Minimal", callback: null, ranked: false, color: "#8B5CF6" },
  { id: 3, name: "Executive", callback: "38%", ranked: true, color: "#10B981" },
  { id: 4, name: "ATS-Optimized", callback: null, ranked: false, color: "#06B6D4" },
  { id: 5, name: "German Lebenslauf", callback: null, ranked: false, color: "#F59E0B" },
  { id: 6, name: "Tech Portfolio", callback: null, ranked: false, color: "#E11D48" },
];

const coverTemplates = [
  { id: 7, name: "Formal", callback: "35%", ranked: true, color: "#8B5CF6" },
  { id: 8, name: "Startup", callback: null, ranked: false, color: "#3B82F6" },
  { id: 9, name: "Corporate", callback: null, ranked: false, color: "#10B981" },
  { id: 10, name: "Consulting", callback: null, ranked: false, color: "#06B6D4" },
];

export function GenerateModal({ job, open, onClose }: GenerateModalProps) {
  const [step, setStep] = useState(1);
  const [selectedCVTemplate, setSelectedCVTemplate] = useState(1);
  const [selectedCoverTemplate, setSelectedCoverTemplate] = useState(7);
  const [genCV, setGenCV] = useState(true);
  const [genCover, setGenCover] = useState(true);
  const [selectedLangs, setSelectedLangs] = useState<string[]>(["English"]);
  const [instructions, setInstructions] = useState("");
  const [result, setResult] = useState<{ cv_url: string; cover_letter_url: string } | null>(null);

  const genMutation = useMutation({
    mutationFn: () => generateDocuments(job!.id),
    onSuccess: (data) => {
      setResult(data);
      setStep(3);
      toast({ title: "Documents generated!" });
    },
    onError: () => toast({ title: "Generation failed", variant: "destructive" }),
  });

  const toggleLang = (lang: string) => {
    setSelectedLangs(prev =>
      prev.includes(lang) ? (prev.length > 1 ? prev.filter(l => l !== lang) : prev) : [...prev, lang]
    );
  };

  const handleClose = () => {
    setStep(1);
    setResult(null);
    onClose();
  };

  if (!open || !job) return null;

  const generationBlocked = !canGenerateForJob(job);
  const generationBlockReason = getGenerationBlockReason(job);

  const steps = [
    { num: 1, label: "TEMPLATE" },
    { num: 2, label: "OPTIONS" },
    { num: 3, label: "GENERATE" },
  ];

  return (
    <div
      className="fixed inset-0 flex items-start justify-center px-3 py-4 sm:items-center sm:px-6"
      style={{ zIndex: 100, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}
      onClick={handleClose}
    >
      <div onClick={e => e.stopPropagation()} className="w-full max-w-[640px] max-h-[calc(100vh-2rem)] overflow-y-auto animate-fade-up sm:max-h-[85vh]">
        <GlassCard className="p-4 sm:p-6" hover={false}>
          {/* Header */}
          <div className="flex justify-between items-start mb-4">
            <div>
              <h2 className="text-gradient-purple font-display font-bold text-lg flex items-center gap-2">⚡ GENERATE APPLICATION</h2>
              <p className="font-mono text-xs text-muted-foreground mt-1">{job.title} · {job.company}</p>
            </div>
            <button onClick={handleClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
          </div>

          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-5">
            {steps.map((s, i) => (
              <div key={s.num} className="flex items-center gap-2">
                <button
                  onClick={() => { if (s.num < step || result) return; if (s.num <= step) setStep(s.num); }}
                  className={cn(
                    "flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
                    step === s.num ? "text-foreground" : step > s.num ? "text-jarvis-green" : "text-muted-foreground"
                  )}
                >
                  {step > s.num ? <Check className="h-3 w-3 text-jarvis-green" /> : ["①", "②", "③"][s.num - 1]}
                  {s.label}
                </button>
                {i < steps.length - 1 && <span className="text-muted-foreground/30 font-mono text-[10px]">→</span>}
              </div>
            ))}
          </div>

          {/* Step 1: Template picker */}
          {step === 1 && (
            <div className="space-y-4">
              {generationBlocked && (
                <div className="rounded-md border border-amber-400/20 bg-amber-400/10 px-3 py-3 font-mono text-[11px] text-amber-200">
                  {generationBlockReason}
                </div>
              )}
              {genCV && (
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">CV TEMPLATE</p>
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {cvTemplates.map(t => (
                      <button
                        key={t.id}
                        onClick={() => setSelectedCVTemplate(t.id)}
                        className={cn(
                          "shrink-0 w-[130px] p-3 rounded-lg glass-surface transition-all relative",
                          selectedCVTemplate === t.id && "shadow-[0_0_20px_rgba(139,92,246,0.4)] border-jarvis-purple/50"
                        )}
                      >
                        {selectedCVTemplate === t.id && (
                          <div className="absolute top-2 right-2 h-4 w-4 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, #8B5CF6, #3B82F6)" }}>
                            <Check className="h-2.5 w-2.5 text-foreground" />
                          </div>
                        )}
                        <div className="h-[60px] rounded mb-2 flex flex-col gap-1 p-2" style={{ background: t.color + "15", border: `1px solid ${t.color}30` }}>
                          <div className="h-1.5 rounded-full w-[70%]" style={{ background: t.color + "40" }} />
                          <div className="h-1 rounded-full w-[50%]" style={{ background: t.color + "20" }} />
                          <div className="h-1 rounded-full w-[60%]" style={{ background: t.color + "15" }} />
                        </div>
                        <p className="font-mono text-[10px] text-foreground">{t.name}</p>
                        {t.ranked && <p className="font-mono text-[9px] text-jarvis-green">🏆 {t.callback}</p>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {genCover && (
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">COVER LETTER TEMPLATE</p>
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {coverTemplates.map(t => (
                      <button
                        key={t.id}
                        onClick={() => setSelectedCoverTemplate(t.id)}
                        className={cn(
                          "shrink-0 w-[130px] p-3 rounded-lg glass-surface transition-all relative",
                          selectedCoverTemplate === t.id && "shadow-[0_0_20px_rgba(59,130,246,0.4)] border-jarvis-blue/50"
                        )}
                      >
                        {selectedCoverTemplate === t.id && (
                          <div className="absolute top-2 right-2 h-4 w-4 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, #3B82F6, #10B981)" }}>
                            <Check className="h-2.5 w-2.5 text-foreground" />
                          </div>
                        )}
                        <div className="h-[60px] rounded mb-2 flex flex-col gap-1 p-2" style={{ background: t.color + "15", border: `1px solid ${t.color}30` }}>
                          <div className="h-1.5 rounded-full w-[70%]" style={{ background: t.color + "40" }} />
                          <div className="h-1 rounded-full w-[50%]" style={{ background: t.color + "20" }} />
                        </div>
                        <p className="font-mono text-[10px] text-foreground">{t.name}</p>
                        {t.ranked && <p className="font-mono text-[9px] text-jarvis-green">🏆 {t.callback}</p>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={() => setStep(2)}
                disabled={generationBlocked}
                className="w-full py-3 rounded-md font-display font-semibold text-[13px] uppercase text-foreground transition-all hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
                style={{ background: "linear-gradient(135deg, #8B5CF6, #3B82F6)", boxShadow: "0 0 20px rgba(139,92,246,0.35)" }}
              >
                NEXT →
              </button>
            </div>
          )}

          {/* Step 2: Options */}
          {step === 2 && (
            <div className="space-y-5">
              {/* Score */}
              <div className="flex items-center gap-4">
                <ScoreRing score={job.score} size={80} />
                <p className="font-display text-base text-foreground">
                  {job.score !== null ? `This job is a ${job.score}% match` : "Not yet scored"}
                </p>
              </div>

              {/* Toggle cards */}
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">WHAT TO GENERATE</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button onClick={() => setGenCV(!genCV)} className={cn("glass-surface p-4 rounded-lg flex items-center gap-3 transition-all", genCV && "shadow-[0_0_20px_rgba(139,92,246,0.35)] border-jarvis-purple/40")}>
                  <FileText className={cn("h-5 w-5", genCV ? "text-jarvis-purple" : "text-muted-foreground")} />
                  <span className="font-display text-sm font-medium">{genCV ? "✓ " : ""}Tailored CV</span>
                </button>
                <button onClick={() => setGenCover(!genCover)} className={cn("glass-surface p-4 rounded-lg flex items-center gap-3 transition-all", genCover && "shadow-[0_0_20px_rgba(59,130,246,0.35)] border-jarvis-blue/40")}>
                  <Mail className={cn("h-5 w-5", genCover ? "text-jarvis-blue" : "text-muted-foreground")} />
                  <span className="font-display text-sm font-medium">{genCover ? "✓ " : ""}Cover Letter</span>
                </button>
              </div>

              {/* Languages */}
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">OUTPUT LANGUAGE</p>
              <div className="flex flex-wrap gap-2">
                {languages.map(lang => (
                  <button key={lang} onClick={() => toggleLang(lang)} className={cn("font-mono text-[11px] px-3 py-1.5 rounded-full transition-all", selectedLangs.includes(lang) ? "text-foreground" : "glass-surface text-muted-foreground hover:text-foreground")} style={selectedLangs.includes(lang) ? { background: "linear-gradient(135deg, #8B5CF6, #3B82F6)", boxShadow: "0 0 12px rgba(139,92,246,0.3)" } : {}}>
                    {lang}
                  </button>
                ))}
              </div>

              {/* Instructions */}
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">SPECIAL INSTRUCTIONS (OPTIONAL)</p>
              <textarea value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="e.g. Emphasize Python skills, keep CV to 1 page, formal tone..." className="w-full h-[90px] bg-transparent glass-surface p-3 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:shadow-[0_0_0_2px_rgba(139,92,246,0.5)] resize-none rounded-lg" />

              <div className="flex flex-col gap-3 sm:flex-row">
                <button onClick={() => setStep(1)} className="px-4 py-3 rounded-md font-display font-medium text-[13px] uppercase glass-surface text-muted-foreground hover:text-foreground transition-all">
                  ← BACK
                </button>
                <button
                  onClick={() => genMutation.mutate()}
                  disabled={genMutation.isPending}
                  className="flex-1 py-3 rounded-md font-display font-bold text-[13px] uppercase text-foreground transition-all hover:scale-[1.01] disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg, #8B5CF6, #3B82F6)", boxShadow: "0 0 20px rgba(139,92,246,0.35)" }}
                >
                  {genMutation.isPending ? (
                    <span className="flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> JARVIS is generating...</span>
                  ) : "GENERATE →"}
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Results */}
          {step === 3 && result && (
            <div className="space-y-4">
              <div className="text-center py-4">
                <div className="h-16 w-16 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: "linear-gradient(135deg, #10B981, #3B82F6)" }}>
                  <Check className="h-8 w-8 text-foreground" />
                </div>
                <p className="font-display font-bold text-lg text-foreground">Documents Ready!</p>
                <p className="font-mono text-[11px] text-muted-foreground mt-1">Your application documents have been generated</p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                {result.cv_url && (
                  <a href={result.cv_url} target="_blank" rel="noopener noreferrer" className="flex-1 glass-surface p-3 rounded-lg flex items-center gap-2 font-mono text-xs text-foreground hover:shadow-[0_0_12px_rgba(139,92,246,0.3)] transition-all">
                    <Download className="h-4 w-4 text-jarvis-purple" /> Download CV
                  </a>
                )}
                {result.cover_letter_url && (
                  <a href={result.cover_letter_url} target="_blank" rel="noopener noreferrer" className="flex-1 glass-surface p-3 rounded-lg flex items-center gap-2 font-mono text-xs text-foreground hover:shadow-[0_0_12px_rgba(59,130,246,0.3)] transition-all">
                    <Download className="h-4 w-4 text-jarvis-blue" /> Download Cover Letter
                  </a>
                )}
              </div>
              <button onClick={handleClose} className="w-full py-2.5 rounded-md font-display text-[12px] glass-surface text-muted-foreground hover:text-foreground transition-all">
                Done
              </button>
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
