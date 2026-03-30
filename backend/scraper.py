"""
scraper.py — JobTeaser scraper using Playwright
"""

import asyncio
from fastapi import APIRouter, Depends, BackgroundTasks
from playwright.async_api import async_playwright
from datetime import datetime, timezone
from sqlmodel import Session, select

from database import engine
from dependencies import get_current_user
from models import Job, UserPublic

router = APIRouter()

# ── Scraper core ──────────────────────────────────────────────────────────────

async def scrape_jobteaser(user_id: int, target_role: str = "", max_jobs: int = 300):
    """Scrape JobTeaser and save jobs to DB for a specific user."""

    base_url = (
        "https://www.jobteaser.com/en/job-offers"
        "?contract=cdi&locale=de&locale=en&sort=recency"
        "&study_levels=3&study_levels=4"
        "&work_experience_code=young_graduate"
        "&work_experience_code=three_to_five_years"
    )

    if target_role:
        from urllib.parse import quote
        base_url += f"&q={quote(target_role)}"

    all_jobs = []
    page_num = 1

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--disable-blink-features=AutomationControlled"]
        )
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            locale="en-US",
        )
        page = await context.new_page()

        # Hide webdriver fingerprint
        await page.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

        while len(all_jobs) < max_jobs:
            url = f"{base_url}&page={page_num}"
            print(f"  Scraping page {page_num} — {len(all_jobs)} jobs so far...")

            await page.goto(url, wait_until="networkidle", timeout=30000)
            await page.wait_for_timeout(3000)

            cards = await page.query_selector_all("div.JobAdCard_main__1mTeA")

            if not cards:
                print(f"  No cards on page {page_num}, stopping.")
                break

            for card in cards:
                try:
                    title_el    = await card.query_selector("h3.JobAdCard_title__l2BSO")
                    company_el  = await card.query_selector("p.JobAdCard_companyName__7vp_H")
                    contract_el = await card.query_selector("div.JobAdCard_contractInfo__8S_AD")
                    link_el     = await card.query_selector("a.JobAdCard_link__LMtBN")

                    title    = await title_el.inner_text()    if title_el    else ""
                    company  = await company_el.inner_text()  if company_el  else ""
                    contract = await contract_el.inner_text() if contract_el else ""
                    href     = await link_el.get_attribute("href") if link_el else ""

                    job_url = f"https://www.jobteaser.com{href}" if href else ""

                    # Parse location from contract info (usually "City · Contract type")
                    parts    = contract.split("·")
                    location = parts[0].strip() if parts else ""

                    all_jobs.append({
                        "title":    title.strip(),
                        "company":  company.strip(),
                        "location": location,
                        "url":      job_url,
                    })

                except Exception as e:
                    print(f"  Error parsing card: {e}")
                    continue

            page_num += 1
            await page.wait_for_timeout(2000)

        await browser.close()

    # ── Save to DB ────────────────────────────────────────────────────────────
    now  = datetime.now(timezone.utc).isoformat()
    saved = 0

    with Session(engine) as session:
        for job in all_jobs[:max_jobs]:
            exists = session.exec(
                select(Job.id).where(Job.user_id == user_id, Job.url == job["url"])
            ).first()

            if not exists and job["title"]:
                session.add(
                    Job(
                        user_id=user_id,
                        title=job["title"],
                        company=job["company"],
                        location=job["location"],
                        url=job["url"],
                        status="new",
                        date_scraped=datetime.fromisoformat(now),
                    )
                )
                saved += 1

        session.commit()
    print(f"  ✅ Saved {saved} new jobs for user {user_id}")
    return saved


# ── Routes ────────────────────────────────────────────────────────────────────

scrape_status: dict = {}  # simple in-memory status tracker

@router.post("/api/scrape")
async def trigger_scrape(
    background_tasks: BackgroundTasks,
    current_user: UserPublic = Depends(get_current_user),
):
    """Trigger a scrape in the background for the current user."""
    user_id = current_user.id

    if scrape_status.get(user_id) == "running":
        return {"status": "already_running", "message": "Scrape already in progress"}

    scrape_status[user_id] = "running"

    async def run():
        try:
            saved = await scrape_jobteaser(
                user_id=user_id,
                target_role=current_user.target_role,
                max_jobs=300,
            )
            scrape_status[user_id] = f"done:{saved}"
        except Exception as e:
            scrape_status[user_id] = f"error:{e}"
            print(f"Scrape error: {e}")

    background_tasks.add_task(run)
    return {"status": "started", "message": f"Scraping jobs for '{current_user.target_role}'..."}


@router.get("/api/scrape/status")
def scrape_status_check(current_user: UserPublic = Depends(get_current_user)):
    """Check scrape status for current user."""
    status = scrape_status.get(current_user.id, "idle")
    return {"status": status}
