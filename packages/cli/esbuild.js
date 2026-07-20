const esbuild = require('esbuild');
const fs = require('node:fs');

async function main() {
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
			entryPoints: ['src/annotations-main.ts'],
			bundle: true,
			format: 'cjs',
			platform: 'node',
			target: 'node20',
			outfile: 'dist/annotations-main.js',
			banner: { js: '#!/usr/bin/env node' },
		}),
	]);
	fs.rmSync('dist/prompts', { recursive: true, force: true });
	fs.cpSync('src/prompts', 'dist/prompts', { recursive: true });
	fs.chmodSync('dist/main.js', 0o755);
	fs.chmodSync('dist/annotations-main.js', 0o755);
}

main().catch(error => {
	console.error(error);
	process.exit(1);
});
