"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

describe("Graphite replacement for the Dark IDE theme", function() {
    const load = filename => fs.readFileSync(path.resolve(__dirname, "..", "renderer", filename), "utf8");

    it("keeps the existing menu entries and chooses bundled Ace themes", function() {
        const menus = fs.readFileSync(path.resolve(__dirname, "..", "main-process", "appmenus.js"), "utf8");
        const controller = load("controller.js");
        const editor = load("editorView.js");
        assert.match(menus, /\['light', 'dark', 'contrast', 'focus'\]/);
        assert.match(editor, /setEditorTheme:\s*\(name\)\s*=>\s*editor\.setTheme\(name\)/);
        assert.match(controller, /ace\/theme\/tomorrow_night/);
        assert.match(controller, /ace\/theme\/textmate/);
        assert.ok(fs.existsSync(path.resolve(__dirname, "..", "renderer", "acesrc", "theme-tomorrow_night.js")));
        assert.ok(fs.existsSync(path.resolve(__dirname, "..", "renderer", "acesrc", "theme-textmate.js")));
    });

    it("keeps the story Preview theme independent of the IDE theme", function() {
        const css = load("dark.css");
        const controller = load("controller.js");
        assert.doesNotMatch(css, /\.window\.dark\s+#player(?:\s*[,\{])/);
        assert.doesNotMatch(css, /\.window\.dark\s+#main\s+#player(?:\s*[,\{])/);
        assert.match(controller, /removeClass\("dark contrast focus"\)/);
        assert.match(controller, /document\.documentElement\.classList\.toggle\("dark", theme === "dark"\)/);
    });

    it("styles Explorer and menus outside the editor without a new dependency", function() {
        const css = load("dark.css");
        assert.match(css, /\.window\.dark #file-nav-wrapper \.jstree-default/);
        assert.match(css, /html\.dark \.vakata-context\.jstree-default-contextmenu/);
        assert.match(css, /html\.dark \.ace_autocomplete/);
    });
});
