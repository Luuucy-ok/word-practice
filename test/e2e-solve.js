/* 태블릿에서 풀기 화면 점검: Edge 를 자동으로 열고, 시험지 만들기 → 태블릿에서 풀기 → 이어 풀기 → 채점 → 약한 목록 반영 →
 * 틀린 문항만 다시 풀기 → 재시험 연속 2번 맞히기 → chunk 풀기 → 키보드 확인까지 확인한다.
 * 사용: node test/e2e-solve.js "<단원 데이터 폴더>" "<스크린샷 폴더>"
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
var port = 9338;
var profile = path.join(shotDir, "profile-solve-" + Date.now());
var proc = cp.spawn(edge, ["--headless=new", "--disable-gpu", "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "--window-size=1000,1300", "about:blank"], { stdio: "ignore" });

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
var W = load(/^B_단어.*L07/);
var C = load(/^A_chunk.*L07-08/);

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
    var r = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(shotDir, name + ".png"), Buffer.from(r.result.data, "base64"));
  }
  async function open() {
    await send("Page.navigate", { url: "about:blank" });
    await sleep(200);
    await send("Page.navigate", { url: index });
    await sleep(1200);
    await ev("window.confirm=function(){return true}");
  }
  var T = function (sel) { return ev("document.querySelector(" + JSON.stringify(sel) + ").innerText"); };
  var H = function (sel) { return ev("document.querySelector(" + JSON.stringify(sel) + ").hidden"); };
  function clickCard(text, btn) {
    return ev("(function(){var c=Array.from(document.querySelectorAll('#lessonList .card')).filter(function(x){return x.innerText.indexOf(" + JSON.stringify(text) + ")>=0})[0];" +
      "Array.from(c.querySelectorAll('button')).filter(function(x){return x.textContent===" + JSON.stringify(btn) + "})[0].click();return true})()");
  }
  function cardText(text) { return ev("Array.from(document.querySelectorAll('#lessonList .card')).filter(function(x){return x.innerText.indexOf(" + JSON.stringify(text) + ")>=0})[0].textContent"); } // 펼치는 칸 안 글자까지
  // 화면의 입력칸에 글자를 넣는다(키보드로 친 것처럼 input 이벤트를 보낸다). wrongAt 문항은 일부러 틀리게 쓴다.
  function fillAll(opt) {
    return ev("(function(o){var cur=WT.solve._current();var q=cur.quiz;q.items.forEach(function(it,i){" +
      "var card=document.querySelector('#solveBody .qcard[data-i=\"'+i+'\"]');var skip=(o.skip||[]).indexOf(i)>=0;if(skip)return;var bad=(o.wrong||{})[i];" +
      "if(it.type==='mcq'){var k=(typeof bad==='string'&&bad.indexOf('swap')===0)?q.items[Number(bad.slice(4))].answer:it.answer;card.querySelector('button.opt[data-k=\"'+k+'\"]').click();return;}" +
      "var ins=card.querySelectorAll('input.ans');" +
      "ins.forEach(function(inp,k){var v=it.answers[k];if(bad&&k===0){v=bad==='cap'?(v.charAt(0).toUpperCase()===v.charAt(0)?v.toLowerCase():v.charAt(0).toUpperCase()+v.slice(1)):(bad==='drop'?v.slice(0,-1):bad);}inp.value=v;inp.dispatchEvent(new Event('input',{bubbles:true}));});" +
      "});return q.items.length})(" + JSON.stringify(opt || {}) + ")");
  }


  // 단어 시험지는 「전체 쓰기」가 기본이라, 학원 시험 모양(10문항·100점)을 보는 점검은 종류 버튼으로 바꾼다.
  async function toRegular() {
    await ev("document.querySelector('.seg[data-for=wMode] button[data-v=regular]').click()");
    await sleep(400);
  }
  await send("Page.enable");
  await send("Runtime.enable");
  await open();
  await ev("localStorage.clear()");
  await ev("WT.store.importText(" + JSON.stringify(JSON.stringify([W, C])) + ",'점검').errors.length");
  await open();
  var wTitle = "단어 Lesson " + W.lesson;

  // 1) 시험지 만들기 → 태블릿에서 풀기
  await clickCard(wTitle, "시험지"); await toRegular();
  await sleep(500);
  check(!(await ev("document.getElementById('btnSolve').disabled")), "시험지를 만들면 「태블릿에서 풀기」 버튼이 켜짐");
  await ev("document.getElementById('btnSolve').click()");
  await sleep(300);
  check(!(await H("#solve")) && (await ev("document.querySelectorAll('#solveBody .qcard').length")) === 10, "푸는 화면이 열리고 10문항이 나옴");
  var attrs = await ev("Array.from(document.querySelectorAll('#solveBody input.ans')).every(function(i){return i.getAttribute('autocapitalize')==='off'&&i.getAttribute('autocorrect')==='off'&&i.getAttribute('spellcheck')==='false'&&i.getAttribute('autocomplete')==='off'})");
  check(attrs, "모든 입력칸에서 자동 대문자·자동 수정·맞춤법 검사·자동 완성을 끔");
  var sameAsPaper = await ev("(function(){var q=WT.solve._current().quiz;var html=document.getElementById('sheet').srcdoc;var pos=q.items.filter(function(x){return x.type==='write'}).map(function(x){return html.indexOf(WT.util.esc(x.prompt))});return pos.every(function(p,i){return p>0&&(i===0||p>pos[i-1])})})()");
  check(sameAsPaper, "화면 문항이 지금 만든 종이 시험지와 같은 순서");
  check(!/정답|Answer Key/.test(await T("#solveBody")), "푸는 화면에는 정답이 보이지 않음");
  await shot("v1_푸는화면");

  // 2) 이어 풀기: 한 문항 쓰고 닫았다가 다시 열기
  await ev("(function(){var inp=document.querySelector('#solveBody .qcard[data-i=\"0\"] input.ans');inp.value='zzz';inp.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await ev("document.getElementById('btnSolveClose').click()");
  check(await H("#solve"), "닫으면 푸는 화면이 닫힘");
  await open(); // 새로 고침해도 남는지
  await clickCard(wTitle, "시험지"); await toRegular();
  await sleep(400);
  // 새 번호로 만들면 다른 시험이므로 이어 풀지 않는다
  await ev("document.getElementById('btnSolve').click()");
  check((await ev("document.querySelector('#solveBody .qcard[data-i=\"0\"] input.ans').value")) === "", "다른 시험지 번호로 열면 이전 답을 불러오지 않음");
  await ev("document.getElementById('btnSolveClose').click()");
  var seed = await ev("WT.store && (function(){return document.getElementById('makeInfo').innerText.match(/시험지 번호 (\\d+)/)[1]})()");
  await ev("(function(){var inp=document.getElementById('optSeed');inp.value='" + seed + "';inp.dispatchEvent(new Event('change'));})()");
  await sleep(300);
  await ev("document.getElementById('btnSolve').click()");
  await ev("(function(){var inp=document.querySelector('#solveBody .qcard[data-i=\"1\"] input.ans');inp.value='keep';inp.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await ev("document.getElementById('btnSolveClose').click()");
  await open();
  await clickCard(wTitle, "시험지"); await toRegular();
  await sleep(300);
  await ev("(function(){var inp=document.getElementById('optSeed');inp.value='" + seed + "';inp.dispatchEvent(new Event('change'));})()");
  await sleep(300);
  await ev("document.getElementById('btnSolve').click()");
  check((await ev("document.querySelector('#solveBody .qcard[data-i=\"1\"] input.ans').value")) === "keep" && /불러왔어요/.test(await T("#solveTop")), "같은 시험지(같은 번호)를 다시 열면 새로 고침 뒤에도 풀던 답을 이어서 불러옴");

  // 3) 채점: 쓰기 1개 대소문자 틀림, 보기 번호 1개 틀림 → 80점
  // 보기 번호 7·8번은 서로의 답을 고른다(보기는 한 번씩만 쓰므로, 시험지 번호와 상관없이 항상 둘 다 틀린 결과가 된다).
  await fillAll({ wrong: { 1: "cap", 7: "swap8", 8: "swap7" } });
  await shot("v2_다씀");
  await ev("document.getElementById('btnSolveGrade').click()");
  await sleep(300);
  var top = await T("#solveTop");
  check(/70 \/ 100점/.test(top) && /맞힌 문항 7 \/ 10/.test(top), "채점: 70 / 100점, 맞힌 문항 7 / 10");
  check((await ev("document.querySelectorAll('#solveBody .mark.o').length")) === 7 && (await ev("document.querySelectorAll('#solveBody .mark.x').length")) === 3, "맞힌 문항 7개에 빨간 동그라미, 틀린 문항 3개에 ✕");
  var fix = await ev("document.querySelector('#solveBody .qcard[data-i=\"1\"] .qfix').innerText");
  check(/내 답/.test(fix) && /정답/.test(fix) && /대소문자가 달라요/.test(fix), "틀린 쓰기 문항에 내 답, 정답, 이유(대소문자)가 나옴");
  check(/다른 번호를 골랐어요/.test(await ev("document.querySelector('#solveBody .qcard[data-i=\"7\"] .qfix').innerText")), "틀린 보기 번호 문항에 이유가 나옴");
  check(/약한 목록에 넣었어요/.test(top), "틀린 단어를 약한 목록에 넣었다고 알려 줌");
  check(await ev("Array.from(document.querySelectorAll('#solveBody input.ans')).every(function(i){return i.readOnly})"), "채점 뒤에는 답을 고칠 수 없음");
  check((await ev("localStorage.getItem('wp.draft.v1')")) === null, "채점하면 풀던 답 임시 저장을 지움");
  await shot("v3_채점결과");

  // 4) 틀린 문항만 다시 풀기(연습, 기록 안 함)
  await ev("Array.from(document.querySelectorAll('#solveTop button')).filter(function(b){return b.textContent==='틀린 문항만 다시 풀기'})[0].click()");
  await sleep(200);
  check((await ev("document.querySelectorAll('#solveBody .qcard').length")) === 3 && /다시 풀기/.test(await T("#solveTitle")), "틀린 3문항만 다시 풀 수 있음");
  await fillAll({});
  await ev("document.getElementById('btnSolveGrade').click()");
  check(/30 \/ 30점/.test(await T("#solveTop")) && /기록과 약한 목록에는 넣지 않았어요/.test(await T("#solveTop")), "다시 풀기는 연습이라 기록과 약한 목록에 넣지 않는다고 알려 줌");
  await ev("Array.from(document.querySelectorAll('#solveTop button')).filter(function(b){return b.textContent==='닫기'})[0].click()");
  await ev("document.querySelector('#tabs button[data-tab=lessons]').click()");
  var card = await cardText(wTitle);
  check(/틀린 항목 3개/.test(card) && /최근 점수: 70\/100/.test(card), "단원 카드에 「틀린 항목 3개」와 「최근 점수: 70/100」이 보임");

  // 5) 약한 단어만 재시험을 연속 2번 맞히면 약한 목록에서 빠짐
  for (var round = 1; round <= 2; round++) {
    await clickCard(wTitle, "시험지"); await toRegular();
    await sleep(300);
    await ev("document.getElementById('wWeak').click()");
    await sleep(300);
    await ev("document.getElementById('btnSolve').click()");
    var n = await ev("document.querySelectorAll('#solveBody .qcard').length");
    await fillAll({});
    await ev("document.getElementById('btnSolveGrade').click()");
    var t2 = await T("#solveTop");
    if (round === 1) check(n === 3 && /한 번 더 맞히면 빠져요/.test(t2), "약한 단어 재시험(3문항)을 다 맞히면 「한 번 더 맞히면 빠져요」");
    else check(/연속 2번 맞혀서 약한 목록에서 뺐어요/.test(t2), "두 번째로 다 맞히면 약한 목록에서 뺐다고 알려 줌");
    await ev("Array.from(document.querySelectorAll('#solveTop button')).filter(function(b){return b.textContent==='닫기'})[0].click()");
    await ev("document.querySelector('#tabs button[data-tab=lessons]').click()");
  }
  card = await cardText(wTitle);
  check(!/틀린 항목/.test(card) && /재시험/.test(card), "약한 목록이 비고, 최근 점수에 재시험 기록이 남음");
  await shot("v4_카드기록");

  // 6) chunk 풀기: 첫 글자 힌트, 콜로케이션 1칸 대소문자 틀림 → 19점, 이유는 영어 표현
  await clickCard(C.title || "Chunk Quiz", "시험지");
  await sleep(400);
  check((await ev("document.getElementById('cMode').value")) === "full", "chunk 시험지는 「범위 전체」가 기본");
  // 학원 시험 모양(20점) 채점을 보려고 종류 버튼으로 바꾼다
  await ev("document.querySelector('.seg[data-for=cMode] button[data-v=sample]').click()");
  await sleep(300);
  await ev("(function(){var s=document.getElementById('cHint');s.value='first';s.dispatchEvent(new Event('change'));})()");
  await sleep(300);
  await ev("document.getElementById('btnSolve').click()");
  var types = await ev("WT.solve._current().quiz.items.map(function(x){return x.type}).join(',')");
  check(types === "colloc,colloc,colloc,colloc,colloc,colloc,chunk,chunk,chunk,fill,fill", "chunk 문항: Key Vocabulary 6 + Chunk 3 + Fill 2");
  check(/첫 글자 힌트/.test(await T("#solveBody")) && (await ev("document.querySelectorAll('#solveBody .sbank span').length")) >= 3, "Fill 에 첫 글자 힌트, Chunk 위에 보기 박스가 나옴");
  await shot("v5_chunk");
  await fillAll({ wrong: { 0: "cap" } });
  await ev("document.getElementById('btnSolveGrade').click()");
  check(/19 \/ 20점/.test(await T("#solveTop")) && /capitalization error/.test(await ev("document.querySelector('#solveBody .qcard[data-i=\"0\"] .qfix').innerText")), "chunk 채점: 19 / 20점, 틀린 이유는 「capitalization error」");
  await ev("Array.from(document.querySelectorAll('#solveTop button')).filter(function(b){return b.textContent==='닫기'})[0].click()");

  // 7) 키보드 확인
  await ev("document.querySelector('#tabs button[data-tab=settings]').click()");
  await ev("(function(){var i=document.getElementById('kbdTest');i.value='American';i.dispatchEvent(new Event('input'));})()");
  check(/자동 대문자/.test(await T("#kbdMsg")), "키보드 확인: 첫 글자가 대문자로 바뀌면 끄라고 알려 줌");
  await ev("(function(){var i=document.getElementById('kbdTest');i.value='american';i.dispatchEvent(new Event('input'));})()");
  check(/정상이에요/.test(await T("#kbdMsg")), "키보드 확인: 그대로 써지면 정상");

  // 8) 백업에 기록이 들어감
  var bk = JSON.parse(await ev("WT.store.exportAll()"));
  check(Array.isArray(bk.results) && bk.results.length === 4, "백업 파일에 화면 시험 기록이 들어감(" + (bk.results || []).length + "개, 다시 풀기 연습은 제외)");

  ws.close();
  proc.kill();
  console.log(fails === 0 ? "태블릿 풀기 화면 점검 모두 통과" : "실패 " + fails + "건");
  process.exit(fails === 0 ? 0 : 1);
})().catch(function (e) { console.error("점검 중 오류: " + e.message); try { proc.kill(); } catch (x) {} process.exit(1); });
