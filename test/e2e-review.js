/* 오늘의 복습(5칸 상자) 화면 점검: 빈 상자 안내, 외우기·태블릿 시험에서 처음 답한 항목이 상자에 들어감,
 * 날짜가 되면 「오늘의 복습」 카드, 복습 문제(칸 이동 표시), 끝 화면, 한 번 더(상자 그대로), 졸업, 하루 최대 개수, 틀린 단어 표시와 따로.
 * 사용: node test/e2e-review.js "<단원 데이터 폴더>" "<스크린샷 폴더>"
 */
"use strict";
var fs = require("fs");
var path = require("path");
var cp = require("child_process");
var http = require("http");

var dataDir = process.argv[2], shotDir = process.argv[3];
if (!dataDir || !shotDir) { console.error("단원 데이터 폴더와 스크린샷 폴더를 주세요"); process.exit(2); }
fs.mkdirSync(shotDir, { recursive: true });
var edge = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"].filter(fs.existsSync)[0];
var index = process.env.APP_URL || ("file:///" + path.join(__dirname, "..", "index.html").replace(/\\/g, "/"));
var port = 9343;
var profile = path.join(shotDir, "profile-review-" + Date.now());
var proc = cp.spawn(edge, ["--headless=new", "--disable-gpu", "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "--window-size=900,1250", "about:blank"], { stdio: "ignore" });

var fails = 0;
function check(c, m) { console.log((c ? "통과: " : "실패: ") + m); if (!c) fails++; }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function getJson(url) {
  return new Promise(function (res, rej) {
    http.get(url, function (r) { var b = ""; r.on("data", function (d) { b += d; }); r.on("end", function () { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on("error", rej);
  });
}
var files = fs.readdirSync(dataDir);
function load(re) {
  var d = JSON.parse(fs.readFileSync(path.join(dataDir, files.filter(function (f) { return re.test(f); })[0]), "utf8"));
  ["words", "vocab", "chunks"].forEach(function (k) { (d[k] || []).forEach(function (x) { delete x.weak; }); });
  return d;
}
var B5 = load(/^B_단어_TrackA-Book3_L05/), B6 = load(/^B_단어_TrackA-Book3_L06/), BC = load(/^B_chunk_L05-06/);

(async function () {
  var targets;
  for (var i = 0; i < 40; i++) { try { targets = await getJson("http://127.0.0.1:" + port + "/json"); if (targets.length) break; } catch (e) {} await sleep(250); }
  var page = targets.filter(function (t) { return t.type === "page"; })[0];
  var ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(function (r) { ws.onopen = r; });
  var id = 0, pending = {};
  ws.onmessage = function (m) { var d = JSON.parse(m.data); if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; } };
  function send(method, params) { return new Promise(function (r) { var n = ++id; pending[n] = r; ws.send(JSON.stringify({ id: n, method: method, params: params || {} })); }); }
  async function ev(expr) {
    var r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails));
    return r.result.result.value;
  }
  async function shot(name) {
    await sleep(250);
    var r = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(shotDir, name + ".png"), Buffer.from(r.result.data, "base64"));
  }
  async function open() {
    await send("Page.navigate", { url: "about:blank" });
    await sleep(200);
    await send("Page.navigate", { url: index });
    for (var w = 0; w < 50; w++) { await sleep(200); try { if (await ev("location.protocol!=='about:'&&document.readyState==='complete'&&!!window.WT&&!!document.getElementById('lessonList')")) break; } catch (e) {} }
    await sleep(400);
    await ev("window.confirm=function(){return true}");
  }
  var T = function (sel) { return ev("(function(){var n=document.querySelector(" + JSON.stringify(sel) + ");return n?n.textContent:''})()"); };
  var click = function (sel) { return ev("document.querySelector(" + JSON.stringify(sel) + ").click()"); };
  var idOf = function (re) { return ev("WT.store.list().filter(function(x){return " + re + ".test(x.id)})[0].id"); };
  // 상자의 모든 항목을 오늘 복습할 날짜로 당긴다(날짜가 지난 것처럼)
  var makeDue = function () { return ev("(function(){var b=JSON.parse(localStorage.getItem('wp.box.v1')||'{}');Object.keys(b).forEach(function(id){Object.keys(b[id]).forEach(function(k){if(b[id][k].due)b[id][k].due='2000-01-01'})});localStorage.setItem('wp.box.v1',JSON.stringify(b))})()"); };
  // 지금 문제에 답한다(ok=false 면 틀린 답)
  var answer = function (ok) { return ev("(function(){var c=WT.study._current();var it=c.review?c.list[c.i].item:c.deck.current();c.inputs.forEach(function(inp,k){inp.value=it.answers[k]+(" + (ok ? "''" : "'zz'") + ");});document.getElementById('btnCheck').click();return it.key})()"); };
  var boxB = function (lid, key) { return ev("(function(){var e=WT.store.boxOf(" + JSON.stringify(lid) + "," + JSON.stringify(key) + ");return e?e.b:0})()"); };

  await send("Page.enable");
  await send("Runtime.enable");
  await open();
  await ev("localStorage.clear()");
  await ev("WT.store.importText(" + JSON.stringify(JSON.stringify([B5, B6, BC])) + ",'점검').errors.length");
  await open();
  var id5 = await idOf("/아이 B.*L5/"), id6 = await idOf("/아이 B.*L6/"), idc = await idOf("/^chunk/");

  // 1) 빈 상자
  check(/오늘의 복습/.test(await T("#reviewBox")) && /아직 상자가 비어 있어요/.test(await T("#reviewBox")), "상자가 비면 「🔁 오늘의 복습 · 아직 상자가 비어 있어요」(접힌 안내)");
  check(!(await ev("!!document.getElementById('btnReviewStart')")), "빈 상자에는 「복습 시작」 버튼이 없음");
  await shot("r1_빈상자");

  // 2) 외우기 「첫 글자 힌트 쓰기」: 첫 문제는 틀리고 나머지는 맞힘
  await ev("localStorage.setItem('wp.study.v1',JSON.stringify({act:'hint',scope:'all'}))");
  await ev("(function(){var c=document.querySelector('#lessonList .card[data-id=\"'+" + JSON.stringify(id5) + "+'\"]');c.querySelector('button[data-b=study]').click()})()");
  await click("#btnStudyStart");
  var firstKey = null;
  for (var n = 0; n < 30; n++) {
    if (await ev("!document.getElementById('btnCheck')")) break;
    var k = await answer(n !== 0);
    if (n === 0) firstKey = k;
    await click("#btnNext");
  }
  check(await ev("!!document.getElementById('studySticker')"), "외우기를 끝까지 함");
  check((await boxB(id5, firstKey)) === 1, "처음 틀린 단어(" + firstKey + ")는 1칸(다시 나와 맞혀도 그대로)");
  var c2 = await ev("B5w=" + JSON.stringify(B5.words.map(function (w) { return w.word; })) + ";B5w.filter(function(w){return WT.store.boxOf(" + JSON.stringify(id5) + ",w)&&WT.store.boxOf(" + JSON.stringify(id5) + ",w).b===2}).length");
  check(c2 === 9, "처음에 맞힌 9개는 2칸");
  await ev("document.getElementById('btnStudyClose').click()");
  await sleep(200);
  var rv = await T("#reviewBox");
  check(/오늘은 복습할 단어가 없어요/.test(rv) && /다음: 내일 1개/.test(rv), "오늘 넣은 단어는 오늘 복습에 안 나오고 「다음: 내일 1개」");
  check((await ev("Array.from(document.querySelectorAll('#reviewBox .rbox b')).map(function(b){return b.textContent}).join(',')")) === "1,9,0,0,0", "상자 칸 숫자 1,9,0,0,0");

  // 3) 태블릿 시험에서 처음 답한 항목도 상자에 들어감(L6, 모두 맞힘)
  await ev("(function(){var c=document.querySelector('#lessonList .card[data-id=\"'+" + JSON.stringify(id6) + "+'\"]');c.querySelector('button[data-b=make]').click()})()");
  await sleep(500);
  await ev("document.getElementById('btnSolve').click()");
  await sleep(300);
  await ev("(function(){var q=WT.solve._current().quiz;q.items.forEach(function(it,i){var card=document.querySelector('#solveBody .qcard[data-i=\"'+i+'\"]');" +
    "if(it.type==='mcq'){card.querySelector('button.opt[data-k=\"'+it.answer+'\"]').click();return;}" +
    "card.querySelectorAll('input.ans').forEach(function(inp,k){inp.value=it.answers[k];inp.dispatchEvent(new Event('input',{bubbles:true}));});});})()");
  await ev("document.getElementById('btnSolveGrade').click()");
  await sleep(300);
  var n6 = await ev("WT.store.boxEntries(WT.store.list()).filter(function(e){return e.id===" + JSON.stringify(id6) + "&&e.b===2}).length");
  check(n6 === 10, "태블릿 시험에서 다 맞힌 L6 단어 10개가 2칸에 들어감");
  await ev("Array.from(document.querySelectorAll('#solveTop button')).filter(function(b){return b.textContent==='닫기'})[0].click()");
  await ev("document.querySelector('#tabs button[data-tab=lessons]').click()");

  // 4) 날짜가 되면 오늘의 복습
  await makeDue();
  await open();
  check(/🔁 오늘의 복습/.test(await T("#reviewBox")) && (await T("#reviewCount")) === "20개" && /복습 시작 \(20개\)/.test(await T("#btnReviewStart")), "날짜가 된 항목 20개: 「🔁 오늘의 복습 20개」, 「복습 시작 (20개)」");
  check((await ev("Array.from(document.querySelectorAll('#reviewBox .rbox.due')).map(function(b){return b.getAttribute('data-b')}).join(',')")) === "1,2", "오늘 볼 칸(1칸·2칸)이 칠해짐");
  await shot("r2_오늘의복습");
  await click("#btnReviewStart");
  await sleep(200);
  check(!(await ev("document.getElementById('study').hidden")) && /오늘의 복습/.test(await T("#studyTitle")) && /1 \/ 20/.test(await T("#studySub")), "복습 화면이 열리고 「1 / 20」");
  check(/1칸에서 온 단어/.test(await T("#reviewFrom")), "1칸 단어가 먼저 나옴(「Lesson 5 · 1칸에서 온 단어」)");
  check(!/[가-힣]/.test(await ev("document.querySelector('#studyCard .fmean').textContent")), "단어 문제에는 영문 뜻만(한글 뜻 없음)");
  await answer(true);
  check(/1칸 → 2칸 · 다음 복습 2일 뒤|2칸으로 올라감 · 다음 복습 2일 뒤/.test(await T("#reviewMove")), "맞히면 「1 → 2 · 2칸으로 올라감 · 다음 복습 2일 뒤」");
  await shot("r3_맞힘");
  await click("#btnNext");
  var wrongKey = await answer(false);
  check(/1칸으로 돌아감 · 내일 다시/.test(await T("#reviewMove")), "틀리면 「1칸으로 돌아감 · 내일 다시」");
  await shot("r4_틀림");
  await click("#btnNext");
  for (var m = 0; m < 25; m++) {
    if (await ev("!document.getElementById('btnCheck')")) break;
    await answer(true);
    await click("#btnNext");
  }
  check((await T("#rvUp")) === "19" && (await T("#rvDown")) === "1" && (await T("#rvGrad")) === "0", "끝 화면: 올라감 19, 1칸으로 1, 졸업 0");
  check(await ev("!!document.getElementById('studySticker')"), "복습을 끝내면 스티커");
  var wrongSrc = await ev("WT.study._current().results.filter(function(x){return !x.ok})[0].q.id");
  check((await boxB(wrongSrc, wrongKey)) === 1 && !(await ev("WT.store.isWeak(" + JSON.stringify(wrongSrc) + "," + JSON.stringify(wrongKey) + ")")), "복습에서 틀린 단어는 1칸으로 가고, 틀린 단어 표시(약한 목록)에는 넣지 않음");
  await shot("r5_끝");

  // 5) 틀린 것 한 번 더: 상자는 그대로
  await click("#btnReviewAgain");
  check(/한 번 더/.test(await T("#studyTitle")) && /연습 · 상자는 그대로/.test(await T("#studySub")), "「틀린 1개 한 번 더」는 연습(상자는 그대로)");
  await answer(true);
  check(!(await ev("!!document.getElementById('reviewMove')")) && (await boxB(wrongSrc, wrongKey)) === 1, "연습에서 맞혀도 칸이 움직이지 않음");
  await click("#btnNext");
  await click("#btnReviewClose");
  await sleep(200);
  rv = await T("#reviewBox");
  check(/✅ 오늘 복습 끝!/.test(rv) && await ev("!!document.getElementById('btnReviewMore')"), "단원 화면 카드가 「✅ 오늘 복습 끝!」, 「한 번 더 (상자는 그대로)」 버튼");
  await shot("r6_오늘끝");

  // 6) 졸업과 chunk 문제(하루 개수는 새로 시작한 것으로)
  await ev("localStorage.removeItem('wp.boxday.v1')");
  await ev("(function(){var o={};o['v|'+" + JSON.stringify(BC.vocab[0].word) + "]=true;WT.store.boxEnter(" + JSON.stringify(idc) + ",o);var b=JSON.parse(localStorage.getItem('wp.box.v1'));b[" + JSON.stringify(idc) + "]['v|'+" + JSON.stringify(BC.vocab[0].word) + "]={b:5,due:'2000-01-01',at:new Date().toISOString()};localStorage.setItem('wp.box.v1',JSON.stringify(b))})()");
  await open();
  check((await T("#reviewCount")) === "1개", "5칸 chunk 항목 1개가 오늘의 복습에(오늘 복습한 단어는 날짜가 아직 안 됨)");
  await click("#btnReviewStart");
  check(/5칸에서 온 Key Vocabulary/.test(await T("#reviewFrom")) && /[가-힣]/.test(await ev("document.querySelector('#studyCard .fmean').textContent")), "chunk 문제는 「5칸에서 온 Key Vocabulary」, 한글 뜻은 그대로 보임");
  await answer(true);
  check(/졸업! 이제 복습에 안 나와요/.test(await T("#reviewMove")), "5칸에서 맞히면 「졸업! 이제 복습에 안 나와요」");
  await click("#btnNext");
  check((await T("#rvGrad")) === "1", "끝 화면 졸업 1");
  await click("#btnReviewClose");
  await sleep(200);
  check(/🎓 졸업 1개/.test(await T("#reviewBox")), "단원 화면 카드에 「🎓 졸업 1개」");

  // 7) 하루 최대 20개: 오늘 20개를 했으면 밀린 것은 내일로
  await makeDue();
  await ev("(function(){var k=[];for(var i=0;i<20;i++)k.push('x'+i);localStorage.setItem('wp.boxday.v1',JSON.stringify({'아이 B':{date:WT.store.today(),keys:k}}))})()");
  await open();
  rv = await T("#reviewBox");
  check(!(await ev("!!document.getElementById('btnReviewStart')")) && /20개까지 했어요. 남은 \d+개는 내일 나와요/.test(rv), "하루 20개를 넘으면 「오늘은 20개까지 했어요. 남은 n개는 내일 나와요」");
  await shot("r7_하루최대");

  ws.close();
  proc.kill();
  console.log(fails === 0 ? "오늘의 복습 점검 모두 통과" : "실패 " + fails + "건");
  process.exit(fails === 0 ? 0 : 1);
})().catch(function (e) { console.error("점검 중 오류: " + e.message); try { proc.kill(); } catch (x) {} process.exit(1); });
