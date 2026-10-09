// MEDIA-PERF-TZ-6.md §8. Чистая логика выбора индикатора — вынесена из
// компонентов, чтобы тестироваться node --test (как media-error.js): сами
// компоненты в node-тестах не проверяются.
//
// Контракт onProgress везде один: объект { phase, percent }, где percent —
// целое 0..100 или null. null значит «считать нечего» (decrypting, файл из
// кэша, вложение без манифеста) — только тогда UI рисует неопределённый
// волчок. Индикатор, который врёт, хуже волчка, который ничего не обещает,
// поэтому процент выдумывать нельзя: он берётся только из фактических байтов.

// { bytesDone, bytesTotal } из content.js::getRange -> percent | null.
export function downloadPercent(progress) {
	const { bytesDone, bytesTotal } = progress ?? {};
	if (!Number.isFinite(bytesDone) || !Number.isFinite(bytesTotal) || bytesTotal <= 0) return null;
	return Math.max(0, Math.min(100, Math.round((bytesDone / bytesTotal) * 100)));
}

// Что рисовать. percent — определённая полоса/число; иначе idle: вызывающий
// сам решает, что это, — волчок (пока грузим) или ничего (уже готово).
export function pickIndicator({ percent } = {}) {
	if (Number.isFinite(percent)) return { kind: "percent", percent };
	return { kind: "idle" };
}

// Процент + фактические байты одной «порцией»: UI показывает «2,4 из 5,1 МБ», а не только «47%».
// Те же правила честности: чего нет в данных — null, ничего не выдумываем.
export function downloadProgressInfo(progress) {
	const { bytesDone, bytesTotal } = progress ?? {};
	const hasBytes = Number.isFinite(bytesDone) && Number.isFinite(bytesTotal) && bytesTotal > 0;
	return {
		percent: downloadPercent(progress),
		bytesDone: hasBytes ? Math.min(bytesDone, bytesTotal) : null,
		bytesTotal: hasBytes ? bytesTotal : null,
	};
}

// Скорость и оценка остатка по среднему с начала передачи. Меньше 0,5 с или 0 байт — оценки нет
// (первые чанки дают дикий разброс; лучше промолчать, чем показать «осталось 3 часа»).
export function transferStats({ bytesDone, bytesTotal, elapsedMs }) {
	if (!Number.isFinite(bytesDone) || !Number.isFinite(bytesTotal) || !Number.isFinite(elapsedMs)) {
		return { speedBytesPerSec: null, etaSec: null };
	}
	if (elapsedMs < 500 || bytesDone <= 0) return { speedBytesPerSec: null, etaSec: null };
	const speedBytesPerSec = bytesDone / (elapsedMs / 1000);
	const remaining = Math.max(0, bytesTotal - bytesDone);
	return { speedBytesPerSec, etaSec: Math.ceil(remaining / speedBytesPerSec) };
}

// Размер -> { unit, value } под ключи attachment.units.* (b/kb/mb/gb): значение уже округлено так,
// как его принято показывать (МБ и ГБ — одна цифра после запятой, остальное — целые).
export function bytesToUnit(bytes) {
	const n = Math.max(0, Number(bytes) || 0);
	if (n < 1024) return { unit: "bytes", value: Math.round(n) };
	if (n < 1024 * 1024) return { unit: "kb", value: Math.round(n / 1024) };
	if (n < 1024 * 1024 * 1024) return { unit: "mb", value: Math.round((n / (1024 * 1024)) * 10) / 10 };
	return { unit: "gb", value: Math.round((n / (1024 * 1024 * 1024)) * 10) / 10 };
}
