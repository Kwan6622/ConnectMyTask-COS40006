const { z } = require('zod');

const coordinates = {
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().positive().max(10000),
  timestamp: z.union([z.string().datetime(), z.number().finite()]),
};
const trackingUpdateSchema = z.object({
  taskId: z.number().int().positive(),
  providerId: z.number().int().positive().optional(),
  ...coordinates,
}).strict();
const verificationSchema = z.object({
  requestId: z.string().trim().min(16).max(100).regex(/^[A-Za-z0-9_-]+$/),
  ...coordinates,
}).strict();
const taskIdParamsSchema = z.object({ taskId: z.string().regex(/^[1-9]\d*$/) });

module.exports = { trackingUpdateSchema, verificationSchema, taskIdParamsSchema };
