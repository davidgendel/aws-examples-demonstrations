# Python and Selenium Based Web Crawler

This example is intended to show a solution which can crawle a website, including a heavily interactive or JS based site, and build out a JSONL based index file for use with GenAI RAG data sets.





##Install Dependencies:
```
pip install selenium webdriver-manager beautifulsoup4 requests
```

##Run the Script:
```
python your_script.py <start_url> <output_file> --crawl_delay 1 --max_depth 2 --timeout 30
<start_url>: The website to crawl (e.g., https://www.example.com).
<output_file>: The path to the output JSONL file (e.g., output.jsonl).
--crawl_delay: Delay between requests (in seconds).
--max_depth: Maximum crawl depth.
--timeout: Selenium timeout in seconds.
```

Important Considerations:

- WebDriverWait: Prioritize using WebDriverWait over time.sleep(). It's much more robust and efficient. Inspect the target website's HTML to find suitable elements to wait for.
- Resource Usage: Selenium uses more resources than requests or requests-html because it's running a full browser.
- Politeness: Be respectful of the website you're crawling. Use a reasonable crawl_delay, don't overload the server, and respect robots.txt.
- Website specific selectors: This script will work best if you modify the wait_for_selector to look for website specific elements.
