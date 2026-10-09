import { parseRich, parseLite } from "../../core/markdown/parse.js";
import { toPlainText } from "../../core/markdown/to-plain.js";
import { safeHref } from "../../core/markdown/sanitize.js";
import { splitLinks } from "../../core/markdown/linkify.js";
import { RICH_BLOCK_TYPES, RICH_INLINE_TYPES, LITE_BLOCK_TYPES, LITE_INLINE_TYPES } from "../../core/markdown/node-allowlist.js";

function textFallback(node) {
	return toPlainText({ type: "root", children: [node] });
}

// inLink — мы уже внутри ссылки: адрес в её тексте второй раз ссылкой не делаем.
function renderInline(nodes, inlineTypes, keyPrefix, inLink = false) {
	return nodes.map((node, i) => {
		const key = keyPrefix + "-" + i;
		if (node.type === "image") {
			const href = safeHref(node.url);
			const label = node.alt || node.url || "";
			if (href === null) return label;
			return <a key={key} href={href} target="_blank" rel="noopener noreferrer">{label}</a>;
		}
		if (!inlineTypes.includes(node.type)) return textFallback(node);
		switch (node.type) {
			case "text": {
				if (inLink) return node.value;
				// голые адреса -> ссылки; небезопасная схема отбрасывается так же, как у обычных ссылок (safeHref)
				const parts = splitLinks(node.value);
				if (parts.length === 1 && parts[0].text !== undefined) return node.value;
				return parts.map((part, j) => {
					if (part.text !== undefined) return part.text;
					const href = safeHref(part.href);
					return href === null ? part.label : <a key={`${key}-l${j}`} href={href} target="_blank" rel="noopener noreferrer">{part.label}</a>;
				});
			}
			case "strong":
				return <strong key={key}>{renderInline(node.children, inlineTypes, key, inLink)}</strong>;
			case "emphasis":
				return <em key={key}>{renderInline(node.children, inlineTypes, key, inLink)}</em>;
			case "inlineCode":
				return <code key={key} class="md-code-inline">{node.value}</code>;
			case "break":
				return <br key={key} />;
			case "link": {
				const href = safeHref(node.url);
				if (href === null) return textFallback(node);
				return <a key={key} href={href} target="_blank" rel="noopener noreferrer">{renderInline(node.children, inlineTypes, key, true)}</a>;
			}
			default:
				return textFallback(node);
		}
	});
}

function renderBlock(node, blockTypes, inlineTypes, key) {
	if (!blockTypes.includes(node.type)) {
		return <p key={key}>{textFallback(node)}</p>;
	}
	switch (node.type) {
		case "heading": {
			const Tag = "h" + node.depth;
			return <Tag key={key}>{renderInline(node.children, inlineTypes, key)}</Tag>;
		}
		case "paragraph":
			return <p key={key}>{renderInline(node.children, inlineTypes, key)}</p>;
		case "blockquote":
			return <blockquote key={key}>{node.children.map((c, j) => renderBlock(c, blockTypes, inlineTypes, key + "-" + j))}</blockquote>;
		case "list": {
			const Tag = node.ordered ? "ol" : "ul";
			return <Tag key={key}>{node.children.map((c, j) => renderBlock(c, blockTypes, inlineTypes, key + "-" + j))}</Tag>;
		}
		case "listItem":
			return <li key={key}>{node.children.map((c, j) => renderBlock(c, blockTypes, inlineTypes, key + "-" + j))}</li>;
		case "code":
			return <pre key={key} class="md-code-block"><code>{node.value}</code></pre>;
		case "thematicBreak":
			return <hr key={key} />;
		default:
			return <p key={key}>{textFallback(node)}</p>;
	}
}

export default function MarkdownView({ source, profile = "lite" }) {
	const isRich = profile === "rich";
	const blockTypes = isRich ? RICH_BLOCK_TYPES : LITE_BLOCK_TYPES;
	const inlineTypes = isRich ? RICH_INLINE_TYPES : LITE_INLINE_TYPES;
	const tree = isRich ? parseRich(source ?? "") : parseLite(source ?? "");
	return (
		<div class="md-view">
			{tree.children.map((node, i) => renderBlock(node, blockTypes, inlineTypes, "b-" + i))}
		</div>
	);
}
