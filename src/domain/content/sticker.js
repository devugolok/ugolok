import { EMOJI_ITEMS } from "./emoji-pack.js";

// Живой фидбег — «смайлы» из меню «+» -> «Смайлы» (compose-attach-tools.jsx) уходят в чат/комментарии как
// ОТДЕЛЬНОЕ сообщение-стикер (крупный emoji в пузыре; вид задаёт сменный набор), не юникод-символ
// и не новый тип контента в БД: тот же текстовый канал, что обычное
// сообщение (никакой миграции схемы), просто зарезервированный формат
// содержимого — сообщение, ЦЕЛИКОМ равное `:sticker:<ключ>:`, рендерится
// крупным значком вместо markdown. STICKER_KEYS — контракт между меню смайлов
// (что можно отправить) и StickerView (что можно показать крупно):
// теперь это один список — набор emoji (emoji-pack.js), расширяется только добавлением id.
// Набор стикеров = набор emoji (domain/content/emoji-pack.js): один источник правды, id стабильны.
export const STICKER_KEYS = EMOJI_ITEMS.map((item) => item.id);

const STICKER_PATTERN = /^:sticker:([a-z-]+):$/;

export function stickerMarker(key) {
	return `:sticker:${key}:`;
}

// null, если text не является распознанным маркером стикера — вызывающий
// код тогда рендерит text обычным образом (markdown/plain).
export function parseStickerKey(text) {
	if (typeof text !== "string") return null;
	const match = STICKER_PATTERN.exec(text.trim());
	if (!match) return null;
	return STICKER_KEYS.includes(match[1]) ? match[1] : null;
}
