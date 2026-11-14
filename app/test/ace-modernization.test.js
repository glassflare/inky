"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

describe("official Ace modernization", function() {
    const root = path.join(__dirname, "..");
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
    const html = fs.readFileSync(path.join(root, "renderer/index.html"), "utf8");

    it("pins the official Ace 1.45.2 runtime dependency and exact lock integrity", function() {
        assert.equal(packageJson.dependencies["ace-builds"], "1.45.2");
        assert.equal(lock.packages[""].dependencies["ace-builds"], "1.45.2");
        assert.equal(lock.packages["node_modules/ace-builds"].version, "1.45.2");
        assert.match(lock.packages["node_modules/ace-builds"].integrity, /^sha512-/);
    });

    it("loads core, YAML, autocomplete from the same modern distribution", function() {
        for(const name of ["ace", "mode-yaml", "ext-language_tools"])
            assert(html.includes('src="../node_modules/ace-builds/src/' + name + '.js"'),
                "missing official Ace module " + name);
        assert(!html.includes('<script src="acesrc/ace.js"'),
            "legacy Ace must not be loaded");
        assert(!html.includes('<script src="acesrc/mode-yaml.js"'),
            "legacy YAML must not be loaded");
        assert(!html.includes('<script src="acesrc/ext-language_tools.js"'),
            "legacy autocomplete must not be loaded");
    });

    it("configures theme, worker, module and base paths consistently", function() {
        for(const key of ["basePath", "modePath", "themePath", "workerPath"])
            assert(html.includes('ace.config.set("' + key + '", "../node_modules/ace-builds/src")'));
    });

    it("contains the matching official modules after npm ci", function() {
        const modern = path.join(root, "node_modules/ace-builds");
        if(!fs.existsSync(modern)) return this.skip();
        assert.equal(require(path.join(modern,"package.json")).version, "1.45.2");
        for(const file of ["src/ace.js","src/mode-yaml.js","src/ext-language_tools.js",
                            "src/theme-tomorrow_night.js","src/theme-textmate.js"])
            assert(fs.existsSync(path.join(modern,file)), file);
    });
});
