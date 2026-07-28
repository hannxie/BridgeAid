export function safeStorageGet(key, fallback, storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function safeStorageSet(key, value, storage = globalThis.localStorage) {
  try {
    storage?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function safeStorageRemove(key, storage = globalThis.localStorage) {
  try {
    storage?.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function validMode(value) {
  return value === 'self' || value === 'helper' ? value : '';
}

export function loadMode(storage = globalThis.localStorage) {
  return validMode(safeStorageGet('bridgeaid-mode', '', storage));
}

export function switchMode(state, mode, storage = globalThis.localStorage) {
  const next = validMode(mode);
  if (!next) return false;
  state.mode = next;
  safeStorageSet('bridgeaid-mode', next, storage);
  return true;
}

export function clearPrivateData(storage = globalThis.localStorage) {
  [
    'bridgeaid-location',
    'bridgeaid-helper-intake',
    'bridgeaid-helper-plan',
    'bridgeaid-resource-cache',
    'bridgeaid-saved-searches',
    'ba-location',
    'ba-coords'
  ].forEach(key => safeStorageRemove(key, storage));
}
