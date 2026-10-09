import { test } from "node:test";
import assert from "node:assert/strict";
import { downloadPercent, pickIndicator, downloadProgressInfo, transferStats, bytesToUnit } from "../src/domain/media/progress-indicator.js";
import { reservedBoxStyle } from "../src/ui/components/attachment-box.js";
import { resolveImagePreviewUrl, resolveImageOverlayUrl } from "../src/domain/media/image-preview.js";
import { clearPlaintextCache } from "../src/domain/media/plaintext-cache.js";

// MEDIA-PERF-TZ-6.md §8.

test("downloadPercent: округление, зажим 0..100, null там, где считать нечего", () => {
	assert.equal(downloadPercent({ bytesDone: 1, bytesTotal: 3 }), 33);
	assert.equal(downloadPercent({ bytesDone: 5, bytesTotal: 5 }), 100);
	assert.equal(downloadPercent({ bytesDone: 9, bytesTotal: 5 }), 100);
	assert.equal(downloadPercent({ bytesDone: 0, bytesTotal: 0 }), null);
	assert.equal(downloadPercent({ bytesDone: 1 }), null);
	assert.equal(downloadPercent(undefined), null);
});

test("pickIndicator: процент только когда он число, иначе idle (волчок решает вызывающий)", () => {
	assert.deepEqual(pickIndicator({ percent: 0 }), { kind: "percent", percent: 0 });
	assert.deepEqual(pickIndicator({ percent: 42 }), { kind: "percent", percent: 42 });
	assert.deepEqual(pickIndicator({ percent: null }), { kind: "idle" });
	assert.deepEqual(pickIndicator({}), { kind: "idle" });
	assert.deepEqual(pickIndicator(), { kind: "idle" });
});

test("reservedBoxStyle §8.1: резерв по width/height, без них — undefined (без выдуманного соотношения)", () => {
	assert.equal(reservedBoxStyle({}), undefined);
	assert.equal(reservedBoxStyle({ width: 100 }), undefined);
	assert.equal(reservedBoxStyle({ width: 0, height: 10 }), undefined);
	assert.equal(reservedBoxStyle(undefined), undefined);
	const style = reservedBoxStyle({ width: 1600, height: 900 });
	assert.equal(style.aspectRatio, "1600 / 900");
	assert.match(style.maxWidth, /1024px/, "потолок ширины как у растра превью");
	assert.match(reservedBoxStyle({ width: 300, height: 200 }).maxWidth, /300px/);
});

const RASTER = {
	createImageBitmap: async () => ({ width: 1, height: 1, close() {} }),
	convertBitmap: async () => new Blob([new Uint8Array([9])], { type: "image/png" }),
};

test("resolveImagePreviewUrl §8.2: onProgress получает объекты {phase, percent}, не строки", async () => {
	clearPlaintextCache();
	const events = [];
	await resolveImagePreviewUrl(
		"progress-digest-1",
		"image/jpeg",
		async (_trace, onDownload) => {
			onDownload?.({ bytesDone: 1, bytesTotal: 4 });
			onDownload?.({ bytesDone: 4, bytesTotal: 4 });
			return new Uint8Array([1, 2, 3]);
		},
		RASTER,
		(p) => events.push(p),
	);
	for (const e of events) assert.equal(typeof e, "object");
	assert.deepEqual(events[0], { phase: "loading", percent: null });
	// Помимо процента — фактические байты (для «2,4 из 5,1 МБ», media-progress.jsx).
	assert.deepEqual(
		events.filter((e) => e.percent !== null),
		[
			{ phase: "loading", percent: 25, bytesDone: 1, bytesTotal: 4 },
			{ phase: "loading", percent: 100, bytesDone: 4, bytesTotal: 4 },
		],
	);
	assert.deepEqual(events.at(-1), { phase: "preparing", percent: null });
	clearPlaintextCache();
});

test("resolveImagePreviewUrl §8.2: loadBytes без onDownload (старая сигнатура) — percent остаётся null, ветка не ломается", async () => {
	clearPlaintextCache();
	const events = [];
	const result = await resolveImagePreviewUrl("progress-digest-2", "image/jpeg", async () => new Uint8Array([1, 2, 3]), RASTER, (p) => events.push(p));
	assert.ok(result.url);
	assert.ok(events.length >= 2);
	assert.ok(events.every((e) => e.percent === null));
	clearPlaintextCache();
});

test("resolveImageOverlayUrl §8.2: тот же контракт, downloadPercent без totals даёт null", async () => {
	clearPlaintextCache();
	const events = [];
	await resolveImageOverlayUrl(
		"progress-digest-3",
		"image/jpeg",
		async (_trace, onDownload) => {
			onDownload?.({ bytesDone: 0, bytesTotal: 0 });
			return new Uint8Array([1, 2, 3]);
		},
		{ ...RASTER, targetWidth: 512, webpSupported: false },
		(p) => events.push(p),
	);
	assert.ok(events.every((e) => typeof e === "object" && e.percent === null));
	clearPlaintextCache();
});

test("downloadProgressInfo: процент и байты вместе; нет данных — null, не выдуманные нули", () => {
	assert.deepEqual(downloadProgressInfo({ bytesDone: 1, bytesTotal: 4 }), { percent: 25, bytesDone: 1, bytesTotal: 4 });
	assert.deepEqual(downloadProgressInfo({ bytesDone: 9, bytesTotal: 4 }), { percent: 100, bytesDone: 4, bytesTotal: 4 });
	assert.deepEqual(downloadProgressInfo({ bytesDone: 1 }), { percent: null, bytesDone: null, bytesTotal: null });
	assert.deepEqual(downloadProgressInfo(undefined), { percent: null, bytesDone: null, bytesTotal: null });
});

test("transferStats: скорость и остаток по среднему; рано/пусто — оценки нет", () => {
	assert.deepEqual(transferStats({ bytesDone: 1_000_000, bytesTotal: 5_000_000, elapsedMs: 2000 }), { speedBytesPerSec: 500_000, etaSec: 8 });
	assert.deepEqual(transferStats({ bytesDone: 1_000_000, bytesTotal: 5_000_000, elapsedMs: 100 }), { speedBytesPerSec: null, etaSec: null });
	assert.deepEqual(transferStats({ bytesDone: 0, bytesTotal: 5_000_000, elapsedMs: 5000 }), { speedBytesPerSec: null, etaSec: null });
	assert.deepEqual(transferStats({ bytesDone: 5_000_000, bytesTotal: 5_000_000, elapsedMs: 4000 }), { speedBytesPerSec: 1_250_000, etaSec: 0 });
	assert.deepEqual(transferStats({}), { speedBytesPerSec: null, etaSec: null });
});

test("bytesToUnit: единицы и округление под attachment.units", () => {
	assert.deepEqual(bytesToUnit(512), { unit: "bytes", value: 512 });
	assert.deepEqual(bytesToUnit(1536), { unit: "kb", value: 2 });
	assert.deepEqual(bytesToUnit(5_342_208), { unit: "mb", value: 5.1 });
	assert.deepEqual(bytesToUnit(3 * 1024 ** 3), { unit: "gb", value: 3 });
});
