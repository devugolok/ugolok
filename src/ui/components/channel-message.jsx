import { t } from "../signals/i18n.js";
import { commentAuthorInfo } from "./channel-shared.jsx";
import MessageBubble from "./message-bubble.jsx";
import ActionsMenu from "./actions-menu.jsx";
import ModerationActions from "./moderation-actions.jsx";

// CHANNEL-V2 часть E2 — одно сообщение общего чата. showAuthor:false — продолжение группы того же автора
// (channel-chat.jsx группирует): аватар не рисуется, но пустая ячейка (.chat-msg__ava-slot) держит колонку.
// Сам «пузырь» — тот же MessageBubble, что в личном чате и в комментариях: ответ, цитата выделенного, реакции,
// вложения, время и панель действий выглядят и работают одинаково. Имя автора (+ значок владельца) — внутри пузыря,
// меню модерации — в его панели действий.
export default function ChannelMessage({
	message,
	showAuthor,
	isOwn,
	isChannelOwner,
	ownerPubkey,
	privKey,
	channelOwnerPubkey,
	channelId,
	onOpenAttachment,
	reactions,
	onReply,
	onReact,
	onJumpToMessage,
}) {
	const author = commentAuthorInfo(message.authorPubkey);
	const bubbleMessage = {
		msgId: message.id,
		senderPubkey: message.authorPubkey,
		text: message.text,
		attachments: message.attachments,
		replyTo: message.replyTo,
		reactions,
		sentAt: message.createdAt,
	};
	const replyAuthorName = (pubkey) => (pubkey === ownerPubkey ? t("message.replyYou") : commentAuthorInfo(pubkey).name);

	return (
		<article class={`chat-msg${isOwn ? " chat-msg--own" : ""}`}>
			{showAuthor ? (
				author.avatar ? (
					<img src={author.avatar} alt="" class="chat-msg__ava" />
				) : (
					<div aria-hidden="true" class="chat-msg__ava chat-msg__ava-fallback">
						{(author.name || "?").trim().charAt(0).toUpperCase()}
					</div>
				)
			) : (
				<div class="chat-msg__ava-slot" aria-hidden="true" />
			)}

			<MessageBubble
				message={bubbleMessage}
				isOwn={isOwn}
				myPubkey={ownerPubkey}
				senderName={
					showAuthor ? (
						<>
							<span class={author.isNpub ? "chat-msg__name chat-msg__name--npub" : "chat-msg__name"}>{author.name}</span>
							{isChannelOwner && <span class="chat-msg__badge">{t("channel.kicker.owner")}</span>}
						</>
					) : undefined
				}
				onReply={onReply ? () => onReply(message) : undefined}
				onReact={onReact}
				replyAuthorName={replyAuthorName}
				onJumpToMessage={onJumpToMessage}
				onOpenAttachment={(_m, attachment) => onOpenAttachment?.(message, attachment)}
				extraTools={
					!isOwn ? (
						<ActionsMenu label={t("channel.comment.moreActionsAria", { name: author.name })} summaryClass="bubble-tool">
							<ModerationActions
								viewerPubkey={ownerPubkey}
								viewerPrivKey={privKey}
								channelOwnerPubkey={channelOwnerPubkey}
								channelId={channelId}
								targetPubkey={message.authorPubkey}
								contentType="chat_message"
								contentId={message.id}
								contentText={message.text}
							/>
						</ActionsMenu>
					) : undefined
				}
			/>
		</article>
	);
}
