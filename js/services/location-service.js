import { parseOpeningHours } from './schedule-verification-service.js';

const geocodeCache = new Map();
const addressCoordinateCache = new Map();

function timeoutSignal(milliseconds) {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(milliseconds)
    : undefined;
}

export function haversineMiles(lat1, lon1, lat2, lon2) {
  const radius = 3958.8;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const value = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(value));
}

export async function geocodeLocation(query, fetcher = fetch) {
  const value = String(query || '').trim();
  if (!value) throw new Error('Enter a city, ZIP code, county, neighborhood, address, or landmark.');
  const cacheKey = value.toLowerCase();
  const useCache = fetcher === globalThis.fetch;
  if (useCache && geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey);
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=us&limit=3&addressdetails=1&q=${encodeURIComponent(value)}`;
  const response = await fetcher(url, {
    headers: { Accept: 'application/json' },
    signal: timeoutSignal(5000)
  });
  if (!response.ok) throw new Error('Location lookup failed. Try a ZIP code or nearby city.');
  const choices = await response.json();
  if (!choices.length) throw new Error('Location not found. Check the spelling or add a state.');
  if (choices.length > 1 && choices[0].importance && choices[1].importance && Math.abs(choices[0].importance - choices[1].importance) < 0.02) {
    const error = new Error('More than one location matched. Add a state or ZIP code.');
    error.code = 'AMBIGUOUS_LOCATION';
    error.choices = choices.slice(0, 3).map(c => c.display_name);
    throw error;
  }
  const result = { lat: Number(choices[0].lat), lng: Number(choices[0].lon), label: choices[0].display_name };
  if (useCache) geocodeCache.set(cacheKey, result);
  return result;
}

export function buildOverpassQuery(lat, lng, radiusMiles = 5) {
  const meters = Math.min(40234, Math.max(1609, Number(radiusMiles) * 1609.344));
  return `[out:json][timeout:28];(nwr(around:${Math.round(meters)},${lat},${lng})[amenity=social_facility];nwr(around:${Math.round(meters)},${lat},${lng})[social_facility];nwr(around:${Math.round(meters)},${lat},${lng})[amenity=food_bank];nwr(around:${Math.round(meters)},${lat},${lng})[amenity=community_centre];nwr(around:${Math.round(meters)},${lat},${lng})[amenity=clinic];nwr(around:${Math.round(meters)},${lat},${lng})[healthcare=clinic];nwr(around:${Math.round(meters)},${lat},${lng})[office=ngo];nwr(around:${Math.round(meters)},${lat},${lng})[office=government];);out center tags;`;
}

export function inferCategory(tags = {}) {
  const text = [tags.name, tags.description, tags.social_facility, tags.amenity, tags.healthcare, tags.office, tags.operator]
    .filter(Boolean).join(' ').toLowerCase();
  if (/food|pantry|meal|hunger|soup|bank/.test(text)) return 'food';
  if (/shelter|homeless|housing|refuge|group_home/.test(text)) return 'shelter';
  if (/safe place|domestic violence/.test(text)) return 'safe';
  if (/mental|counsel|behavior|addiction|substance/.test(text)) return 'mental';
  if (/clinic|health|medical|hospital|doctor|dental/.test(text)) return 'health';
  if (/legal|law|immigra/.test(text)) return 'legal';
  if (/employment|workforce|job/.test(text)) return 'jobs';
  if (/transport|transit/.test(text)) return 'transport';
  if (/benefit|government|social_security|welfare/.test(text)) return 'benefits';
  return 'family';
}

export function normalizeOsmElement(element, origin) {
  const tags = element.tags || {};
  const point = element.center || element;
  const lat = Number(point.lat);
  const lng = Number(point.lon);
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const address = [street, tags['addr:city'] || tags['addr:place'], tags['addr:state'], tags['addr:postcode']].filter(Boolean).join(', ');
  const osmUrl = `https://www.openstreetmap.org/${element.type}/${element.id}`;
  const languages = String(tags['contact:language'] || tags.language || '')
    .split(/[;,]/)
    .map(value => value.trim())
    .filter(Boolean);
  return {
    id: `osm-${element.type}-${element.id}`,
    name: tags.name || tags.operator || 'Community service organization',
    category: inferCategory(tags),
    services: [inferCategory(tags)],
    lat,
    lng,
    address,
    phone: tags.phone || tags['contact:phone'] || '',
    website: tags.website || tags['contact:website'] || '',
    hours: tags.opening_hours || '',
    weeklyHours: parseOpeningHours(tags.opening_hours),
    description: tags.description || tags['service:description'] || tags.operator || '',
    distance: Number.isFinite(lat) && Number.isFinite(lng) ? haversineMiles(origin.lat, origin.lng, lat, lng) : null,
    source: 'OpenStreetMap contributors',
    sourceUrls: [osmUrl],
    osmUrl,
    availabilityStatus: tags.opening_hours ? 'Schedule published' : 'Schedule uncertain',
    walkInStatus: tags.appointment === 'no' || tags.reservation === 'no' ? 'Walk-ins accepted' : '',
    accessibility: tags.wheelchair === 'yes' ? ['Wheelchair accessible'] : [],
    languages,
    verificationStatus: 'Community-sourced — confirm with organization',
    confidence: tags.website && tags.phone ? 0.7 : 0.45,
    dateDiscovered: new Date().toISOString()
  };
}

export async function fetchNearbyResources({ lat, lng, radius = 5, fetcher = fetch }) {
  const body = `data=${encodeURIComponent(buildOverpassQuery(lat, lng, radius))}`;
  const endpoints = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  const attempts = endpoints.map(async endpoint => {
      const response = await fetcher(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body,
        signal: timeoutSignal(6500)
      });
      if (!response.ok) throw new Error(`Resource search returned ${response.status}.`);
      const data = await response.json();
      return (data.elements || []).map(element => normalizeOsmElement(element, { lat, lng }));
  });
  try {
    return await Promise.any(attempts);
  } catch (error) {
    throw error?.errors?.[0] || new Error('Live resource search is unavailable.');
  }
}

export async function geocodeResourceAddresses(resources, {
  origin,
  fetcher = fetch,
  maximum = 20
} = {}) {
  if (!origin || !Number.isFinite(Number(origin.lat)) || !Number.isFinite(Number(origin.lng))) return resources;
  const candidates = resources.filter(resource => (
    resource.address
    && !(Number.isFinite(Number(resource.latitude ?? resource.lat)) && Number.isFinite(Number(resource.longitude ?? resource.lng)))
  )).slice(0, maximum);
  await Promise.allSettled(candidates.map(async resource => {
    const key = String(resource.address).trim().toLowerCase();
    if (addressCoordinateCache.has(key)) return;
    const point = await geocodeLocation(resource.address, fetcher);
    addressCoordinateCache.set(key, { lat: point.lat, lng: point.lng });
  }));
  return resources.map(resource => {
    const rawLat = resource.latitude ?? resource.lat;
    const rawLng = resource.longitude ?? resource.lng;
    const cached = addressCoordinateCache.get(String(resource.address || '').trim().toLowerCase());
    const lat = Number.isFinite(Number(rawLat)) ? Number(rawLat) : cached?.lat;
    const lng = Number.isFinite(Number(rawLng)) ? Number(rawLng) : cached?.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return resource;
    return {
      ...resource,
      latitude: lat,
      longitude: lng,
      distance: haversineMiles(Number(origin.lat), Number(origin.lng), lat, lng)
    };
  });
}

export function clearLocationCaches() {
  geocodeCache.clear();
  addressCoordinateCache.clear();
}
