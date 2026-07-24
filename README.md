# BridgeAid

AI-powered multilingual community resource prototype for Philadelphia.

## Run locally

No build step or dependencies are required. From this folder:

```bash
python3 -m http.server 4173
```

Open `http://localhost:4173`.

## Structure

- `index.html` — application shell
- `css/styles.css` — responsive, accessible design system
- `js/app.js` — routing, translations, search/filter logic, saved state, details, reports, and assistant
- `data/resources.js` — 12 structured Philadelphia-area resource records

## Prototype and simulated behavior

- The assistant is a local keyword/intent matcher. It never calls a live AI service and searches only `resources.js`.
- Chinese and Spanish interface translations are local translation objects. Resource translated summaries are prototype-localized summaries; original eligibility facts remain in English and the source link is always available.
- “Report outdated information” validates input and shows a local success state; it does not send email or create a backend ticket.
- “Open today” is intentionally `unknown` when official sources do not provide dependable daily hours.
- Saved resource IDs and language preference are stored in browser `localStorage`. No account, analytics, automatic geolocation, or sensitive information storage is used.

## Adding a backend or real AI

Replace `data/resources.js` with an API-backed repository while preserving the resource schema. Replace `answerChat()` in `js/app.js` with a server endpoint that retrieves only verified resources and constrains generation to returned facts. Keep source URLs, verification dates, uncertainty labels, and safety language in every response.
