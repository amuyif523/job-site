from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from bs4 import BeautifulSoup
import json
import time

options = Options()
options.add_argument("--disable-blink-features=AutomationControlled")
options.add_experimental_option("excludeSwitches", ["enable-automation"])
options.add_experimental_option("useAutomationExtension", False)

driver = webdriver.Chrome(options=options)
driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

all_jobs = []
page = 1

while len(all_jobs) < 300:
    url = f"https://www.jobteaser.com/en/job-offers?contract=cdi&locale=de&locale=en&page={page}&sort=recency&study_levels=3&study_levels=4&work_experience_code=young_graduate&work_experience_code=three_to_five_years"
    driver.get(url)
    time.sleep(5)

    soup = BeautifulSoup(driver.page_source, "html.parser")

    # Print all classes on page to find job card pattern
    if page == 1:
        tags = soup.find_all(True)
        classes = set()
        for tag in tags:
            for c in tag.get("class", []):
                if any(x in c.lower() for x in ["job", "offer", "card", "listing", "result"]):
                    classes.add(f"{tag.name}.{c}")
        print("Candidate classes:", classes)
        break

driver.quit()