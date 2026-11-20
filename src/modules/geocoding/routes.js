const express = require('express');
const { authenticate, requireRoles } = require('../../shared/middlewares/auth');
const { verifyAddress } = require('./service');

const router = express.Router();

router.post('/verify-address', authenticate, requireRoles('REQUESTER', 'CLIENT'), async (req, res, next) => {
  try {
    const result = await verifyAddress({
      district: req.body?.district,
      streetName: req.body?.streetName,
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
