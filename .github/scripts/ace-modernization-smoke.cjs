"use strict";

// Real Electron renderer smoke: ensure the *running* editor loaded the new Ace,
// native Ink mode, YAML, autocomplete and built-in color themes.
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const {launch} = require("../../app/test/helpers/preview-session.cjs");

const appRoot = path.resolve(__dirname, "../../app");
const bin = path.join(appRoot, "node_modules/.bin/electron");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "inky-ace-1.45-smoke-"));
let app;

(async () => {
    try {
        app = await launch({
            binary: bin,
            appPath: appRoot,
            output,
            flags: ["--no-sandbox"],
            viewSettings: {theme:"light",zoom:"100"}
        });
        await app.until("!!window.ace && !!ace.edit('editor') && require('./inkProject.js').InkProject.currentProject?.ready");
        const state = await app.evaluate(`(() => {
            const editor = ace.edit("editor");
            const config = ace.config;
            const scripts = [...document.querySelectorAll("script[src]")].map(x => x.src);
            return {
                version: ace.version,
                paths: ["basePath","modePath","themePath","workerPath"].map(x => [x,config.get(x)]),
                scripts,
                hasInkMode: !!require("./ace-ink-mode/ace-ink.js").InkMode,
                hasYamlMode: !!ace.require("ace/mode/yaml").Mode,
                hasCompleter: editor.completers.some(x => x === require("./inkCompleter.js").inkCompleter)
            };
        })()`);
        assert.equal(state.version, "1.45.2", "renderer must run modern Ace");
        for (const [,value] of state.paths)
            assert(value.includes("ace-builds/src"), "unexpected Ace resource path: "+value);
        assert.equal(state.scripts.filter(s=>s.endsWith("/ace-builds/src/ace.js")).length,1);
        assert(!state.scripts.some(s=>s.endsWith("/acesrc/ace.js")));
        assert(state.hasInkMode && state.hasYamlMode && state.hasCompleter);
        console.log("PASS Ace modern renderer bootstrap",JSON.stringify(state));

        for (const theme of ["ace/theme/textmate","ace/theme/tomorrow_night",
                             "ace/theme/tomorrow_night_bright","ace/theme/twilight"]) {
            const result = await app.evaluate(`new Promise((resolve, reject) => {
                const ed=ace.edit("editor");
                ed.setTheme(${JSON.stringify(theme)}, () => {
                    const loaded=ed.getTheme();
                    loaded===${JSON.stringify(theme)} ? resolve(loaded)
                        : reject(new Error("theme mismatch: "+loaded));
                });
            })`);
            assert.equal(result,theme);
            console.log("PASS modern Ace theme",theme);
        }
        const ink=await app.evaluate(`(() => {
            const ed=ace.edit("editor");
            ed.setValue("* [🕯️👩‍👩‍👦🇧🇷] -> END",-1);
            return {value:ed.getValue(),mode:ed.session.getMode().$id};
        })()`);
        assert.equal(ink.value,"* [🕯️👩‍👩‍👦🇧🇷] -> END");
        console.log("PASS Unicode insertion in modern Ace",JSON.stringify(ink));
    } finally {
        if (app) await app.close();
    }
})().then(()=>process.exit(0), err=>{console.error(err.stack||err);process.exit(1)});
