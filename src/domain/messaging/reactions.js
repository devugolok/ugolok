// Реакции на сообщения личного чата. Служебное сообщение с маркером (тот же приём, что правка/удаление):
// `__ugolok_react__:{"msgId","id","on"}` уходит собеседнику обычным MLS-сообщением, на приёме применяется к целевой
// строке и в ленту не попадает. Одна реакция на человека на сообщение (смена — это новая реакция, снятие — on:false);
// разбор конкурентных — по Lamport-времени (LWW), как у правки.
// id — стабильный id из набора emoji (domain/content/emoji-pack.js), не картинка: набор можно сменить без миграции.
import { sendMessage } from "./chat.js";
import { db } from "../../core/store/database.js";
import { toEncryptedRow, fromEncryptedRow } from "../../core/store/encrypted-table.js";
import { MESSAGES_PLAINTEXT_FIELDS } from "../../core/store/table-fields.js";
import { sanitizeEmojiId } from "../content/emoji-pack.js";
import { DomainError } from "../errors.js";

export const REACTION_MARKER_PREFIX = "__ugolok_react__:";

export function buildReactionText(msgId, emojiId, on = true) {
	return REACTION_MARKER_PREFIX + JSON.stringify({ msgId, id: emojiId, on });
}

// Не бросает: повреждённое/враждебное -> null.
export function parseReactionText(text) {
	if (typeof text !== "string" || !text.startsWith(REACTION_MARKER_PREFIX)) return null;
	let parsed;
	try {
		parsed = JSON.parse(text.slice(REACTION_MARKER_PREFIX.length));
	} catch {
		return null;
	}
	if (typeof parsed?.msgId !== "string") return null;
	const id = sanitizeEmojiId(parsed.id);
	if (!id) return null;
	return { msgId: parsed.msgId, id, on: parsed.on !== false };
}

// reactions: { [reactorPubkey]: { id, ts } } — чистая функция (тестируется без БД). null — реакция не нужна
// (устаревшее по LWW: более новая уже применена).
export function applyReactionToMap(reactions, reactorPubkey, { id, on }, ts) {
	const current = reactions?.[reactorPubkey];
	if (current && current.ts >= ts) return null;
	const next = { ...(reactions ?? {}) };
	if (on) next[reactorPubkey] = { id, ts };
	else delete next[reactorPubkey];
	return next;
}

// Сводка для показа: [{ id, count, mine }] в порядке первого появления; mine — моя реакция среди них.
export function summarizeReactions(reactions, myPubkey) {
	const order = [];
	const byId = new Map();
	const entries = Object.entries(reactions ?? {}).sort((a, b) => a[1].ts - b[1].ts);
	for (const [pubkey, { id }] of entries) {
		let item = byId.get(id);
		if (!item) {
			item = { id, count: 0, mine: false };
			byId.set(id, item);
			order.push(item);
		}
		item.count += 1;
		if (pubkey === myPubkey) item.mine = true;
	}
	return order;
}

async function loadMessage(ownerPubkey, chatId, msgId) {
	return db.table("messages").where("[ownerPubkey+chatId+msgId]").equals([ownerPubkey, chatId, msgId]).first();
}

// Моя реакция: emojiId — id из набора; null — снять свою. Применяется локально сразу.
export async function reactToMessage(ownerPubkey, privKey, dbKey, contactPubkey, msgId, emojiId, lamportTs, publish) {
	const raw = await loadMessage(ownerPubkey, contactPubkey, msgId);
	if (!raw || raw.deleted) throw new DomainError("нельзя отреагировать на это сообщение", "errors.cannotReactToMessage");
	const id = emojiId === null ? null : sanitizeEmojiId(emojiId);
	if (emojiId !== null && !id) throw new DomainError("неизвестная реакция", "errors.cannotReactToMessage");
	const payload = id === null ? { id: "heart", on: false } : { id, on: true }; // id при снятии не важен, но обязателен в формате
	const result = await sendMessage(ownerPubkey, privKey, dbKey, contactPubkey, buildReactionText(msgId, payload.id, payload.on), lamportTs, publish);
	const target = fromEncryptedRow(raw, dbKey);
	const next = applyReactionToMap(target.reactions, ownerPubkey, payload, lamportTs);
	if (next) await db.table("messages").put(toEncryptedRow({ ...target, reactions: next }, MESSAGES_PLAINTEXT_FIELDS, dbKey));
	return result;
}

// Вызывается ПОСЛЕ расшифровки входящего в диспетчере transport.js (рядом с правкой/удалением): true — это была реакция.
export async function applyIncomingReactionIfMarker(ownerPubkey, dbKey, event, receivedResult) {
	if (!receivedResult) return false;
	const parsed = parseReactionText(receivedResult.text);
	if (!parsed) return false;

	const hTag = event.tags.find((t) => t[0] === "h");
	if (!hTag) return true; // это реакция, применять некуда
	const groupRaw = await db.table("mlsGroups").get([ownerPubkey, hTag[1]]);
	if (!groupRaw) return true;
	const groupRow = fromEncryptedRow(groupRaw, dbKey);

	// Реагирует собеседник (отправитель kind 445 эфемерный — личность берём из группы, как у правки/удаления).
	const reactorPubkey = groupRow.contactPubkey;
	const raw = await loadMessage(ownerPubkey, groupRow.contactPubkey, parsed.msgId);
	if (!raw || raw.deleted) return true; // реакция раньше исходного сообщения/на удалённое — отбрасываем, как правка

	const target = fromEncryptedRow(raw, dbKey);
	const next = applyReactionToMap(target.reactions, reactorPubkey, parsed, receivedResult.lamportTs);
	if (next) await db.table("messages").put(toEncryptedRow({ ...target, reactions: next }, MESSAGES_PLAINTEXT_FIELDS, dbKey));
	return true;
}
