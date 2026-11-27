const { z } = require('zod');

const coordinates = {
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  timestamp: z.union([z.string().datetime(), z.number().finite()]),
};
const trackingUpdateSchema = z.object({
  taskId: z.number().int().positive(),
  providerId: z.number().int().positive().optional(),
  source: z.enum(['GPS', 'DEMO']).default('GPS'),
  ...coordinates,
  accuracy: z.number().finite().positive().max(100),
}).strict();
const verificationSchema = z.object({
  requestId: z.string().trim().min(16).max(100).regex(/^[A-Za-z0-9_-]+$/),
  ...coordinates,
  accuracy: z.number().finite().positive().max(20),
}).strict();
const taskIdParamsSchema = z.object({ taskId: z.string().regex(/^[1-9]\d*$/) });

module.exports = { trackingUpdateSchema, verificationSchema, taskIdParamsSchema };
