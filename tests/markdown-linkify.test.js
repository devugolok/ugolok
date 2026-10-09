import { test } from "node:test";
import assert from "node:assert/strict";
import { splitLinks, looksLikeUrl, normalizeUrl } from "../src/core/markdown/linkify.js";
import { applyLink } from "../src/core/markdown/format-insert.js";

test("splitLinks: голые адреса становятся ссылками, пунктуация в конце — нет", () => {
	assert.deepEqual(splitLinks("смотри https://example.com/a?b=1, и www.test.ru. ок"), [
		{ text: "смотри " },
		{ href: "https://example.com/a?b=1", label: "https://example.com/a?b=1" },
		{ text: ", и " },
		{ href: "https://www.test.ru", label: "www.test.ru" },
		{ text: ". ок" },
	]);
	assert.deepEqual(splitLinks("(http://a.ru/x)"), [{ text: "(" }, { href: "http://a.ru/x", label: "http://a.ru/x" }, { text: ")" }]);
	assert.deepEqual(splitLinks("просто текст"), [{ text: "просто текст" }]);
	assert.deepEqual(splitLinks(""), [{ text: "" }]);
	assert.deepEqual(splitLinks("www. и https:// без адреса"), [{ text: "www. и https:// без адреса" }]);
});

test("splitLinks: опасные схемы не распознаются как адреса (javascript:/data:)", () => {
	assert.deepEqual(splitLinks("javascript:alert(1)"), [{ text: "javascript:alert(1)" }]);
	assert.deepEqual(splitLinks("data:text/html,<b>"), [{ text: "data:text/html,<b>" }]);
});

test("looksLikeUrl/normalizeUrl", () => {
	assert.equal(looksLikeUrl("https://a.ru/x"), true);
	assert.equal(looksLikeUrl("www.a.ru"), true);
	assert.equal(looksLikeUrl("не адрес"), false);
	assert.equal(looksLikeUrl("https://a.ru с пробелом"), false);
	assert.equal(normalizeUrl("www.a.ru"), "https://www.a.ru");
	assert.equal(normalizeUrl("site.ru/path"), "https://site.ru/path");
	assert.equal(normalizeUrl("mailto:x@y.z"), "mailto:x@y.z");
	assert.equal(normalizeUrl("   "), "");
});

test("applyLink: выделенное слово -> [слово](адрес); адрес без схемы получает https; пустой адрес — null", () => {
	const value = "зайди на сайт сегодня";
	const r = applyLink({ value, selectionStart: 9, selectionEnd: 13, url: "site.ru" });
	assert.equal(r.text, "[сайт](https://site.ru)");
	assert.equal(value.slice(0, r.replaceStart) + r.text + value.slice(r.replaceEnd), "зайди на [сайт](https://site.ru) сегодня");
	assert.equal(r.selectStart, 9 + r.text.length, "курсор после ссылки");
	assert.equal(applyLink({ value, selectionStart: 0, selectionEnd: 5, url: "  " }), null);
	assert.equal(applyLink({ value: "x", selectionStart: 0, selectionEnd: 0, url: "https://a.ru" }).text, "[https://a.ru](https://a.ru)", "без выделения подпись — сам адрес");
});
