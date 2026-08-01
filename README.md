# Addie Enterprises Tracker v2

This package is a Firebase-backed Progressive Web App that works on:

- Samsung / Android phones and tablets
- iPhone and iPad
- Windows and Mac computers
- Any modern browser

## Key profit rule

The app uses this sequence automatically:

1. **Before a sale price exists:** projected profit uses the **Listing Price**.
2. If Listing Price is blank, it falls back to **Expected Selling Price**.
3. **After Actual Sale Price is entered:** profit immediately switches to the **Actual Sale Price**.
4. Before the sale, the app estimates platform fees using the selected platform.
5. After the sale, the app uses the **Actual Platform Fee** entered by the user.

Projected profit:
`Listing Price + Buyer-paid Shipping - Estimated Platform Fee - Shipping/Selling Costs - Purchase Price`

Actual profit:
`Actual Sale Price + Buyer-paid Shipping - Actual Platform Fee - Shipping/Selling Costs - Purchase Price`

## Firebase setup

### 1. Create the Firebase project

1. Go to Firebase Console.
2. Select **Create a project**.
3. Name it `addie-enterprises`.
4. Google Analytics is optional.

### 2. Add a Web App

1. In Project Overview, click the **Web** icon `</>`.
2. App nickname: `Addie Tracker`.
3. Do not enable Firebase Hosting yet unless you plan to use it.
4. Register the app.
5. Copy the displayed `firebaseConfig`.

### 3. Update `firebase-config.js`

Replace all placeholder values with the configuration copied from Firebase.

### 4. Enable email/password sign-in

1. Firebase Console → **Authentication**.
2. Click **Get started**.
3. Open **Sign-in method**.
4. Enable **Email/Password**.
5. Save.

The app includes a Create Account button. Anyone who knows the private URL can attempt to create an account. For tighter control, create the accounts yourself in Firebase Authentication, then remove or hide the Create Account button in `index.html`.

### 5. Create Firestore

1. Firebase Console → **Firestore Database**.
2. Click **Create database**.
3. Select **Production mode**.
4. Choose the region closest to your users.
5. Open the **Rules** tab.
6. Replace the rules with the contents of `firestore.rules`.
7. Click **Publish**.

These starter rules allow any authenticated user to read and edit the shared Addie workspace. A later enhancement can add an administrator-approved user list.

### 6. Deploy to GitHub Pages

1. Create a new GitHub repository.
2. Upload every file in this package to the repository root.
3. Open **Settings → Pages**.
4. Under Source, choose **Deploy from a branch**.
5. Select the `main` branch and `/ (root)`.
6. Save.
7. Wait for the GitHub Pages address to appear.
8. In Firebase Console → Authentication → Settings → Authorized domains, add the GitHub Pages domain, such as `yourname.github.io`.

## Install on phones

### Samsung

1. Open the GitHub Pages link in Chrome or Samsung Internet.
2. Sign in.
3. Open the browser menu.
4. Choose **Install app** or **Add to Home screen**.

### iPhone / iPad

1. Open the GitHub Pages link in Safari.
2. Sign in.
3. Tap Share.
4. Tap **Add to Home Screen**.
5. Tap **Add**.

## Cross-device behavior

Every signed-in device listens to the same Firestore collection in real time. An item saved on one device should appear on other signed-in devices within seconds. Firestore also provides limited offline caching and sends queued edits after the device reconnects.

## Important security recommendation

The included rules are intentionally simple for initial setup. For production use, the next security enhancement should restrict access to a list of specifically approved user IDs rather than every authenticated account.
