import { useRef } from "preact/hooks";
import { t } from "../../signals/i18n.js";
import { transferStats } from "../../../domain/media/progress-indicator.js";
import { sizeLabel } from "../../size-label.js";
import { loadSpeedBps, blendSpeed, roundEtaSec } from "../../../domain/media/speed-history.js";

// Единый индикатор ожидания медиа: этап словами + полоса + «2,4 из 5,1 МБ · 420 КБ/с · ещё ~7 с».
// Раньше было одно слово «Загрузка…» (иногда с процентом) — человек не понимал, что происходит и
// сколько ещё ждать. Цифры берутся только из фактических байтов (см. progress-indicator.js):
// чего не знаем — не показываем, полоса тогда неопределённая.
// progress: { phase: "connecting" | "loading" | "preparing" | "decrypting", percent, bytesDone?, bytesTotal? }
// dark — подпись на тёмном фоне оверлея.
// Остаток показываем, когда есть на что опереться: либо накопился свой замер (>=5%), либо есть история.
function hasEnoughForEta(p, historyBps) {
	if (!(p.bytesDone > 0)) return false;
	return p.percent >= 5 || historyBps > 0;
}

export default function MediaProgress({ progress, expectedBytes, dark = false, style }) {
	const startedAtRef = useRef(null);
	// История скорости прошлых загрузок читается один раз на показ индикатора.
	const historyBpsRef = useRef(undefined);
	if (historyBpsRef.current === undefined) historyBpsRef.current = loadSpeedBps();
	const historyBps = historyBpsRef.current;
	const p = progress ?? { phase: "connecting", percent: null };
	const hasBytes = Number.isFinite(p.bytesDone) && Number.isFinite(p.bytesTotal);

	if (hasBytes && p.bytesDone > 0 && startedAtRef.current === null) startedAtRef.current = Date.now();
	const elapsedMs = startedAtRef.current === null ? 0 : Date.now() - startedAtRef.current;
	const stats = hasBytes ? transferStats({ bytesDone: p.bytesDone, bytesTotal: p.bytesTotal, elapsedMs }) : { speedBytesPerSec: null, etaSec: null };

	const downloading = (p.phase === "loading" || p.phase === "preparing") && Number.isFinite(p.percent);
	const stage = downloading
		? t("attachment.progress.downloading", { percent: p.percent })
		: p.phase === "preparing"
			? t("attachment.statusPreparing")
			: p.phase === "decrypting"
				? t("attachment.statusDecrypting")
				: p.phase === "connecting"
					? t("attachment.progress.connecting")
					: t("attachment.loadingImage");

	const details = [];
	if (downloading && hasBytes) details.push(t("attachment.progress.of", { done: sizeLabel(p.bytesDone), total: sizeLabel(p.bytesTotal) }));
	if (stats.speedBytesPerSec) details.push(t("attachment.progress.speed", { speed: sizeLabel(stats.speedBytesPerSec) }));
	// Остаток: скорость = свой замер, плавно уступающий место истории в начале (blendSpeed), секунды
	// округляются (roundEtaSec) — цифра не дёргается. Своих байтов ещё нет — оценка по размеру файла
	// и истории прошлых загрузок («≈ N с»), если история есть.
	if (hasBytes && hasEnoughForEta(p, historyBps)) {
		const speed = blendSpeed({ currentBps: stats.speedBytesPerSec, historyBps, elapsedMs });
		const remaining = Math.max(0, p.bytesTotal - p.bytesDone);
		if (speed) {
			const sec = roundEtaSec(remaining / speed);
			if (sec > 0) details.push(t("attachment.progress.eta", { sec }));
		}
	} else if (!hasBytes && Number.isFinite(expectedBytes) && expectedBytes > 0 && historyBps) {
		const sec = roundEtaSec(expectedBytes / historyBps);
		if (sec > 0) details.push(t("attachment.progress.estimate", { sec }));
	}

	return (
		<div class="media-progress stack" style={{ "--gap": "var(--space-3xs)", ...(dark ? { color: "#fff" } : { color: "var(--muted)" }), ...style }} role="status" aria-live="polite">
			<span class="media-progress__stage">{stage}</span>
			<span
				class={`media-progress__bar${downloading ? "" : " is-indeterminate"}`}
				role="progressbar"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={downloading ? p.percent : undefined}
				aria-label={stage}
			>
				<span class="media-progress__fill" style={downloading ? { inlineSize: `${p.percent}%` } : undefined} />
			</span>
			{details.length > 0 && <span class="media-progress__details">{details.join(" · ")}</span>}
		</div>
	);
}
