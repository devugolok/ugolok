import "fake-indexeddb/auto";
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../src/core/store/database.js";
import { getPublicKey } from "../src/core/crypto/keys.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { unwrap as nip59Unwrap } from "../src/core/crypto/nip59.js";
import { createOwnKeyPackage, joinFromWelcome, serializeState } from "../src/core/crypto/mls-session.js";
import { ensureChatEstablished, receiveGroupMessageEvent, sendMessage, computeGroupId } from "../src/domain/messaging/chat.js";
import { buildReplyTo, sanitizeReplyTo, REPLY_EXCERPT_MAX } from "../src/domain/messaging/reply.js";
import {
	REACTION_MARKER_PREFIX,
	buildReactionText,
	parseReactionText,
	applyReactionToMap,
	summarizeReactions,
	reactToMessage,
	applyIncomingReactionIfMarker,
} from "../src/domain/messaging/reactions.js";
import { CONTROL_MARKER_PREFIXES, isControlText } from "../src/domain/messaging/control-markers.js";
import { EDIT_MARKER_PREFIX } from "../src/domain/messaging/edits.js";
import { DELETE_MARKER_PREFIX } from "../src/domain/messaging/deletions.js";
import { CURSOR_MARKER_PREFIX } from "../src/domain/messaging/peer-cursors.js";
import { loadChatWindow } from "../src/core/sync/lazy-chat.js";
import { getUnreadCount } from "../src/domain/messaging/read-status.js";
import { EMOJI_ITEMS, REACTION_IDS, emojiItem, sanitizeEmojiId } from "../src/domain/content/emoji-pack.js";
import { STICKER_KEYS, parseStickerKey, stickerMarker } from "../src/domain/content/sticker.js";
import { toEncryptedRow, fromEncryptedRow } from "../src/core/store/encrypted-table.js";
import { MLS_GROUPS_PLAINTEXT_FIELDS, MESSAGES_PLAINTEXT_FIELDS } from "../src/core/store/table-fields.js";

const ALICE_PRIV = new Uint8Array(32).fill(1);
const BOB_PRIV = new Uint8Array(32).fill(2);
const ALICE_PUB = bytesToHex(getPublicKey(ALICE_PRIV));
const BOB_PUB = bytesToHex(getPublicKey(BOB_PRIV));
const DB_KEY = crypto.getRandomValues(new Uint8Array(32));

before(async () => {
	await db.open();
});
beforeEach(async () => {
	for (const t of ["ownKeyPackage", "mlsGroups", "messages", "knownContactDevices", "chatSyncState"]) await db.table(t).clear();
});
after(() => db.close());

async function establishAliceToBob() {
	const bobKeyPackage = await createOwnKeyPackage(BOB_PUB, "bob-device");
	const fetchDeviceKeyPackages = async () => new Map([["bob-device", { wireBytes: bobKeyPackage.wireBytes, createdAt: 1000 }]]);
	const published = [];
	await ensureChatEstablished(ALICE_PUB, ALICE_PRIV, DB_KEY, BOB_PUB, async (e) => (published.push(e), { ok: true }), fetchDeviceKeyPackages);
	const rumor = nip59Unwrap(published.find((e) => e.kind === 1059), BOB_PRIV);
	const bobState = await joinFromWelcome(bobKeyPackage, Uint8Array.from(atob(rumor.content), (c) => c.charCodeAt(0)));
	return { groupIdHex: bytesToHex(computeGroupId(ALICE_PUB, BOB_PUB)), bobSerializedState: serializeState(bobState) };
}

async function asBob(groupIdHex, state, fn) {
	await db.table("mlsGroups").put(toEncryptedRow({ ownerPubkey: BOB_PUB, groupId: groupIdHex, contactPubkey: ALICE_PUB, state }, MLS_GROUPS_PLAINTEXT_FIELDS, DB_KEY));
	const result = await fn();
	const row = fromEncryptedRow(await db.table("mlsGroups").get([BOB_PUB, groupIdHex]), DB_KEY);
	return { result, state: row.state };
}

const HEX64 = "ab".repeat(32);
const MSGID = "0123456789abcdef0123456789abcdef";

// ---------- ответ на сообщение ----------

test("buildReplyTo/sanitizeReplyTo: выдержка обрезается, вложения считаются, мусор отбрасывается", () => {
	const msg = { msgId: MSGID, senderPubkey: HEX64, text: "x".repeat(500), attachments: [{}, {}] };
	const r = buildReplyTo(msg);
	assert.equal(r.msgId, MSGID);
	assert.ok(r.excerpt.length <= REPLY_EXCERPT_MAX);
	assert.equal(r.att, 2);
	assert.equal(buildReplyTo(msg, "только это").excerpt, "только это", "цитата выделенного фрагмента вместо текста сообщения");
	assert.equal(buildReplyTo({ text: "нет id" }), null);

	assert.deepEqual(sanitizeReplyTo(r), r);
	assert.equal(sanitizeReplyTo({ ...r, msgId: "<script>" }), null, "msgId не из hex — мусор");
	assert.equal(sanitizeReplyTo({ ...r, senderPubkey: "не-ключ" }), null);
	assert.equal(sanitizeReplyTo("строка"), null);
	assert.equal(sanitizeReplyTo(null), null);
	assert.equal(sanitizeReplyTo({ ...r, excerpt: 5 }).excerpt, "", "excerpt не строка — пустая выдержка, а не падение");
});

test("ответ доезжает до собеседника через MLS: replyTo в строке получателя, вид — обычное видимое сообщение", async () => {
	const { groupIdHex, bobSerializedState } = await establishAliceToBob();
	const sent = [];
	const publish = async (e) => (sent.push(e), { ok: true });
	await sendMessage(ALICE_PUB, ALICE_PRIV, DB_KEY, BOB_PUB, "первое", 1, publish);
	const original = fromEncryptedRow(await db.table("messages").where("[ownerPubkey+chatId]").equals([ALICE_PUB, BOB_PUB]).first(), DB_KEY);

	const replyTo = buildReplyTo({ msgId: original.msgId, senderPubkey: ALICE_PUB, text: original.text });
	sent.length = 0;
	await sendMessage(ALICE_PUB, ALICE_PRIV, DB_KEY, BOB_PUB, "это ответ", 2, publish, undefined, undefined, undefined, { replyTo });

	const mine = (await db.table("messages").where("[ownerPubkey+chatId]").equals([ALICE_PUB, BOB_PUB]).toArray()).map((r) => fromEncryptedRow(r, DB_KEY));
	assert.deepEqual(mine.find((m) => m.text === "это ответ").replyTo, replyTo, "у отправителя ссылка сохранена");

	const event = sent.find((e) => e.kind === 445);
	await asBob(groupIdHex, bobSerializedState, () => receiveGroupMessageEvent(BOB_PUB, BOB_PRIV, DB_KEY, event, async () => ({ ok: true })));
	const bobRows = (await db.table("messages").where("[ownerPubkey+chatId]").equals([BOB_PUB, ALICE_PUB]).toArray()).map((r) => fromEncryptedRow(r, DB_KEY));
	const got = bobRows.find((m) => m.text === "это ответ");
	assert.deepEqual(got.replyTo, replyTo, "получатель видит, на какое сообщение ответили");
});

test("враждебный replyTo от собеседника не ломает приём: сообщение показывается без цитаты", async () => {
	const { groupIdHex, bobSerializedState } = await establishAliceToBob();
	const sent = [];
	await sendMessage(ALICE_PUB, ALICE_PRIV, DB_KEY, BOB_PUB, "с мусорной ссылкой", 1, async (e) => (sent.push(e), { ok: true }), undefined, undefined, undefined, { replyTo: { msgId: "<img onerror>", senderPubkey: "x" } });
	const mine = fromEncryptedRow(await db.table("messages").where("[ownerPubkey+chatId]").equals([ALICE_PUB, BOB_PUB]).first(), DB_KEY);
	assert.equal(mine.replyTo, undefined, "негодная ссылка отбрасывается уже у отправителя");
	await asBob(groupIdHex, bobSerializedState, () => receiveGroupMessageEvent(BOB_PUB, BOB_PRIV, DB_KEY, sent.find((e) => e.kind === 445), async () => ({ ok: true })));
	const bobRow = fromEncryptedRow(await db.table("messages").where("[ownerPubkey+chatId]").equals([BOB_PUB, ALICE_PUB]).first(), DB_KEY);
	assert.equal(bobRow.text, "с мусорной ссылкой");
	assert.equal(bobRow.replyTo, undefined);
});

// ---------- реакции ----------

test("маркер реакции: round-trip, мусор/неизвестная форма id не распознаются", () => {
	const text = buildReactionText(MSGID, "thumbs-up", true);
	assert.ok(text.startsWith(REACTION_MARKER_PREFIX));
	assert.deepEqual(parseReactionText(text), { msgId: MSGID, id: "thumbs-up", on: true });
	assert.equal(parseReactionText(buildReactionText(MSGID, "heart", false)).on, false);
	assert.equal(parseReactionText("обычное сообщение"), null);
	assert.equal(parseReactionText(REACTION_MARKER_PREFIX + "{не json"), null);
	assert.equal(parseReactionText(REACTION_MARKER_PREFIX + JSON.stringify({ msgId: MSGID, id: "ПЛОХОЙ id!" })), null, "id не из безопасной формы");
	assert.equal(parseReactionText(REACTION_MARKER_PREFIX + JSON.stringify({ msgId: 5, id: "heart" })), null);
	assert.equal(parseReactionText(buildReactionText(MSGID, "future-set-id")).id, "future-set-id", "корректный, но неизвестный набору id не теряется");
});

test("applyReactionToMap: одна реакция на человека, смена, снятие, LWW по Lamport-времени", () => {
	let m = applyReactionToMap({}, "bob", { id: "heart", on: true }, 5);
	assert.deepEqual(m, { bob: { id: "heart", ts: 5 } });
	m = applyReactionToMap(m, "bob", { id: "fire", on: true }, 7);
	assert.deepEqual(m, { bob: { id: "fire", ts: 7 } }, "смена реакции заменяет прежнюю");
	assert.equal(applyReactionToMap(m, "bob", { id: "heart", on: true }, 6), null, "более старое событие отброшено (LWW)");
	assert.equal(applyReactionToMap(m, "bob", { id: "heart", on: true }, 7), null, "равное — тоже (идемпотентность)");
	assert.deepEqual(applyReactionToMap(m, "bob", { id: "fire", on: false }, 9), {}, "снятие");
	assert.deepEqual(applyReactionToMap(undefined, "bob", { id: "heart", on: true }, 1), { bob: { id: "heart", ts: 1 } });
});

test("summarizeReactions: счётчики по id в порядке появления, mine — моя реакция", () => {
	const s = summarizeReactions({ a: { id: "heart", ts: 1 }, b: { id: "fire", ts: 2 }, me: { id: "heart", ts: 3 } }, "me");
	assert.deepEqual(s, [
		{ id: "heart", count: 2, mine: true },
		{ id: "fire", count: 1, mine: false },
	]);
	assert.deepEqual(summarizeReactions(undefined, "me"), []);
});

test("реакция Алисы доезжает до Боба: применяется к его строке, в ленту и в «непрочитанное» не попадает", async () => {
	const { groupIdHex, bobSerializedState } = await establishAliceToBob();
	const aliceSent = [];
	const publish = async (e) => (aliceSent.push(e), { ok: true });

	// Боб пишет Алисе, затем Алиса реагирует на сообщение Боба. Для простоты Бобу достаточно строки сообщения Боба у себя и у Алисы.
	await db.table("messages").add(toEncryptedRow({ ownerPubkey: BOB_PUB, chatId: ALICE_PUB, lamportTs: 1, senderPubkey: BOB_PUB, id: "bob-evt", text: "привет от Боба", status: "sent", msgId: MSGID }, MESSAGES_PLAINTEXT_FIELDS, DB_KEY));
	await db.table("messages").add(toEncryptedRow({ ownerPubkey: ALICE_PUB, chatId: BOB_PUB, lamportTs: 1, senderPubkey: BOB_PUB, id: "bob-evt", text: "привет от Боба", status: "sent", msgId: MSGID }, MESSAGES_PLAINTEXT_FIELDS, DB_KEY));

	await reactToMessage(ALICE_PUB, ALICE_PRIV, DB_KEY, BOB_PUB, MSGID, "thumbs-up", 5, publish);
	const aliceRow = fromEncryptedRow(await db.table("messages").where("[ownerPubkey+chatId+msgId]").equals([ALICE_PUB, BOB_PUB, MSGID]).first(), DB_KEY);
	assert.deepEqual(aliceRow.reactions, { [ALICE_PUB]: { id: "thumbs-up", ts: 5 } }, "своя реакция видна сразу (оптимистично)");

	const event = aliceSent.find((e) => e.kind === 445);
	const { result: received } = await asBob(groupIdHex, bobSerializedState, () => receiveGroupMessageEvent(BOB_PUB, BOB_PRIV, DB_KEY, event, async () => ({ ok: true })));
	assert.equal(await applyIncomingReactionIfMarker(BOB_PUB, DB_KEY, event, received), true);

	const bobRow = fromEncryptedRow(await db.table("messages").where("[ownerPubkey+chatId+msgId]").equals([BOB_PUB, ALICE_PUB, MSGID]).first(), DB_KEY);
	assert.deepEqual(bobRow.reactions, { [ALICE_PUB]: { id: "thumbs-up", ts: 5 } }, "Боб видит реакцию Алисы под своим сообщением");

	const window = await loadChatWindow(BOB_PUB, ALICE_PUB, DB_KEY);
	assert.ok(window.messages.every((m) => !String(m.text).startsWith(REACTION_MARKER_PREFIX)), "маркер реакции в ленту не попадает");
	assert.equal(await getUnreadCount(BOB_PUB, ALICE_PUB), 0, "реакция не считается непрочитанным сообщением");
});

test("реакция на удалённое/несуществующее сообщение: отправить нельзя; пришедшая — тихо отбрасывается", async () => {
	await assert.rejects(() => reactToMessage(ALICE_PUB, ALICE_PRIV, DB_KEY, BOB_PUB, MSGID, "heart", 1, async () => ({ ok: true })), /нельзя отреагировать/);
	const hTag = ["h", "cc".repeat(32)];
	await db.table("mlsGroups").put(toEncryptedRow({ ownerPubkey: BOB_PUB, groupId: hTag[1], contactPubkey: ALICE_PUB, state: "unused" }, MLS_GROUPS_PLAINTEXT_FIELDS, DB_KEY));
	assert.equal(await applyIncomingReactionIfMarker(BOB_PUB, DB_KEY, { tags: [hTag] }, { text: buildReactionText("нет-такого", "heart"), lamportTs: 3 }), true, "это реакция (не показывать как сообщение), применять некуда");
	assert.equal(await applyIncomingReactionIfMarker(BOB_PUB, DB_KEY, { tags: [hTag] }, { text: "обычный текст", lamportTs: 3 }), false);
});

// ---------- служебные сообщения и набор emoji ----------

test("служебные префиксы: единый список совпадает с модулями, isControlText их различает", () => {
	assert.deepEqual([...CONTROL_MARKER_PREFIXES].sort(), [EDIT_MARKER_PREFIX, DELETE_MARKER_PREFIX, CURSOR_MARKER_PREFIX, REACTION_MARKER_PREFIX].sort());
	assert.equal(isControlText(buildReactionText(MSGID, "heart")), true);
	assert.equal(isControlText("обычное сообщение"), false);
	assert.equal(isControlText(undefined), false);
});

test("набор emoji: id уникальны и безопасны, 16 реакций из набора, старые стикеры читаются, ничего не потеряно", () => {
	const ids = EMOJI_ITEMS.map((i) => i.id);
	assert.equal(new Set(ids).size, ids.length, "id уникальны");
	assert.ok(ids.every((id) => sanitizeEmojiId(id) === id && !/\d/.test(id)), "id безопасной формы (и совместимы с шаблоном :sticker:id:)");
	assert.equal(REACTION_IDS.length, 16);
	assert.ok(REACTION_IDS.every((id) => emojiItem(id)), "каждая реакция есть в наборе");
	// 18 id прежнего набора Phosphor обязаны остаться: старые сообщения `:sticker:<id>:` должны распознаваться
	for (const old of ["smiley", "smiley-wink", "smiley-meh", "smiley-nervous", "smiley-sad", "smiley-angry", "smiley-melting", "smiley-x-eyes", "heart", "hand-heart", "thumbs-up", "thumbs-down", "hand-peace", "hand-fist", "hands-clapping", "hands-praying", "handshake", "confetti"]) {
		assert.equal(parseStickerKey(stickerMarker(old)), old, `старый стикер ${old} должен читаться`);
	}
	assert.deepEqual(STICKER_KEYS, ids, "стикеры = набор emoji, один источник");
	assert.equal(parseStickerKey(":sticker:нет-такого:"), null);
	assert.equal(parseStickerKey(stickerMarker("fire")), "fire", "новый emoji тоже стикер");
});
