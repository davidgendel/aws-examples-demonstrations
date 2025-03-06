import requests
import json
import os
import time
import argparse
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
from requests.exceptions import RequestException
import re
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.by import By

class WebsiteCrawler:
    def __init__(self, start_url, output_file, crawl_delay=1, max_depth=None):
        self.start_url = start_url
        self.output_file = output_file
        self.crawl_delay = crawl_delay
        self.max_depth = max_depth
        self.visited_urls = set()
#
# Configure the domains to not crawl or not follow - for example external common domains that we don't need to index
#
        self.ignored_domains = ["google.com", "facebook.com", "twitter.com", "instagram.com", "youtube.com"]
#
# Configure the crawler user agent
#
        self.user_agent = "MyCustomWebsiteCrawler/1.0"
        # self.headers = {'User-Agent': self.user_agent}  # Not needed for Selenium
        output_dir = os.path.dirname(self.output_file)
        if output_dir:
            os.makedirs(output_dir, exist_ok=True)

        # Selenium setup (Headless Chrome)
        options = Options()
        options.add_argument("--headless")
        options.add_argument(f"--user-agent={self.user_agent}")
        options.add_argument("--window-size=1920,1080")
        options.add_argument("--disable-javascript") # Start with JS disabled

        service = Service(ChromeDriverManager().install())
        self.driver = webdriver.Chrome(service=service, options=options)


    def should_ignore_url(self, url):
        parsed_url = urlparse(url)
        return any(domain in parsed_url.netloc for domain in self.ignored_domains)

    def sanitize_filename(self, url):
        parsed_url = urlparse(url)
        return re.sub(r'[\\/*?:"<>|]', "_", parsed_url.path.strip("/"))[:200] + ".md"

    def clean_text(self, text):
        text = re.sub(r'\s+', ' ', text).strip()
        text = text.replace("&amp;", "&")
        return text

    def extract_headings(self, soup):
        headings = []
        for heading in soup.find_all(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']):
            level = int(heading.name[1])
            text = self.clean_text(heading.get_text(strip=True))
            headings.append({'level': level, 'text': text})
        return headings

    def chunk_text_by_headings(self, soup, title, url):
        chunks = []
        current_heading = None
        current_content = []

        for element in soup.find_all(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p']):
            if element.name.startswith('h'):
                if current_heading:
                    combined_content = ' '.join(current_content)
                    cleaned_content = self.clean_text(combined_content)
                    chunks.append({
                        'url': url,
                        'title': title,
                        'heading': current_heading,
                        'content': cleaned_content
                    })
                current_heading = {'level': int(element.name[1]), 'text': self.clean_text(element.get_text(strip=True))}
                current_content = []
            elif element.name == 'p':
                current_content.append(element.get_text(strip=True))

        if current_heading:
            combined_content = ' '.join(current_content)
            cleaned_content = self.clean_text(combined_content)
            chunks.append({
                'url': url,
                'title': title,
                'heading': current_heading,
                'content': cleaned_content
            })
        return chunks


    def download_and_process_page(self, url, depth, output_file):
        if depth > self.max_depth:
            print(f"Max depth {self.max_depth} reached. Skipping {url}")
            return

        if url in self.visited_urls or self.should_ignore_url(url):
            print(f"Skipping (already visited or ignored): {url}")
            return

        self.visited_urls.add(url)
        print(f"Downloading (Selenium): {url}")

        try:
            # Re-enable JavaScript for this specific request
            self.driver.execute_script("navigator.userAgent = '" + self.user_agent + "'") #set user agent
            self.driver.get(url)

            # Wait for a specific element to be present (adjust as needed)
            # This is a more robust way to wait for JavaScript to load
            # Example: Wait for an element with the ID 'main-content' to be present
            # WebDriverWait(self.driver, 10).until(
            #     EC.presence_of_element_located((By.ID, "main-content"))
            # )
            time.sleep(5) # Or, a simple time-based wait.


            soup = BeautifulSoup(self.driver.page_source, 'html.parser')

            for script in soup(["script", "style", "head", "meta", "svg"]):
                script.extract()

            page_title = soup.title.string if soup.title else "No Title"
            page_title = self.clean_text(page_title)

            chunks = self.chunk_text_by_headings(soup, page_title, url)
            for chunk in chunks:
                if len(chunk['content']) > 50:
                    json.dump(chunk, output_file)
                    output_file.write('\n')


        except Exception as e:  # Catch all exceptions with Selenium
            print(f"Error processing {url}: {e}")
            import traceback
            traceback.print_exc()


    def crawl(self):
        with open(self.output_file, 'w', encoding='utf-8') as f:
            self.download_and_process_page(self.start_url, 0, f)

            # Get links *after* processing the initial page (using requests)
            try:
                # Still use requests to get the initial HTML for link extraction
                response = requests.get(self.start_url, headers={'User-Agent': self.user_agent}, timeout=10)
                response.raise_for_status()
                soup = BeautifulSoup(response.content, 'html.parser')

                for link in soup.find_all('a', href=True):
                    href = link.get('href')
                    absolute_url = urljoin(self.start_url, href)
                    if urlparse(absolute_url).netloc == urlparse(self.start_url).netloc:
                        self.download_and_process_page(absolute_url, 1, f)
                        time.sleep(self.crawl_delay)

            except RequestException as e:
                print(f"Error fetching links from {self.start_url}: {e}")
            except Exception as e:
                print(f"Error during initial crawl setup: {e}")
        self.driver.quit() #close the driver.



def main():
    parser = argparse.ArgumentParser(description="Crawl a website and prepare data for RAG.")
    parser.add_argument("start_url", help="The URL to start crawling from.")
    parser.add_argument("output_file", help="The path to the output JSONL file.")
    parser.add_argument("--crawl_delay", type=float, default=5, help="Delay in seconds (default: 5).")
    parser.add_argument("--max_depth", type=int, default=5, help="Maximum crawl depth (default: 5).")

    args = parser.parse_args()

    if not urlparse(args.start_url).scheme:
        print("Error: Invalid start URL. Must include http:// or https://")
        return

    crawler = WebsiteCrawler(args.start_url, args.output_file, args.crawl_delay, args.max_depth)
    crawler.crawl()

if __name__ == "__main__":
    main()
