# Addie Enterprises HTML v4.4.2 — Inventory Import

## What this package does
Adds an Owner/Admin-only `Import Inventory` tab containing 28 prepared inventory records.

## Safety
- Existing inventory is never overwritten.
- Every imported row has a permanent import key.
- Running the importer again skips records already imported.
- Inventory numbers continue from the highest existing AE number.

## Three historical pricing rows
The source document contained two numbers in one listing-price cell for:
- Kate Spade Mavis Street Zip Wallet
- Michael Kors Brooklyn Grommet Leather Clutch
- TOMS Hailey Booties

The importer uses the first number as Listing Price and preserves the second number in Notes for review.

## Shop expenses
The four general shop expenses are not imported because the app does not yet have a Shop Expenses module.

## Instructions
1. Upload every file in this ZIP to the GitHub repository root.
2. Replace matching files.
3. Commit:
   `v4.4.2 - Add one-time inventory import`
4. Wait 2–3 minutes and refresh.
5. Sign in as Owner/Admin.
6. Open `Import Inventory`.
7. Review the preview.
8. Tap `Import 28 Items` once.
9. Open Items and confirm the records.

No Firebase rule changes are required.
