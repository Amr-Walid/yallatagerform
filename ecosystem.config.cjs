/**
 * PM2 process configuration for the Yalla Tager server.
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 logs yallatager --nostream
 *   pm2 restart yallatager
 */
module.exports = {
  apps: [
    {
      name: 'yallatager',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'development'
      },
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      time: true
    }
  ]
};
