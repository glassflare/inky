"use strict";

// Verify actual jQuery 4 + jsTree compatibility in the Electron renderer.
// This is not a jsdom-only test: Explorer must initialize and accept selection.
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const assert = require("node:assert/strict");
const {launch, sleep} = require("../../app/test/helpers/preview-session.cjs");

const appRoot = path.resolve(__dirname, "../../app");
const binary = path.join(appRoot, "node_modules/.bin/electron");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "inky-jquery-4-smoke-"));
let app;
(async () => {
    try {
        app = await launch({binary, appPath:appRoot, output, flags:["--no-sandbox"],
            viewSettings:{theme:"light",zoom:"100"}});
        await app.until("!!window.jQuery && !!window.ace && !!require('./inkProject.js').InkProject.currentProject?.ready");
        let result=await app.evaluate(`(() => {
            const j = window.jQuery;
            return {version:j.fn.jquery, sameGlobal:window.$===j,
                sameRequire:require("jquery")===j,
                ready:document.readyState, ace:ace.version,
                oldScript:[...document.scripts].some(s=>s.src.includes("jquery-2.2.3"))};
        })()`);
        assert.equal(result.version,"4.0.0",JSON.stringify(result));
        assert(result.sameGlobal && result.sameRequire,"jQuery global/require inconsistency");
        assert(!result.oldScript,"legacy jQuery script loaded");
        assert.equal(result.ace,"1.45.2");
        console.log("PASS modern jQuery / Ace renderer",JSON.stringify(result));

        // Trigger the Explorer using the application's own UI, not a synthetic
        // jsTree object. Its three plugins must remain usable under jQuery 4.
        const explorer=await app.evaluate(`(() => {
            const $ = window.jQuery;
            const button=document.querySelector(".nav-toggle");
            if (!button) return {error:"toggle missing"};
            button.click();
            return {hasTree:!!$.fn.jstree, sidebar:document.querySelector(".sidebar")?.className};
        })()`);
        assert(!explorer.error,JSON.stringify(explorer));
        await app.until("!!window.jQuery.fn.jstree && !!window.jQuery('#explorer-tree').jstree(true)");
        const tree=await app.evaluate(`(() => {
            const $ = window.jQuery;
            const instance=$("#explorer-tree").jstree(true);
            const nodes=instance.get_json("#",{flat:true});
            return {plugins:instance.settings.plugins, nodeCount:nodes.length,
                names:nodes.slice(0,12).map(x=>x.text),
                treeVisible:!!document.querySelector(".jstree-container-ul")};
        })()`);
        for (const plugin of ["wholerow","dnd","contextmenu"])
            assert(tree.plugins.includes(plugin),"missing jsTree plugin "+plugin);
        assert(tree.treeVisible,"Explorer tree not initialized");
        assert(tree.nodeCount>0,"Explorer tree empty");
        console.log("PASS jQuery4 jsTree Explorer",JSON.stringify(tree));

        const selected=await app.evaluate(`(() => {
            const $=window.jQuery;
            const tree=$("#explorer-tree").jstree(true);
            const ids=tree.get_json("#",{flat:true}).map(x=>x.id).filter(id=>id!=="root");
            if(!ids.length)return {error:"no selectable nodes"};
            tree.select_node(ids[0]);
            const result={id:ids[0],selected:tree.get_selected()};
            tree.deselect_all();
            return result;
        })()`);
        assert(!selected.error && selected.selected.includes(selected.id),JSON.stringify(selected));
        console.log("PASS jQuery4 Explorer selection",JSON.stringify(selected));

        const events=await app.evaluate(`(() => {
            const $=window.jQuery;
            let value=0;
            const node=$("<div class='jquery4-smoke'><span class='child'>x</span></div>").appendTo(document.body);
            node.on("click",".child",()=>value++);
            node.find(".child").trigger("click");
            const changed=value;
            node.off("click").remove();
            return {changed};
        })()`);
        assert.equal(events.changed,1,"delegated DOM events not functional");
        console.log("PASS jQuery4 delegated events");
    } finally {
        if (app) await app.close();
    }
})().then(()=>process.exit(0),error=>{console.error(error.stack||error);process.exit(1)});
