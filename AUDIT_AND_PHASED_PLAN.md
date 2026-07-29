# BridgeAid audit and phased implementation

Audit date: 2026-07-28

## Architecture audited

BridgeAid remains a no-build static progressive web app:

- `index.html`, `css/styles.css`, and `js/app.js` provide the user interface.
- `js/services/` contains deterministic location, resource, schedule, eligibility, registration, assistant, storage, performance, correction, and planning logic.
- `data/resources.js` contains curated records and internal verification evidence.
- `service-worker.js` caches application assets, not an authoritative resource database.
- `migrations/` describes a future production database. No migration is executed by the static app.
- `server/services/` contains testable administration and background-job models, but this repository does not run a production server or worker.
- `.env.example` reserves backend database, identity, geocoding, and verification-provider settings. The static client has no secret environment variables.

## Root causes and implemented fixes

| Area | Root cause found | Implemented change |
| --- | --- | --- |
| Stale saved results | The Saved page normalized all stored records without checking `resourceIsFresh()` | Saved cards now require a current verification period; hidden items show a retry path |
| Search limit | Three live-search merge paths used `.slice(0, 50)` | Removed the cap and added 20-at-a-time UI pagination |
| Location coverage | Geocoding accepted arbitrary U.S. queries, but suggestions appeared only after an ambiguous submission | Added typed U.S. autocomplete with five-result deduplication to both intake modes |
| Repeated inconsistency | The cache key omitted the free-text situation, derived categories, filters, and sort; partial arrivals replaced arrays in separate paths | Added normalized search signatures, atomic merge helpers, request coordination, active-key guards, stable sorting, and structured diagnostics |
| Intake transition | Helper text values depended on a late `change` event and could disappear when autocomplete re-rendered the form | Persist helper text on `input`; visibly require category, immediate need, and location |
| Free-text relevance | Only the custom “Other” value influenced category detection | Combine structured category, custom need, and situation text; derive no-ID, today, and accessibility filters |
| Category presentation | Cards shared one tag color | Added accessible category-specific accents while retaining text labels and icons |
| Eligibility fallback | The low-level evaluator returned “Unable to determine” | Replaced it with the required temporary-unavailable state and exact no-published-requirements disclosure |
| Nationwide separation | Local-provider locators were marked `nationwide-online` | Reclassified them as internal provider directories and excluded them from nationwide cards |
| Education coverage | UI and nationwide data used only “Education,” with no nationwide listing | Renamed the category to Education and Scholarships and added a verified Federal Student Aid/FAFSA record |
| Application methods | Nationwide filters exposed only online, phone, and local-provider choices | Added mail, in-person, and multiple-method filtering |
| BridgeAI lag and layout | Search enrichment could overlap and chat presentation was cramped | Retained stored-first responses and request deduplication; verified message gap, padding, widths, and response metrics |
| Decision intelligence | The old “plan” was a saved list with notes/status only | Added an optional action-plan generator that considers urgency, published hours, deadlines, documents, application methods, distance, transportation, budget, walking limits, wheelchair access, childcare, and physical limits |
| Background coverage | Verification jobs existed, but there was no coverage-gap discovery model | Added deterministic discovery-job generation and a database migration for coverage gaps, search runs, and eligibility evidence |

## Delivery phases

1. **Safety and determinism** — freshness enforcement, normalized signatures, stable merges, logging, and pagination.
2. **Nationwide discovery UX** — typed location suggestions, arbitrary U.S. coordinates/radius search, category expansion, and provider-directory separation.
3. **Program guidance** — exact eligibility states, application-method labels, intake free text, and verified education aid.
4. **Decision and optimization intelligence** — constraint-aware sequencing with exclusions, tradeoffs, reusable documents, travel estimates, and explicit non-guarantees.
5. **Production data operations** — run migrations, connect a real database and worker, configure licensed geocoding/place/verification providers, and continuously execute coverage-gap discovery and evidence review.

## Verification completed

- `npm run check`: 92 tests passing.
- Browser workflows: self search, typed ZIP suggestions, helper search transition, nationwide separation, Eligibility, multilingual BridgeAI response, action-plan generation, and no console errors.
- Responsive checks: no horizontal overflow at 320 px, 768 px, and desktop; chat remained within the viewport.

## Production dependencies not present in this repository

The static app can search live public map data and use curated records, but continuous nationwide research cannot run when no user has the page open. Completing phase 5 operationally requires a hosted backend, migrated database, scheduled workers, provider credentials, rate limits, evidence-review tooling, and monitoring. The schema and job contracts are present; deployment and credentials are external operational work and must not be represented as already running.
