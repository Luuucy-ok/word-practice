/* 앱 영어 자판 점검: 시험·외우기 입력칸에서 기기 키보드 대신 앱 자판이 뜨는지(inputmode=none), 글자·대문자·띄어쓰기·지우기·확인 키,
 * 화면이 바뀌거나 닫히면 자판이 내려가는지, 설정의 「키보드 확인」 칸은 기기 키보드 그대로인지, 설정으로 끌 수 있는지 확인한다.
 * 사용: node test/e2e-kbd.js "<단원 데이터 폴더>" "<스크린샷 폴더>"
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
var port = 9341;
var profile = path.join(shotDir, "profile-kbd-" + Date.now());
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
var W = load(/^B_단어.*L07/);
var FAKE_SPEECH = "(function(){var v={name:'Fake',lang:'en-US',localService:true};var s={getVoices:function(){return [v]},speak:function(){},cancel:function(){},addEventListener:function(){}};" +
  "Object.defineProperty(window,'speechSynthesis',{value:s,configurable:true});window.SpeechSynthesisUtterance=function(t){this.text=t};})();";

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
    for (var w = 0; w < 50; w++) { await sleep(200); try { if (await ev("location.protocol!=='about:'&&document.readyState==='complete'&&!!window.WT&&!!WT.kbd")) break; } catch (e) {} }
    await sleep(400);
    await ev("window.confirm=function(){return true}");
  }
  var T = function (sel) { return ev("document.querySelector(" + JSON.stringify(sel) + ").innerText"); };
  var click = function (sel) { return ev("document.querySelector(" + JSON.stringify(sel) + ").click()"); };
  var shown = function () { return ev("(function(){var k=document.getElementById('kbd');return !!k&&!k.hidden})()"); };
  function clickCard(text, btn) {
    return ev("(function(){var c=Array.from(document.querySelectorAll('#lessonList .card')).filter(function(x){return x.textContent.indexOf(" + JSON.stringify(text) + ")>=0})[0];" +
      "Array.from(c.querySelectorAll('button')).filter(function(x){return x.textContent===" + JSON.stringify(btn) + "})[0].click();return true})()");
  }
  // 앱 자판의 버튼을 눌러 글자를 쓴다(대문자는 ⇧ 다음 글자).
  function typeKeys(text) {
    return ev("(function(t){function k(n){document.querySelector('#kbd button[data-key=\"'+n+'\"]').click();}" +
      "t.split('').forEach(function(ch){if(ch===' ')k('space');else if(/[A-Z]/.test(ch)){k('shift');k(ch.toLowerCase());}else k(ch);});" +
      "return document.activeElement.value})(" + JSON.stringify(text) + ")");
  }
  var cur = function (expr) { return ev("(function(){var c=WT.study._current();return " + expr + "})()"); };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: FAKE_SPEECH });
  // 화면 없이 돌리면 창에 포커스가 없어 focus 이벤트가 오지 않으므로, 포커스가 있는 것처럼 흉내 낸다.
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await open();
  await ev("localStorage.clear()");
  await ev("WT.store.importText(" + JSON.stringify(JSON.stringify([W])) + ",'점검').errors.length");
  await open();
  var wTitle = "단어 Lesson " + W.lesson;

  // 1) 설정 기본값
  check(await ev("document.getElementById('appKbd').checked"), "설정: 「앱 영어 자판 쓰기」가 처음에 켜져 있음");
  check(!(await shown()), "처음에는 자판이 보이지 않음");

  // 2) 외우기 듣고 쓰기: 입력칸을 열면 앱 자판
  await clickCard(wTitle, "외우기");
  await click("#studyBody button.act[data-act=listen]");
  await click("#btnStudyStart");
  await sleep(200);
  check((await ev("document.querySelector('#studyBody input.ans').getAttribute('inputmode')")) === "none", "외우기 입력칸은 기기 키보드를 띄우지 않음(inputmode=none)");
  check((await shown()) && (await ev("WT.kbd._target()===document.querySelector('#studyBody input.ans')")), "문제가 나오면 앱 자판이 뜨고 그 입력칸에 씀");
  check(/확인/.test(await T("#kbd button[data-key=enter]")) && !(await ev("!!document.querySelector('#kbd .suggest')")), "자판에는 추천 줄이 없고, 외우기에서는 「확인 ↵」 키");
  var ans = await cur("c.deck.current().answers[0]");
  var typed = await typeKeys("Ab c");
  check(typed === "Ab c", "글자 키, ⇧(한 글자만 대문자), 띄어쓰기: 「Ab c」");
  await click("#kbd button[data-key=back]");
  await click("#kbd button[data-key=back]");
  check((await ev("document.activeElement.value")) === "Ab", "⌫ 로 한 글자씩 지움");
  await ev("(function(){var i=document.activeElement;i.setSelectionRange(0,i.value.length)})()");
  await click("#kbd button[data-key=back]");
  check((await ev("document.activeElement.value")) === "", "글자를 골라 둔 상태에서 ⌫ 는 고른 부분을 지움");
  await typeKeys(ans);
  check((await ev("document.querySelector('#studyBody input.ans').value")) === ans, "정답(" + ans + ")을 자판으로 씀");
  await shot("k1_외우기_자판");
  await click("#kbd button[data-key=enter]");
  await sleep(150);
  check(/맞았어요/.test(await T("#studyFix")), "「확인 ↵」 키로 채점됨");
  check(!(await shown()), "채점 뒤 「다음」 버튼으로 넘어가면 자판이 내려감");
  await click("#btnNext");
  await sleep(200);
  check((await shown()) && (await ev("WT.kbd._target()===document.querySelector('#studyBody input.ans')")), "다음 문제에서 다시 자판이 뜨고 새 입력칸에 씀");
  await click("#kbd button[data-key=hide]");
  check(!(await shown()), "「내리기」 키로 자판을 내림");
  await ev("document.querySelector('#studyBody input.ans').focus()");
  check(await shown(), "입력칸을 다시 누르면 자판이 뜸");
  await click("#btnStudyClose");
  await sleep(100);
  check(!(await shown()), "외우기를 닫으면 자판이 내려감");

  // 3) 태블릿 시험: 「다음 ↵」 로 다음 칸, 쓴 답이 저장됨
  await clickCard(wTitle, "시험지 만들기");
  await sleep(500);
  await ev("document.getElementById('btnSolve').click()");
  await sleep(300);
  check((await ev("Array.from(document.querySelectorAll('#solveBody input.ans')).every(function(i){return i.getAttribute('inputmode')==='none'})")), "시험 입력칸도 모두 기기 키보드를 띄우지 않음");
  await ev("document.querySelector('#solveBody input.ans').focus()");
  check((await shown()) && /다음/.test(await T("#kbd button[data-key=enter]")), "시험 입력칸을 누르면 자판이 뜨고 「다음 ↵」 키");
  var first = await ev("document.querySelector('#solveBody input.ans')");
  await typeKeys("test");
  var savedIdx = await ev("(function(){var c=WT.solve._current();return c.answers.indexOf('test')})()");
  check(savedIdx >= 0, "자판으로 쓴 답이 시험 답으로 저장됨(이어 풀기 포함)");
  await click("#kbd button[data-key=enter]");
  check((await ev("document.activeElement===document.querySelectorAll('#solveBody input.ans')[1]")) && (await shown()), "「다음 ↵」 키로 다음 입력칸으로 가고 자판은 그대로");
  await shot("k2_시험_자판");
  await ev("document.getElementById('btnSolveClose').click()");
  await sleep(100);
  check(!(await shown()), "시험 화면을 닫으면 자판이 내려감");

  // 4) 설정의 「키보드 확인」 칸은 기기 키보드 그대로
  await ev("document.querySelector('#tabs button[data-tab=settings]').click()");
  await ev("document.getElementById('kbdTest').focus()");
  check(!(await shown()) && !(await ev("document.getElementById('kbdTest').hasAttribute('inputmode')")), "설정의 「키보드 확인」 칸은 앱 자판을 쓰지 않음(기기 키보드 확인용)");

  // 5) 설정으로 끄기
  await ev("(function(){var c=document.getElementById('appKbd');c.checked=false;c.dispatchEvent(new Event('change'))})()");
  await ev("document.querySelector('#tabs button[data-tab=lessons]').click()");
  await clickCard(wTitle, "외우기");
  await click("#btnStudyStart");
  await sleep(200);
  check(!(await ev("document.querySelector('#studyBody input.ans').hasAttribute('inputmode')")) && !(await shown()), "앱 자판을 끄면 기기 키보드를 쓰고 앱 자판은 뜨지 않음");
  await click("#btnStudyClose");
  await open();
  check(!(await ev("document.getElementById('appKbd').checked")), "끈 설정이 새로 고침 뒤에도 남음");
  await ev("(function(){var c=document.getElementById('appKbd');c.checked=true;c.dispatchEvent(new Event('change'))})()");

  // 6) 꾸미기 테마에서 자판 모양
  await ev("(function(){var s=WT.store.settings();s.theme={_:'berry'};WT.store.saveSettings(s);WT.fun.apply()})()");
  await clickCard(wTitle, "외우기");
  await click("#btnStudyStart");
  await sleep(200);
  await typeKeys("ab");
  await shot("k3_딸기우유_자판");
  await click("#btnStudyClose");

  ws.close();
  proc.kill();
  console.log(fails === 0 ? "앱 자판 점검 모두 통과" : "실패 " + fails + "건");
  process.exit(fails === 0 ? 0 : 1);
})().catch(function (e) { console.error("점검 중 오류: " + e.message); try { proc.kill(); } catch (x) {} process.exit(1); });
