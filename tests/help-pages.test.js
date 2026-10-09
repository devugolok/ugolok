import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildHelpPages, extractMeta, helpPath, HELP_LOCALES, HELP_TOPICS, markdownToHtml } from "../scripts/help-pages.mjs";

const SRC = new URL("../src", import.meta.url).pathname;

test("markdownToHtml: разметка и экранирование", () => {
	const html = markdownToHtml("# Заголовок\n\nТекст **жирный** и <script>alert(1)</script>\n\n- раз\n- два\n");
	assert.match(html, /<h1>Заголовок<\/h1>/);
	assert.match(html, /<strong>жирный<\/strong>/);
	assert.match(html, /<li>раз<\/li><li>два<\/li>/);
	assert.ok(!html.includes("<script>"), "сырой HTML из markdown не должен попасть в страницу");
	assert.match(markdownToHtml("a < b & c"), /a &lt; b &amp; c/);
});

test("markdownToHtml: опасные ссылки отбрасываются, внешние — rel=noopener", () => {
	const html = markdownToHtml("[плохо](javascript:alert(1)) [хорошо](https://example.org) mailto: [почта](mailto:a@b.c)");
	assert.ok(!html.includes("javascript:"));
	assert.match(html, /<a href="https:\/\/example\.org" rel="noopener">хорошо<\/a>/);
	assert.match(html, /<a href="mailto:a@b\.c">почта<\/a>/);
});

test("markdownToHtml: голый адрес становится ссылкой", () => {
	assert.match(markdownToHtml("см. https://ugolok.tech/x."), /<a href="https:\/\/ugolok\.tech\/x" rel="noopener">https:\/\/ugolok\.tech\/x<\/a>\./);
});

test("extractMeta: заголовок и описание не длиннее 160 знаков", () => {
	const meta = extractMeta(`# Тема\n\n${"слово ".repeat(60)}\n`);
	assert.equal(meta.heading, "Тема");
	assert.ok(meta.description.length <= 160);
	assert.ok(meta.description.endsWith("…"));
});

test("справка: файл каждой темы есть на каждом языке", () => {
	for (const lc of HELP_LOCALES) {
		for (const topic of HELP_TOPICS) {
			assert.ok(existsSync(join(SRC, "content/help", lc, `${topic.id}.md`)), `${lc}/${topic.id}.md`);
		}
	}
});

test("buildHelpPages: 72 страницы, canonical, hreflang и sitemap", () => {
	const out = mkdtempSync(join(tmpdir(), "help-pages-"));
	try {
		const urls = buildHelpPages({ srcDir: SRC, outDir: out, origin: "https://ugolok.tech/" });
		assert.equal(urls.length, HELP_LOCALES.length * HELP_TOPICS.length);

		const page = readFileSync(join(out, "help/de/privatnost.html"), "utf8");
		assert.match(page, /<html lang="de">/);
		assert.match(page, /<link rel="canonical" href="https:\/\/ugolok\.tech\/help\/de\/privatnost\.html">/);
		assert.equal((page.match(/rel="alternate" hreflang=/g) ?? []).length, HELP_LOCALES.length + 1);
		assert.match(page, /<title>[^<]+ — [^<]+<\/title>/);
		assert.match(page, /<meta name="description" content="[^"]+">/);
		assert.ok(!page.includes("{{"), "неподставленный шаблон i18n");

		const sitemap = readFileSync(join(out, "sitemap.xml"), "utf8");
		const locs = sitemap.match(/<loc>[^<]+<\/loc>/g) ?? [];
		assert.equal(locs.length, urls.length + 1, "главная + все страницы справки");
		assert.ok(sitemap.includes(`<loc>https://ugolok.tech${helpPath("ru", "o-proekte")}</loc>`));
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
});
