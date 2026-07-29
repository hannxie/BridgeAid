# Repeat-search repair

## Root cause

Repeat searches could leave the results page empty or show a full verification
failure even when current stored resources were available. Several lifecycle
problems combined:

- The submission path cleared rendered results before it synchronously cleared
  the previous loading and error state.
- A top-level request coordinator reused an identical in-flight search after the
  UI had already been emptied, so the repeated action did not own a fresh UI
  lifecycle.
- Optional live discovery or schedule verification failures were promoted to a
  total search failure instead of preserving valid stored results.
- Background enrichment was keyed by query but was not guarded by the latest
  request instance, allowing an older request to settle newer UI state.
- Situation-derived filters and helper-selected categories could leak into a
  later manual search.
- Self mode submitted a form, helper mode used an unrelated button handler, and
  GPS partially mutated state before calling discovery. Those three entry paths
  disagreed about validation, categories, coordinates, persistence, and
  transient-result reset.

## Repair invariants

`search-lifecycle-service.js` gives every user search a unique request ID.
Starting a search synchronously resets transient state. Only the current request
may publish results, notices, errors, or the final loading state. Per-resource
verification uses settled results, so one failed verification cannot reject the
whole result set. A live-source failure is a partial-results notice when current
stored results exist, and becomes a Retry error only when no usable result
remains.

Diagnostics record a request ID, category, result count, failure code, and a
one-way search fingerprint. They do not record the raw location, situation text,
or error message.

`local-search-workflow.js` now normalizes and validates every self, helper,
autocomplete, and GPS request before applying the same state transition. UI
handlers only collect mode-specific inputs; they no longer implement their own
search behavior. Exact coordinates stay in memory and are not passed to browser
storage.

## Regression coverage

Automated coverage verifies self/helper parity, missing-field behavior, GPS
handling, fresh transient state, retry after failure, newest request ownership
during rapid changes, and partial-versus-total failure outcomes. Browser QA
covers both modes, repeated same-location searches, category changes,
navigation away and back, enabled submission after completion, and desktop and
mobile layouts.
