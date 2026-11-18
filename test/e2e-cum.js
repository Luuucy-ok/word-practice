/* 누적 시험지 화면 점검: 종류 머리말의 「📚 누적 시험지」 버튼, 단원 고르기(시험 끝 단원은 처음부터 체크), 문제 수(약한 것 먼저),
 * 합친 시험지(단어 전체 쓰기, chunk 범위 전체), 문장 규칙이 다른 단원 거부, 태블릿에서 틀린 것은 원래 단원의 약한 목록으로.
 * 사용: node test/e2e-cum.js "<단원 데이터 폴더>" "<스크린샷 폴더>"
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
var port = 9342;
var profile = path.join(shotDir, "profile-cum-" + Date.now());
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
var B5 = load(/^B_단어_TrackA-Book3_L05/), B6 = load(/^B_단어_TrackA-Book3_L06/), A5 = load(/^A_단어_TrackA-Book3_L05/);
var BC1 = load(/^B_chunk_L05-06/), BC2 = load(/^B_chunk_L07-08/);
// 같은 아이(아이 B)인데 문장 규칙이 다른 단원(거부 점검용으로 규칙만 바꾼 사본)
var Bx = load(/^B_단어_TrackA-Book3_L08/);
Bx.sentence_sources = ["practice", "book"];

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
  var T = function (sel) { return ev("document.querySelector(" + JSON.stringify(sel) + ").innerText"); };
  var click = function (sel) { return ev("document.querySelector(" + JSON.stringify(sel) + ").click()"); };
  var idOf = function (re) { return ev("WT.store.list().filter(function(x){return " + re + ".test(x.id)})[0].id"); };
  var checkLesson = function (lid, on) { return ev("(function(){var c=document.querySelector('#dlgBody .cumlist input[data-id=\"" + lid.replace(/"/g, '\\"') + "\"]');if(c.checked!==" + on + "){c.checked=" + on + ";c.dispatchEvent(new Event('change'))}})()"); };

  await send("Page.enable");
  await send("Runtime.enable");
  await open();
  await ev("localStorage.clear()");
  await ev("WT.store.importText(" + JSON.stringify(JSON.stringify([B5, B6, A5, BC1, BC2])) + ",'점검').errors.length");
  await open();
  var id5 = await idOf("/아이 B.*L5/"), id6 = await idOf("/아이 B.*L6/");

  // 1) 머리말 버튼: 같은 아이 단원이 2개 이상인 종류에만
  check((await ev("document.querySelectorAll('h2.kindhead button.cumbtn').length")) === 2, "단어·Chunk 머리말에 「📚 누적 시험지」 버튼(아이 B 단원이 각각 2개 이상)");
  // 시험 끝 표시와 약한 표시를 해 둔다
  var weakWord = B6.words[2].word;
  await ev("WT.store.setDone(" + JSON.stringify(id5) + ", true); WT.store.setWeak(" + JSON.stringify(id6) + "," + JSON.stringify(weakWord) + ", true)");
  await open();
  await click("h2.kindhead.k-word button.cumbtn");
  await sleep(150);
  check(!(await ev("document.getElementById('dlg').hidden")) && /누적 시험지 · 단어 시험/.test(await T("#dlgTitle")), "버튼을 누르면 「📚 누적 시험지 · 단어 시험」 창이 열림");
  var rows = await ev("Array.from(document.querySelectorAll('#dlgBody .cumlist input')).map(function(c){return c.getAttribute('data-id')+'='+c.checked}).join(' | ')");
  check(rows.split(" | ").length === 2 && rows.indexOf(id5 + "=true") >= 0 && rows.indexOf(id6 + "=false") >= 0, "아이 B 단원만 나오고(단원이 1개뿐인 아이 A 는 누적 대상이 아님), 시험 끝난 L5 는 처음부터 체크");
  check(!(await ev("!!document.querySelector('#dlgBody .cumowner')")), "누적 시험지를 낼 수 있는 아이가 한 명이면 아이 고르기는 없음");
  await checkLesson(id6, true);
  check(/고른 단원 2개 · 단어 20개\(틀린 것 1개\) → 20개를 내요/.test(await T("#cumSummary")), "요약: 고른 단원 2개, 단어 20개(틀린 것 1개), 기본 20개");
  await click("#dlgBody .cumcount button[data-n='10']");
  check(/→ 10개를 내요/.test(await T("#cumSummary")), "문제 수 10개를 고르면 10개로 바뀜");
  await shot("c1_고르기");
  await click("#btnCumMake");
  await sleep(600);
  var title = await T("#makeTitle");
  var sheet = await ev("document.getElementById('sheet').srcdoc");
  check(/📚 Lesson 5·6 누적 복습 · 아이 B · 10개/.test(title) && /전체 쓰기 연습/.test(sheet) && /Lesson 5·6/.test(sheet), "시험지 탭에 「📚 Lesson 5·6 누적 복습 · 아이 B · 10개」 전체 쓰기 시험지가 나옴");
  check(sheet.indexOf(weakWord) >= 0, "틀린 단어(" + weakWord + ")가 먼저 들어감");
  check((await ev("document.querySelector('.seg[data-for=wMode]').hidden")) && (await ev("document.getElementById('wWeak').closest('.chipcheck').hidden")) && (await ev("document.getElementById('btnWeakEdit').hidden")), "누적 시험지에서는 종류 고르기·약한 것만·틀린 단어 표시하기를 숨김");
  check(/교재 대조 전|부모님용/.test(await ev("document.getElementById('makeInfo').textContent")) && !/규칙 점검에서 걸려|만들지 않았어요/.test(await ev("document.getElementById('makeInfo').textContent")), "규칙 점검을 통과해 시험지가 만들어짐");
  await shot("c2_시험지");

  // 2) 태블릿에서 풀기: 틀린 것은 원래 단원의 약한 목록으로
  await ev("document.getElementById('btnSolve').click()");
  await sleep(300);
  var wrong = await ev("(function(){var q=WT.solve._current().quiz;var wrongWord=null;q.items.forEach(function(it,i){var card=document.querySelector('#solveBody .qcard[data-i=\"'+i+'\"]');" +
    "if(it.type==='mcq'){card.querySelector('button.opt[data-k=\"'+it.answer+'\"]').click();return;}" +
    "card.querySelectorAll('input.ans').forEach(function(inp,k){var v=it.answers[k];if(!wrongWord&&it.type==='write'&&WT.study){wrongWord=it.word;v=v+'x';}inp.value=v;inp.dispatchEvent(new Event('input',{bubbles:true}));});});return wrongWord})()");
  await ev("document.getElementById('btnSolveGrade').click()");
  await sleep(300);
  var srcOfWrong = (B5.words.some(function (w) { return w.word === wrong; })) ? id5 : id6;
  check(!!wrong && (await ev("WT.store.isWeak(" + JSON.stringify(srcOfWrong) + "," + JSON.stringify(wrong) + ")")), "태블릿에서 틀린 단어(" + wrong + ")가 원래 단원의 약한 목록에 들어감");
  check(!(await ev("WT.store.isWeak(" + JSON.stringify(srcOfWrong === id5 ? id6 : id5) + "," + JSON.stringify(wrong) + ")")), "다른 단원 약한 목록에는 들어가지 않음");
  await ev("Array.from(document.querySelectorAll('#solveTop button')).filter(function(b){return b.textContent==='닫기'})[0].click()");

  // 3) 「전부」, 문장 규칙이 다른 단원 거부
  await ev("document.querySelector('#tabs button[data-tab=lessons]').click()");
  await ev("WT.store.importText(" + JSON.stringify(JSON.stringify([Bx])) + ",'점검')");
  await open();
  var idx = await idOf("/아이 B.*L8/");
  await click("h2.kindhead.k-word button.cumbtn");
  await checkLesson(id6, true);
  await click("#dlgBody .cumcount button[data-n='0']");
  check(/→ 20개를 내요/.test(await T("#cumSummary")), "「전부」면 고른 단원의 단어를 모두 냄(20개)");
  await checkLesson(idx, true);
  await click("#btnCumMake");
  check(!(await ev("document.getElementById('dlg').hidden")) && /문장 규칙.*다른 단원은 함께 낼 수 없어요/.test(await T("#cumMsg")), "문장 규칙이 다른 단원을 고르면 만들지 않고 이유를 알려 줌");
  await click("#dlgBody button:last-child");

  // 4) Chunk 누적: 범위 전체
  await click("h2.kindhead.k-chunk button.cumbtn");
  await ev("Array.from(document.querySelectorAll('#dlgBody .cumlist input')).forEach(function(c){if(!c.checked){c.checked=true;c.dispatchEvent(new Event('change'))}})");
  await click("#dlgBody .cumcount button[data-n='0']");
  var csum = await T("#cumSummary");
  await click("#btnCumMake");
  await sleep(600);
  var csheet = await ev("document.getElementById('sheet').srcdoc");
  check(/Chunk Quiz 누적 복습 \(5·6·7·8\)/.test(await T("#makeTitle")) && /Chunk Quiz 누적 복습/.test(csheet) && (await ev("document.getElementById('cMode').value")) === "full", "Chunk 누적: 「Chunk Quiz 누적 복습 (5·6·7·8)」 범위 전체 시험지(" + csum + ")");
  check((await ev("document.querySelector('.seg[data-for=cMode]').hidden")) && !/만들지 않았어요/.test(await ev("document.getElementById('makeInfo').textContent")), "Chunk 누적도 규칙 점검 통과, 종류 고르기는 숨김");
  await shot("c3_chunk누적");

  // 5) 보통 단원을 다시 열면 원래대로
  await ev("document.querySelector('#tabs button[data-tab=lessons]').click()");
  await ev("(function(){var c=Array.from(document.querySelectorAll('#lessonList .card')).filter(function(x){return x.textContent.indexOf('Lesson 6')>=0})[0];Array.from(c.querySelectorAll('button')).filter(function(b){return b.textContent==='시험지 만들기'})[0].click()})()");
  await sleep(500);
  check(!(await ev("document.querySelector('.seg[data-for=wMode]').hidden")) && !(await ev("document.getElementById('btnWeakEdit').hidden")) && !/누적/.test(await T("#makeTitle")), "보통 단원을 열면 종류 고르기 등이 다시 보이고 누적이 아님");
  await shot("c4_단원화면");
  await ev("document.querySelector('#tabs button[data-tab=lessons]').click()");
  await shot("c5_단원목록");

  ws.close();
  proc.kill();
  console.log(fails === 0 ? "누적 시험지 점검 모두 통과" : "실패 " + fails + "건");
  process.exit(fails === 0 ? 0 : 1);
})().catch(function (e) { console.error("점검 중 오류: " + e.message); try { proc.kill(); } catch (x) {} process.exit(1); });
