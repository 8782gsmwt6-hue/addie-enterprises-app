# Addie Enterprises HTML v4.4.6 — Imported Item Save Fix

## Problem fixed
Imported inventory stored its product type in the newer `itemType` field, while the visible edit form was still using the older `category` field. This caused the form to show:

`Please select or enter the item type.`

and prevented imported items from saving.

## Fix
- Imported item types now populate the visible Category field.
- Types not included in the old dropdown automatically use Other Category.
- Category is converted back into `itemType` when saving.
- Imported Color and Material values populate the visible Color / Material field.
- Existing and imported records remain compatible.
- No inventory is deleted or overwritten.

## Upload
1. Upload every file in this ZIP to the GitHub repository root.
2. Replace matching files.
3. Commit:
   `v4.4.6 - Fix saving imported inventory`
4. Wait 2–3 minutes and refresh.
5. Open the same imported item, edit it, and save.

No Firebase rule changes are required.
No inventory re-import is required.
