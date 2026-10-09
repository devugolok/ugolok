import { t, currentLocale } from "./signals/i18n.js";
import { bytesToUnit } from "../domain/media/progress-indicator.js";

// «5,1 МБ» / «420 КБ» — размер с локализованной единицей (attachment.units.*) и локальным разделителем.
// Одно место вместо копий в индикаторах загрузки, отправки и обновления.
export function sizeLabel(bytes) {
	const { unit, value } = bytesToUnit(bytes);
	return t(`attachment.units.${unit}`, { count: value.toLocaleString(currentLocale.value, { maximumFractionDigits: 1 }) });
}
