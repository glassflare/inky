"use strict";

// Laboratory only. NOT wired into InkProject, save/load, Preview, or release.
// A native Chromium mouse test must establish correctness before migration.
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";

const parent = document.getElementById("cm-lab");
const view = new EditorView({
    parent,
    doc: "* [A 🕯️👍🏽🕯️ B] -> END",
    extensions: [
        basicSetup,
        EditorView.lineWrapping,
        EditorView.theme({
            "&": {height:"340px",fontSize:"17px"},
            ".cm-scroller": {fontFamily:"monospace"}
        }),
    ]
});
const details = document.getElementById("details");
function readState() {
    const state=view.state;
    const selection=state.selection.main;
    const text=state.doc.toString();
    return {
        text,
        anchor:selection.anchor,
        head:selection.head,
        from:selection.from,
        to:selection.to,
        selected:text.slice(selection.from,selection.to),
        empty:selection.empty
    };
}
function update() {details.textContent=JSON.stringify(readState(),null,2);}
window.__inkyCodeMirrorLab={
    view,
    readState,
    load(text) {
        view.dispatch({changes:{from:0,to:view.state.doc.length,insert:text},
            selection:{anchor:0}});
        view.focus();
        update();
    },
    coordsAtPos(offset, side=0) {
        const r=view.coordsAtPos(offset,side);
        if(!r) throw new Error("No rendered caret coordinates for "+offset);
        return {x:r.left,y:(r.top+r.bottom)/2, left:r.left,right:r.right};
    },
    focus() { view.focus(); }
};
update();
