const aiService = require('./aiService');
const aiRegistryService = require('./aiRegistryService');
const evalService = require('./evalService');
const aiLogService = require('./aiLogService');
const { sanitizePayloadStrings, escapeOutputPayload } = require('./shared');
const { normalizeTenantId } = require('./tenantService');

function route(payload = {}, tenantId) {
  const sanitized = sanitizePayloadStrings(payload, ['naturalLanguageRequest']);
  const tenant = normalizeTenantId(tenantId);
  evalService.seedIfEmpty(tenant);
  const evals = evalService.list({ tenantId: tenant, status: 'active' });
  const provider = aiRegistryService.listProviders(tenant).find(p => p.type === 'gemini') || {};

  const providerRequest = aiService.buildProviderRequest(
    {
      ...provider,
      defaultModel: provider.defaultModel || 'gemini-3.0-pro'
    },
    {
      prompt: {
        system:
          'You are an intent router. Choose the best eval for the user request, returning JSON with matchType, evalId, confidence, normalizedIntent, arguments, or propose a new eval.',
        context: {
          tenantId: tenant,
          user: payload.user
        }
      },
      userMessage: buildRouterPrompt(sanitized.naturalLanguageRequest, evals)
    }
  );

  const best = simpleMatch(sanitized.naturalLanguageRequest, evals);

  // If no confident match, store proposed eval draft
  if ((!best || best.confidence < 0.7) && payload.proposedEval) {
    evalService.create(
      { ...payload.proposedEval, status: 'draft', createdBy: 'ai' },
      tenant,
      'ai'
    );
  }

  aiLogService.log(
    {
      type: 'eval_routing',
      agentId: 'router',
      message: sanitized.naturalLanguageRequest,
      context: { best, evals, providerRequest }
    },
    tenant
  );

  return escapeOutputPayload({
    route: best,
    providerRequest,
    evals
  });
}

function buildRouterPrompt(naturalLanguageRequest = '', evals = []) {
  const lines = ['User said:', naturalLanguageRequest || '(none)', '', 'Evals:'];
  evals.forEach(entry => {
    lines.push(
      `- id: ${entry.id}; name: ${entry.name}; category: ${entry.category}; desc: ${entry.description}; examples: ${(
        entry.examples || []
      ).join(' | ')}`
    );
  });
  return lines.join('\n');
}

function simpleMatch(request = '', evals = []) {
  const lower = (request || '').toLowerCase();
  let best = null;
  evals.forEach(entry => {
    const examples = entry.examples || [];
    const hits = examples.filter(example => lower.includes(example.toLowerCase())).length;
    const score = hits || lower.includes(entry.name.toLowerCase()) ? 0.8 : 0.2;
    if (!best || score > best.confidence) {
      best = { matchType: 'existing_eval', evalId: entry.id, confidence: score };
    }
  });
  if (!best) {
    best = { matchType: 'new_eval', confidence: 0, proposedEval: null };
  }
  return best;
}

module.exports = {
  route
};
