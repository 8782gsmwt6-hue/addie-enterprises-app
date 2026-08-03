# Addie Enterprises HTML v4.3 — Team Access

## New account workflow
1. A new user taps Request Access.
2. They enter their name, email, and their own password.
3. Firebase Authentication creates a unique UID.
4. The account remains blocked from inventory.
5. An Owner or Admin opens Settings > Team Management.
6. The owner assigns a role and approves the request.
7. The user can sign in and use the shared workspace.

## Roles
- Owner: Full access and team approval
- Admin: Full inventory access and team approval
- Inventory Manager: Inventory access
- Viewer: Currently shares inventory access; read-only enforcement can be added in a later release

## Firebase steps required
Email/Password Authentication is already enabled, so no Authentication change should be required.

You MUST publish the new Firestore rules:
1. Firebase Console
2. Firestore Database
3. Rules
4. Replace the rules with the contents of `firestore.rules`
5. Click Publish

Your existing Matt member record must have role `admin` or `owner`.
The existing record shown previously already used `admin`, which is supported.

## Upload
1. Upload every file in this ZIP to the GitHub repository root.
2. Replace matching files.
3. Commit:
   `v4.3 - Add owner-approved team access`
4. Wait 2–3 minutes.
5. Publish the included Firestore rules.
6. Have Addie open the app and tap Request Access.
7. Approve her from Settings > Team Management.
