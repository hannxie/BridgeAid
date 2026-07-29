export function createSearchLifecycle() {
  let sequence = 0;
  let current = null;
  return {
    begin(key) {
      current = Object.freeze({
        id: ++sequence,
        key: String(key || ''),
        startedAt: Date.now()
      });
      return current;
    },
    isCurrent(request) {
      return Boolean(request && current
        && request.id === current.id
        && request.key === current.key);
    },
    finish(request) {
      if (!this.isCurrent(request)) return false;
      current = null;
      return true;
    },
    active() {
      return current;
    }
  };
}

export function beginSearchState(state, { key, requestId, clearResults = true } = {}) {
  state.activeSearchKey = String(key || '');
  state.activeSearchId = Number(requestId) || 0;
  state.errorKey = '';
  state.errorText = '';
  state.noticeKey = '';
  state.locationSuggestions = [];
  state.loading = true;
  state.discoveryStatus = 'discovering';
  if (clearResults) state.liveResults = [];
  return state;
}

export function completeSearchState(state, {
  hasResults = false,
  errorKey = '',
  noticeKey = ''
} = {}) {
  state.loading = false;
  state.errorKey = errorKey;
  state.noticeKey = noticeKey;
  state.discoveryStatus = hasResults ? 'verified-results-available' : errorKey ? 'unavailable' : 'no-results-yet';
  return state;
}

export function searchFailureOutcome(error, hasResults = false) {
  const code = String(error?.code || '');
  if (code === 'AMBIGUOUS_LOCATION') {
    return { errorKey: 'locationAmbiguous', noticeKey: '', partial: false };
  }
  if (code === 'LOCATION_NOT_FOUND') {
    return { errorKey: 'locationNotFound', noticeKey: '', partial: false };
  }
  if (hasResults) {
    return { errorKey: '', noticeKey: 'searchPartialResults', partial: true };
  }
  return { errorKey: 'searchUnavailable', noticeKey: '', partial: false };
}

export function diagnosticFingerprint(value) {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
