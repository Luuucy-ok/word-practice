/* 외우기(암기 모드) 규칙 점검: 단원 데이터 → 암기 항목, 듣고 쓰기 채점, 범위 고르기, 카드 묶음 순서를 확인한다.
 * 사용: node test/study.js "<단원 데이터 폴더>"
 * 교재 데이터는 이 저장소에 두지 않는다. 폴더는 저장소 밖의 경로를 준다.
 */
"use strict";
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var mem = new Map();
globalThis.localStorage = {
  getItem: function (k) { return mem.has(k) ? mem.get(k) : null; },
  setItem: function (k, v) { mem.set(k, String(v)); },
  removeItem: function (k) { mem.delete(k); }
};
var root = path.join(__dirname, "..");
["js/util.js", "js/word.js", "js/chunk.js", "js/store.js", "js/quiz.js", "js/study.js"].forEach(function (f) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), "utf8"), { filename: f });
});
var WT = globalThis.WT;
var S = WT.study;

var dataDir = process.argv[2];
if (!dataDir) { console.error("단원 데이터 폴더를 인자로 주세요"); process.exit(2); }
var fails = 0;
function check(c, m) { console.log((c ? "통과: " : "실패: ") + m); if (!c) fails++; }
function strip(s) { return String(s).replace(/[{}]/g, ""); }
function filled(it) { return it.parts.map(function (p) { return p.text !== undefined ? p.text : it.answers[p.blank]; }).join(""); }

// --- 1) 모든 단원 데이터로 항목 만들기
var files = fs.readdirSync(dataDir).filter(function (f) { return /\.json$/.test(f); });
var nWord = 0, nChunk = 0, bad = [], dup = [];
files.forEach(function (f) {
  var d = JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8"));
  var list = S.items(d);
  var expect = d.kind === "word" ? (d.words || []).length : (d.vocab || []).length + (d.chunks || []).filter(function (c) { return /\{.+?\}/.test(c.sentence || ""); }).length;
  if (list.length !== expect) bad.push(f + ": 항목 수 " + list.length + " ≠ " + expect);
  var keys = {};
  list.forEach(function (it) {
    if (keys[it.key]) dup.push(f + ": " + it.key); keys[it.key] = 1;
    var blanks = it.parts.filter(function (p) { return p.blank !== undefined; }).length;
    if (!it.answers.length || it.answers.some(function (a) { return !String(a).trim(); })) bad.push(f + ": 빈 정답 " + it.key);
    if (blanks !== it.answers.length) bad.push(f + ": 빈칸 수와 정답 수가 다름 " + it.key);
    if (!it.say || it.answers.some(function (a) { return it.say.indexOf(a) < 0; })) bad.push(f + ": 들려줄 영어에 정답이 없음 " + it.key);
    if (it.group === "Chunk 문장" && filled(it) !== strip(it.key.slice(2))) bad.push(f + ": chunk 문장 복원 실패 " + it.key);
    if (it.group === "Key Vocabulary" && filled(it) !== it.say) bad.push(f + ": 콜로케이션 복원 실패 " + it.key);
    if (d.kind === "word" && !(it.en || it.ko)) bad.push(f + ": 뜻이 없음 " + it.key);
    if (/\*\*/.test(it.ko)) bad.push(f + ": 한글 뜻에 ** 가 남음 " + it.key);
    if (WT.study.check(it, it.answers).ok !== true) bad.push(f + ": 정답을 넣어도 틀림 " + it.key);
  });
  if (d.kind === "word") nWord += list.length; else nChunk += list.length;
});
check(!bad.length, "데이터 " + files.length + "개(단어 항목 " + nWord + "개, chunk 항목 " + nChunk + "개): 빈칸·정답·들려줄 영어·문장 복원이 맞고 정답을 넣으면 맞음" + (bad.length ? "\n  " + bad.slice(0, 10).join("\n  ") : ""));
if (dup.length) console.log("참고: 한 단원 안에 같은 키가 두 번 있음(약한 목록에서 하나로 다뤄짐) " + dup.length + "건: " + dup.slice(0, 5).join(", "));

// --- 2) 듣고 쓰기 채점
var word = { key: "American", parts: [{ blank: 0 }], answers: ["American"] };
check(S.check(word, ["American"]).ok, "단어: 정답이면 맞음");
check(S.check(word, ["american"]).reason === "capitalization", "단어: 대소문자가 다르면 틀림(대소문자)");
check(S.check(word, [" American "]).ok, "단어: 앞뒤 공백은 무시");
check(S.check(word, ["Amercan"]).reason === "spelling", "단어: 한 글자 틀리면 틀림(철자)");
var col = { key: "v|x", parts: WT.quiz.segments("{build} a {bond}"), answers: ["build", "bond"] };
var r = S.check(col, ["build", "bonds"]);
check(!r.ok && r.wrongAt.length === 1 && r.wrongAt[0] === 1, "콜로케이션: 한 칸이라도 틀리면 틀림, 틀린 칸 위치를 알려 줌");
check(S.check(col, ["build", "bond"]).ok, "콜로케이션: 칸이 모두 맞으면 맞음");
var ch = { key: "c|a", parts: [{ text: "We " }, { blank: 0 }, { text: "." }], answers: ["must work in perfect harmony"] };
check(S.check(ch, ["must  work in perfect harmony."]).ok, "chunk: 연속 공백과 끝 문장 부호는 보지 않음");
check(S.check(ch, ["must work perfect harmony"]).reason === "missing", "chunk: 단어를 빠뜨리면 빠진 단어");

// --- 3) 범위 고르기
var list3 = [
  { key: "a", group: "Key Vocabulary", base: false }, { key: "b", group: "Key Vocabulary", base: true },
  { key: "c", group: "Chunk 문장", base: false }, { key: "d", group: "Chunk 문장", base: false }
];
var weakSet = { c: 1 };
var isW = function (k) { return !!weakSet[k]; };
check(S.select(list3, {}).length === 4, "범위 전체: 모두");
check(S.select(list3, { weakOnly: true, isWeak: isW }).map(function (x) { return x.key; }).join() === "b,c", "약한 항목만: 데이터의 weak 표시 + 기기에 표시한 것");
check(S.select(list3, { groups: ["Chunk 문장"] }).map(function (x) { return x.key; }).join() === "c,d", "항목 고르기: chunk 문장만");
check(S.select(list3, { weakOnly: true, isWeak: isW, groups: ["Key Vocabulary"] }).map(function (x) { return x.key; }).join() === "b", "약한 항목 + 항목 고르기를 함께 적용");

// --- 4) 카드 묶음
var deck = new S.Deck([{ key: 1 }, { key: 2 }, { key: 3 }], new WT.util.Rng(7));
var order = deck.queue.map(function (x) { return x.key; });
check(order.length === 3 && deck.total === 3, "카드 묶음: 3장을 섞어서 시작");
var first = deck.current();
check(deck.fail() === true && deck.queue[2] === first && deck.missed.length === 1, "몰라요/틀림: 카드가 맨 뒤로 가고 처음 놓친 것으로 기록");
deck.pass(); deck.pass();
check(deck.current() === first && deck.doneN === 2, "다른 카드를 끝내면 놓친 카드가 다시 나옴");
check(deck.fail() === false && deck.missed.length === 1, "같은 카드를 또 놓쳐도 처음 놓친 목록에는 한 번만");
deck.pass();
check(deck.finished() && deck.doneN === 3, "모두 맞히면 끝(끝낸 것 3 / 3)");
var seen = {};
for (var s = 1; s <= 200; s++) { seen[new S.Deck([1, 2, 3, 4], new WT.util.Rng(s)).queue.join("")] = 1; }
check(Object.keys(seen).length > 10, "섞는 순서가 매번 달라짐(200번 중 " + Object.keys(seen).length + "가지)");

// --- 5) 듣고 쓰기에서 처음 틀린 것은 약한 목록에 들어가고, 맞힌 것은 약한 목록을 바꾸지 않음
mem.clear();
vm.runInThisContext(fs.readFileSync(path.join(root, "js/store.js"), "utf8"), { filename: "js/store.js" });
var res = WT.store.applyGrading("L1", { apple: false });
check(res.added.length === 1 && WT.store.isWeak("L1", "apple"), "처음 틀리면 약한 목록에 들어감(화면 시험과 같은 저장)");

console.log(fails === 0 ? "외우기 규칙 점검 모두 통과" : "실패 " + fails + "건");
process.exit(fails === 0 ? 0 : 1);
