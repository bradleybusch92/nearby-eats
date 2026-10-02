# Nearby Eats

A mobile-first Progressive Web App (PWA) that finds nearby food, filters the results, and sorts them by actual distance from your device.

## Features

- iPhone/browser GPS location
- Google Maps Platform Places data
- Nearest-first sorting
- Open Now
- Search radius
- Minimum rating
- Price filters
- Cuisine/type filters
- Keyword search
- Takeout, delivery, dine-in, outdoor seating, and reservation filters
- Direct links to Google Maps
- Installable on the iPhone Home Screen
- API key stored only in the browser's local storage

## Google Cloud setup

1. Create or choose a Google Cloud project.
2. Attach billing.
3. Enable **Maps JavaScript API** and **Places API (New)**.
4. Create an API key.
5. Restrict it to **Websites / HTTP referrers** and allow:
   - `https://bradleybusch92.github.io/nearby-eats/*`
6. Restrict the key to:
   - Maps JavaScript API
   - Places API (New)

Do not commit an unrestricted key to this repository.

## GitHub Pages

This repository is intended to publish at:

`https://bradleybusch92.github.io/nearby-eats/`

In the repo, go to **Settings → Pages**, choose **Deploy from a branch**, then select `main` and `/ (root)`.

## First launch

1. Open the Pages URL in Safari.
2. Allow location access.
3. Tap the gear icon.
4. Paste the browser-restricted Google Maps API key.
5. Search.

## Install on iPhone

In Safari: **Share → Add to Home Screen**.

## Limitation

Google's browser Places text search returns up to 20 places per search. That fits the nearest-food use case well, but a future backend version could support broader result sets and other advanced features.
