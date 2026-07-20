// Testable CLI with deterministic provider output and inspectable request capture.
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
	const request = JSON.parse(input);
	const [command, operation] = process.argv.slice(2);
	if (command === 'annotations') {
		const companionPath = annotationCompanionPath(request);
		if (operation === 'read') {
			process.stdout.write(`${JSON.stringify(readCompanion(companionPath))}\n`);
			return;
		}
		if (operation === 'append') {
			const companion = readCompanion(companionPath);
			const annotation = {
				id: `integration-annotation-${companion.annotations.length + 1}`,
				message: request.annotation.message,
				preset: request.annotation.preset,
				scope: request.annotation.scope,
				anchor: {
					line: request.document.line,
					text: request.document.text,
					before: request.document.before,
					after: request.document.after,
				},
			};
			companion.annotations.push(annotation);
			fs.mkdirSync(path.dirname(companionPath), { recursive: true });
			fs.writeFileSync(companionPath, renderCompanion(companion));
			process.stdout.write(`${JSON.stringify(annotation)}\n`);
			return;
		}
		if (operation === 'delete') {
			const companion = readCompanion(companionPath);
			const index = companion.annotations.findIndex(annotation => annotation.id === request.annotation.id);
			if (index < 0) {
				process.stderr.write(`Annotation not found: ${request.annotation.id}\n`);
				process.exitCode = 1;
				return;
			}
			const [deleted] = companion.annotations.splice(index, 1);
			fs.writeFileSync(companionPath, renderCompanion(companion));
			process.stdout.write(`${JSON.stringify(deleted)}\n`);
			return;
		}
		process.exitCode = 2;
		return;
	}

	fs.writeFileSync(path.join(process.cwd(), 'received-request.json'), JSON.stringify(request));
	process.stdout.write(`${JSON.stringify({ kind: 'status', status: 'working', message: 'Test Codex behavior is working.' })}\n`);
	setTimeout(() => {
		process.stdout.write(`${JSON.stringify({ kind: 'output', text: 'Applied the requested ' })}\n`);
		process.stdout.write(`${JSON.stringify({ kind: 'output', text: '**test patch**.\n\n- Done' })}\n`);
		process.stdout.write(`${JSON.stringify({ kind: 'status', status: 'waiting' })}\n`);
	}, 400);
});

function annotationCompanionPath(request) {
	const relative = path.relative(request.workspace.cwd, fileURLToPath(request.document.uri));
	return path.join(request.workspace.cwd, '.sundial', `${relative}.comments`);
}

function readCompanion(companionPath) {
	if (!fs.existsSync(companionPath)) {
		return { version: 1, annotations: [] };
	}
	const lines = fs.readFileSync(companionPath, 'utf8').trimEnd().split('\n');
	const annotations = [];
	let index = 2;
	while (index < lines.length) {
		const hasContext = lines[index + 7]?.startsWith('      before: ');
		annotations.push({
			id: JSON.parse(lines[index].slice('  - id: '.length)),
			message: JSON.parse(lines[index + 1].slice('    message: '.length)),
			preset: JSON.parse(lines[index + 2].slice('    preset: '.length)),
			scope: JSON.parse(lines[index + 3].slice('    scope: '.length)),
			anchor: {
				line: Number(lines[index + 5].slice('      line: '.length)),
				text: JSON.parse(lines[index + 6].slice('      text: '.length)),
				before: hasContext ? JSON.parse(lines[index + 7].slice('      before: '.length)) : [],
				after: hasContext ? JSON.parse(lines[index + 8].slice('      after: '.length)) : [],
			},
		});
		index += hasContext ? 9 : 7;
	}
	return { version: 1, annotations };
}

function renderCompanion(companion) {
	return [
		'version: 1',
		'annotations:',
		...companion.annotations.flatMap(annotation => [
			`  - id: ${JSON.stringify(annotation.id)}`,
			`    message: ${JSON.stringify(annotation.message)}`,
			`    preset: ${JSON.stringify(annotation.preset)}`,
			`    scope: ${JSON.stringify(annotation.scope)}`,
			'    anchor:',
			`      line: ${annotation.anchor.line}`,
			`      text: ${JSON.stringify(annotation.anchor.text)}`,
			`      before: ${JSON.stringify(annotation.anchor.before)}`,
			`      after: ${JSON.stringify(annotation.anchor.after)}`,
		]),
		'',
	].join('\n');
}
