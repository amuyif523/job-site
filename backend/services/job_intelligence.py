from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable


FAMILY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "data": (
        "data",
        "analyst",
        "analytics",
        "scientist",
        "science",
        "machine learning",
        "ml",
        "ai",
        "business intelligence",
        "bi",
        "insight",
        "reporting",
        "governance",
        "quality",
    ),
    "software": (
        "software",
        "engineer",
        "developer",
        "backend",
        "front end",
        "frontend",
        "full stack",
        "fullstack",
        "platform",
        "devops",
        "sre",
        "qa",
        "mobile",
        "react",
        "python",
        "java",
        "typescript",
    ),
    "product": ("product", "owner", "manager", "growth", "strategy", "roadmap"),
    "design": ("designer", "design", "ux", "ui", "visual", "brand"),
    "sales": ("sales", "account manager", "business development", "customer success", "commercial"),
    "marketing": ("marketing", "seo", "content", "social media", "brand manager"),
    "finance": ("finance", "financial", "audit", "accounting", "controller", "investment", "risk"),
    "operations": ("operations", "supply chain", "logistics", "procurement", "warehouse"),
    "people": ("hr", "human resources", "talent", "recruiter", "people"),
    "legal": ("legal", "compliance", "counsel", "law"),
}

ROLE_STOPWORDS = {"and", "of", "the", "for", "to", "in", "m", "f", "d"}
ENTRY_LEVEL_TERMS = ("graduate", "junior", "entry", "associate", "analyst", "early career")
SENIOR_TERMS = ("senior", "lead", "principal", "staff", "head", "director", "manager")
HARD_BLOCK_TERMS = (
    "intern",
    "internship",
    "working student",
    "phd",
    "doctor",
    "nurse",
    "chef",
    "driver",
    "warehouse",
)


@dataclass(frozen=True)
class JobIntentAnalysis:
    status: str
    should_save: bool
    reason: str
    matched_keywords: list[str]
    blocked_keywords: list[str]
    inferred_seniority: str
    source_confidence: str


def _normalize_text(value: str) -> str:
    return " ".join((value or "").lower().replace("/", " ").replace("-", " ").split())


def _tokenize_target_role(target_role: str) -> set[str]:
    return {
        token
        for token in _normalize_text(target_role).split()
        if len(token) > 2 and token not in ROLE_STOPWORDS
    }


def _detect_role_families(target_role: str) -> set[str]:
    normalized = _normalize_text(target_role)
    families: set[str] = set()
    for family, keywords in FAMILY_KEYWORDS.items():
        if any(keyword in normalized for keyword in keywords):
            families.add(family)
    if not families and _tokenize_target_role(target_role):
        families.add("custom")
    return families


def _find_keywords(text: str, keywords: Iterable[str]) -> list[str]:
    found = {keyword for keyword in keywords if keyword in text}
    return sorted(found, key=lambda item: (len(item), item))


def infer_seniority(title: str) -> str:
    normalized_title = _normalize_text(title)
    if any(term in normalized_title for term in HARD_BLOCK_TERMS):
        return "internship"
    if any(term in normalized_title for term in SENIOR_TERMS):
        return "senior"
    if any(term in normalized_title for term in ENTRY_LEVEL_TERMS):
        return "entry-level"
    return "mid-level"


def analyze_job_listing(
    *,
    title: str,
    company: str,
    location: str,
    target_role: str,
) -> JobIntentAnalysis:
    normalized_title = _normalize_text(title)
    normalized_target = _normalize_text(target_role)
    target_tokens = _tokenize_target_role(target_role)
    target_families = _detect_role_families(target_role)
    inferred_seniority = infer_seniority(title)

    if not normalized_target:
        return JobIntentAnalysis(
            status="included",
            should_save=True,
            reason="Included because no target role was configured yet.",
            matched_keywords=[],
            blocked_keywords=[],
            inferred_seniority=inferred_seniority,
            source_confidence="medium",
        )

    matched_keywords = sorted(
        {
            *[token for token in target_tokens if token in normalized_title],
            *[
                keyword
                for family in target_families
                for keyword in FAMILY_KEYWORDS.get(family, ())
                if keyword in normalized_title
            ],
        },
        key=lambda item: (len(item), item),
    )

    non_target_families = [family for family in FAMILY_KEYWORDS if family not in target_families]
    blocked_keywords = sorted(
        {
            keyword
            for family in non_target_families
            for keyword in FAMILY_KEYWORDS[family]
            if keyword in normalized_title
        },
        key=lambda item: (len(item), item),
    )

    direct_phrase_match = bool(normalized_target and normalized_target in normalized_title)
    strong_match = direct_phrase_match or len(matched_keywords) >= 2
    weak_match = len(matched_keywords) == 1
    heavy_conflict = len(blocked_keywords) >= 2 and not strong_match
    hard_block = any(term in normalized_title for term in HARD_BLOCK_TERMS) and "internship" != normalized_target

    if hard_block or heavy_conflict or (not strong_match and not weak_match):
        reason = f"Skipped as off-target for {target_role or 'the current role focus'}."
        if blocked_keywords:
            reason = f"{reason} Conflicting keywords: {', '.join(blocked_keywords[:3])}."
        return JobIntentAnalysis(
            status="excluded",
            should_save=False,
            reason=reason,
            matched_keywords=matched_keywords,
            blocked_keywords=blocked_keywords,
            inferred_seniority=inferred_seniority,
            source_confidence="low",
        )

    if weak_match or (blocked_keywords and not strong_match):
        reason = (
            f"Borderline fit for {target_role or 'the current role focus'} based on title keywords."
        )
        return JobIntentAnalysis(
            status="borderline",
            should_save=True,
            reason=reason,
            matched_keywords=matched_keywords,
            blocked_keywords=blocked_keywords,
            inferred_seniority=inferred_seniority,
            source_confidence="medium",
        )

    return JobIntentAnalysis(
        status="included",
        should_save=True,
        reason=f"Included for {target_role or 'the current role focus'} based on title keyword overlap.",
        matched_keywords=matched_keywords,
        blocked_keywords=blocked_keywords,
        inferred_seniority=inferred_seniority,
        source_confidence="high" if direct_phrase_match or len(matched_keywords) >= 3 else "medium",
    )
