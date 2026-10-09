import { signal } from "@preact/signals";

// Общее состояние «ответ/цитата» между лентой общего чата канала (channel-chat.jsx) и композером в подвале экрана
// (channel-composer.jsx) — это соседние компоненты, поэтому через сигнал, а не пропсы.
//   channelReplyDraft: { channelId, replyTo } | null — на что отвечает композер чата канала.
//   commentQuoteRequest: { commentId, text, seq } | null — «Цитировать» выделенное в комментарии: нужный CommentNode
//   открывает форму ответа с цитатой и сбрасывает запрос.
export const channelReplyDraft = signal(null);
export const commentQuoteRequest = signal(null);
