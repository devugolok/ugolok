import { t } from "../signals/i18n.js";
import { transferStats } from "../../domain/media/progress-indicator.js";
import { roundEtaSec } from "../../domain/media/speed-history.js";
import { sizeLabel } from "../size-label.js";

// Индикатор отправки: этап словами + полоса + «2,4 из 5,1 МБ · 420 КБ/с · ещё ~7 с».
// Цифры только из фактических байтов (uploadAll -> onBytes); этап публикации — полоса без процента.
// publishKey — подпись второго этапа (по умолчанию «Публикую…»; в комментарии/чате — «Отправляю…»).
export default function UploadProgress({ state, publishKey = "upload.progress.publishing" }) {
	if (!state) return null;
	const uploading = state.stage === "uploading";
	const percent = uploading ? Math.min(99, Math.round((state.fraction ?? 0) * 100)) : null;
	const hasBytes = uploading && state.totalBytes > 0 && Number.isFinite(state.doneBytes);

	const details = [];
	if (hasBytes) {
		details.push(t("attachment.progress.of", { done: sizeLabel(state.doneBytes), total: sizeLabel(state.totalBytes) }));
		const elapsedMs = state.startedAt ? Date.now() - state.startedAt : 0;
		const stats = transferStats({ bytesDone: state.doneBytes, bytesTotal: state.totalBytes, elapsedMs });
		if (stats.speedBytesPerSec) details.push(t("attachment.progress.speed", { speed: sizeLabel(stats.speedBytesPerSec) }));
		// остаток — только когда накопился замер (3 с и >=5%), иначе цифра прыгает
		if (stats.etaSec && elapsedMs >= 3000 && state.fraction >= 0.05) details.push(t("attachment.progress.eta", { sec: roundEtaSec(stats.etaSec) }));
	}

	const stage = uploading ? t("upload.progress.uploading", { percent }) : t(publishKey);
	return (
		<div class="media-progress stack" style={{ "--gap": "var(--space-3xs)", color: "var(--muted)", maxInlineSize: "none" }} role="status" aria-live="polite">
			<span class="media-progress__stage">{stage}</span>
			<span
				class={`media-progress__bar${uploading ? "" : " is-indeterminate"}`}
				role="progressbar"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={uploading ? percent : undefined}
				aria-label={stage}
			>
				<span class="media-progress__fill" style={uploading ? { inlineSize: `${percent}%` } : undefined} />
			</span>
			{details.length > 0 && <span class="media-progress__details">{details.join(" · ")}</span>}
		</div>
	);
}
