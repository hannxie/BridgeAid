# BridgeAid

A lightweight, nationwide resource finder designed for fast use on mobile devices.

## Run locally

```bash
python3 -m http.server 4173
```

Open `http://localhost:4173`.

## Files

- `index.html` — app shell
- `css/styles.css` — mobile-first interface
- `js/app.js` — location, category search, live external searches, BridgeAI popup
- `data/resources.js` — nationwide resource directory

## Notes

The app uses public directory links and live Google/Maps searches. GPS coordinates stay in the browser and are not sent to a BridgeAid server.
