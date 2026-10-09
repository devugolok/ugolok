import { useState, useEffect } from "preact/hooks";
import { t } from "../signals/i18n.js";
import ActionsMenu from "./actions-menu.jsx";
import ModerationActions from "./moderation-actions.jsx";
import MessageBubble from "./message-bubble.jsx";
import { commentAuthorInfo, CommentComposer } from "./channel-shared.jsx";
import { formatDateTime } from "./post-card.jsx";
import { buildReplyTo } from "../../domain/messaging/reply.js";
import { emojiIdToChannelReaction } from "../../domain/content/reactions.js";
import { commentQuoteRequest } from "../signals/channel-reply.js";

// Комментарий — тот же MessageBubble, что в личном чате и общем чате канала (ответ, цитата выделенного, реакции,
// вложения, время, панель действий). От чата отличается только деревом: «ответить» открывает форму прямо под
// комментарием (ветка), а не черновик в подвале. Имя автора (+ значок «автор поста») — внутри пузыря.
export default function CommentNode({
	comment,
	canComment,
	canReact,
	ownerPubkey,
	privKey,
	dbKey,
	channelId,
	channelOwnerPubkey,
	postId,
	postAuthorPubkey,
	limiter,
	onChanged,
	highlightCommentId,
	onOpenAttachment,
	reactionMapByTarget,
	onToggleReaction,
}) {
	const [replying, setReplying] = useState(false);
	const [quote, setQuote] = useState(null); // replyTo с выделенным фрагментом, если форму открыли через «Цитировать»
	const isOwnComment = comment.authorPubkey === ownerPubkey;
	const isTarget = comment.id === highlightCommentId;
	const isOP = comment.authorPubkey === postAuthorPubkey;
	const author = commentAuthorInfo(comment.authorPubkey);

	// «Цитировать» выделенное в этом комментарии (кнопка общая на странице, адресуется по id комментария)
	const request = commentQuoteRequest.value;
	useEffect(() => {
		if (!request || request.commentId !== comment.id) return;
		commentQuoteRequest.value = null;
		if (!canComment) return;
		setQuote(buildReplyTo({ msgId: comment.id, senderPubkey: comment.authorPubkey, text: comment.text, attachments: comment.attachments }, request.text));
		setReplying(true);
	}, [request]);

	function jumpToMessage(id) {
		const el = document.getElementById(`comment-${id}`)?.querySelector(".message-bubble");
		if (!el) return;
		el.scrollIntoView({ block: "center", behavior: "smooth" });
		el.classList.add("is-jump-target");
		setTimeout(() => el.classList.remove("is-jump-target"), 1600);
	}

	const bubbleMessage = {
		msgId: comment.id,
		senderPubkey: comment.authorPubkey,
		text: comment.text,
		attachments: comment.attachments,
		replyTo: comment.replyTo,
		reactions: reactionMapByTarget?.get(comment.id),
		sentAt: comment.createdAt,
	};
	const replyAuthorName = (pubkey) => (pubkey === ownerPubkey ? t("message.replyYou") : commentAuthorInfo(pubkey).name);

	return (
		<li id={`comment-${comment.id}`} class={`cmt${isTarget ? " is-target-comment" : ""}${replying ? " is-replying" : ""}`}>
			<article class="cmt__box">
				{author.avatar ? (
					<img src={author.avatar} alt="" class="cmt__ava" />
				) : (
					<div aria-hidden="true" class="cmt__ava cmt__ava-fallback">
						{(author.name || "?").trim().charAt(0).toUpperCase()}
					</div>
				)}
				<div class="stack" style={{ "--gap": "var(--space-2xs)" }}>
					<MessageBubble
						message={bubbleMessage}
						isOwn={isOwnComment}
						myPubkey={ownerPubkey}
						formatTime={formatDateTime}
						senderName={
							<>
								<span class={author.isNpub ? "cmt__name cmt__name--npub" : "cmt__name"}>{author.name}</span>
								{isOP && <span class="cmt__op">{t("channel.comment.authorBadge")}</span>}
							</>
						}
						onReply={canComment ? () => {
							setQuote(null);
							setReplying((v) => !v);
						} : undefined}
						onReact={canReact ? (_id, emojiId) => onToggleReaction("comment", comment.id, postId, emojiIdToChannelReaction(emojiId)) : undefined}
						replyAuthorName={replyAuthorName}
						onJumpToMessage={jumpToMessage}
						onOpenAttachment={(_m, attachment) => onOpenAttachment?.(attachment, { commentId: comment.id })}
						extraTools={
							!isOwnComment ? (
								<ActionsMenu label={t("channel.comment.moreActionsAria", { name: author.name })} summaryClass="bubble-tool">
									<ModerationActions
										viewerPubkey={ownerPubkey}
										viewerPrivKey={privKey}
										channelOwnerPubkey={channelOwnerPubkey}
										channelId={channelId}
										targetPubkey={comment.authorPubkey}
										contentType="comment"
										contentId={comment.id}
										contentText={comment.text}
									/>
								</ActionsMenu>
							) : undefined
						}
					/>
					{replying && (
						<div class="cmt-reply-form">
							<CommentComposer
								ownerPubkey={ownerPubkey}
								privKey={privKey}
								dbKey={dbKey}
								channelId={channelId}
								postId={postId}
								parentId={comment.id}
								limiter={limiter}
								autoFocus
								replyToName={author.name}
								quote={quote}
								onSubmitted={() => {
									setReplying(false);
									setQuote(null);
									onChanged();
								}}
								onCancel={() => {
									setReplying(false);
									setQuote(null);
								}}
							/>
						</div>
					)}
				</div>
			</article>
			{comment.replies.length > 0 && (
				<ul class="cmt-list cmt-list--replies">
					{comment.replies.map((reply) => (
						<CommentNode
							key={reply.id}
							comment={reply}
							canComment={canComment}
							canReact={canReact}
							ownerPubkey={ownerPubkey}
							privKey={privKey}
							dbKey={dbKey}
							channelId={channelId}
							channelOwnerPubkey={channelOwnerPubkey}
							postId={postId}
							postAuthorPubkey={postAuthorPubkey}
							limiter={limiter}
							onChanged={onChanged}
							highlightCommentId={highlightCommentId}
							onOpenAttachment={onOpenAttachment}
							reactionMapByTarget={reactionMapByTarget}
							onToggleReaction={onToggleReaction}
						/>
					))}
				</ul>
			)}
		</li>
	);
}
