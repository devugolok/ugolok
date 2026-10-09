// Живая общая папка (FILES-DOCS/TASK.md §И6, приёмка: «контакт видит долю и получает изменения
// без перезагрузки»). share() публикует только СНИМОК на момент выдачи доступа; дальше любая
// правка владельца внутри расшаренного поддерева обязана дойти до читателей отдельным событием
// FILE_SUBTREE_OP_KIND — иначе доля «живёт» ровно один раз (жалоба: «закинул файлы — контакт ничего
// не видит, удалил — у него остались»). Получатель применяет любые операции к своему отдельному
// состоянию (mount.js::applyMountSubtreeEvent), недоставало ОТПРАВЛЯЮЩЕЙ стороны.
//
// Что и как уходит читателям (по типу операции владельца):
//  create  — папка: как есть; файл: честная перезаливка под ключ доли (reuploadUnderShareKey),
//            ключ ВЛАДЕЛЬЦА в операцию не попадает никогда;
//  setName — переименование внутри доли как есть (корень самой доли у читателя называется как он сам решил);
//  setPar  — перемещение и удаление (= перемещение в корзину): move-routing.js::routeMove
//            (вышло из доли — purge, вошло — снимок, внутри — setPar);
//  purge/setMime — читателям не нужны (удаление уже дошло как purge при уходе из доли; mime у них свой).
import { coveringShares } from "./permissions.js";
import { applyOp, ROOT_ID } from "./tree.js";
import { publishSubtreeOps, reuploadUnderShareKey } from "./share.js";
import { loadShareMeta, getShareKey, loadGrantsIndex } from "./store.js";
import { routeMove } from "./move-routing.js";

async function currentShareKey(ownerPubkey, shareRootId, dbKey) {
	const meta = await loadShareMeta(ownerPubkey, shareRootId, dbKey);
	if (!meta) return null; // доля исчезла (отозвана) между расчётом покрытия и публикацией
	const subtreeKeyHex = await getShareKey(ownerPubkey, shareRootId, meta.currentVersion, dbKey);
	return { version: meta.currentVersion, subtreeKeyHex };
}

// У читателя прямые дети доли лежат под виртуальным корнем ROOT_ID, а не под реальным id папки владельца
// (share.js::snapshotSubtree) — в операциях, которые ссылаются на родителя, id корня доли подменяем.
const toReaderParent = (parentId, shareRootId) => (parentId === shareRootId ? ROOT_ID : parentId);

async function routeCreate(ctx, state, op) {
	const covers = coveringShares(ctx.grantsIndex, state, op.parentId);
	for (const shareRootId of covers) {
		const keyInfo = await currentShareKey(ctx.ownerPubkey, shareRootId, ctx.dbKey);
		if (!keyInfo) continue;
		const parentId = toReaderParent(op.parentId, shareRootId);
		let out;
		if (op.kind === "file") {
			const node = { id: op.id, blob: op.blob, name: { value: op.name } };
			const { blob, plaintextDigest } = await reuploadUnderShareKey(ctx.ownerPubkey, ctx.dbKey, node, keyInfo.subtreeKeyHex, { ...ctx.opts, journalTarget: op.parentId });
			// Поля перечислены явно: у create-операции владельца есть fileKey — он читателю НЕ уходит.
			out = { type: "create", id: op.id, kind: "file", blob, parentId, name: op.name, origin: op.origin ?? null, label: op.label, plaintextDigest };
		} else {
			out = { type: "create", id: op.id, kind: op.kind, blob: null, parentId, name: op.name, origin: op.origin ?? null, label: op.label };
		}
		await publishSubtreeOps(ctx.ownerPrivKey, shareRootId, keyInfo.subtreeKeyHex, keyInfo.version, [out], ctx.publish);
	}
}

async function routeRename(ctx, state, op) {
	const node = state.nodes.get(op.id);
	if (!node) return;
	const covers = coveringShares(ctx.grantsIndex, state, node.par.value);
	for (const shareRootId of covers) {
		const keyInfo = await currentShareKey(ctx.ownerPubkey, shareRootId, ctx.dbKey);
		if (!keyInfo) continue;
		await publishSubtreeOps(ctx.ownerPrivKey, shareRootId, keyInfo.subtreeKeyHex, keyInfo.version, [op], ctx.publish);
	}
}

// before — состояние дерева ДО пачки ops; операции применяются по порядку, каждая видит результат
// предыдущих (создание папки и файла в ней в одной пачке: родитель уже на месте).
// Ничего не расшарено — выходим без единого обращения к сети.
export async function routeOpsToShares({ ownerPubkey, ownerPrivKey, dbKey, before, ops, publish, opts = {}, grantsIndex }) {
	const grants = grantsIndex ?? (await loadGrantsIndex(ownerPubkey));
	if (grants.size === 0) return { routed: 0 };
	const ctx = { ownerPubkey, ownerPrivKey, dbKey, grantsIndex: grants, publish, opts };
	let state = before;
	let routed = 0;
	for (const op of ops) {
		if (op.type === "create") {
			await routeCreate(ctx, state, op);
			routed += 1;
		} else if (op.type === "setName") {
			await routeRename(ctx, state, op);
			routed += 1;
		} else if (op.type === "setPar") {
			await routeMove(ownerPubkey, ownerPrivKey, dbKey, grants, state, op, op.label, publish, opts);
			routed += 1;
		}
		state = applyOp(state, op);
	}
	return { routed };
}
