const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

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
