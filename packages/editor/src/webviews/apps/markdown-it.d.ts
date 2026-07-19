declare module 'markdown-it' {
	interface MarkdownItOptions {
		readonly html?: boolean;
		readonly linkify?: boolean;
		readonly typographer?: boolean;
	}

	export default class MarkdownIt {
		constructor(options?: MarkdownItOptions);
		render(source: string): string;
	}
}
