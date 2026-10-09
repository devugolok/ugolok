import { emojiItem } from "../../domain/content/emoji-pack.js";
import { PHOSPHOR_EMOJI_ICONS } from "./phosphor-emoji-icons.js";

// ЕДИНСТВЕННОЕ место, где стабильный id ("thumbs-up") превращается в картинку. Протокол сообщений (`:sticker:id:`,
// реакции) и пикеры знают только id; чтобы сменить оформление (другой набор emoji, векторные иконки, картинки),
// добавьте функцию в EMOJI_RENDERERS и поменяйте ACTIVE_EMOJI_PACK — больше ничего менять не нужно, а сообщения,
// уже лежащие в чатах, перерисуются новым набором сами.
export const ACTIVE_EMOJI_PACK = "tossface";

// Tossface (https://github.com/toss/tossface, лицензия — src/assets/emoji/tossface/LICENSE): SVG под нашими id, без
// изменений. Сборка одним файлом (singlefile) встраивает их в index.html data-URL'ами, т.е. набор работает офлайн.
const TOSSFACE_URLS = import.meta.glob("../../assets/emoji/tossface/*.svg", { query: "?url", import: "default", eager: true });
const tossfaceUrl = (id) => TOSSFACE_URLS[`../../assets/emoji/tossface/${id}.svg`];

function renderUnicode(item, className) {
	return (
		<span class={`emoji-glyph${className ? ` ${className}` : ""}`} role="img" aria-label={item.id.replace(/-/g, " ")}>
			{item.glyph}
		</span>
	);
}

const EMOJI_RENDERERS = {
	unicode: renderUnicode,
	// картинка Tossface; для id без картинки (набор вырос) — юникод-символ, а не пустое место
	tossface: (item, className) => {
		const url = tossfaceUrl(item.id);
		if (!url) return renderUnicode(item, className);
		return <img class={`emoji-glyph emoji-glyph--img${className ? ` ${className}` : ""}`} src={url} alt={item.id.replace(/-/g, " ")} draggable={false} loading="lazy" decoding="async" />;
	},
	// прежний набор Phosphor: иконка, если для id она есть, иначе юникод
	phosphor: (item, className) => {
		const Icon = PHOSPHOR_EMOJI_ICONS[item.id];
		return Icon ? <Icon class={`icon${className ? ` ${className}` : ""}`} aria-hidden="false" /> : renderUnicode(item, className);
	},
};

export default function EmojiGlyph({ id, class: className }) {
	const item = emojiItem(id);
	// id из более новой версии набора (или повреждённый): показываем нейтральную заглушку, реакция не теряется.
	if (!item) return <span class={`emoji-glyph emoji-glyph--unknown${className ? ` ${className}` : ""}`} role="img" aria-label={String(id)}>◻</span>;
	return (EMOJI_RENDERERS[ACTIVE_EMOJI_PACK] ?? renderUnicode)(item, className);
}
