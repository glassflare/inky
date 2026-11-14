"use strict";

// Out-of-process regression against the actual Electron renderer and bundled Ace.
// Intended to run under xvfb-run with a private, temporary user profile.
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const {launch, sleep} = require("../../app/test/helpers/preview-session.cjs");

const appRoot = path.resolve(__dirname, "../../app");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "inky-unicode-v2-"));
const binary = path.join(appRoot, "node_modules/.bin/electron");
const clusters = ["🕯️","😀","👍🏽","👩‍👩‍👦","🧑🏽‍💻","🇧🇷","🏳️‍🌈","❤️","1️⃣","e\u0301"];
const isValidUTF16 = s => {
    for (let i = 0; i < s.length; i++) {
        const n=s.charCodeAt(i);
        if (n>=0xD800 && n<=0xDBFF) {
            if (++i>=s.length) return false;
            const b=s.charCodeAt(i);
            if (b<0xDC00 || b>0xDFFF) return false;
        } else if (n>=0xDC00 && n<=0xDFFF) return false;
    }
    return true;
};

let app;
(async () => {
    try {
        app = await launch({binary, appPath:appRoot, output, flags:["--no-sandbox"],
            viewSettings:{theme:"light",zoom:"100"}});
        await app.until("window.ace && ace.edit('editor').session && require('./inkProject.js').InkProject.currentProject?.ready");
        for(const cluster of clusters) {
            const input="* [A "+cluster+" B] -> END";
            const start=input.indexOf(cluster);
            // Simulate Ace mouse hit-testing returning a UTF-16 interior
            // position. This is exactly the historical corruption entry point.
            for(let offset=1;offset<cluster.length;offset++) {
                const result=await app.evaluate(`(()=>{const ed=ace.edit('editor');ed.setValue(${JSON.stringify(input)},-1);
                    ed.selection.moveTo(0,${start+offset});return {cursor:ed.getCursorPosition(),value:ed.getValue()}})()`);
                assert([start,start+cluster.length].includes(result.cursor.column),
                    "caret may not stop in grapheme: "+JSON.stringify({cluster,offset,result}));
                const after=await app.evaluate(`(()=>{const ed=ace.edit('editor');ed.insert('x');return ed.getValue()})()`);
                assert(isValidUTF16(after));
                assert(after.includes(cluster),"insertion lost part of "+cluster);
            }

            // Simulate mouse drag selection beginning/ending inside grapheme.
            const selection=await app.evaluate(`(()=>{const ed=ace.edit('editor');ed.setValue(${JSON.stringify(input)},-1);
                ed.selection.moveTo(0,${start});ed.selection.selectTo(0,${start+1});
                return {text:ed.getCopyText(),range:ed.getSelectionRange()}})()`);
            assert.equal(selection.text,cluster,"copy must include full "+cluster);
            assert.equal(selection.range.start.column,start);
            assert.equal(selection.range.end.column,start+cluster.length);

            const back=await app.evaluate(`(()=>{const ed=ace.edit('editor');ed.setValue(${JSON.stringify(input)},-1);
                ed.selection.moveTo(0,${start+cluster.length});ed.remove('left');return ed.getValue()})()`);
            assert.equal(back,input.replace(cluster,""),"Backspace "+cluster);
            const word=await app.evaluate(`(()=>{const ed=ace.edit('editor');ed.setValue(${JSON.stringify(input)},-1);
                ed.selection.moveTo(0,${start});ed.removeWordRight();return ed.getValue()})()`);
            assert(isValidUTF16(word),"Ctrl+Delete surrogate error "+cluster);
            console.log("PASS native grapheme, clipboard, word navigation:",cluster);
        }

        // Deliver an actual Chromium mouse click + native text insertion. The
        // test records click geometry, and regardless of Ace's pixel rounding
        // verifies Unicode integrity and preservation of the complete emoji.
        const original="* [🕯️ Aproximar-se da casa]-> END";
        const start=original.indexOf("🕯️");
        const geom=await app.evaluate(`(()=>{const ed=ace.edit('editor');ed.setValue(${JSON.stringify(original)},-1);
            ed.focus();ed.resize(true);const p=ed.renderer.textToScreenCoordinates(0,${start+1});
            return {x:p.pageX,y:p.pageY+ed.renderer.lineHeight/2}})()`);
        await app.evaluate("(()=>{const ed=ace.edit('editor');const s=ed.selection;window.__inkyMouseTrace=[];for(const key of ['moveToPosition','selectToPosition','moveCursorTo','moveTo','setSelectionAnchor','setSelectionRange','selectTo']){if(typeof s[key]!=='function')continue;const fn=s[key];s[key]=function(...args){const bef={cursor:this.getCursor(),range:this.getRange()};const ret=fn.apply(this,args);window.__inkyMouseTrace.push({key,args,bef,after:{cursor:this.getCursor(),range:this.getRange()}});return ret;};}return true})()");
        await app.renderer.send("Input.dispatchMouseEvent", {
            type:"mousePressed",x:geom.x,y:geom.y,button:"left",clickCount:1});
        await app.renderer.send("Input.dispatchMouseEvent", {
            type:"mouseReleased",x:geom.x,y:geom.y,button:"left",clickCount:1});
        const beforeMouseType=await app.evaluate("(()=>{const ed=ace.edit('editor');return {cursor:ed.getCursorPosition(), selection:ed.getSelectionRange(), value:ed.getValue(), enabled:ed.$inkyGraphemeEditing, selectionEnabled:ed.selection.$inkyGraphemeEditing, activeInk:require('./inkProject.js').InkProject.currentProject?.mainInk?.isInkFile}})()");
        console.log("DEBUG physical mouse before typing",JSON.stringify({geometry:geom,editor:beforeMouseType,trace:await app.evaluate("window.__inkyMouseTrace")}));
        await app.renderer.send("Input.insertText",{text:"x"});
        await sleep(100);
        const mouse=await app.evaluate("(()=>{const ed=ace.edit('editor');return {text:ed.getValue(),cursor:ed.getCursorPosition()}})()");
        console.log("DEBUG physical mouse after typing",JSON.stringify(mouse));
        assert(isValidUTF16(mouse.text),"mouse insertion created isolated surrogate");
        assert(mouse.text.includes("🕯️"),"mouse insertion destroyed candle");
        assert(mouse.text.includes("x"),"native insertion not delivered");
        console.log("PASS CDP physical mouse and keyboard insertion:",JSON.stringify(mouse));
    } finally {
        if(app) await app.close();
    }
})().then(()=>process.exit(0),error=>{
    console.error(error.stack||error);
    process.exit(1);
});
