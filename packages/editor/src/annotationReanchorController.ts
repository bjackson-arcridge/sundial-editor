import { contentDigest } from '@arcridge/sundial-editor-annotations/digest';
import type { AnnotationCompanion, AnnotationReanchorResult } from './annotationProtocol';

export interface SavedAnnotationSource {
	readonly cwd: string;
	readonly sourceUri: string;
	readonly text: string;
}

export interface AnnotationReanchorServices {
	readonly readAnnotations: (source: SavedAnnotationSource) => Promise<AnnotationCompanion>;
	readonly reanchor: (
		source: SavedAnnotationSource,
		previousSource: string,
		expectedPreviousSourceDigest: string,
	) => Promise<AnnotationReanchorResult>;
	readonly onApplied: (source: SavedAnnotationSource, result: AnnotationReanchorResult) => void | Promise<void>;
	readonly reportError: (message: string) => void;
	readonly now?: () => number;
	readonly setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
	readonly clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
	readonly ttlMs?: number;
}

interface TrackedSource {
	baseline?: string;
	lastAttemptAt?: number;
	running: boolean;
	pending?: SavedAnnotationSource;
	timer?: ReturnType<typeof setTimeout>;
}

export class AnnotationReanchorController {
	private readonly tracked = new Map<string, TrackedSource>();
	private readonly now: () => number;
	private readonly setTimer: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
	private readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
	private readonly ttlMs: number;

	constructor(private readonly services: AnnotationReanchorServices) {
		this.now = services.now ?? Date.now;
		this.setTimer = services.setTimer ?? setTimeout;
		this.clearTimer = services.clearTimer ?? clearTimeout;
		this.ttlMs = services.ttlMs ?? 30_000;
	}

	observeSaved(source: SavedAnnotationSource): void {
		const key = sourceKey(source);
		const state = this.tracked.get(key) ?? { running: false };
		this.tracked.set(key, state);
		state.pending = source;
		this.schedule(key, state);
	}

	dispose(): void {
		for (const state of this.tracked.values()) {
			if (state.timer !== undefined) { this.clearTimer(state.timer); }
		}
		this.tracked.clear();
	}

	private schedule(key: string, state: TrackedSource): void {
		if (state.running || state.pending === undefined) { return; }
		const wait = state.lastAttemptAt === undefined ? 0 : Math.max(0, state.lastAttemptAt + this.ttlMs - this.now());
		if (wait > 0) {
			if (state.timer !== undefined) { this.clearTimer(state.timer); }
			state.timer = this.setTimer(() => {
				state.timer = undefined;
				this.schedule(key, state);
			}, wait);
			return;
		}
		const source = state.pending;
		state.pending = undefined;
		state.running = true;
		void this.process(state, source).finally(() => {
			state.running = false;
			this.schedule(key, state);
		});
	}

	private async process(state: TrackedSource, source: SavedAnnotationSource): Promise<void> {
		try {
			if (state.baseline === undefined) {
				const companion = await this.services.readAnnotations(source);
				if (companion.sourceDigest === sourceDigest(source.text)) {
					state.baseline = source.text;
					return;
				}
				state.lastAttemptAt = this.now();
				const adopted = await this.services.reanchor(source, source.text, sourceDigest(source.text));
				state.baseline = source.text;
				await this.services.onApplied(source, adopted);
				return;
			}
			if (state.baseline === source.text) { return; }
			const previous = state.baseline;
			state.lastAttemptAt = this.now();
			const result = await this.services.reanchor(source, previous, sourceDigest(previous));
			state.baseline = source.text;
			await this.services.onApplied(source, result);
		} catch (error) {
			this.services.reportError(error instanceof Error ? error.message : String(error));
		}
	}
}

export const sourceDigest = contentDigest;

function sourceKey(source: Pick<SavedAnnotationSource, 'cwd' | 'sourceUri'>): string {
	return `${source.cwd}\0${source.sourceUri}`;
}
