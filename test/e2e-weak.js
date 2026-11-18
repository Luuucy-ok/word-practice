/* 틀린 단어 표시 화면 점검: Edge 를 자동으로 열고, 단원 카드 → 틀린 단어 표시 → 약한 항목만 재시험지 → 새로 열어도 유지까지 확인한다.
 * 사용: node test/e2e-weak.js "<단원 데이터 폴더>" "<스크린샷 폴더>"
 * (인터넷 접속 없음)
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
var port = 9337;
var profile = path.join(shotDir, "profile-weak");
fs.rmSync(profile, { recursive: true, force: true });
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
  }
  var T = function (sel) { return ev("document.querySelector(" + JSON.stringify(sel) + ").innerText"); };
  var H = function (sel) { return ev("document.querySelector(" + JSON.stringify(sel) + ").hidden"); };
  // 이름이 text 인 단원 카드 안의 버튼을 누른다
  function clickCard(cardText, btnText) {
    return ev("(function(){var c=Array.from(document.querySelectorAll('#lessonList .card')).filter(function(x){return x.innerText.indexOf(" + JSON.stringify(cardText) + ")>=0})[0];" +
      "var b=Array.from(c.querySelectorAll('button')).filter(function(x){return x.textContent===" + JSON.stringify(btnText) + "})[0];b.click();return true})()");
  }
  function cardText(cardText) {
    return ev("Array.from(document.querySelectorAll('#lessonList .card')).filter(function(x){return x.innerText.indexOf(" + JSON.stringify(cardText) + ")>=0})[0].textContent"); // 펼치는 칸 안 글자까지
  }
  function sheet() { return ev("document.getElementById('sheet').srcdoc"); }


  // 단어 시험지는 「전체 쓰기」가 기본이라, 학원 시험 모양(10문항·100점)을 보는 점검은 종류 버튼으로 바꾼다.
  async function toRegular() {
    await ev("document.querySelector('.seg[data-for=wMode] button[data-v=regular]').click()");
    await sleep(400);
  }
  await send("Page.enable");
  await send("Runtime.enable");
  await open();
  await ev("localStorage.clear()");
  await ev("(function(){var r=WT.store.importText(" + JSON.stringify(JSON.stringify([W, C])) + ",'점검');return r.errors.length})()");
  await open();

  var wTitle = "단어 Lesson " + W.lesson;
  var cTitle = C.title || "Chunk Quiz";

  // 1) 카드에 버튼이 있고 처음에는 표시가 없음
  var card0 = await cardText(wTitle);
  check(/틀린 단어 표시/.test(card0) && !/틀린 항목/.test(card0), "단어 단원 카드에 「틀린 단어 표시」 버튼이 있고, 처음에는 표시가 없음");

  // 2) 단어 단원: 대화상자
  await clickCard(wTitle, "틀린 단어 표시");
  check(!(await H("#dlg")) && /틀린 단어 표시/.test(await T("#dlgTitle")), "버튼을 누르면 틀린 단어를 고르는 화면이 뜸");
  check((await ev("document.querySelectorAll('#dlgBody .weaklist input[type=checkbox]').length")) === W.words.length, "단어 " + W.words.length + "개가 체크 칸으로 나옴");
  check(/표시한 것이 없어요/.test(await T("#dlgBody")), "처음에는 「표시한 것이 없어요」");
  var picks = [0, 3, 6];
  for (var p of picks) await ev("document.querySelectorAll('#dlgBody .weaklist input[type=checkbox]')[" + p + "].click()");
  check(/틀린 항목 3개를 표시했어요/.test(await T("#dlgBody")), "3개를 누르면 개수가 바로 바뀜");
  check((await ev("document.querySelectorAll('#dlgBody .weaklist label.on').length")) === 3, "표시한 줄이 강조됨");
  await shot("w1_단어_표시");
  var stored = await ev("localStorage.getItem('wp.weak.v1')");
  check(picks.every(function (i) { return stored.indexOf(JSON.stringify(W.words[i].word)) >= 0; }), "누르는 즉시 이 기기에 저장됨");
  await ev("document.getElementById('dlgClose').click()");
  check(await H("#dlg"), "닫으면 화면이 닫힘");
  check(/틀린 항목 3개/.test(await cardText(wTitle)), "단원 카드에 「틀린 항목 3개」가 보임");

  // 3) 약한 단어만 재시험지
  await clickCard(wTitle, "시험지 만들기"); await toRegular();
  await sleep(500);
  var wt = await T("#wWeakText");
  check(!(await ev("document.getElementById('wWeak').disabled")) && /3개/.test(wt), "시험지 만들기에서 「약한 단어만」이 켜지고 3개라고 나옴: " + wt);
  await ev("document.getElementById('wWeak').click()");
  await sleep(500);
  var html = await sheet();
  var weakWords = picks.map(function (i) { return W.words[i].word; });
  var ordered = W.words.filter(function (w) { return weakWords.indexOf(w.word) >= 0; }).map(function (w) { return w.word; }).join(", ");
  check(html.length > 3000 && html.indexOf("약한 단어</b>: " + ordered) >= 0, "재시험지가 만들어지고 정답지에 약한 단어 목록(" + ordered + ")이 나옴");
  check(!/규칙 점검에서 걸려|시험지를 만들지 않았어요/.test(await T("#makeInfo")), "규칙 점검에서 걸리지 않음");
  await shot("w2_단어_재시험지");

  // 4) 시험지 화면에서 표시를 모두 지우면 「약한 단어만」이 꺼지고 일반 시험지로 돌아감
  await ev("document.getElementById('btnWeakEdit').click()");
  check(!(await H("#dlg")), "시험지 만들기 화면의 「틀린 단어 표시하기」로도 같은 화면이 열림");
  await ev("window.confirm=function(){return true}; Array.from(document.querySelectorAll('#dlgBody button')).filter(function(b){return b.textContent==='표시 모두 지우기'})[0].click()");
  check(/표시한 것이 없어요/.test(await T("#dlgBody")), "「표시 모두 지우기」가 동작함");
  await ev("document.getElementById('dlgClose').click()");
  await sleep(500);
  check((await ev("document.getElementById('wWeak').disabled")) && !(await ev("document.getElementById('wWeak').checked")) && /표시한 것이 없어요/.test(await T("#wWeakText")), "표시가 없으면 「약한 단어만」이 잠기고 꺼짐");
  check((await sheet()).length > 3000 && !/시험지를 만들지 않았어요/.test(await T("#makeInfo")), "닫은 뒤 시험지가 일반 시험지로 다시 만들어짐");

  // 5) chunk 단원
  await ev("document.querySelector('#tabs button[data-tab=lessons]').click()");
  await clickCard(cTitle, "틀린 단어 표시");
  check((await ev("document.querySelectorAll('#dlgBody .weakgroup').length")) === 2, "chunk 단원은 「Key Vocabulary」와 「Chunk 문장」 두 묶음으로 나뉨");
  var nV = (C.vocab || []).length;
  await ev("document.querySelectorAll('#dlgBody .weaklist input[type=checkbox]')[0].click()");
  await ev("document.querySelectorAll('#dlgBody .weaklist input[type=checkbox]')[1].click()");
  await ev("document.querySelectorAll('#dlgBody .weaklist input[type=checkbox]')[" + nV + "].click()");
  check(/틀린 항목 3개를 표시했어요/.test(await T("#dlgBody")), "단어 2개와 chunk 문장 1개를 표시하면 3개로 셈");
  await shot("w3_chunk_표시");
  await ev("document.getElementById('dlgClose').click()");
  await clickCard(cTitle, "시험지 만들기");
  await sleep(500);
  var ct = await T("#cWeakText");
  check(!(await ev("document.getElementById('cWeak').disabled")) && /3개/.test(ct), "chunk 시험지 만들기에서 「약한 항목만」이 켜지고 3개라고 나옴: " + ct);
  await ev("document.getElementById('cWeak').click()");
  await sleep(500);
  var ch = await sheet();
  check(ch.indexOf("약한 항목 재시험") >= 0 && /범위 전체/.test(await ev("document.getElementById('makeInfo').textContent")), "chunk 재시험지 제목에 「약한 항목 재시험」이 있고 범위 전체 방식이라고 알려 줌");
  var vWords = [C.vocab[0].word, C.vocab[1].word];
  check(ch.indexOf("범위 전체 연습") >= 0 && vWords.every(function (w) { return ch.indexOf(w) >= 0; }), "chunk 재시험지에 표시한 단어가 들어 있음(" + vWords.join(", ") + ")");
  await shot("w4_chunk_재시험지");

  // 6) 새로 열어도 유지, 백업에 들어감
  await open();
  check(/틀린 항목 3개/.test(await cardText(cTitle)), "페이지를 새로 열어도 틀린 표시가 남아 있음");
  var backup = await ev("WT.store.exportAll()");
  check(JSON.parse(backup).weak && Object.keys(JSON.parse(backup).weak).length === 1, "백업 파일에 틀린 표시가 들어감");

  // 7) 확인 표의 「고칠 곳 적기」
  await clickCard(wTitle, "확인 표");
  check(!(await H("#dlg")) && (await ev("document.querySelectorAll('#dlgBody .fixable').length")) === 0, "확인 표를 열면 처음에는 고칠 칸이 표시되지 않음");
  await ev("Array.from(document.querySelectorAll('#dlgBody button')).filter(function(b){return b.textContent==='고칠 곳 적기'})[0].click()");
  var nFix = await ev("document.querySelectorAll('#dlgBody .fixable').length");
  check(nFix >= W.words.length * 4, "「고칠 곳 적기」를 누르면 단어·품사·한글 뜻·영문 뜻·문장 칸을 고칠 수 있게 표시됨(" + nFix + "칸)");
  // 1행의 한글 뜻 칸(4번째 칸)을 눌러 바른 내용을 적는다
  await ev("window.prompt=function(){return '고친 뜻'}; document.querySelectorAll('#dlgBody table.ct tr')[1].children[3].click()");
  var row1 = await ev("document.querySelectorAll('#dlgBody table.ct tr')[1].children[3].innerText");
  check(/→ 고친 뜻/.test(row1) && (await ev("!!document.querySelector('#dlgBody table.ct tr:nth-child(2) td.fixed del')")), "적은 칸에 지금 내용(취소선)과 「→ 고친 뜻」이 보임");
  check(/이 단원에서 적은 고칠 곳 1개/.test(await T("#dlgBody")), "확인 표 아래에 「이 단원에서 적은 고칠 곳 1개」가 나옴");
  await shot("w5_고칠곳");
  await ev("Array.from(document.querySelectorAll('#dlgBody button')).filter(function(b){return b.textContent==='수정 목록 복사'})[0].click()");
  await sleep(300);
  var copied = await ev("(document.querySelector('#dlgBody textarea.fixtext')||{}).value||''");
  var bodyTxt = await T("#dlgBody");
  check((/복사했어요/.test(bodyTxt)) || (/고친 뜻/.test(copied) && /자동으로 복사하지 못했어요/.test(bodyTxt)), "「수정 목록 복사」: 복사하거나, 복사가 막힌 환경이면 글을 칸에 띄워 직접 복사하게 함");
  check(copied === "" || (copied.indexOf("아이 B · 단어 Lesson " + W.lesson) >= 0 && copied.indexOf("→ 「고친 뜻」") >= 0), "복사할 글에 단원과 「→ 고친 뜻」이 들어 있음");
  check((await ev("WT.store.list().filter(function(x){return x.data.kind==='word'})[0].data.words[0].ko")) === W.words[0].ko, "고칠 곳을 적어도 앱의 단원(시험지에 쓰는 내용)은 바뀌지 않음");
  await ev("document.getElementById('dlgClose').click()");
  check(/고칠 곳 1개/.test(await cardText(wTitle)), "단원 카드에 「고칠 곳 1개」가 보임");
  await ev("document.querySelector('#tabs button[data-tab=settings]').click()");
  check(/고칠 곳이 1개/.test(await T("#fixCount")) && /고친 뜻/.test(await ev("document.getElementById('fixText').value")), "설정의 「고칠 곳 목록」에 개수와 글이 보임");
  await shot("w6_설정_고칠곳");
  // 같은 칸을 비우고 확인하면 지워짐
  await ev("document.querySelector('#tabs button[data-tab=lessons]').click()");
  await clickCard(wTitle, "확인 표");
  await ev("window.prompt=function(){return ''}; document.querySelectorAll('#dlgBody table.ct tr')[1].children[3].click()");
  check(!(await ev("!!document.querySelector('#dlgBody td.fixed')")) && !/이 단원에서 적은 고칠 곳/.test(await T("#dlgBody")), "같은 칸을 비우고 확인하면 적은 것이 지워짐");
  await ev("window.prompt=function(){return null}; document.querySelectorAll('#dlgBody table.ct tr')[1].children[3].click()");
  check((await ev("WT.store.fixesAll().length")) === 0, "적는 창에서 취소하면 아무것도 바뀌지 않음");
  await ev("Array.from(document.querySelectorAll('#dlgBody button')).filter(function(b){return b.textContent==='고칠 곳 적기 끝내기'})[0].click(); document.getElementById('dlgClose').click()");

  ws.close();
  proc.kill();
  console.log(fails === 0 ? "틀린 단어 화면 점검 모두 통과" : "실패 " + fails + "건");
  process.exit(fails === 0 ? 0 : 1);
})().catch(function (e) { console.error("점검 중 오류: " + e.message); try { proc.kill(); } catch (x) {} process.exit(1); });
