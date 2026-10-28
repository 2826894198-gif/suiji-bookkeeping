const cloud = require('wx-server-sdk');
const { createService } = require('./service');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database(), collection = 'pearl_cloud_v1';
function bind(database) {
  return {
    async read(id) {
      try {
        const result = await database.collection(collection).doc(id).get();
        const data = Array.isArray(result.data) ? result.data[0] : result.data;
        if (!data) return null;
        const { _id, ...row } = data; return row;
      } catch (error) {
        if (/DOCUMENT_NOT_EXIST|document[^\n]*(?:not exist|does not exist|doesn't exist)/i.test(error.errMsg || error.message || '')) return null;
        throw error;
      }
    },
    async write(id, data) { await database.collection(collection).doc(id).set({ data }); },
    async remove(id) { await database.collection(collection).doc(id).remove(); }
  };
}
const repo = { ...bind(db), async transaction(run) {
  const result = await db.runTransaction(tx => run(bind(tx)));
  return result && Object.prototype.hasOwnProperty.call(result, 'result') ? result.result : result;
} };
const service = createService(repo);
exports.main = async event => {
  try { return { ok: true, ...await service.handle(event, cloud.getWXContext()) }; }
  catch (error) {
    const known = ['UNAUTHORIZED','UPDATE_REQUIRED','INVALID_REQUEST','NOT_FOUND','CORRUPT_BACKUP','REQUEST_REUSED','CONFLICT','INCOMPLETE_UPLOAD','INVALID_LEDGER','DEMO_BOOK'].includes(error.code);
    if (!known) console.error('ledgerSync backend error', { code: String(error.errCode || error.code || 'UNKNOWN') });
    return { ok: false, code: known ? error.code : 'CLOUD_ERROR', message: known ? error.message : '云服务暂时不可用，本机账目未改变，请稍后重试' };
  }
};
