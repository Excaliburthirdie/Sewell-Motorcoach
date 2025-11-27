const { datasets } = require('./state');
const { matchesTenant } = require('./tenantService');
const { escapeOutputPayload } = require('./shared');

function timeline(leadId, tenantId) {
  const lead = datasets.leads.find(entry => entry.id === leadId && matchesTenant(entry.tenantId, tenantId));
  if (!lead) return { notFound: true };

  const scoreChanges = (lead.scoreHistory || []).map(entry => ({
    type: 'leadScore',
    occurredAt: entry.computedAt,
    payload: { score: entry.score, reasons: entry.reasons }
  }));

  const events = (datasets.events || [])
    .filter(event => matchesTenant(event.tenantId, tenantId))
    .filter(event => event.leadId === leadId)
    .map(event => ({ type: 'event', occurredAt: event.createdAt, payload: escapeOutputPayload(event) }));

  const tasks = (datasets.tasks || [])
    .filter(task => matchesTenant(task.tenantId, tenantId))
    .filter(task => task.contactId === leadId)
    .map(task => ({ type: 'task', occurredAt: task.updatedAt || task.createdAt, payload: escapeOutputPayload(task) }));

  const notifications = (datasets.notifications || [])
    .filter(notification => matchesTenant(notification.tenantId, tenantId))
    .filter(notification => notification.contactId === leadId)
    .map(notification => ({
      type: 'notification',
      occurredAt: notification.updatedAt || notification.createdAt,
      payload: escapeOutputPayload(notification)
    }));

  const items = [...scoreChanges, ...events, ...tasks, ...notifications].sort((a, b) => {
    const aTime = new Date(a.occurredAt || 0).getTime();
    const bTime = new Date(b.occurredAt || 0).getTime();
    return aTime - bTime;
  });

  return { lead: escapeOutputPayload(lead), timeline: items };
}

module.exports = { timeline };
