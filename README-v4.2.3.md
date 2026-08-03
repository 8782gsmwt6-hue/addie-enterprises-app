# Addie Enterprises HTML v4.2.3

## Fix
Corrects the New Item workflow so an existing inventory record cannot remain in the form.

## New Item now
- Clears every field
- Clears the inventory number
- Clears the hidden edit ID
- Resets status to Purchased
- Resets Favorite to No
- Shows Add Item instead of Edit Item
- Prevents accidental overwriting of an existing record

## Upload
1. Upload every file in this ZIP to the root of the GitHub repository.
2. Replace matching files.
3. Commit with:
   `v4.2.3 - Fix New Item form reset`
4. Wait 2–3 minutes.
5. Refresh the site.
6. Tap Items > + New Item and confirm the form is blank.
