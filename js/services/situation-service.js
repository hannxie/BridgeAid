const CATEGORY_PATTERNS = {
  food: /\b(food|meal|meals|pantry|grocer(?:y|ies)|hungry|hunger|comida|alimento|hambre)\b/i,
  shelter: /\b(shelter|housing|homeless|evict(?:ed|ion)?|rent|sleep|refugio|vivienda)\b/i,
  health: /\b(health|clinic|doctor|dental|medicine|medical|salud|m[eé]dic[oa])\b/i,
  mental: /\b(mental health|therapy|counseling|anxiety|depress(?:ed|ion)|addiction|rehab)\b/i,
  transport: /\b(transport(?:ation)?|ride|bus|transit|gas money)\b/i,
  hygiene: /\b(clothing|clothes|shower|laundry|hygiene)\b/i,
  jobs: /\b(job|jobs|work|employment|career|training|resume|apprenticeship)\b/i,
  education: /\b(education|school|college|scholarship|tuition|financial aid|fafsa)\b/i,
  family: /\b(childcare|child care|family support|diapers?|baby supplies)\b/i,
  legal: /\b(legal|lawyer|attorney|court|custody|immigration help)\b/i,
  benefits: /\b(benefits?|snap|ebt|medicaid|ssi|utility assistance|financial assistance)\b/i,
  disability: /\b(disability|disabled|accessible|accessibility)\b/i,
  veteran: /\b(veteran|military|service member|servicemember)\b/i,
  immigration: /\b(immigration|immigrant|citizenship|asylum|uscis)\b/i,
  internet: /\b(internet|wifi|computer|technology|digital access)\b/i
};

const STATE_TIME_ZONES = {
  AK: 'America/Anchorage', HI: 'Pacific/Honolulu',
  WA: 'America/Los_Angeles', OR: 'America/Los_Angeles', CA: 'America/Los_Angeles', NV: 'America/Los_Angeles',
  AZ: 'America/Phoenix', CO: 'America/Denver', ID: 'America/Denver', MT: 'America/Denver', NM: 'America/Denver',
  UT: 'America/Denver', WY: 'America/Denver',
  AL: 'America/Chicago', AR: 'America/Chicago', IA: 'America/Chicago', IL: 'America/Chicago', KS: 'America/Chicago',
  LA: 'America/Chicago', MN: 'America/Chicago', MO: 'America/Chicago', MS: 'America/Chicago', ND: 'America/Chicago',
  NE: 'America/Chicago', OK: 'America/Chicago', SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago',
  WI: 'America/Chicago',
  CT: 'America/New_York', DC: 'America/New_York', DE: 'America/New_York', FL: 'America/New_York',
  GA: 'America/New_York', IN: 'America/New_York', KY: 'America/New_York', MA: 'America/New_York',
  MD: 'America/New_York', ME: 'America/New_York', MI: 'America/New_York', NC: 'America/New_York',
  NH: 'America/New_York', NJ: 'America/New_York', NY: 'America/New_York', OH: 'America/New_York',
  PA: 'America/New_York', RI: 'America/New_York', SC: 'America/New_York', VA: 'America/New_York',
  VT: 'America/New_York', WV: 'America/New_York'
};

const CITY_TIME_ZONES = {
  seattle: 'America/Los_Angeles', portland: 'America/Los_Angeles', losangeles: 'America/Los_Angeles',
  sanfrancisco: 'America/Los_Angeles', phoenix: 'America/Phoenix', denver: 'America/Denver',
  chicago: 'America/Chicago', austin: 'America/Chicago', dallas: 'America/Chicago', houston: 'America/Chicago',
  minneapolis: 'America/Chicago', newyork: 'America/New_York', boston: 'America/New_York',
  philadelphia: 'America/New_York', atlanta: 'America/New_York', miami: 'America/New_York'
};

function compact(value) {
  return String(value || '').toLowerCase().replace(/[^a-z]/g, '');
}

export function inferUsTimeZone(location = '', coordinates = null) {
  const text = String(location || '');
  const state = text.toUpperCase().match(/(?:^|[\s,])([A-Z]{2})(?:\s|,|$)/)?.[1];
  if (state && STATE_TIME_ZONES[state]) return STATE_TIME_ZONES[state];
  const normalized = compact(text);
  const city = Object.keys(CITY_TIME_ZONES).find(name => normalized.includes(name));
  if (city) return CITY_TIME_ZONES[city];
  const longitude = Number(coordinates?.lng ?? coordinates?.longitude);
  if (Number.isFinite(longitude)) {
    if (longitude <= -141) return 'America/Anchorage';
    if (longitude <= -114) return 'America/Los_Angeles';
    if (longitude <= -101) return 'America/Denver';
    if (longitude <= -86) return 'America/Chicago';
    return 'America/New_York';
  }
  return 'America/New_York';
}

function localCalendar(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    weekday: values.weekday.toLowerCase()
  };
}

function addLocalDays(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12));
  return shifted.toISOString().slice(0, 10);
}

function parsedTime(text) {
  const twelveHour = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (twelveHour) {
    let hour = Number(twelveHour[1]) % 12;
    const minute = Number(twelveHour[2] || 0);
    if (/p/i.test(twelveHour[3])) hour += 12;
    if (minute <= 59) return { minutes: hour * 60 + minute, source: twelveHour[0] };
  }
  const twentyFourHour = text.match(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/i);
  if (twentyFourHour) {
    return {
      minutes: Number(twentyFourHour[1]) * 60 + Number(twentyFourHour[2]),
      source: twentyFourHour[0]
    };
  }
  return null;
}

function requestedDateNearTime(text, time, calendar) {
  const explicit = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (explicit) return explicit[1];
  const markers = [...text.matchAll(/\b(tomorrow|today|tonight|this evening)\b/gi)]
    .map(match => ({
      value: match[1].toLowerCase(),
      index: match.index ?? 0
    }));
  if (!markers.length) return '';
  if (!time) {
    const marker = markers[0].value;
    return marker === 'tomorrow' ? addLocalDays(calendar.date, 1) : calendar.date;
  }
  const timeIndex = text.toLowerCase().indexOf(String(time.source || '').toLowerCase());
  const nearest = [...markers].sort((left, right) =>
    Math.abs(left.index - timeIndex) - Math.abs(right.index - timeIndex)
    || left.index - right.index)[0];
  return nearest.value === 'tomorrow' ? addLocalDays(calendar.date, 1) : calendar.date;
}

function parseNumber(text, pattern) {
  const match = text.match(pattern);
  return match ? Number(match[1]) : null;
}

export function localDateTimeToInstant(date, minutes, timeZone) {
  if (!date || !Number.isFinite(minutes)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const desiredWallClock = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = new Date(desiredWallClock);
  for (let pass = 0; pass < 3; pass += 1) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(candidate);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const represented = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour) % 24,
      Number(values.minute)
    );
    candidate = new Date(candidate.getTime() + desiredWallClock - represented);
  }
  return candidate;
}

export function parseSituation(text, options = {}) {
  const value = String(text || '').normalize('NFKC').trim();
  const normalized = value.toLowerCase();
  const timeZone = options.timeZone || inferUsTimeZone(options.location, options.coordinates);
  const calendar = localCalendar(options.now || new Date(), timeZone);
  const time = parsedTime(normalized);
  const requestedDate = requestedDateNearTime(normalized, time, calendar);
  const categories = Object.entries(CATEGORY_PATTERNS)
    .filter(([, pattern]) => pattern.test(normalized))
    .map(([category]) => category);
  const maxDistance = parseNumber(normalized, /\b(?:within|maximum|max|no more than)\s+(\d+(?:\.\d+)?)\s*(?:miles?|mi)\b/i);
  const age = parseNumber(normalized, /\b(?:age|aged|is)\s+(\d{1,3})\b/i);
  const householdSize = parseNumber(normalized, /\b(?:household|family)\s+(?:of|size)\s+(\d{1,2})\b/i);
  const zip = normalized.match(/\b\d{5}\b/)?.[0] || '';
  const transportation = /\b(no car|without a car|walking only|on foot)\b/i.test(normalized)
    ? 'walking'
    : /\b(bus|public transit|transit)\b/i.test(normalized)
      ? 'transit'
      : /\b(car|driv(?:e|ing)|vehicle)\b/i.test(normalized)
        ? 'driving'
        : '';
  const appointmentRestriction = /\b(no appointment|without an appointment|walk[- ]?in only|cannot make an appointment)\b/i.test(normalized);
  const requestedInstant = requestedDate && time
    ? localDateTimeToInstant(requestedDate, time.minutes, timeZone)
    : null;
  return {
    sourceText: value,
    categories,
    requestedDate,
    requestedMinutes: time?.minutes ?? null,
    requestedTimeText: time?.source || '',
    requestedInstant,
    timeZone,
    urgency: /\b(now|immediately|urgent|asap|emergency)\b/i.test(normalized)
      ? 'immediate'
      : /\b(today|tonight|this evening)\b/i.test(normalized)
        ? 'today'
        : '',
    location: zip || '',
    transportation,
    maxDistance,
    wheelchairAccessible: /\b(wheelchair|mobility device|step[- ]?free)\b/i.test(normalized),
    noId: /\b(no (?:photo )?(?:id|identification)|without (?:an? )?(?:id|identification)|do(?:es)? not have (?:an? )?(?:id|identification))\b/i.test(normalized),
    appointmentRestriction,
    walkInOnly: appointmentRestriction || /\bwalk[- ]?in\b/i.test(normalized),
    age,
    householdSize,
    priorities: [
      /\bfree|no cost|cannot pay\b/i.test(normalized) ? 'free' : '',
      /\bclosest|nearest\b/i.test(normalized) ? 'nearest' : '',
      /\bfastest|quickly\b/i.test(normalized) ? 'fastest' : ''
    ].filter(Boolean)
  };
}
