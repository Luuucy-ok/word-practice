/* 화면 시험(3단계) 채점 점검: 비교 규칙, 문항 만들기, 채점, 틀린 표시 반영, 기록을 확인한다.
 * 사용: node test/quiz.js "<단원 데이터 폴더>"
 * 교재 데이터는 이 저장소에 두지 않는다. 폴더는 저장소 밖의 경로를 준다.
 */
"use strict";
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var store = new Map();
globalThis.localStorage = {
  getItem: function (k) { return store.has(k) ? store.get(k) : null; },
  setItem: function (k, v) { store.set(k, String(v)); },
  removeItem: function (k) { store.delete(k); }
};
var root = path.join(__dirname, "..");
["js/util.js", "js/word.js", "js/chunk.js", "js/store.js", "js/quiz.js"].forEach(function (f) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), "utf8"), { filename: f });
});
var WT = globalThis.WT;
var Q = WT.quiz;

var dataDir = process.argv[2];
if (!dataDir) { console.error("단원 데이터 폴더를 인자로 주세요"); process.exit(2); }
var fails = 0;
function check(c, m) { console.log((c ? "통과: " : "실패: ") + m); if (!c) fails++; }
function resetStore() { store.clear(); vm.runInThisContext(fs.readFileSync(path.join(root, "js/store.js"), "utf8"), { filename: "js/store.js" }); }

// --- 비교 규칙
function cmp(g, e) { var r = Q.compare(g, e); return r.ok ? "ok" : r.reason; }
check(cmp("cattle", "cattle") === "ok", "같으면 정답");
check(cmp("  cattle  ", "cattle") === "ok", "앞뒤 공백은 무시");
check(cmp("chant  and   sing", "chant and sing") === "ok", "단어 사이의 연속 공백은 하나로 봄");
check(cmp("american", "American") === "capitalization", "대소문자가 다르면 틀림(대소문자)");
check(cmp("Cattle", "cattle") === "capitalization", "첫 글자를 대문자로 써도 틀림(자동 대문자 대비)");
check(cmp("walk", "walked") === "spelling" && cmp("coin", "coins") === "spelling", "-ed·-s 를 빠뜨리면 틀림(철자)");
check(cmp("colection", "collection") === "spelling", "한 글자 틀려도 틀림(철자)");
check(cmp("dog", "collection") === "different", "전혀 다른 단어면 다른 단어");
check(cmp("chant and songs together", "chant and sing songs together") === "missing", "단어를 빠뜨리면 빠진 단어");
check(cmp("chant and sing the songs together", "chant and sing songs together") === "added", "단어를 더 쓰면 더한 단어");
check(cmp("", "cattle") === "blank" && cmp("   ", "cattle") === "blank", "비워 두면 답 없음");
check(cmp("sing songs together.", "sing songs together") === "ok" && cmp("sing songs together", "sing songs together,") === "ok", "구절 앞뒤 문장 부호는 보지 않음(시험지에 칸이 없음)");
check(cmp("don’t give up", "don't give up") === "ok", "둥근 따옴표(’)와 곧은 따옴표(')는 같게 봄(태블릿 키보드 대비)");
check(cmp("give up", "give up") === "ok" && cmp("giveup", "give up") === "missing", "두 단어 표현은 띄어 써야 정답");
check(cmp("Cattle", "cattle") !== "ok" && cmp("CATTLE", "cattle") === "capitalization", "대문자로만 써도 틀림");

// --- 단원 데이터로 문항 만들기·채점(정답을 넣으면 만점, 하나라도 바꾸면 그 문항만 0점)
var files = fs.readdirSync(dataDir).filter(function (f) { return /\.json$/.test(f); });
var words = [], chunks = [];
files.forEach(function (f) {
  var raw = JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8"));
  if (raw.kind === "word") words.push({ f: f, raw: raw }); else if (raw.kind === "chunk") chunks.push({ f: f, raw: raw });
});
check(words.length > 0 && chunks.length > 0, "단원 데이터: 단어 " + words.length + "개, chunk " + chunks.length + "개");

function rightAnswers(q) {
  return q.items.map(function (it) {
    if (it.type === "mcq") return it.answer;
    if (it.type === "colloc") return it.answers.slice();
    return it.answers[0];
  });
}
function breakOne(q, ans, i) {
  var it = q.items[i];
  var a = ans.slice();
  if (it.type === "mcq") a[i] = (it.answer + 1) % it.options.length;
  else if (it.type === "colloc") { a[i] = a[i].slice(); a[i][0] = a[i][0].charAt(0).toUpperCase() === a[i][0].charAt(0) ? a[i][0].toLowerCase() + "x" : a[i][0].charAt(0).toUpperCase() + a[i][0].slice(1); }
  else { var s = a[i]; a[i] = s.slice(0, -1); }
  return a;
}

var runs = 0, bad = [];
words.forEach(function (w) {
  var data = WT.word.load(w.raw);
  var src = WT.word.allowedSources(data);
  for (var seed = 1; seed <= 40; seed++) {
    ["regular", "all-write"].forEach(function (mode) {
      var s, q;
      if (mode === "regular") s = WT.word.makeRegular(data, WT.word.defaultMcq(data), src, seed);
      else s = WT.word.makeAllWrite(data, src, seed);
      q = Q.fromWord(data, s, { parts: new Set(["A", "B"]) });
      runs++;
      var ans = rightAnswers(q);
      var g = Q.grade(q, ans);
      if (g.score !== q.total || g.correct !== q.items.length) bad.push(w.f + " " + mode + " seed " + seed + ": 정답인데 " + g.score + "/" + q.total);
      var i = seed % q.items.length;
      var g2 = Q.grade(q, breakOne(q, ans, i));
      if (g2.items[i].correct || g2.score !== q.total - q.items[i].pts) bad.push(w.f + " " + mode + " seed " + seed + ": " + (i + 1) + "번을 바꿨는데 점수가 " + g2.score);
      var g0 = Q.grade(q, []);
      if (g0.score !== 0 || g0.items.some(function (r) { return r.reason !== "blank"; })) bad.push(w.f + " " + mode + " seed " + seed + ": 비워 둔 답안이 0점이 아님");
    });
  }
});
chunks.forEach(function (c) {
  var data = WT.chunk.load(c.raw);
  for (var seed = 1; seed <= 40; seed++) {
    ["sample", "full"].forEach(function (mode) {
      ["none", "first"].forEach(function (hint) {
        var s = WT.chunk.makeSet(data, mode, 6, 3, 2, 1, seed);
        var q = Q.fromChunk(data, s, { hint: hint });
        runs++;
        var ans = rightAnswers(q);
        var g = Q.grade(q, ans);
        if (g.score !== q.total) bad.push(c.f + " " + mode + " seed " + seed + ": 정답인데 " + g.score + "/" + q.total);
        var i = seed % q.items.length;
        var g2 = Q.grade(q, breakOne(q, ans, i));
        if (g2.items[i].correct || g2.score !== q.total - q.items[i].pts) bad.push(c.f + " " + mode + " seed " + seed + ": " + (i + 1) + "번을 바꿨는데 점수가 " + g2.score);
      });
    });
  }
});
check(bad.length === 0, "모든 단원 × 방식 × 시험지 번호 40개로 " + runs + "번: 정답이면 만점, 한 문항만 틀리면 그 문항 점수만 빠짐, 비우면 0점" + (bad.length ? "\n  " + bad.slice(0, 5).join("\n  ") : ""));

// --- 문항 모양이 종이 시험지와 같음
var W = words.filter(function (x) { return x.raw.words.length === 10; })[0];
var wd = WT.word.load(W.raw);
var sR = WT.word.makeRegular(wd, WT.word.defaultMcq(wd), WT.word.allowedSources(wd), 123);
var qR = Q.fromWord(wd, sR, {});
check(qR.items.length === 10 && qR.items.filter(function (x) { return x.type === "write"; }).length === 6 && qR.items.filter(function (x) { return x.type === "mcq"; }).length === 4 && qR.total === 100, "단어 학원 모양: 쓰기 6 + 보기 번호 4, 합계 100점");
var html = WT.word.buildRegular(wd, sR, {});
var order = qR.items.filter(function (x) { return x.type === "write"; }).map(function (x) { return html.indexOf(WT.util.esc(x.prompt)); });
check(order.every(function (p, i) { return p > 0 && (i === 0 || p > order[i - 1]); }), "같은 시험지 번호면 화면 문항 순서가 종이 시험지와 같음");
check(qR.items.filter(function (x) { return x.type === "mcq"; }).every(function (x) { return x.options.length === 4 && x.options[x.answer] === x.word; }), "보기 번호 문항의 정답 번호가 맞음");
var sW = WT.word.makeAllWrite(wd, WT.word.allowedSources(wd), 5);
var qA = Q.fromWord(wd, sW, { parts: new Set(["A"]) });
var qB = Q.fromWord(wd, sW, { parts: new Set(["B"]) });
check(qA.items.length === wd.words.length && qB.items.length === sW.b.length && qB.items.every(function (x) { return x.bank && x.sentence; }), "전체 쓰기: 고른 파트만 문항으로 나오고 Part B 에는 보기 박스가 있음");
var C = chunks.filter(function (x) { return /L07-08/.test(x.f); })[0] || chunks[0];
var cd = WT.chunk.load(C.raw);
var sC = WT.chunk.makeSet(cd, "sample", 6, 3, 2, 1, 9);
var qC = Q.fromChunk(cd, sC, { hint: "first" });
check(qC.items.filter(function (x) { return x.type === "colloc"; }).length === 6 && qC.items.filter(function (x) { return x.type === "chunk"; }).length === 3 && qC.items.filter(function (x) { return x.type === "fill"; }).length === 2 && qC.total === 20, "chunk 학원 모양: Key Vocabulary 6 + Chunk 3 + Fill 2, 합계 20점");
check(qC.items.filter(function (x) { return x.type === "fill"; }).every(function (x) { return x.hintText && x.hintText.indexOf("…") >= 0; }), "첫 글자 힌트가 있으면 Fill 문항에 힌트가 나옴");
check(Q.fromChunk(cd, sC, { hint: "none" }).items.filter(function (x) { return x.type === "fill"; }).every(function (x) { return x.hintText === null && x.words >= 1; }), "힌트가 없으면 단어 수만 알려 줌");
var seg = Q.segments("give {up} and {go} home");
check(JSON.stringify(seg) === JSON.stringify([{ text: "give " }, { blank: 0 }, { text: " and " }, { blank: 1 }, { text: " home" }]), "콜로케이션의 빈칸을 나눔");
check(Q.hintPattern("chant and sing songs together.", WT.chunk.KEEP_DEFAULT) === "c… and s… s… t…", "첫 글자 힌트 모양: " + Q.hintPattern("chant and sing songs together.", WT.chunk.KEEP_DEFAULT));

// 범위 전체: 같은 문장이 Chunk 와 Fill 에 둘 다 나오면, 하나만 틀려도 그 chunk 는 틀린 것으로 셈
var sF = WT.chunk.makeSet(cd, "full", 6, 3, 2, 1, 4);
var qF = Q.fromChunk(cd, sF, { hint: "none" });
var ansF = rightAnswers(qF);
var fi = qF.items.findIndex(function (x) { return x.type === "fill"; });
ansF[fi] = "";
var gF = Q.grade(qF, ansF);
var k = qF.items[fi].key;
check(gF.byKey[k] === false && qF.items.filter(function (x) { return x.key === k; }).length === 2, "같은 chunk 가 두 문항에 나오면 하나만 틀려도 그 chunk 는 틀린 것으로 셈");
check(/^missing word|^not answered|Spelling|capitalization|different|added/.test(Q.reasonText(qF, "spelling")) && Q.reasonText(qF, "missing").indexOf("missing word") === 0, "chunk 틀린 이유는 시험지 아래의 영어 표현을 씀");
check(Q.reasonText(qR, "capitalization") === "대소문자가 달라요", "단어 시험 틀린 이유는 한글로 알려 줌");

// --- 틀린 표시 반영(틀리면 넣고, 약한 항목을 연속 2번 맞히면 뺌)
resetStore();
var id = "word|아이 B|x|L7|t|";
var r1 = WT.store.applyGrading(id, { cattle: false, coin: true });
check(r1.added.join() === "cattle" && !WT.store.isWeak(id, "coin") && WT.store.isWeak(id, "cattle"), "틀린 단어는 약한 목록에 들어가고, 맞힌 단어(약한 목록에 없던 것)는 그대로");
var r2 = WT.store.applyGrading(id, { cattle: true });
check(r2.progress.join() === "cattle" && WT.store.isWeak(id, "cattle"), "약한 단어를 한 번 맞히면 아직 남아 있음");
var r3 = WT.store.applyGrading(id, { cattle: false });
check(r3.again.join() === "cattle" && WT.store.isWeak(id, "cattle"), "다시 틀리면 연속 맞힘 횟수가 처음으로 돌아감");
WT.store.applyGrading(id, { cattle: true });
var r5 = WT.store.applyGrading(id, { cattle: true });
check(r5.cleared.join() === "cattle" && !WT.store.isWeak(id, "cattle"), "약한 단어를 연속 " + WT.store.CLEAR_AFTER + "번 맞히면 약한 목록에서 빠짐");
WT.store.setWeak(id, "coin", true);
WT.store.applyGrading(id, { coin: true });
check(WT.store.isWeak(id, "coin"), "직접 표시한 약한 단어도 같은 규칙(한 번 맞히면 남음)");

// --- 기록
WT.store.addResult({ at: "2026-11-17T01:00:00Z", lessonId: id, score: 70, total: 100 });
WT.store.addResult({ at: "2026-11-17T02:00:00Z", lessonId: id, score: 90, total: 100 });
WT.store.addResult({ at: "2026-11-17T03:00:00Z", lessonId: "other", score: 10, total: 20 });
var rs = WT.store.resultsFor(id);
check(rs.length === 2 && rs[0].score === 90, "시험 기록이 단원별로 최근 것부터 남음");
var bk = WT.store.exportAll();
resetStore();
var imp = WT.store.importText(bk, "백업");
check(imp.resultsRestored === 3 && WT.store.resultsFor(id).length === 2 && WT.store.resultsFor(id)[0].score === 90, "백업에 시험 기록이 들어가고 가져오면 돌아옴");
var imp2 = WT.store.importText(bk, "백업");
check(imp2.resultsRestored === 0 && WT.store.resultsFor(id).length === 2, "같은 백업을 다시 가져와도 기록이 겹치지 않음");
for (var n = 0; n < 320; n++) WT.store.addResult({ at: "2026-11-18T00:00:" + n, lessonId: "many", score: 1, total: 1 });
check(WT.store.resultsFor("many").length <= 300, "기록은 최근 300개까지만 남김");

console.log(fails === 0 ? "화면 시험 채점 점검 모두 통과" : "실패 " + fails + "건");
process.exit(fails === 0 ? 0 : 1);
