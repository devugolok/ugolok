import { normalizeUrl } from "./linkify.js";

// Ссылка на выделенный текст с УЖЕ известным адресом (панель выделения: ввели адрес и нажали «ОК»):
// «слово» -> «[слово](https://адрес)». Адрес без схемы получает https://. Пустой адрес — ничего не меняет (null).
export function applyLink({ value, selectionStart, selectionEnd, url }) {
    const address = normalizeUrl(url);
    if (!address) return null;
    const selected = value.slice(selectionStart, selectionEnd);
    const text = `[${selected || address}](${address})`;
    return {
        text,
        replaceStart: selectionStart,
        replaceEnd: selectionEnd,
        selectStart: selectionStart + text.length,
        selectEnd: selectionStart + text.length,
    };
}

export function applyFormat(kind, { value, selectionStart, selectionEnd }) {
    let text;
    let replaceStart;
    let replaceEnd;
    let selectStart;
    let selectEnd;
    let lineStart;
    let lineEndIdx;
    let lineEnd;
    let block;
    let prefix;

    const selected = value.slice(selectionStart, selectionEnd);

    switch (kind) {
        case "bold":
            if (selected === "") {
                text = "****";
                replaceStart = replaceEnd = selectionStart;
                selectStart = selectEnd = selectionStart + 2;
            } else {
                text = `**${selected}**`;
                replaceStart = selectionStart;
                replaceEnd = selectionEnd;
                selectStart = selectionStart;
                selectEnd = selectionStart + text.length;
            }
            break;
        case "italic":
            if (selected === "") {
                text = "**";
                replaceStart = replaceEnd = selectionStart;
                selectStart = selectEnd = selectionStart + 1;
            } else {
                text = `*${selected}*`;
                replaceStart = selectionStart;
                replaceEnd = selectionEnd;
                selectStart = selectionStart;
                selectEnd = selectionStart + text.length;
            }
            break;
        case "link":
            if (selected === "") {
                text = "[]()";
                replaceStart = replaceEnd = selectionStart;
                selectStart = selectEnd = selectionStart + 1;
            } else {
                text = `[${selected}]()`;
                replaceStart = selectionStart;
                replaceEnd = selectionEnd;
                selectStart = selectionStart + `[${selected}](`.length;
                selectEnd = selectStart;
            }
            break;
        case "quote":
            lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
            lineEndIdx = value.indexOf("\n", selectionEnd);
            lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
            block = value.slice(lineStart, lineEnd);
            prefix = "> ";
            text = block.split("\n").map(line => prefix + line).join("\n");
            replaceStart = lineStart;
            replaceEnd = lineEnd;
            selectStart = lineStart;
            selectEnd = lineStart + text.length;
            break;
        case "list":
            lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
            lineEndIdx = value.indexOf("\n", selectionEnd);
            lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
            block = value.slice(lineStart, lineEnd);
            prefix = "- ";
            text = block.split("\n").map(line => prefix + line).join("\n");
            replaceStart = lineStart;
            replaceEnd = lineEnd;
            selectStart = lineStart;
            selectEnd = lineStart + text.length;
            break;
        default:
            throw new Error(`Unsupported format kind: ${kind}`);
    }

    return { text, replaceStart, replaceEnd, selectStart, selectEnd };
}
