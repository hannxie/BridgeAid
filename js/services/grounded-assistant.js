import { detectMessageLanguage, requestedLanguage } from '../localization.js';
import { normalizeResource, rankResources } from './resource-service.js?v=16';
import { localProgramForResource } from './local-eligibility-service.js?v=16';
import { resourceScheduleState } from './schedule-service.js';
import { locationContext, matchesUserLocation } from './location-eligibility-service.js';
import { isDisplayableResource } from './resource-quality-service.js';
import { evaluateNationwideProgram } from './nationwide-eligibility-service.js';

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
  if (/\b(?:save|bookmark|favorite|guardar|guarda)\b|收藏|保存/.test(value)) return 'save';
  if (/\b(?:call|phone|telephone|llamar|llama|teléfono)\b|电话|致电/.test(value)) return 'call';
  if (/eligible|eligibility|qualif|income|elegib|requisito|资格|符合/.test(value)) return 'eligibility';
  if (/apply|application|register|registration|form|solicitar|inscrib|申请|登记|表格/.test(value)) return 'registration';
  if (/hour|open|close|today|tomorrow|when|horario|abiert|cerrad|时间|营业|开放/.test(value)) return 'hours';
  if (/direction|walk|route|cómo lleg|caminar|ruta|路线|步行|怎么走/.test(value)) return 'directions';
  if (/address|where|dirección|dónde|地址|哪里/.test(value)) return 'location';
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

function usefulResources(resources, category, language, location) {
  const normalized = resources
    .map(resource => normalizeResource(resource, language))
    .filter(isDisplayableResource)
    .filter(resource => {
      if (resource.scope !== 'location') return true;
      const match = matchesUserLocation(resource, location);
      return match.serves === true && match.confirmed;
    });
  const matches = category
    ? normalized.filter(resource => resource.category === category || resource.services.includes(category) || resource.category === 'all')
    : normalized;
  return rankResources(matches, { categories: category ? [category] : [], location }).slice(0, 3);
}

function referencedRecommendation(message, resources, context = {}) {
  const prior = (context.recommendationIds || [])
    .map(id => resources.find(resource => String(resource.id) === String(id)))
    .filter(Boolean);
  const value = String(message || '').toLowerCase();
  const indexMatch = value.match(/\b(?:option|result|one|number|número|opción)?\s*(1|2|3|first|second|third|primero|primera|segundo|segunda|tercero|tercera)\b/);
  const chineseIndex = value.match(/第?(一|二|三)个?/);
  const indices = {
    1: 0, first: 0, primero: 0, primera: 0, 一: 0,
    2: 1, second: 1, segundo: 1, segunda: 1, 二: 1,
    3: 2, third: 2, tercero: 2, tercera: 2, 三: 2
  };
  const indexToken = indexMatch?.[1] || chineseIndex?.[1];
  if (indexToken && prior[indices[indexToken]]) return prior[indices[indexToken]];
  return prior.find(resource => value.includes(String(resource.name || '').toLowerCase())) || prior[0] || null;
}

export function answerGroundedAssistant({
  message,
  selectedLanguage,
  languageExplicit = false,
  currentLocation = '',
  resources = [],
  context = {},
  selectedResource = null,
  quizAnswers = {},
  savedIds = [],
  translate
}) {
  const requested = requestedLanguage(message);
  const language = requested || detectMessageLanguage(message, context.language || selectedLanguage) || context.language || selectedLanguage;
  const intent = assistantIntent(message);
  const category = assistantCategory(message) || context.category || '';
  const location = locationFromMessage(message) || currentLocation || context.location || '';
  const tr = (key, variables) => translate(language, key, variables);
  const recommended = usefulResources(resources, category, language, location);
  const referenced = referencedRecommendation(message, recommended.length ? recommended : resources, context);
  const selected = selectedResource ? normalizeResource(selectedResource, language) : null;
  const chosen = referenced || (selected && isDisplayableResource(selected) ? selected : recommended[0]);
  const nextContext = {
    ...context,
    category,
    location,
    intent,
    language,
    recommendationIds: recommended.map(resource => resource.id)
  };

  if (requested && !assistantCategory(message) && intent === 'resources' && !context.category) {
    return { language, context: nextContext, text: tr('chatLanguageChanged'), recommendations: [] };
  }
  if (!location) return { language, context: nextContext, text: tr('assistantNeedLocation'), recommendations: [], followUp: 'location' };
  if (!category && intent === 'resources') return { language, context: nextContext, text: tr('assistantNeedNeed'), recommendations: [], followUp: 'need' };

  if (!chosen) return { language, context: nextContext, text: tr('assistantNoVerified'), recommendations: [] };

  if (intent === 'save') {
    const alreadySaved = savedIds.map(String).includes(String(chosen.id));
    return {
      language,
      context: nextContext,
      text: alreadySaved
        ? tr('assistantAlreadySaved', { program: chosen.name })
        : tr('assistantSavedResource', { program: chosen.name }),
      recommendations: [chosen],
      action: alreadySaved ? null : { type: 'save', resourceId: chosen.id }
    };
  }
  if (intent === 'call') {
    return {
      language,
      context: nextContext,
      text: chosen.phone
        ? tr('assistantCallKnown', { program: chosen.name, phone: chosen.phone })
        : tr('assistantCallUnknown'),
      recommendations: [chosen],
      action: chosen.phone ? { type: 'call', resourceId: chosen.id } : null
    };
  }
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
    if (chosen.scope !== 'location') {
      const match = evaluateNationwideProgram(chosen, {
        ...quizAnswers,
        state: quizAnswers.state || locationContext(location).state || ''
      });
      const matchKey = {
        likely: 'matchLikely',
        possible: 'matchPossible',
        'more-info': 'matchMoreInfo',
        unlikely: 'matchUnlikely'
      }[match.code] || 'matchMoreInfo';
      return {
        language,
        context: nextContext,
        text: tr('assistantNationwideEligibility', {
          program: chosen.name,
          status: tr(matchKey)
        }),
        recommendations: [chosen],
        action: { type: 'eligibility', resourceId: chosen.id }
      };
    }
    const local = localProgramForResource(chosen, location);
    return {
      language,
      context: nextContext,
      text: local?.localEligibilityVerified
        ? tr('assistantEligibilityKnown', { program: chosen.name })
        : tr('assistantEligibilityNotPublished', { program: chosen.name }),
      recommendations: [chosen],
      action: { type: 'eligibility', resourceId: chosen.id }
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
      action: { type: 'registration', resourceId: chosen.id }
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
  if (intent === 'directions') {
    return {
      language,
      context: nextContext,
      text: chosen.address
        ? tr('assistantLocationKnown', { program: chosen.name, address: chosen.address })
        : tr('addressUnavailable'),
      recommendations: [chosen],
      action: chosen.address ? { type: 'directions', resourceId: chosen.id } : null
    };
  }
  return {
    language,
    context: nextContext,
    text: tr('assistantFound', { count: recommended.length, location }),
    recommendations: recommended
  };
}
