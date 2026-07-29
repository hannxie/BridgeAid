import { detectMessageLanguage, requestedLanguage } from '../localization.js';
import { normalizeResource, rankResources } from './resource-service.js?v=10';
import { localProgramForResource } from './local-eligibility-service.js?v=10';
import { resourceScheduleState } from './schedule-service.js';

const CATEGORY_TERMS = {
  food: ['food', 'meal', 'pantry', 'hungry', 'comida', 'alimentos', 'hambre', '食物', '食品', '吃饭', '饿'],
  shelter: ['shelter', 'housing', 'sleep', 'refugio', 'alojamiento', 'vivienda', '住宿', '住所', '住房'],
  safe: ['safe place', 'domestic violence', 'abuse', 'lugar seguro', 'violencia', '安全场所', '家暴'],
  health: ['health', 'clinic', 'doctor', 'medical', 'salud', 'clínica', 'médico', 'médica', 'atención médica', '医疗', '诊所', '医生'],
  mental: ['mental', 'counseling', 'therapy', 'salud mental', 'terapia', '心理', '咨询'],
  hygiene: ['shower', 'laundry', 'hygiene', 'ducha', 'lavandería', '淋浴', '洗衣'],
  transport: ['bus', 'ride', 'transport', 'autobús', 'transporte', '公交', '交通'],
  benefits: ['benefits', 'snap', 'medicaid', 'beneficios', '福利', '补助'],
  jobs: ['job', 'work', 'employment', 'empleo', 'trabajo', '工作', '就业'],
  legal: ['legal', 'lawyer', 'immigration', 'abogado', 'inmigración', '法律', '律师', '移民']
};

export function assistantIntent(message) {
  const value = String(message || '').toLowerCase();
  if (/eligible|eligibility|qualif|income|elegib|requisito|资格|符合/.test(value)) return 'eligibility';
  if (/apply|application|register|registration|form|solicitar|inscrib|申请|登记|表格/.test(value)) return 'registration';
  if (/hour|open|close|today|tomorrow|when|horario|abiert|cerrad|时间|营业|开放/.test(value)) return 'hours';
  if (/address|where|direction|walk|dirección|dónde|caminar|地址|哪里|路线|步行/.test(value)) return 'location';
  return 'resources';
}

export function assistantCategory(message) {
  const value = String(message || '').toLowerCase();
  return Object.entries(CATEGORY_TERMS).find(([, terms]) => terms.some(term => value.includes(term)))?.[0] || '';
}

export function locationFromMessage(message) {
  const value = String(message || '')
    .trim()
    .replace(/\b(?:in|en)\s+(?:english|spanish|simplified chinese|chinese|ingl[eé]s|espa(?:ñ|n)ol|chino simplificado|chino)\b[,.]?/gi, ' ');
  const zip = value.match(/\b\d{5}(?:-\d{4})?\b/);
  if (zip) return zip[0];
  const latin = value.match(/\b(?:near|in|around|en|cerca de)\s+([A-Za-zÀ-ÿ .'-]+(?:,\s*[A-Z]{2})?)\s*[?.!]?$/i);
  if (latin) return latin[1].trim();
  const chinese = value.match(/(?:在|附近|靠近)([\u3400-\u9fffA-Za-z0-9 ,.-]{2,30})(?:找|的|附近|$)/);
  return chinese?.[1]?.trim() || '';
}

function usefulResources(resources, category, language) {
  const normalized = resources.map(resource => normalizeResource(resource, language));
  const matches = category
    ? normalized.filter(resource => resource.category === category || resource.services.includes(category) || resource.category === 'all')
    : normalized;
  return rankResources(matches, { categories: category ? [category] : [] }).slice(0, 3);
}

export function answerGroundedAssistant({
  message,
  selectedLanguage,
  languageExplicit = false,
  currentLocation = '',
  resources = [],
  context = {},
  selectedResource = null,
  translate
}) {
  const requested = requestedLanguage(message);
  const language = requested || detectMessageLanguage(message, context.language || selectedLanguage) || context.language || selectedLanguage;
  const intent = assistantIntent(message);
  const category = assistantCategory(message) || context.category || '';
  const location = locationFromMessage(message) || currentLocation || context.location || '';
  const tr = (key, variables) => translate(language, key, variables);
  const nextContext = { ...context, category, location, intent, language };

  if (requested && !assistantCategory(message) && intent === 'resources') {
    return { language, context: nextContext, text: tr('chatLanguageChanged'), recommendations: [] };
  }
  if (!location) return { language, context: nextContext, text: tr('assistantNeedLocation'), recommendations: [], followUp: 'location' };
  if (!category && intent === 'resources') return { language, context: nextContext, text: tr('assistantNeedNeed'), recommendations: [], followUp: 'need' };

  const recommended = usefulResources(resources, category, language);
  const chosen = selectedResource ? normalizeResource(selectedResource, language) : recommended[0];
  if (!chosen) return { language, context: nextContext, text: tr('assistantNoVerified'), recommendations: [] };

  if (intent === 'hours') {
    const schedule = resourceScheduleState(chosen);
    return {
      language,
      context: nextContext,
      text: schedule.code !== 'hours_not_listed'
        ? tr('assistantHoursKnown', { program: chosen.name })
        : tr('assistantHoursUnknown'),
      recommendations: [chosen]
    };
  }
  if (intent === 'eligibility') {
    const local = localProgramForResource(chosen, location);
    return {
      language,
      context: nextContext,
      text: local?.localEligibilityVerified
        ? tr('assistantEligibilityKnown', { program: chosen.name })
        : tr('assistantEligibilityNotPublished', { program: chosen.name }),
      recommendations: [chosen],
      action: 'eligibility'
    };
  }
  if (intent === 'registration') {
    const canApply = Boolean(chosen.registrationUrl || chosen.applicationLinks.length || chosen.phone || chosen.address);
    return {
      language,
      context: nextContext,
      text: canApply
        ? `${tr('registrationReview')} ${tr('registrationNeverSubmit')}`
        : tr('assistantApplyUnknown'),
      recommendations: [chosen],
      action: 'registration'
    };
  }
  if (intent === 'location') {
    return {
      language,
      context: nextContext,
      text: chosen.address
        ? tr('assistantLocationKnown', { program: chosen.name, address: chosen.address })
        : tr('addressUnavailable'),
      recommendations: [chosen]
    };
  }
  return {
    language,
    context: nextContext,
    text: tr('assistantFound', { count: recommended.length, location }),
    recommendations: recommended
  };
}
