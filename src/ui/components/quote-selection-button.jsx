import { useState, useEffect, useRef } from "preact/hooks";
import IconFormatQuote from "../icons/format-quote.jsx";
import { t } from "../signals/i18n.js";

// Кнопка «Цитировать» рядом с выделенным в пузыре текстом. Появляется, когда выделение целиком внутри ОДНОГО
// пузыря ленты (.message-bubble[data-msg-id], в личном чате, чате канала и комментариях); по нажатию отдаёт (msgId, выделенный текст) наверх —
// композер начинает ответ с этой цитатой. Положение — по прямоугольнику выделения; mousedown/pointerdown не отнимают
// выделение (preventDefault), иначе оно сбросилось бы до клика.
const SHOW_DELAY_MS = 120;

export default function QuoteSelectionButton({ onQuote }) {
	const [state, setState] = useState(null); // { msgId, text, top, left } | null
	const timerRef = useRef(null);

	useEffect(() => {
		function evaluate() {
			const sel = window.getSelection?.();
			if (!sel || sel.isCollapsed || sel.rangeCount === 0) return setState(null);
			const text = sel.toString().trim();
			if (!text) return setState(null);
			const range = sel.getRangeAt(0);
			const toEl = (node) => (node?.nodeType === 1 ? node : node?.parentElement);
			const bubble = toEl(range.commonAncestorContainer)?.closest?.(".message-bubble[data-msg-id]");
			if (!bubble) return setState(null);
			const rect = range.getBoundingClientRect();
			if (!rect || (rect.width === 0 && rect.height === 0)) return setState(null);
			setState({ msgId: bubble.dataset.msgId, text, top: rect.top, left: rect.left + rect.width / 2 });
		}
		function onChange() {
			clearTimeout(timerRef.current);
			timerRef.current = setTimeout(evaluate, SHOW_DELAY_MS);
		}
		document.addEventListener("selectionchange", onChange);
		// прокрутка двигает выделение относительно экрана — скрываем, пока человек листает
		window.addEventListener("scroll", () => setState(null), { capture: true, passive: true });
		return () => {
			document.removeEventListener("selectionchange", onChange);
			clearTimeout(timerRef.current);
		};
	}, []);

	if (!state) return null;
	const x = Math.min(Math.max(state.left, 72), window.innerWidth - 72);
	const y = Math.max(8, state.top - 44);
	return (
		<button
			type="button"
			class="quote-selection-button"
			style={{ top: `${y}px`, left: `${x}px` }}
			onPointerDown={(e) => e.preventDefault()}
			onMouseDown={(e) => e.preventDefault()}
			onClick={() => {
				onQuote(state.msgId, state.text);
				window.getSelection?.()?.removeAllRanges();
				setState(null);
			}}
		>
			<IconFormatQuote /> {t("message.quoteButton")}
		</button>
	);
}
