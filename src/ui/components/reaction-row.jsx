import { useEffect, useRef, useState } from "preact/hooks";
import { CHANNEL_REACTION_SET } from "../../domain/content/reactions.js";
import { t } from "../signals/i18n.js";
import IconSmiley from "../icons/smiley.jsx";
import EmojiGlyph from "./emoji-glyph.jsx";
import { emojiIdByGlyph } from "../../domain/content/emoji-pack.js";

// Реакции каналов едут по протоколу юникод-символом (data-контракт, reactions.js), а рисуются так же, как смайлы
// и реакции чатов — набором из emoji-glyph.jsx (сейчас Tossface), по соответствующему id.
function Glyph({ emoji }) {
	const id = emojiIdByGlyph(emoji);
	return id ? <EmojiGlyph id={id} /> : <span>{emoji}</span>;
}

// ТЗ редизайн канала A — ряд реакций поста/комментария. compact: «+» по hover
// (комментарий); без compact — класс post-react, «+» всегда виден.
export default function ReactionRow({ counts = {}, mine, canReact, onToggle, compact }) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef(null);

	useEffect(() => {
		if (!open) return;
		function onDoc(e) {
			if (!rootRef.current?.contains(e.target)) setOpen(false);
		}
		function onKey(e) {
			if (e.key === "Escape") setOpen(false);
		}
		document.addEventListener("mousedown", onDoc);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDoc);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	const shown = CHANNEL_REACTION_SET.filter((emoji) => (counts[emoji] || 0) > 0 || mine === emoji);

	function handleChip(emoji) {
		if (!canReact) return;
		onToggle(mine === emoji ? null : emoji);
	}

	return (
		<div ref={rootRef} class={`react-row${compact ? "" : " post-react"}${open ? " is-picking" : ""}`}>
			{shown.map((emoji) => {
				return (
					<button
						key={emoji}
						type="button"
						class={`react-chip${mine === emoji ? " is-mine" : ""}`}
						disabled={!canReact}
						onClick={() => handleChip(emoji)}
						aria-label={emoji}
					>
						<Glyph emoji={emoji} />
						{(counts[emoji] || 0) > 0 ? <span>{counts[emoji]}</span> : null}
					</button>
				);
			})}
			{canReact && (
				<button
					type="button"
					class="react-add"
					aria-label={t("channel.reactions.addAria")}
					aria-expanded={open}
					onClick={() => setOpen((v) => !v)}
				>
					<IconSmiley aria-hidden="true" />
				</button>
			)}
			{open && canReact && (
				<div class="react-picker" role="listbox" aria-label={t("channel.reactions.pickerAria")}>
					{CHANNEL_REACTION_SET.map((emoji) => {
						return (
							<button
								key={emoji}
								type="button"
								aria-label={emoji}
								onClick={() => {
									onToggle(mine === emoji ? null : emoji);
									setOpen(false);
								}}
							>
								<Glyph emoji={emoji} />
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}
