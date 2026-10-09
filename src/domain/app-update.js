// Состояние обновления приложения (web/PWA) по сообщениям service worker'а.
// SW качает новую сборку при установке и шлёт странице: sw-update:start / progress / ready
// (service-worker.js). Здесь — чистая логика без DOM, чтобы тестироваться node --test.
//
// total — размер скачиваемого index.html в байтах (подставляется при сборке). 0/нет — размер
// неизвестен: тогда процента нет вовсе (полоса неопределённая), цифру не выдумываем.

export const IDLE_UPDATE_STATE = Object.freeze({ phase: "idle", loaded: 0, total: 0, newVersion: null, newHash: null });

function num(v) {
	return Number.isFinite(v) && v >= 0 ? v : 0;
}

export function reduceUpdateState(state, msg) {
	const s = state ?? IDLE_UPDATE_STATE;
	if (!msg || typeof msg.type !== "string") return s;
	const meta = { newVersion: msg.version ?? s.newVersion, newHash: msg.hash ?? s.newHash };
	switch (msg.type) {
		case "sw-update:start":
			return { phase: "downloading", loaded: 0, total: num(msg.total), ...meta };
		case "sw-update:progress":
			// progress без start (страница подписалась позже) — всё равно показываем скачивание
			return { ...s, ...meta, phase: s.phase === "ready" ? "ready" : "downloading", loaded: num(msg.loaded), total: num(msg.total) || s.total };
		case "sw-update:ready":
			return { ...s, ...meta, phase: "ready", loaded: s.total || s.loaded };
		default:
			return s;
	}
}

// Процент скачивания 0..100 или null, если размер неизвестен. Пока скачивание не завершено — не
// выше 99: «100%» без «готово» читалось бы как зависание.
export function updatePercent(state) {
	const { phase, loaded, total } = state ?? IDLE_UPDATE_STATE;
	if (!(total > 0)) return phase === "ready" ? 100 : null;
	const p = Math.round((Math.min(loaded, total) / total) * 100);
	return phase === "ready" ? 100 : Math.min(99, p);
}

// «0.0.12 (a1b2c3d)» — человекочитаемая метка сборки; пустые части не печатаем.
export function buildLabel(version, hash) {
	const v = version && version !== "0.0.0-dev" ? String(version) : "";
	const h = hash && hash !== "dev" ? String(hash).slice(0, 7) : "";
	if (v && h) return `${v} (${h})`;
	return v || h || "";
}
