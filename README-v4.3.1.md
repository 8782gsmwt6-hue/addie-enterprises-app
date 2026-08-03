# Addie Enterprises HTML v4.3.1 — Owner Login Recovery

## What this fixes
An existing owner could successfully authenticate but be shown the pending-approval screen when the Firebase UID no longer matched the older Firestore member-document ID.

This version:
- Keeps Sign In and Request Access as separate actions
- Never creates an account from the Sign In button
- Restores the owner member document when the configured owner email signs in with a new UID
- Keeps all other new accounts pending until an Owner or Admin approves them
- Preserves Forgot Password

## Important Firebase step
Publish the included `firestore.rules` after uploading the GitHub package.

## Upload
1. Upload every file to the GitHub repository root.
2. Replace matching files.
3. Commit:
   `v4.3.1 - Fix existing owner login`
4. Wait 2–3 minutes.
5. Firebase Console > Firestore Database > Rules.
6. Replace the rules with `firestore.rules` and click Publish.
7. Sign out and sign back in with the owner email.
