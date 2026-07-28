const DAY_IDS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function clock(value = {}) {
  const hour = Number(value.hour);
  const minute = Number(value.minute || 0);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function googlePeriodsToWeeklyHours(periods = []) {
  const weekly = Object.fromEntries(DAY_IDS.map(day => [day, []]));
  for (const period of periods) {
    const day = DAY_IDS[Number(period?.open?.day)];
    const open = clock(period?.open);
    const close = clock(period?.close);
    if (!day || !open || !close) continue;
    weekly[day].push({ open, close });
  }
  return weekly;
}

function googleDate(value = {}) {
  const year = Number(value.year);
  const month = Number(value.month);
  const day = Number(value.day);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function googleSpecialHours(currentOpeningHours = {}) {
  const byDate = new Map();
  for (const period of currentOpeningHours.periods || []) {
    const date = googleDate(period?.open?.date);
    const open = clock(period?.open);
    const close = clock(period?.close);
    if (!date || !open || !close) continue;
    const entry = byDate.get(date) || { date, periods: [], label: '' };
    entry.periods.push({ open, close });
    byDate.set(date, entry);
  }
  for (const day of currentOpeningHours.specialDays || []) {
    if (!day?.exceptionalHours) continue;
    const date = googleDate(day.date);
    if (date && !byDate.has(date)) byDate.set(date, { date, periods: null, label: '' });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function placesApiKey(documentRef = globalThis.document) {
  return documentRef?.querySelector?.('meta[name="google-places-api-key"]')?.content?.trim() || '';
}

export async function findConfiguredPlace(resource, {
  apiKey,
  fetcher = fetch,
  timeoutMs = 5000
} = {}) {
  if (!apiKey) return null;
  const response = await fetcher('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': [
        'places.id',
        'places.displayName',
        'places.formattedAddress',
        'places.location',
        'places.nationalPhoneNumber',
        'places.websiteUri',
        'places.businessStatus',
        'places.regularOpeningHours',
        'places.currentOpeningHours'
      ].join(',')
    },
    body: JSON.stringify({
      textQuery: [resource.name, resource.address].filter(Boolean).join(' ')
    }),
    signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(timeoutMs)
      : undefined
  });
  if (!response.ok) throw new Error(`Google Places lookup returned ${response.status}.`);
  const data = await response.json();
  return data.places?.[0] || null;
}

export function mergePlaceEvidence(resource, place, verifiedDate = new Date().toISOString().slice(0, 10)) {
  if (!place) return resource;
  const placeSource = place.id ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(place.id)}` : '';
  const conflicts = [...(resource.conflicts || [])];
  const compare = (field, official, discovered) => {
    if (official && discovered && String(official).trim().toLowerCase() !== String(discovered).trim().toLowerCase()) {
      conflicts.push(`${field}: official source says "${official}"; configured Google Places data says "${discovered}".`);
    }
  };
  compare('Address', resource.address, place.formattedAddress);
  compare('Phone', resource.phone, place.nationalPhoneNumber);
  compare('Website', resource.officialWebsite || resource.website || resource.url, place.websiteUri);

  const placeWeeklyHours = googlePeriodsToWeeklyHours(place.regularOpeningHours?.periods || []);
  const hasPlaceHours = Object.values(placeWeeklyHours).some(periods => periods.length);
  const placeSpecialHours = googleSpecialHours(place.currentOpeningHours);
  if (
    resource.weeklyHours
    && hasPlaceHours
    && JSON.stringify(resource.weeklyHours) !== JSON.stringify(placeWeeklyHours)
  ) {
    conflicts.push('Weekly hours differ between the official source and configured Google Places data.');
  }
  return {
    ...resource,
    address: resource.address || place.formattedAddress || '',
    phone: resource.phone || place.nationalPhoneNumber || '',
    officialWebsite: resource.officialWebsite || resource.website || resource.url || place.websiteUri || '',
    latitude: resource.latitude ?? resource.lat ?? place.location?.latitude ?? null,
    longitude: resource.longitude ?? resource.lng ?? place.location?.longitude ?? null,
    weeklyHours: resource.weeklyHours || (hasPlaceHours ? placeWeeklyHours : null),
    holidayHours: resource.holidayHours?.length ? resource.holidayHours : placeSpecialHours,
    hoursSourceUrl: resource.hoursSourceUrl || placeSource,
    hoursLastVerified: resource.hoursLastVerified || (hasPlaceHours ? verifiedDate : ''),
    temporaryClosure: Boolean(resource.temporaryClosure) || place.businessStatus === 'CLOSED_TEMPORARILY',
    placesSourceUrl: placeSource,
    placesLastVerified: verifiedDate,
    sourceUrls: [...new Set([...(resource.sourceUrls || []), placeSource].filter(Boolean))],
    conflicts: [...new Set(conflicts)]
  };
}

export async function enrichWithConfiguredPlaces(resource, options = {}) {
  const place = await findConfiguredPlace(resource, options);
  return mergePlaceEvidence(resource, place, options.verifiedDate);
}
