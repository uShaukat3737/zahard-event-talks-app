import os
import re
import time
import requests
from bs4 import BeautifulSoup
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

FEED_URL = "https://docs.cloud.google.com/feeds/bigquery-release-notes.xml"

# Simple in-memory cache
cache = {
    "data": None,
    "last_updated": 0
}
CACHE_DURATION = 600  # 10 minutes (600 seconds)

def fetch_and_parse_feed(force_refresh=False):
    now = time.time()
    if not force_refresh and cache["data"] and (now - cache["last_updated"] < CACHE_DURATION):
        print("Returning cached release notes")
        return cache["data"]

    print(f"Fetching fresh release notes from {FEED_URL}...")
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    response = requests.get(FEED_URL, headers=headers, timeout=15)
    response.raise_for_status()
    
    # Parse the Atom XML feed
    soup = BeautifulSoup(response.content, 'xml')
    
    entries = []
    
    for entry in soup.find_all('entry'):
        date_title = entry.find('title').text.strip() if entry.find('title') else 'Unknown Date'
        entry_id = entry.find('id').text.strip() if entry.find('id') else 'unknown-id'
        updated = entry.find('updated').text.strip() if entry.find('updated') else ''
        
        link_tag = entry.find('link')
        link = ""
        if link_tag:
            link = link_tag.get('href', '')
            
        content_tag = entry.find('content')
        content_html = ""
        if content_tag:
            content_html = content_tag.text
            
        # Parse individual sub-updates in the html content (split by h3 tags)
        sub_soup = BeautifulSoup(content_html, 'html.parser')
        
        current_type = "General"
        current_parts = []
        item_idx = 0
        
        def make_item(type_name, html_parts, index):
            html_str = "".join(str(p) for p in html_parts).strip()
            if not html_str or html_str == "\n":
                return None
                
            # Clean up trailing/leading whitespace and formatting issues
            html_clean_soup = BeautifulSoup(html_str, 'html.parser')
            
            # Format external links to open in a new window
            for a in html_clean_soup.find_all('a'):
                a['target'] = '_blank'
                a['rel'] = 'noopener noreferrer'
                # If it's a relative URL, prepend google cloud base url
                href = a.get('href', '')
                if href.startswith('/') and not href.startswith('//'):
                    a['href'] = f"https://docs.cloud.google.com{href}"
                    
            html_str = str(html_clean_soup)
            
            # Get plain text content for search and tweet generation
            text_str = html_clean_soup.get_text().strip()
            text_str = re.sub(r'\s+', ' ', text_str)
            
            sub_id = f"{entry_id}#item-{index}"
            
            return {
                'id': sub_id,
                'date': date_title,
                'updated': updated,
                'type': type_name,
                'content_html': html_str,
                'content_text': text_str,
                'link': link
            }
            
        # Iterate over structural children of content
        for child in sub_soup.children:
            if child.name == 'h3':
                if current_parts:
                    item = make_item(current_type, current_parts, item_idx)
                    if item:
                        entries.append(item)
                        item_idx += 1
                    current_parts = []
                current_type = child.get_text().strip()
            else:
                current_parts.append(child)
                
        # Handle the remaining parts for the entry
        if current_parts or current_type != "General":
            item = make_item(current_type, current_parts, item_idx)
            if item:
                entries.append(item)
                
    cache["data"] = entries
    cache["last_updated"] = now
    return entries

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/api/releases')
def get_releases():
    force_refresh = request.args.get('refresh', 'false').lower() == 'true'
    try:
        releases = fetch_and_parse_feed(force_refresh=force_refresh)
        return jsonify({
            'status': 'success',
            'count': len(releases),
            'releases': releases,
            'cached_at': cache["last_updated"]
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    app.run(host='0.0.0.0', port=port, debug=True)
