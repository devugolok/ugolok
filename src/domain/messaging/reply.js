// «Ответ на сообщение» и «цитирование выделенного». Ссылка едет ВНУТРИ обычного сообщения (поле replyTo в MLS-нагрузке),
// а не отдельным служебным: ответ — видимое сообщение со своим текстом.
//
// replyTo = { msgId, senderPubkey, excerpt, att? }
//   msgId        — id исходного сообщения (чтобы по клику перейти к нему, если оно ещё в ленте);
//   senderPubkey — чьё это сообщение (для подписи «Имя»);
//   excerpt      — короткая выдержка ТЕКСТА: исходное сообщение могут удалить/отредактировать, а цитата должна
//                  остаться читаемой; при «Цитировать» сюда кладётся именно выделенный фрагмент;
//   att          — число вложений исходного сообщения (подпись «вложение», если текста нет).
export const REPLY_EXCERPT_MAX = 280;
const PUBKEY_PATTERN = /^[0-9a-f]{64}$/;
// id сообщения личного чата — hex; id сообщения/комментария канала — UUID с дефисами
const MSGID_PATTERN = /^[0-9a-f-]{8,64}$/;

function clip(text) {
	const s = String(text ?? "").replace(/\s+/g, " ").trim();
	return s.length > REPLY_EXCERPT_MAX ? s.slice(0, REPLY_EXCERPT_MAX - 1) + "…" : s;
}

// message — строка сообщения из ленты; quote — выделенный фрагмент (необязательно).
export function buildReplyTo(message, quote) {
	if (!message?.msgId || !message?.senderPubkey) return null;
	const out = { msgId: message.msgId, senderPubkey: message.senderPubkey, excerpt: clip(quote ?? message.text) };
	const att = Array.isArray(message.attachments) ? message.attachments.length : 0;
	if (att > 0) out.att = Math.min(att, 99);
	return out;
}

// Ссылка приходит от собеседника — проверяем форму и режем размер; негодная -> null (сообщение показывается без цитаты).
export function sanitizeReplyTo(value) {
	if (!value || typeof value !== "object") return null;
	if (typeof value.msgId !== "string" || !MSGID_PATTERN.test(value.msgId)) return null;
	if (typeof value.senderPubkey !== "string" || !PUBKEY_PATTERN.test(value.senderPubkey)) return null;
	const out = { msgId: value.msgId, senderPubkey: value.senderPubkey, excerpt: clip(typeof value.excerpt === "string" ? value.excerpt : "") };
	if (Number.isInteger(value.att) && value.att > 0) out.att = Math.min(value.att, 99);
	return out;
}
