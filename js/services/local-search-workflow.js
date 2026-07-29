const VALID_UNITS = new Set(['mi', 'km']);
const VALID_TRAVEL_MODES = new Set(['walking', 'transit', 'driving']);

function clean(value) {
  return String(value ?? '').trim();
}

function categoriesFrom(input = {}) {
  const selected = Array.isArray(input.categories)
    ? input.categories.map(clean).filter(Boolean)
    : [];
  const category = clean(input.category || selected[0]);
  const categories = [...new Set(selected.length ? selected : [category])]
    .filter(value => value && !['all', 'other'].includes(value));
  return { category, categories };
}

export function normalizeLocalSearchRequest(input = {}, defaults = {}) {
  const { category, categories } = categoriesFrom(input);
  const location = clean(input.location);
  const otherNeed = clean(input.otherNeed);
  const situation = clean(input.situation);
  const coordinates = Number.isFinite(Number(input.coordinates?.lat))
    && Number.isFinite(Number(input.coordinates?.lng))
    ? { lat: Number(input.coordinates.lat), lng: Number(input.coordinates.lng) }
    : null;

  if (!category) {
    return { ok: false, errorKey: 'locationRequired', focus: input.mode === 'helper' ? '[data-intake-category]' : '#needSelect' };
  }
  if (!location && !coordinates) {
    return { ok: false, errorKey: 'locationRequired', focus: input.mode === 'helper' ? '#helperLocationInput' : '#locationInput' };
  }
  if (category === 'other' && !otherNeed) {
    return { ok: false, errorKey: 'otherNeedRequired', focus: '#otherNeedInput' };
  }

  const unit = VALID_UNITS.has(clean(input.unit)) ? clean(input.unit) : clean(defaults.unit) || 'mi';
  const travelMode = VALID_TRAVEL_MODES.has(clean(input.travelMode))
    ? clean(input.travelMode)
    : clean(defaults.travelMode) || 'walking';
  const radiusValue = [1, 5, 10, 25].includes(Number(input.radiusValue))
    ? Number(input.radiusValue)
    : Number(defaults.radiusValue) || 5;

  return {
    ok: true,
    request: {
      mode: input.mode === 'helper' ? 'helper' : 'self',
      category,
      categories,
      otherNeed,
      situation,
      location: location || clean(defaults.gpsLabel) || 'Current location',
      coordinates,
      unit,
      radiusValue,
      travelMode,
      context: clean(input.context)
    }
  };
}

export function applyLocalSearchRequest(state, request, {
  parseSituation,
  sourceResources
} = {}) {
  state.category = request.category;
  state.searchCategories = [...request.categories];
  state.otherNeed = request.otherNeed;
  state.situation = request.situation;
  state.location = request.location;
  state.coordinates = request.coordinates;
  state.unit = request.unit;
  state.radiusValue = request.radiusValue;
  state.travelMode = request.travelMode;
  state.locationSuggestions = [];
  state.searched = true;
  state.liveResults = [];
  state.storedResults = sourceResources;
  state.visibleResults = 20;
  state.errorKey = '';
  state.errorText = '';
  state.noticeKey = '';
  if (parseSituation) {
    state.situationConstraints = parseSituation(
      [request.otherNeed, request.situation, request.context].filter(Boolean).join(' '),
      { location: request.location, coordinates: request.coordinates }
    );
  }
  return state;
}
