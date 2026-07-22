import { createHash } from 'node:crypto';

export function contentDigest(body: string): string {
	return createHash('sha256').update(body, 'utf8').digest('hex');
}
