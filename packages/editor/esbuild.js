const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const codiconSrc = path.dirname(require.resolve('@vscode/codicons/package.json'));
const mediaDir = path.join(__dirname, 'media');

function copyCodicons() {
	fs.mkdirSync(mediaDir, { recursive: true });
	for (const file of ['codicon.css', 'codicon.ttf']) {
		fs.copyFileSync(path.join(codiconSrc, 'dist', file), path.join(mediaDir, file));
	}
}

async function main() {
	copyCodicons();

	const hostCtx = await esbuild.context({
		entryPoints: ['src/extension.ts'],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		target: 'node20',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'info',
	});

	const webviewCtx = await esbuild.context({
		entryPoints: { messages: 'src/webviews/apps/messages/index.ts' },
		bundle: true,
		format: 'esm',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'browser',
		target: 'es2022',
		tsconfig: 'tsconfig.webview.json',
		outdir: 'dist/webviews',
		logLevel: 'info',
	});

	if (watch) {
		await Promise.all([hostCtx.watch(), webviewCtx.watch()]);
		return;
	}

	await Promise.all([hostCtx.rebuild(), webviewCtx.rebuild()]);
	await Promise.all([hostCtx.dispose(), webviewCtx.dispose()]);
}

main().catch(error => {
	console.error(error);
	process.exit(1);
});
