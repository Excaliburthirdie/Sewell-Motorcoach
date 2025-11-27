const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../persistence/store');

function list({ tenantId, entity, since, limit = 100 } = {}) {
  const logPath = path.join(DATA_DIR, 'audit.log');
  if (!fs.existsSync(logPath)) return [];
  const lines = fs.readFileSync(logPath, 'utf8').trim().split(/\n/).filter(Boolean);
  const items = lines
    .map(line => {
      try {
        return JSON.parse(line);
      } catch (err) {
        return null;
      }
    })
    .filter(Boolean)
    .filter(item => {
      const tenantMatch = !tenantId || item.tenantId === tenantId;
      const entityMatch = !entity || item.entity === entity;
      const sinceMatch = !since || new Date(item.timestamp) >= new Date(since);
      return tenantMatch && entityMatch && sinceMatch;
    });
  return items.slice(-Number(limit)).reverse();
}

module.exports = {
  list
};
