// ТЗ редизайн канала A — kind 30067, parameterized-replaceable реакция
// на пост/комментарий канала. Auth как receiveComment; LWW как receivePost.
import { db } from "../../core/store/database.js";
import { sign } from "../../core/crypto/sign.js";
import { encryptChannelContent, decryptChannelContent } from "../../core/crypto/channel-key.js";
import { toEncryptedRow, fromEncryptedRow } from "../../core/store/encrypted-table.js";
import { CHANNEL_REACTIONS_PLAINTEXT_FIELDS } from "../../core/store/table-fields.js";
import { isNewerVersion } from "../../core/sync/lww.js";
import { ChannelContentNotReadyError } from "./channel-content-errors.js";
import { DomainError } from "../errors.js";
import { REACTION_IDS, emojiItem, emojiIdByGlyph } from "./emoji-pack.js";

export const CHANNEL_REACTION_KIND = 30067;
// Первые пять — прежний набор (на проводе они уже лежат); дальше — остальные реакции чата (emoji-pack.js REACTION_IDS),
// чтобы реакции в каналах и в личных чатах были одним набором. Старый клиент неизвестные ему символы просто не показывает.
const LEGACY_REACTIONS = ["👍", "❤️", "😂", "🔥", "👀"];
export const CHANNEL_REACTION_SET = [...LEGACY_REACTIONS, ...REACTION_IDS.map((id) => emojiItem(id).glyph).filter((g) => !LEGACY_REACTIONS.includes(g))];

function isAllowedEmoji(emoji) {
  return emoji === null || CHANNEL_REACTION_SET.includes(emoji);
}

async function requirePublishOk(publish, event) {
  const result = await publish(event);
  if (!result.ok) {
    if (result.reason) throw new Error(result.reason);
    throw new DomainError("relay отклонил публикацию", "errors.relayRejected");
  }
}

export async function setReaction(ownerPubkey, ownerPrivKey, dbKey, channelId, targetType, targetId, postId, emoji, publish) {
  if (!REACTION_TARGET_TYPES.includes(targetType)) throw new DomainError("неверный targetType реакции", "errors.invalidReactionTarget");
  if (!isAllowedEmoji(emoji)) throw new DomainError("эмодзи реакции не из алфавита", "errors.invalidReactionEmoji");
  const channelRow = await db.table("channels").get([ownerPubkey, channelId]);
  if (!channelRow) throw new DomainError("канал не найден", "errors.channelNotFound");
  const meta = fromEncryptedRow(await db.table("channelKeyMeta").get([ownerPubkey, channelId]), dbKey);
  const keyRow = fromEncryptedRow(await db.table("channelKeys").get([ownerPubkey, channelId, meta.currentVersion]), dbKey);
  const payload = { targetType, targetId, postId, channelId, emoji };
  const content = encryptChannelContent(JSON.stringify(payload), keyRow.channelKey, meta.currentVersion);
  const event = sign({ kind: CHANNEL_REACTION_KIND, content, tags: [["d", `${channelId}:${targetType}:${targetId}`], ["h", channelRow.channelTopic]], created_at: Math.floor(Date.now() / 1000) }, ownerPrivKey);
  await requirePublishOk(publish, event);
  await db.table("channelReactions").put(toEncryptedRow({
    ownerPubkey, channelId, targetType, targetId, postId,
    reactorPubkey: ownerPubkey, emoji, createdAt: event.created_at,
    lastEventCreatedAt: event.created_at, lastEventId: event.id
  }, CHANNEL_REACTIONS_PLAINTEXT_FIELDS, dbKey));
}

export async function receiveReaction(ownerPubkey, dbKey, event) {
  const hTag = event.tags.find((t) => t[0] === "h");
  if (!hTag) return false;
  const channelRow = await db.table("channels").where("channelTopic").equals(hTag[1]).and((r) => r.ownerPubkey === ownerPubkey).first();
  if (!channelRow) throw new ChannelContentNotReadyError();
  const meta = fromEncryptedRow(await db.table("channelKeyMeta").get([ownerPubkey, channelRow.id]), dbKey);
  if (!meta) throw new ChannelContentNotReadyError();
  const keyRowRaw = await db.table("channelKeys").get([ownerPubkey, channelRow.id, meta.currentVersion]);
  if (!keyRowRaw) throw new ChannelContentNotReadyError();
  const keyRow = fromEncryptedRow(keyRowRaw, dbKey);
  const plaintext = decryptChannelContent(event.content, { [meta.currentVersion]: keyRow.channelKey });
  if (plaintext === null) throw new ChannelContentNotReadyError();
    // Право писать = владение ключом канала (расшифровка выше удалась): ключ есть только у
    // тех, кому владелец выдал VIEW (группы видимости); подписаться может любой из них.
    // Забаненный отсекается ротацией ключа (banMember), список подписчиков тут не нужен.
  let parsed;
  try { parsed = JSON.parse(plaintext); } catch { return false; }
  const targetType = parsed.targetType;
  const targetId = parsed.targetId;
  const postId = parsed.postId;
  const emoji = parsed.emoji === undefined ? null : parsed.emoji;
  if (!REACTION_TARGET_TYPES.includes(targetType)) return false;
  if (!targetId || !postId) return false;
  if (!isAllowedEmoji(emoji)) return false;
  if (targetType === "post") {
    const postRaw = await db.table("posts").get([ownerPubkey, targetId]);
    if (!postRaw || postRaw.deleted || postRaw.channelId !== channelRow.id) return false;
  } else if (targetType === "chat_message") {
    const messageRaw = await db.table("channelMessages").get([ownerPubkey, targetId]);
    if (!messageRaw || messageRaw.channelId !== channelRow.id) return false;
  } else {
    const commentRaw = await db.table("comments").get([ownerPubkey, targetId]);
    if (!commentRaw || commentRaw.deleted) return false;
  }
  const existing = await db.table("channelReactions").get([ownerPubkey, channelRow.id, targetType, targetId, event.pubkey]);
  if (existing && !isNewerVersion({ createdAt: event.created_at, id: event.id }, { createdAt: existing.lastEventCreatedAt, id: existing.lastEventId })) {
    return false;
  }
  await db.table("channelReactions").put(toEncryptedRow({
    ownerPubkey, channelId: channelRow.id, targetType, targetId, postId,
    reactorPubkey: event.pubkey, emoji,
    createdAt: existing ? existing.createdAt : event.created_at,
    lastEventCreatedAt: event.created_at, lastEventId: event.id
  }, CHANNEL_REACTIONS_PLAINTEXT_FIELDS, dbKey));
  return true;
}

// Реакция на сообщение общего чата канала: targetType "chat_message", targetId — id сообщения, а postId (поле, по
// которому реакции индексируются) — id КАНАЛА: сообщения чата не принадлежат посту. Старый клиент такой targetType
// отбрасывает (receiveReaction -> false), на постах/комментариях ничего не меняется.
export const REACTION_TARGET_TYPES = ["post", "comment", "chat_message"];

export async function listReactionsForChat(ownerPubkey, dbKey, channelId) {
  const rows = await db.table("channelReactions").where("[ownerPubkey+postId]").equals([ownerPubkey, channelId]).toArray();
  return rows.filter((r) => r.targetType === "chat_message").map((r) => fromEncryptedRow(r, dbKey));
}

export async function listReactionsForPost(ownerPubkey, dbKey, postId) {
  const rows = await db.table("channelReactions").where("[ownerPubkey+postId]").equals([ownerPubkey, postId]).toArray();
  return rows.map((r) => fromEncryptedRow(r, dbKey));
}

export async function listReactionsForTargets(ownerPubkey, dbKey, targetIds) {
  if (!targetIds || targetIds.length === 0) return [];
  const rows = await db.table("channelReactions").where("[ownerPubkey+targetId]").anyOf(targetIds.map((id) => [ownerPubkey, id])).toArray();
  return rows.filter((r) => r.targetType === "post").map((r) => fromEncryptedRow(r, dbKey));
}

export function aggregateReactions(rows, viewerPubkey) {
  const counts = {};
  let mine = null;
  for (const row of rows) {
    if (!CHANNEL_REACTION_SET.includes(row.emoji)) continue;
    counts[row.emoji] = (counts[row.emoji] || 0) + 1;
    if (row.reactorPubkey === viewerPubkey) mine = row.emoji;
  }
  return { counts, mine };
}

// Строки реакций канала ({ reactorPubkey, emoji, createdAt }) -> та же карта, что у реакций личного чата
// ({ [reactorPubkey]: { id, ts } }, id — id смайла), чтобы ОДИН пузырь (MessageBubble) показывал реакции везде.
// Символ вне набора и снятая реакция (emoji null) пропускаются.
export function reactionRowsToMap(rows) {
  const map = {};
  for (const row of rows ?? []) {
    if (!row || row.emoji === null || row.emoji === undefined) continue;
    const id = emojiIdByGlyph(row.emoji);
    if (!id || !CHANNEL_REACTION_SET.includes(row.emoji)) continue;
    map[row.reactorPubkey] = { id, ts: row.lastEventCreatedAt ?? row.createdAt ?? 0 };
  }
  return map;
}

// id смайла (из пикера пузыря) -> символ, который едет по протоколу каналов; null/неизвестный -> null (снять реакцию).
export function emojiIdToChannelReaction(id) {
  const glyph = id ? emojiItem(id)?.glyph : null;
  return glyph && CHANNEL_REACTION_SET.includes(glyph) ? glyph : null;
}
