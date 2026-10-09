import "fake-indexeddb/auto";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { getPublicKey } from "../../src/core/crypto/keys.js";
import { deriveMasterSecret, deriveDbKey } from "../../src/core/crypto/derivation.js";
import { db } from "../../src/core/store/database.js";
import { saveUiSettings } from "../../src/domain/settings/ui-settings.js";
import { toEncryptedRow } from "../../src/core/store/encrypted-table.js";
import { CONTACT_RELATIONSHIPS_PLAINTEXT_FIELDS } from "../../src/core/store/table-fields.js";
import {
	ensureConnected,
	publishToContact,
	fetchDeviceKeyPackages,
	refreshGroupMessageSubscription,
	nextLamportTick,
	publish,
	refreshChannelContentSubscription,
} from "../../src/ui/signals/transport.js";
import { createGroupAction, addGroupMemberAction } from "../../src/ui/signals/contacts.js";
import {
	createChannel,
	listOwnedChannels,
	listSubscribedChannels,
	listAvailableChannels,
	subscribeToChannelAction,
	unsubscribeFromChannelAction,
} from "../../src/domain/content/channel.js";
import { createDraftPost, publishPost } from "../../src/domain/content/post.js";
import { addComment, getCommentsTree } from "../../src/domain/content/comments.js";
import { sendChannelMessage } from "../../src/domain/content/channel-chat.js";
import { loadChannelChatWindow } from "../../src/core/sync/lazy-channel.js";
import { addVisibilityGroup } from "../../src/domain/content/channel-visibility.js";
import { sendChatMessageAction } from "../../src/ui/signals/chats.js";
import { getChatHistory } from "../../src/domain/messaging/chat.js";

let privKey = null;
let ownerPubkey = null;
let dbKey = null;

const handlers = {
	async init({ privKeyHex, relayUrl }) {
		privKey = hexToBytes(privKeyHex);
		ownerPubkey = bytesToHex(getPublicKey(privKey));
		dbKey = deriveDbKey(deriveMasterSecret(privKey));
		await db.open();
		// ensureConnected читает relay-список ТОЛЬКО из локального uiSettings —
		// без этой затравки она уйдёт в bootstrap-обнаружение по реальным
		// build-адресам (CONTRACTS.md, "Этап 73.2 — device.js").
		await saveUiSettings(ownerPubkey, privKey, dbKey, { relayUrls: [{ url: relayUrl, read: true, write: true }] }, async () => ({ ok: true }));
		return { ownerPubkey };
	},

	// Обходит реальный протокол заявок (CONTACTS-FSM.md) прямой записью в
	// contactRelationships — тот же уровень допущения, что и в существующих
	// юнит-тестах (chat.test.js и т.п.), которые тоже сеют состояние напрямую,
	// когда протокол заявок не является предметом теста. Без "CONTACT"
	// isKnownContact() отклонит Welcome (DESIGN.md, "Этап 25" §4, AC-IB-01) —
	// он уйдёт в inboxRequests вместо автопринятия, что 73.2's "счастливый
	// путь" не собирается проверять (это отдельный, уже покрытый функционал).
	async becomeContact({ peerPubkey }) {
		const now = Math.floor(Date.now() / 1000);
		await db
			.table("contactRelationships")
			.put(toEncryptedRow({ owner: ownerPubkey, peer: peerPubkey, state: "CONTACT", resolvedAt: now, sentAt: null }, CONTACT_RELATIONSHIPS_PLAINTEXT_FIELDS, dbKey));
		return {};
	},

	async connect() {
		await ensureConnected(ownerPubkey, privKey, dbKey);
		return {};
	},

	async send({ contactPubkey, text }) {
		const lamportTs = await nextLamportTick(ownerPubkey);
		const result = await sendChatMessageAction(
			ownerPubkey,
			privKey,
			dbKey,
			contactPubkey,
			text,
			lamportTs,
			(event) => publishToContact(event, contactPubkey),
			fetchDeviceKeyPackages,
			refreshGroupMessageSubscription,
		);
		return { lamportTs, ...result };
	},

	// Каналы: тот же путь, что CreateChannelForm/ChannelsList (channels.jsx) —
	// группа с одним участником -> канал, видимый этой группе -> подписка.
	async createChannelForMember({ name, memberPubkey }) {
		const groupId = await createGroupAction(ownerPubkey, privKey, dbKey, "G", publish);
		await addGroupMemberAction(ownerPubkey, privKey, dbKey, groupId, memberPubkey, publish);
		const { channelId } = await createChannel(ownerPubkey, privKey, dbKey, { name, description: "", rules: "" }, [groupId], publish);
		await refreshChannelContentSubscription(ownerPubkey, dbKey);
		return { channelId };
	},

	// Вариант «группу привязали к каналу уже ПОСЛЕ создания» (так было на боевом реле).
	async createChannelThenAttachGroup({ name, memberPubkey }) {
		const { channelId } = await createChannel(ownerPubkey, privKey, dbKey, { name, description: "", rules: "" }, [], publish);
		await refreshChannelContentSubscription(ownerPubkey, dbKey);
		const groupId = await createGroupAction(ownerPubkey, privKey, dbKey, "G", publish);
		await addGroupMemberAction(ownerPubkey, privKey, dbKey, groupId, memberPubkey, publish);
		await addVisibilityGroup(ownerPubkey, privKey, dbKey, channelId, groupId, publish);
		return { channelId };
	},

	async channelLists() {
		const pick = (rows) => rows.map((r) => ({ id: r.id, name: r.name, role: r.role }));
		return {
			owned: pick(await listOwnedChannels(ownerPubkey, dbKey)),
			subscribed: pick(await listSubscribedChannels(ownerPubkey, dbKey)),
			available: pick(await listAvailableChannels(ownerPubkey, dbKey)),
		};
	},

	async subscribe({ channelId }) {
		await subscribeToChannelAction(ownerPubkey, privKey, channelId, publish);
		return {};
	},

	async publishTestPost({ channelId, text }) {
		const draft = await createDraftPost(ownerPubkey, dbKey, channelId, { text });
		const postId = draft.id ?? draft.postId ?? draft;
		await publishPost(ownerPubkey, privKey, dbKey, postId, publish);
		return { postId };
	},

	async comment({ channelId, postId, text }) {
		await addComment(ownerPubkey, privKey, dbKey, channelId, postId, postId, text, [], publish);
		return {};
	},

	async chatSend({ channelId, text }) {
		await sendChannelMessage(ownerPubkey, privKey, dbKey, channelId, text, [], publish);
		return {};
	},

	async seen({ channelId, postId }) {
		const comments = (await getCommentsTree(ownerPubkey, dbKey, postId)).map((c) => c.text);
		const chat = (await loadChannelChatWindow(ownerPubkey, dbKey, channelId, { limit: 50 })).messages.map((m) => m.text);
		return { comments, chat };
	},

	async unsubscribe({ channelId }) {
		await unsubscribeFromChannelAction(ownerPubkey, privKey, channelId, publish);
		return {};
	},

	async history({ contactPubkey }) {
		return getChatHistory(ownerPubkey, contactPubkey, dbKey);
	},
};

// Команды выполняются строго последовательно, в порядке получения —
// реальная вкладка браузера тоже однопоточна; гонки должны воспроизводиться
// через relay (тайминг доставки), не через порядок обработки IPC.
let queue = Promise.resolve();

process.on("message", ({ id, cmd, args }) => {
	queue = queue.then(async () => {
		const handler = handlers[cmd];
		try {
			if (!handler) throw new Error(`device.js: неизвестная команда "${cmd}"`);
			const result = await handler(args ?? {});
			process.send({ id, ok: true, result });
		} catch (e) {
			process.send({ id, ok: false, error: String(e && e.stack ? e.stack : e) });
		}
	});
});
