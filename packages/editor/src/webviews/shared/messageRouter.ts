import * as vscode from 'vscode';

export interface MessageRouter<Inbound, Outbound> {
	readonly post: (message: Outbound) => void;
	readonly dispose: () => void;
}

export function attachMessageRouter<Inbound, Outbound>(
	webview: vscode.Webview,
	isValidInboundMessage: (value: unknown) => value is Inbound,
	handleInboundMessage: (message: Inbound) => void | Promise<void>,
): MessageRouter<Inbound, Outbound> {
	const messageSubscription = webview.onDidReceiveMessage((rawInboundMessage: unknown) => {
		if (!isValidInboundMessage(rawInboundMessage)) {
			console.warn('sundial-editor: dropped malformed webview message', rawInboundMessage);
			return;
		}

		void handleInboundMessage(rawInboundMessage);
	});

	return {
		post: (message: Outbound) => {
			void webview.postMessage(message);
		},
		dispose: () => messageSubscription.dispose(),
	};
}
