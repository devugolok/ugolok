// Справка статическими страницами для поисковиков: dist/help/{locale}/{topic}.html
// и sitemap.xml со всеми ними. Клиент — singlefile SPA, без JS робот видит в нём
// только заглушку; справка же — готовый текст на 12 языках, который до сих пор жил
// лишь внутри приложения (help-content.jsx). Источник тот же — src/content/help,
// разбор тот же — mdast-util-from-markdown и тот же allowlist узлов, что у
// markdown-view.jsx, только вывод — строка HTML, а не Preact-дерево.
//
// Файлы .html (не /topic/ с index.html): Caddy отдаёт `try_files {path} /index.html`,
// и /help/ru/o-proekte/ без правки конфига ушёл бы в SPA-фолбэк.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
import { safeHref } from "../src/core/markdown/sanitize.js";
import { splitLinks } from "../src/core/markdown/linkify.js";
import { RICH_BLOCK_TYPES, RICH_INLINE_TYPES } from "../src/core/markdown/node-allowlist.js";

// Порядок = порядок в sitemap и в переключателе языков; ru первым — основная аудитория.
export const HELP_LOCALES = ["ru", "en", "es", "de", "fr", "pt", "it", "nl", "pl", "tr", "ja", "zh"];
// Тот же порядок и те же titleKey, что TOPIC_DEFS в src/ui/components/help-content.jsx.
export const HELP_TOPICS = [
	{ id: "o-proekte", titleKey: "oProekte" },
	{ id: "kontakty-i-kanaly", titleKey: "kontaktyIKanaly" },
	{ id: "privatnost", titleKey: "privatnost" },
	{ id: "stek", titleKey: "stek" },
	{ id: "iskhodnyj-kod", titleKey: "iskhodnyjKod" },
	{ id: "podderzhka", titleKey: "podderzhka" },
];
// Имя языка на нём самом — в локалях такого ключа нет, а переключатель должен читаться носителем.
const NATIVE_NAMES = { ru: "Русский", en: "English", es: "Español", de: "Deutsch", fr: "Français", pt: "Português", it: "Italiano", nl: "Nederlands", pl: "Polski", tr: "Türkçe", ja: "日本語", zh: "中文" };
const X_DEFAULT = "en";

export function helpPath(locale, topicId) {
	return `/help/${locale}/${topicId}.html`;
}

function escapeHtml(value) {
	return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function plainText(node) {
	if (node.type === "text" || node.type === "inlineCode" || node.type === "code") return node.value ?? "";
	if (node.type === "break") return " ";
	return (node.children ?? []).map(plainText).join("");
}

function link(href, label) {
	const safe = safeHref(href);
	if (safe === null) return label;
	const external = /^https?:/i.test(safe);
	return `<a href="${escapeHtml(safe)}"${external ? ' rel="noopener"' : ""}>${label}</a>`;
}

function renderInline(nodes, inLink = false) {
	return nodes
		.map((node) => {
			if (node.type === "image") return link(node.url, escapeHtml(node.alt || node.url || ""));
			if (!RICH_INLINE_TYPES.includes(node.type)) return escapeHtml(plainText(node));
			switch (node.type) {
				case "text":
					if (inLink) return escapeHtml(node.value);
					// голые адреса -> ссылки, как в markdown-view.jsx
					return splitLinks(node.value)
						.map((part) => (part.text !== undefined ? escapeHtml(part.text) : link(part.href, escapeHtml(part.label))))
						.join("");
				case "strong":
					return `<strong>${renderInline(node.children, inLink)}</strong>`;
				case "emphasis":
					return `<em>${renderInline(node.children, inLink)}</em>`;
				case "inlineCode":
					return `<code>${escapeHtml(node.value)}</code>`;
				case "break":
					return "<br>";
				case "link":
					return link(node.url, renderInline(node.children, true));
				default:
					return escapeHtml(plainText(node));
			}
		})
		.join("");
}

function renderBlocks(nodes, tight = false) {
	return nodes
		.map((node) => {
			if (!RICH_BLOCK_TYPES.includes(node.type)) return `<p>${escapeHtml(plainText(node))}</p>`;
			switch (node.type) {
				case "heading": {
					const level = Math.min(Math.max(node.depth, 1), 6);
					return `<h${level}>${renderInline(node.children)}</h${level}>`;
				}
				case "paragraph":
					// в «плотном» списке абзац внутри пункта — просто строка, без <p>
					return tight ? renderInline(node.children) : `<p>${renderInline(node.children)}</p>`;
				case "list": {
					const tag = node.ordered ? "ol" : "ul";
					const start = node.ordered && node.start != null && node.start !== 1 ? ` start="${Number(node.start)}"` : "";
					return `<${tag}${start}>${node.children.map((item) => renderBlocks([item], !node.spread)).join("")}</${tag}>`;
				}
				case "listItem":
					return `<li>${renderBlocks(node.children, tight && !node.spread)}</li>`;
				case "blockquote":
					return `<blockquote>${renderBlocks(node.children)}</blockquote>`;
				case "code":
					return `<pre><code>${escapeHtml(node.value)}</code></pre>`;
				case "thematicBreak":
					return "<hr>";
				default:
					return "";
			}
		})
		.join("\n");
}

export function markdownToHtml(source) {
	return renderBlocks(fromMarkdown(source ?? "").children);
}

// Заголовок страницы — первый заголовок статьи; описание — первый абзац, до ~160 знаков по границе слова.
export function extractMeta(source) {
	const tree = fromMarkdown(source ?? "");
	const heading = tree.children.find((n) => n.type === "heading");
	const paragraph = tree.children.find((n) => n.type === "paragraph");
	let description = paragraph ? plainText(paragraph).replace(/\s+/g, " ").trim() : "";
	if (description.length > 160) {
		const cut = description.slice(0, 159);
		const space = cut.lastIndexOf(" ");
		description = (space > 80 ? cut.slice(0, space) : cut).replace(/[\s,;:—–-]+$/, "") + "…";
	}
	return { heading: heading ? plainText(heading).trim() : "", description };
}

function interpolate(template, vars) {
	return String(template).replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

function loadStrings(srcDir, locale) {
	const d = JSON.parse(readFileSync(join(srcDir, "ui/i18n/locales", `${locale}.json`), "utf8"));
	const appName = d.app.name;
	return {
		appName,
		help: d.nav.help,
		topicsAria: d.help.topicsAria,
		language: d.settings.language.sectionTitle,
		openApp: interpolate(d.unlock.main.loginForm.submitButton, { appName }),
		topics: Object.fromEntries(HELP_TOPICS.map((t) => [t.id, d.help.topics[t.titleKey]])),
	};
}

// Цвета — те же формулы, что дефолтная тема клиента (src/styles/minimal.css, --accent-hue: 45).
const STYLE = `
:root{color-scheme:light dark;--h:45;--bg:light-dark(oklch(.98 .008 calc(var(--h) + 25)),oklch(.17 .016 calc(var(--h) + 25)));--fg:light-dark(oklch(.26 .0256 calc(var(--h) + 25)),oklch(.89 .0256 calc(var(--h) + 25)));--muted:light-dark(oklch(.53 .016 calc(var(--h) + 25)),oklch(.62 .016 calc(var(--h) + 25)));--line:light-dark(oklch(.94 .016 calc(var(--h) + 25)),oklch(.21 .016 calc(var(--h) + 25)));--accent:light-dark(oklch(.55 .1288 var(--h)),oklch(.74 .1288 var(--h)));--on-accent:light-dark(oklch(1 0 0),oklch(.1 0 0))}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}
.top{display:flex;align-items:center;justify-content:space-between;gap:1rem;max-width:62rem;margin:0 auto;padding:1rem}
.brand{font-weight:700;font-size:1.25rem;text-decoration:none;color:var(--fg)}
.cta{display:inline-block;padding:.45rem .9rem;border-radius:999px;background:var(--accent);color:var(--on-accent);text-decoration:none;font-weight:600}
.layout{display:grid;gap:2rem;max-width:62rem;margin:0 auto;padding:0 1rem 2rem}
@media (min-width:48rem){.layout{grid-template-columns:14rem 1fr}}
.topics ul{list-style:none;margin:0;padding:0}
.topics li{margin:.15rem 0}
.topics a{display:block;padding:.35rem .6rem;border-radius:.5rem;text-decoration:none;color:var(--fg)}
.topics a[aria-current]{background:var(--line);font-weight:600}
article{min-width:0;max-width:44rem}
article h1{font-size:1.9rem;line-height:1.25;margin-top:0}
code{font-size:.92em;background:var(--line);padding:.1em .3em;border-radius:.3em}
pre{overflow:auto;background:var(--line);padding:.8rem;border-radius:.5rem}
pre code{background:none;padding:0}
blockquote{margin:1rem 0;padding:.2rem 1rem;border-left:3px solid var(--line);color:var(--muted)}
.langs{max-width:62rem;margin:0 auto;padding:1rem;border-top:1px solid var(--line);color:var(--muted);font-size:.92rem}
.langs a{margin-right:.75rem}
`;

function renderPage({ origin, locale, topic, strings, source }) {
	const { heading, description } = extractMeta(source);
	const title = `${heading || strings.topics[topic.id]} — ${strings.appName}`;
	const url = origin + helpPath(locale, topic.id);
	const alternates = HELP_LOCALES.map((lc) => `<link rel="alternate" hreflang="${lc}" href="${origin}${helpPath(lc, topic.id)}">`)
		.concat(`<link rel="alternate" hreflang="x-default" href="${origin}${helpPath(X_DEFAULT, topic.id)}">`)
		.join("\n");
	const nav = HELP_TOPICS.map((t) => {
		const current = t.id === topic.id ? ' aria-current="page"' : "";
		return `<li><a href="${helpPath(locale, t.id)}"${current}>${escapeHtml(strings.topics[t.id])}</a></li>`;
	}).join("");
	const langs = HELP_LOCALES.map((lc) =>
		lc === locale
			? `<strong lang="${lc}">${NATIVE_NAMES[lc]}</strong>`
			: `<a href="${helpPath(lc, topic.id)}" hreflang="${lc}" lang="${lc}">${NATIVE_NAMES[lc]}</a>`,
	).join(" ");
	return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${url}">
${alternates}
<meta property="og:type" content="article">
<meta property="og:site_name" content="${escapeHtml(strings.appName)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${origin}/og-image.png">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>${STYLE}</style>
</head>
<body>
<header class="top">
<a class="brand" href="/">${escapeHtml(strings.appName)}</a>
<a class="cta" href="/">${escapeHtml(strings.openApp)}</a>
</header>
<div class="layout">
<nav class="topics" aria-label="${escapeHtml(strings.topicsAria)}"><ul>${nav}</ul></nav>
<main><article>
${markdownToHtml(source)}
</article></main>
</div>
<footer class="langs"><nav aria-label="${escapeHtml(strings.language)}">${escapeHtml(strings.language)}: ${langs}</nav></footer>
</body>
</html>
`;
}

function renderSitemap(origin) {
	const urls = [`  <url>\n    <loc>${origin}/</loc>\n  </url>`];
	for (const topic of HELP_TOPICS) {
		const alternates = HELP_LOCALES.map((lc) => `    <xhtml:link rel="alternate" hreflang="${lc}" href="${origin}${helpPath(lc, topic.id)}"/>`)
			.concat(`    <xhtml:link rel="alternate" hreflang="x-default" href="${origin}${helpPath(X_DEFAULT, topic.id)}"/>`)
			.join("\n");
		for (const lc of HELP_LOCALES) {
			urls.push(`  <url>\n    <loc>${origin}${helpPath(lc, topic.id)}</loc>\n${alternates}\n  </url>`);
		}
	}
	return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join("\n")}
</urlset>
`;
}

// Пишет страницы и sitemap.xml в outDir; возвращает список абсолютных адресов (для отчёта/тестов).
export function buildHelpPages({ srcDir, outDir, origin }) {
	const base = origin.replace(/\/+$/, "");
	const written = [];
	for (const locale of HELP_LOCALES) {
		const strings = loadStrings(srcDir, locale);
		const dir = join(outDir, "help", locale);
		mkdirSync(dir, { recursive: true });
		for (const topic of HELP_TOPICS) {
			const source = readFileSync(join(srcDir, "content/help", locale, `${topic.id}.md`), "utf8");
			writeFileSync(join(dir, `${topic.id}.html`), renderPage({ origin: base, locale, topic, strings, source }));
			written.push(base + helpPath(locale, topic.id));
		}
	}
	writeFileSync(join(outDir, "sitemap.xml"), renderSitemap(base));
	return written;
}
