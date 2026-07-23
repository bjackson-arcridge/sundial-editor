import type {
	AgentId,
	NamedAgent,
	UserAnnotationWorkItem,
} from './agentProtocol';
import type {
	Annotation,
	AnnotationCompanion,
	UserAnnotation,
} from './annotationProtocol';
import type {
	PromptContext,
	PromptPreset,
	PromptScope,
} from './promptCommand';

export type ResponseContinuity = 'originating-session' | 'agent-selection-required';

export interface PreparedAnnotationResponse {
	readonly prompt: PromptContext;
	readonly continuity: ResponseContinuity;
	readonly preferredAgentId?: AgentId;
}

export interface ResponseSourceDocument {
	readonly sourceUri: string;
	readonly lineCount: number;
	readonly isDirty: boolean;
	readonly lineAt: (line: number) => { readonly text: string };
}

export interface PrepareAnnotationResponseDependencies {
	readonly activeEditor: () => { readonly sourceUri: string; readonly line: number } | undefined;
	readonly linkedSourceUri: (workspaceRelativeFile: string) => string | undefined;
	readonly readAnnotations: (sourceUri: string) => Promise<AnnotationCompanion>;
	readonly readSourceDocument: (sourceUri: string) => Promise<ResponseSourceDocument>;
}

export async function prepareAnnotationResponse(
	sourceUri: string,
	annotation: Annotation,
	work: readonly UserAnnotationWorkItem[],
	agents: readonly NamedAgent[],
	dependencies: PrepareAnnotationResponseDependencies,
): Promise<PreparedAnnotationResponse> {
	const semantics = await responseTaskSemantics(annotation, dependencies);
	const document = await dependencies.readSourceDocument(sourceUri);
	if (document.sourceUri !== sourceUri) {
		throw new Error('The annotation source could not be resolved safely.');
	}
	if (document.isDirty) {
		throw new Error('Save the annotation source before responding.');
	}
	if (document.lineCount < 1) {
		throw new Error('The annotation source has no line available for a response.');
	}

	const sourceLine = responseSourceLine(sourceUri, annotation, document.lineCount, dependencies.activeEditor());
	const anchor = captureLineAnchor(document, sourceLine);
	const preferredAgentId = preferredResponseAgent(annotation, work, agents);
	return {
		prompt: {
			preset: semantics.preset,
			scope: semantics.scope,
			sourceUri,
			sourceLine,
			sourceText: `${semantics.preset}${semantics.scope === 'project' ? '@G' : ''}`,
			anchorText: anchor.text,
			anchorBefore: anchor.before,
			anchorAfter: anchor.after,
		},
		continuity: preferredAgentId === undefined ? 'agent-selection-required' : 'originating-session',
		...(preferredAgentId === undefined ? {} : { preferredAgentId }),
	};
}

export function preferredResponseAgent(
	annotation: Annotation,
	work: readonly UserAnnotationWorkItem[],
	agents: readonly NamedAgent[],
): AgentId | undefined {
	if (annotation.kind === 'agent') {
		return exactAvailableAgent(annotation.agentId, annotation.agentSessionId, agents);
	}

	const latestResponse = annotation.officialResponses.at(-1);
	if (latestResponse !== undefined) {
		return exactAvailableAgent(latestResponse.agentId, latestResponse.agentSessionId, agents);
	}

	const annotationWork = work.find(item => item.id === annotation.id);
	if (annotationWork === undefined) {
		return undefined;
	}
	if (annotationWork.assignment !== undefined) {
		return exactAvailableAgent(annotationWork.agentId, annotationWork.assignment.sessionId, agents);
	}

	const target = agents.find(agent => agent.id === annotationWork.agentId);
	return target?.session.state === 'available' ? target.id : undefined;
}

export function captureLineAnchor(
	document: Pick<ResponseSourceDocument, 'lineCount' | 'lineAt'>,
	sourceLine: number,
): { readonly text: string; readonly before: readonly string[]; readonly after: readonly string[] } {
	if (!Number.isSafeInteger(sourceLine) || sourceLine < 0 || sourceLine >= document.lineCount) {
		throw new Error('The annotation line is outside the current saved source.');
	}

	const before: string[] = [];
	for (let line = sourceLine - 1; line >= 0 && before.length < 3; line -= 1) {
		const text = document.lineAt(line).text;
		if (text.trim() !== '') {
			before.unshift(text);
		}
	}

	const after: string[] = [];
	for (let line = sourceLine + 1; line < document.lineCount && after.length < 3; line += 1) {
		const text = document.lineAt(line).text;
		if (text.trim() !== '') {
			after.push(text);
		}
	}

	return { text: document.lineAt(sourceLine).text, before, after };
}

async function responseTaskSemantics(
	annotation: Annotation,
	dependencies: PrepareAnnotationResponseDependencies,
): Promise<{ readonly preset: PromptPreset; readonly scope: PromptScope }> {
	if (annotation.kind === 'user') {
		return { preset: annotation.preset, scope: annotation.scope };
	}

	const parentSourceUri = dependencies.linkedSourceUri(annotation.userAnnotation.file);
	if (parentSourceUri === undefined) {
		throw new Error('The originating user annotation is outside the current workspace.');
	}
	const parentCompanion = await dependencies.readAnnotations(parentSourceUri);
	const parent = parentCompanion.annotations.find(candidate => candidate.id === annotation.userAnnotation.annotationId);
	if (parent?.kind !== 'user') {
		throw new Error('The originating user annotation no longer exists.');
	}
	return responseSemanticsFromParent(parent);
}

function responseSemanticsFromParent(parent: UserAnnotation): {
	readonly preset: PromptPreset;
	readonly scope: PromptScope;
} {
	return { preset: parent.preset, scope: parent.scope };
}

function responseSourceLine(
	sourceUri: string,
	annotation: Annotation,
	lineCount: number,
	activeEditor: ReturnType<PrepareAnnotationResponseDependencies['activeEditor']>,
): number {
	if (annotation.anchor.line !== null) {
		if (annotation.anchor.line >= lineCount) {
			throw new Error('The annotation line is outside the current saved source. Save or re-anchor the annotation and try again.');
		}
		return annotation.anchor.line;
	}

	if (activeEditor?.sourceUri !== sourceUri) {
		throw new Error('Open the annotation source and choose a response line before responding.');
	}
	if (!Number.isSafeInteger(activeEditor.line) || activeEditor.line < 0 || activeEditor.line >= lineCount) {
		throw new Error('Choose a valid response line in the annotation source.');
	}
	return activeEditor.line;
}

function exactAvailableAgent(
	agentId: string,
	sessionId: string,
	agents: readonly NamedAgent[],
): AgentId | undefined {
	const agent = agents.find(candidate => candidate.id === agentId);
	return agent?.session.state === 'available' && agent.session.id === sessionId ? agent.id : undefined;
}
