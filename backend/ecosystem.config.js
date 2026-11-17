// PM2: two instances in cluster mode, so `pm2 reload` replaces one while the other serves (fork mode with one
// instance made `pm2 restart` drop requests and nginx returned 502). Scheduled jobs run on the first instance only
// (see server.js): polling and alerts must not run twice.
module.exports = {
  apps: [{
    name: 'energize-api',
    script: 'src/server.js',
    cwd: '/opt/energize/backend',
    instances: 2,
    exec_mode: 'cluster',
    // pm2 counts an instance ready only once it opens its port, so the old one is not stopped before the new one can serve.
    wait_ready: true,
    listen_timeout: 20000,
    kill_timeout: 5000,
    // Memory: the heap limit is told to node, not only to pm2. With only max_memory_restart, node sized its heap from
    // the machine's RAM, collected garbage late and pm2 killed instance 1 (the one with the scheduled jobs) every few
    // minutes with no error in the log. Two instances x 2 GB = 4 of the server's 8 GB; the restart ceiling sits above
    // the heap with room for buffers and connections, as a safety net for a real leak, not a daily mechanism.
    node_args: '--max-old-space-size=1536',
    max_memory_restart: '2048M',
    env: { NODE_ENV: 'production' },
  }],
};
