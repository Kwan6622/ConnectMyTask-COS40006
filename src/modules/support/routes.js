const express = require('express');
const { z } = require('zod');
const { prisma } = require('../../database/prisma');
const { authenticate, requireRoles } = require('../../shared/middlewares/auth');
const { createValidationMiddleware: validate } = require('../../shared/validation/validateRequest');
const { createRateLimitMiddleware } = require('../../shared/middlewares/rateLimitMemory');

const router = express.Router();
const categories = ['TASK', 'BIDDING', 'PAYMENT', 'ACCOUNT', 'TECHNICAL', 'OTHER'];
const statuses = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const priorities = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const idParams = z.object({ id: z.coerce.number().int().positive() });
const evidence = z.array(z.string().url().refine((value) => {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'res.cloudinary.com'; }
  catch { return false; }
}, 'Use a Cloudinary evidence URL')).max(5).optional();
const pageQuery = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) });
const listQuery = pageQuery.extend({
  status: z.enum(statuses).optional(), category: z.enum(categories).optional(), priority: z.enum(priorities).optional(),
  search: z.string().trim().max(100).optional(),
});
const createBody = z.object({
  category: z.enum(categories), subject: z.string().trim().min(3).max(160),
  description: z.string().trim().min(10).max(10000),
  taskId: z.number().int().positive().optional(), paymentId: z.number().int().positive().optional(),
  evidenceUrls: evidence,
}).strict();
const messageBody = z.object({ body: z.string().trim().min(1).max(10000), evidenceUrls: evidence }).strict();
const updateBody = z.object({ status: z.enum(statuses).optional(), priority: z.enum(priorities).optional() })
  .strict().refine((value) => value.status || value.priority, 'Provide status or priority');
const writeLimit = createRateLimitMiddleware({ windowMs: 60_000, max: 10, keyPrefix: 'support-write' });
const isAdmin = (user) => String(user.role).toUpperCase() === 'ADMIN';
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const ticketSelect = {
  id: true, category: true, subject: true, description: true, status: true, priority: true,
  evidenceUrls: true, createdAt: true, updatedAt: true, resolvedAt: true, closedAt: true,
  requesterId: true, taskId: true, paymentId: true,
  requester: { select: { id: true, name: true, role: true } },
  task: { select: { id: true, title: true } },
};

async function notify(data) {
  try { await prisma.notification.create({ data }); }
  catch (err) { console.error('Support notification failed:', err.message); }
}
async function notifyAdmins(senderId, ticketId, event) {
  const admins = await prisma.user.findMany({ where: { role: { equals: 'ADMIN', mode: 'insensitive' } }, select: { id: true } });
  await Promise.all(admins.filter((admin) => admin.id !== senderId).map((admin) =>
    notify({ recipientId: admin.id, senderId, message: `Support ticket #${ticketId}: ${event}` })));
}
async function accessibleTicket(id, user) {
  const ticket = await prisma.supportTicket.findFirst({
    where: { id, ...(isAdmin(user) ? {} : { requesterId: user.id }) }, select: ticketSelect,
  });
  if (!ticket) throw fail(404, 'Ticket not found');
  return ticket;
}

router.use(authenticate);
router.get('/tickets', validate({ query: listQuery }), wrap(async (req, res) => {
  // Express 5 exposes req.query as a getter, so validation middleware cannot
  // replace it with Zod's parsed defaults. Use the parsed values explicitly.
  const { page, limit, search, ...filters } = listQuery.parse(req.query);
  const where = { ...filters, ...(isAdmin(req.user) ? {} : { requesterId: req.user.id }),
    ...(search ? { OR: [
      { subject: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ] } : {}) };
  const [items, total] = await prisma.$transaction([
    prisma.supportTicket.findMany({ where, select: ticketSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit }),
    prisma.supportTicket.count({ where }),
  ]);
  res.json({ items, total, page, limit });
}));

router.post('/tickets', requireRoles('REQUESTER', 'CLIENT', 'PROVIDER'), writeLimit, validate({ body: createBody }), wrap(async (req, res) => {
  const { taskId, paymentId, ...body } = req.body;
  let payment;
  if (paymentId) {
    payment = await prisma.paymentTransaction.findFirst({ where: { id: paymentId, OR: [{ payerId: req.user.id }, { providerId: req.user.id }] }, select: { id: true, taskId: true } });
    if (!payment) throw fail(404, 'Related payment not found');
    if (taskId && payment.taskId !== taskId) throw fail(400, 'Payment does not belong to the selected task');
  }
  const linkedTaskId = taskId || payment?.taskId;
  if (linkedTaskId && !payment) {
    const task = await prisma.task.findFirst({ where: { id: linkedTaskId, isDeleted: false }, select: { createdById: true, assignedProviderId: true } });
    const bid = task && task.createdById !== req.user.id && task.assignedProviderId !== req.user.id
      ? await prisma.bid.findFirst({ where: { taskId: linkedTaskId, providerId: req.user.id }, select: { id: true } }) : null;
    if (!task || (task.createdById !== req.user.id && task.assignedProviderId !== req.user.id && !bid)) throw fail(404, 'Related task not found');
  }
  const ticket = await prisma.$transaction(async (tx) => {
    const created = await tx.supportTicket.create({ data: { ...body, requesterId: req.user.id, taskId: linkedTaskId, paymentId }, select: ticketSelect });
    await tx.supportActivity.create({ data: { ticketId: created.id, actorId: req.user.id, action: 'CREATED', toValue: 'OPEN' } });
    return created;
  });
  void notifyAdmins(req.user.id, ticket.id, 'new ticket').catch((err) => console.error('Support notification failed:', err.message));
  res.status(201).json(ticket);
}));

router.get('/tickets/:id', validate({ params: idParams }), wrap(async (req, res) => {
  res.json(await accessibleTicket(req.params.id, req.user));
}));

router.get('/tickets/:id/messages', validate({ params: idParams, query: pageQuery }), wrap(async (req, res) => {
  await accessibleTicket(req.params.id, req.user);
  const { page, limit } = pageQuery.parse(req.query);
  const where = { ticketId: req.params.id };
  const [items, total] = await prisma.$transaction([
    prisma.supportMessage.findMany({ where, include: { sender: { select: { id: true, name: true, role: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit }),
    prisma.supportMessage.count({ where }),
  ]);
  res.json({ items, total, page, limit });
}));

router.get('/tickets/:id/activity', validate({ params: idParams, query: pageQuery }), wrap(async (req, res) => {
  await accessibleTicket(req.params.id, req.user);
  const { page, limit } = pageQuery.parse(req.query);
  const where = { ticketId: req.params.id };
  const [items, total] = await prisma.$transaction([
    prisma.supportActivity.findMany({ where, include: { actor: { select: { id: true, name: true, role: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit }),
    prisma.supportActivity.count({ where }),
  ]);
  res.json({ items, total, page, limit });
}));

router.post('/tickets/:id/messages', writeLimit, validate({ params: idParams, body: messageBody }), wrap(async (req, res) => {
  const ticket = await accessibleTicket(req.params.id, req.user);
  const message = await prisma.$transaction(async (tx) => {
    // Conditional update serializes replies with closing; a closed ticket never gains a new reply.
    const changed = await tx.supportTicket.updateMany({ where: { id: ticket.id, status: { not: 'CLOSED' } }, data: { updatedAt: new Date() } });
    if (!changed.count) throw fail(409, 'Ticket is closed');
    const created = await tx.supportMessage.create({ data: { ticketId: ticket.id, senderId: req.user.id, ...req.body }, include: { sender: { select: { id: true, name: true, role: true } } } });
    await tx.supportActivity.create({ data: { ticketId: ticket.id, actorId: req.user.id, action: 'REPLIED' } });
    return created;
  });
  if (isAdmin(req.user)) void notify({ recipientId: ticket.requesterId, senderId: req.user.id, message: `Support replied to ticket #${ticket.id}` });
  else void notifyAdmins(req.user.id, ticket.id, 'new reply').catch((err) => console.error('Support notification failed:', err.message));
  res.status(201).json(message);
}));

router.patch('/tickets/:id', requireRoles('ADMIN'), validate({ params: idParams, body: updateBody }), wrap(async (req, res) => {
  const ticket = await accessibleTicket(req.params.id, req.user);
  const updated = await prisma.$transaction(async (tx) => {
    const data = { ...req.body };
    if (req.body.status && req.body.status !== ticket.status) {
      data.resolvedAt = req.body.status === 'RESOLVED' ? new Date() : null;
      data.closedAt = req.body.status === 'CLOSED' ? new Date() : null;
    }
    const result = await tx.supportTicket.updateMany({ where: { id: ticket.id, updatedAt: ticket.updatedAt }, data });
    if (!result.count) throw fail(409, 'Ticket changed; refresh and try again');
    for (const [key, value] of Object.entries(req.body)) {
      if (value !== ticket[key]) await tx.supportActivity.create({ data: { ticketId: ticket.id, actorId: req.user.id, action: key === 'status' ? 'STATUS_CHANGED' : 'PRIORITY_CHANGED', fromValue: ticket[key], toValue: value } });
    }
    return tx.supportTicket.findUnique({ where: { id: ticket.id }, select: ticketSelect });
  });
  if (updated.status !== ticket.status) void notify({ recipientId: ticket.requesterId, senderId: req.user.id, message: `Support ticket #${ticket.id} status changed to ${updated.status.replace('_', ' ')}` });
  res.json(updated);
}));

router.use((err, req, res, next) => {
  if (err.code === 'P2021' || err.code === 'P2022') {
    return res.status(503).json({ error: 'SupportSetupPending', message: 'Customer support database setup is pending.' });
  }
  return next(err);
});

module.exports = router;
