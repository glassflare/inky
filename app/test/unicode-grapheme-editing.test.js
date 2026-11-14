"use strict";

const assert = require("assert");
const { installGraphemeEditing } = require("../renderer/unicodeGraphemeEditing.js");

// Minimal simulation of Ace's public selection/editing contracts; the real
// Electron editor is tested separately in the isolated integration workflow.
class Range {
    constructor(startRow, startColumn, endRow, endColumn) {
        this.start = { row: startRow, column: startColumn };
        this.end = { row: endRow, column: endColumn };
    }
}

function mock(initial, ink = true) {
    let value = initial, column = 0;
    let selection = null;
    const line = () => value;
    const pos = () => ({row: 0, column});
    const editor = {
        session: { getLine: row => { assert.strictEqual(row, 0); return line(); } },
        setSession(next) {
            this.session = next;
            this.selection = {
                ...this.selection,
                moveCursorLeft() { column = Math.max(0, column - 1); },
                moveCursorRight() { column = Math.min(value.length, column + 1); }
            };
            delete this.selection.$inkyGraphemeEditing;
        },
        getCursorPosition: pos,
        getSelectionRange: () => selection || new Range(0, column, 0, column),
        getReadOnly: () => false,
        getBehavioursEnabled: () => false,
        selection: {
            getCursor: pos,
            isEmpty: () => selection === null || selection.start.column === selection.end.column,
            setSelectionRange: r => { selection = r; column = r.end.column; },
            getSelectionAnchor: () => selection ? selection.start : pos(),
            isBackwards: () => false,
            moveCursorTo: (_row, col) => { column = col; },
            moveCursorLeft() { column = Math.max(0, column - 1); },
            moveCursorRight() { column = Math.min(value.length, column + 1); },
        },
        insert(text) {
            const r = this.getSelectionRange();
            value = value.slice(0, r.start.column) + text + value.slice(r.end.column);
            column = r.start.column + text.length;
            selection = null;
        },
        remove(dir) {
            if (this.selection.isEmpty()) {
                const start = column;
                if (dir === "left") this.selection.moveCursorLeft();
                else this.selection.moveCursorRight();
                const a = Math.min(start, column), b = Math.max(start, column);
                selection = new Range(0, a, 0, b);
            }
            const r = this.getSelectionRange();
            value = value.slice(0, r.start.column) + value.slice(r.end.column);
            column = r.start.column;
            selection = null;
        }
    };
    installGraphemeEditing(editor, Range, () => ink);
    return {
        editor,
        moveTo(n) {column = n; selection = null;},
        select(a,b) {selection = new Range(0, a, 0, b);column = b;},
        value: () => value,
        col: () => column,
    };
}

describe("Unicode emoji grapheme editing", function() {
    for (const [label, emoji] of [
        ["candle with variation selector", "🕯️"],
        ["single emoji outside BMP", "😀"],
        ["skin-tone modifier", "👍🏽"],
        ["ZWJ family", "👩‍👩‍👦"],
        ["rainbow flag with ZWJ", "🏳️‍🌈"],
        ["regional indicator flag", "🇧🇷"],
        ["keycap", "1️⃣"],
        ["combining acute", "e\u0301"],
    ]) {
        it("deletes entire " + label + " using Backspace", function () {
            const f = mock("A" + emoji + "B");
            f.moveTo(1 + emoji.length);
            f.editor.remove("left");
            assert.strictEqual(f.value(), "AB");
            assert.strictEqual(f.col(), 1);
        });
        it("deletes entire " + label + " using Delete", function () {
            const f = mock("A" + emoji + "B");
            f.moveTo(1);
            f.editor.remove("right");
            assert.strictEqual(f.value(), "AB");
        });
        it("doesn't break " + label + " when caret lands inside it", function () {
            const f = mock("A" + emoji + "B");
            f.moveTo(2); // even inside a surrogate pair / ZWJ cluster
            f.editor.remove("left");
            assert.strictEqual(f.value(), "AB");
            assert.strictEqual(f.col(), 1);
        });
        it("expands selection endpoints to include whole " + label, function () {
            const f = mock("A" + emoji + "B");
            f.select(1, 2);
            f.editor.insert("X");
            assert.strictEqual(f.value(), "AXB");
        });
    }

    it("does not change ASCII-only Delete, Backspace, or insert behavior", function () {
        const f = mock("* [Visit house] -> END");
        f.moveTo(8);
        f.editor.remove("left");
        assert.strictEqual(f.value(), "* [Visi house] -> END");
        f.editor.insert("t");
        assert.strictEqual(f.value(), "* [Visit house] -> END");
    });

    it("preserves standard right/left movement outside emojis", function () {
        const f = mock("A🕯️B");
        f.moveTo(1);
        f.editor.selection.moveCursorRight();
        assert.strictEqual(f.col(), 4);
        f.editor.selection.moveCursorLeft();
        assert.strictEqual(f.col(), 1);
    });

    it("reinstalls cursor movement guards after Ace changes the active session", function () {
        const f = mock("A🕯️B");
        f.editor.setSession({getLine: () => f.value()});
        f.moveTo(1);
        f.editor.selection.moveCursorRight();
        assert.strictEqual(f.col(), 4);
        f.editor.selection.moveCursorLeft();
        assert.strictEqual(f.col(), 1);
    });

    it("keeps a disabled editor unchanged outside managed files", function () {
        const f = mock("A🕯️B", false);
        f.moveTo(4);
        f.editor.remove("left");
        assert.notStrictEqual(f.value(), "AB");
    });

    it("protects project YAML when editing is enabled", function () {
        const f = mock("title: 🕯️");
        f.moveTo("title: 🕯️".length);
        f.editor.remove("left");
        assert.strictEqual(f.value(), "title: ");
    });

    it("retains a valid UTF-8 roundtrip after removing emoji", function () {
        const f = mock("* [🕯️ Aproximar-se da casa] -> END");
        f.moveTo("* [🕯️".length);
        f.editor.remove("left");
        assert.strictEqual(f.value(), "* [ Aproximar-se da casa] -> END");
        assert.strictEqual(Buffer.from(f.value(), "utf8").toString("utf8"), f.value());
        assert(!f.value().includes("\uFFFD"), "Replacement character must never be introduced");
    });

    it("keeps interior insertion away from surrogate pairs", function () {
        const f = mock("A🕯️B");
        f.moveTo(2);
        f.editor.insert("X");
        assert.strictEqual(f.value(), "A🕯️XB");
    });
});
