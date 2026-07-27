# BridgeAid Final — Live Search Edition

BridgeAid is a no-build static web application for finding community assistance in the United States.

## What is now real

The search form performs a live two-step query:

1. Nominatim converts a U.S. city, ZIP code, or address into coordinates.
2. Overpass API searches OpenStreetMap within roughly 30 km for mapped social facilities, food banks, shelters, community centers, clinics, nonprofits, and government service offices.

Results are rendered inside BridgeAid with available name, address, phone, website, opening hours, service type, distance, directions, and the original OpenStreetMap record. National official directories remain below the live results as reliable fallback resources.

## Run

For best results, serve the folder over HTTP rather than opening it with `file://`:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

You can also deploy the folder unchanged to GitHub Pages, Netlify, Vercel, Cloudflare Pages, or any static host.

## Important limitations

OpenStreetMap is community-maintained, so coverage and fields such as opening hours vary by city and organization. Always call or check the provider website before visiting. Live search also depends on public Nominatim and Overpass availability and internet access.
