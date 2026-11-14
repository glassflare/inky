"use strict";

const assert = require("node:assert/strict");
const { GameStyle } = require("../renderer/gameStyle.js");
const { YamlTitleGuard } = require("../renderer/yamlTitleGuard.js");
const { TagPicker } = require("../renderer/tagPicker.js");

describe("Unicode v3: preserve grapheme joiners in titles", function() {
    const composed = [
        "👩‍👩‍👦",
        "🧑🏽‍💻",
        "🏳️‍🌈"
    ];

    for (const emoji of composed) {
        it("keeps the exact title and author code points for " + emoji, function() {
            assert.equal(GameStyle.normalizeTitleText(emoji), emoji);
            assert.equal(GameStyle.normalizeTitleText("A " + emoji + " B"), "A " + emoji + " B");
            const model = GameStyle.defaultModel();
            model.titles.story = emoji;
            model.titles.author = emoji;
            const yaml = GameStyle.toYaml(model);
            assert(yaml.includes(emoji), "YAML serializer dropped joiner");
            const parsed = GameStyle.parseText(yaml);
            assert.equal(parsed.model.titles.story, emoji, "YAML roundtrip title");
            assert.equal(parsed.model.titles.author, emoji, "YAML roundtrip author");
            assert.equal(parsed.warnings.length, 0);
        });

        it("does not rewrite ZWJ when repairing a YAML title row: " + emoji, function() {
            let line = '  story: "' + emoji + '"';
            const doc = {
                getAllLines() {return ["titles:", line];},
                getLine(row) {assert.equal(row,1);return line;},
                remove(range) {
                    line = line.slice(0,range.start.column) + line.slice(range.end.column);
                },
                insert(pos,text) {
                    line = line.slice(0,pos.column) + text + line.slice(pos.column);
                }
            };
            YamlTitleGuard.fixRows(doc, [1]);
            assert.equal(line, '  story: "' + emoji + '"');
            const value = YamlTitleGuard.insertionFor(["titles:", '  story: ""'], {
                action:"insert", start:{row:1,column:10},
                end:{row:1,column:10+emoji.length}, lines:[emoji]
            });
            assert.equal(value,null,"native paste must be left unchanged");
        });
    }

    it("preserves joiner and nonjoiner while still removing separator controls",function(){
        assert.equal(GameStyle.normalizeTitleText("A\u200DB"),"A\u200DB");
        assert.equal(GameStyle.normalizeTitleText("A\u200CB"),"A\u200CB");
        assert.equal(GameStyle.normalizeTitleText("A\u200BB"),"A B");
        assert.equal(GameStyle.normalizeTitleText("A\u200EB"),"A B");
        assert.equal(GameStyle.normalizeTitleText("A\u200FB"),"A B");
        assert.equal(GameStyle.normalizeTitleText("A    B"),"A B");
    });
});

describe("Unicode v3: tag scan must terminate",function(){
    for(const line of ["#author: Test 🕯️", "#align: left // 🕯️", "#unknown: value", "#foo", "#align: left // extra"]) {
        it("finishes lineTagAt at beginning and end: "+line,function(){
            const start = Date.now();
            for(const col of [0,1,2,3,line.length]) {
                const result = TagPicker.lineTagAt([line],0,col);
                assert(result == null || typeof result === "object");
            }
            assert(Date.now()-start < 1000,"unexpectedly slow tag scanning");
        });
    }
});
