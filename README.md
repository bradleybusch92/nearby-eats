# Nearby Eats

A mobile-first Progressive Web App (PWA) that restores a feature Google Maps no longer exposes in its normal consumer UI: **food results sorted nearest-first**.

## What it does

- Uses the iPhone/browser's current GPS location
- Searches Google Maps Platform Places data
- Sorts by actual distance from the device
- Open Now filter
- Minimum rating filter
- Price filter ($ through $$$$)
- Food/cuisine/type filter
- Search radius filter
- Keyword search ("wings", "tacos", "steak", etc.)
- Optional takeout, delivery, dine-in, outdoor seating, and reservation filters
- Opens any result directly in Google Maps
- Installs to an iPhone Home Screen as a standalone PWA
- Keeps the Google Maps API key out of the repository by saving it only in browser local storage

## Important limitation

The browser-based Google Maps JavaScript Places `searchByText()` API returns a maximum of 20 results per search.

For a "show me the closest food" app this is usually a good fit. If you later want 40-60 results, server-side pagination, saved favorites, or multiple simultaneous cuisine searches, move the Places call behind a serverless function.

## Google Cloud setup

1. Open Google Cloud Console and create or choose a project.
2. Attach a billing account.
3. Enable:
   - **Maps JavaScript API**
   - **Places API (New)**
4. Create an API key.
5. Restrict the key:
   - Application restriction: **Websites / HTTP referrers**
   - If the repo is named `nearby-eats`, add:
     - `https://bradleybusch92.github.io/nearby-eats/*`
     - `http://localhost:*/*` (optional, for local testing)
   - API restrictions:
     - Maps JavaScript API
     - Places API (New)

Do **not** commit a server API key or an unrestricted key to the repository.

## Publish with GitHub Pages

1. In GitHub, create a repository named `nearby-eats`.
2. Upload all files from this package to the root of the repository.
3. Commit them to `main`.
4. Go to **Settings → Pages**.
5. Under **Build and deployment**, choose **Deploy from a branch**.
6. Select `main` and `/ (root)`, then Save.
7. Open:
   `https://bradleybusch92.github.io/nearby-eats/`

## First launch

1. Open the GitHub Pages URL in Safari on your iPhone.
2. Allow location access.
3. Tap the gear icon.
4. Paste the browser-restricted Google Maps API key and tap **Save key**.
5. Search.

## Install on iPhone

In Safari:

1. Tap **Share**
2. Tap **Add to Home Screen**
3. Name it `Nearby Eats`
4. Tap **Add**

It will then launch in standalone app mode.

## Local testing

Because browser geolocation normally requires a secure context, use localhost instead of opening `index.html` directly.

Example:

```bash
python -m http.server 8080
```

Then visit:

`http://localhost:8080`

## Files

- `index.html` — app UI
- `styles.css` — responsive/mobile styling
- `app.js` — geolocation, filters, Google Places search, sorting
- `manifest.webmanifest` — PWA metadata
- `service-worker.js` — app-shell caching
- `privacy.html` — privacy disclosure
- `terms.html` — terms/disclosure
- `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` — app icons

## Notes on billing

Google Maps Platform bills based on the Places fields requested. Nearby Eats requests ratings and price levels so the search can display/filter them. Google provides monthly free usage caps for Places SKUs, but you should still set a Cloud billing budget/alert and an API quota appropriate for personal use.

## Google Maps attribution

The UI includes Google Maps attribution next to the result list and displays any returned third-party provider attributions on individual results.
