const express = require('express');
const { createValidationMiddleware } = require('../../shared/validation/validateRequest');
const { createRateLimitMiddleware } = require('../../shared/middlewares/rateLimitMemory');
const { sendChatSchema } = require('./validation');
const chatController = require('./controller');

const router = express.Router();
const chatRateLimit = createRateLimitMiddleware({
  windowMs: 60 * 1000,
  max: 12,
  keyPrefix: 'ai-chat',
});

// POST /chat
router.post(
  '/',
  chatRateLimit,
  createValidationMiddleware({ body: sendChatSchema }),
  chatController.sendChat
);

module.exports = router;

