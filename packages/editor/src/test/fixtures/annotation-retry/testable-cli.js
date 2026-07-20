// Testable CLI providing deterministic delivery and one-shot persistence failure controls.
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
	const request = JSON.parse(input);
	const [command, operation] = process.argv.slice(2);
	const companionPath = path.join(
		request.workspace.cwd,
		'.sundial',
		`${path.relative(request.workspace.cwd, fileURLToPath(request.document.uri))}.comments`,
	);
	if (command === 'annotations' && operation === 'read') {
		const annotations = fs.existsSync(companionPath)
			? [{
				id: 'retry-annotation', message: 'Persist this once.', preset: '%F', scope: 'line',
				anchor: { line: 0, text: 'keep this line', before: [], after: [] },
			}]
			: [];
		process.stdout.write(`${JSON.stringify({ version: 1, annotations })}\n`);
		return;
	}
	if (command === 'annotations' && operation === 'append') {
		const failureMarker = path.join(process.cwd(), 'fail-annotation-once');
		if (fs.existsSync(failureMarker)) {
			fs.unlinkSync(failureMarker);
			process.stderr.write('simulated annotation write failure\n');
			process.exitCode = 1;
			return;
		}
		const annotation = {
			id: 'retry-annotation', message: request.annotation.message, preset: request.annotation.preset,
			scope: request.annotation.scope,
			anchor: {
				line: request.document.line,
				text: request.document.text,
				before: request.document.before,
				after: request.document.after,
			},
		};
		fs.mkdirSync(path.dirname(companionPath), { recursive: true });
		fs.writeFileSync(companionPath, [
			'version: 1', 'annotations:', `  - id: ${JSON.stringify(annotation.id)}`,
			`    message: ${JSON.stringify(annotation.message)}`, `    preset: ${JSON.stringify(annotation.preset)}`,
			`    scope: ${JSON.stringify(annotation.scope)}`, '    anchor:',
			`      line: ${annotation.anchor.line}`, `      text: ${JSON.stringify(annotation.anchor.text)}`,
			`      before: ${JSON.stringify(annotation.anchor.before)}`,
			`      after: ${JSON.stringify(annotation.anchor.after)}`,
			'',
		].join('\n'));
		process.stdout.write(`${JSON.stringify(annotation)}\n`);
		return;
	}

	const countPath = path.join(process.cwd(), 'delivery-count.txt');
	const count = fs.existsSync(countPath) ? Number(fs.readFileSync(countPath, 'utf8')) : 0;
	fs.writeFileSync(countPath, String(count + 1));
	process.stdout.write(`${JSON.stringify({ kind: 'status', status: 'waiting' })}\n`);
});
