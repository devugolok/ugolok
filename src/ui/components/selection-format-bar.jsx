import { useState, useEffect, useRef } from "preact/hooks";
import { t } from "../signals/i18n.js";
import { applyFormat, applyLink } from "../../core/markdown/format-insert.js";
import { looksLikeUrl } from "../../core/markdown/linkify.js";
import IconFormatBold from "../icons/format-bold.jsx";
import IconFormatItalic from "../icons/format-italic.jsx";
import IconFormatQuote from "../icons/format-quote.jsx";
import IconFormatList from "../icons/format-list.jsx";
import IconFormatLink from "../icons/format-link.jsx";
import IconCross from "../icons/cross.jsx";

// Панель форматирования, которая появляется ТОЛЬКО когда в поле ввода выделен текст (жирный, курсив, цитата, список,
// ссылка) — вместо постоянной кнопки «Aa». Рисуется НАД полем (position:absolute, не сдвигает вёрстку и не
// перекрывает системное меню выделения на Android). Родитель должен быть position:relative (.composer__field /
// .selection-format-host). Нажатия на панель не отнимают у поля фокус и выделение (preventDefault на pointerdown/
// mousedown), иначе выделение сбросилось бы до клика.
//
// Ссылка: выделил слово -> «Ссылка» -> в панели появляется строка «Адрес…» с кнопкой «ОК» и (если браузер даёт
// читать буфер) «Вставить из буфера»; ОК оборачивает выделенное в [слово](адрес). Выделение на время ввода адреса
// запоминается, потому что поле ввода адреса забирает фокус.
export default function SelectionFormatBar({ textareaRef, value, onChange }) {
	const [range, setRange] = useState(null); // { start, end } выделения в textarea, либо null
	const [linkOpen, setLinkOpen] = useState(false);
	const [url, setUrl] = useState("");
	const linkOpenRef = useRef(false);
	const savedRangeRef = useRef(null);
	const canReadClipboard = typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function";

	useEffect(() => {
		const el = textareaRef.current;
		if (!el) return;
		function sync() {
			if (linkOpenRef.current) return; // пока вводят адрес, панель остаётся
			const { selectionStart: start, selectionEnd: end } = el;
			setRange(document.activeElement === el && end > start ? { start, end } : null);
		}
		function syncSoon() {
			setTimeout(sync, 0); // blur/select приходят до обновления activeElement/selection
		}
		const events = ["select", "keyup", "mouseup", "touchend", "pointerup", "input", "focus", "blur"];
		for (const name of events) el.addEventListener(name, syncSoon);
		document.addEventListener("selectionchange", syncSoon); // долгое нажатие/ручки выделения на телефоне
		return () => {
			for (const name of events) el.removeEventListener(name, syncSoon);
			document.removeEventListener("selectionchange", syncSoon);
		};
	}, [textareaRef]);

	function closeLink() {
		linkOpenRef.current = false;
		setLinkOpen(false);
		setUrl("");
		setTimeout(() => textareaRef.current?.focus(), 0);
	}

	function replaceInField(result) {
		const el = textareaRef.current;
		if (!el) return;
		el.focus();
		el.setRangeText(result.text, result.replaceStart, result.replaceEnd, "preserve");
		el.selectionStart = result.selectStart;
		el.selectionEnd = result.selectEnd;
		onChange(el.value);
	}

	function handleFormat(kind) {
		const el = textareaRef.current;
		if (!el) return;
		replaceInField(applyFormat(kind, { value, selectionStart: el.selectionStart, selectionEnd: el.selectionEnd }));
	}

	function openLink() {
		const el = textareaRef.current;
		if (!el) return;
		savedRangeRef.current = { start: el.selectionStart, end: el.selectionEnd };
		const selected = el.value.slice(el.selectionStart, el.selectionEnd);
		setUrl(looksLikeUrl(selected) ? selected.trim() : "");
		linkOpenRef.current = true;
		setLinkOpen(true);
	}

	function submitLink(e) {
		e?.preventDefault();
		const saved = savedRangeRef.current;
		const el = textareaRef.current;
		if (!saved || !el) return closeLink();
		const result = applyLink({ value: el.value, selectionStart: saved.start, selectionEnd: saved.end, url });
		if (result) replaceInField(result);
		closeLink();
	}

	async function pasteFromClipboard() {
		try {
			const clip = (await navigator.clipboard.readText()).trim();
			if (looksLikeUrl(clip)) setUrl(clip);
		} catch {
			// нет разрешения на буфер — человек вставит адрес вручную
		}
	}

	if (!range && !linkOpen) return null;
	const keepFocus = (e) => {
		// не отнимать фокус/выделение у поля; поле адреса, наоборот, должно получать фокус
		if (!e.target.closest?.(".selection-format-bar__url")) e.preventDefault();
	};

	return (
		<div class="selection-format-bar stack" role="toolbar" aria-label={t("markdownToolbar.barAria")} onPointerDown={keepFocus} onMouseDown={keepFocus} style={{ "--gap": "var(--space-2xs)" }}>
			{linkOpen ? (
				<form class="selection-format-bar__link row" style={{ "--gap": "var(--space-2xs)", "--align": "center" }} onSubmit={submitLink}>
					<input
						class="selection-format-bar__url"
						type="text"
						inputMode="url"
						autoCapitalize="off"
						autoCorrect="off"
						spellcheck={false}
						value={url}
						placeholder={t("markdownToolbar.linkPlaceholder")}
						aria-label={t("markdownToolbar.linkPlaceholder")}
						onInput={(e) => setUrl(e.currentTarget.value)}
						ref={(node) => node && !node.dataset.focused && ((node.dataset.focused = "1"), node.focus())}
					/>
					<button type="submit" class="selection-format-bar__ok" disabled={!url.trim()}>
						{t("markdownToolbar.linkOk")}
					</button>
					{canReadClipboard && (
						<button type="button" class="markdown-toolbar-btn" onClick={pasteFromClipboard} aria-label={t("markdownToolbar.linkPaste")} title={t("markdownToolbar.linkPaste")}>
							<IconFormatLink />
						</button>
					)}
					<button type="button" class="markdown-toolbar-btn" onClick={closeLink} aria-label={t("markdownToolbar.linkClose")} title={t("markdownToolbar.linkClose")}>
						<IconCross />
					</button>
				</form>
			) : (
				<div class="markdown-toolbar row" style={{ "--gap": "var(--space-2xs)" }}>
					<button type="button" class="markdown-toolbar-btn" onClick={() => handleFormat("bold")} aria-label={t("markdownToolbar.boldAria")}><IconFormatBold /></button>
					<button type="button" class="markdown-toolbar-btn" onClick={() => handleFormat("italic")} aria-label={t("markdownToolbar.italicAria")}><IconFormatItalic /></button>
					<button type="button" class="markdown-toolbar-btn" onClick={() => handleFormat("quote")} aria-label={t("markdownToolbar.quoteAria")}><IconFormatQuote /></button>
					<button type="button" class="markdown-toolbar-btn" onClick={() => handleFormat("list")} aria-label={t("markdownToolbar.listAria")}><IconFormatList /></button>
					<button type="button" class="markdown-toolbar-btn" onClick={openLink} aria-label={t("markdownToolbar.linkAria")}><IconFormatLink /></button>
				</div>
			)}
		</div>
	);
}
