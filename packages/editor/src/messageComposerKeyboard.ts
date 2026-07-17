export type MessageComposerKeyAction = 'submit' | 'newline' | 'cancel' | 'none';

export interface MessageComposerKey {
	readonly key: string;
	readonly shiftKey: boolean;
	readonly isComposing: boolean;
}

export function messageComposerKeyAction(event: MessageComposerKey): MessageComposerKeyAction {
	if (event.isComposing) {
		return 'none';
	}

	if (event.key === 'Escape') {
		return 'cancel';
	}

	if (event.key === 'Enter') {
		return event.shiftKey ? 'newline' : 'submit';
	}

	return 'none';
}
