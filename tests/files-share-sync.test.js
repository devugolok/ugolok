import "fake-indexeddb/auto";
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "../src/core/store/database.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { getPublicKey } from "../src/core/crypto/keys.js";
import { decryptSubtreeOp, deriveShareFileKey } from "../src/core/crypto/share-key.js";
import { share, resyncShare } from "../src/domain/files/share.js";
import { routeOpsToShares } from "../src/domain/files/share-sync.js";
import { getShareKey, loadGrantsIndex, loadShareMeta, saveFileKey } from "../src/domain/files/store.js";
import { putStream, getManifest, getRange } from "../src/domain/files/content.js";
import { createInitialState, applyOp, merge, liveChildrenOf, ROOT_ID } from "../src/domain/files/tree.js";
import { createFolder, createFile, rename, remove, move } from "../src/domain/files/ops.js";

// Живая общая папка: правки владельца внутри расшаренного поддерева доходят до читателя отдельными
// событиями, а не только снимком при выдаче доступа (жалоба: «закинул файлы — контакт не видит, удалил — остались»).

const OWNER_PRIV = new Uint8Array(32).fill(9);
const OWNER_PUB = bytesToHex(getPublicKey(OWNER_PRIV));
const ALICE_PUB = bytesToHex(getPublicKey(new Uint8Array(32).fill(10)));
const dbKey = crypto.getRandomValues(new Uint8Array(32));

let counter = 0;
const label = () => ({ counter: ++counter, deviceId: "device-a" });

before(async () => {
	await db.open();
});

beforeEach(async () => {
	for (const t of ["files_shares", "files_shareKeys", "files_shareGrantees", "files_keys"]) await db.table(t).clear();
	counter = 0;
});

function makeFakeBlossom() {
	const store = new Map();
	const fetchImpl = async (url, opts = {}) => {
		if (opts.method === "PUT") {
			const body = new Uint8Array(opts.body);
			const digest = bytesToHex(sha256(body));
			store.set(digest, body);
			return { ok: true, status: 200, json: async () => ({ sha256: digest, size: body.length }), text: async () => "" };
		}
		const bytes = store.get(url.split("/").pop());
		if (!bytes) return { ok: false, status: 404, text: async () => "not found" };
		if (opts.headers?.Range) {
			const m = /bytes=(\d+)-(\d+)/.exec(opts.headers.Range);
			const slice = bytes.subarray(Number(m[1]), Number(m[2]) + 1);
			return { ok: true, status: 206, arrayBuffer: async () => slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) };
		}
		return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
	};
	return { fetchImpl };
}

const netOpts = (fetchImpl) => ({ serverUrl: "https://blossom.test", privateKey: OWNER_PRIV, fetchImpl });
const capture = (bucket) => async (event) => {
	bucket.push(event);
	return { ok: true };
};

async function readerKey(rootId) {
	const meta = await loadShareMeta(OWNER_PUB, rootId, dbKey);
	return { keyHex: await getShareKey(OWNER_PUB, rootId, meta.currentVersion, dbKey), version: meta.currentVersion };
}

// Состояние читателя: снимок при выдаче доступа + все последующие события по порядку.
async function readerStateFrom(events, rootId) {
	const { keyHex, version } = await readerKey(rootId);
	let S = createInitialState();
	for (const e of events) {
		if (!e.tags.some((t) => t[0] === "h" && t[1] === rootId)) continue;
		const json = decryptSubtreeOp(e.content, { [version]: keyHex });
		for (const op of JSON.parse(json)) S = applyOp(S, op);
	}
	return S;
}

// системные узлы дерева (Корзина, lost+found) имеют id с «$» — в сравнении содержимого не участвуют
const namesOf = (S, parentId) => [...liveChildrenOf(S, parentId)].filter((id) => !String(id).startsWith("$")).map((id) => S.nodes.get(id).name.value).sort();
const namesAtRoot = (S) => namesOf(S, ROOT_ID);

// Владелец: ROOT/Share/{Docs}, расшарено Alice; возвращает всё нужное для правок.
async function setup() {
	const { fetchImpl } = makeFakeBlossom();
	let S = createInitialState();
	const shareId = "n-share";
	S = applyOp(S, createFolder(S, ROOT_ID, "Share", shareId, label()));
	const docs = "n-docs";
	S = applyOp(S, createFolder(S, shareId, "Docs", docs, label()));
	const events = [];
	await share(OWNER_PUB, OWNER_PRIV, dbKey, S, shareId, [ALICE_PUB], label(), capture(events), netOpts(fetchImpl));
	const grantsIndex = await loadGrantsIndex(OWNER_PUB);
	return { fetchImpl, S, shareId, docs, events, grantsIndex };
}

async function route(ctx, ops) {
	const before = ctx.S;
	await routeOpsToShares({ ownerPubkey: OWNER_PUB, ownerPrivKey: OWNER_PRIV, dbKey, before, ops, publish: capture(ctx.events), opts: netOpts(ctx.fetchImpl), grantsIndex: ctx.grantsIndex });
	ctx.S = merge(ctx.S, ops);
}

test("новый файл в общей папке доходит до читателя и расшифровывается; ключ владельца ему не уходит", async () => {
	const ctx = await setup();
	const bytes = new Uint8Array(500);
	crypto.getRandomValues(bytes);
	const { manifestDigest, fileKey } = await putStream(bytes, { ...netOpts(ctx.fetchImpl), name: "a.txt", mime: "text/plain" });
	await saveFileKey(OWNER_PUB, dbKey, manifestDigest, fileKey);
	const op = createFile(ctx.S, ctx.shareId, "a.txt", "n-a", manifestDigest, label(), null, bytesToHex(fileKey), "text/plain");

	const before = ctx.events.length;
	await route(ctx, [op]);
	assert.equal(ctx.events.length, before + 1, "читателям уходит РОВНО одно новое событие");

	const reader = await readerStateFrom(ctx.events, ctx.shareId);
	assert.deepEqual(namesAtRoot(reader), ["Docs", "a.txt"], "читатель видит новый файл без перезагрузки/повторной выдачи доступа");

	const { keyHex, version } = await readerKey(ctx.shareId);
	const ops = JSON.parse(decryptSubtreeOp(ctx.events.at(-1).content, { [version]: keyHex }));
	assert.equal(ops.length, 1);
	assert.equal(ops[0].parentId, ROOT_ID, "прямой ребёнок корня доли — под виртуальным ROOT_ID читателя");
	assert.equal(JSON.stringify(ops[0]).includes("fileKey"), false, "ключ файла ВЛАДЕЛЬЦА в операцию для читателя не попадает");
	assert.notEqual(ops[0].blob, manifestDigest, "читатель получает копию под ключом доли, не блоб владельца");
	const manifest = await getManifest(ops[0].blob, netOpts(ctx.fetchImpl));
	const roundtrip = await getRange(manifest, deriveShareFileKey(keyHex, ops[0].plaintextDigest), 0, manifest.size, netOpts(ctx.fetchImpl));
	assert.deepEqual(roundtrip, bytes, "читатель реально расшифровывает файл своим производным ключом");
});

test("пачка: новая папка и файл ВНУТРИ неё одним действием — оба доходят, родитель вложенного — реальный id", async () => {
	const ctx = await setup();
	const bytes = new Uint8Array(100).fill(7);
	const { manifestDigest, fileKey } = await putStream(bytes, { ...netOpts(ctx.fetchImpl), name: "b.txt", mime: "text/plain" });
	await saveFileKey(OWNER_PUB, dbKey, manifestDigest, fileKey);
	const folder = createFolder(ctx.S, ctx.shareId, "Новая", "n-new", label());
	const stateWithFolder = applyOp(ctx.S, folder);
	const file = createFile(stateWithFolder, "n-new", "b.txt", "n-b", manifestDigest, label(), null, bytesToHex(fileKey), "text/plain");

	await route(ctx, [folder, file]);

	const reader = await readerStateFrom(ctx.events, ctx.shareId);
	assert.deepEqual(namesAtRoot(reader), ["Docs", "Новая"]);
	assert.deepEqual(namesOf(reader, "n-new"), ["b.txt"]);
});

test("переименование внутри общей папки доходит до читателя", async () => {
	const ctx = await setup();
	await route(ctx, [rename(ctx.S, ctx.docs, "Документы", label())]);
	const reader = await readerStateFrom(ctx.events, ctx.shareId);
	assert.deepEqual(namesAtRoot(reader), ["Документы"]);
});

test("удаление (перемещение в корзину) внутри общей папки: у читателя файл пропадает", async () => {
	const ctx = await setup();
	await route(ctx, [remove(ctx.S, ctx.docs, label())]);
	const reader = await readerStateFrom(ctx.events, ctx.shareId);
	assert.deepEqual(namesAtRoot(reader), [], "удалённое владельцем больше не видно читателю");
});

test("правки ВНЕ общей папки и без единой расшаренной папки не дают ни одного события и не ходят в сеть", async () => {
	const { fetchImpl } = makeFakeBlossom();
	let S = createInitialState();
	S = applyOp(S, createFolder(S, ROOT_ID, "Моё", "n-mine", label()));
	const events = [];
	const noGrants = await loadGrantsIndex(OWNER_PUB);
	await routeOpsToShares({ ownerPubkey: OWNER_PUB, ownerPrivKey: OWNER_PRIV, dbKey, before: S, ops: [createFolder(S, "n-mine", "X", "n-x", label())], publish: capture(events), opts: netOpts(fetchImpl), grantsIndex: noGrants });
	assert.equal(events.length, 0);

	const ctx = await setup();
	const outside = createFolder(ctx.S, ROOT_ID, "Снаружи", "n-out", label());
	const before = ctx.events.length;
	await route(ctx, [outside]);
	assert.equal(ctx.events.length, before, "создание вне долей читателям не уходит");
});

test("удалил и отменил удаление: читатель снова видит узел (удаление у него обратимо, а не необратимый purge)", async () => {
	const ctx = await setup();
	await route(ctx, [remove(ctx.S, ctx.docs, label())]);
	assert.deepEqual(namesAtRoot(await readerStateFrom(ctx.events, ctx.shareId)), []);

	await route(ctx, [move(ctx.S, ctx.docs, ctx.shareId, label())]);
	assert.deepEqual(namesAtRoot(await readerStateFrom(ctx.events, ctx.shareId)), ["Docs"], "после возврата из корзины узел снова у читателя");
});

test("досинхронизация: что владелец добавил/удалил до живой синхронизации, читателю передаётся одной кнопкой", async () => {
	const ctx = await setup();
	// Правки «в обход» маршрутизации — как было вчера: файл добавлен, папка Docs удалена, читатель ничего не получил.
	const bytes = new Uint8Array(200).fill(3);
	const { manifestDigest, fileKey } = await putStream(bytes, { ...netOpts(ctx.fetchImpl), name: "old.txt", mime: "text/plain" });
	await saveFileKey(OWNER_PUB, dbKey, manifestDigest, fileKey);
	ctx.S = merge(ctx.S, [createFile(ctx.S, ctx.shareId, "old.txt", "n-old", manifestDigest, label(), null, bytesToHex(fileKey), "text/plain")]);
	ctx.S = merge(ctx.S, [remove(ctx.S, ctx.docs, label())]);
	assert.deepEqual(namesAtRoot(await readerStateFrom(ctx.events, ctx.shareId)), ["Docs"], "до досинхронизации читатель видит устаревшее");

	const count = await resyncShare(OWNER_PUB, OWNER_PRIV, dbKey, ctx.S, ctx.shareId, label(), capture(ctx.events), netOpts(ctx.fetchImpl));
	assert.ok(count >= 2);
	assert.deepEqual(namesAtRoot(await readerStateFrom(ctx.events, ctx.shareId)), ["old.txt"], "после: новый файл есть, удалённой папки нет");

	assert.equal(await resyncShare(OWNER_PUB, OWNER_PRIV, dbKey, ctx.S, "n-не-расшарено", label(), capture([]), netOpts(ctx.fetchImpl)), null, "не расшаренная папка — null");
});
