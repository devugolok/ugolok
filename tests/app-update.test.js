import { test } from "node:test";
import assert from "node:assert/strict";
import { IDLE_UPDATE_STATE, reduceUpdateState, updatePercent, buildLabel } from "../src/domain/app-update.js";

test("reduceUpdateState: start -> progress -> ready, версия и хеш новой сборки сохраняются", () => {
	let s = reduceUpdateState(IDLE_UPDATE_STATE, { type: "sw-update:start", version: "0.0.13", hash: "def5678abc", total: 1000 });
	assert.deepEqual(s, { phase: "downloading", loaded: 0, total: 1000, newVersion: "0.0.13", newHash: "def5678abc" });
	s = reduceUpdateState(s, { type: "sw-update:progress", loaded: 400, total: 1000 });
	assert.equal(s.phase, "downloading");
	assert.equal(s.loaded, 400);
	assert.equal(s.newVersion, "0.0.13");
	s = reduceUpdateState(s, { type: "sw-update:ready", version: "0.0.13", hash: "def5678abc" });
	assert.equal(s.phase, "ready");
	assert.equal(s.loaded, 1000);
});

test("reduceUpdateState: progress без start и после ready не откатывает «готово»; мусор игнорируется", () => {
	const s = reduceUpdateState(IDLE_UPDATE_STATE, { type: "sw-update:progress", loaded: 10, total: 100 });
	assert.equal(s.phase, "downloading");
	const ready = reduceUpdateState(s, { type: "sw-update:ready" });
	assert.equal(reduceUpdateState(ready, { type: "sw-update:progress", loaded: 5, total: 100 }).phase, "ready");
	assert.equal(reduceUpdateState(ready, { type: "other" }), ready);
	assert.equal(reduceUpdateState(ready, null), ready);
	assert.equal(reduceUpdateState(undefined, { type: "sw-update:start", total: -5 }).total, 0);
});

test("updatePercent: известный размер — процент (до 99 пока качается), неизвестный — null", () => {
	assert.equal(updatePercent({ phase: "downloading", loaded: 500, total: 1000 }), 50);
	assert.equal(updatePercent({ phase: "downloading", loaded: 1000, total: 1000 }), 99, "100% только вместе с «готово»");
	assert.equal(updatePercent({ phase: "downloading", loaded: 5000, total: 1000 }), 99);
	assert.equal(updatePercent({ phase: "ready", loaded: 1000, total: 1000 }), 100);
	assert.equal(updatePercent({ phase: "downloading", loaded: 500, total: 0 }), null);
	assert.equal(updatePercent({ phase: "ready", loaded: 0, total: 0 }), 100);
});

test("buildLabel: версия и короткий хеш; dev-значения и пустое не печатаем", () => {
	assert.equal(buildLabel("0.0.12", "a1b2c3d4e5f6"), "0.0.12 (a1b2c3d)");
	assert.equal(buildLabel("0.0.12", "dev"), "0.0.12");
	assert.equal(buildLabel("0.0.0-dev", "a1b2c3d4"), "a1b2c3d");
	assert.equal(buildLabel(undefined, undefined), "");
});
