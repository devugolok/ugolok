// Скорость скачивания, накопленная по прошлым загрузкам этого устройства: нужна, чтобы показать
// оценку «≈ 8 с» ещё ДО первого байта (пинг до сервера для этого не годится — он измеряет задержку, а не
// пропускную способность) и чтобы цифра остатка не прыгала на первых секундах, пока своих замеров мало.
// Хранится в localStorage (best-effort: нет хранилища — просто нет истории).

const STORAGE_KEY = "ugolok:media-speed-v1";
const MIN_BYTES = 64 * 1024; // меньше — замер шумный (вся передача уложилась в один-два чанка)
const MIN_MS = 300;
const ALPHA = 0.4; // вес свежего замера в скользящем среднем
const BLEND_FULL_AT_MS = 4000; // к 4 с собственный замер вытесняет историю полностью

function getStorage(storage) {
	if (storage) return storage;
	try {
		return typeof localStorage !== "undefined" ? localStorage : null;
	} catch {
		return null;
	}
}

export function loadSpeedBps(storage) {
	const s = getStorage(storage);
	if (!s) return null;
	try {
		const v = Number(JSON.parse(s.getItem(STORAGE_KEY) ?? "null")?.bps);
		return Number.isFinite(v) && v > 0 ? v : null;
	} catch {
		return null;
	}
}

// Записать завершённую загрузку; слишком маленькие/быстрые не учитываем.
export function recordTransfer({ bytes, ms }, storage) {
	if (!Number.isFinite(bytes) || !Number.isFinite(ms) || bytes < MIN_BYTES || ms < MIN_MS) return null;
	const sample = bytes / (ms / 1000);
	const prev = loadSpeedBps(storage);
	const next = prev === null ? sample : prev * (1 - ALPHA) + sample * ALPHA;
	const s = getStorage(storage);
	if (s) {
		try {
			s.setItem(STORAGE_KEY, JSON.stringify({ bps: next }));
		} catch {
			// квота/приватный режим — не критично
		}
	}
	return next;
}

// Трекер одной загрузки: подключается как onProgress({bytesDone, bytesTotal}); на первом событии с
// байтами запоминает старт, на завершении — пишет замер в историю. Возвращает ту же функцию-колбэк.
export function createTransferTracker({ now = () => Date.now(), storage } = {}) {
	let startedAt = null;
	let done = false;
	return (progress) => {
		const { bytesDone, bytesTotal } = progress ?? {};
		if (done || !Number.isFinite(bytesDone) || !Number.isFinite(bytesTotal) || bytesTotal <= 0) return;
		if (startedAt === null && bytesDone > 0) startedAt = now();
		if (startedAt !== null && bytesDone >= bytesTotal) {
			done = true;
			recordTransfer({ bytes: bytesTotal, ms: now() - startedAt }, storage);
		}
	};
}

// Скорость для расчёта остатка: свой замер с весом растущим со временем + история. Чего нет — берём то, что есть.
export function blendSpeed({ currentBps, historyBps, elapsedMs }) {
	const hasCurrent = Number.isFinite(currentBps) && currentBps > 0;
	const hasHistory = Number.isFinite(historyBps) && historyBps > 0;
	if (hasCurrent && hasHistory) {
		const w = Math.max(0, Math.min(1, elapsedMs / BLEND_FULL_AT_MS));
		return currentBps * w + historyBps * (1 - w);
	}
	if (hasCurrent) return currentBps;
	if (hasHistory) return historyBps;
	return null;
}

// Секунды -> то, что показываем: до 10 с — как есть, до минуты — шаг 5 с, дальше — шаг 10 с.
// Округление вверх: лучше «чуть дольше обещанного», чем наоборот.
export function roundEtaSec(sec) {
	if (!Number.isFinite(sec) || sec <= 0) return 0;
	if (sec <= 10) return Math.ceil(sec);
	if (sec <= 60) return Math.ceil(sec / 5) * 5;
	return Math.ceil(sec / 10) * 10;
}
