const { escapeOutputPayload } = require('./shared');
const inventoryDisplayConfigService = require('./inventoryDisplayConfigService');
const aiLogService = require('./aiLogService');
const inventoryService = require('./inventoryService');
const taskService = require('./taskService');
const evalService = require('./evalService');
const aiRegistryService = require('./aiRegistryService');
const aiAgentService = require('./aiAgentService');

function safe(value) {
  return escapeOutputPayload(value);
}

const KNOWN_COMMANDS = new Set([
  'update_inventory_specs',
  'update_inventory_display_config',
  'run_market_update_scan',
  'run_inventory_enrichment',
  'generate_daily_briefing',
  'run_ui_scenario',
  'run_api_smoke_test',
  'create_task'
]);

function parseCommands(text = '') {
  const commands = [];
  const regex = /<([^>]+)>/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;

    // Support <CMD:name|a=b|c=d> and <name a=b c=d> formats
    let name = '';
    let argParts = [];
    if (raw.startsWith('CMD:')) {
      const [, rest] = raw.split('CMD:');
      const segments = rest.split('|').map(s => s.trim()).filter(Boolean);
      name = segments.shift() || '';
      argParts = segments;
    } else {
      const pieces = raw.split(/\s+/);
      name = pieces.shift() || '';
      argParts = pieces;
    }

    if (!KNOWN_COMMANDS.has(name)) continue;
    const args = {};
    argParts.forEach(part => {
      if (!part) return;
      const [k, v] = part.split('=');
      if (!k || v === undefined) return;
      args[k] = v.replace(/^"|"$/g, '');
    });
    const delayPart = args.delay;
    if (delayPart) delete args.delay;
    commands.push({ name, args, delay: delayPart || null });
  }
  return commands;
}

async function execute(commands = [], options = {}) {
  const results = [];
  for (const command of commands) {
    const result = await executeSingle(command, options);
    results.push(result);
  }
  return results;
}

async function executeSingle(command, options = {}) {
  const { tenantId, user, autopilotLevel = 0, maxAutopilotLevel = 1 } = options;
  let outcome = { status: 'skipped', reason: 'No executor registered' };

  if (autopilotLevel > maxAutopilotLevel) {
    outcome = { status: 'blocked', reason: 'Autopilot level exceeded' };
  } else {
    switch (command.name) {
      case 'update_inventory_specs':
        if (!command.args?.id) {
          outcome = { status: 'failed', error: 'Missing id' };
          break;
        }
        outcome = inventoryService.update(command.args.id, command.args.patch || {}, tenantId);
        break;
      case 'update_inventory_display_config':
        outcome = inventoryDisplayConfigService.update(command.args || {}, tenantId);
        break;
      case 'create_task':
        outcome = taskService.create(
          { title: command.args?.title || 'AI Task', notes: command.args?.notes || '' },
          tenantId
        );
        break;
      case 'run_market_update_scan':
        outcome = aiAgentService.runEval({
          tenantId,
          evalId: 'market_update_scan',
          agentId: 'market-intel',
          autopilot: true,
          maxAutopilotLevel,
          user,
          message: command.args?.message || 'Run market update scan via command.'
        });
        break;
      case 'run_inventory_enrichment':
        outcome = aiAgentService.runEval({
          tenantId,
          evalId: 'inventory_enrichment',
          agentId: 'inventory-enrichment',
          autopilot: true,
          maxAutopilotLevel,
          user,
          message: command.args?.message || 'Enrich inventory unit',
          context: { inventoryId: command.args?.inventoryId }
        });
        break;
      case 'generate_daily_briefing':
        outcome = aiAgentService.runEval({
          tenantId,
          evalId: 'daily_briefing',
          agentId: 'global-assistant',
          autopilot: true,
          maxAutopilotLevel,
          user,
          message: command.args?.message || 'Generate daily briefing.'
        });
        break;
      default:
        outcome = { status: 'skipped', reason: 'Unsupported command' };
    }
  }

  aiLogService.log(
    {
      type: 'command_execution',
      commands: [command],
      user,
      context: { outcome }
    },
    tenantId
  );

  return safe({ command, outcome });
}

module.exports = {
  parseCommands,
  execute,
  executeSingle
};
