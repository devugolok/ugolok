import { test } from "node:test";
import assert from "node:assert/strict";
import { bytesToHex } from "@noble/hashes/utils.js";
import { getPublicKey } from "../../src/core/crypto/keys.js";
import { createFakeRelay } from "./fake-relay.js";
import { createWsBridge } from "./ws-bridge.js";
import { spawnDevice } from "./scenario.js";

// Правка 2 (живой тест с Евгением): «Подписаться» должна сразу делать контакта
// подписчиком. Сценарий: админ (Alice) создаёт канал для группы с Bob, Bob видит
// канал в «Доступные», жмёт «Подписаться» -> канал переезжает в «Подписки».

const ALICE_PRIV_HEX = bytesToHex(new Uint8Array(32).fill(5));
const BOB_PRIV_HEX = bytesToHex(new Uint8Array(32).fill(6));
const ALICE_PUB = bytesToHex(getPublicKey(new Uint8Array(32).fill(5)));
const BOB_PUB = bytesToHex(getPublicKey(new Uint8Array(32).fill(6)));

async function waitFor(device, pred, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	let last;
	while (Date.now() < deadline) {
		last = await device.call("channelLists");
		if (pred(last)) return last;
		await new Promise((r) => setTimeout(r, 100));
	}
	return last;
}

async function setupDevices(t) {
	let bridge;
	const relay = createFakeRelay({ onDeliver: (connId, msg) => bridge.deliver(connId, msg) });
	bridge = createWsBridge(relay, { port: 0 });
	const { port } = await bridge.start();
	const relayUrl = `ws://127.0.0.1:${port}`;
	const alice = spawnDevice();
	const bob = spawnDevice();
	const pump = setInterval(() => relay.flushAll(), 5);
	t.after(async () => {
		clearInterval(pump);
		alice.kill();
		bob.kill();
		await bridge.stop();
	});
	await alice.call("init", { privKeyHex: ALICE_PRIV_HEX, relayUrl });
	await bob.call("init", { privKeyHex: BOB_PRIV_HEX, relayUrl });
	await alice.call("becomeContact", { peerPubkey: BOB_PUB });
	await bob.call("becomeContact", { peerPubkey: ALICE_PUB });
	return { alice, bob };
}

test("Подписка: канал создан сразу с группой -> «Подписаться» -> «Подписки»", { timeout: 40000 }, async (t) => {
	const { alice, bob } = await setupDevices(t);
	await alice.call("connect");
	await bob.call("connect");
	const { channelId } = await alice.call("createChannelForMember", { name: "Канал", memberPubkey: BOB_PUB });
	const seen = await waitFor(bob, (l) => l.available.length === 1, 10000);
	assert.equal(seen.available.length, 1, "Bob обязан увидеть канал в «Доступные»: " + JSON.stringify(seen));
	await bob.call("subscribe", { channelId });
	const after = await waitFor(bob, (l) => l.subscribed.length === 1, 10000);
	assert.equal(after.subscribed.length, 1, "после «Подписаться» канал обязан стать подпиской: " + JSON.stringify(after));
	assert.equal(after.available.length, 0);
});

test("Подписка мгновенна, даже когда админ уже ушёл из сети (правка 2)", { timeout: 40000 }, async (t) => {
	const { alice, bob } = await setupDevices(t);
	await alice.call("connect");
	const { channelId } = await alice.call("createChannelForMember", { name: "Канал", memberPubkey: BOB_PUB });
	// Дадим relay'ю принять события и закроем клиент админа — дальше он «офлайн».
	await new Promise((r) => setTimeout(r, 300));
	alice.kill();

	await bob.call("connect");
	const seen = await waitFor(bob, (l) => l.available.length === 1, 10000);
	assert.equal(seen.available.length, 1, "Bob видит канал и без админа онлайн: " + JSON.stringify(seen));

	await bob.call("subscribe", { channelId });
	const after = await bob.call("channelLists");
	assert.equal(after.subscribed.length, 1, "подписка сразу, без ожидания админа: " + JSON.stringify(after));
	assert.equal(after.available.length, 0);

	await bob.call("unsubscribe", { channelId });
	const back = await bob.call("channelLists");
	assert.equal(back.available.length, 1, "«Отписаться» возвращает канал в «Доступные»");
	assert.equal(back.subscribed.length, 0);
});

test("Подписка: группу привязали к каналу уже ПОСЛЕ создания (как на боевом реле)", { timeout: 40000 }, async (t) => {
	const { alice, bob } = await setupDevices(t);
	await alice.call("connect");
	await bob.call("connect");
	const { channelId } = await alice.call("createChannelThenAttachGroup", { name: "Канал", memberPubkey: BOB_PUB });
	const seen = await waitFor(bob, (l) => l.available.length === 1, 10000);
	assert.equal(seen.available.length, 1, "Bob обязан увидеть канал в «Доступные»: " + JSON.stringify(seen));
	await bob.call("subscribe", { channelId });
	const after = await waitFor(bob, (l) => l.subscribed.length === 1, 10000);
	assert.equal(after.subscribed.length, 1, "после «Подписаться» канал обязан стать подпиской: " + JSON.stringify(after));
});

// Правка 2, продолжение (живой тест): подписчик пишет комментарии и в общий чат — ВЛАДЕЛЕЦ
// обязан их увидеть (и подписчик — свои). Раньше они «просто не отображались».
test("Подписчик пишет комментарий и сообщение в чат — владелец видит, подписчик видит своё", { timeout: 60000 }, async (t) => {
	const { alice, bob } = await setupDevices(t);
	await alice.call("connect");
	await bob.call("connect");
	const { channelId } = await alice.call("createChannelForMember", { name: "Канал", memberPubkey: BOB_PUB });
	const { postId } = await alice.call("publishTestPost", { channelId, text: "пост" });
	await waitFor(bob, (l) => l.available.length === 1, 10000);
	await bob.call("subscribe", { channelId });

	await bob.call("comment", { channelId, postId, text: "коммент от подписчика" });
	await bob.call("chatSend", { channelId, text: "сообщение от подписчика" });

	const deadline = Date.now() + 10000;
	let aliceSees;
	while (Date.now() < deadline) {
		aliceSees = await alice.call("seen", { channelId, postId });
		if (aliceSees.comments.length && aliceSees.chat.length) break;
		await new Promise((r) => setTimeout(r, 100));
	}
	const bobSees = await bob.call("seen", { channelId, postId });
	assert.deepEqual(bobSees.comments, ["коммент от подписчика"], "подписчик видит свой комментарий");
	assert.deepEqual(bobSees.chat, ["сообщение от подписчика"], "подписчик видит своё сообщение");
	assert.deepEqual(aliceSees.comments, ["коммент от подписчика"], "владелец видит комментарий подписчика: " + JSON.stringify(aliceSees));
	assert.deepEqual(aliceSees.chat, ["сообщение от подписчика"], "владелец видит сообщение подписчика: " + JSON.stringify(aliceSees));
});
