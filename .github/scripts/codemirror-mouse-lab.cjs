"use strict";

// Independent, out-of-process CodeMirror 6 mouse-selection acceptance test.
// Uses Chromium CDP native mouse input against a real rendered editor.
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const assert = require("node:assert/strict");
const {pathToFileURL} = require("node:url");
const {launch, sleep} = require("../../app/test/helpers/preview-session.cjs");

const appRoot=path.resolve(__dirname,"../../app");
const binary=path.join(appRoot,"node_modules/.bin/electron");
const output=fs.mkdtempSync(path.join(os.tmpdir(),"inky-codemirror-mouse-"));
const clusters=["🕯️","😀","👍🏽","👩‍👩‍👦","🧑🏽‍💻","🇧🇷","🏳️‍🌈","❤️","1️⃣","e\u0301"];
const adjacent=[
    "🕯️👍🏽🕯️",
    "👩‍👩‍👦🧑🏽‍💻🇧🇷",
    "🏳️‍🌈❤️1️⃣",
    "🇧🇷🇧🇷🇧🇷",
    "e\u0301🕯️e\u0301"
];
const artifacts=[];
let app;

async function reset(text) {
    return app.evaluate(`(()=>{const lab=window.__inkyCodeMirrorLab;
        lab.load(${JSON.stringify(text)});
        return lab.readState()})()`);
}
async function geometry(from,to) {
    return app.evaluate(`(()=>{const lab=window.__inkyCodeMirrorLab;
        const a=lab.coordsAtPos(${from}),b=lab.coordsAtPos(${to});
        return {a,b};})()`);
}
async function nativeDrag(a,b) {
    await app.renderer.send("Input.dispatchMouseEvent", {
        type:"mouseMoved",x:a.x,y:a.y,button:"none"});
    await app.renderer.send("Input.dispatchMouseEvent", {
        type:"mousePressed",x:a.x,y:a.y,button:"left",buttons:1,clickCount:1});
    for(let n=1;n<=12;n++) {
        const t=n/12;
        await app.renderer.send("Input.dispatchMouseEvent",{
            type:"mouseMoved",x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,
            button:"left",buttons:1});
    }
    await app.renderer.send("Input.dispatchMouseEvent",{
        type:"mouseReleased",x:b.x,y:b.y,button:"left",buttons:0,clickCount:1});
    await sleep(50);
}
(async()=>{
try {
    app=await launch({binary,appPath:appRoot,output,flags:["--no-sandbox"],
        viewSettings:{theme:"light",zoom:"100"}});
    await app.renderer.send("Page.enable");
    const url=pathToFileURL(path.join(appRoot,"renderer/codemirror-lab.html")).href;
    await app.renderer.send("Page.navigate",{url});
    await app.until("!!window.__inkyCodeMirrorLab && !!window.__inkyCodeMirrorLab.view");
    const loaded=await app.evaluate("(()=>({url:location.href,content:window.__inkyCodeMirrorLab.readState()}))()");
    console.log("CodeMirror lab running",JSON.stringify(loaded));
    const cases=[
        ...adjacent.map(x=>({label:"adjacent",value:x})),
        ...clusters.map(x=>({label:"single",value:x}))
    ];
    let failures=0;
    for(const test of cases){
        for(const direction of ["ltr","rtl"]) {
            const input="A "+test.value+" B";
            const start=input.indexOf(test.value),end=start+test.value.length;
            await reset(input);
            const coords=await geometry(start,end);
            const from=direction==="ltr"?coords.a:coords.b;
            const to=direction==="ltr"?coords.b:coords.a;
            await nativeDrag(from,to);
            const state=await app.evaluate("window.__inkyCodeMirrorLab.readState()");
            const ok=state.selected===test.value;
            artifacts.push({type:test.label,cluster:test.value,direction,expected:test.value,
                selected:state.selected,from:state.from,to:state.to,coords,ok});
            if(!ok) {failures++;console.error("FAIL",JSON.stringify(artifacts[artifacts.length-1]));}
            else console.log("PASS",test.label,direction,test.value);
        }
    }
    const file=path.join(output,"results.json");
    fs.writeFileSync(file,JSON.stringify({cases:artifacts,total:artifacts.length,
        passed:artifacts.length-failures,failed:failures},null,2));
    console.log("RESULTS_FILE="+file);
    console.log("TOTAL="+artifacts.length+" FAILED="+failures);
    assert.equal(failures,0,"CodeMirror physical Unicode selection is not fully correct: "+failures);
} finally {if(app)await app.close();}
})().then(()=>process.exit(0),err=>{console.error(err.stack||err);process.exit(1)});
