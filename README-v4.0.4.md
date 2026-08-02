# Addie Enterprises HTML v4.0.4 Hotfix

## Fixes
- Hides the login screen correctly after successful authentication.
- Reveals the dashboard after sign-in.
- Shows the actual Firestore sync error in Settings.
- Includes Firestore rules for the capital-W `Workspaces` collection.

## Upload to GitHub
1. Upload every file in this ZIP to the repository root.
2. Replace matching files.
3. Commit with:
   `v4.0.4 - Fix login screen overlay and sync diagnostics`
4. Wait 2–3 minutes.
5. Open the site in a new Private Safari tab.

## Firebase Rules
In Firebase Console:
1. Firestore Database
2. Rules
3. Replace the current rules with the contents of `firestore.rules`
4. Click Publish
