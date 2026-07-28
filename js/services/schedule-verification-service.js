function extractJsonLdHours(html) {
  const matches = [...String(html || '').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of matches) {
    try {
      const parsed = JSON.parse(match[1]);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const found = items.find(item => item?.openingHours || item?.openingHoursSpecification);
      if (found?.openingHours) return Array.isArray(found.openingHours) ? found.openingHours.join('; ') : found.openingHours;
      if (found?.openingHoursSpecification) {
        const specs = Array.isArray(found.openingHoursSpecification) ? found.openingHoursSpecification : [found.openingHoursSpecification];
        return specs.map(spec => `${[].concat(spec.dayOfWeek || []).map(day => String(day).split('/').pop()).join(', ')} ${spec.opens || ''}–${spec.closes || ''}`.trim()).join('; ');
      }
    } catch {
      // Ignore invalid JSON-LD and continue to the next official source.
    }
  }
  return '';
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
  if (resource.hours) {
    return {
      ...resource,
      scheduleLabel: resource.scheduleLabel || 'typical',
      scheduleVerificationStatus: 'published',
      scheduleLastVerified: resource.lastVerified || ''
    };
  }
  const attempts = [];
  for (const url of sourcePriority(resource).slice(0, 6)) {
    try {
      const response = await fetcher(url, { headers: { Accept: 'text/html,application/json' } });
      const html = response.ok ? await response.text() : '';
      const hours = extractJsonLdHours(html);
      attempts.push({ url, checkedAt: now.toISOString(), ok: response.ok, foundHours: Boolean(hours) });
      if (hours) {
        return {
          ...resource,
          hours,
          scheduleLabel: 'published',
          scheduleVerificationStatus: 'verified_from_official_source',
          scheduleSourceUrl: url,
          scheduleLastVerified: now.toISOString().slice(0, 10),
          scheduleVerificationAttempts: attempts
        };
      }
    } catch (error) {
      attempts.push({ url, checkedAt: now.toISOString(), ok: false, error: String(error.message || error) });
    }
  }
  return {
    ...resource,
    scheduleLabel: 'uncertain',
    scheduleVerificationStatus: 'searched_no_reliable_schedule',
    scheduleVerificationAttempts: attempts,
    scheduleLastVerified: now.toISOString().slice(0, 10)
  };
}
