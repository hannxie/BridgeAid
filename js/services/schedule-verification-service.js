const DAY_MAP = {
  mo: 'monday',
  tu: 'tuesday',
  we: 'wednesday',
  th: 'thursday',
  fr: 'friday',
  sa: 'saturday',
  su: 'sunday',
  monday: 'monday',
  tuesday: 'tuesday',
  wednesday: 'wednesday',
  thursday: 'thursday',
  friday: 'friday',
  saturday: 'saturday',
  sunday: 'sunday'
};
const DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function expandDays(value) {
  const raw = String(value || '').toLowerCase().split('/').pop();
  const range = raw.split('-').map(day => DAY_MAP[day.trim()]);
  if (range.length === 2 && range.every(Boolean)) {
    const start = DAY_ORDER.indexOf(range[0]);
    const end = DAY_ORDER.indexOf(range[1]);
    return start <= end
      ? DAY_ORDER.slice(start, end + 1)
      : [...DAY_ORDER.slice(start), ...DAY_ORDER.slice(0, end + 1)];
  }
  return raw.split(',').map(day => DAY_MAP[day.trim()]).filter(Boolean);
}

export function parseOpeningHours(value) {
  const weeklyHours = Object.fromEntries(DAY_ORDER.map(day => [day, []]));
  let found = false;
  for (const part of String(value || '').split(';')) {
    const match = part.trim().match(/^([A-Za-z,-]+)\s+(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/);
    if (!match) continue;
    for (const day of expandDays(match[1])) {
      weeklyHours[day].push({ open: match[2].padStart(5, '0'), close: match[3].padStart(5, '0') });
      found = true;
    }
  }
  return found ? weeklyHours : null;
}

function extractJsonLdHours(html) {
  const matches = [...String(html || '').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of matches) {
    try {
      const parsed = JSON.parse(match[1]);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const found = items.find(item => item?.openingHours || item?.openingHoursSpecification);
      if (found?.openingHours) {
        const text = Array.isArray(found.openingHours) ? found.openingHours.join('; ') : found.openingHours;
        return { text, weeklyHours: parseOpeningHours(text) };
      }
      if (found?.openingHoursSpecification) {
        const specs = Array.isArray(found.openingHoursSpecification)
          ? found.openingHoursSpecification
          : [found.openingHoursSpecification];
        const weeklyHours = Object.fromEntries(DAY_ORDER.map(day => [day, []]));
        for (const spec of specs) {
          for (const rawDay of [].concat(spec.dayOfWeek || [])) {
            for (const day of expandDays(String(rawDay))) {
              if (spec.opens && spec.closes) weeklyHours[day].push({ open: spec.opens, close: spec.closes });
            }
          }
        }
        return {
          text: specs
            .map(spec => `${[].concat(spec.dayOfWeek || []).map(day => String(day).split('/').pop()).join(', ')} ${spec.opens || ''}–${spec.closes || ''}`.trim())
            .join('; '),
          weeklyHours
        };
      }
    } catch {
      // Ignore invalid JSON-LD and continue to the next approved source.
    }
  }
  return null;
}

export function sourcePriority(resource) {
  return [
    resource.programUrl,
    resource.officialWebsite,
    resource.website,
    resource.officialCalendarUrl,
    ...(resource.officialSocialUrls || []),
    ...(resource.governmentDirectoryUrls || []),
    ...(resource.sourceUrls || [])
  ].filter((url, index, values) => url && values.indexOf(url) === index);
}

export async function verifyResourceSchedule(resource, fetcher = fetch, now = new Date()) {
  if (resource.weeklyHours) {
    return {
      ...resource,
      scheduleLabel: resource.scheduleLabel || 'published',
      scheduleVerificationStatus: 'published',
      scheduleLastVerified: resource.hoursLastVerified || resource.lastVerified || ''
    };
  }
  const attempts = [];
  for (const url of sourcePriority(resource).slice(0, 6)) {
    try {
      const response = await fetcher(url, {
        headers: { Accept: 'text/html,application/json' },
        signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(3500)
          : undefined
      });
      const html = response.ok ? await response.text() : '';
      const hours = extractJsonLdHours(html);
      attempts.push({ url, checkedAt: now.toISOString(), ok: response.ok, foundHours: Boolean(hours?.text) });
      if (hours?.text) {
        return {
          ...resource,
          hours: hours.text,
          weeklyHours: hours.weeklyHours,
          scheduleLabel: 'published',
          scheduleVerificationStatus: 'verified_from_official_source',
          scheduleSourceUrl: url,
          hoursSourceUrl: url,
          scheduleLastVerified: now.toISOString().slice(0, 10),
          hoursLastVerified: now.toISOString().slice(0, 10),
          scheduleVerificationAttempts: attempts
        };
      }
    } catch (error) {
      attempts.push({ url, checkedAt: now.toISOString(), ok: false, error: String(error.message || error) });
    }
  }
  return {
    ...resource,
    scheduleLabel: 'not_listed',
    scheduleVerificationStatus: 'searched_no_reliable_schedule',
    scheduleVerificationAttempts: attempts,
    hoursNote: resource.hoursNote || 'Hours not publicly listed',
    scheduleLastVerified: now.toISOString().slice(0, 10)
  };
}
