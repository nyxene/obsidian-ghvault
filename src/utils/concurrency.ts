/**
 * Map over items with controlled concurrency — a minimal pMap implementation.
 *
 * Processes up to `concurrency` items simultaneously.
 * Each item produces a result via `fn`. If `fn` throws, the error propagates
 * (use try/catch inside `fn` to collect per-item errors instead).
 */
export async function pMap<T, R>(
	items: readonly T[],
	fn: (item: T, index: number) => Promise<R>,
	concurrency: number,
): Promise<R[]> {
	if (concurrency < 1) {
		throw new Error("Concurrency must be at least 1");
	}

	const results: R[] = new Array(items.length);
	let nextIndex = 0;

	async function worker(): Promise<void> {
		while (nextIndex < items.length) {
			const index = nextIndex++;
			results[index] = await fn(items[index], index);
		}
	}

	const workers: Promise<void>[] = [];
	const workerCount = Math.min(concurrency, items.length);
	for (let i = 0; i < workerCount; i++) {
		workers.push(worker());
	}

	await Promise.all(workers);
	return results;
}
