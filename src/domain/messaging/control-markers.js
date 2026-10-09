// Служебные сообщения (правка, удаление, курсор прочтения, реакция) идут обычными MLS-сообщениями с маркером в
// тексте и в ленту не попадают. Один список префиксов — чтобы «служебное ли это» решалось в одном месте (лента,
// счётчик непрочитанного). Тест tests/control-markers.test.js сверяет префиксы с модулями, где они объявлены.
export const CONTROL_MARKER_PREFIXES = ["__ugolok_edit__:", "__ugolok_delete__:", "__ugolok_cursor__:", "__ugolok_react__:"];

export function isControlText(text) {
	return typeof text === "string" && CONTROL_MARKER_PREFIXES.some((p) => text.startsWith(p));
}
