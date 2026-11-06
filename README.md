# Shop Stock — Android app

The Shop Stock Manager as a real Android app: live barcode scanning, automatic product details from
Open Food Facts, and your data in your own Google Firebase project.

## How a new version gets onto your phone
1. Changes are pushed to this repository.
2. GitHub builds the app automatically (Actions tab, about 5–8 minutes).
3. Open **Releases** on your phone, download the newest `ShopStock-N.apk`, and open it to install or update.

## Folders
- `app/` — the shop app itself (same code as the claude.ai version)
- `src/platform.js` — the Android bridge: Firebase database and sign-in, scanner, product lookup, sharing files
- `src/firebase-config.js` — which Firebase project to connect to
- `firestore.rules` — who can see what (paste into Firebase → Firestore → Rules)
- `android/` — the Android project (Capacitor)

The signing key in `android/app/` is for personal installs only. Before any public Play Store release,
create a new private upload key and keep it out of the repository.
