/**
 * 本地开发：先构建一次前端，再同时启动 Bun 构建监听与 wrangler dev。
 * 任一进程退出时一并停止另一方，避免留下孤儿 workerd。
 */

const initial = Bun.spawnSync(
  ['bun', 'build', 'index.html', '--outdir', 'dist'],
  { stdio: ['inherit', 'inherit', 'inherit'] },
);

if (initial.exitCode !== 0) {
  process.exit(initial.exitCode ?? 1);
}

const build = Bun.spawn(
  [
    'bun',
    'build',
    'index.html',
    '--outdir',
    'dist',
    '--watch',
    '--no-clear-screen',
  ],
  { stdio: ['inherit', 'inherit', 'inherit'] },
);
const server = Bun.spawn(['bunx', 'wrangler', 'dev'], {
  stdio: ['inherit', 'inherit', 'inherit'],
});

let stopping = false;

const shutdown = (code: number) => {
  if (stopping) {
    return;
  }
  stopping = true;
  build.kill();
  server.kill();
  process.exit(code);
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const code = await Promise.race([build.exited, server.exited]);

shutdown(code);
