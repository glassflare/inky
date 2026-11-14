"use strict";

// Ace 1.2.6 cursor columns are UTF-16 offsets. Its default left/right
// movements advance a single code unit, which can split an emoji grapheme.
// Keep native tab/fold/line behavior, intervening only inside multi-unit
// extended grapheme clusters in Ink documents.
function installGraphemeEditing(editor, Range, isInkFile) {
    if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function")
        return false;

    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const isInk = () => !!isInkFile();

    function containing(line, col) {
        if (col <= 0 || col >= line.length) return null;
        for (const part of segmenter.segment(line)) {
            const start = part.index, end = start + part.segment.length;
            if (start < col && col < end) return { start, end };
            if (start >= col) break;
        }
        return null;
    }

    function previousBoundary(line, col) {
        if (col <= 0) return 0;
        let prev = 0;
        for (const part of segmenter.segment(line)) {
            if (part.index >= col) break;
            prev = part.index;
        }
        return prev;
    }

    function nextBoundary(line, col) {
        if (col >= line.length) return line.length;
        for (const part of segmenter.segment(line)) {
            const end = part.index + part.segment.length;
            if (end > col) return end;
        }
        return line.length;
    }

    function snapSelection() {
        const selection = editor.selection;
        if (selection.isEmpty()) return false;
        const range = editor.getSelectionRange();
        const startLine = editor.session.getLine(range.start.row);
        const endLine = editor.session.getLine(range.end.row);
        const start = containing(startLine, range.start.column);
        const end = containing(endLine, range.end.column);
        if (!start && !end) return false;
        selection.setSelectionRange(new Range(
            range.start.row, start ? start.start : range.start.column,
            range.end.row, end ? end.end : range.end.column
        ));
        return true;
    }

    function patchSelection(selection) {
        if (selection.$inkyGraphemeEditing) return;
        selection.$inkyGraphemeEditing = true;
        const left = selection.moveCursorLeft;
        const right = selection.moveCursorRight;

        selection.moveCursorLeft = function(...args) {
            if (isInk()) {
                const cursor = this.getCursor();
                if (cursor.column > 0) {
                    const line = editor.session.getLine(cursor.row);
                    const col = previousBoundary(line, cursor.column);
                    if (col < cursor.column - 1) {
                        this.moveCursorTo(cursor.row, col);
                        return;
                    }
                }
            }
            return left.apply(this, args);
        };

        selection.moveCursorRight = function(...args) {
            if (isInk()) {
                const cursor = this.getCursor();
                const line = editor.session.getLine(cursor.row);
                if (cursor.column < line.length) {
                    const col = nextBoundary(line, cursor.column);
                    if (col > cursor.column + 1) {
                        this.moveCursorTo(cursor.row, col);
                        return;
                    }
                }
            }
            return right.apply(this, args);
        };
    }

    if (!editor.$inkyGraphemeEditing) {
        editor.$inkyGraphemeEditing = true;
        const originalRemove = editor.remove;
        const originalInsert = editor.insert;

        editor.remove = function(dir, ...args) {
            if (isInk()) {
                if (this.selection.isEmpty()) {
                    const pos = this.getCursorPosition();
                    const split = containing(this.session.getLine(pos.row), pos.column);
                    if (split) {
                        this.selection.setSelectionRange(new Range(pos.row, split.start, pos.row, split.end));
                    }
                } else {
                    snapSelection();
                }
            }
            return originalRemove.call(this, dir, ...args);
        };

        editor.insert = function(text, ...args) {
            if (isInk()) {
                if (this.selection.isEmpty()) {
                    const pos = this.getCursorPosition();
                    const split = containing(this.session.getLine(pos.row), pos.column);
                    if (split) this.selection.moveCursorTo(pos.row, split.end);
                } else {
                    snapSelection();
                }
            }
            return originalInsert.call(this, text, ...args);
        };
    }

    // Ace creates a new Selection whenever a different EditSession is opened.
    // Reinstall the movement guards on each new selection (not only at startup).
    const originalSetSession = editor.setSession;
    editor.setSession = function(session, ...args) {
        const result = originalSetSession.call(this, session, ...args);
        patchSelection(this.selection);
        return result;
    };

    patchSelection(editor.selection);
    return true;
}

module.exports = { installGraphemeEditing };
