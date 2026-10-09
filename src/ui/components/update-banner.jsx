import { updateAvailable, updateState } from "../signals/app-update.js";
import { t } from "../signals/i18n.js";
import { sizeLabel } from "../size-label.js";
import { updatePercent, buildLabel } from "../../domain/app-update.js";
import { APP_VERSION, BUILD_HASH } from "../../config.js";

// Плашка обновления: какая версия сейчас и какая придёт, ход скачивания (полоса, проценты, МБ) и в
// конце «Перезапустить». Перезагрузку сама не делает: она сбрасывает ключи из памяти (нужно снова
// ввести пароль), поэтому решает человек — и об этом сказано заранее.
export default function UpdateBanner() {
	const state = updateState.value;
	const downloading = state.phase === "downloading";
	const ready = state.phase === "ready" || (state.phase === "idle" && updateAvailable.value);
	if (!downloading && !ready) return null;

	const percent = updatePercent(state);
	const from = buildLabel(APP_VERSION, BUILD_HASH);
	const to = buildLabel(state.newVersion, state.newHash);
	const showBar = downloading;
	const bytesKnown = state.total > 0;

	return (
		<div class="toast-host stack update-banner" role="region" aria-label={t("update.regionAria")} aria-live="polite">
			<div class="toast stack" style={{ "--gap": "var(--space-3xs)" }}>
				<p class="toast-title">{downloading ? t("update.downloading") : t("update.ready")}</p>
				{to && <p class="toast-body">{t("update.versions", { from: from || t("update.versionUnknown"), to })}</p>}
				{showBar && (
					<>
						<span
							class={`media-progress__bar${percent === null ? " is-indeterminate" : ""}`}
							role="progressbar"
							aria-valuemin={0}
							aria-valuemax={100}
							aria-valuenow={percent ?? undefined}
							aria-label={t("update.downloading")}
						>
							<span class="media-progress__fill" style={percent !== null ? { inlineSize: `${percent}%` } : undefined} />
						</span>
						<span class="toast-body">
							{percent !== null ? `${percent}%` : t("update.preparing")}
							{bytesKnown ? ` · ${t("attachment.progress.of", { done: sizeLabel(state.loaded), total: sizeLabel(state.total) })}` : ""}
						</span>
					</>
				)}
				{!downloading && (
					<>
						<p class="toast-body">{t("update.hint")}</p>
						<button type="button" class="btn--primary update-banner__button" onClick={() => location.reload()}>
							{t("update.reload")}
						</button>
					</>
				)}
			</div>
		</div>
	);
}
