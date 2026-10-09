import { signal } from "@preact/signals";
import { IDLE_UPDATE_STATE } from "../../domain/app-update.js";

// Новая версия приложения скачана service worker'ом и готова к запуску (web). Показывается плашкой
// (components/update-banner.jsx): при живой сессии автоперезагрузка откладывается до блокировки
// (reload-gate.js), и человек раньше не знал, что обновление вообще есть.
export const updateAvailable = signal(false);

// Ход скачивания и версия новой сборки по сообщениям SW (domain/app-update.js::reduceUpdateState).
export const updateState = signal(IDLE_UPDATE_STATE);
