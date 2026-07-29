# BridgeAid

BridgeAid is a privacy-oriented, no-build web application for finding free and reduced-cost community support in the United States. This repository extends the existing BridgeAid project in place; it does not replace the project or create a separate application.

The app now has two experiences in one shared interface:

- **I need help** (`self`) prioritizes immediate actions, plain language, a need dropdown, and focused next steps.
- **I’m helping someone** (`helper`) adds optional guided intake, resource comparison, status tracking, notes, and a printable resource plan.

Every real-world resource shown by BridgeAid has a traceable source. Availability and eligibility are never guaranteed.

## Repository assessment

The original project was a static HTML/CSS/JavaScript progressive web app with:

- Manual city, address, or ZIP search
- Optional browser geolocation
- Client-side Nominatim geocoding
- Client-side OpenStreetMap Overpass resource discovery
- Category and keyword matching
- National fallback resources
- English, Spanish, and Simplified Chinese labels
- Saved resources in browser storage
- A general 211 community-resource link
- A service worker for offline assets
- Responsive and reduced-motion CSS

The original architecture used one large `js/app.js` file. It had no automated tests, server, database, structured resource normalization, cache-first search, two-mode state, helper plans, eligibility rules engine, schedule parser, registration validation, background jobs, or authenticated staff tools. Exact GPS coordinates were also written to browser storage.

The implementation kept the no-build static architecture and existing resource records, then extracted testable service modules. Exact GPS coordinates are no longer persisted.

## Implemented stages

1. **Assessment and stabilization** — preserved the existing dataset, search, language, emergency, and offline foundations.
2. **Shared modes** — added the first-visit selector, `bridgeaid-mode` persistence, and an always-available header switcher.
3. **Self and helper interfaces** — added urgent self-service categories, helper intake, plans, comparison, notes, statuses, copy, print, remove, and clear.
4. **Resource foundation** — added resource normalization, source evidence, duplicate merging, filtering, ranking, and a persistent device-local search cache.
5. **Location foundation** — added 1/5/10/25-mile search radiuses, ambiguity/error handling, geographic ranking, manual fallback, and non-persistent GPS coordinates.
6. **Schedules** — added deterministic recurring-schedule parsing, next-event calculation, time-zone formatting, stale/uncertain states, and conflict preservation.
7. **Eligibility** — added relevant-question selection, deterministic rule evaluation, household-size income tables, explainable results, and transient answers.
8. **Registration** — added HTTPS/official-domain validation, safe instructions, calling scripts, and explicit confirmation/authorization gates.
9. **Administration foundation** — added a database migration, authorization guard, audited admin action model, and retryable background-job model without exposing a public dashboard.
10. **Hardening** — added deterministic tests, HTML escaping, safe links, phone sanitization, local-storage failure handling, offline states, and responsive browser checks.
11. **Local action paths** — added verified Seattle-area programs with structured local eligibility, full addresses, required documents, exceptions, deadlines, application steps, and direct official actions.
12. **Nationwide search and decision intelligence** — added five-result U.S. autocomplete, normalized search signatures, uncapped paginated results, stale-saved-result blocking, coverage-gap discovery jobs, nationwide/local-provider separation, and Education and Scholarships.
13. **Exact-situation ranking** — parses requested service, local date/time, urgency, distance, transportation, no-ID, appointment, accessibility, age, and household constraints; verified exact-time availability changes ranking and is explained on every result.
14. **Program eligibility operations** — stores eligibility per organization and program, distinguishes pending/review/no-public-rules/technical-failure states, queues official-source research, and provides a CSV administrative export while keeping the application database authoritative.
15. **Expanded national actions** — the nationwide catalog now includes more than twenty verified, actionable applications, assessments, claims, courses, searches, and counseling pathways across the requested categories.
16. **Shared local search and short national screening** — self mode, helper mode, autocomplete refreshes, and GPS now use one validated Local Help workflow. Nationwide Help includes an optional, conditional, at-most-eight-question preliminary matcher across all 52 national entries, including 10 provider directories.

## User modes

On the first visit, BridgeAid asks:

> How are you using BridgeAid?

The choice is stored under `bridgeaid-mode` and validated as either `self` or `helper`. Switching modes does not change `bridgeaid-location`, saved resources, or the other mode’s data.

### Self mode

Self mode uses the heading “What do you need right now?” and a translated, required need dropdown covering food, housing, healthcare, mental health, transportation, clothing and hygiene, employment, education and scholarships, childcare and family support, legal assistance, financial assistance and benefits, disability services, veteran services, immigration assistance, internet and technology, and an “Other” field. Location is also required. A separate situation field lets details such as “tonight,” “no identification,” or wheelchair access affect filters and ranking. The home page does not preload resources.

Resource actions prioritize call, walking directions, and official sources. Users can switch to transit or driving directions. Empty facts are omitted, typical hours are labeled, and an uncertain schedule appears only after available sources have been checked.

### Helper mode

Helper mode uses the heading “Help someone find support.” Service category, immediate need, and location are visibly required. Other constraints remain optional, and the intake does not request a name or highly sensitive identifiers. Location autocomplete is shared with self mode.

The helper plan supports:

- Selecting and removing resources
- Comparing up to three resources
- Status: Not contacted, Called, Confirmed, or Unavailable
- A short local note
- Phone, official link, directions, eligibility summary, registration information, and documents
- Plain-text copy
- Printing with `window.print()`
- Clearing the complete helper intake and plan

The safety-today response does not hide ordinary resources. BridgeAid keeps 211 available for general community-resource referrals.

## BridgeAI architecture

Users see one BridgeAI assistant. `js/services/grounded-assistant.js` detects the latest-message language, intent, category, and location; remembers conversation context; and recommends only stored or live sourced records:

```text
BridgeAI
├── Location and Resource Finder
├── Hours and Event Verification
├── Eligibility Assistant
├── Registration Assistant
└── Internet Discovery foundation
```

The current browser implementation is deterministic and source-bound; it does not call a generative AI API. It only reuses cached or curated records while they remain inside their approved verification period. Expired records are hidden and queued for re-verification, and missing facts are never invented.

Relevant files:

- `js/services/grounded-assistant.js`
- `js/services/location-service.js`
- `js/services/schedule-service.js`
- `js/services/eligibility-service.js`
- `js/services/registration-service.js`
- `js/services/local-eligibility-service.js`
- `js/services/schedule-verification-service.js`
- `js/services/correction-service.js`
- `js/services/resource-service.js`

## Resource model and persistence

`normalizeResource()` keeps older records usable while supporting structured fields such as organization/program names, coordinates, schedules, local eligibility rules, documents, accessibility, languages, transportation, source URLs, verification status, and conflicts. Confidence scores are not displayed.

The existing national records remain in `data/resources.js`.

### Cache-first search

1. Build a key from the general location, category, and radius.
2. Render a saved result only when every displayed record remains inside its verification period.
3. If online, geocode the location and query OpenStreetMap.
4. Normalize and merge duplicate results without losing source URLs.
5. Rank by relevance, distance, availability, and source completeness.
6. Save the refreshed result in the versioned `bridgeaid-resource-cache-v12`.
7. If current information cannot be verified, hide expired records and show a retry path instead of silently substituting stale data.

OpenStreetMap data is community-maintained and explicitly labeled for confirmation.

### Optional Google Places cross-check

BridgeAid only calls the approved Google Places API (New) when
`<meta name="google-places-api-key">` in `index.html` has a non-empty key. The
cross-check may fill missing coordinates or hours, but official provider data
remains authoritative and disagreements are shown as conflicts. Leave the meta
value empty to disable Places requests.

### BridgeAI response measurement

The chat panel exposes its most recent stored-answer latency as
`data-response-ms` and its strategy as `data-response-strategy`. In the local
desktop workflow check on 2026-07-28, the previous live-first request path took
6,083 ms to finish geocoding and live discovery. The stored-first BridgeAI path
rendered its grounded answer in 16 ms, while the same live enrichment continued
in the background. Exact timings vary by device and network.

### Future server database

`migrations/001_resource_foundation.sql` and `migrations/002_correction_verification.sql` define the production-oriented foundation for:

- Resources
- Supporting sources
- Conflicting facts
- Correction reports
- Background jobs
- Administrative audit logs

The migration is **not executed by the current static app**. There is no production database in this repository.

## Storage and privacy

BridgeAid may store these values in the current browser profile:

| Key | Purpose | Deletion |
| --- | --- | --- |
| `bridgeaid-mode` | Self/helper preference | Switch mode or clear site data |
| `bridgeaid-location` | General search location | Privacy page |
| `bridgeaid-helper-intake` | Optional helper constraints and notes | Clear intake/plan or Privacy page |
| `bridgeaid-helper-plan` | Selected resources, status, and notes | Clear this plan or Privacy page |
| `bridgeaid-resource-cache-v12` | Faster repeated/offline searches | Privacy page |
| `bridgeaid-saved-searches` | Recent general search locations | Privacy page |
| `ba-saved` | Saved resource identifiers | Clear site data |
| `ba-lang` | Language preference | Clear site data |

Not stored by default:

- Exact GPS coordinates
- Eligibility answers
- Nationwide quiz answers
- Names of assisted people
- Social Security numbers
- Medical-record numbers
- Immigration-document numbers
- Banking information
- Passwords
- Identification photographs

Browser storage is not encrypted and is not a secure case-management system. Anyone with access to the device and browser profile may be able to read helper notes. The app does not send notes or eligibility answers to resource organizations.

## Administrative and backend security

No administrative UI is shipped publicly because the repository has no authentication provider or backend runtime. The future server model in `server/services/admin-service.js` rejects unauthenticated and non-admin sessions and records audited changes. `server/services/background-job-service.js` models bounded retries and failure history.

Before production administration can be enabled, implement:

- Server-hosted authentication and role authorization
- CSRF protection for state-changing operations
- A real database connection and migration runner
- Rate limits and request validation
- Secure session management
- Audit-log retention and review
- Server-side geocoding/discovery/verification proxies

Do not add a client-side “admin password”; it would not secure the dashboard.

## Environment variables

The current static application requires no secrets.

`.env.example` documents reserved backend settings:

- `DATABASE_URL`
- `SESSION_SECRET`
- `ADMIN_IDENTITY_PROVIDER_ISSUER`
- `ADMIN_IDENTITY_PROVIDER_CLIENT_ID`
- `ADMIN_IDENTITY_PROVIDER_CLIENT_SECRET`
- `GEOCODING_API_KEY`
- `VERIFICATION_PROVIDER_API_KEY`

Never put these values in `js/`, `index.html`, or another browser-delivered file.

## Run locally

Python:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

The package script provides the same command:

```bash
npm start
```

On Windows systems that block PowerShell script shims, use:

```powershell
npm.cmd start
```

Opening `index.html` through `file://` is not supported because JavaScript modules and the service worker require HTTP.

## Tests

Run:

```bash
npm test
```

or:

```bash
node --test
```

The deterministic suite contains more than 110 checks covering:

- Mode validation, persistence, switching, and location preservation
- Storage corruption and blocked-storage behavior
- Resource normalization, caching, filtering, ranking, source attribution, and duplicate merging
- Offline cache reuse
- Weekly, monthly, last-weekday, and alternating schedules
- Schedule conflict and uncertainty handling
- Time-zone and daylight-saving behavior
- Eligibility questions, summaries, missing information, exceptions, explainable decisions, and household income tables
- Registration-link validation, official-domain restrictions, rich application guidance, and submission authorization
- Exact service taxonomy ordering, expanded category coverage, and verified Seattle resource completeness
- Exact 2026 Seattle utility-income screening and age-range rules
- Geocoding success, ambiguity, empty result, and API failure
- Radius queries, geographic distance, and OpenStreetMap normalization
- HTML escaping, URL safety, and phone sanitization
- Helper plan creation, status, notes, removal, and clearing
- Mode-aware orchestration
- Shared self/helper/GPS local-search request handling
- Complete eligibility metadata for all nationwide resources, conditional quiz questions, cautious matching labels, and the manual-review queue
- Server-side admin authorization and audit history
- Background-job retries
- Required UI/privacy copy and responsive CSS

## Manual verification

1. Clear this site’s local browser data and reload. Confirm the mode selector appears.
2. Choose “I need help,” reload, and confirm the choice persists.
3. Enter a general location, switch to helper mode, switch back, and confirm the location remains.
4. Confirm the Home page is informational and has clear links to Local Help and Nationwide Help, with no search form or preloaded resources.
5. Open Local Help in self mode and confirm need and location are required. Switch to helper mode and complete only location and one support type.
6. Choose “Not safe tonight” and confirm the general safety notice appears without hiding resources.
7. Add a resource to the plan, compare resources, update status, add a note, copy, print, remove, and clear.
8. Search 98101 with Financial Assistance and Benefits, then open the Seattle Utility Discount Program eligibility and registration workflows. Confirm the exact local rules, documents, deadline, official actions, and verified date are shown.
9. Disable the network and repeat a previously cached search. Confirm only still-current verified records remain and expired records are not shown.
10. Test keyboard-only navigation, visible focus, 200% browser zoom, and a screen reader.
11. Test widths of 320 px, 768 px, and desktop.
12. Open Nationwide Help, complete and skip quiz questions, confirm the four cautious match labels and official-source links, then clear or restart the quiz.
13. Inspect the console during critical workflows and confirm there are no uncaught errors.

Automated in-app browser verification was performed at 320 px, 768 px, and 1440 px. It confirmed no horizontal overflow, 44-pixel interactive targets, persistent mode switching, location preservation, helper-plan creation/status/note/clear workflows, and no console errors.

## Accessibility decisions

- Semantic buttons, links, headings, forms, details, lists, table, dialog, and aside regions
- Skip link and persistent visible focus indicators
- 44-pixel minimum interactive targets
- Status text/icons in addition to color
- Live regions for errors, offline state, cache state, and chat responses
- Mobile-first layouts and no horizontal overflow at tested widths
- Reduced-motion support
- Print-specific helper-plan layout
- Escaped user-provided content before DOM insertion

Translations are interface summaries, not replacements for official legal or eligibility language. Official sources remain linked.

## Known limitations and development-only features

- Live Nominatim and Overpass calls still run in the browser. A production deployment should proxy and rate-limit them server-side.
- OpenStreetMap coverage, hours, phone numbers, and websites vary by area.
- Nationwide records all carry eligibility type, questions, rules, official source, verification date, confidence, notes, variation flags, and manual-review status. Many complex programs intentionally remain “More information needed” because a short quiz cannot safely resolve official discretion, state rules, medical decisions, work credits, funding, or inventory.
- No generative model or official-page extraction provider is configured.
- No background worker executes queued jobs.
- No persistent server database is connected.
- The SQL migration, admin service, and job service are development foundations only.
- No authenticated administrative dashboard is exposed.
- No online form is submitted by BridgeAid.
- Correction reports enter a device-local verification queue, attempt source rechecks, and preserve the verified record. Server synchronization and staff review require a production backend.
- Browser storage is device-local, unencrypted, and unsuitable for sensitive case management.
- Live availability, capacity, beds, supplies, appointments, funding, and final eligibility cannot be guaranteed.

## Recommended next steps

1. Add a small authenticated backend and run `migrations/001_resource_foundation.sql`.
2. Proxy geocoding, discovery, source verification, and correction reports through validated rate-limited endpoints.
3. Add reviewed connectors for official government and organization sources.
4. Populate structured schedules and eligibility rules only from traceable official sources.
5. Add authenticated, server-authorized staff review screens after identity and audit infrastructure is available.
6. Run formal assistive-technology testing with NVDA, VoiceOver, and keyboard-only users.
