import { parseOpeningHours } from './schedule-verification-service.js';
import { isDisplayableResource, resourceQualityReview } from './resource-quality-service.js';

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

function compactUsLabel(choice) {
  const properties = choice.properties || {};
  const parts = [
    properties.name,
    properties.city || properties.district || properties.county,
    properties.state,
    properties.postcode,
    'USA'
  ].filter(Boolean);
  return [...new Set(parts)].join(', ');
}

export async function suggestLocations(query, fetcher = fetch, limit = 5) {
  const value = String(query || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (value.length < 2) return [];
  const safeLimit = Math.min(5, Math.max(1, Number(limit) || 5));
  const url = `https://photon.komoot.io/api/?limit=${safeLimit}&lang=en&bbox=-179.2,18.9,-66.4,71.6&q=${encodeURIComponent(value)}`;
  const response = await fetcher(url, {
    headers: { Accept: 'application/json' },
    signal: timeoutSignal(4500)
  });
  if (!response.ok) {
    const error = new Error('Location suggestions are temporarily unavailable.');
    error.code = 'LOCATION_LOOKUP_FAILED';
    throw error;
  }
  const features = (await response.json())?.features || [];
  return features
    .filter(feature => String(feature.properties?.countrycode || '').toUpperCase() === 'US')
    .map(feature => ({
      label: compactUsLabel(feature),
      lat: Number(feature.geometry?.coordinates?.[1]),
      lng: Number(feature.geometry?.coordinates?.[0]),
      type: feature.properties?.type || '',
      city: feature.properties?.city || feature.properties?.district || '',
      county: feature.properties?.county || '',
      state: feature.properties?.state || '',
      zip: feature.properties?.postcode || ''
    }))
    .filter(choice => choice.label && Number.isFinite(choice.lat) && Number.isFinite(choice.lng))
    .filter((choice, index, all) => all.findIndex(candidate =>
      `${candidate.lat.toFixed(4)},${candidate.lng.toFixed(4)}` === `${choice.lat.toFixed(4)},${choice.lng.toFixed(4)}`) === index)
    .slice(0, safeLimit);
}

export async function geocodeLocation(query, fetcher = fetch) {
  const value = String(query || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!value) throw new Error('Enter a city, ZIP code, county, neighborhood, address, or landmark.');
  const cacheKey = value.toLowerCase();
  const useCache = fetcher === globalThis.fetch;
  if (useCache && geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey);
  const coordinateMatch = value.match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (coordinateMatch) {
    const direct = { lat: Number(coordinateMatch[1]), lng: Number(coordinateMatch[2]), label: value };
    if (direct.lat >= 18 && direct.lat <= 72 && direct.lng >= -180 && direct.lng <= -60) return direct;
  }
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=us&limit=5&addressdetails=1&q=${encodeURIComponent(value)}`;
  const response = await fetcher(url, {
    headers: { Accept: 'application/json' },
    signal: timeoutSignal(5000)
  });
  if (!response.ok) {
    const error = new Error('Location lookup failed. Try a ZIP code or nearby city.');
    error.code = 'LOCATION_LOOKUP_FAILED';
    throw error;
  }
  const rawChoices = await response.json();
  const choices = rawChoices.filter((choice, index, all) => {
    const key = `${Number(choice.lat).toFixed(4)},${Number(choice.lon).toFixed(4)}`;
    return all.findIndex(candidate =>
      `${Number(candidate.lat).toFixed(4)},${Number(candidate.lon).toFixed(4)}` === key) === index;
  });
  if (!choices.length) {
    const error = new Error('Location not found. Check the spelling or add a state.');
    error.code = 'LOCATION_NOT_FOUND';
    throw error;
  }
  const suggestions = choices.slice(0, 5).map(choice => ({
    label: choice.display_name,
    lat: Number(choice.lat),
    lng: Number(choice.lon),
    city: choice.address?.city || choice.address?.town || choice.address?.village || choice.address?.municipality || '',
    county: choice.address?.county || '',
    state: choice.address?.state || '',
    stateCode: String(choice.address?.['ISO3166-2-lvl4'] || '').split('-')[1] || '',
    zip: choice.address?.postcode || ''
  }));
  const hasStateOrZip = /,\s*[a-z]{2}\b/i.test(value) || /\b\d{5}(?:-\d{4})?\b/.test(value);
  if (!hasStateOrZip && choices.length > 1 && choices[0].importance && choices[1].importance && Math.abs(choices[0].importance - choices[1].importance) < 0.02) {
    const error = new Error('More than one location matched. Add a state or ZIP code.');
    error.code = 'AMBIGUOUS_LOCATION';
    error.choices = suggestions;
    throw error;
  }
  const result = suggestions[0];
  if (useCache) {
    geocodeCache.set(cacheKey, result);
    geocodeCache.set(result.label.toLowerCase(), result);
  }
  return result;
}

export async function reverseGeocodeLocation({ lat, lng }, fetcher = fetch) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    throw new Error('Valid coordinates are required.');
  }
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`;
  const response = await fetcher(url, {
    headers: { Accept: 'application/json' },
    signal: timeoutSignal(5000)
  });
  if (!response.ok) throw new Error('Reverse location lookup failed.');
  const choice = await response.json();
  return {
    label: choice.display_name || `${lat}, ${lng}`,
    lat: Number(lat),
    lng: Number(lng),
    city: choice.address?.city || choice.address?.town || choice.address?.village || choice.address?.municipality || '',
    county: choice.address?.county || '',
    state: choice.address?.state || '',
    stateCode: String(choice.address?.['ISO3166-2-lvl4'] || '').split('-')[1] || '',
    zip: choice.address?.postcode || ''
  };
}

export function buildOverpassQuery(lat, lng, radiusMiles = 5) {
  const meters = Math.min(40234, Math.max(1609, Number(radiusMiles) * 1609.344));
  return `[out:json][timeout:28];(nwr(around:${Math.round(meters)},${lat},${lng})[amenity=social_facility];nwr(around:${Math.round(meters)},${lat},${lng})[social_facility];nwr(around:${Math.round(meters)},${lat},${lng})[amenity=food_bank];nwr(around:${Math.round(meters)},${lat},${lng})[amenity=community_centre];nwr(around:${Math.round(meters)},${lat},${lng})[amenity=clinic];nwr(around:${Math.round(meters)},${lat},${lng})[healthcare=clinic];nwr(around:${Math.round(meters)},${lat},${lng})[office=ngo];nwr(around:${Math.round(meters)},${lat},${lng})[office=government];);out center tags;`;
}

export function inferCategory(tags = {}) {
  const text = [tags.name, tags.description, tags.social_facility, tags.amenity, tags.healthcare, tags.office, tags.operator]
    .filter(Boolean).join(' ').toLowerCase();
  const foodProgramText = [tags.name, tags.operator, tags.social_facility, tags['service:description']]
    .filter(Boolean).join(' ').toLowerCase();
  if (tags.amenity === 'food_bank'
    || /food[_ ]bank|food pantry|soup kitchen|free meals?|meal (?:site|program|service)|hunger relief/.test(foodProgramText)) return 'food';
  if (tags.amenity === 'community_centre' && !tags.social_facility) return 'family';
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
  const specificName = tags.name || tags.operator || '';
  const resource = {
    id: `osm-${element.type}-${element.id}`,
    organizationName: specificName,
    programName: '',
    name: specificName,
    category: inferCategory(tags),
    scope: 'location',
    resultType: 'local-service',
    services: [inferCategory(tags)],
    lat,
    lng,
    address,
    city: tags['addr:city'] || tags['addr:place'] || '',
    state: tags['addr:state'] || '',
    zip: tags['addr:postcode'] || '',
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
    eligibilityStatus: 'varies',
    eligibilityResearchStatus: 'pending',
    verificationStatus: 'Community-sourced — confirm with organization',
    confidence: tags.website && tags.phone ? 0.7 : 0.45,
    dateDiscovered: new Date().toISOString(),
    discoveryStatus: 'verification_pending',
    verificationPeriodDays: 1
  };
  const review = resourceQualityReview(resource);
  return {
    ...resource,
    reviewRequired: review.reviewRequired,
    qualityReviewReasons: review.reasons
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
      return (data.elements || [])
        .map(element => normalizeOsmElement(element, { lat, lng }))
        .filter(isDisplayableResource);
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
