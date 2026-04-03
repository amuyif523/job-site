import type { Job } from "@/types/job";

const intentLabelMap: Record<Job["intent_status"], string> = {
  included: "Target fit",
  borderline: "Borderline fit",
  excluded: "Excluded",
};

const confidenceLabelMap: Record<Job["source_confidence"], string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

const seniorityLabelMap: Record<Job["inferred_seniority"], string> = {
  "entry-level": "Entry-level",
  "mid-level": "Mid-level",
  senior: "Senior",
  internship: "Internship",
  unknown: "Unknown seniority",
};

export function getIntentBadgeLabel(job: Job): string {
  return intentLabelMap[job.intent_status] ?? "Target fit";
}

export function getIntentToneClasses(job: Job): string {
  if (job.intent_status === "borderline") {
    return "border-amber-400/20 bg-amber-400/10 text-amber-200";
  }
  if (job.intent_status === "excluded") {
    return "border-jarvis-crimson/20 bg-jarvis-crimson/10 text-jarvis-crimson";
  }
  return "border-emerald-400/20 bg-emerald-400/10 text-emerald-200";
}

export function getIntentSummary(job: Job): string {
  return job.intent_reason || "Included based on the current target role.";
}

export function getIntentMetadata(job: Job): string[] {
  return [
    confidenceLabelMap[job.source_confidence] ?? "Medium confidence",
    seniorityLabelMap[job.inferred_seniority] ?? "Unknown seniority",
  ];
}
