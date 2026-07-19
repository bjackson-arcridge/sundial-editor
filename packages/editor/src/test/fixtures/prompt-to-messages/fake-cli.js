const fs = require('node:fs');
const path = require('node:path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
	const request = JSON.parse(input);
	fs.writeFileSync(path.join(process.cwd(), 'received-request.json'), JSON.stringify(request));
	process.stdout.write(`${JSON.stringify({ kind: 'status', status: 'working', message: 'Fake Codex is working.' })}\n`);
	setTimeout(() => {
		process.stdout.write(`${JSON.stringify({ kind: 'output', text: 'Applied the requested ' })}\n`);
		process.stdout.write(`${JSON.stringify({ kind: 'output', text: '**fake patch**.\n\n- Done' })}\n`);
		process.stdout.write(`${JSON.stringify({ kind: 'status', status: 'waiting' })}\n`);
	}, 40);
});
