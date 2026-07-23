const esbuild = require('esbuild');
const fs = require('node:fs');

async function main() {
	fs.rmSync('dist', { recursive: true, force: true });
	await Promise.all([
		esbuild.build({
			entryPoints: ['src/main.ts'],
			bundle: true,
			format: 'cjs',
			platform: 'node',
			target: 'node20',
			outfile: 'dist/main.js',
			banner: { js: '#!/usr/bin/env node' },
		}),
		esbuild.build({
			entryPoints: ['src/agent-tools-main.ts'],
			bundle: true,
			format: 'cjs',
			platform: 'node',
			target: 'node20',
			outfile: 'dist/agent-tools-main.js',
			banner: { js: '#!/usr/bin/env node' },
		}),
	]);
	fs.cpSync('src/prompts', 'dist/prompts', { recursive: true });
	fs.chmodSync('dist/main.js', 0o755);
	fs.chmodSync('dist/agent-tools-main.js', 0o755);
}

main().catch(error => {
	console.error(error);
	process.exit(1);
});
