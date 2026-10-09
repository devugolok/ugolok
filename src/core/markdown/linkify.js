// Голые адреса в тексте превращаются в ссылки ПРИ ПОКАЗЕ (markdown-view.jsx), а не при разборе: разбор используют и
// редактор постов, и преобразования в обычный текст — молча подменять там сохранённый исходник нельзя.
// Распознаются http(s)://… и www.…; хвостовая пунктуация («.», «,», «)», «!» …) в адрес не входит.
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"]+/gi;
const TRAILING = /[.,;:!?)\]}»”'’]+$/;

export function looksLikeUrl(value) {
	return typeof value === "string" && /^(?:https?:\/\/|www\.)[^\s<>"]+$/i.test(value.trim());
}

// href для показа/вставки: у адреса без схемы («www.site.ru») добавляем https://.
export function normalizeUrl(value) {
	const v = String(value ?? "").trim();
	if (!v) return "";
	return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(v) ? v : `https://${v}`;
}

// -> массив фрагментов: { text } для обычного текста и { href, label } для ссылки.
export function splitLinks(text) {
	const source = String(text ?? "");
	const out = [];
	let last = 0;
	for (const match of source.matchAll(URL_PATTERN)) {
		let label = match[0];
		const trail = TRAILING.exec(label);
		if (trail) label = label.slice(0, label.length - trail[0].length);
		// «www.» без хоть какого-то домена после — не адрес
		if (!label || /^www\.$/i.test(label) || /^https?:\/\/$/i.test(label)) continue;
		if (match.index > last) out.push({ text: source.slice(last, match.index) });
		out.push({ href: normalizeUrl(label), label });
		last = match.index + label.length;
	}
	if (last < source.length) out.push({ text: source.slice(last) });
	return out.length > 0 ? out : [{ text: source }];
}
