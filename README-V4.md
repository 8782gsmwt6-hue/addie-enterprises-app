# Addie Enterprises HTML v4

This is the GitHub/Firebase HTML version, not a native application.

## Included fixes

- Uses the existing Firestore collection `Workspaces` with a capital W.
- Uses Listing Price to calculate projected profit.
- If Listing Price is blank, Expected Selling Price is the fallback.
- Once Actual Sale Price is entered, the calculation automatically switches to actual profit.
- Firebase login and real-time synchronization remain enabled.
- Works in Safari, Chrome, Samsung Internet, iPhone, iPad, Android, Windows, and Mac.

## Upload to GitHub

1. Open the `addie-enterprises-app` repository.
2. Upload every file from this package to the repository root.
3. Replace files with matching names when GitHub asks.
4. Commit with:
   `v4.0 - Update Firebase paths and profit calculations`
5. Wait 1–3 minutes for GitHub Pages to deploy.
6. Refresh the deployed website.

## Firestore rules

Open Firebase Console > Firestore Database > Rules.

Replace the current rules with the contents of `firestore.rules`, then click Publish.

## Testing

1. Sign in.
2. Create an item with:
   - Purchase Price: 400
   - Listing Price: 700
   - Sale Price: blank
3. Confirm the item displays Projected Profit based on 700.
4. Edit it and enter a Sale Price.
5. Confirm the display changes to Actual Profit.
