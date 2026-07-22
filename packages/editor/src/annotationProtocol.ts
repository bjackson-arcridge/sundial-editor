import {
	isAnnotation,
	isUserAnnotation,
	parseAnnotation as parseSharedAnnotation,
	parseAnnotationReadResult,
	parseAnnotationReanchorResult as parseSharedAnnotationReanchorResult,
	type AgentFileAnnotation,
	type Annotation,
	type AnnotationAnchor,
	type AnnotationAppendRequest,
	type AnnotationDeleteRequest,
	type AnnotationLink,
	type AnnotationReadRequest,
	type AnnotationReadResult,
	type AnnotationReanchorRequest,
	type AnnotationReanchorResult,
	type OfficialResponse,
	type UserAnnotation,
} from '@arcridge/sundial-editor-annotations';

export type {
	AgentFileAnnotation,
	Annotation,
	AnnotationAnchor,
	AnnotationAppendRequest,
	AnnotationDeleteRequest,
	AnnotationLink,
	AnnotationReadRequest,
	AnnotationReanchorRequest,
	AnnotationReanchorResult,
	OfficialResponse,
	UserAnnotation,
};

// The editor's companion view is the CLI-enriched read result, not the raw
// on-disk companion record.
export type AnnotationCompanion = AnnotationReadResult;

export function parseAnnotation(value: unknown): Annotation {
	try { return parseSharedAnnotation(value); }
	catch { throw new Error('Sundial Editor CLI returned a malformed annotation.'); }
}

export function parseAnnotationCompanion(value: unknown): AnnotationCompanion {
	try { return parseAnnotationReadResult(value); }
	catch { throw new Error('Sundial Editor CLI returned a malformed annotation companion.'); }
}

export function parseAnnotationReanchorResult(value: unknown): AnnotationReanchorResult {
	try { return parseSharedAnnotationReanchorResult(value); }
	catch { throw new Error('Sundial Editor CLI returned a malformed annotation re-anchor result.'); }
}

export { isAnnotation, isUserAnnotation };
