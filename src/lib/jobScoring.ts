import type { Job } from "@/types/job";

export const MIN_RELIABLE_DESCRIPTION_LENGTH = 600;

const SUMMARY_DESCRIPTION_LENGTH = 200;

function getDescriptionQuality(job: Job): "summary" | "partial" | "full" {
  if (job.description_quality) {
    return job.description_quality;
  }

  const descriptionLength = job.description?.trim().length ?? 0;
  if (descriptionLength >= MIN_RELIABLE_DESCRIPTION_LENGTH) {
    return "full";
  }
  if (descriptionLength >= SUMMARY_DESCRIPTION_LENGTH) {
    return "partial";
  }
  return "summary";
}

export function getDescriptionQualityLabel(job: Job): string {
  const quality = getDescriptionQuality(job);
  if (quality === "full") return "Full description";
  if (quality === "partial") return "Partial description";
  return "Listing summary only";
}

export function getDescriptionQualityToneClasses(job: Job): string {
  const quality = getDescriptionQuality(job);
  if (quality === "full") {
    return "border-emerald-400/20 bg-emerald-400/10 text-emerald-200";
  }
  if (quality === "partial") {
    return "border-amber-400/20 bg-amber-400/10 text-amber-200";
  }
  return "border-slate-400/20 bg-slate-400/10 text-slate-200";
}

export function isJobScoringReady(job: Job): boolean {
  return Boolean(
    job.scoring_ready &&
      getDescriptionQuality(job) === "full" &&
      job.score_label !== "Unscorable"
  );
}

export function canGenerateForJob(job: Job): boolean {
  return isJobScoringReady(job) && job.score !== null;
}

export function hasIncompleteScoreData(job: Job): boolean {
  const quality = getDescriptionQuality(job);
  const reasons = job.score_reasoning ?? [];
  const warningText = `${reasons.join(" ")} ${(job.red_flags ?? []).join(" ")} ${job.enrichment_error ?? ""}`.toLowerCase();

  return (
    job.score_label === "Unscorable" ||
    !job.scoring_ready ||
    quality !== "full" ||
    warningText.includes("no usable job description") ||
    warningText.includes("missing job description") ||
    warningText.includes("incomplete job description") ||
    warningText.includes("enrichment failed")
  );
}

export function getScoreContextMessage(job: Job): string {
  if (job.score_label === "Unscorable") {
    return "This job could not be scored because the listing data was too incomplete.";
  }

  const quality = getDescriptionQuality(job);
  if (quality === "summary") {
    return "Only the listing summary is stored for this job, so scoring is blocked until a full description is available.";
  }

  if (quality === "partial") {
    return "This score would be based on a partial detail-page description, so JARVIS keeps it out of the score list.";
  }

  return "This score is based on a full job description and your current CV.";
}

export function getGenerationBlockReason(job: Job): string {
  if (job.score === null) {
    return "Run scoring before generating an application for this job.";
  }
  if (job.score_label === "Unscorable") {
    return "This job cannot generate an application because the listing data was too incomplete to score.";
  }
  if (getDescriptionQuality(job) !== "full") {
    return "This job needs a full detail-page description before JARVIS can generate a trustworthy application.";
  }
  if (!job.scoring_ready) {
    return "This job needs a fuller description before JARVIS can generate a trustworthy application.";
  }
  return "";
}

export function isReliableTopMatch(job: Job): boolean {
  return canGenerateForJob(job);
}
