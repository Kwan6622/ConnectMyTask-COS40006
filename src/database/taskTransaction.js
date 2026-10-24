const { AsyncLocalStorage } = require('node:async_hooks');
const { prisma: root } = require('./prisma');
const context = new AsyncLocalStorage();

// Existing repositories share one transaction during a task/payment mutation.
const prisma = new Proxy(root, {
  get(target, key) {
    const tx = context.getStore()?.tx;
    if (tx && key === '$transaction') return async work => typeof work === 'function' ? work(tx) : Promise.all(work);
    const client = tx || target;
    const value = client[key];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

async function withTaskLock(taskId, action) {
  if (!Number.isSafeInteger(taskId) || taskId <= 0) throw Object.assign(new Error('Invalid task ID'), { statusCode: 400 });
  const active = context.getStore();
  if (active) {
    if (active.taskId !== taskId) throw new Error('Cross-task mutation inside settlement');
    return action();
  }
  return root.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "TASKS" WHERE id = ${taskId} FOR UPDATE`;
    return context.run({ tx, taskId }, action);
  }, { timeout: 30000, maxWait: 10000 });
}

module.exports = { prisma, withTaskLock, inTaskTransaction: () => Boolean(context.getStore()) };
