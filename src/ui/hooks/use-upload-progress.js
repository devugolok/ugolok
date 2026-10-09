import { useState, useRef, useCallback } from "preact/hooks";

// Состояние прогресса отправки с вложениями (посты, правка, комментарии, чат канала):
// этап «uploading» — по реальным байтам из tray.uploadAll(..., { onBytes }), затем «publishing» —
// сохранение и публикация события (там байтов нет, полоса неопределённая).
// Раньше кнопка «Опубликовать» просто замирала на десятки секунд: человек не понимал, висит ли оно.
export function useUploadProgress() {
	const [state, setState] = useState(null); // { stage, fraction, doneBytes, totalBytes, startedAt } | null
	const startedAtRef = useRef(null);

	const onBytes = useCallback((fraction, info = {}) => {
		if (startedAtRef.current === null && fraction > 0) startedAtRef.current = Date.now();
		setState({
			stage: "uploading",
			fraction,
			doneBytes: Number.isFinite(info.doneBytes) ? info.doneBytes : null,
			totalBytes: Number.isFinite(info.totalBytes) ? info.totalBytes : null,
			startedAt: startedAtRef.current,
		});
	}, []);

	const publishing = useCallback(() => setState((s) => ({ ...(s ?? {}), stage: "publishing", fraction: 1 })), []);

	const reset = useCallback(() => {
		startedAtRef.current = null;
		setState(null);
	}, []);

	return { state, onBytes, publishing, reset };
}
