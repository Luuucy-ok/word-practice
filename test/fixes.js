/* 확인 표 「고칠 곳 적기」 점검: 적기·바꾸기·지우기, 복사할 글, 원본 반영 뒤 저절로 빠지기, 백업을 확인한다.
 * 사용: node test/fixes.js "<단원 데이터 폴더>"
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
function load(re) { var f = fs.readdirSync(dataDir).filter(function (x) { return re.test(x); })[0]; return JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8")); }
function resetStore() { store.clear(); vm.runInThisContext(fs.readFileSync(path.join(root, "js/store.js"), "utf8"), { filename: "js/store.js" }); }

var W = load(/^B_단어.*L07/), C = load(/^A_chunk.*L07-08/);
var idW = WT.store.lessonId(W), idC = WT.store.lessonId(C);
WT.store.saveSettings({ nameA: "테스트이름A", nameB: "테스트이름B" });

// 위치 읽기
check(WT.store.valueAt(W, ["words", 0, "ko"]) === W.words[0].ko && WT.store.valueAt(W, ["words", 99, "ko"]) === undefined, "단원 데이터 안의 위치로 값을 읽음(없는 위치는 undefined)");

// 적기·바꾸기·지우기
var p1 = ["words", 0, "ko"];
WT.store.setFix({ id: idW, label: "단어 Lesson 7", owner: W.owner, path: p1, where: "단어 " + W.words[0].word + " · 한글 뜻", before: W.words[0].ko, after: "  고친 뜻  " });
var f1 = WT.store.fixAt(idW, p1);
check(f1 && f1.after === "고친 뜻" && f1.before === W.words[0].ko && WT.store.fixesFor(idW).length === 1, "고칠 곳을 적으면 저장됨(앞뒤 공백은 지움)");
WT.store.setFix({ id: idW, label: "단어 Lesson 7", owner: W.owner, path: p1, where: "x", before: W.words[0].ko, after: "다시 고친 뜻" });
check(WT.store.fixesFor(idW).length === 1 && WT.store.fixAt(idW, p1).after === "다시 고친 뜻", "같은 칸을 다시 적으면 하나로 바뀜");
WT.store.setFix({ id: idW, label: "단어 Lesson 7", owner: W.owner, path: p1, where: "x", before: W.words[0].ko, after: W.words[0].ko });
check(WT.store.fixesFor(idW).length === 0, "원래 내용과 같게 적으면 그 칸의 고칠 곳이 지워짐");
WT.store.setFix({ id: idW, label: "단어 Lesson 7", owner: W.owner, path: p1, where: "x", before: W.words[0].ko, after: "고친 뜻" });
WT.store.setFix({ id: idW, label: "단어 Lesson 7", owner: W.owner, path: p1, where: "x", before: W.words[0].ko, after: "   " });
check(WT.store.fixesFor(idW).length === 0, "비우고 확인하면 그 칸의 고칠 곳이 지워짐");

// 여러 단원, 복사할 글
var p2 = ["words", 2, "sentences", 0, "text"], p3 = ["vocab", 1, "colloc"], p4 = ["chunks", 0, "sentence"];
WT.store.setFix({ id: idW, label: "단어 Lesson 7 The Coin Club", owner: W.owner, path: p1, where: "단어 " + W.words[0].word + " · 한글 뜻", before: W.words[0].ko, after: "고친 뜻" });
WT.store.setFix({ id: idW, label: "단어 Lesson 7 The Coin Club", owner: W.owner, path: p2, where: "단어 " + W.words[2].word + " · 연습 문장", before: "old", after: "new sentence ___ here." });
WT.store.setFix({ id: idC, label: "Chunk Quiz Lesson 7 & 8", owner: C.owner, path: p3, where: "Key Vocabulary · 콜로케이션", before: C.vocab[1].colloc || "", after: "builds a {bond}" });
WT.store.setFix({ id: idC, label: "Chunk Quiz Lesson 7 & 8", owner: C.owner, path: p4, where: "chunk 문장 1번", before: C.chunks[0].sentence, after: "Many {fans chant} loudly." });
var txt = WT.store.fixesText();
check(/^\[단어 연습 앱 · 확인 표 고칠 곳 4개\]/.test(txt), "복사할 글 첫 줄에 개수가 나옴");
check(txt.indexOf("1) 아이 B · 단어 Lesson 7 The Coin Club") >= 0 && txt.indexOf("2) 아이 A · Chunk Quiz Lesson 7 & 8") >= 0, "단원별로 묶어 아이(A·B)와 단원 이름을 적음");
check(txt.indexOf("단원 id: " + idW) >= 0 && txt.indexOf("단원 id: " + idC) >= 0, "원본을 정확히 찾도록 단원 id 를 적음");
check(txt.indexOf("「" + W.words[0].ko + "」 → 「고친 뜻」") >= 0 && txt.indexOf("→ 「builds a {bond}」") >= 0, "칸마다 「지금」 → 「바른 내용」을 적음");
check(txt.indexOf("테스트이름") < 0, "아이 이름은 복사할 글에 넣지 않음");

// 원본이 고쳐져 새로 받은 단원에 반영되면 저절로 빠짐
var W2 = JSON.parse(JSON.stringify(W)); W2.words[0].ko = "고친 뜻";
WT.store.setSynced({ child: "B", publishedAt: "p", syncedAt: "s", lessons: [W2] });
var pruned = WT.store.pruneFixes();
check(pruned === 1 && !WT.store.fixAt(idW, p1) && WT.store.fixAt(idW, p2), "원본이 고쳐진 칸만 목록에서 저절로 빠지고 나머지는 남음");
check(WT.store.pruneFixes() === 0 && WT.store.fixesAll().length === 3, "단원이 이 기기에 없으면(아이 A chunk) 고칠 곳을 그대로 둠");
check(JSON.stringify(WT.store.list().filter(function (x) { return x.id === idW; })[0].data) === JSON.stringify(W2), "고칠 곳을 적어도 앱의 단원은 바뀌지 않음");

// 백업
var bk = WT.store.exportAll();
check(JSON.parse(bk).fixes.length === 3, "백업 파일에 고칠 곳이 들어감");
resetStore();
var r = WT.store.importText(bk, "백업");
check(r.fixesRestored === 3 && WT.store.fixesAll().length === 3, "백업을 가져오면 고칠 곳이 돌아옴");
check(WT.store.importText(bk, "백업").fixesRestored === 0 && WT.store.fixesAll().length === 3, "같은 백업을 다시 가져와도 겹치지 않음");
WT.store.clearFixes(idC);
check(WT.store.fixesAll().length === 1 && WT.store.fixesFor(idC).length === 0, "단원 하나의 목록만 지울 수 있음");
WT.store.clearFixes();
check(WT.store.fixesAll().length === 0 && WT.store.fixesText() === "", "모두 지우면 복사할 글도 비어 있음");
localStorage.setItem("wp.fixes.v1", "깨진 값");
check(WT.store.fixesAll().length === 0 && WT.store.pruneFixes() === 0, "저장된 값이 깨져 있어도 멈추지 않음");

console.log(fails === 0 ? "고칠 곳 점검 모두 통과" : "실패 " + fails + "건");
process.exit(fails === 0 ? 0 : 1);
