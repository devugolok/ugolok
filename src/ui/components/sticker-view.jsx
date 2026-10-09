import { parseStickerKey } from "../../domain/content/sticker.js";
import EmojiGlyph from "./emoji-glyph.jsx";

// text, целиком равный `:sticker:<id>:` (см. domain/content/sticker.js) — рендерится крупным emoji вместо
// MarkdownView; вид задаёт сменный набор (emoji-glyph.jsx). Не распознан — null, вызывающий компонент
// (MessageBubble/CommentNode/ChannelMessage) сам решает, что показать вместо этого (обычно тот же text через MarkdownView).
export default function StickerView({ text }) {
	const key = parseStickerKey(text);
	if (!key) return null;
	return <EmojiGlyph id={key} class="sticker-view" />;
}
