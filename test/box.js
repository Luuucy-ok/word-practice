/* 5칸 상자 복습 규칙 점검(교재 데이터 없이 지어낸 단원으로).
 * 사용: node test/box.js
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
function loadStore() { vm.runInThisContext(fs.readFileSync(path.join(root, "js/store.js"), "utf8"), { filename: "js/store.js" }); }
["js/util.js", "js/word.js", "js/chunk.js"].forEach(function (f) { vm.runInThisContext(fs.readFileSync(path.join(root, f), "utf8"), { filename: f }); });
loadStore();
var WT = globalThis.WT;
var S = WT.store;

var fails = 0;
function check(c, m) { console.log((c ? "통과: " : "실패: ") + m); if (!c) fails++; }

// 지어낸 단원(교재 내용 아님)
var WORDS = ["lantern", "pebble", "whistle", "gentle", "orbit", "meadow", "ladder", "harbor", "velvet", "comet",
  "anchor", "maple", "riddle", "copper", "tunnel", "saddle", "breeze", "candle", "marble", "quilt", "feather", "glacier", "walrus", "kettle", "lemon"];
function wordLesson(owner, n, words) {
  return { id: "word|" + owner + "|L" + n, kind: "word", data: { kind: "word", owner: owner, lesson: n, words: words.map(function (w) { return { word: w, en: "meaning of " + w, ko: "뜻" }; }) } };
}
var L1 = wordLesson("아이 A", 1, WORDS.slice(0, 10));
var L2 = wordLesson("아이 A", 2, WORDS.slice(10, 25));
var LB = wordLesson("아이 B", 1, WORDS.slice(0, 5));
var lessons = [L1, L2, LB];
var t0 = S.today();
function plus(n) { var p = t0.split("-"); var d = new Date(+p[0], +p[1] - 1, +p[2] + n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

// 1) 처음 답한 항목 넣기
var o = {}; o.lantern = false; o.pebble = true;
check(S.boxEnter(L1.id, o) === 2, "처음 답한 항목 2개가 상자에 들어감");
check(S.boxOf(L1.id, "lantern").b === 1 && S.boxOf(L1.id, "lantern").due === plus(1), "틀린 항목은 1칸, 다음 복습 내일");
check(S.boxOf(L1.id, "pebble").b === 2 && S.boxOf(L1.id, "pebble").due === plus(2), "맞힌 항목은 2칸, 다음 복습 2일 뒤");
check(S.boxEnter(L1.id, { lantern: true, pebble: false }) === 0 && S.boxOf(L1.id, "lantern").b === 1 && S.boxOf(L1.id, "pebble").b === 2, "이미 든 항목은 외우기·시험에서 다시 답해도 칸이 바뀌지 않음");

// 2) 복습 답으로 칸 옮기기
var mv = S.boxAnswer(L1.id, "pebble", true);
check(mv.from === 2 && mv.to === 3 && mv.due === plus(4), "2칸에서 맞히면 3칸, 다음 복습 4일 뒤");
mv = S.boxAnswer(L1.id, "pebble", true);
check(mv.to === 4 && mv.due === plus(7), "3칸에서 맞히면 4칸, 1주 뒤");
mv = S.boxAnswer(L1.id, "pebble", true);
check(mv.to === 5 && mv.due === plus(14), "4칸에서 맞히면 5칸, 2주 뒤");
mv = S.boxAnswer(L1.id, "pebble", true);
check(mv.to === 6 && mv.due === null, "5칸에서 맞히면 졸업(더는 복습에 안 나옴)");
mv = S.boxAnswer(L1.id, "lantern", false);
check(mv.from === 1 && mv.to === 1 && mv.due === plus(1), "1칸에서 틀리면 1칸 그대로, 내일");
S.boxEnter(L1.id, { whistle: true });
S.boxAnswer(L1.id, "whistle", true); S.boxAnswer(L1.id, "whistle", true); // 4칸
mv = S.boxAnswer(L1.id, "whistle", false);
check(mv.from === 4 && mv.to === 1 && mv.due === plus(1), "4칸에서 틀리면 1칸으로, 내일");

// 3) 오늘의 복습 계획
var p = S.reviewPlan(lessons, "아이 A");
check(p.total === 3 && p.counts[1] === 2 && p.grad === 1 && p.due.length === 0, "오늘 넣은 항목은 오늘 복습에 나오지 않음(1칸 2개, 졸업 1개)");
check(p.next && p.next.date === plus(1) && p.next.n === 2, "다음 복습: 내일 2개");
check(S.reviewPlan(lessons, "아이 B").total === 0, "다른 아이 상자는 섞이지 않음");
S._shiftDays(1);
p = S.reviewPlan(lessons, "아이 A");
check(p.due.length === 2 && p.due.every(function (e) { return e.b === 1; }), "하루 뒤에는 1칸 2개가 오늘의 복습에 나옴");
S._shiftDays(0);

// 칸 낮은 것 먼저, 하루 최대 20개
var many = {};
WORDS.slice(10, 25).forEach(function (w, i) { many[w] = i % 2 === 0; });
S.boxEnter(L2.id, many);
var more = {}; WORDS.slice(3, 10).forEach(function (w) { more[w] = true; });
S.boxEnter(L1.id, more);
S._shiftDays(30);
p = S.reviewPlan(lessons, "아이 A");
check(p.dueAll.length === 24 && p.due.length === S.REVIEW_MAX, "밀린 24개 중 오늘은 20개만 냄");
check(p.due[0].b === 1 && p.due.every(function (e, i) { return i === 0 || p.due[i - 1].b <= e.b; }), "칸이 낮은 것부터 냄");
p.due.slice(0, 15).forEach(function (e) { S.boxAnswer(e.id, e.key, true); S.reviewDayAdd("아이 A", e.id, e.key); });
p = S.reviewPlan(lessons, "아이 A");
check(p.doneToday === 15 && p.due.length === 5 && p.dueAll.length === 9, "오늘 15개를 하면 남은 칸은 5개(하루 20개), 밀린 9개는 그대로");
check(S.reviewPlan(lessons, "아이 B").doneToday === 0, "오늘 한 개수는 아이마다 따로 셈");
S._shiftDays(31);
check(S.reviewPlan(lessons, "아이 A").doneToday === 0, "다음 날이 되면 오늘 한 개수는 0부터");
S._shiftDays(0);

// 4) 단원 데이터에서 사라진 항목은 뺌
var L1b = JSON.parse(JSON.stringify(L1));
L1b.data.words = L1b.data.words.filter(function (w) { return w.word !== "lantern"; });
check(S.boxEntries([L1b]).every(function (e) { return e.key !== "lantern"; }) && S.boxEntries([L1]).some(function (e) { return e.key === "lantern"; }), "단원 데이터에서 빠진 단어는 상자 목록에서 뺌");

// 5) chunk 키
var C = { id: "chunk|아이 A|x", kind: "chunk", data: { kind: "chunk", owner: "아이 A", title: "Chunk Quiz 1", vocab: [{ word: "orbit", colloc: "{orbit} the sun", ko: "돌다" }], chunks: [{ sentence: "We {went home} early.", ko: "일찍 갔다" }] } };
S.boxEnter(C.id, { "v|orbit": true, "c|We {went home} early.": false });
check(S.boxEntries([C]).length === 2, "chunk 의 Key Vocabulary(v|)·문장(c|) 키도 상자에 들어감");

// 6) 백업: 내보내기와 합치기(같은 항목은 나중에 바뀐 것)
var backup = JSON.parse(S.exportAll());
check(backup.box && backup.box[L1.id] && backup.box[L1.id].pebble.b === 6, "백업 파일에 상자 기록이 들어감");
mem.clear(); loadStore(); S = WT.store;
var r = S.importText(JSON.stringify(backup), "백업");
check(r.boxRestored > 0 && S.boxOf(L1.id, "pebble").b === 6, "백업을 가져오면 상자 기록이 돌아옴(" + r.boxRestored + "개)");
var old = JSON.parse(JSON.stringify(backup));
old.box[L1.id].pebble = { b: 2, due: t0, at: "2000-01-01T00:00:00.000Z" };
S.importText(JSON.stringify(old), "옛 백업");
check(S.boxOf(L1.id, "pebble").b === 6, "더 오래된 백업은 지금 기록을 덮지 않음");
check(S.isWeak(L1.id, "lantern") === false, "복습 상자는 틀린 단어 표시와 따로 저장됨");

console.log(fails === 0 ? "복습 상자 점검 모두 통과" : "실패 " + fails + "건");
process.exit(fails === 0 ? 0 : 1);
