// Набор «смайлов» и реакций — ОДИН сменный источник для всего приложения (стикеры в чатах/комментариях,
// реакции под сообщениями). Всё остальное (протокол сообщений, пикеры, рендер) знает только СТАБИЛЬНЫЕ id
// ("thumbs-up", "heart", ...), а не картинки: чтобы поменять внешний вид (другой набор emoji, векторные
// иконки, картинки), достаточно подменить пак в UI (components/emoji-glyph.jsx) — id в сообщениях,
// уже лежащих в чатах, остаются теми же и перерисуются новым набором сами.
//
// id — часть протокола (`:sticker:<id>:` и поле реакции): существующие id (первые 18 ниже, это бывший
// набор Phosphor) НЕ переименовывать — старые сообщения перестанут распознаваться. Новые — только добавлять.
// glyph — юникод-эмодзи для набора "unicode".

export const EMOJI_ITEMS = [
	// бывшие стикеры (Phosphor) — id сохранены, чтобы старые сообщения рисовались новым набором
	{ id: "smiley", glyph: "🙂" },
	{ id: "smiley-wink", glyph: "😉" },
	{ id: "smiley-meh", glyph: "😐" },
	{ id: "smiley-nervous", glyph: "😬" },
	{ id: "smiley-sad", glyph: "😢" },
	{ id: "smiley-angry", glyph: "😠" },
	{ id: "smiley-melting", glyph: "🫠" },
	{ id: "smiley-x-eyes", glyph: "😵" },
	{ id: "heart", glyph: "❤️" },
	{ id: "hand-heart", glyph: "🫶" },
	{ id: "thumbs-up", glyph: "👍" },
	{ id: "thumbs-down", glyph: "👎" },
	{ id: "hand-peace", glyph: "✌️" },
	{ id: "hand-fist", glyph: "✊" },
	{ id: "hands-clapping", glyph: "👏" },
	{ id: "hands-praying", glyph: "🙏" },
	{ id: "handshake", glyph: "🤝" },
	{ id: "confetti", glyph: "🎉" },
	// добавлены с переходом на emoji
	{ id: "laugh", glyph: "😂" },
	{ id: "grin", glyph: "😄" },
	{ id: "sweat-smile", glyph: "😅" },
	{ id: "love-eyes", glyph: "😍" },
	{ id: "kiss", glyph: "😘" },
	{ id: "cool", glyph: "😎" },
	{ id: "party-face", glyph: "🥳" },
	{ id: "wow", glyph: "😮" },
	{ id: "cry", glyph: "😭" },
	{ id: "thinking", glyph: "🤔" },
	{ id: "shrug", glyph: "🤷" },
	{ id: "facepalm", glyph: "🤦" },
	{ id: "eyes", glyph: "👀" },
	{ id: "fire", glyph: "🔥" },
	{ id: "hundred", glyph: "💯" },
	{ id: "sparkles", glyph: "✨" },
	{ id: "ok-hand", glyph: "👌" },
	{ id: "muscle", glyph: "💪" },
	{ id: "broken-heart", glyph: "💔" },
	{ id: "rocket", glyph: "🚀" },
];

// Стандартные реакции под сообщением (16) — подмножество набора, в порядке показа в пикере.
export const REACTION_IDS = [
	"thumbs-up",
	"thumbs-down",
	"heart",
	"laugh",
	"wow",
	"cry",
	"smiley-angry",
	"hands-praying",
	"hands-clapping",
	"fire",
	"confetti",
	"hundred",
	"thinking",
	"eyes",
	"hand-heart",
	"handshake",
];

const BY_ID = new Map(EMOJI_ITEMS.map((item) => [item.id, item]));

export function emojiItem(id) {
	return BY_ID.get(id) ?? null;
}

// Обратное соответствие для реакций каналов: они едут по протоколу юникод-символом, а рисуются как все остальные
// смайлы — по id (EmojiGlyph). Вариантный селектор U+FE0F не учитывается ("❤" и "❤️" — одно и то же).
const BY_GLYPH = new Map(EMOJI_ITEMS.map((item) => [item.glyph.replaceAll("\uFE0F", ""), item.id]));
export function emojiIdByGlyph(glyph) {
	return BY_GLYPH.get(String(glyph ?? "").replaceAll("\uFE0F", "")) ?? null;
}

export function isKnownEmojiId(id) {
	return BY_ID.has(id);
}

// id в сообщении приходит от собеседника: принимаем только безопасную форму (латиница/цифры/дефис, короткую).
// Неизвестный, но корректный id (например, из будущей версии набора) сохраняется — UI покажет заглушку,
// а не потеряет реакцию.
const ID_PATTERN = /^[a-z0-9-]{1,32}$/;
export function sanitizeEmojiId(id) {
	return typeof id === "string" && ID_PATTERN.test(id) ? id : null;
}
