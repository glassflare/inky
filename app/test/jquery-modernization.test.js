"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

describe("jQuery 4 migration", function() {
    const root = path.resolve(__dirname,"..");
    const pkg = require("../package.json");
    const lock = require("../package-lock.json");
    const renderer = path.join(root,"renderer");

    it("pins the modern runtime and complete lock integrity",function() {
        assert.equal(pkg.dependencies.jquery,"4.0.0");
        assert.equal(lock.packages[""].dependencies.jquery,"4.0.0");
        assert.equal(lock.packages["node_modules/jquery"].version,"4.0.0");
        assert.match(lock.packages["node_modules/jquery"].integrity,/^sha512-/);
    });

    it("removes legacy bundled jQuery and imports in first-party renderer files",function() {
        assert(!fs.existsSync(path.join(renderer,"jquery-2.2.3.min.js")));
        const files = fs.readdirSync(renderer).filter(p => /\.(?:js|html)$/.test(p));
        for(const file of files) {
            const body=fs.readFileSync(path.join(renderer,file),"utf8");
            assert(!body.includes("jquery-2.2.3"),file+" still references old jQuery");
        }
    });

    it("uses official jquery in all native renderer modules",function() {
        for(const file of ["controller.js","navView.js","playerView.js",
            "toolbarView.js","expressionWatchView.js","split.js","goto.js","imageViewer.js"]) {
            const body=fs.readFileSync(path.join(renderer,file),"utf8");
            assert.match(body,/require\(['"]jquery['"]\)/,file+" not migrated");
        }
    });

    it("preserves the supported jsTree 3.3.17 plugin files",function() {
        const body=fs.readFileSync(path.join(renderer,"jstree/jstree.min.js"),"utf8");
        assert.match(body,/jsTree - v3\.3\.17/);
        assert.match(body,/jQuery/);
    });
});
