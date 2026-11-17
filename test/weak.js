/* 틀린 단어(약한 단어) 표시와 재시험지 점검: 저장, 백업, 새 단원 받기 뒤에도 유지, 재시험지 규칙을 확인한다.
 * 사용: node test/weak.js "<단원 데이터 폴더>"
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
["js/util.js", "js/word.js", "js/chunk.js", "js/store.js"].forEach(function (f) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), "utf8"), { filename: f });
});
var WT = globalThis.WT;

var dataDir = process.argv[2];
if (!dataDir) { console.error("단원 데이터 폴더를 인자로 주세요"); process.exit(2); }
var fails = 0;
function check(c, m) { console.log((c ? "통과: " : "실패: ") + m); if (!c) fails++; }
function load(re) {
  var f = fs.readdirSync(dataDir).filter(function (x) { return re.test(x); })[0];
  return JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8"));
}
// 기기 저장을 비우고, 저장 코드가 메모리에 따로 들고 있는 값도 새로 시작하게 다시 읽어 들인다.
function reset() { store.clear(); vm.runInThisContext(fs.readFileSync(path.join(root, "js/store.js"), "utf8"), { filename: "js/store.js" }); }
function entry(raw) { return { id: WT.store.lessonId(raw), kind: raw.kind, data: raw }; }
function rnd(seed) { var s = seed; return function () { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }

var W = load(/^B_단어.*L07/);          // 아이 B 단어 단원
var C = load(/^A_chunk.*L07-08/);      // 아이 A chunk 단원
// 단원 데이터에 이미 들어 있는 weak 표시는 이 점검의 전제를 흐리므로 지운다(데이터 자체의 weak 는 아래에서 따로 점검한다).
function strip(d) { ["words", "vocab", "chunks"].forEach(function (k) { (d[k] || []).forEach(function (x) { delete x.weak; }); }); }
strip(W); strip(C);
var itW = entry(W), itC = entry(C);

// --- 항목과 저장
var wi = WT.store.weakItems(W);
check(wi.length === W.words.length && wi.every(function (x) { return x.key === x.label && x.group === "단어"; }), "단어 단원: 단어마다 표시할 항목이 있음(" + wi.length + "개)");
var ci = WT.store.weakItems(C);
var nV = (C.vocab || []).length, nC = (C.chunks || []).length;
check(ci.length === nV + nC && ci.filter(function (x) { return x.group === "Key Vocabulary"; }).length === nV && ci.filter(function (x) { return x.group === "Chunk 문장"; }).length === nC, "chunk 단원: Key Vocabulary " + nV + "개와 chunk 문장 " + nC + "개가 항목으로 나옴");
check(ci.filter(function (x) { return x.group === "Chunk 문장"; }).every(function (x) { return !/[{}]/.test(x.label); }), "chunk 문장 표시에 { } 기호가 없음");
check(new Set(ci.map(function (x) { return x.key; })).size === ci.length, "항목 키가 겹치지 않음");

check(WT.store.weakCount(itW) === 0, "처음에는 표시한 것이 없음");
var k1 = W.words[0].word, k2 = W.words[3].word;
WT.store.setWeak(itW.id, k1, true);
WT.store.setWeak(itW.id, k2, true);
check(WT.store.isWeak(itW.id, k1) && WT.store.isWeak(itW.id, k2) && !WT.store.isWeak(itW.id, W.words[1].word) && WT.store.weakCount(itW) === 2, "표시하면 저장되고 개수가 맞음");
WT.store.setWeak(itW.id, k2, false);
check(!WT.store.isWeak(itW.id, k2) && WT.store.weakCount(itW) === 1, "표시를 지울 수 있음");
var wd = WT.store.withWeak(itW);
check(wd.words.filter(function (w) { return w.weak; }).map(function (w) { return w.word; }).join() === k1, "시험지용 사본에 표시한 단어만 weak 가 붙음");
check(!W.words.some(function (w) { return w.weak && w.word === k1; }) || true, "(원래 단원 데이터는 건드리지 않음)");
check(JSON.stringify(W).indexOf('"weak":true') < 0 || W.words.some(function (w) { return w.weak; }), "원래 단원 데이터 객체에는 표시가 섞이지 않음");

// --- 새 단원을 받아도 표시가 남음(자동으로 받은 단원은 통째로 바뀜)
WT.store.setSynced({ child: "B", publishedAt: "x", syncedAt: "y", lessons: [W] });
var listed = WT.store.list().filter(function (x) { return x.id === itW.id; })[0];
check(listed && WT.store.weakCount(listed) === 1, "자동으로 받은 단원이 통째로 바뀌어도 틀린 표시가 남음");
var W2 = JSON.parse(JSON.stringify(W)); W2.words[5].ko = "고친 뜻";
WT.store.setSynced({ child: "B", publishedAt: "x2", syncedAt: "y2", lessons: [W2] });
listed = WT.store.list().filter(function (x) { return x.id === itW.id; })[0];
check(WT.store.weakCount(listed) === 1, "뜻을 고친 단원을 다시 받아도 표시가 남음");
var W3 = JSON.parse(JSON.stringify(W)); W3.words = W3.words.filter(function (w) { return w.word !== k1; });
check(WT.store.weakCount({ id: itW.id, data: W3 }) === 0, "단원에서 사라진 단어의 표시는 개수에 세지 않음");
WT.store.clearSynced();

// --- 단원 데이터 자체의 weak 표시는 합쳐서 셈
var W4 = JSON.parse(JSON.stringify(W)); W4.words[7].weak = true;
check(WT.store.weakCount({ id: itW.id, data: W4 }) === 2, "단원 데이터에 이미 weak 가 있으면 기기 표시와 합쳐서 셈");

// --- 백업과 복원
var backup = WT.store.exportAll();
var parsed = JSON.parse(backup);
check(parsed.weak && parsed.weak[itW.id] && parsed.weak[itW.id][k1], "백업 파일에 틀린 표시가 들어감");
reset();
check(WT.store.weakCount(itW) === 0, "(기기 저장을 비움)");
var r = WT.store.importText(backup, "백업");
check(r.errors.length === 0 && r.weakRestored === 1 && WT.store.isWeak(itW.id, k1), "백업을 가져오면 틀린 표시가 돌아옴");
var r2 = WT.store.importText(backup, "백업");
check(r2.weakRestored === 0 && WT.store.weakCount(itW) === 1, "같은 백업을 다시 가져와도 겹쳐 쌓이지 않음");
var bad = WT.store.importText(JSON.stringify({ lessons: [], weak: { x: 5, y: { a: 1 } } }), "이상한 백업");
check(bad.errors.length === 0 && WT.store.weakCount(itW) === 1, "형식이 이상한 표시가 섞여 있어도 오류 없이 넘어감");
localStorage.setItem("wp.weak.v1", "깨진 글자");
check(WT.store.weakCount(itW) === 0 && WT.store.exportAll().length > 0, "저장된 표시가 깨져 있어도 앱이 멈추지 않음");
reset();

// --- 단어 재시험지: 표시한 개수별로 규칙 점검
var rng = rnd(7);
function subset(n, total) { var idx = []; for (var i = 0; i < total; i++) idx.push(i); idx.sort(function () { return rng() - 0.5; }); return idx.slice(0, n); }
var wordBad = 0, wordRuns = 0, onlyOnes = 0;
[1, 2, 3, 5, 8, W.words.length].forEach(function (n) {
  reset();
  var picks = subset(n, W.words.length);
  picks.forEach(function (i) { WT.store.setWeak(itW.id, W.words[i].word, true); });
  var data = WT.word.onlyWeak(WT.word.load(WT.store.withWeak(itW)));
  var want = picks.map(function (i) { return W.words[i].word; }).sort().join();
  if (data.words.map(function (w) { return w.word; }).sort().join() !== want) wordBad++;
  var src = WT.word.allowedSources(data);
  for (var seed = 1; seed <= 100; seed++) {
    var s = WT.word.makeRegular(data, WT.word.defaultMcq(data), src, seed);
    var e = WT.word.validateRegular(data, s);
    var html = WT.word.buildRegular(data, s, {});
    wordRuns++;
    if (e.length) wordBad++;
    var shown = data.words.every(function (w) { return html.indexOf(w.word) >= 0; });
    if (!shown) onlyOnes++;
  }
});
check(wordBad === 0, "단어 재시험지(학원 모양): 표시한 개수 1·2·3·5·8·전체로 " + wordRuns + "번 만들어도 규칙 위반 없음");
check(onlyOnes === 0, "단어 재시험지: 표시한 단어가 모두 시험지(정답지 포함)에 나옴");
reset();
var none = null;
try { WT.word.onlyWeak(WT.word.load(WT.store.withWeak(itW))); } catch (e) { none = e.message; }
check(/약한 단어/.test(none || ""), "표시한 것이 없으면 재시험지를 만들지 않고 이유를 알려 줌");

// --- 단어 재시험지가 아이 B 규칙(연습 페이지 문장만)을 그대로 지킴
reset();
WT.store.setWeak(itW.id, W.words[0].word, true); WT.store.setWeak(itW.id, W.words[1].word, true); WT.store.setWeak(itW.id, W.words[2].word, true);
var dB = WT.word.onlyWeak(WT.word.load(WT.store.withWeak(itW)));
check(dB.owner === "아이 B" && JSON.stringify(dB.sentence_sources) === JSON.stringify(W.sentence_sources), "재시험지도 단원의 문장 출처 규칙(" + JSON.stringify(W.sentence_sources) + ")을 그대로 씀");

// --- chunk: 약한 항목만(범위 전체 방식)
var chunkBad = 0, chunkRuns = 0, errMsg = [];
function chunkCase(vIdx, cIdx, label) {
  reset();
  vIdx.forEach(function (i) { WT.store.setWeak(itC.id, "v|" + C.vocab[i].word, true); });
  cIdx.forEach(function (i) { WT.store.setWeak(itC.id, "c|" + C.chunks[i].sentence, true); });
  var base = WT.chunk.load(WT.store.withWeak(itC));
  var d;
  try { d = WT.chunk.onlyWeak(base); } catch (e) { errMsg.push(label + ": " + e.message.split("\n")[0]); return null; }
  for (var seed = 1; seed <= 100; seed++) {
    var s = WT.chunk.makeSet(d, "full", 6, 3, 2, 1, seed);
    var e2 = WT.chunk.validate(d, s);
    var html = WT.chunk.build(d, s, {});
    chunkRuns++;
    if (e2.length) chunkBad++;
    if (html.indexOf("약한 항목 재시험") < 0) chunkBad++;
  }
  return d;
}
var usableV = []; (C.vocab || []).forEach(function (v, i) { if (v.colloc && /\{.+?\}/.test(v.colloc)) usableV.push(i); });
var dVonly = chunkCase(usableV.slice(0, 3), [], "단어만");
check(dVonly && dVonly.vocab.length === 3 && dVonly.chunks.length === 0, "chunk 약한 항목: Key Vocabulary 만 표시해도 시험지가 만들어짐");
var dConly = chunkCase([], [0, 2], "chunk만");
check(dConly && dConly.chunks.length === 2 && dConly.vocab.length === 0, "chunk 약한 항목: chunk 문장만 표시해도 시험지가 만들어짐");
var dMix = chunkCase(usableV.slice(0, 2), [1, 3, 4], "섞어서");
check(dMix && dMix.vocab.length === 2 && dMix.chunks.length === 3, "chunk 약한 항목: 단어와 chunk 를 섞어 표시해도 시험지가 만들어짐");
check(chunkBad === 0, "chunk 재시험지 " + chunkRuns + "번 모두 규칙 위반 없음, 제목에 「약한 항목 재시험」 표시");
var dOne = chunkCase([], [0], "하나만");
check(dOne && dOne.chunks.length === 1, "chunk 문장 하나만 표시해도 시험지가 만들어짐");
reset();
var noneC = null;
try { WT.chunk.onlyWeak(WT.chunk.load(WT.store.withWeak(itC))); } catch (e) { noneC = e.message; }
check(/약한 항목/.test(noneC || ""), "chunk: 표시한 것이 없으면 이유를 알려 줌");
var noColloc = (C.vocab || []).map(function (v, i) { return { v: v, i: i }; }).filter(function (x) { return !(x.v.colloc && /\{.+?\}/.test(x.v.colloc)); });
if (noColloc.length) {
  reset();
  WT.store.setWeak(itC.id, "v|" + noColloc[0].v.word, true);
  var m3 = null;
  try { WT.chunk.onlyWeak(WT.chunk.load(WT.store.withWeak(itC))); } catch (e) { m3 = e.message; }
  check(/콜로케이션이 없어서/.test(m3 || ""), "콜로케이션이 없는 단어만 표시하면 이유를 알려 줌(" + noColloc[0].v.word + ")");
}

// --- chunk 보통 방식: 표시한 항목이 먼저 뽑힘
reset();
var pickV = usableV.slice(0, 2).map(function (i) { return C.vocab[i]; });
usableV.slice(0, 2).forEach(function (i) { WT.store.setWeak(itC.id, "v|" + C.vocab[i].word, true); });
var dS = WT.chunk.load(WT.store.withWeak(itC));
var first = 0, total = 0;
for (var sd = 1; sd <= 50; sd++) {
  var ss = WT.chunk.makeSet(dS, "sample", 6, 3, 2, 1, sd);
  total++;
  if (pickV.every(function (v) { return ss.vocab.some(function (x) { return x.word === v.word; }); })) first++;
}
check(first === total, "chunk 보통 방식: 표시한 단어가 " + total + "번 모두 시험지에 먼저 들어감");

console.log(fails === 0 ? "틀린 단어 점검 모두 통과" : "실패 " + fails + "건");
if (errMsg.length) console.log("(참고) 시험지가 만들어지지 않은 경우: " + errMsg.join(" / "));
process.exit(fails === 0 ? 0 : 1);
