"use strict";

// Ace 1.2.6 stores columns as UTF-16 offsets. Mouse hit testing, double
// clicks, word commands and the clipboard can otherwise split a user-visible
// grapheme (surrogate pairs, variation selectors, ZWJ, flags or accents).
// Intercept selection primitives, not only the Backspace/Insert commands.
// This applies to both Ink and YAML editing, preserving every original code
// point and without changing the bundled Ace implementation.
function installGraphemeEditing(editor, Range, isEditableFile) {
    if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function")
        return false;

    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const enabled = () => !!isEditableFile();

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

    function snap(row, col, direction) {
        const line = editor.session.getLine(row);
        if (typeof line !== "string") return col;
        const part = containing(line, col);
        if (!part) return col;
        if (direction === "left") return part.start;
        if (direction === "right") return part.end;
        return (col - part.start < part.end - col) ? part.start : part.end;
    }

    function pointCmp(a, b) {
        return a.row - b.row || a.column - b.column;
    }

    function expandedRange(range) {
        if (!range || !range.start || !range.end) return range;
        if (pointCmp(range.start, range.end) === 0) {
            const col = snap(range.start.row, range.start.column);
            return col === range.start.column ? range
                : new Range(range.start.row, col, range.end.row, col);
        }
        const start = snap(range.start.row, range.start.column, "left");
        const end = snap(range.end.row, range.end.column, "right");
        if (start === range.start.column && end === range.end.column) return range;
        const normalized = new Range(range.start.row, start, range.end.row, end);
        if (range.cursor) normalized.cursor = range.cursor;
        if (range.desiredColumn != null) normalized.desiredColumn = range.desiredColumn;
        return normalized;
    }

    // A defensive final boundary check for copy/cut or APIs that bypass mouse
    // handlers. Preserve selection orientation and never normalize Unicode.
    function snapSelection(emptyDirection) {
        const selection = editor.selection;
        if (!enabled()) return false;
        if (selection.isEmpty()) {
            const cursor = selection.getCursor();
            const col = snap(cursor.row, cursor.column, emptyDirection);
            if (col === cursor.column) return false;
            selection.moveCursorTo(cursor.row, col);
            return true;
        }
        const range = editor.getSelectionRange();
        const normalized = expandedRange(range);
        if (normalized === range) return false;
        selection.setSelectionRange(normalized, selection.isBackwards && selection.isBackwards());
        return true;
    }

    function patchSelection(selection) {
        if (selection.$inkyGraphemeEditing) return;
        selection.$inkyGraphemeEditing = true;
        let wordDirection = null;

        // All mouse paths (click, shift-click, drag, double-click), vertical
        // navigation and Ace's Ctrl+word commands eventually move the lead.
        const move = selection.moveCursorTo;
        selection.moveCursorTo = function(row, col, keepDesiredColumn) {
            if (enabled()) {
                let direction = wordDirection;
                if (!direction && !this.isEmpty()) {
                    const anchor = this.getSelectionAnchor();
                    const target = { row, column: col };
                    const cmp = pointCmp(target, anchor);
                    direction = cmp > 0 ? "right" : cmp < 0 ? "left" : null;
                }
                col = snap(row, col, direction);
            }
            return move.call(this, row, col, keepDesiredColumn);
        };

        // The mouse's click-selection code can set the anchor separately.
        const setAnchor = selection.setSelectionAnchor;
        selection.setSelectionAnchor = function(row, col) {
            if (enabled()) {
                const lead = this.getCursor();
                const cmp = pointCmp({ row, column: col }, lead);
                col = snap(row, col, cmp < 0 ? "left" : cmp > 0 ? "right" : null);
            }
            return setAnchor.call(this, row, col);
        };

        const setRange = selection.setSelectionRange;
        function protectedRange(range, reverse) {
            return setRange.call(this, enabled() ? expandedRange(range) : range, reverse);
        }
        selection.setRange = selection.setSelectionRange = protectedRange;

        // Ace's mouse double-click uses getWordRange directly, and old Ace
        // may return the base emoji without its variation selector.
        if (typeof selection.getWordRange === "function") {
            const getWordRange = selection.getWordRange;
            selection.getWordRange = function(...args) {
                const range = getWordRange.apply(this, args);
                return enabled() ? expandedRange(range) : range;
            };
        }

        function directionalWord(method, direction) {
            if (typeof selection[method] !== "function") return;
            const original = selection[method];
            selection[method] = function(...args) {
                const previous = wordDirection;
                wordDirection = enabled() ? direction : null;
                try { return original.apply(this, args); }
                finally { wordDirection = previous; }
            };
        }
        directionalWord("moveCursorWordLeft", "left");
        directionalWord("moveCursorWordRight", "right");

        // Preserve Ace's ordinary arrow-key behaviour except when the step
        // would otherwise enter a multi-unit grapheme.
        const left = selection.moveCursorLeft;
        const right = selection.moveCursorRight;
        selection.moveCursorLeft = function(...args) {
            if (enabled()) {
                const cursor = this.getCursor();
                if (cursor.column > 0) {
                    const col = previousBoundary(editor.session.getLine(cursor.row), cursor.column);
                    if (col < cursor.column - 1) {
                        this.moveCursorTo(cursor.row, col);
                        return;
                    }
                }
            }
            return left.apply(this, args);
        };
        selection.moveCursorRight = function(...args) {
            if (enabled()) {
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
        const remove = editor.remove;
        const insert = editor.insert;
        editor.remove = function(dir, ...args) {
            if (enabled()) {
                if (this.selection.isEmpty()) {
                    const cursor = this.getCursorPosition();
                    const part = containing(this.session.getLine(cursor.row), cursor.column);
                    if (part) {
                        this.selection.setSelectionRange(new Range(
                            cursor.row, part.start, cursor.row, part.end));
                    }
                } else {
                    snapSelection();
                }
            }
            return remove.call(this, dir, ...args);
        };
        editor.insert = function(text, ...args) {
            if (enabled()) snapSelection("right");
            return insert.call(this, text, ...args);
        };

        // Copy and Cut use editor.getCopyText and may remove the selection
        // directly via the session, bypassing editor.remove.
        if (typeof editor.getCopyText === "function") {
            const getCopyText = editor.getCopyText;
            editor.getCopyText = function(...args) {
                if (enabled()) snapSelection();
                return getCopyText.apply(this, args);
            };
        }

        for (const method of ["removeWordLeft", "removeWordRight"]) {
            if (typeof editor[method] !== "function") continue;
            const original = editor[method];
            editor[method] = function(...args) {
                if (enabled()) snapSelection();
                return original.apply(this, args);
            };
        }
    }

    // Ace constructs a different Selection for each EditSession.
    const setSession = editor.setSession;
    editor.setSession = function(session, ...args) {
        const result = setSession.call(this, session, ...args);
        patchSelection(this.selection);
        return result;
    };

    patchSelection(editor.selection);
    return true;
}

module.exports = { installGraphemeEditing };
