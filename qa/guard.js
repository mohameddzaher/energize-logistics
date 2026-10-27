/**
 * QA safety guard — the one rule: never touch the company's real data.
 *
 * Every QA script calls `assertLocal()` before it does anything. The QA
 * database is a throwaway mongod on 127.0.0.1:27099; anything else (Atlas,
 * another host, an unset URI that would fall back to backend/.env) stops the
 * script before it connects.
 */
const QA_URI = 'mongodb://127.0.0.1:27099/qa';
const QA_API = 'http://127.0.0.1:5055';
const QA_WEB = 'http://127.0.0.1:3055';

function assertLocal(uri = QA_URI) {
  const u = String(uri || '');
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):27099\//.test(u) || /mongodb\.net|\+srv/i.test(u)) {
    console.error(`QA GUARD: refusing to run against "${u.replace(/\/\/[^@]*@/, '//***@')}" — QA only ever uses ${QA_URI}`);
    process.exit(2);
  }
  return u;
}

module.exports = { QA_URI, QA_API, QA_WEB, assertLocal, PASSWORD: 'QaTest@12345' };
