# BridgeAid Web

A responsive multilingual community-resource navigation prototype.

## Run

```bash
cd BridgeAid-Web
python3 -m http.server 4173
```

Open `http://localhost:4173`.

## Included

- English, Simplified Chinese, and Spanish interface
- Trusted public resource directory
- Category filtering and location-aware map searches
- Saved resources using localStorage
- Local AI-style intent matching assistant
- Emergency, 211, and 988 safety links
- Mobile responsive and keyboard accessible layout

## Prototype limitations

- The assistant uses local keyword matching, not a live AI API.
- Eligibility is never guaranteed.
- “Live search” cards open external map searches.
- Language, location, and saved resource IDs remain in the browser.
