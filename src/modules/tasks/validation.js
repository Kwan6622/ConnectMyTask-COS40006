const { z } = require('zod');

const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  budget: z.number().positive(),
  maxBids: z.number().int().min(1).max(100).optional(),
  // Official ward code picked from the city's ward list (see /api/locations).
  wardId: z.number().int().positive(),
  // The address below is a findable place within 100 m; the real one is the requester's profile address.
  isApproximateLocation: z.boolean().optional(),
  // Private: unit / floor / block, or the exact address when the street address is a nearby spot.
  addressDetail: z.string().trim().max(100, 'Address details can be at most 100 characters').optional(),
  streetName: z.string().trim().min(3).max(200).optional(),
  siteAddress: z.string().trim().min(5).max(500),
  siteLatitude: z.number().finite().min(-90).max(90).optional(),
  siteLongitude: z.number().finite().min(-180).max(180).optional(),
  dueDate: z.string().optional(),
  deadline: z.string().optional(),
  aiSuggestedPrice: z.number().positive().optional(),
  imageUrls: z.array(z.string().url()).max(3, 'Max 3 images per task').optional(),
});

const listTasksQuerySchema = z.object({
  status: z.string().optional(),
  category: z.string().optional(),
});

const taskIdParamsSchema = z.object({
  id: z.string().regex(/^\d+$/),
});

const taskSubtaskParamsSchema = z.object({
  id: z.string().regex(/^\d+$/),
  subtaskId: z.string().regex(/^\d+$/),
});

const saveTaskParamsSchema = taskIdParamsSchema;

const updateTaskStatusSchema = z.object({
  status: z.enum([
    'PENDING',
    'OPEN',
    'BIDDING',
    'ASSIGNED',
    'IN_PROGRESS',
    'PENDING_CONFIRMATION',
    'COMPLETED',
    'AWAITING_PAYMENT',
    'PAID',
    'DISPUTED',
    'CANCELLED',
  ]),
});

const createTaskProgressUpdateSchema = z.object({
  progressPercent: z.number().int().min(0).max(100),
  note: z.string().min(1).max(2000),
  attachments: z.array(z.string().url()).max(10).optional(),
  milestoneStatus: z.string().max(120).optional(),
  markAsCompleted: z.boolean().optional(),
});

const updateTaskSubtaskStatusSchema = z.object({
  status: z.enum(['PENDING', 'IN_PROGRESS', 'DONE']),
});

const assignProviderSchema = z.object({
  bidId: z.number().int().positive(),
});

const createDisputeSchema = z.object({
  reason: z.enum([
    'PROVIDER_NOT_DELIVERING',
    'REQUESTER_NOT_CONFIRMING',
    'QUALITY_ISSUE',
    'PAYMENT_ISSUE',
    'OTHER',
  ]),
  description: z.string().min(1).max(2000),
  evidenceUrls: z.array(z.string().url()).max(10).optional(),
});

const cancelTaskSchema = z.object({
  reason: z.string().min(3).max(500),
});

const disputeIdParamsSchema = z.object({
  id: z.string().regex(/^\d+$/),
  disputeId: z.string().regex(/^\d+$/),
});

const adminReviewDisputeSchema = z.object({
  status: z.enum(['UNDER_REVIEW', 'RESOLVED', 'REJECTED', 'CLOSED']),
  resolution: z.string().max(2000).optional(),
  action: z.enum(['NONE', 'REFUND_ESCROW', 'RELEASE_ESCROW', 'FORCE_CANCEL']).optional(),
});

// Editing an EXPIRED task before reposting it; a new future deadline is required.
const repostTaskSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(5000).optional(),
  category: z.string().min(1).optional(),
  budget: z.number().positive().optional(),
  maxBids: z.number().int().min(1).max(100).optional(),
  dueDate: z.string().min(1),
  imageUrls: z.array(z.string().url()).max(3, 'Max 3 images per task').optional(),
}).strict();

const updateTaskSchema = z
  .object({
    // Keep this focused on image integration while allowing other task fields.
    imageUrls: z.array(z.string().url()).max(3, 'Max 3 images per task').optional(),
    dueDate: z.string().optional(),
    maxBids: z.number().int().min(1).max(100).optional(),
    wardId: z.number().int().positive().optional(),
    addressDetail: z.string().trim().max(100, 'Address details can be at most 100 characters').optional(),
    siteAddress: z.string().trim().min(5).max(500).optional(),
    siteLatitude: z.number().finite().min(-90).max(90).optional(),
    siteLongitude: z.number().finite().min(-180).max(180).optional(),
  })
  .passthrough();

module.exports = {
  createTaskSchema,
  listTasksQuerySchema,
  taskIdParamsSchema,
  saveTaskParamsSchema,
  updateTaskStatusSchema,
  createTaskProgressUpdateSchema,
  updateTaskSubtaskStatusSchema,
  assignProviderSchema,
  createDisputeSchema,
  cancelTaskSchema,
  disputeIdParamsSchema,
  adminReviewDisputeSchema,
  updateTaskSchema,
  repostTaskSchema,
  taskSubtaskParamsSchema,
};
