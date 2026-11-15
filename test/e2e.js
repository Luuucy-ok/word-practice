/* 화면 점검: Edge 를 자동으로 열어 단원 가져오기 → 시험지 만들기 → 오류 처리를 확인한다.
 * 사용: node test/e2e.js "<단원 데이터 폴더>" "<스크린샷 폴더>"
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
var index = "file:///" + path.join(__dirname, "..", "index.html").replace(/\\/g, "/");
var port = 9333;
var profile = path.join(shotDir, "profile");
var proc = cp.spawn(edge, ["--headless=new", "--disable-gpu", "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "--window-size=1100,1400", "about:blank"], { stdio: "ignore" });

var fails = 0;
function check(c, m) { console.log((c ? "통과: " : "실패: ") + m); if (!c) fails++; }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function getJson(url) {
  return new Promise(function (res, rej) {
    http.get(url, function (r) { var b = ""; r.on("data", function (d) { b += d; }); r.on("end", function () { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on("error", rej);
  });
}

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
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url: index });
  await sleep(1200);
  await shot("01_빈화면");
  check((await ev("document.getElementById('lessonList').innerText")).indexOf("아직 가져온 단원이 없어요") >= 0, "처음에는 빈 목록 안내가 보임");

  async function importText(text) {
    await ev("document.getElementById('pasteIn').value = " + JSON.stringify(text) + "; document.getElementById('btnImport').click();");
    await sleep(500);
    return ev("document.getElementById('importMsg').innerText");
  }
  var files = fs.readdirSync(dataDir);
  var pick = function (re) { return fs.readFileSync(path.join(dataDir, files.filter(function (f) { return re.test(f); })[0]), "utf8"); };

  // 필수 항목이 없는 데이터는 가져오기에서 거부
  var broken = JSON.parse(pick(/^B_단어.*L07/)); delete broken.owner;
  var m0 = await importText(JSON.stringify(broken));
  check(/owner/.test(m0) && /넣지 못한 것/.test(m0), "owner 없는 데이터를 거부하고 이유를 보여 줌: " + m0.split("\n").slice(-1)[0]);
  var broken2 = JSON.parse(pick(/B_chunk_L07/)); broken2.hint = "maybe";
  var m0b = await importText(JSON.stringify(broken2));
  check(/hint/.test(m0b), "chunk hint 가 잘못된 데이터를 거부함");
  check((await ev("document.getElementById('lessonList').innerText")).indexOf("아직 가져온 단원이 없어요") >= 0, "거부된 데이터는 목록에 들어가지 않음");

  // 정상 데이터 가져오기
  var m1 = await importText(pick(/^B_단어.*L07/));
  check(/새로 넣음: 1개/.test(m1), "한선 단어 L7 가져오기: " + m1);
  var m2 = await importText(pick(/^A_단어.*L08/));
  check(/새로 넣음: 1개/.test(m2), "한나 단어 L8 가져오기");
  var m3 = await importText(pick(/B_chunk_L07/));
  check(/새로 넣음: 1개/.test(m3), "한선 chunk 가져오기");
  var m4 = await importText(pick(/^B_단어.*L07/));
  check(/덮어씀: 1개/.test(m4), "같은 단원을 다시 넣으면 덮어씀");
  var list = await ev("document.getElementById('lessonList').innerText");
  check(/아이 B/.test(list) && /아이 A/.test(list) && /교재 대조 완료/.test(list), "목록에 대상과 검증 상태가 보임");
  await shot("02_단원목록");

  // 확인 표
  await ev("Array.from(document.querySelectorAll('#lessonList button')).filter(function(b){return b.textContent==='확인 표'})[0].click()");
  await sleep(300);
  var dlg = await ev("document.getElementById('dlgBody').innerText");
  check(/연습 페이지에 문장이 없는 단어/.test(dlg), "확인 표가 열림");
  await shot("03_확인표");
  await ev("document.getElementById('dlgClose').click()");

  // 시험지 만들기: 한선 단어 L7 (연습 페이지 문장만)
  async function openMaker(re) {
    await ev("(function(){var cards=Array.from(document.querySelectorAll('#lessonList .card'));var c=cards.filter(function(x){return re.test(x.innerText)})[0];Array.from(c.querySelectorAll('button')).filter(function(b){return b.textContent==='시험지 만들기'})[0].click();})()".replace("re.test", "new RegExp(" + JSON.stringify(re.source) + "," + JSON.stringify(re.flags) + ").test"));
    await sleep(700);
  }
  await openMaker(/아이 B[\s\S]*단어 Lesson 7/);
  var html1 = await ev("document.getElementById('sheet').srcdoc");
  check(html1.length > 5000 && /Lesson 7/.test(html1), "시험지가 미리보기에 나옴");
  check((html1.match(/<tr class="[wm]">/g) || []).length === 10, "10문항");
  var info = await ev("document.getElementById('makeInfo').innerText");
  check(/대상 아이 B/.test(info) && /연습 페이지 문장만/.test(info), "대상과 문장 규칙이 한 줄로 보임: " + info.split("\n")[0]);
  var seed1 = (/시험지 번호 (\d+)/.exec(info) || [])[1];
  await ev("document.getElementById('btnMake').click()");
  await sleep(500);
  var seed2 = (/시험지 번호 (\d+)/.exec(await ev("document.getElementById('makeInfo').innerText")) || [])[1];
  check(seed1 && seed2 && seed1 !== seed2, "다시 만들기를 누르면 번호가 바뀜(" + seed1 + " → " + seed2 + ")");
  // 같은 번호는 같은 시험지
  await ev("document.getElementById('optSeed').value='4242'; document.getElementById('optSeed').dispatchEvent(new Event('change'))");
  await sleep(400);
  var a = await ev("document.getElementById('sheet').srcdoc");
  await ev("document.getElementById('btnMake').click()");
  await sleep(300);
  await ev("document.getElementById('optSeed').value='4242'; document.getElementById('optSeed').dispatchEvent(new Event('change'))");
  await sleep(400);
  var b = await ev("document.getElementById('sheet').srcdoc");
  check(a === b && a.length > 1000 && /시험지 번호 4242/.test(a), "같은 시험지 번호면 같은 시험지");
  await shot("04_시험지_한선단어");

  // 전체 쓰기 연습
  await ev("var s=document.getElementById('wMode'); s.value='all-write'; s.dispatchEvent(new Event('change'))");
  await sleep(500);
  var html2 = await ev("document.getElementById('sheet').srcdoc");
  check(/Part A\./.test(html2) && /Part B\./.test(html2) && /전체 쓰기 연습/.test(html2), "전체 쓰기 연습 시험지");
  var bad = (html2.match(/\[(교재 예문|새 문장|지난 시험 문장)/g) || []).length;
  check(bad === 0, "한선 시험지 정답지에 연습 페이지 밖 문장이 없음");

  // 한나 단어 L8: 해석이 정답지에 나옴
  await openMaker(/아이 A[\s\S]*단어 Lesson 8/);
  var html3 = await ev("document.getElementById('sheet').srcdoc");
  check(/Lesson 8/.test(html3), "한나 단어 L8 시험지");
  await ev("var s=document.getElementById('wMode'); s.value='all-write'; s.dispatchEvent(new Event('change'))");
  await sleep(500);
  var html4 = await ev("document.getElementById('sheet').srcdoc");
  check(/<b>/.test(html4) && /[가-힣]/.test(html4.split("Part B 정답")[1] || ""), "한나 정답지에 문장 해석이 있음");
  await shot("05_시험지_한나전체쓰기");

  // chunk
  await openMaker(/아이 B[\s\S]*chunk/);
  var html5 = await ev("document.getElementById('sheet').srcdoc");
  check(/Chunk Quiz Lesson 7/.test(html5) && /class="hw"/.test(html5), "한선 chunk 시험지에 첫 글자 힌트가 있음");
  info = await ev("document.getElementById('makeInfo').innerText");
  check(/첫 글자 있음/.test(info), "chunk 대상과 힌트가 보임");
  await ev("var s=document.getElementById('cHint'); s.value='none'; s.dispatchEvent(new Event('change'))");
  await sleep(400);
  info = await ev("document.getElementById('makeInfo').innerText");
  check(/데이터 기준.*다른 힌트/.test(info), "데이터와 다른 힌트로 바꾸면 경고가 뜸");
  await shot("06_시험지_한선chunk");

  // 설정: 이름 표시와 백업
  await ev("document.querySelector('#tabs button[data-tab=settings]').click()");
  await ev("document.getElementById('nameA').value='테스트'; document.getElementById('btnNames').click()");
  await sleep(300);
  var after = await ev("document.getElementById('lessonList').innerText");
  check(/아이 A\(테스트\)/.test(after), "이름 표시가 목록에 반영됨");
  var bk = await ev("WT.store.exportAll()");
  check(/"app": "word-practice"/.test(bk) && JSON.parse(bk).lessons.length === 3, "백업 내용에 단원 3개");
  await ev("WT.store.removeAll(); location.reload()");
  await sleep(1000);
  check((await ev("document.getElementById('lessonList').innerText")).indexOf("아직 가져온 단원이 없어요") >= 0, "지운 뒤 목록이 비어 있음");
  var r = await ev("(function(){var r=WT.store.importText(" + JSON.stringify(bk) + ",'백업');return JSON.stringify(r)})()");
  check(JSON.parse(r).added.length === 3, "백업 파일로 3개 복원");
  await ev("location.reload()");
  await sleep(800);
  await shot("07_복원후");

  ws.close();
  proc.kill();
  console.log(fails === 0 ? "화면 점검 모두 통과" : "실패 " + fails + "건");
  process.exit(fails === 0 ? 0 : 1);
})().catch(function (e) { console.error("점검 중 오류: " + e.message); try { proc.kill(); } catch (x) {} process.exit(1); });
