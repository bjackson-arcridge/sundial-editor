const esbuild = require('esbuild');
const fs = require('node:fs');

async function main() {
	await esbuild.build({
		entryPoints: ['src/main.ts'],
		bundle: true,
		format: 'cjs',
		platform: 'node',
		target: 'node20',
		outfile: 'dist/main.js',
		banner: { js: '#!/usr/bin/env node' },
	});
	fs.chmodSync('dist/main.js', 0o755);
}

main().catch(error => {
	console.error(error);
	process.exit(1);
});
