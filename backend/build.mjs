import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/app.ts'],
  bundle: true,
  platform: 'node',
  target: 'es2022',
  outfile: 'dist/server.js',
  format: 'esm',
  // CJS packages (dotenv, compression, safe-buffer, etc.) use require() for Node
  // built-ins internally. When bundled to ESM, those calls break because ESM has
  // no native require(). This banner injects a require() shim so they work.
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
  external: [
    'express',
    'pg',
    'bcrypt',
    'jsonwebtoken',
    'minio',
    'multer',
    'sanitize-html',
    'vite',
    'dotenv',
  ],
});
