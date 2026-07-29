const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export const WEEK_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function atNoon(date) {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  return d;
}

function nextWeekday(dayIndex, from) {
  const d = atNoon(from);
  let delta = (dayIndex - d.getDay() + 7) % 7;
  if (delta === 0) delta = 7;
  d.setDate(d.getDate() + delta);
  return d;
}

export function nextRecurringEvent(rule, from = new Date(), anchor = null) {
  const value = String(rule || '').trim().toLowerCase();
  let match = value.match(/^every\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
  if (match) return nextWeekday(DAYS.indexOf(match[1]), from);

  match = value.match(/^every other\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
  if (match) {
    const weekday = DAYS.indexOf(match[1]);
    let candidate = nextWeekday(weekday, from);
    if (anchor) {
      const start = atNoon(anchor);
      while (candidate <= atNoon(from) || Math.round((candidate - start) / 86400000) % 14 !== 0) {
        candidate.setDate(candidate.getDate() + 7);
      }
    }
    return candidate;
  }

  match = value.match(/^the\s+(first|second|third|fourth|last)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+of\s+(?:each|the)\s+month$/);
  if (match) {
    const ordinal = match[1];
    const weekday = DAYS.indexOf(match[2]);
    const base = atNoon(from);
    for (let offset = 0; offset < 14; offset += 1) {
      const month = new Date(base.getFullYear(), base.getMonth() + offset, 1, 12);
      let candidate;
      if (ordinal === 'last') {
        candidate = new Date(month.getFullYear(), month.getMonth() + 1, 0, 12);
        candidate.setDate(candidate.getDate() - ((candidate.getDay() - weekday + 7) % 7));
      } else {
        const number = { first: 1, second: 2, third: 3, fourth: 4 }[ordinal];
        candidate = new Date(month);
        candidate.setDate(1 + ((weekday - candidate.getDay() + 7) % 7) + (number - 1) * 7);
      }
      if (candidate > base) return candidate;
    }
  }

  if (value === 'last weekday of the month') {
    const base = atNoon(from);
    for (let offset = 0; offset < 14; offset += 1) {
      const candidate = new Date(base.getFullYear(), base.getMonth() + offset + 1, 0, 12);
      while ([0, 6].includes(candidate.getDay())) candidate.setDate(candidate.getDate() - 1);
      if (candidate > base) return candidate;
    }
  }
  return null;
}

export function resolveSchedule(sources = []) {
  const values = sources.map(s => String(s.value || '').trim()).filter(Boolean);
  const unique = [...new Set(values)];
  if (!unique.length) return { label: 'Schedule uncertain', value: '', conflicts: [] };
  if (unique.length > 1) return { label: 'Schedule uncertain', value: '', conflicts: unique };
  return { label: 'Schedule published', value: unique[0], conflicts: [] };
}

export function formatInTimeZone(date, timeZone, locale = 'en-US') {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function minutesFor(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes !== 0)) return null;
  return hours * 60 + minutes;
}

function localParts(date, timeZone = 'America/Los_Angeles') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    day: value.weekday.toLowerCase(),
    date: `${value.year}-${value.month}-${value.day}`,
    minutes: (Number(value.hour) % 24) * 60 + Number(value.minute)
  };
}

function normalizedPeriods(value) {
  if (!Array.isArray(value)) return null;
  return value
    .map(period => ({
      open: String(period?.open || ''),
      close: String(period?.close || '')
    }))
    .filter(period => minutesFor(period.open) !== null && minutesFor(period.close) !== null);
}

function scheduleException(resource, date) {
  return (resource.holidayHours || []).find(exception => exception?.date === date) || null;
}

function periodsFor(resource, day, date = '') {
  const exception = date ? scheduleException(resource, date) : null;
  if (exception) return exception.closed ? [] : normalizedPeriods(exception.periods);
  return normalizedPeriods(resource.weeklyHours?.[day]);
}

export function formatScheduleTime(value, language = 'en') {
  const minutes = minutesFor(value);
  if (minutes === null) return '';
  if (minutes === 1440) return language === 'en' ? '12:00 AM' : '00:00';
  const hours = Math.floor(minutes / 60);
  const minuteText = String(minutes % 60).padStart(2, '0');
  if (language !== 'en') return `${String(hours).padStart(2, '0')}:${minuteText}`;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${minuteText} ${suffix}`;
}

export function weeklyScheduleRows(resource, language = 'en', now = new Date()) {
  const current = localParts(now, resource.timeZone);
  const legacyAlwaysOpen = !resource.weeklyHours && /24/.test(String(resource.hours || ''));
  return WEEK_DAYS.map(day => {
    const periods = legacyAlwaysOpen
      ? [{ open: '00:00', close: '24:00' }]
      : periodsFor(resource, day, day === current.day ? current.date : '');
    return {
      day,
      current: day === current.day,
      known: periods !== null,
      closed: Array.isArray(periods) && periods.length === 0,
      periods: (periods || []).map(period => ({
        ...period,
        label: `${formatScheduleTime(period.open, language)}–${formatScheduleTime(period.close, language)}`
      }))
    };
  });
}

function periodContains(period, minutes, fromPreviousDay = false) {
  const open = minutesFor(period.open);
  const close = minutesFor(period.close);
  if (open === null || close === null) return false;
  if (close > open) return !fromPreviousDay && minutes >= open && minutes < close;
  return fromPreviousDay ? minutes < close : minutes >= open;
}

function monthlyRuleMatches(rule, current) {
  if (rule.frequency !== 'monthly' || !rule.weekday || !Array.isArray(rule.ordinal)) return false;
  if (current.day !== String(rule.weekday).toLowerCase()) return false;
  const dayOfMonth = Number(current.date.slice(-2));
  const ordinal = Math.ceil(dayOfMonth / 7);
  return rule.ordinal.map(Number).includes(ordinal);
}

function scheduleRuleAvailability(resource, current) {
  if (!resource.scheduleRules?.length) return null;
  const matchingDateRules = resource.scheduleRules.filter(rule => monthlyRuleMatches(rule, current));
  if (!matchingDateRules.length) {
    return {
      code: 'confirmed_unavailable',
      available: false,
      confirmed: true,
      reason: 'The verified distribution schedule does not serve on the requested date.'
    };
  }
  const available = matchingDateRules.some(rule => periodContains(rule, current.minutes));
  return available
    ? {
      code: 'confirmed_distribution',
      available: true,
      confirmed: true,
      reason: 'The requested time is inside the verified distribution window.'
    }
    : {
      code: 'confirmed_unavailable',
      available: false,
      confirmed: true,
      reason: 'The distribution occurs that day, but not at the requested time.'
    };
}

export function resourceAvailabilityAt(resource, instant) {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    return { code: 'uncertain', available: false, confirmed: false, reason: 'No exact requested date and time were available.' };
  }
  const timeZone = resource.timeZone || 'America/Los_Angeles';
  const current = localParts(instant, timeZone);
  if (resource.temporaryClosure) {
    return { code: 'temporary_closed', available: false, confirmed: true, timeZone, reason: 'A verified temporary closure covers this resource.' };
  }
  if (resource.onlineAlwaysAvailable && !resource.weeklyHours) {
    return { code: 'confirmed_available', available: true, confirmed: true, timeZone, reason: 'The verified online service is available at all times.' };
  }
  if (resource.discoveryStatus === 'verification_pending'
    || /community-sourced/i.test(String(resource.verificationStatus || ''))) {
    return {
      code: 'uncertain',
      available: false,
      confirmed: false,
      timeZone,
      reason: 'Community-sourced hours have not yet been confirmed with the provider.'
    };
  }
  const ruleState = scheduleRuleAvailability(resource, current);
  if (ruleState) return { ...ruleState, timeZone };
  if (!resource.weeklyHours || typeof resource.weeklyHours !== 'object') {
    return {
      code: 'uncertain',
      available: false,
      confirmed: false,
      timeZone,
      reason: 'Verified hours for the exact requested time are not published.'
    };
  }
  const todayIndex = WEEK_DAYS.indexOf(current.day);
  const previousDay = WEEK_DAYS[(todayIndex + 6) % 7];
  const todayPeriods = periodsFor(resource, current.day, current.date) || [];
  const previousPeriods = periodsFor(resource, previousDay) || [];
  const withinHours = todayPeriods.some(period => periodContains(period, current.minutes))
    || previousPeriods.some(period => periodContains(period, current.minutes, true));
  if (resource.appointmentOnly) {
    return {
      code: 'appointment_required',
      available: false,
      confirmed: true,
      timeZone,
      reason: withinHours
        ? 'The location is open then, but service requires an appointment.'
        : 'The service requires an appointment and is not confirmed for the requested time.'
    };
  }
  return withinHours
    ? {
      code: 'confirmed_available',
      available: true,
      confirmed: true,
      timeZone,
      reason: 'The requested time is inside the verified service hours.'
    }
    : {
      code: 'confirmed_unavailable',
      available: false,
      confirmed: true,
      timeZone,
      reason: 'The verified schedule shows the resource closed at the requested time.'
    };
}

function nextOpeningMinutes(resource, current) {
  const todayIndex = WEEK_DAYS.indexOf(current.day);
  for (let offset = 0; offset <= 7; offset += 1) {
    const index = (todayIndex + offset) % 7;
    const day = WEEK_DAYS[index];
    const periods = periodsFor(resource, day, offset === 0 ? current.date : '');
    if (!periods) continue;
    for (const period of periods) {
      const open = minutesFor(period.open);
      if (open === null) continue;
      const delta = offset * 1440 + open - current.minutes;
      if (delta > 0) return { minutes: delta, time: period.open, day };
    }
  }
  return null;
}

export function resourceScheduleState(resource, now = new Date()) {
  const timeZone = resource.timeZone || 'America/Los_Angeles';
  const current = localParts(now, timeZone);
  if (resource.temporaryClosure) {
    return { code: 'temporary_closed', openNow: false, availableToday: false, minutesUntilOpen: null, timeZone };
  }
  const datedEvents = [
    resource.nextEvent,
    ...(Array.isArray(resource.eventDates) ? resource.eventDates : [])
  ].filter(Boolean);
  const eventIsToday = value => {
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10) === current.date;
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime()) && localParts(parsed, timeZone).date === current.date;
  };
  const hasEventToday = datedEvents.some(eventIsToday);
  if (!resource.weeklyHours && hasEventToday) {
    return { code: 'event_today', openNow: false, availableToday: true, minutesUntilOpen: null, timeZone };
  }
  if (resource.appointmentOnly) {
    const appointmentPeriods = resource.weeklyHours
      ? periodsFor(resource, current.day, current.date)
      : null;
    return {
      code: 'appointment_only',
      openNow: false,
      availableToday: Boolean(appointmentPeriods?.length || hasEventToday),
      minutesUntilOpen: null,
      timeZone
    };
  }
  if (resource.onlineAlwaysAvailable && !resource.weeklyHours) {
    return { code: 'online_available', openNow: true, availableToday: true, minutesUntilOpen: 0, timeZone };
  }
  if (!resource.weeklyHours || typeof resource.weeklyHours !== 'object') {
    const legacyAlwaysOpen = /24/.test(String(resource.hours || ''));
    return legacyAlwaysOpen
      ? { code: 'open_now', openNow: true, availableToday: true, minutesUntilOpen: 0, timeZone }
      : { code: 'hours_not_listed', openNow: false, availableToday: false, minutesUntilOpen: null, timeZone };
  }

  const todayIndex = WEEK_DAYS.indexOf(current.day);
  const previousDay = WEEK_DAYS[(todayIndex + 6) % 7];
  const todayPeriods = periodsFor(resource, current.day, current.date);
  const previousPeriods = periodsFor(resource, previousDay) || [];
  const openNow = Boolean(
    (todayPeriods || []).some(period => periodContains(period, current.minutes))
    || previousPeriods.some(period => periodContains(period, current.minutes, true))
  );
  const availableToday = Boolean((todayPeriods || []).length || openNow || hasEventToday);
  if (openNow) return { code: 'open_now', openNow: true, availableToday: true, minutesUntilOpen: 0, timeZone };
  if (hasEventToday) {
    return { code: 'event_today', openNow: false, availableToday: true, minutesUntilOpen: null, timeZone };
  }

  const next = nextOpeningMinutes(resource, current);
  if (next?.minutes <= 12 * 60) {
    return {
      code: 'opens_at',
      openNow: false,
      availableToday,
      minutesUntilOpen: next.minutes,
      nextOpenTime: next.time,
      nextOpenDay: next.day,
      timeZone
    };
  }
  return {
    code: availableToday ? 'closed' : 'closed_today',
    openNow: false,
    availableToday,
    minutesUntilOpen: next?.minutes ?? null,
    nextOpenTime: next?.time || '',
    nextOpenDay: next?.day || '',
    timeZone
  };
}
