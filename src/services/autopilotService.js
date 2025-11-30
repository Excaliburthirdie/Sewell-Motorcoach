const aiAgentService = require('./aiAgentService');
const aiLogService = require('./aiLogService');
const config = require('../config');
const { datasets } = require('./state');

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
let timer;

function start(tenantId) {
  stop();
  const intervalMs = Number(process.env.AI_AUTOPILOT_INTERVAL_MS || DEFAULT_INTERVAL_MS);
  timer = setInterval(() => runWhatsNext(tenantId), intervalMs);
  timer.unref?.();
}

function stop() {
  if (timer) clearInterval(timer);
}

function runWhatsNext(tenantId, user) {
  const settings =
    (datasets.aiControl.autopilotSettings || []).find(entry => entry.tenantId === tenantId) || { maxLevel: 1 };
  const result = aiAgentService.runEval({
    tenantId,
    evalId: 'whats_next_autopilot',
    agentId: 'global-assistant',
    mode: 'autopilot',
    autopilot: true,
    maxAutopilotLevel: settings.maxLevel ?? 1,
    user: user || { role: 'system', name: 'autopilot' },
    message: 'Decide the next safe task. Emit <COMMAND> entries as needed.',
    context: { autopilot: true }
  });

  aiLogService.log(
    {
      type: 'autopilot_run',
      evalId: 'whats_next_autopilot',
      user,
      context: { result }
    },
    tenantId
  );

  return result;
}

module.exports = {
  start,
  stop,
  runWhatsNext
};
