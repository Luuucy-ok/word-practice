/* 외우기 화면 점검: Edge 를 자동으로 열고, 카드 넘기기(몰라요 카드 다시 나오기) → 듣고 쓰기(틀리면 다시, 약한 목록 반영) →
 * 약한 항목만 → chunk 단원의 항목 고르기 → 설정의 소리 확인까지 확인한다.
 * 기기 음성은 가짜로 바꿔서, 들려준 영어를 기록해 확인한다(소리는 나지 않음).
 * 사용: node test/e2e-study.js "<단원 데이터 폴더>" "<스크린샷 폴더>"
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
var port = 9339;
var profile = path.join(shotDir, "profile-study-" + Date.now());
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

// 가짜 기기 음성: 들려준 글자를 window.__spoken 에 남긴다.
var FAKE_SPEECH = "(function(){window.__spoken=[];var v={name:'Fake English',lang:'en-US',localService:true};" +
  "var s={getVoices:function(){return window.__noVoice?[]:[v]},speak:function(u){window.__spoken.push({text:u.text,rate:u.rate,lang:u.lang})},cancel:function(){},addEventListener:function(){}};" +
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
  var H = function (sel) { return ev("(function(){var n=document.querySelector(" + JSON.stringify(sel) + ");return !n||n.hidden})()"); };
  var click = function (sel) { return ev("document.querySelector(" + JSON.stringify(sel) + ").click()"); };
  function clickCard(text, btn) {
    return ev("(function(){var c=Array.from(document.querySelectorAll('#lessonList .card')).filter(function(x){return x.innerText.indexOf(" + JSON.stringify(text) + ")>=0})[0];" +
      "Array.from(c.querySelectorAll('button')).filter(function(x){return x.textContent===" + JSON.stringify(btn) + "})[0].click();return true})()");
  }
  function cardText(text) { return ev("Array.from(document.querySelectorAll('#lessonList .card')).filter(function(x){return x.innerText.indexOf(" + JSON.stringify(text) + ")>=0})[0].innerText"); }
  var cur = function (expr) { return ev("(function(){var c=WT.study._current();return " + expr + "})()"); };
  // 듣고 쓰기 입력칸에 쓴다. how: ok(정답), cap(첫 글자 대소문자 바꿈)
  function typeAns(how) {
    return ev("(function(h){var c=WT.study._current();var it=c.deck.current();c.inputs.forEach(function(inp,k){var v=it.answers[k];" +
      "if(h==='cap'&&k===0)v=(v.charAt(0).toUpperCase()===v.charAt(0)?v.charAt(0).toLowerCase():v.charAt(0).toUpperCase())+v.slice(1);" +
      "inp.value=v;inp.dispatchEvent(new Event('input',{bubbles:true}));});return it.word})(" + JSON.stringify(how) + ")");
  }

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: FAKE_SPEECH });
  await open();
  await ev("localStorage.clear()");
  await ev("WT.store.importText(" + JSON.stringify(JSON.stringify([W, C])) + ",'점검').errors.length");
  await open();
  var wTitle = "단어 Lesson " + W.lesson;
  var N = W.words.length;

  // 1) 단원 카드 → 외우기
  await clickCard(wTitle, "외우기");
  await sleep(200);
  check(!(await H("#study")) && (await ev("document.querySelectorAll('#studyBody button.act').length")) === 2, "단원 카드의 「외우기」로 고르기 화면이 열리고 활동 2가지(카드 넘기기, 듣고 쓰기)가 보임");
  check(/전체/.test(await T("#studyBody")) && /약한 항목만 \(0개\)/.test(await T("#studyBody")), "범위 고르기: 전체 / 약한 항목만(0개)");
  await shot("m1_고르기");

  // 2) 카드 넘기기: 첫 카드 몰라요 → 나머지 알아요 → 놓친 카드가 다시 나옴
  await click("#btnStudyStart");
  await sleep(150);
  var firstWord = await cur("c.deck.current().word");
  var front = await T("#studyCard");
  var firstEn = await cur("c.deck.current().en");
  check(front.indexOf(firstEn.slice(0, 20)) >= 0 && (await H("#studyCard .back")), "카드 앞면에 영문 뜻이 보이고 뒷면(단어)은 숨겨져 있음");
  check(/끝낸 것 0 \/ \d+ · 남은 것 \d+/.test(await T("#studySub")), "위쪽에 「끝낸 것 / 남은 것」 진행 표시");
  await shot("m2_카드앞");
  await click("#studyCard");
  await sleep(100);
  check(!(await H("#studyCard .back")) && (await T("#studyCard .back")).indexOf(firstWord) >= 0, "카드를 누르면 뒤집혀서 단어가 보임");
  check((await ev("window.__spoken.slice(-1)[0].text")) === firstWord, "뒤집으면 단어를 영어로 읽어 줌");
  check(!(await ev("document.querySelector('#studyCard .fnote')")), "단원 데이터의 부모님용 메모(note)는 카드에 보이지 않음");
  await shot("m3_카드뒤");
  await click("#btnDunno");
  var steps = 0;
  while (!(await cur("c.deck.finished()")) && steps < 50) {
    await click("#btnFlip");
    await click("#btnKnow");
    steps++;
  }
  check(steps === N, "몰라요 카드는 뒤에 다시 나와서, " + N + "장을 모두 「알아요」로 끝냄(넘긴 횟수 " + steps + ")");
  var endT = await T("#studyBody");
  check(/다 했어요/.test(endT) && endT.indexOf("처음에 몰랐던 것: " + firstWord) >= 0, "끝 화면에 「처음에 몰랐던 것」이 나옴");
  check((await ev("WT.store.weakCount(WT.store.list().filter(function(x){return x.kind==='word'})[0])")) === 0, "카드 넘기기는 약한 목록을 바꾸지 않음");
  await shot("m4_카드끝");
  await click("#btnStudyMissed");
  check((await cur("c.deck.total")) === 1, "「처음에 몰랐던 것만 다시」는 그 카드만 다시 냄");
  await click("#btnFlip");
  await click("#btnKnow");

  // 3) 듣고 쓰기
  await click("#btnStudyAgain");
  await click("#studyBody button.act[data-act=listen]");
  check(/영어 음성: Fake English/.test(await T("#studyVoice")), "듣고 쓰기를 고르면 영어 음성 상태가 보임");
  await click("#btnStudyStart");
  await sleep(150);
  var say0 = await cur("c.deck.current().say");
  check((await ev("window.__spoken.slice(-1)[0].text")) === say0, "문제가 나오면 바로 영어로 읽어 줌");
  var attrs = await ev("Array.from(document.querySelectorAll('#studyBody input.ans')).every(function(i){return i.getAttribute('autocapitalize')==='off'&&i.getAttribute('autocorrect')==='off'&&i.getAttribute('spellcheck')==='false'&&i.getAttribute('autocomplete')==='off'})");
  check(attrs, "입력칸에서 자동 대문자·자동 수정·맞춤법 검사·자동 완성을 끔");
  check(!/[a-z]{3,}/i.test((await T("#studyCard")).replace(/다시 듣기|천천히 듣기/g, "").replace(/[^\x00-\x7f]/g, "").replace(/Key Vocabulary/g, "")), "듣고 쓰기 화면에는 정답 영어가 보이지 않음(한글 뜻만)");
  await click("#studyBody button.say:nth-child(2)");
  check((await ev("window.__spoken.slice(-1)[0].rate")) < 0.8, "「천천히 듣기」는 느리게 읽어 줌");
  var wrongWord = await typeAns("cap");
  await ev("(function(){var i=WT.study._current().inputs[0];i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()");
  var fixT = await T("#studyFix");
  check(/정답/.test(fixT) && /대소문자가 달라요/.test(fixT) && fixT.indexOf(wrongWord) >= 0, "틀리면(Enter 로 확인) 정답과 이유(대소문자)가 나오고 「뒤에서 다시 나와요」");
  await shot("m5_듣고쓰기_틀림");
  await click("#btnNext");
  check((await ev("WT.store.isWeak(WT.store.list().filter(function(x){return x.kind==='word'})[0].id," + JSON.stringify(wrongWord) + ")")), "처음 틀린 단어는 바로 약한 목록에 들어감");
  steps = 0;
  while (!(await cur("c.deck.finished()")) && steps < 50) {
    await typeAns("ok");
    await click("#btnCheck");
    if (steps === 0) { check(/맞았어요/.test(await T("#studyFix")), "맞으면 ○ 「맞았어요!」"); await shot("m6_듣고쓰기_맞음"); }
    await click("#btnNext");
    steps++;
  }
  check(steps === N, "틀린 단어는 뒤에 다시 나와서 " + N + "개를 모두 맞혀야 끝남(푼 횟수 " + (steps + 1) + ")");
  endT = await T("#studyBody");
  check(endT.indexOf("약한 목록에 넣었어요: " + wrongWord) >= 0 && /연속 2번 맞히면 빠져요/.test(endT), "끝 화면에 약한 목록에 넣은 단어와 빼는 방법이 나옴");
  await shot("m7_듣고쓰기_끝");
  await click("#btnStudyClose");
  check(/틀린 항목 1개/.test(await cardText(wTitle)), "닫으면 단원 카드에 「틀린 항목 1개」");

  // 4) 약한 항목만 + 고른 방법 기억
  await clickCard(wTitle, "외우기");
  check((await ev("document.querySelector('#studyBody button.act.on').getAttribute('data-act')")) === "listen", "지난번에 고른 방법(듣고 쓰기)을 기억함");
  await click("#studyBody button.opt[data-scope=weak]");
  await click("#btnStudyStart");
  check((await cur("c.deck.total")) === 1 && (await cur("c.deck.current().word")) === wrongWord, "약한 항목만: 틀린 단어 1개만 나옴");
  await click("#btnStudyClose");

  // 5) chunk 단원: 항목 고르기, chunk 문장 듣고 쓰기, 콜로케이션 카드(영어 보고 뜻)
  var cTitle = C.title || "Chunk Quiz";
  await clickCard(cTitle, "외우기");
  check((await ev("document.querySelectorAll('#studyBody button.opt[data-group]').length")) === 2, "chunk 단원은 항목(Key Vocabulary, Chunk 문장)을 고를 수 있음");
  await click("#studyBody button.opt[data-scope=all]");
  await click("#studyBody button.opt[data-group='Key Vocabulary']");
  await click("#btnStudyStart");
  var nChunk = C.chunks.length;
  check((await cur("c.deck.total")) === nChunk && (await cur("c.deck.queue.every(function(x){return x.group==='Chunk 문장'})")), "Chunk 문장만 고르면 chunk 문장 " + nChunk + "개만 나옴");
  var sent = await cur("c.deck.current().say");
  check((await ev("window.__spoken.slice(-1)[0].text")) === sent && (await ev("document.querySelectorAll('#studyBody input.ans').length")) === 1, "chunk 문장은 문장 전체를 읽어 주고 빈칸 1개에 구절을 씀");
  await shot("m8_chunk_듣고쓰기");
  await typeAns("ok");
  await click("#btnCheck");
  check(/맞았어요/.test(await T("#studyFix")), "구절을 맞게 쓰면 맞음");
  await click("#btnStudyClose");
  await clickCard(cTitle, "외우기");
  await click("#studyBody button.act[data-act=cards]");
  await click("#studyBody button.opt[data-group='Key Vocabulary']");
  await click("#studyBody button.opt[data-group='Chunk 문장']");
  await click("#studyBody button.opt[data-face=english]");
  await click("#btnStudyStart");
  var it0 = await cur("{say:c.deck.current().say,ko:c.deck.current().ko,group:c.deck.current().group}");
  check(it0.group === "Key Vocabulary" && (await T("#studyCard .front")).indexOf(it0.say) >= 0 && (await H("#studyCard .back")), "영어 보고 뜻 떠올리기: 앞면에 콜로케이션 전체, 뒷면은 숨김");
  await click("#studyCard");
  check((await T("#studyCard .back")).indexOf(it0.ko) >= 0, "뒤집으면 한글 뜻이 보임");
  await shot("m9_콜로케이션카드");
  await click("#btnStudyClose");

  // 6) 설정의 소리 확인, 영어 음성이 없을 때 안내
  await ev("document.querySelector('#tabs button[data-tab=settings]').click()");
  await click("#btnVoiceTest");
  check(/Fake English/.test(await T("#voiceMsg")) && (await ev("window.__spoken.slice(-1)[0].text")) === "Hello! Let's practice spelling.", "설정 「영어 소리 들어 보기」: 영어 문장을 읽고 음성 이름을 보여 줌");
  await ev("window.__noVoice=true");
  check((await ev("WT.speech.status().code")) === "unknown" && /들어 보기/.test(await ev("WT.speech.statusText(WT.speech.status())")), "음성 목록이 비면 「소리가 나는지 확인해 달라」고 안내");

  ws.close();
  proc.kill();
  console.log(fails === 0 ? "외우기 화면 점검 모두 통과" : "실패 " + fails + "건");
  process.exit(fails === 0 ? 0 : 1);
})().catch(function (e) { console.error("점검 중 오류: " + e.message); try { proc.kill(); } catch (x) {} process.exit(1); });
