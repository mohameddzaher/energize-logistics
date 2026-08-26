// إعداد pm2 — نسختان في وضع العنقود.
//
// كانت نسخةً واحدة في fork_mode، فـ`pm2 restart` يقتلها قبل أن تقوم البديلة
// ويردّ nginx ٥٠٢ على كل طلبٍ في تلك الثواني. النسختان تتيحان `pm2 reload`
// المتدرّج: تُستبدَل واحدةٌ بينما الأخرى تخدم، فلا ينقطع شيء.
//
// والمهامّ المجدولة محصورةٌ في النسخة الأولى (انظر server.js): النبض لا يحتمل
// أن يسحب مرّتين ويرفع التنبيه مرّتين.
module.exports = {
  apps: [{
    name: 'energize-api',
    script: 'src/server.js',
    cwd: '/opt/energize/backend',
    instances: 2,
    exec_mode: 'cluster',
    // `listen` يعني أن pm2 لا يعدّ النسخة جاهزةً حتى تفتح منفذها فعلًا —
    // فلا يُطفأ القديم قبل أن يصير الجديد قادرًا على الاستقبال.
    wait_ready: false,
    listen_timeout: 20000,
    kill_timeout: 5000,
    max_memory_restart: '900M',
    env: { NODE_ENV: 'production' },
  }],
};
