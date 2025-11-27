const assert = require('node:assert/strict');
const { describe, it, beforeEach, afterEach, mock } = require('node:test');

const { datasets, persist } = require('../src/services/state');
const taskService = require('../src/services/taskService');
const notificationService = require('../src/services/notificationService');
const leadEngagementService = require('../src/services/leadEngagementService');

describe('tasks, notifications, and lead timeline', () => {
  let persistMocks;

  beforeEach(() => {
    persistMocks = [
      mock.method(persist, 'tasks', () => {}),
      mock.method(persist, 'notifications', () => {}),
      mock.method(persist, 'events', () => {}),
      mock.method(persist, 'leads', () => {})
    ];
    datasets.tasks = [];
    datasets.notifications = [];
    datasets.events = [];
    datasets.leads = [{ id: 'lead-1', name: 'Buyer', tenantId: 'main', createdAt: '2023-01-01T00:00:00.000Z' }];
  });

  afterEach(() => {
    persistMocks.forEach(m => m.mock.restore());
  });

  it('supports creating, updating, and filtering tasks', () => {
    const created = taskService.create({ title: 'Follow up', contactId: 'lead-1', dueAt: '2023-02-01' }, 'main');
    assert.ok(created.task.id);
    assert.equal(created.task.status, 'open');

    const updated = taskService.update(created.task.id, { status: 'completed', notes: 'Called customer' }, 'main');
    assert.equal(updated.task.status, 'completed');
    assert.equal(updated.task.notes, 'Called customer');

    const filtered = taskService.list({ status: 'completed', contactId: 'lead-1' }, 'main');
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].contactId, 'lead-1');
  });

  it('updates notification statuses and filters by contact', () => {
    const created = notificationService.create({ type: 'price-drop', message: 'Price lowered', contactId: 'lead-1' }, 'main');
    assert.equal(created.notification.status, 'pending');

    const updated = notificationService.updateStatus(created.notification.id, 'sent', 'main');
    assert.equal(updated.notification.status, 'sent');

    const list = notificationService.list({ status: 'sent', contactId: 'lead-1' }, 'main');
    assert.equal(list.length, 1);
  });

  it('builds a chronological timeline combining events, tasks, and notifications', () => {
    datasets.events.push({
      id: 'e1',
      type: 'view',
      leadId: 'lead-1',
      tenantId: 'main',
      createdAt: '2023-03-01T10:00:00.000Z'
    });
    const { task } = taskService.create({
      title: 'Send quote',
      contactId: 'lead-1',
      dueAt: '2023-03-02T00:00:00.000Z'
    }, 'main');
    notificationService.create(
      { type: 'alert', message: 'Hot lead detected', contactId: 'lead-1', status: 'sent' },
      'main'
    );

    // adjust timestamps for deterministic ordering
    datasets.tasks[0].updatedAt = '2023-03-01T12:00:00.000Z';
    datasets.notifications[0].updatedAt = '2023-03-01T14:00:00.000Z';

    const result = leadEngagementService.timeline('lead-1', 'main');
    assert.equal(result.timeline.length, 3);
    assert.deepEqual(result.timeline.map(entry => entry.type), ['event', 'task', 'notification']);

    const missing = leadEngagementService.timeline('lead-unknown', 'main');
    assert.equal(missing.notFound, true);
  });

  it('surfaces lead score history in the timeline', () => {
    datasets.leads[0].scoreHistory = [
      { score: 22, reasons: ['repeat interest'], computedAt: '2023-02-01T00:00:00.000Z' }
    ];
    const timeline = leadEngagementService.timeline('lead-1', 'main');
    assert.equal(timeline.timeline[0].type, 'leadScore');
    assert.equal(timeline.timeline[0].payload.score, 22);
  });
});
