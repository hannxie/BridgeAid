# BridgeAid Final

A multilingual, mobile-first static web application for finding trusted U.S. community-service resources.

## Run

### Easiest
Open `index.html` in a modern browser. Most features work directly. GPS and offline caching may require HTTP/HTTPS.

### Recommended local server
```bash
python3 -m http.server 8080
```
Then open `http://localhost:8080`.

## Deploy

### GitHub Pages
1. Upload all files to a public repository.
2. Go to Settings → Pages.
3. Deploy from the `main` branch root.

### Netlify / Vercel
Drag the folder into Netlify Drop, or import the repository into Vercel. No build command is required.

## Features
- Natural-language keyword extraction in English, Chinese, and Spanish
- Need + location search
- Category filters and relevance sorting
- Trusted national directories
- Live Google Maps searches near a city, ZIP code, or GPS coordinate
- Detailed hours, services, eligibility, access instructions, source, and verification date
- Saved resources and persistent settings in localStorage
- Responsive, keyboard-accessible UI
- Optional PWA caching over HTTP/HTTPS

## Important limitation
BridgeAid does not contain every local provider in the United States. Instead, it combines verified national directories with live nearby searches. Local hours, eligibility, and availability can change; users should call or check the provider website before traveling.
