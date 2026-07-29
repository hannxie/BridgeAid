import { resourceAvailabilityAt, resourceScheduleState } from './schedule-service.js';

const SEARCH_CACHE_FRESH_FOR_MS = 24 * 60 * 60 * 1000;
const DEFAULT_VERIFICATION_PERIOD_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

function normalizedToken(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function resourceVerificationDate(resource) {
  return resource.lastVerified
    || resource.verified
    || resource.scheduleLastVerified
    || resource.hoursLastVerified
    || resource.eligibilityLastVerified
    || resource.applicationLastVerified
    || resource.dateDiscovered
    || '';
}

export function resourceIsFresh(resource, now = Date.now(), defaultDays = DEFAULT_VERIFICATION_PERIOD_DAYS) {
  const expiresAt = timestamp(resource.verificationExpiresAt);
  if (expiresAt !== null) return expiresAt >= now;
  const checkedAt = timestamp(resourceVerificationDate(resource));
  if (checkedAt === null) return false;
  const periodDays = Math.max(1, Number(resource.verificationPeriodDays) || defaultDays);
  return now - checkedAt <= periodDays * DAY_MS;
}

export function freshResources(resources = [], now = Date.now(), defaultDays = DEFAULT_VERIFICATION_PERIOD_DAYS) {
  return resources.filter(resource => resourceIsFresh(resource, now, defaultDays));
}

export function textFor(value, language = 'en') {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value[language] || value.en || '';
}

function fallbackDescription(resource, language = 'en') {
  const category = String(resource.category || 'community support').replace(/_/g, ' ');
  const location = resource.address || resource.city || resource.county || '';
  const descriptions = {
    en: `A ${location ? 'local ' : ''}${category} listing for people seeking community support. Confirm services, eligibility, hours, and the next step with the provider before relying on it.`,
    es: `Un recurso ${location ? 'local ' : ''}de ${category} para personas que buscan apoyo comunitario. Confirme los servicios, la elegibilidad, el horario y el siguiente paso con el proveedor.`,
    zh: `面向需要社区支持者的${location ? '本地' : ''}${category}资源。依赖该信息前，请向服务机构确认服务、资格、时间和下一步。`
  };
  return descriptions[language] || descriptions.en;
}

export function normalizeResource(resource, language = 'en') {
  const rawLatitude = resource.latitude ?? resource.lat;
  const rawLongitude = resource.longitude ?? resource.lng;
  const rawDistance = resource.distance;
  const sourceUrls = Array.isArray(resource.sourceUrls)
    ? resource.sourceUrls.filter(Boolean)
    : [resource.url || resource.osmUrl].filter(Boolean);
  const services = Array.isArray(resource.services)
    ? resource.services
    : [resource.category].filter(Boolean);
  const accessText = textFor(resource.access, language);
  const appointmentText = textFor(resource.appointmentRequirement, language);
  const explicitIdText = textFor(resource.identificationRequirement || resource.idRequirement, language);
  const hoursText = textFor(resource.hours, language);
  return {
    id: String(resource.id || ''),
    organizationName: resource.organizationName || resource.name || 'Unnamed organization',
    programName: resource.programName || '',
    name: resource.name || resource.organizationName || 'Unnamed organization',
    category: resource.category || 'all',
    scope: resource.scope || 'location',
    onlineOnly: Boolean(resource.onlineOnly),
    requiresLocalProvider: Boolean(resource.requiresLocalProvider),
    subcategories: Array.isArray(resource.subcategories) ? resource.subcategories : [],
    services,
    description: textFor(resource.description, language) || fallbackDescription(resource, language),
    phone: resource.phone || '',
    email: resource.email || '',
    address: resource.address || '',
    city: resource.city || '',
    county: resource.county || '',
    state: resource.state || '',
    zip: resource.zip || '',
    latitude: rawLatitude !== null && rawLatitude !== undefined && rawLatitude !== '' && Number.isFinite(Number(rawLatitude)) ? Number(rawLatitude) : null,
    longitude: rawLongitude !== null && rawLongitude !== undefined && rawLongitude !== '' && Number.isFinite(Number(rawLongitude)) ? Number(rawLongitude) : null,
    website: resource.website || resource.url || '',
    officialWebsite: resource.officialWebsite || resource.url || '',
    registrationUrl: resource.registrationUrl || '',
    hours: hoursText,
    weeklyHours: resource.weeklyHours && typeof resource.weeklyHours === 'object' ? resource.weeklyHours : null,
    timeZone: resource.timeZone || 'America/Los_Angeles',
    specialHours: Array.isArray(resource.specialHours) ? resource.specialHours.map(value => textFor(value, language)) : [],
    holidayHours: Array.isArray(resource.holidayHours)
      ? resource.holidayHours.map(exception => ({ ...exception, label: textFor(exception.label, language) }))
      : [],
    hoursNote: textFor(resource.hoursNote, language),
    hoursSourceUrl: resource.hoursSourceUrl || resource.scheduleSourceUrl || '',
    hoursLastVerified: resource.hoursLastVerified || resource.scheduleLastVerified || '',
    appointmentOnly: Boolean(resource.appointmentOnly),
    onlineAlwaysAvailable: Boolean(resource.onlineAlwaysAvailable)
      || /online .*(?:all times|always|24 hours)/i.test(hoursText),
    temporaryClosure: Boolean(resource.temporaryClosure),
    eventDates: Array.isArray(resource.eventDates) ? resource.eventDates : [],
    scheduleRules: Array.isArray(resource.scheduleRules) ? resource.scheduleRules : [],
    scheduleLabel: resource.scheduleLabel || (textFor(resource.hours, language) ? 'typical' : 'uncertain'),
    scheduleVerificationStatus: resource.scheduleVerificationStatus || '',
    scheduleSourceUrl: resource.scheduleSourceUrl || '',
    scheduleLastVerified: resource.scheduleLastVerified || '',
    scheduleVerificationAttempts: Array.isArray(resource.scheduleVerificationAttempts) ? resource.scheduleVerificationAttempts : [],
    nextEvent: resource.nextEvent || '',
    availabilityStatus: resource.availabilityStatus || 'Schedule uncertain',
    appointmentRequirement: appointmentText,
    walkInStatus: textFor(resource.walkInStatus, language)
      || (/walk.?in/i.test(`${appointmentText} ${accessText}`) ? 'Walk-ins accepted' : ''),
    eligibilitySummary: textFor(resource.eligibilitySummary || resource.eligibility, language),
    eligibilityStatus: resource.eligibilityStatus || '',
    eligibilityDetails: Object.fromEntries(Object.entries(resource.eligibilityDetails || {})
      .map(([key, value]) => [key, textFor(value, language)])),
    eligibilityRules: Array.isArray(resource.eligibilityRules) ? resource.eligibilityRules : [],
    eligibilityQuestions: Array.isArray(resource.eligibilityQuestions) ? resource.eligibilityQuestions : [],
    eligibilityType: resource.eligibilityType || '',
    officialSourceName: resource.officialSourceName || resource.organizationName || resource.source || '',
    lastEligibilityVerified: resource.lastEligibilityVerified || resource.eligibilityLastVerified || '',
    eligibilityConfidence: resource.eligibilityConfidence || '',
    eligibilityNotes: resource.eligibilityNotes || '',
    stateVariation: Boolean(resource.stateVariation),
    requiresOfficialConfirmation: Boolean(resource.requiresOfficialConfirmation),
    manualReview: Boolean(resource.manualReview),
    eligibilitySourceUrl: resource.eligibilitySourceUrl || '',
    eligibilityLastVerified: resource.eligibilityLastVerified || '',
    eligibilityResearchStatus: resource.eligibilityResearchStatus || '',
    eligibilityResearchReason: resource.eligibilityResearchReason || '',
    eligibilityExceptions: Array.isArray(resource.eligibilityExceptions) ? resource.eligibilityExceptions.map(value => textFor(value, language)) : [],
    serviceAreas: Array.isArray(resource.serviceAreas) ? resource.serviceAreas : [],
    serviceAreaZipRanges: Array.isArray(resource.serviceAreaZipRanges) ? resource.serviceAreaZipRanges : [],
    serviceAreaZipPrefixes: Array.isArray(resource.serviceAreaZipPrefixes) ? resource.serviceAreaZipPrefixes : [],
    localEligibilityVerified: Boolean(resource.localEligibilityVerified),
    noIdRequired: Boolean(resource.noIdRequired) || /no (?:photo )?(?:id|identification) (?:is )?required/i.test(explicitIdText),
    identificationRequirement: explicitIdText,
    requiredDocuments: Array.isArray(resource.requiredDocuments) ? resource.requiredDocuments.map(value => textFor(value, language)) : [],
    accessibility: Array.isArray(resource.accessibility) ? resource.accessibility.map(value => textFor(value, language)) : [],
    languages: Array.isArray(resource.languages) ? resource.languages.map(value => textFor(value, language)) : [],
    transportation: Array.isArray(resource.transportation) ? resource.transportation.map(value => textFor(value, language)) : [],
    registrationRequirement: textFor(resource.registrationRequirement, language) || accessText,
    applicationSteps: Array.isArray(resource.applicationSteps) ? resource.applicationSteps.map(value => textFor(value, language)) : [],
    applicationMethods: Array.isArray(resource.applicationMethods) ? resource.applicationMethods : [],
    applicationLinks: Array.isArray(resource.applicationLinks)
      ? resource.applicationLinks.map(link => ({ ...link, label: textFor(link.label, language) }))
      : [],
    applicationDeadline: textFor(resource.applicationDeadline, language),
    afterApplying: textFor(resource.afterApplying, language),
    applicationSourceUrl: resource.applicationSourceUrl || '',
    applicationLastVerified: resource.applicationLastVerified || '',
    serviceOffered: textFor(resource.serviceOffered || resource.description, language),
    nationwideAvailability: textFor(resource.nationwideAvailability, language),
    whoItHelps: textFor(resource.whoItHelps || resource.eligibilitySummary || resource.eligibility, language),
    officialDomains: Array.isArray(resource.officialDomains) ? resource.officialDomains : [],
    freeStatus: resource.freeStatus || 'Confirm with organization',
    source: resource.source || 'Source not named',
    sourceUrls,
    dateDiscovered: resource.dateDiscovered || '',
    lastVerified: resource.lastVerified || resource.verified || '',
    verificationExpiresAt: resource.verificationExpiresAt || '',
    verificationPeriodDays: Number(resource.verificationPeriodDays) || DEFAULT_VERIFICATION_PERIOD_DAYS,
    confidence: Number.isFinite(Number(resource.confidence)) ? Number(resource.confidence) : null,
    verificationStatus: resource.verificationStatus || (resource.verified ? 'Previously checked' : 'Needs confirmation'),
    discoveryStatus: resource.discoveryStatus || '',
    conflicts: Array.isArray(resource.conflicts) ? resource.conflicts : [],
    changeHistory: Array.isArray(resource.changeHistory) ? resource.changeHistory : [],
    keywords: Array.isArray(resource.keywords) ? resource.keywords : [],
    distance: rawDistance !== null && rawDistance !== undefined && rawDistance !== '' && Number.isFinite(Number(rawDistance)) ? Number(rawDistance) : null,
    _rank: Number(resource._rank || 0),
    _rankReasons: Array.isArray(resource._rankReasons) ? resource._rankReasons : [],
    _rankExplanation: resource._rankExplanation || '',
    _availabilityAtRequest: resource._availabilityAtRequest || null
  };
}

export function resourceCoverage(resources = []) {
  const counts = {};
  const byLocation = {};
  for (const resource of resources) {
    const normalized = normalizeResource(resource);
    const category = normalized.category;
    counts[category] = (counts[category] || 0) + 1;
    for (const location of normalized.serviceAreas) {
      byLocation[location] ||= {};
      for (const service of normalized.services) {
        byLocation[location][service] = (byLocation[location][service] || 0) + 1;
      }
    }
  }
  const represented = Object.entries(counts).filter(([category]) => category !== 'all');
  const highest = Math.max(0, ...represented.map(([, count]) => count));
  return {
    counts,
    byLocation,
    underrepresented: represented
      .filter(([, count]) => highest >= 3 && count * 2 < highest)
      .map(([category]) => category)
  };
}

export function resourceKey(resource) {
  const r = normalizeResource(resource);
  const name = normalizedToken(r.name);
  const address = normalizedToken(r.address);
  const phone = String(r.phone || '').replace(/\D/g, '').slice(-10);
  const coordinates = r.latitude !== null && r.longitude !== null
    ? `${r.latitude.toFixed(3)},${r.longitude.toFixed(3)}`
    : '';
  return [name, address || coordinates, phone].filter(Boolean).join('|') || String(r.id);
}

function sameResource(left, right) {
  const a = normalizeResource(left);
  const b = normalizeResource(right);
  const aName = normalizedToken(a.name);
  const bName = normalizedToken(b.name);
  const aAddress = normalizedToken(a.address);
  const bAddress = normalizedToken(b.address);
  const aPhone = String(a.phone || '').replace(/\D/g, '').slice(-10);
  const bPhone = String(b.phone || '').replace(/\D/g, '').slice(-10);
  if (aPhone.length >= 7 && aPhone === bPhone) return true;
  if (aName && aName === bName && aAddress && aAddress === bAddress) return true;
  if (aName && aName === bName
    && a.latitude !== null && b.latitude !== null
    && a.longitude !== null && b.longitude !== null) {
    return a.latitude.toFixed(3) === b.latitude.toFixed(3)
      && a.longitude.toFixed(3) === b.longitude.toFixed(3);
  }
  return Boolean(a.id && b.id && a.id === b.id);
}

function recordQuality(resource) {
  const r = normalizeResource(resource);
  const usefulFields = [
    r.address, r.phone, r.officialWebsite, r.weeklyHours, r.eligibilitySummary,
    r.registrationRequirement, r.lastVerified
  ].filter(Boolean).length;
  const official = /official|provider|government|nonprofit/i.test(`${r.source} ${r.verificationStatus}`) ? 20 : 0;
  return official + usefulFields + (r.confidence || 0) * 10;
}

function nonEmpty(value) {
  return value !== '' && value !== null && value !== undefined
    && (!Array.isArray(value) || value.length > 0);
}

function mergeResourceGroup(group) {
  const ordered = [...group].sort((a, b) =>
    recordQuality(a) - recordQuality(b)
    || resourceKey(a).localeCompare(resourceKey(b))
    || String(a.id || '').localeCompare(String(b.id || '')));
  const result = {};
  const arrayKeys = new Set(ordered.flatMap(item =>
    Object.entries(item).filter(([, value]) => Array.isArray(value)).map(([key]) => key)));
  for (const item of ordered) {
    for (const [key, value] of Object.entries(item)) {
      if (!nonEmpty(value)) continue;
      if (arrayKeys.has(key)) {
        const values = [...(Array.isArray(result[key]) ? result[key] : []), ...(Array.isArray(value) ? value : [])];
        result[key] = [...new Map(values.map(entry => [
          typeof entry === 'object' ? JSON.stringify(entry) : String(entry),
          entry
        ])).values()];
      } else {
        result[key] = value;
      }
    }
  }
  result.sourceUrls = [...new Set([
    ...(result.sourceUrls || []),
    ...ordered.flatMap(item => [item.url, item.osmUrl, item.hoursSourceUrl, item.scheduleSourceUrl].filter(Boolean))
  ])];
  return result;
}

export function mergeDuplicates(resources) {
  const rows = (resources || []).filter(Boolean);
  const parents = rows.map((_, index) => index);
  const find = index => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };
  const union = (left, right) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parents[Math.max(a, b)] = Math.min(a, b);
  };
  for (let left = 0; left < rows.length; left += 1) {
    for (let right = left + 1; right < rows.length; right += 1) {
      if (sameResource(rows[left], rows[right])) union(left, right);
    }
  }
  const groups = new Map();
  rows.forEach((row, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(row);
  });
  return [...groups.values()]
    .map(mergeResourceGroup)
    .sort(stableResourceComparator);
}

export function cacheKey(location, category, radius) {
  const normalizedLocation = String(location || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ',');
  return `${normalizedLocation}|${category || 'all'}|${Number(radius) || 5}`;
}

function normalizedSearchText(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ',');
}

export function normalizeSearchParameters(parameters = {}) {
  const filters = Object.fromEntries(Object.entries(parameters.filters || {})
    .filter(([, value]) => value !== '' && value !== false && value !== null && value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right)));
  return {
    location: normalizedSearchText(parameters.location),
    radius: Math.max(1, Number(parameters.radius) || 5),
    category: normalizedSearchText(parameters.category) || 'all',
    categories: [...new Set((parameters.categories || []).map(normalizedSearchText).filter(Boolean))].sort(),
    situation: normalizedSearchText(parameters.situation),
    filters,
    sort: normalizedSearchText(parameters.sort) || 'relevance'
  };
}

export function searchSignature(parameters = {}) {
  const normalized = normalizeSearchParameters(parameters);
  return [
    normalized.location,
    normalized.radius,
    normalized.category,
    normalized.categories.join(','),
    normalized.situation,
    JSON.stringify(normalized.filters),
    normalized.sort
  ].join('|');
}

export function coordinateCacheKey(point, category, radius) {
  if (!Number.isFinite(Number(point?.lat)) || !Number.isFinite(Number(point?.lng))) return '';
  return `@${Number(point.lat).toFixed(4)},${Number(point.lng).toFixed(4)}|${category || 'all'}|${Number(radius) || 5}`;
}

export function readCachedSearch(cache, key, now = Date.now()) {
  const entry = cache?.[key];
  if (!entry || !Array.isArray(entry.resources)) return null;
  const resources = freshResources(entry.resources, now);
  return {
    ...entry,
    resources,
    stale: now - Number(entry.savedAt || 0) > SEARCH_CACHE_FRESH_FOR_MS,
    expiredCount: entry.resources.length - resources.length
  };
}

export function writeCachedSearch(cache, key, resources, now = Date.now()) {
  return { ...(cache || {}), [key]: { savedAt: now, resources: mergeDuplicates(resources) } };
}

export function filterResources(resources, filters = {}, options = {}) {
  return resources.filter(resource => {
    const r = normalizeResource(resource);
    const schedule = resourceScheduleState(r, options.now || new Date());
    if (filters.radius && r.distance !== null && r.distance > Number(filters.radius)) return false;
    if (filters.category && r.category !== filters.category && !r.services.includes(filters.category) && r.category !== 'all') return false;
    if (filters.openNow && !schedule.openNow) return false;
    if (filters.availableToday && !schedule.availableToday) return false;
    if (filters.walkIn && !/yes|accepted|walk-in/i.test(r.walkInStatus)) return false;
      if (filters.noId && !r.noIdRequired) return false;
    if (filters.noRegistration && !/not required|none|walk.?in/i.test(r.registrationRequirement)) return false;
    if (filters.accessible && !r.accessibility.some(a => /wheelchair/i.test(a))) return false;
    if (filters.language && !r.languages.some(l => l.toLowerCase() === filters.language.toLowerCase())) return false;
    if (filters.verifiedEligibility && !r.localEligibilityVerified) return false;
    if (filters.confidence && (r.confidence ?? 0) < Number(filters.confidence)) return false;
    return true;
  });
}

export function sortResources(resources, sortBy = 'relevance', now = new Date()) {
  const rows = [...resources];
  const distance = resource => Number.isFinite(resource.distance) ? resource.distance : Number.POSITIVE_INFINITY;
  if (sortBy === 'nearest') return rows.sort((a, b) =>
    distance(a) - distance(b) || stableResourceComparator(a, b));
  if (sortBy === 'farthest') {
    return rows.sort((a, b) => {
      const aMissing = !Number.isFinite(a.distance);
      const bMissing = !Number.isFinite(b.distance);
      if (aMissing !== bMissing) return aMissing ? 1 : -1;
      return distance(b) - distance(a) || stableResourceComparator(a, b);
    });
  }
  if (sortBy === 'openSoonest') {
    return rows.sort((a, b) => {
      const aWait = resourceScheduleState(normalizeResource(a), now).minutesUntilOpen;
      const bWait = resourceScheduleState(normalizeResource(b), now).minutesUntilOpen;
      const safeA = Number.isFinite(aWait) ? aWait : Number.POSITIVE_INFINITY;
      const safeB = Number.isFinite(bWait) ? bWait : Number.POSITIVE_INFINITY;
      return safeA - safeB || distance(a) - distance(b) || stableResourceComparator(a, b);
    });
  }
  return rows.sort((a, b) =>
    Number(b._rank || 0) - Number(a._rank || 0) || stableResourceComparator(a, b));
}

export function stableResourceComparator(a, b) {
  const left = normalizeResource(a);
  const right = normalizeResource(b);
  const distance = resource => Number.isFinite(resource.distance) ? resource.distance : Number.POSITIVE_INFINITY;
  const availability = resource => {
    if (/open now/i.test(resource.availabilityStatus)) return 0;
    if (/available|published|appointment/i.test(resource.availabilityStatus)) return 1;
    return 2;
  };
  return distance(left) - distance(right)
    || availability(left) - availability(right)
    || left.name.localeCompare(right.name, 'en', { sensitivity: 'base' })
    || left.address.localeCompare(right.address, 'en', { sensitivity: 'base' })
    || left.id.localeCompare(right.id, 'en', { sensitivity: 'base' });
}

export function rankResources(resources, context = {}) {
  const wanted = new Set(context.categories || []);
  const constraints = context.constraints || {};
  return resources.map(item => {
    const r = normalizeResource(item);
    let score = 0;
    const reasons = [];
    const serviceMatch = wanted.has(r.category) || r.services.some(s => wanted.has(s));
    if (serviceMatch) {
      score += 80;
      reasons.push('matches the requested service');
    } else if (wanted.size) {
      score -= 80;
    }
    let requestedAvailability = null;
    if (constraints.requestedInstant instanceof Date && !Number.isNaN(constraints.requestedInstant.getTime())) {
      requestedAvailability = resourceAvailabilityAt(r, constraints.requestedInstant);
      if (requestedAvailability.available && requestedAvailability.confirmed) {
        score += 75;
        reasons.push('is confirmed available at the requested time');
      } else if (requestedAvailability.code === 'appointment_required') {
        score -= constraints.appointmentRestriction ? 70 : 20;
        reasons.push('requires an appointment');
      } else if (requestedAvailability.confirmed) {
        score -= 65;
        reasons.push('is confirmed unavailable at the requested time');
      } else {
        score -= 12;
        reasons.push('has uncertain hours at the requested time');
      }
    }
    if (constraints.noId) {
      if (r.noIdRequired) {
        score += 24;
        reasons.push('publishes a no-ID option');
      } else {
        score -= 30;
      }
    }
    if (constraints.walkInOnly || constraints.appointmentRestriction) {
      if (/walk.?in|not required|none/i.test(`${r.walkInStatus} ${r.appointmentRequirement}`)) {
        score += 20;
        reasons.push('publishes walk-in access');
      } else if (r.appointmentOnly || /appointment required/i.test(r.appointmentRequirement)) {
        score -= 45;
      }
    }
    if (constraints.wheelchairAccessible) {
      if (r.accessibility.some(value => /wheelchair|step.?free/i.test(value))) {
        score += 20;
        reasons.push('publishes matching accessibility');
      } else {
        score -= 25;
      }
    }
    if (Number.isFinite(constraints.maxDistance) && Number.isFinite(r.distance) && r.distance > constraints.maxDistance) {
      score -= 80;
      reasons.push(`is beyond the ${constraints.maxDistance}-mile preference`);
    }
    if (r.distance !== null) score += Math.max(0, 25 - r.distance * 2);
    if (r.distance !== null) reasons.push(`${r.distance.toFixed(1)} miles away`);
    if (r.availabilityStatus === 'Open now') score += 18;
    if (r.walkInStatus) score += 5;
    if (r.sourceUrls.length) score += 6;
    if (r.confidence !== null) score += r.confidence * 10;
    const explanation = reasons.length
      ? `Prioritized because it ${reasons.slice(0, 3).join(', ')}.`
      : 'Ranked using verified service details, distance, and availability evidence.';
    return {
      ...item,
      _rank: score,
      _rankReasons: reasons,
      _rankExplanation: explanation,
      _availabilityAtRequest: requestedAvailability
    };
  }).sort((a, b) => b._rank - a._rank || stableResourceComparator(a, b));
}
