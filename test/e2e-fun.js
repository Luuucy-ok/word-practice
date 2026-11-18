/* 꾸미기 화면 점검: 테마 고르기와 저장, 글꼴, 진행 표시, 맞힘·틀림 효과음, 색종이, 스티커(외우기·시험), 효과음 끄기,
 * 단원 주인의 테마로 바뀌기, 백업 합치기, 인쇄 시험지는 꾸미지 않음을 확인하고 테마마다 스크린샷을 남긴다.
 * 기기 음성은 가짜로 바꾼다(소리는 나지 않음). 효과음은 WT.fun._played 에 남은 이름으로 확인한다.
 * 사용: node test/e2e-fun.js "<단원 데이터 폴더>" "<스크린샷 폴더>"
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
var port = 9340;
var profile = path.join(shotDir, "profile-fun-" + Date.now());
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
var W = load(/^B_단어.*L07/);   // 아이 B
var C = load(/^A_chunk.*L07-08/); // 아이 A

var FAKE_SPEECH = "(function(){window.__spoken=[];var v={name:'Fake English',lang:'en-US',localService:true};" +
  "var s={getVoices:function(){return [v]},speak:function(u){window.__spoken.push({text:u.text})},cancel:function(){},addEventListener:function(){}};" +
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
    await sleep(1200);
    await ev("window.confirm=function(){return true}");
  }
  var T = function (sel) { return ev("document.querySelector(" + JSON.stringify(sel) + ").innerText"); };
  var click = function (sel) { return ev("document.querySelector(" + JSON.stringify(sel) + ").click()"); };
  var theme = function () { return ev("document.documentElement.getAttribute('data-theme')"); };
  var played = function () { return ev("WT.fun._played.join(',')"); };
  function clickCard(text, btn) {
    return ev("(function(){var c=Array.from(document.querySelectorAll('#lessonList .card')).filter(function(x){return x.innerText.indexOf(" + JSON.stringify(text) + ")>=0})[0];" +
      "Array.from(c.querySelectorAll('button')).filter(function(x){return x.textContent===" + JSON.stringify(btn) + "})[0].click();return true})()");
  }
  var cur = function (expr) { return ev("(function(){var c=WT.study._current();return " + expr + "})()"); };
  function typeAns(how) {
    return ev("(function(h){var c=WT.study._current();var it=c.deck.current();c.inputs.forEach(function(inp,k){var v=it.answers[k];" +
      "if(h==='cap'&&k===0)v=(v.charAt(0).toUpperCase()===v.charAt(0)?v.charAt(0).toLowerCase():v.charAt(0).toUpperCase())+v.slice(1);" +
      "inp.value=v;});return it.word})(" + JSON.stringify(how) + ")");
  }
  function placeTiles() {
    return ev("(function(){var c=WT.study._current();var n=c.tiles.spec.tokens.length;for(var i=0;i<n;i++){" +
      "Array.from(document.querySelectorAll('#tilePool button.tile')).filter(function(x){return x.getAttribute('data-tile')===String(i)})[0].click();}})()");
  }
  function pick(code, name) { return ev("document.querySelector('#themeRows button[data-code=\"" + code + "\"][data-pick=\"" + name + "\"]').click()"); }
  function tab(name) { return ev("document.querySelector('#tabs button[data-tab=" + name + "]').click()"); }
  var stickerN = function (code) { return ev("WT.fun.stickers(" + JSON.stringify(code) + ").length"); };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: FAKE_SPEECH });
  await open();
  await ev("localStorage.clear()");
  await ev("WT.store.importText(" + JSON.stringify(JSON.stringify([W, C])) + ",'점검').errors.length");
  await open();
  var wTitle = "단어 Lesson " + W.lesson;
  var cTitle = C.title || "Chunk Quiz";

  // 1) 기본 상태와 꾸미기 카드
  check((await theme()) === null, "처음에는 기본 모양(테마 없음)");
  await tab("settings");
  var opts = await ev("Array.from(document.querySelectorAll('#themeRows button')).map(function(b){return b.getAttribute('data-pick')}).join()");
  check(opts === "basic,pastel,berry,star" && /이 기기/.test(await T("#themeRows")), "설정 「꾸미기」: 연결 안 한 기기는 「이 기기」 한 줄에 4가지(기본, 파스텔 다이어리, 딸기 우유, 별빛 마법)");
  check(await ev("document.getElementById('soundOn').checked"), "효과음은 처음에 켜져 있음");
  await tab("lessons");
  check(/스티커 0개/.test(await T("#stickerBox")) && /끝내면 받아요/.test(await T("#stickerBox")), "단원 화면 위에 스티커 판(0개, 받는 방법 안내)");
  await shot("f0_기본");

  // 2) 테마 고르기 → 바로 바뀌고 새로 고침해도 남음
  for (var name of ["pastel", "berry", "star"]) {
    await tab("settings");
    await pick("_", name);
    check((await theme()) === name && (await ev("document.querySelector('#themeRows button.on').getAttribute('data-pick')")) === name, "「" + name + "」을 고르면 바로 바뀜");
    await shot("f1_" + name + "_설정");
    await tab("lessons");
    await shot("f2_" + name + "_단원");
  }
  await open();
  check((await theme()) === "star", "새로 고침해도 고른 테마가 남음");
  await ev("document.fonts.ready");
  await sleep(300);
  var fonts = await ev("(function(){return {tab:getComputedStyle(document.querySelector('#tabs button')).fontFamily,body:getComputedStyle(document.body).fontFamily,jua:document.fonts.check('16px Jua'),nunito:document.fonts.check('800 16px Nunito')}})()");
  check(/Jua/.test(fonts.tab) && !/Jua/.test(fonts.body) && fonts.jua, "제목·버튼은 앱에 넣은 Jua 글꼴, 본문은 기본 글꼴(글꼴 파일 로드됨)");
  check(await ev("getComputedStyle(document.querySelector('.bar h1'),'::after').content.indexOf('✨')>=0"), "제목 옆에 테마 그림(✨)");

  // 3) 외우기: 진행 표시, 맞힘·틀림 효과음과 색종이, 끝나면 스티커
  await ev("WT.fun._played.length=0");
  await clickCard(cTitle, "외우기");
  await click("#studyBody button.act[data-act=blocks]");
  await ev("(function(){var b=document.querySelector(\"#studyBody button.opt[data-group='Key Vocabulary']\");if(b.classList.contains('on'))b.click()})()");
  await click("#btnStudyStart");
  await sleep(150);
  var total = await cur("c.deck.total");
  check(!(await ev("document.getElementById('studyProg').hidden")) && (await ev("document.querySelectorAll('#studyProg .pmark').length")) === Math.min(10, total) && (await ev("document.querySelectorAll('#studyProg .pmark.on').length")) === 0, "별빛 마법: 진행 표시가 별 " + Math.min(10, total) + "개로 나옴");
  var fontTile = await ev("getComputedStyle(document.querySelector('#tilePool button.tile')).fontFamily");
  check(/Nunito/.test(fontTile), "영어 조각은 또렷한 Nunito 글꼴(손글씨체 아님)");
  await shot("f3_star_블록");
  await placeTiles();
  check(/ok/.test(await played()) && (await ev("!!document.querySelector('.confetti')")), "맞히면 효과음(ok)과 작은 색종이");
  await shot("f4_star_맞음");
  var steps = 0;
  while (!(await cur("c.deck.finished()")) && steps < 40) { await click("#btnNext"); if (await cur("c.deck.finished()")) break; await placeTiles(); steps++; }
  if (!(await cur("c.deck.finished()"))) await click("#btnNext");
  check((await ev("document.querySelectorAll('#studyProg .pmark.on').length")) === Math.min(10, total), "다 하면 진행 표시가 꽉 참");
  check(!!(await ev("document.getElementById('studySticker')")) && (await stickerN("A")) === 1 && /스티커를 받았어요/.test(await T("#studySticker")), "외우기를 끝내면 단원 주인(아이 A)이 스티커 1개를 받음");
  check(/done/.test(await played()), "끝나면 축하 효과음(done)");
  await shot("f5_star_끝");
  await click("#btnStudyClose");
  check(/스티커 1개/.test(await T("#stickerBox")), "단원 화면의 스티커 판에 1개");
  await ev("document.querySelector('#stickerBox details').open=true");
  check((await ev("document.querySelectorAll('#stickerBox .sboard span').length")) === 1, "스티커 판을 열면 받은 스티커가 보임");
  await shot("f6_star_스티커판");

  // 4) 듣고 쓰기 틀림 → 효과음(no), 색종이 없음
  await ev("WT.fun._played.length=0");
  await clickCard(wTitle, "외우기");
  await click("#studyBody button.act[data-act=listen]");
  await click("#btnStudyStart");
  await typeAns("cap");
  await ev("document.querySelectorAll('.confetti').forEach(function(n){n.remove()})");
  await click("#btnCheck");
  check((await played()) === "no" && !(await ev("!!document.querySelector('.confetti')")), "틀리면 낮은 효과음(no)만, 색종이 없음");
  await click("#btnStudyClose");

  // 5) 효과음 끄기
  await tab("settings");
  await ev("(function(){var c=document.getElementById('soundOn');c.checked=false;c.dispatchEvent(new Event('change'))})()");
  await ev("WT.fun._played.length=0");
  await tab("lessons");
  await clickCard(wTitle, "외우기");
  await click("#btnStudyStart");
  await typeAns("ok");
  await click("#btnCheck");
  check((await played()) === "" && /맞았어요/.test(await T("#studyFix")), "효과음을 끄면 맞혀도 소리를 내지 않음");
  await click("#btnStudyClose");
  await tab("settings");
  await ev("(function(){var c=document.getElementById('soundOn');c.checked=true;c.dispatchEvent(new Event('change'))})()");
  await tab("lessons");

  // 6) 태블릿 시험: 채점하면 스티커, 만점이면 2개
  await ev("WT.fun._played.length=0");
  var bBefore = await stickerN("B");
  await clickCard(wTitle, "시험지 만들기");
  await sleep(500);
  check(!(await ev("document.getElementById('sheet').srcdoc.indexOf('data-theme')>=0")) && !/Jua/.test(await ev("document.getElementById('sheet').srcdoc")), "인쇄 시험지에는 꾸미기(테마, Jua 글꼴)가 들어가지 않음");
  await ev("document.getElementById('btnSolve').click()");
  await sleep(300);
  await ev("(function(){var q=WT.solve._current().quiz;q.items.forEach(function(it,i){var card=document.querySelector('#solveBody .qcard[data-i=\"'+i+'\"]');" +
    "if(it.type==='mcq'){card.querySelector('button.opt[data-k=\"'+it.answer+'\"]').click();return;}" +
    "card.querySelectorAll('input.ans').forEach(function(inp,k){inp.value=it.answers[k];inp.dispatchEvent(new Event('input',{bubbles:true}));});});})()");
  await ev("document.getElementById('btnSolveGrade').click()");
  await sleep(300);
  check(/100 \/ 100점/.test(await T("#solveTop")) && (await stickerN("B")) === bBefore + 2 && /만점! 스티커를 2개/.test(await T("#solveSticker")), "태블릿 시험 만점: 아이 B 가 스티커 2개를 받음");
  check(/done/.test(await played()) && (await ev("!!document.querySelector('.confetti')")), "만점이면 축하 효과음과 색종이");
  await shot("f7_star_시험만점");
  await ev("Array.from(document.querySelectorAll('#solveTop button')).filter(function(b){return b.textContent==='닫기'})[0].click()");

  // 7) 단원 주인의 테마: 아이 A 는 딸기 우유, 기기 공용은 별빛 마법
  await ev("(function(){var s=WT.store.settings();s.theme={_:'star',A:'berry'};WT.store.saveSettings(s);WT.fun.apply()})()");
  await clickCard(cTitle, "외우기");
  check((await theme()) === "berry", "아이 A 단원의 외우기를 열면 아이 A 의 테마(딸기 우유)로 바뀜");
  await click("#studyBody button.act[data-act=letters]");
  await click("#btnStudyStart");
  await sleep(150);
  check((await ev("document.querySelectorAll('#studyProg .pmark').length")) > 0 && (await ev("getComputedStyle(document.querySelector('#studyProg .pmark')).color")) !== "", "딸기 우유: 진행 표시가 하트로 나옴");
  await shot("f8_berry_글자맞추기");
  await click("#btnStudyClose");
  check((await theme()) === "star", "닫으면 이 기기 테마(별빛 마법)로 돌아옴");

  // 8) 파스텔 다이어리 화면 몇 장
  await ev("(function(){var s=WT.store.settings();s.theme={_:'pastel'};WT.store.saveSettings(s);WT.fun.apply()})()");
  await clickCard(wTitle, "외우기");
  await click("#studyBody button.act[data-act=hint]");
  await click("#btnStudyStart");
  await shot("f9_pastel_힌트쓰기");
  await typeAns("ok");
  await click("#btnCheck");
  await shot("f10_pastel_맞음");
  await click("#btnStudyClose");

  // 9) 백업: 테마와 스티커가 들어가고, 옛 백업을 가져와도 새로 받은 스티커가 남음
  var backup = await ev("WT.store.exportAll()");
  var bk = JSON.parse(backup);
  check(bk.settings && bk.settings.theme && bk.settings.theme._ === "pastel" && bk.settings.stickers && bk.settings.stickers.A.length === 1, "백업 파일에 테마와 스티커가 들어감");
  await ev("WT.fun.award('아이 A','점검')");
  var nA = await stickerN("A");
  await ev("WT.store.importText(" + JSON.stringify(backup) + ",'옛 백업')");
  check((await stickerN("A")) === nA, "옛 백업을 가져와도 그 뒤에 받은 스티커가 지워지지 않음(합침, " + nA + "개)");
  await ev("WT.store.importText(" + JSON.stringify(backup) + ",'옛 백업')");
  check((await stickerN("A")) === nA, "같은 백업을 두 번 가져와도 스티커가 늘지 않음");

  // 10) 시험 끝난 단원: 직접 표시하면 맨 아래 접힌 묶음으로, 되돌리기
  await tab("lessons");
  // 접힌 묶음 안은 innerText 가 비고, 카드 머리는 줄이 나뉘므로 textContent 로 본다.
  var topTitles = function () { return ev("Array.from(document.querySelectorAll('#lessonList > .card.lesson .head')).map(function(c){return c.textContent}).join(' | ')"); };
  var inDone = function (t) { return ev("Array.from(document.querySelectorAll('#doneGroup .card.lesson')).some(function(c){return c.textContent.indexOf(" + JSON.stringify(t) + ")>=0})"); };
  check(!(await ev("!!document.getElementById('doneGroup')")), "처음에는 「시험 끝난 단원」 묶음이 없음");
  await clickCard(wTitle, "✅ 시험 끝");
  check((await inDone(wTitle)) && (await topTitles()).indexOf(wTitle) < 0, "「시험 끝」을 누르면 그 단원이 위 목록에서 빠지고 아래 묶음으로 감");
  check(!(await ev("document.getElementById('doneGroup').open")) && /시험 끝난 단원 1개/.test(await T("#doneGroup > summary")), "아래 묶음은 접혀 있고 「시험 끝난 단원 1개」로 보임");
  check((await T("#doneNotice")).indexOf(wTitle) >= 0 && /맨 아래/.test(await T("#doneNotice")), "옮겼다는 안내와 「되돌리기」가 위에 나옴");
  await shot("f11_시험끝_접힘");
  await click("#btnUndoDone");
  check(!(await inDone(wTitle)) && (await topTitles()).indexOf(wTitle) >= 0 && !(await ev("!!document.getElementById('doneGroup')")), "「되돌리기」를 누르면 다시 위로 올라옴");
  await clickCard(wTitle, "✅ 시험 끝");
  await open();
  check((await inDone(wTitle)) && !(await ev("!!document.getElementById('doneNotice')")), "새로 고침해도 시험 끝 표시가 남고, 안내는 한 번만 나옴");
  await ev("document.querySelector('#doneGroup > summary').click()");
  check((await ev("document.getElementById('doneGroup').open")) && /✅ 시험 끝 \d+\/\d+/.test(await ev("document.querySelector('#doneGroup .card.lesson').innerText")), "묶음을 누르면 펼쳐지고, 카드에 「✅ 시험 끝 날짜」 표시");
  await shot("f12_시험끝_펼침");
  check(JSON.parse(await ev("WT.store.exportAll()")).settings.done !== undefined, "시험 끝 표시가 백업에 들어감");
  await clickCard(cTitle, "✅ 시험 끝");
  check(/지금 공부할 단원이 없어요/.test(await T("#lessonList")) && (await ev("document.getElementById('doneGroup').open")), "모두 끝내면 「지금 공부할 단원이 없어요」, 펼친 묶음은 펼친 채로 남음");
  await clickCard(wTitle, "↩ 다시 위로");
  check((await topTitles()).indexOf(wTitle) >= 0 && /시험 끝난 단원 1개/.test(await T("#doneGroup > summary")), "펼친 묶음의 「다시 위로」로도 올릴 수 있음");
  await clickCard(cTitle, "↩ 다시 위로");

  // 11) 학원 시험 점수: 단원 카드 버튼, 점수·만점·날짜·틀린 것·메모, 모아 보기, 만점 트로피, 백업
  var acOpen = async function (t) { await clickCard(t, "📝 학원 점수"); await sleep(100); };
  var setVal = function (id, v) { return ev("(function(){var i=document.getElementById(" + JSON.stringify(id) + ");i.value=" + JSON.stringify(v) + ";i.dispatchEvent(new Event('input',{bubbles:true}))})()"); };
  var cardOf = function (t) { return ev("Array.from(document.querySelectorAll('#lessonList .card.lesson')).filter(function(c){return c.textContent.indexOf(" + JSON.stringify(t) + ")>=0})[0].textContent"); };
  await acOpen(wTitle);
  check(!(await ev("document.getElementById('dlg').hidden")) && /학원 점수/.test(await T("#dlgTitle")) && (await ev("document.getElementById('acTotal').value")) === "100" && /^\d{4}-\d{2}-\d{2}$/.test(await ev("document.getElementById('acDate').value")), "「📝 학원 점수」: 창이 열리고 단어 시험 만점 100점, 날짜는 오늘로 채워짐");
  await click("#btnAcSave");
  check(/점수를 0 이상의 정수로/.test(await T("#acMsg")), "점수를 안 적고 저장하면 안내");
  await setVal("acScore", "120");
  await click("#btnAcSave");
  check(/만점\(100점\)보다 커요/.test(await T("#acMsg")), "만점보다 큰 점수는 저장하지 않음");
  var wk = await ev("document.querySelector('#dlgBody input[type=checkbox]').getAttribute('data-key')");
  await ev("(function(){var c=document.querySelector('#dlgBody input[type=checkbox]');c.checked=true;c.dispatchEvent(new Event('change'))})()");
  await setVal("acScore", "90");
  await setVal("acMemo", "대문자 실수");
  await shot("f13_학원점수_적기");
  await click("#btnAcSave");
  check((await ev("document.getElementById('dlg').hidden")) && /📝 학원 점수 90\/100/.test(await cardOf(wTitle)) && /틀린 것 1개 · 대문자 실수/.test(await cardOf(wTitle)), "저장하면 창이 닫히고 단원 카드에 「📝 학원 점수 90/100 … 틀린 것 1개 · 대문자 실수」");
  check(await ev("WT.store.isWeak(WT.store.list().filter(function(x){return x.kind==='word'})[0].id," + JSON.stringify(wk) + ")"), "체크한 틀린 것은 약한 목록에도 들어감");
  check(/학원 점수 1개/.test(await ev("document.getElementById('academyBox').textContent")) && /단어 시험 평균 90\/100점 \(1번\)/.test(await ev("document.getElementById('academyBox').textContent")), "단원 화면 위 「학원 점수 기록」에 1개, 단어 시험 평균 90/100점");
  var bStick = await stickerN("B");
  await acOpen(wTitle);
  check((await ev("document.getElementById('acScore').value")) === "90" && (await ev("document.querySelector('#dlgBody input[data-key=\"" + wk.replace(/"/g, '\\"') + "\"]').checked")) && (await ev("document.getElementById('acMemo').value")) === "대문자 실수", "다시 열면 적어 둔 점수·틀린 것·메모가 채워져 있음(고치기)");
  await setVal("acScore", "100");
  await click("#btnAcSave");
  await sleep(150);
  check((await stickerN("B")) === bStick + 1 && (await ev("WT.fun.stickers('B').slice(-1)[0].s")) === "🏆" && /만점! 트로피 스티커/.test(await T("#academyNotice")), "학원 시험 만점이면 🏆 스티커를 받고 안내가 나옴");
  check(/100\/100 🏆/.test(await cardOf(wTitle)), "카드 점수에 🏆 표시");
  await shot("f14_학원점수_만점");
  await acOpen(wTitle);
  await click("#btnAcSave");
  check((await stickerN("B")) === bStick + 1, "같은 단원을 만점으로 다시 저장해도 트로피는 한 번만");
  await acOpen(cTitle);
  check((await ev("document.getElementById('acTotal').value")) === "20" && (await ev("document.querySelectorAll('#dlgBody .weakgroup.sub').length")) === 2, "Chunk Quiz 는 만점 20점, 틀린 것 체크는 Key Vocabulary·Chunk 문장으로 나뉨");
  await setVal("acScore", "18");
  await click("#btnAcSave");
  var boardTxt = await ev("document.getElementById('academyBox').textContent");
  check(/Chunk Quiz 평균 18\/20점 \(1번\)/.test(boardTxt) && (await ev("document.querySelectorAll('#academyBox details.acboard').length")) === 2, "아이별로 학원 점수 기록이 따로 모이고, chunk 평균 18/20점");
  await ev("document.querySelectorAll('#academyBox details').forEach(function(d){d.open=true})");
  await shot("f15_학원점수_모아보기");
  var bk2 = await ev("WT.store.exportAll()");
  check(JSON.parse(bk2).settings.academy && Object.keys(JSON.parse(bk2).settings.academy).length === 2, "학원 점수가 백업에 들어감");
  await acOpen(cTitle);
  await setVal("acScore", "19");
  await click("#btnAcSave");
  await ev("WT.store.importText(" + JSON.stringify(bk2) + ",'옛 백업')");
  check(/19\/20/.test(await ev("WT.store.academyFor(WT.store.list().filter(function(x){return x.kind==='chunk'})[0].id).score+'/20'")), "옛 백업을 가져와도 나중에 고친 점수(19)가 남음");
  await acOpen(cTitle);
  await click("#btnAcDelete");
  check(!/📝 학원 점수 \d/.test(await cardOf(cTitle)) && !(await ev("WT.store.academyFor(WT.store.list().filter(function(x){return x.kind==='chunk'})[0].id)")), "「기록 지우기」로 지울 수 있음(버튼 글자와 구분하려고 점수 숫자까지 확인)");

  // 12) 기본으로 되돌리기
  await tab("settings");
  await pick("_", "basic");
  check((await theme()) === null, "「기본」을 고르면 원래 모양으로 돌아감");

  ws.close();
  proc.kill();
  console.log(fails === 0 ? "꾸미기 화면 점검 모두 통과" : "실패 " + fails + "건");
  process.exit(fails === 0 ? 0 : 1);
})().catch(function (e) { console.error("점검 중 오류: " + e.message); try { proc.kill(); } catch (x) {} process.exit(1); });
