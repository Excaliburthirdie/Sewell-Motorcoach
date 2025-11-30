const aiService = require('./aiService');
const aiRegistryService = require('./aiRegistryService');
const evalService = require('./evalService');
const commandExecutorService = require('./commandExecutorService');
const aiLogService = require('./aiLogService');
const toolExecutionService = require('./toolExecutionService');
const { escapeOutputPayload } = require('./shared');
const { normalizeTenantId } = require('./tenantService');

function processModelOutput(output = {}, options = {}) {
  const tenant = normalizeTenantId(options.tenantId);
  const toolCalls = Array.isArray(output.toolCalls)
    ? output.toolCalls.map(call => ({
        name: call.name,
        args: call.args,
        result: toolExecutionService.execute(call.name, call.args || {}, tenant, options.user)
      }))
    : [];

  const commands = Array.isArray(output.commands)
    ? commandExecutorService.parseCommands(output.commands.join(' '))
    : [];

  const commandResults = commands.length
    ? commandExecutorService.execute(commands, {
        tenantId: tenant,
        user: options.user,
        autopilotLevel: options.autopilotLevel ?? 0,
        maxAutopilotLevel: options.maxAutopilotLevel ?? 1
      })
    : [];

  const logRecord = {
    type: 'ai_model_output',
    evalId: options.evalId,
    agentId: options.agentId,
    sessionId: options.sessionId,
    mode: options.mode,
    user: options.user,
    context: options.context,
    toolCalls,
    commands,
    commandResults,
    internalTrace: output.internalTrace || output.internal_trace,
    planSummary: output.planSummary,
    userFacingMessage: output.userFacingMessage,
    success: !output.error,
    error: output.error
  };
  aiLogService.log(logRecord, tenant);

  return escapeOutputPayload({
    toolCalls,
    commands,
    commandResults,
    userFacingMessage: output.userFacingMessage,
    planSummary: output.planSummary,
    internalTrace: output.internalTrace || output.internal_trace
  });
}

function runEval(options = {}) {
  const tenant = normalizeTenantId(options.tenantId);
  evalService.seedIfEmpty(tenant);
  const evalDef = evalService.getById(options.evalId, tenant);
  if (!evalDef) return { error: 'Eval not found' };

  const agent = resolveAgent(options.agentId, tenant);
  if (!agent || !agent.provider) return { error: 'Agent/provider not configured' };

  const tools = aiRegistryService.listTools({
    tenantId: tenant,
    profileIds: agent.toolProfileIds || [],
    role: options.user?.role
  });

  const systemPrompt = buildSystemPrompt(agent, evalDef, options);
  const providerRequest = aiService.buildProviderRequest(agent.provider, {
    prompt: {
      system: systemPrompt,
      context: options.context,
      playbook: evalDef.playbook,
      restrictions: evalDef.restrictions
    },
    tools,
    model: agent.provider.defaultModel || agent.provider.model,
    userMessage: options.message
  });

  const parsedCommands = commandExecutorService.parseCommands(options.message || '');
  const executedTools = Array.isArray(options.toolCalls)
    ? options.toolCalls.map(call => ({
        name: call.name,
        args: call.args,
        result: toolExecutionService.execute(call.name, call.args || {}, tenant, options.user)
      }))
    : [];
  const response = {
    eval: evalDef,
    agent: agent.agent,
    providerRequest,
    commands: parsedCommands,
    toolCalls: executedTools,
    internal_trace: [
      'eval prepared; awaiting model response',
      `autopilotLevel=${evalDef.autopilotLevel} tenantMax=${options.maxAutopilotLevel ?? 1}`
    ]
  };

  aiLogService.log(
    {
      type: 'eval_run',
      evalId: evalDef.id,
      agentId: agent.agent.id,
      user: options.user,
      mode: options.mode,
      context: options.context,
      commands: response.commands,
      internalTrace: response.internal_trace,
      toolCalls: response.toolCalls,
      providerRequest,
      modelConfig: { model: agent.provider?.defaultModel || agent.provider?.model },
      planSummary: options.planSummary,
      userFacingMessage: options.userFacingMessage,
      success: true
    },
    tenant
  );

  // Execute commands immediately only if autopilot mode and allowed
  if (options.autopilot && response.commands.length) {
    response.commandResults = commandExecutorService.execute(response.commands, {
      tenantId: tenant,
      user: options.user,
      autopilotLevel: evalDef.autopilotLevel ?? 0,
      maxAutopilotLevel: options.maxAutopilotLevel ?? 1
    });
  }

  return escapeOutputPayload(response);
}

function resolveAgent(agentId, tenantId) {
  const toolkit = aiRegistryService.buildAgentToolkit(agentId, tenantId) || {};
  return {
    agent: toolkit.agent,
    provider: toolkit.provider
  };
}

function buildSystemPrompt(agent, evalDef, options = {}) {
  const lines = [];
  lines.push(`You are ${agent.agent?.name || 'an AI agent'} for Sewell Motorcoach.`);
  lines.push('Use the provided tools when data is needed; do not guess.');
  lines.push(`Eval: ${evalDef.id} - ${evalDef.name}`);
  lines.push(`Description: ${evalDef.description}`);
  lines.push('Playbook:');
  lines.push(evalDef.playbook || '');
  lines.push('Restrictions:');
  lines.push((evalDef.restrictions || []).join('\n'));
  lines.push('Use <COMMAND> blocks if you need to trigger backend actions directly.');
  lines.push('Return JSON: { reply, internal_trace, commands }');
  lines.push(`User: ${JSON.stringify(options.user || {})}`);
  lines.push(`Context: ${JSON.stringify(options.context || {})}`);
  return lines.join('\n');
}

module.exports = {
  runEval,
  processModelOutput
};
