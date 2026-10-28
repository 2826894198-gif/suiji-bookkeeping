// Public source template: local bookkeeping works without a cloud account.
// Replace envId only in your private working copy after configuring your own environment.
const envId = 'YOUR_CLOUD_ENV_ID';
module.exports = { envId: /^YOUR_/.test(envId) ? '' : envId, functionName: 'pearlLedgerSync', protocol: 1 };
