const express = require('express');
const { createValidationMiddleware } = require('../../shared/validation/validateRequest');
const { trackingUpdateSchema, verificationSchema, taskIdParamsSchema } = require('./validation');
const trackingController = require('./controller');

const router = express.Router();
const { authenticate } = require('../../shared/middlewares/auth');
router.use(authenticate);
router.get('/tasks/:taskId/site-location', createValidationMiddleware({ params: taskIdParamsSchema }), trackingController.siteLocation);
router.get('/tasks/:taskId/latest', createValidationMiddleware({ params: taskIdParamsSchema }), trackingController.latest);
router.get('/tasks/:taskId/history', createValidationMiddleware({ params: taskIdParamsSchema }), trackingController.history);
router.get('/tasks/:taskId/verification', createValidationMiddleware({ params: taskIdParamsSchema }), trackingController.verification);
router.post(
  '/tasks/:taskId/verify',
  createValidationMiddleware({ params: taskIdParamsSchema, body: verificationSchema }),
  trackingController.verify
);

// POST /tracking/update
router.post(
  '/update',
  createValidationMiddleware({ body: trackingUpdateSchema }),
  trackingController.trackingUpdate
);

module.exports = router;
