// Маршрутизация move через границу доли (CONTRACTS.md/DESIGN.md, этап 53
// И6, задача 6.4) — получатели ОБЪЕДИНЕНИЯ долей, покрывающих старого и
// нового родителя (TASK.md §6: "получатели — объединение старого и
// нового родителя"). Только move: остальные операции внутри уже
// расшаренного поддерева не меняют покрывающее множество (parentId тот
// же), поэтому не нуждаются в leaving/entering-развилке — этот файл их
// не касается (вне скоупа 6.4, TASK.md таблица §5.5).
import { coveringShares } from "./permissions.js";
import { liveChildrenOf, ROOT_ID, TRASH_ID } from "./tree.js";
import { publishSubtreeOps, reuploadUnderShareKey } from "./share.js";
import { loadShareMeta, getShareKey } from "./store.js";

// Один create-оп: файлы честно перезаливаются под ключом, ПРОИЗВОДНЫМ от
// subtreeKey ЭТОЙ доли (CONTRACTS.md/DESIGN.md, этап 53 И6, задача 6.6b —
// та же логика, что share.js's snapshotSubtree, переиспользована буквально
// через reuploadUnderShareKey, не продублирована). Папки — без I/O, blob:null.
async function buildCreateOp(ownerPubkey, dbKey, node, parentId, subtreeKeyHex, label, opts) {
	if (node.kind === "file") {
		const { blob, plaintextDigest } = await reuploadUnderShareKey(ownerPubkey, dbKey, node, subtreeKeyHex, opts);
		return { type: "create", id: node.id, kind: "file", blob, parentId, name: node.name.value, origin: node.origin.value, label, plaintextDigest };
	}
	return { type: "create", id: node.id, kind: node.kind, blob: null, parentId, name: node.name.value, origin: node.origin.value, label };
}

// Снимок поддерева, корень nodeId ВКЛЮЧЁН (в отличие от share.js's
// snapshotSubtree, где корень становится виртуальным ROOT_ID точки
// монтирования — здесь корень ОБЫЧНЫЙ узел, входящий в уже видимое
// получателю поддерево доли, его реальный parentId получатель узнаёт
// ВПЕРВЫЕ через параметр parentId, остальные — из treeState как есть).
async function subtreeOpsRootedAt(ownerPubkey, dbKey, treeState, nodeId, parentId, subtreeKeyHex, label, opts) {
	const node = treeState.nodes.get(nodeId);
	const ops = [await buildCreateOp(ownerPubkey, dbKey, node, parentId, subtreeKeyHex, label, opts)];
	const stack = [...liveChildrenOf(treeState, nodeId)].map((id) => ({ id, parentId: nodeId }));
	while (stack.length > 0) {
		const { id, parentId: p } = stack.pop();
		const n = treeState.nodes.get(id);
		ops.push(await buildCreateOp(ownerPubkey, dbKey, n, p, subtreeKeyHex, label, opts));
		for (const childId of liveChildrenOf(treeState, id)) stack.push({ id: childId, parentId: id });
	}
	return ops;
}

// Доля могла быть отозвана/удалена между вычислением coveringShares и
// публикацией (гонка, не ошибка) — meta отсутствует -> null, вызывающая
// сторона не публикует (тот же принцип, что decryptSubtreeOp на
// неизвестную версию).
async function loadCurrentShareKey(ownerPubkey, shareRootId, dbKey) {
	const meta = await loadShareMeta(ownerPubkey, shareRootId, dbKey);
	if (!meta) return null;
	const subtreeKeyHex = await getShareKey(ownerPubkey, shareRootId, meta.currentVersion, dbKey);
	return { version: meta.currentVersion, subtreeKeyHex };
}

async function publishOpsToShare(ownerPrivKey, shareRootId, keyInfo, ops, publish) {
	if (!keyInfo) return;
	await publishSubtreeOps(ownerPrivKey, shareRootId, keyInfo.subtreeKeyHex, keyInfo.version, ops, publish);
}

// Лежит ли узел id в корзине (сам или через предка). Корзина владельца — обычный узел дерева.
function isInTrash(treeState, id) {
	let cur = id;
	for (let steps = 0; steps < 128 && cur !== null && cur !== undefined; steps++) {
		if (cur === TRASH_ID) return true;
		const node = treeState.nodes.get(cur);
		if (!node) return false;
		cur = node.par.value;
	}
	return false;
}

// treeState — состояние ВЛАДЕЛЬЦА ДО применения op (нужен текущий
// par.value узла как oldParentId; op.value — новый родитель, ops.js's
// move()). grantsIndex — тот же вход, что permissions.js's coveringShares/
// effectivePerm (store.js's loadGrantsIndex(ownerPubkey)). opts — сетевые
// параметры (serverUrl/privateKey/fetchImpl) для честной перезаливки
// файлов, входящих в долю (6.6b) — пустые для leaving/unchanged (не
// трогают содержимое, только маршрутизацию).
export async function routeMove(ownerPubkey, ownerPrivKey, dbKey, grantsIndex, treeState, op, label, publish, opts = {}) {
	const node = treeState.nodes.get(op.id);
	const oldParentId = node.par.value;
	const newParentId = op.value;

	const oldCover = coveringShares(grantsIndex, treeState, oldParentId);
	const newCover = coveringShares(grantsIndex, treeState, newParentId);

	// «Удалить» у владельца — перемещение в корзину. Читателю передаём ТО ЖЕ перемещение в его корзину, а не
	// purge: purge у получателя необратим (монотонный флаг, tree.js), и отмена удаления у владельца навсегда
	// оставила бы файл невидимым для читателя. Настоящий уход из доли (в другое место) — по-прежнему purge.
	const toTrash = newParentId === TRASH_ID;
	// Возврат из корзины (отмена удаления): у читателя узел мог остаться в его корзине — одного create мало
	// (create существующего id — no-op), поэтому дополнительно возвращаем сам узел перемещением.
	const restoredFromTrash = isInTrash(treeState, oldParentId);

	for (const shareRootId of oldCover) {
		if (newCover.has(shareRootId)) continue; // unchanged, обрабатывается ниже
		const keyInfo = await loadCurrentShareKey(ownerPubkey, shareRootId, dbKey);
		const leaving = toTrash ? { type: "setPar", id: op.id, value: TRASH_ID, label: op.label } : { type: "purge", id: op.id };
		await publishOpsToShare(ownerPrivKey, shareRootId, keyInfo, [leaving], publish);
	}
	for (const shareRootId of newCover) {
		if (oldCover.has(shareRootId)) continue;
		const keyInfo = await loadCurrentShareKey(ownerPubkey, shareRootId, dbKey);
		if (!keyInfo) continue; // доля исчезла между coveringShares и публикацией — нечего заливать
		// У читателя прямые дети доли лежат под виртуальным ROOT_ID (share.js::snapshotSubtree), реального id
		// корня доли в его дереве нет — ссылка на него осиротила бы узел.
		const readerParentId = newParentId === shareRootId ? ROOT_ID : newParentId;
		const ops = await subtreeOpsRootedAt(ownerPubkey, dbKey, treeState, op.id, readerParentId, keyInfo.subtreeKeyHex, label, opts);
		if (restoredFromTrash) ops.push({ type: "setPar", id: op.id, value: readerParentId, label: op.label });
		await publishOpsToShare(ownerPrivKey, shareRootId, keyInfo, ops, publish);
	}
	for (const shareRootId of oldCover) {
		if (!newCover.has(shareRootId)) continue;
		const keyInfo = await loadCurrentShareKey(ownerPubkey, shareRootId, dbKey);
		// То же отображение корня доли в ROOT_ID: перемещение «в саму общую папку» у читателя — в её корень.
		const readerOp = op.value === shareRootId ? { ...op, value: ROOT_ID } : op;
		await publishOpsToShare(ownerPrivKey, shareRootId, keyInfo, [readerOp], publish);
	}
}
