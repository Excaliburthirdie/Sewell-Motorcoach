const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../persistence/store');

function ensureArchiveDir() {
  const archiveDir = path.join(DATA_DIR, 'archive');
  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir, { recursive: true });
  }
  return archiveDir;
}

function partitionByRetention(items = [], threshold, dateSelector) {
  const archived = [];
  const kept = [];
  items.forEach(item => {
    const dateValue = dateSelector(item);
    const created = dateValue ? new Date(dateValue).getTime() : undefined;
    if (created && created < threshold) {
      archived.push(item);
    } else {
      kept.push(item);
    }
  });
  return { archived, kept };
}

function archiveJson(filename, records) {
  if (!records.length) return;
  const archiveDir = ensureArchiveDir();
  const output = path.join(archiveDir, `${filename}-${Date.now()}.json`);
  fs.writeFileSync(output, JSON.stringify(records, null, 2));
}

function pruneAuditLog(retentionDays) {
  if (!retentionDays) return;
  const auditPath = path.join(DATA_DIR, 'audit.log');
  if (!fs.existsSync(auditPath)) return;

  const threshold = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const lines = fs.readFileSync(auditPath, 'utf8').split('\n').filter(Boolean);
  const toArchive = [];
  const toKeep = [];

  lines.forEach(line => {
    try {
      const record = JSON.parse(line);
      const ts = record.timestamp ? new Date(record.timestamp).getTime() : undefined;
      if (ts && ts < threshold) {
        toArchive.push(record);
      } else {
        toKeep.push(record);
      }
    } catch (err) {
      toKeep.push(line);
    }
  });

  if (toArchive.length) {
    const archiveDir = ensureArchiveDir();
    const archivePath = path.join(archiveDir, `audit-${Date.now()}.log`);
    fs.writeFileSync(archivePath, toArchive.map(entry => JSON.stringify(entry)).join('\n') + '\n');
  }

  const keepContent = toKeep
    .map(entry => (typeof entry === 'string' ? entry : JSON.stringify(entry)))
    .join('\n');
  fs.writeFileSync(auditPath, keepContent ? `${keepContent}\n` : '');
}

function applyRetentionPolicies(config, datasets, persist) {
  const retention = config.retention || {};
  const now = Date.now();

  if (retention.leadsDays) {
    const threshold = now - retention.leadsDays * 24 * 60 * 60 * 1000;
    const { archived, kept } = partitionByRetention(datasets.leads, threshold, lead => lead.createdAt || lead.submittedAt);
    if (archived.length) {
      archiveJson('leads', archived);
      datasets.leads = kept;
      persist.leads(kept);
    }
  }

  pruneAuditLog(retention.auditLogDays);
}

function scheduleRetention(config, datasets, persist) {
  applyRetentionPolicies(config, datasets, persist);
  const intervalHours = Number(config.retention?.intervalHours || 24);
  const intervalMs = intervalHours * 60 * 60 * 1000;
  setInterval(() => applyRetentionPolicies(config, datasets, persist), intervalMs).unref();
}

module.exports = {
  applyRetentionPolicies,
  scheduleRetention
};
