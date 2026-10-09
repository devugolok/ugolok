import { pushToast } from "./toasts.js";
import { t } from "./i18n.js";

// «Не дождались соединения» при открытии экрана — не повод вставлять строку в поток страницы:
// она сдвигала весь контент под собой вниз и обратно, как только связь возвращалась (живая
// жалоба). Состояние связи и так видно в общей панели и у аватара; здесь — короткий тост, не
// чаще раза в полминуты, чтобы мигающая сеть не сыпала ими.
const MIN_INTERVAL_MS = 30_000;
let lastShownAt = 0;

export function notifyConnectionTrouble() {
	const now = Date.now();
	if (now - lastShownAt < MIN_INTERVAL_MS) return;
	lastShownAt = now;
	pushToast({ title: t("connectionStatus.waitFailedTitle"), body: t("connectionStatus.waitFailedBody") });
}
