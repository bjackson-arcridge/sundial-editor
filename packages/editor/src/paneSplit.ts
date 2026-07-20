export const defaultPaneSplitPercent = 50;
export const minimumPaneSplitPercent = 10;
export const maximumPaneSplitPercent = 90;

export function clampPaneSplitPercent(percent: number): number {
	return Math.min(maximumPaneSplitPercent, Math.max(minimumPaneSplitPercent, percent));
}

export function paneSplitPercentFromPointer(
	clientY: number,
	layoutTop: number,
	layoutHeight: number,
	separatorHeight: number,
): number {
	const availableHeight = layoutHeight - separatorHeight;
	if (availableHeight <= 0) {
		return defaultPaneSplitPercent;
	}
	const topPaneHeight = clientY - layoutTop - separatorHeight / 2;
	return clampPaneSplitPercent(topPaneHeight / availableHeight * 100);
}

export function paneSplitPercentFromKey(current: number, key: string): number | undefined {
	switch (key) {
		case 'ArrowUp':
			return clampPaneSplitPercent(current - 2);
		case 'ArrowDown':
			return clampPaneSplitPercent(current + 2);
		case 'PageUp':
			return clampPaneSplitPercent(current - 10);
		case 'PageDown':
			return clampPaneSplitPercent(current + 10);
		case 'Home':
			return minimumPaneSplitPercent;
		case 'End':
			return maximumPaneSplitPercent;
		default:
			return undefined;
	}
}
