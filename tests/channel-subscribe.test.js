import "fake-indexeddb/auto";
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../src/core/store/database.js";
import { getPublicKey } from "../src/core/crypto/keys.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
	createChannel,
	receiveChannelKeyGrant,
	receiveAllowlistUpdate,
	subscribeToChannelAction,
	unsubscribeFromChannelAction,
	listSubscribedChannels,
	listAvailableChannels,
} from "../src/domain/content/channel.js";
import { handleIncomingSubscribeRequest, handleIncomingUnsubscribeRequest } from "../src/domain/content/channel-access.js";
import { addComment, receiveComment, getCommentsTree } from "../src/domain/content/comments.js";
import { fromEncryptedRow } from "../src/core/store/encrypted-table.js";

// Правка 2 (живой тест с Евгением): «Подписаться» срабатывает СРАЗУ, без участия админа.

const ALICE_PRIV = new Uint8Array(32).fill(1);
const BOB_PRIV = new Uint8Array(32).fill(2);
const ALICE_PUB = bytesToHex(getPublicKey(ALICE_PRIV));
const BOB_PUB = bytesToHex(getPublicKey(BOB_PRIV));
const DB_KEY = crypto.getRandomValues(new Uint8Array(32));

before(async () => {
	await db.open();
});

beforeEach(async () => {
	for (const t of ["channels", "channelKeys", "channelKeyMeta", "commentAllowlists", "groups", "groupMembers", "comments", "channelReaders", "channelVisibilityGroups"]) {
		await db.table(t).clear();
	}
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

// Алиса — владелец, Боб видит канал («Доступные»), но не подписан.
async function setupBobSeesChannel() {
	await db.table("groups").add({ owner: ALICE_PUB, id: "friends", name: "Друзья" });
	await db.table("groupMembers").add({ groupId: "friends", pubkey: BOB_PUB });
	const published = [];
	const { channelId } = await createChannel(ALICE_PUB, ALICE_PRIV, DB_KEY, { name: "К", description: "d", rules: "" }, ["friends"], capturingPublish(published));
	const grantEvent = published.find((e) => e.kind === 30053 && e.tags.some((t) => t[0] === "p" && t[1] === BOB_PUB));
	await receiveChannelKeyGrant(BOB_PUB, BOB_PRIV, DB_KEY, ALICE_PUB, grantEvent);
	// Боб и Алиса в этом тесте делят одну БД (fake-indexeddb) — owner-scoping строк по ownerPubkey.
	return { channelId, published };
}

test("subscribeToChannelAction: роль subscriber СРАЗУ, владелец не нужен (никакого allowlist от него не ждём)", async () => {
	const { channelId } = await setupBobSeesChannel();
	assert.equal((await listAvailableChannels(BOB_PUB, DB_KEY)).length, 1);

	const sent = [];
	const result = await subscribeToChannelAction(BOB_PUB, BOB_PRIV, channelId, capturingPublish(sent));

	assert.equal(result.notified, true);
	assert.equal((await listSubscribedChannels(BOB_PUB, DB_KEY)).length, 1, "канал сразу в «Подписки»");
	assert.equal((await listAvailableChannels(BOB_PUB, DB_KEY)).length, 0, "и ушёл из «Доступные»");
	assert.equal(sent.length, 1, "владельцу уходит ровно один приватный сигнал (для списка подписчиков)");
	assert.equal(sent[0].kind, 1059);
});

test("subscribeToChannelAction: сбой отправки владельцу НЕ отменяет подписку (notified:false)", async () => {
	const { channelId } = await setupBobSeesChannel();
	const result = await subscribeToChannelAction(BOB_PUB, BOB_PRIV, channelId, async () => ({ ok: false, reason: "relay down" }));
	assert.equal(result.notified, false);
	assert.equal((await listSubscribedChannels(BOB_PUB, DB_KEY)).length, 1, "подписка локальна и не зависит от сети");
});

test("subscribeToChannelAction: повторный вызов у уже подписанного — no-op, второй сигнал не шлётся", async () => {
	const { channelId } = await setupBobSeesChannel();
	await subscribeToChannelAction(BOB_PUB, BOB_PRIV, channelId, capturingPublish([]));
	const sent = [];
	await subscribeToChannelAction(BOB_PUB, BOB_PRIV, channelId, capturingPublish(sent));
	assert.equal(sent.length, 0);
});

test("unsubscribeFromChannelAction: канал возвращается в «Доступные», владельцу уходит сигнал", async () => {
	const { channelId } = await setupBobSeesChannel();
	await subscribeToChannelAction(BOB_PUB, BOB_PRIV, channelId, capturingPublish([]));

	const sent = [];
	const result = await unsubscribeFromChannelAction(BOB_PUB, BOB_PRIV, channelId, capturingPublish(sent));

	assert.equal(result.notified, true);
	assert.equal((await listSubscribedChannels(BOB_PUB, DB_KEY)).length, 0);
	assert.equal((await listAvailableChannels(BOB_PUB, DB_KEY)).length, 1, "снова в «Доступные»");
	assert.equal(sent.length, 1);
});

test("отписался -> запоздавший allowlist владельца (где Боб ещё есть) НЕ возвращает подписку", async () => {
	const { channelId } = await setupBobSeesChannel();
	// Владелец успел учесть подписку Боба (allowlist с ним) — как в реальной сети.
	const published = [];
	await handleIncomingSubscribeRequest(ALICE_PUB, ALICE_PRIV, DB_KEY, channelId, BOB_PUB, capturingPublish(published));
	const allowlistEvent = published.find((e) => e.kind === 30054);
	assert.ok(allowlistEvent, "владелец учёл подписчика");

	await subscribeToChannelAction(BOB_PUB, BOB_PRIV, channelId, capturingPublish([]));
	await unsubscribeFromChannelAction(BOB_PUB, BOB_PRIV, channelId, capturingPublish([]));

	await receiveAllowlistUpdate(BOB_PUB, DB_KEY, BOB_PUB, allowlistEvent);
	assert.equal((await listSubscribedChannels(BOB_PUB, DB_KEY)).length, 0, "роль не должна вернуться против воли человека");

	// ...а повторная подписка снимает запрет и работает как обычно.
	await subscribeToChannelAction(BOB_PUB, BOB_PRIV, channelId, capturingPublish([]));
	assert.equal((await listSubscribedChannels(BOB_PUB, DB_KEY)).length, 1);
});

test("handleIncomingUnsubscribeRequest: владелец убирает Боба из списка; повтор — идемпотентно (не публикует лишнего)", async () => {
	const { channelId } = await setupBobSeesChannel();
	await handleIncomingSubscribeRequest(ALICE_PUB, ALICE_PRIV, DB_KEY, channelId, BOB_PUB, capturingPublish([]));

	const first = [];
	await handleIncomingUnsubscribeRequest(ALICE_PUB, ALICE_PRIV, DB_KEY, channelId, BOB_PUB, capturingPublish(first));
	assert.equal(first.filter((e) => e.kind === 30054).length, 1);
	const meta = fromEncryptedRow(await db.table("channelKeyMeta").get([ALICE_PUB, channelId]), DB_KEY);
	const row = fromEncryptedRow(await db.table("commentAllowlists").get([ALICE_PUB, channelId, meta.currentVersion]), DB_KEY);
	assert.deepEqual(row.allowedAuthors, []);

	const second = [];
	await handleIncomingUnsubscribeRequest(ALICE_PUB, ALICE_PRIV, DB_KEY, channelId, BOB_PUB, capturingPublish(second));
	assert.equal(second.length, 0);
});

test("подписчик, которого владелец не успел учесть (офлайн), всё равно может комментировать — и владелец принимает", async () => {
	const { channelId } = await setupBobSeesChannel();
	await subscribeToChannelAction(BOB_PUB, BOB_PRIV, channelId, capturingPublish([])); // владелец НИЧЕГО не обработал
	const postId = "post-1";
	const published = [];
	await addComment(BOB_PUB, BOB_PRIV, DB_KEY, channelId, postId, postId, "пишу сразу", [], capturingPublish(published));
	const event = published.find((e) => e.kind === 30062);
	const applied = await receiveComment(ALICE_PUB, DB_KEY, event);
	assert.equal(applied, true);
	assert.equal((await getCommentsTree(ALICE_PUB, DB_KEY, postId)).length, 1);
});

test("АДВЕРСАРНО: подделанное/чужим ключом событие не принимается — право писать держится на владении ключом", async () => {
	const { channelId } = await setupBobSeesChannel();
	await subscribeToChannelAction(BOB_PUB, BOB_PRIV, channelId, capturingPublish([]));
	const published = [];
	await addComment(BOB_PUB, BOB_PRIV, DB_KEY, channelId, "p", "p", "текст", [], capturingPublish(published));
	const event = published.find((e) => e.kind === 30062);
	// Портим шифртекст: без правильного ключа AEAD не сойдётся.
	const bytes = Uint8Array.from(atob(event.content), (c) => c.charCodeAt(0));
	bytes[bytes.length - 1] ^= 0xff;
	const forged = { ...event, content: btoa(String.fromCharCode(...bytes)) };
	await assert.rejects(() => receiveComment(ALICE_PUB, DB_KEY, forged));
	assert.equal((await getCommentsTree(ALICE_PUB, DB_KEY, "p")).length, 0);
});
