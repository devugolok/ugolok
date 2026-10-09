import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSpeedBps, recordTransfer, createTransferTracker, blendSpeed, roundEtaSec } from "../src/domain/media/speed-history.js";

function memStorage() {
	const m = new Map();
	return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
}

test("recordTransfer: первый замер = сам замер; дальше скользящее среднее; мелкое и мгновенное игнорируется", () => {
	const s = memStorage();
	assert.equal(loadSpeedBps(s), null);
	assert.equal(recordTransfer({ bytes: 1000, ms: 5000 }, s), null, "меньше 64 КБ не учитываем");
	assert.equal(recordTransfer({ bytes: 1_000_000, ms: 100 }, s), null, "быстрее 300 мс не учитываем");
	assert.equal(recordTransfer({ bytes: 1_000_000, ms: 2000 }, s), 500_000);
	assert.equal(loadSpeedBps(s), 500_000);
	const next = recordTransfer({ bytes: 1_000_000, ms: 1000 }, s); // 1 МБ/с
	assert.equal(next, 500_000 * 0.6 + 1_000_000 * 0.4);
});

test("loadSpeedBps: испорченные данные и отказ хранилища — просто null", () => {
	assert.equal(loadSpeedBps({ getItem: () => "не json" }), null);
	assert.equal(loadSpeedBps({ getItem: () => { throw new Error("denied"); } }), null);
	assert.equal(loadSpeedBps({ getItem: () => JSON.stringify({ bps: -5 }) }), null);
});

test("createTransferTracker: замер пишется один раз, на завершении, от первого байта", () => {
	const s = memStorage();
	let t = 1000;
	const track = createTransferTracker({ now: () => t, storage: s });
	track({ bytesDone: 0, bytesTotal: 2_000_000 }); // ещё ничего не пришло — старт не фиксируем
	t = 2000;
	track({ bytesDone: 500_000, bytesTotal: 2_000_000 }); // старт = 2000
	t = 4000;
	track({ bytesDone: 2_000_000, bytesTotal: 2_000_000 }); // 2 с на 2 МБ
	assert.equal(loadSpeedBps(s), 1_000_000);
	t = 9000;
	track({ bytesDone: 2_000_000, bytesTotal: 2_000_000 });
	assert.equal(loadSpeedBps(s), 1_000_000, "повторное завершение не пишется");
});

test("blendSpeed: история ведёт в начале, собственный замер вытесняет её к 4 с; чего нет — берём что есть", () => {
	assert.equal(blendSpeed({ currentBps: 200, historyBps: 1000, elapsedMs: 0 }), 1000);
	assert.equal(blendSpeed({ currentBps: 200, historyBps: 1000, elapsedMs: 2000 }), 600);
	assert.equal(blendSpeed({ currentBps: 200, historyBps: 1000, elapsedMs: 4000 }), 200);
	assert.equal(blendSpeed({ currentBps: 200, historyBps: null, elapsedMs: 0 }), 200);
	assert.equal(blendSpeed({ currentBps: null, historyBps: 1000, elapsedMs: 0 }), 1000);
	assert.equal(blendSpeed({ currentBps: null, historyBps: null, elapsedMs: 0 }), null);
});

test("roundEtaSec: шаги 1/5/10 с, округление вверх", () => {
	assert.equal(roundEtaSec(0.2), 1);
	assert.equal(roundEtaSec(7.1), 8);
	assert.equal(roundEtaSec(12), 15);
	assert.equal(roundEtaSec(58), 60);
	assert.equal(roundEtaSec(61), 70);
	assert.equal(roundEtaSec(0), 0);
});
