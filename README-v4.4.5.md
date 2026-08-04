# Addie Enterprises HTML v4.4.5 — Dashboard Scroll Fix

## Fix
The Dashboard correctly opened the Items tab, but attempted to scroll before the selected inventory row was fully rendered.

This version:
- Waits for the selected row to exist
- Retries briefly on iPhone, iPad, and Samsung browsers
- Scrolls the exact record to the center of the screen
- Highlights the matching row in gold
- Clears search and status filters so the record cannot be hidden
- Allows the same Dashboard item to be tapped repeatedly

## Upload
1. Upload every file in this ZIP to the GitHub repository root.
2. Replace matching files.
3. Commit:
   `v4.4.5 - Fix dashboard item scrolling`
4. Wait 2–3 minutes and refresh.

No Firebase changes are required.
