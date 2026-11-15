/* 규칙 점검: 단원 데이터 폴더(인자로 지정)의 모든 JSON 으로 시험지를 수천 번 만들어 규칙 위반이 없는지 본다.
 * 사용: node test/run.js "<단원 데이터 폴더>" [출력 폴더]
 * 교재 데이터는 이 저장소에 두지 않는다. 폴더는 저장소 밖의 경로를 준다.
 */
"use strict";
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var root = path.join(__dirname, "..");
["js/util.js", "js/word.js", "js/chunk.js"].forEach(function (f) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), "utf8"), { filename: f });
});
var WT = globalThis.WT;
var dataDir = process.argv[2];
var outDir = process.argv[3];
if (!dataDir) { console.error("단원 데이터 폴더를 인자로 주세요"); process.exit(2); }
if (outDir) fs.mkdirSync(outDir, { recursive: true });

var fails = 0;
function check(cond, msg) { if (!cond) { fails++; console.log("  실패: " + msg); } }

// 1) 안전장치: 필수 항목이 없으면 시험지를 만들지 않아야 한다
function throws(fn) { try { fn(); return false; } catch (e) { return true; } }
var base = JSON.parse(fs.readFileSync(path.join(dataDir, fs.readdirSync(dataDir).filter(function (f) { return /^A_단어/.test(f); })[0]), "utf8"));
["owner", "sentence_sources", "require_sentence_ko"].forEach(function (k) {
  var d = JSON.parse(JSON.stringify(base)); delete d[k];
  check(throws(function () { WT.word.load(d); }), "단어 데이터에서 " + k + " 가 없는데 거부하지 않음");
});
var d2 = JSON.parse(JSON.stringify(base)); d2.sentence_sources = ["practice", "foo"];
check(throws(function () { WT.word.load(d2); }), "알 수 없는 문장 출처를 거부하지 않음");
var cbase = JSON.parse(fs.readFileSync(path.join(dataDir, fs.readdirSync(dataDir).filter(function (f) { return /chunk/.test(f); })[0]), "utf8"));
["owner", "hint"].forEach(function (k) {
  var d = JSON.parse(JSON.stringify(cbase)); delete d[k];
  check(throws(function () { WT.chunk.load(d); }), "chunk 데이터에서 " + k + " 가 없는데 거부하지 않음");
});
var d3 = JSON.parse(JSON.stringify(cbase)); d3.hint = "maybe";
check(throws(function () { WT.chunk.load(d3); }), "chunk hint 잘못된 값을 거부하지 않음");
console.log("안전장치 점검 끝");

// 2) 모든 데이터로 반복 점검
fs.readdirSync(dataDir).filter(function (f) { return /\.json$/.test(f); }).forEach(function (f) {
  var raw = JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8"));
  var tag = f.replace(/\.json$/, "");
  if (raw.kind === "word") {
    var data = WT.word.load(raw);
    var src = WT.word.allowedSources(data);
    var r1 = WT.word.selftest(data, 1000, WT.word.defaultMcq(data), src, "regular", new Set(["A", "B"]));
    var r2 = WT.word.selftest(data, 1000, WT.word.defaultMcq(data), src, "all-write", new Set(["A", "B"]));
    console.log(tag + " 단어 regular 오류 " + r1.bad + "/1000, all-write 오류 " + r2.bad + "/1000");
    check(r1.bad === 0 && r2.bad === 0, tag + " 규칙 위반");
    // 한선처럼 연습 페이지만 허용하는 데이터는 다른 출처 문장이 한 번도 나오지 않아야 한다
    if (data.sentence_sources.join() === "practice") {
      for (var seed = 1; seed <= 300; seed++) {
        var s = WT.word.makeRegular(data, WT.word.defaultMcq(data), src, seed);
        s.mcq.forEach(function (p) { if (p[1].source !== "practice") check(false, tag + " 연습 페이지 밖 문장 사용"); });
        var a = WT.word.makeAllWrite(data, src, seed);
        a.b.forEach(function (p) { if (p[1].source !== "practice") check(false, tag + " 연습 페이지 밖 문장 사용(all-write)"); });
      }
    }
    // 해석 필수 데이터는 정답지에 해석이 있어야 한다
    if (data.require_sentence_ko) {
      var s2 = WT.word.makeAllWrite(data, src, 7);
      check(WT.word.missingKo(data, s2.b.map(function (p) { return p[1]; })).length === 0, tag + " 해석 없는 문장 출제");
    }
    var h1 = WT.word.buildRegular(data, WT.word.makeRegular(data, WT.word.defaultMcq(data), src, 11), {});
    var h2 = WT.word.buildAllWrite(data, WT.word.makeAllWrite(data, src, 11), {});
    check((h1.match(/<tr class="w">/g) || []).length + (h1.match(/<tr class="m">/g) || []).length === data.words.length, tag + " regular 문항 수");
    check(/대상 /.test(h1) && /대상 /.test(h2), tag + " 대상 표시 없음");
    check(!data.verified === /교재 대조 전/.test(h1), tag + " 교재 대조 전 표시가 verified 와 맞지 않음");
    if (outDir) {
      fs.writeFileSync(path.join(outDir, tag + "_regular.html"), h1);
      fs.writeFileSync(path.join(outDir, tag + "_allwrite.html"), h2);
    }
  } else if (raw.kind === "chunk") {
    var cd = WT.chunk.load(raw);
    var c1 = WT.chunk.selftest(cd, 500, { mode: "sample" });
    var c2 = WT.chunk.selftest(cd, 300, { mode: "full" });
    console.log(tag + " chunk sample 오류 " + c1.bad + "/500, full 오류 " + c2.bad + "/300");
    check(c1.bad === 0 && c2.bad === 0, tag + " 규칙 위반");
    var cs = WT.chunk.makeSet(cd, "sample", 6, 3, 2, 1, 5);
    var ch = WT.chunk.build(cd, cs, {});
    check(cs.vocab.length === 6 && cs.chunk.length === 3 && cs.fill.length === 2, tag + " sample 문항 수");
    check(cd.hint === "first" ? /class="hw"/.test(ch) : !/class="hw"/.test(ch), tag + " 첫 글자 힌트가 데이터 hint 와 다름");
    check(!cd.verified === /교재 대조 전/.test(ch), tag + " 교재 대조 전 표시가 verified 와 맞지 않음");
    if (outDir) {
      fs.writeFileSync(path.join(outDir, tag + "_sample.html"), ch);
      fs.writeFileSync(path.join(outDir, tag + "_full.html"), WT.chunk.build(cd, WT.chunk.makeSet(cd, "full", 6, 3, 2, 1, 5), {}));
    }
  }
});

console.log(fails === 0 ? "모든 점검 통과" : "실패 " + fails + "건");
process.exit(fails === 0 ? 0 : 1);
