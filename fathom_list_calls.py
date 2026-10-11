"""
List every Fathom call your API key can see and export it to fathom_calls.csv.

Usage:
    pip install requests
    export FATHOM_API_KEY="your_key_here"      # Windows: set FATHOM_API_KEY="your_key_here"
    python fathom_list_calls.py

Note: Fathom's public API is read-only for meetings. It can list calls and show
their internal sharing level, but it has no endpoint to change sharing or delete
recordings. We can use the CSV to fetch each call from the Fathom and update the sharing access.
"""
import csv
import os
import sys
import time

import requests

BASE_URL = "https://api.fathom.ai/external/v1/meetings"
API_KEY = os.environ.get("FATHOM_API_KEY")
if not API_KEY:
    sys.exit("Set the FATHOM_API_KEY environment variable first.")

HEADERS = {"X-Api-Key": API_KEY}


def fetch_all_meetings():
    meetings, cursor = [], None
    while True:
        params = {"cursor": cursor} if cursor else {}
        resp = requests.get(BASE_URL, headers=HEADERS, params=params, timeout=30)
        if resp.status_code == 429:  # rate limited: wait and retry
            wait = int(resp.headers.get("Retry-After", 10))
            print(f"Rate limited, waiting {wait}s...")
            time.sleep(wait)
            continue
        resp.raise_for_status()
        data = resp.json()
        meetings.extend(data.get("items", []))
        print(f"Fetched {len(meetings)} calls so far...")
        cursor = data.get("next_cursor")
        if not cursor:
            return meetings
        time.sleep(1)  # be gentle with the rate limit


def main():
    meetings = fetch_all_meetings()
    fields = [
        "recording_id", "title", "created_at", "recorded_by",
        "shared_with", "invitees_type", "url", "share_url",
    ]
    with open("fathom_calls.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for m in meetings:
            writer.writerow({
                "recording_id": m.get("recording_id"),
                "title": m.get("title"),
                "created_at": m.get("created_at"),
                "recorded_by": (m.get("recorded_by") or {}).get("email"),
                "shared_with": m.get("shared_with"),  # no_teams / single_team / multiple_teams / all_teams
                "invitees_type": m.get("calendar_invitees_domains_type"),
                "url": m.get("url"),
                "share_url": m.get("share_url"),
            })
    print(f"\nDone: {len(meetings)} calls written to fathom_calls.csv")


if __name__ == "__main__":
    main()
