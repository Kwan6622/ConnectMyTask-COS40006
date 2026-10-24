const trackingService = require('./service');

async function trackingUpdate(req, res, next) {
  try { res.status(201).json(await trackingService.recordLocationUpdate(req.body, req.user)); } catch (err) { next(err); }
}
async function verify(req, res, next) {
  try { res.status(201).json(await trackingService.verifyTaskLocation(Number(req.params.taskId), req.body, req.user)); } catch (err) { next(err); }
}
async function verification(req, res, next) {
  try { res.json(await trackingService.getVerificationStatus(Number(req.params.taskId), req.user)); } catch (err) { next(err); }
}
async function siteLocation(req, res, next) {
  try { res.json(await trackingService.getTaskSiteLocation(Number(req.params.taskId), req.user)); } catch (err) { next(err); }
}

module.exports = {
  trackingUpdate,
  verify,
  verification,
  siteLocation,
  latest: async (req, res, next) => {
    try { res.json(await trackingService.getLatestLocation(req.params.taskId, req.user)); } catch (err) { next(err); }
  },
  history: async (req, res, next) => {
    try { res.json(await trackingService.getLocationHistory(req.params.taskId, req.user)); } catch (err) { next(err); }
  },
};
