import "fake-indexeddb/auto";
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../src/core/store/database.js";
import { getPublicKey } from "../src/core/crypto/keys.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { createChannel, receiveChannelKeyGrant } from "../src/domain/content/channel.js";
import { sendViewGrant, handleIncomingSubscribeRequest } from "../src/domain/content/channel-access.js";
import { sendChannelMessage, receiveChannelMessage } from "../src/domain/content/channel-chat.js";
import { loadChannelChatWindow } from "../src/core/sync/lazy-channel.js";
import { fromEncryptedRow } from "../src/core/store/encrypted-table.js";
import { setReaction, receiveReaction, listReactionsForChat, aggregateReactions } from "../src/domain/content/reactions.js";
import { addComment, receiveComment, getCommentsTree } from "../src/domain/content/comments.js";

const ALICE_PRIV = new Uint8Array(32).fill(1);
const BOB_PRIV = new Uint8Array(32).fill(2);
const MALLORY_PRIV = new Uint8Array(32).fill(3);
const ALICE_PUB = bytesToHex(getPublicKey(ALICE_PRIV));
const BOB_PUB = bytesToHex(getPublicKey(BOB_PRIV));
const MALLORY_PUB = bytesToHex(getPublicKey(MALLORY_PRIV));
const DB_KEY = crypto.getRandomValues(new Uint8Array(32));

before(async () => {
	await db.open();
});

beforeEach(async () => {
	await db.table("channels").clear();
	await db.table("channelKeys").clear();
	await db.table("channelKeyMeta").clear();
	await db.table("commentAllowlists").clear();
	await db.table("groups").clear();
	await db.table("groupMembers").clear();
	await db.table("channelMessages").clear();
	await db.table("channelReactions").clear();
	await db.table("comments").clear();
});

after(() => {
	db.close();
});

function capturingPublish(bucket) {
	return async (event) => {
		bucket.push(event);
		return { ok: true };
	};
}

async function setupChannelWithBobSubscribed(options = {}) {
	await db.table("groups").add({ owner: ALICE_PUB, id: "friends", name: "Друзья" });
	await db.table("groupMembers").add({ groupId: "friends", pubkey: BOB_PUB });
	const published = [];
	const { channelId } = await createChannel(ALICE_PUB, ALICE_PRIV, DB_KEY, { name: "К", description: "d", rules: "", ...options }, ["friends"], capturingPublish(published));
	const grantEvent = published.find((e) => e.kind === 30053);
	await receiveChannelKeyGrant(BOB_PUB, BOB_PRIV, DB_KEY, ALICE_PUB, grantEvent);
	await handleIncomingSubscribeRequest(ALICE_PUB, ALICE_PRIV, DB_KEY, channelId, BOB_PUB, capturingPublish([]));
	// Бобу тоже нужна строка channels с правильным allowChatAttachments — обычно это
	// приходит через receiveChannelMetadata (этап 30), здесь проставляем напрямую, раз
	// это не предмет теста channel-chat.js.
	if (options.allowChatAttachments !== undefined) {
		await db.table("channels").update([BOB_PUB, channelId], { allowChatAttachments: options.allowChatAttachments });
	}
	return { channelId };
}

async function grantViewTo(channelId, targetPubkey) {
	const aliceKeyRow = fromEncryptedRow(await db.table("channelKeys").get([ALICE_PUB, channelId, 1]), DB_KEY);
	const aliceChannelRow = await db.table("channels").get([ALICE_PUB, channelId]);
	const grantPublish = [];
	await sendViewGrant(
		ALICE_PUB,
		ALICE_PRIV,
		{ channelId, channelTopic: aliceChannelRow.channelTopic, channelKey: aliceKeyRow.channelKey },
		targetPubkey,
		1,
		capturingPublish(grantPublish),
	);
	return grantPublish[0];
}

// AC-16 (найдено пользователем прямым осмотром IndexedDB) — пользователь буквально
// увидел "Добро пожаловать в общий чат!" открытым текстом в этой таблице.
test("AC-16: channelMessages хранится зашифрованным — сырой дамп не содержит text/attachments", async () => {
	const { channelId } = await setupChannelWithBobSubscribed();
	const { messageId } = await sendChannelMessage(BOB_PUB, BOB_PRIV, DB_KEY, channelId, "секретное сообщение", [], capturingPublish([]));
	const raw = await db.table("channelMessages").get([BOB_PUB, messageId]);
	assert.equal(raw.id, messageId);
	assert.equal("text" in raw, false);
	assert.equal("attachments" in raw, false);
	assert.ok(raw.nonce instanceof Uint8Array);
	assert.ok(raw.ciphertext instanceof Uint8Array);

	const decrypted = fromEncryptedRow(raw, DB_KEY);
	assert.equal(decrypted.text, "секретное сообщение");
});

test("sendChannelMessage/receiveChannelMessage: Боб (подписчик с COMMENT) пишет в чат, Алиса получает", async () => {
	const { channelId } = await setupChannelWithBobSubscribed();
	const published = [];
	const { messageId } = await sendChannelMessage(BOB_PUB, BOB_PRIV, DB_KEY, channelId, "привет всем", [], capturingPublish(published));

	const event = published.find((e) => e.kind === 30063);
	assert.ok(event);
	assert.deepEqual(event.tags.find((t) => t[0] === "d"), ["d", `${channelId}:${messageId}`]);

	const applied = await receiveChannelMessage(ALICE_PUB, DB_KEY, event);
	assert.equal(applied, true);
	const { messages } = await loadChannelChatWindow(ALICE_PUB, DB_KEY, channelId, { limit: 15 });
	assert.equal(messages.length, 1);
	assert.equal(messages[0].text, "привет всем");
});

test("Владелец канала может писать в чат СВОЕГО канала, даже не будучи в commentAllowlists", async () => {
	const { channelId } = await setupChannelWithBobSubscribed();
	const published = [];
	await sendChannelMessage(ALICE_PUB, ALICE_PRIV, DB_KEY, channelId, "сообщение от владельца", [], capturingPublish(published));
	const event = published.find((e) => e.kind === 30063);

	const applied = await receiveChannelMessage(BOB_PUB, DB_KEY, event);
	assert.equal(applied, true, "владелец канала имплицитно всегда имеет право писать в чат");
});

test("Держатель ключа канала без подписки пишет в чат — принято (право писать = владение ключом, не список владельца)", async () => {
	const { channelId } = await setupChannelWithBobSubscribed();
	const grantEvent = await grantViewTo(channelId, MALLORY_PUB);
	await receiveChannelKeyGrant(MALLORY_PUB, MALLORY_PRIV, DB_KEY, ALICE_PUB, grantEvent);

	const published = [];
	await sendChannelMessage(MALLORY_PUB, MALLORY_PRIV, DB_KEY, channelId, "спам без права", [], capturingPublish(published));
	const event = published.find((e) => e.kind === 30063);

	const applied = await receiveChannelMessage(ALICE_PUB, DB_KEY, event);
	assert.equal(applied, true, "держатель ключа канала (VIEW выдан группой владельца) может писать — подписка не требует одобрения владельца");
	assert.equal((await loadChannelChatWindow(ALICE_PUB, DB_KEY, channelId, { limit: 15 })).messages.length, 1);
});

test("allowChatAttachments=false: вложение обрезается на приёме, текст сообщения остаётся", async () => {
	const { channelId } = await setupChannelWithBobSubscribed({ allowChatAttachments: false });
	const published = [];
	await sendChannelMessage(BOB_PUB, BOB_PRIV, DB_KEY, channelId, "вот файл", [{ sha256: "abc", mime: "image/png" }], capturingPublish(published));
	const event = published.find((e) => e.kind === 30063);

	const applied = await receiveChannelMessage(ALICE_PUB, DB_KEY, event);
	assert.equal(applied, true);
	const { messages } = await loadChannelChatWindow(ALICE_PUB, DB_KEY, channelId, { limit: 15 });
	assert.equal(messages[0].text, "вот файл", "текст сохраняется");
	assert.deepEqual(messages[0].attachments, [], "вложение обрезано политикой канала, не отброшено всё сообщение");
});

test("allowChatAttachments=true (default): вложение сохраняется на приёме", async () => {
	const { channelId } = await setupChannelWithBobSubscribed();
	const published = [];
	await sendChannelMessage(BOB_PUB, BOB_PRIV, DB_KEY, channelId, "вот файл", [{ sha256: "abc", mime: "image/png" }], capturingPublish(published));
	const event = published.find((e) => e.kind === 30063);

	await receiveChannelMessage(ALICE_PUB, DB_KEY, event);
	const { messages } = await loadChannelChatWindow(ALICE_PUB, DB_KEY, channelId, { limit: 15 });
	assert.equal(messages[0].attachments.length, 1);
});

// Ответ/цитата в сообщении общего чата канала: replyTo едет ВНУТРИ зашифрованного сообщения.
test("replyTo в сообщении чата канала: доходит до получателя, хранится зашифрованным, негодный отбрасывается", async () => {
	const { channelId } = await setupChannelWithBobSubscribed();
	const published = [];
	const replyTo = { msgId: "11111111-2222-3333-4444-555555555555", senderPubkey: ALICE_PUB, excerpt: "исходный текст", att: 2 };
	const { messageId } = await sendChannelMessage(BOB_PUB, BOB_PRIV, DB_KEY, channelId, "согласен", [], capturingPublish(published), { replyTo });
	const raw = await db.table("channelMessages").get([BOB_PUB, messageId]);
	assert.equal("replyTo" in raw, false, "replyTo не лежит открытым текстом");

	const event = published.find((e) => e.kind === 30063);
	assert.equal(await receiveChannelMessage(ALICE_PUB, DB_KEY, event), true);
	const { messages } = await loadChannelChatWindow(ALICE_PUB, DB_KEY, channelId, { limit: 15 });
	assert.deepEqual(messages[0].replyTo, replyTo);

	// негодная ссылка (чужая форма) молча отбрасывается — сообщение остаётся
	const { messageId: id2 } = await sendChannelMessage(BOB_PUB, BOB_PRIV, DB_KEY, channelId, "без цитаты", [], capturingPublish([]), { replyTo: { msgId: "<script>", senderPubkey: "x" } });
	const row2 = fromEncryptedRow(await db.table("channelMessages").get([BOB_PUB, id2]), DB_KEY);
	assert.equal(row2.replyTo, undefined);
});

test("реакция на сообщение чата канала: ставится, принимается другим участником, агрегируется; на чужое/несуществующее — нет", async () => {
	const { channelId } = await setupChannelWithBobSubscribed();
	const msgEvents = [];
	const { messageId } = await sendChannelMessage(ALICE_PUB, ALICE_PRIV, DB_KEY, channelId, "привет", [], capturingPublish(msgEvents));
	// Боб получил сообщение
	await receiveChannelMessage(BOB_PUB, DB_KEY, msgEvents.find((e) => e.kind === 30063));

	const published = [];
	await setReaction(BOB_PUB, BOB_PRIV, DB_KEY, channelId, "chat_message", messageId, channelId, "🔥", capturingPublish(published));
	const own = aggregateReactions(await listReactionsForChat(BOB_PUB, DB_KEY, channelId), BOB_PUB);
	assert.deepEqual(own, { counts: { "🔥": 1 }, mine: "🔥" });

	const event = published.find((e) => e.kind === 30067);
	// Алиса получила своё сообщение при отправке
	assert.equal(await receiveReaction(ALICE_PUB, DB_KEY, event), true);
	const seenByAlice = aggregateReactions(await listReactionsForChat(ALICE_PUB, DB_KEY, channelId), ALICE_PUB);
	assert.deepEqual(seenByAlice, { counts: { "🔥": 1 }, mine: null });

	// снятие реакции
	const removed = [];
	await setReaction(BOB_PUB, BOB_PRIV, DB_KEY, channelId, "chat_message", messageId, channelId, null, capturingPublish(removed));
	assert.deepEqual(aggregateReactions(await listReactionsForChat(BOB_PUB, DB_KEY, channelId), BOB_PUB), { counts: {}, mine: null });

	// на сообщение, которого нет у получателя — не применяется
	const ghost = [];
	await setReaction(BOB_PUB, BOB_PRIV, DB_KEY, channelId, "chat_message", "00000000-0000-0000-0000-000000000000", channelId, "👍", capturingPublish(ghost));
	assert.equal(await receiveReaction(ALICE_PUB, DB_KEY, ghost.find((e) => e.kind === 30067)), false);
});

test("replyTo в комментарии (цитата выделенного): доходит до получателя", async () => {
	const { channelId } = await setupChannelWithBobSubscribed();
	const published = [];
	const replyTo = { msgId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", senderPubkey: ALICE_PUB, excerpt: "кусок" };
	await addComment(BOB_PUB, BOB_PRIV, DB_KEY, channelId, "post-1", "post-1", "ответ", [], capturingPublish(published), { replyTo });
	const event = published.find((e) => e.kind === 30062);
	assert.equal(await receiveComment(ALICE_PUB, DB_KEY, event), true);
	const tree = await getCommentsTree(ALICE_PUB, DB_KEY, "post-1");
	assert.deepEqual(tree[0].replyTo, replyTo);
});

test("reactionRowsToMap/emojiIdToChannelReaction: строки реакций канала -> карта пузыря; снятые и чужие символы пропускаются", async () => {
	const { reactionRowsToMap, emojiIdToChannelReaction } = await import("../src/domain/content/reactions.js");
	const map = reactionRowsToMap([
		{ reactorPubkey: "a", emoji: "🔥", createdAt: 5 },
		{ reactorPubkey: "b", emoji: "❤️", createdAt: 6, lastEventCreatedAt: 9 },
		{ reactorPubkey: "c", emoji: null, createdAt: 7 },
		{ reactorPubkey: "d", emoji: "🦄", createdAt: 8 },
	]);
	assert.deepEqual(map, { a: { id: "fire", ts: 5 }, b: { id: "heart", ts: 9 } });
	assert.equal(emojiIdToChannelReaction("fire"), "🔥");
	assert.equal(emojiIdToChannelReaction("sparkles"), null, "не из набора реакций");
	assert.equal(emojiIdToChannelReaction(null), null);
});
