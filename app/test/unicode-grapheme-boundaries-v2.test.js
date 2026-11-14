"use strict";

const assert = require("node:assert/strict");
const { installGraphemeEditing } = require("../renderer/unicodeGraphemeEditing.js");

class Range {
    constructor(sr, sc, er, ec) {
        this.start = {row: sr, column: sc};
        this.end = {row: er, column: ec};
    }
}

function fixture(initial, active = true) {
    let value = initial, cursor = 0, anchor = 0, hasSelection = false;
    let editor;
    const point = n => ({row: 0, column: n});
    const segmenter = new Intl.Segmenter("pt-BR", {granularity: "grapheme"});
    const selection = {
        $inkyGraphemeEditing: false,
        getCursor() { return point(cursor); },
        getSelectionAnchor() { return point(hasSelection ? anchor : cursor); },
        isEmpty() { return !hasSelection || anchor === cursor; },
        isBackwards() { return hasSelection && anchor > cursor; },
        getRange() { return new Range(0, Math.min(anchor, cursor), 0, Math.max(anchor, cursor)); },
        clearSelection() {hasSelection = false;anchor = cursor;},
        moveCursorTo(row, col) { assert.equal(row, 0); cursor = col; },
        setSelectionAnchor(row, col) { assert.equal(row, 0);anchor = col;hasSelection = true; },
        moveTo(row, col) {this.clearSelection();this.moveCursorTo(row, col);},
        moveToPosition(p) {this.moveTo(p.row, p.column);},
        selectTo(row, col) {
            if (!hasSelection) { anchor = cursor;hasSelection = true; }
            this.moveCursorTo(row, col);
        },
        selectToPosition(p) {this.selectTo(p.row, p.column);},
        moveCursorToPosition(p) {this.moveCursorTo(p.row, p.column);},
        setSelectionRange(range, reverse) {
            if (reverse) {this.setSelectionAnchor(range.end.row,range.end.column);this.moveCursorTo(range.start.row,range.start.column);}
            else {this.setSelectionAnchor(range.start.row,range.start.column);this.moveCursorTo(range.end.row,range.end.column);}
        },
        moveCursorLeft() {this.moveCursorTo(0, Math.max(0,cursor-1));},
        moveCursorRight() {this.moveCursorTo(0, Math.min(value.length,cursor+1));},
        moveCursorWordLeft() {this.moveCursorTo(0,Math.max(0,cursor-2));},
        moveCursorWordRight() {this.moveCursorTo(0,Math.min(value.length,cursor+2));},
        selectWordRight() {if(this.isEmpty())this.setSelectionAnchor(0,cursor);this.moveCursorWordRight();},
        selectWordLeft() {if(this.isEmpty())this.setSelectionAnchor(0,cursor);this.moveCursorWordLeft();},
        getWordRange(row, col) { return new Range(row,col,row,Math.min(value.length,col+1)); }
    };
    editor = {
        session: {getLine(row) {assert.equal(row,0);return value;}},
        selection,
        getSelectionRange() {return this.selection.getRange();},
        getCursorPosition() {return this.selection.getCursor();},
        getCopyText() {const r=this.getSelectionRange();return value.slice(r.start.column,r.end.column);},
        insert(text) {
            const r=this.getSelectionRange();
            value=value.slice(0,r.start.column)+text+value.slice(r.end.column);
            this.selection.moveTo(0,r.start.column+text.length);
        },
        remove(dir) {
            if (this.selection.isEmpty()) {
                const orig=cursor;
                if (dir==="left")this.selection.moveCursorLeft();
                else this.selection.moveCursorRight();
                this.selection.setSelectionRange(new Range(0,Math.min(orig,cursor),0,Math.max(orig,cursor)));
            }
            const r=this.getSelectionRange();
            value=value.slice(0,r.start.column)+value.slice(r.end.column);
            this.selection.moveTo(0,r.start.column);
        },
        removeWordRight() {
            if(this.selection.isEmpty())this.selection.selectWordRight();
            const r=this.getSelectionRange();
            value=value.slice(0,r.start.column)+value.slice(r.end.column);
            this.selection.moveTo(0,r.start.column);
        },
        removeWordLeft() {
            if(this.selection.isEmpty())this.selection.selectWordLeft();
            const r=this.getSelectionRange();
            value=value.slice(0,r.start.column)+value.slice(r.end.column);
            this.selection.moveTo(0,r.start.column);
        },
        setSession(session) {this.session=session;},
    };
    installGraphemeEditing(editor,Range,()=>active);
    return {editor, selection, text:()=>value,
        position:()=>cursor,
        click(col){selection.moveTo(0,col);},
        drag(from,to){selection.moveTo(0,from);selection.selectTo(0,to);},
        assertBoundaries() {
            const starts=new Set([0,value.length]);
            for(const p of segmenter.segment(value))starts.add(p.index);
            assert(starts.has(cursor),"cursor split grapheme: "+cursor);
            if(!selection.isEmpty())assert(starts.has(anchor),"anchor split grapheme: "+anchor);
        }
    };
}

describe("Unicode selection integrity v2",function() {
    const clusters=["🕯️","😀","👍🏽","👩‍👩‍👦","🧑🏽‍💻","🇧🇷","🏳️‍🌈","❤️","1️⃣","e\u0301"];
    for(const cluster of clusters) {
        it("mouse click and type cannot split "+cluster,function(){
            const f=fixture("A"+cluster+"B");
            for(let i=1;i<1+cluster.length;i++) {
                const t=fixture("A"+cluster+"B");
                t.click(i);
                t.assertBoundaries();
                t.editor.insert("x");
                assert(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(t.text()));
                assert(t.text().includes(cluster),"cluster lost after click+type");
            }
        });
        it("forward and backward mouse drag preserve "+cluster,function(){
            for(const reversed of [false,true]) {
                const f=fixture("A"+cluster+"B");
                const a=reversed?1+cluster.length-1:1;
                const b=reversed?1:1+cluster.length-1;
                f.drag(a,b);
                f.assertBoundaries();
                assert.equal(f.editor.getCopyText(),cluster);
            }
        });
        it("mouse copy/cut and replace keep "+cluster+" intact",function(){
            const f=fixture("A"+cluster+"B");
            f.drag(1,2);
            assert.equal(f.editor.getCopyText(),cluster);
            f.editor.insert("X");
            assert.equal(f.text(),"AXB");
        });
        it("Ctrl+Delete / Ctrl+Left may not cut through "+cluster,function(){
            const f=fixture("A"+cluster+"B");
            f.click(1);
            f.selection.moveCursorWordRight();
            f.assertBoundaries();
            f.click(1);
            f.editor.removeWordRight();
            f.assertBoundaries();
            assert(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(f.text()));
        });
        it("double-click word range expands "+cluster,function(){
            const f=fixture("A"+cluster+"B");
            const range=f.selection.getWordRange(0,1);
            assert.equal(range.start.column,1);
            assert.equal(range.end.column,1+cluster.length);
        });
    }

    it("YAML editing has the same grapheme protection",function(){
        const f=fixture("title: 🕯️");
        f.click(8);
        f.assertBoundaries();
        f.editor.insert("X");
        assert(f.text().includes("🕯️"));
    });
    it("ordinary ASCII selection keeps exact columns",function(){
        const f=fixture("abcdef");
        f.drag(1,4);
        assert.equal(f.editor.getCopyText(),"bcd");
        f.editor.insert("X");
        assert.equal(f.text(),"aXef");
    });
    it("inactive contexts retain Ace's original editing",function(){
        const f=fixture("A🕯️B",false);
        f.click(2);
        assert.equal(f.position(),2);
    });
});
