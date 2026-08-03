# Addie Enterprises HTML v4.2.4 — Multi-Platform Listings

## New feature
An inventory item can now be listed on multiple marketplaces at the same time.

Examples:
- eBay + Poshmark
- Poshmark + Mercari + Facebook Marketplace
- The RealReal + Vestiaire Collective

## How calculations work
- `Listed On` stores every marketplace where the item is currently advertised.
- `Expected Sale Platform` remains a single selection used for projected fee calculations.
- `Actual Sale Platform` records the one marketplace where the item ultimately sells.
- Existing records with one old Listing Platform remain compatible.

## Upload
1. Upload every file in this ZIP to the root of the GitHub repository.
2. Replace matching files.
3. Commit with:
   `v4.2.4 - Add multi-platform listings`
4. Wait 2–3 minutes.
5. Refresh the site.
6. Edit an item and select both eBay and Poshmark under Listed On.
