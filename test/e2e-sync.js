/* 연결·자동 받기 화면 점검: Edge 를 자동으로 열고, 가짜 GitHub 응답으로 연결 링크 → 연결 → 자동 받기 → 오류 → 연결 끊기를 확인한다.
 * 사용: node test/e2e-sync.js "<단원 데이터 폴더>" "<스크린샷 폴더>"
 * (인터넷 접속 없음. 실제 저장소 점검은 test/live.js 를 쓴다.)
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
var port = 9334;
var profile = path.join(shotDir, "profile-sync");
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
function enc(o) { return Buffer.from(JSON.stringify(o), "utf8").toString("base64url"); }

// 한나 묶음: 앱 점검에 쓰는 단원 몇 개
var files = fs.readdirSync(dataDir);
function load(re) { return JSON.parse(fs.readFileSync(path.join(dataDir, files.filter(function (f) { return re.test(f); })[0]), "utf8")); }
var lessons = [load(/^A_단어.*L07/), load(/^A_단어.*L08/), load(/A_chunk.*L07-08/)];
var BUNDLE = JSON.stringify({ app: "word-practice-bundle", version: 1, owner: "아이 A", publishedAt: "2026-11-17T00:00:00Z", lessons: lessons });
var TOKEN = "github_pat_" + "a".repeat(40);

// 페이지가 열릴 때마다 먼저 실행되어 fetch 를 가짜로 바꾼다. 상태는 sessionStorage 에 둬서 새로 고침 뒤에도 이어진다.
var MOCK = "(function(){" +
  "var BUNDLE=" + JSON.stringify(BUNDLE) + ";" +
  "function st(){try{return JSON.parse(sessionStorage.getItem('mock')||'{}')}catch(e){return {}}}" +
  "window.__setMock=function(o){var s=st();Object.keys(o).forEach(function(k){s[k]=o[k]});sessionStorage.setItem('mock',JSON.stringify(s))};" +
  "window.__calls=function(){return JSON.parse(sessionStorage.getItem('calls')||'[]')};" +
  "var real=window.fetch;" +
  "window.fetch=function(url,opts){" +
  "  if(String(url).indexOf('https://api.github.com/')!==0) return real.apply(window,arguments);" +
  "  var s=st();var calls=JSON.parse(sessionStorage.getItem('calls')||'[]');" +
  "  calls.push({url:String(url),auth:(opts.headers||{}).Authorization||null,inm:(opts.headers||{})['If-None-Match']||null});sessionStorage.setItem('calls',JSON.stringify(calls));" +
  "  var status=s.status||200;var etag=s.body?'\"e2\"':'\"e1\"';" +
  "  if(s.offline) return Promise.reject(new TypeError('offline'));" +
  "  if(status===200&&(opts.headers||{})['If-None-Match']===etag) return Promise.resolve(new Response(null,{status:304,headers:{ETag:etag}}));" +
  "  return Promise.resolve(new Response(status===200?(s.body||BUNDLE):'{}',{status:status,headers:{ETag:etag}}));" +
  "};" +
  "})();";

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
  async function open(hash) {
    await send("Page.navigate", { url: "about:blank" });
    await sleep(200);
    await send("Page.navigate", { url: index + (hash || "") });
    await sleep(1200);
  }
  var T = function (sel) { return ev("document.querySelector(" + JSON.stringify(sel) + ").innerText"); };
  var H = function (sel) { return ev("document.querySelector(" + JSON.stringify(sel) + ").hidden"); };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: MOCK });

  // 1) 깨진 링크
  await open("#connect=abcd");
  check(!(await H("#connectBox")) && /깨져/.test(await T("#connectMsg")) && (await H("#btnConnectOk")), "깨진 링크는 이유를 보여 주고 연결 버튼을 숨김");
  await shot("s1_깨진링크");

  // 2) 정상 링크: 확인 화면, 주소의 열쇠 제거
  var link = enc({ v: 1, c: "A", t: TOKEN, x: "2027-11-16T15:00:00Z" });
  await open("#connect=" + link);
  check(!(await H("#connectBox")) && /아이 A/.test(await T("#connectText")), "연결 링크를 열면 확인 화면이 뜸");
  check((await ev("location.hash")) === "" && (await ev("location.href")).indexOf(TOKEN) < 0 && (await ev("location.href")).indexOf(link) < 0, "주소창에서 열쇠가 바로 지워짐");
  check((await ev("localStorage.getItem('wp.connection.v1')")) === null || (await ev("localStorage.getItem('wp.connection.v1')")) === "null", "확인을 누르기 전에는 열쇠를 저장하지 않음");
  check((await ev("window.__calls().length")) === 0, "확인을 누르기 전에는 요청을 보내지 않음");
  await shot("s2_연결확인");

  // 3) 취소
  await ev("document.getElementById('btnConnectCancel').click()");
  check(await H("#connectBox"), "취소하면 확인 화면이 닫힘");

  // 4) 연결하기
  await open("#connect=" + link);
  await ev("document.getElementById('btnConnectOk').click()");
  await sleep(800);
  check(await H("#connectBox"), "연결하면 확인 화면이 닫힘");
  check(!(await H("#syncBox")) && /연결했어요\. 단원 3개/.test(await T("#syncMsg")), "연결 결과가 보임: " + (await T("#syncMsg")).split("\n")[0]);
  var list = await T("#lessonList");
  check(/단어 Lesson 7/.test(list) && /단어 Lesson 8/.test(list) && /Chunk Quiz/.test(list), "받은 단원 3개가 목록에 보임");
  check((list.match(/부모님이 올림/g) || []).length === 3, "받은 단원에 「부모님이 올림」 표시");
  check(await ev("Array.from(document.querySelectorAll('#lessonList .card')).every(function(c){return !Array.from(c.querySelectorAll('button')).some(function(b){return b.textContent==='삭제'})})"), "받은 단원에는 삭제 버튼이 없음");
  check(!(await ev("document.getElementById('importBox').open")), "연결되면 직접 가져오기는 접혀 있음");
  check(/아이 A.*연결됨.*단원 3개/.test(await T("#syncStatus")), "연결 상태 줄: " + await T("#syncStatus"));
  var calls = await ev("window.__calls()");
  check(calls.length === 1 && calls[0].auth === "Bearer " + TOKEN && /contents\/A\.json$/.test(calls[0].url), "A.json 한 번만 요청하고 열쇠를 헤더로 보냄");
  await shot("s3_연결됨");

  // 5) 시험지 만들기가 받은 단원에서도 됨
  await ev("Array.from(document.querySelectorAll('#lessonList .card')).filter(function(c){return /단어 Lesson 8/.test(c.innerText)})[0].querySelector('button.primary').click()");
  await sleep(700);
  var sheet = await ev("document.getElementById('sheet').srcdoc");
  check(/Lesson 8/.test(sheet) && sheet.length > 5000, "받은 단원으로 시험지가 만들어짐");
  await ev("document.querySelector('#tabs button[data-tab=lessons]').click()");

  // 6) 새로 열면 저절로 확인(304)
  await open("");
  await sleep(600);
  check(/단어 Lesson 7/.test(await T("#lessonList")) && !(await H("#syncBox")), "다시 열어도 연결과 단원이 남아 있음");
  calls = await ev("window.__calls()");
  check(calls.length >= 1 && calls[calls.length - 1].inm === '"e1"', "다시 열면 저절로 확인하고, 바뀐 것이 없으면 304(If-None-Match)로 끝남");
  check((await T("#syncMsg")).trim() === "", "저절로 확인했을 때 바뀐 것이 없으면 말하지 않음");

  // 7) 직접 새로 받기: 바뀐 것 없음 / 인터넷 없음 / 열쇠 취소
  await ev("document.getElementById('btnSync').click()");
  await sleep(500);
  check(/새로 올라온 단원은 없어요/.test(await T("#syncMsg")), "「지금 새로 받기」에서 바뀐 것이 없다고 알려 줌");
  await ev("window.__setMock({offline:true}); document.getElementById('btnSync').click()");
  await sleep(500);
  check(/인터넷에 연결되지 않아서/.test(await T("#syncMsg")) && /단어 Lesson 7/.test(await T("#lessonList")), "인터넷이 없으면 저장된 단원을 그대로 보여 줌");
  await ev("window.__setMock({offline:false,status:401}); document.getElementById('btnSync').click()");
  await sleep(500);
  check(/만료되었거나/.test(await T("#syncMsg")) && /단어 Lesson 7/.test(await T("#lessonList")), "열쇠가 취소되면 새 링크를 안내하고 단원은 그대로 둠");
  await shot("s4_열쇠오류");
  await ev("window.__setMock({status:200})");

  // 8) 새 단원이 올라오면 알려 줌 (L8 만 있던 묶음 → L7, L8, chunk)
  var small = JSON.parse(BUNDLE); small.lessons = [lessons[1]];
  await ev("window.__setMock({body:" + JSON.stringify(JSON.stringify(small)) + "}); document.getElementById('btnSync').click()");
  await sleep(500);
  check(/Lesson 7/.test(await T("#lessonList")) === false && /단어 Lesson 8/.test(await T("#lessonList")), "묶음에서 빠진 단원은 목록에서도 사라짐");
  await ev("window.__setMock({body:null}); sessionStorage.setItem('mock', JSON.stringify({})); document.getElementById('btnSync').click()");
  await sleep(500);
  var note = await T("#syncMsg");
  check(/새 단원 2개를 받았어요/.test(note) && /단어 Lesson 7/.test(note), "새 단원이 올라오면 받은 단원을 알려 줌");
  await shot("s5_새단원");

  // 9) 설정 화면
  await ev("document.querySelector('#tabs button[data-tab=settings]').click()");
  var cs = await T("#connState");
  check(/아이 A.*연결됨/.test(cs) && /2027-11-16/.test(cs), "설정 화면에 연결 상태와 열쇠 만료일이 보임");
  var backup = await ev("WT.store.exportAll()");
  check(backup.indexOf(TOKEN) < 0 && JSON.parse(backup).lessons.length === 0, "백업 파일에는 열쇠와 받은 단원이 없음");
  await shot("s6_설정");

  // 10) 연결 끊기
  await ev("window.confirm=function(){return true}; document.getElementById('btnDisconnect').click()");
  await sleep(300);
  check(await H("#syncBox"), "연결을 끊으면 상태 칸이 사라짐");
  check(/아직 가져온 단원이 없어요/.test(await T("#lessonList")), "연결을 끊으면 받은 단원이 지워짐");
  var all = await ev("JSON.stringify(Object.keys(localStorage).map(function(k){return localStorage.getItem(k)}))");
  check(all.indexOf(TOKEN) < 0, "연결을 끊은 뒤 저장소에 열쇠가 남지 않음");

  // 11) 잘못된 열쇠(401)로 연결하면 저장하지 않음
  await open("#connect=" + link);
  await ev("window.__setMock({status:401}); document.getElementById('btnConnectOk').click()");
  await sleep(600);
  check(!(await H("#connectBox")) && /만료되었거나/.test(await T("#connectMsg")), "열쇠가 거부되면 연결 화면에서 이유를 보여 줌");
  var c = await ev("localStorage.getItem('wp.connection.v1')");
  check(c === null || c === "null", "실패한 연결은 저장되지 않음");
  await ev("window.__setMock({status:200})");

  // 12) 만료가 가까운 열쇠는 안내
  var soon = new Date(Date.now() + 10 * 86400000).toISOString();
  await open("#connect=" + enc({ v: 1, c: "A", t: TOKEN, x: soon }));
  await ev("document.getElementById('btnConnectOk').click()");
  await sleep(800);
  check(/10일 뒤에 만료/.test(await T("#syncExpiry")), "만료 30일 안이면 남은 날짜를 안내함: " + (await T("#syncExpiry")).trim());
  await shot("s7_만료임박");

  // 13) 아이 코드가 없는 공용 링크: 기기에서 아이를 고른다 (이 시점에는 아이 A 로 연결돼 있음)
  var shared = enc({ v: 1, t: TOKEN, x: "2027-11-16T15:00:00Z" });
  await ev("sessionStorage.setItem('calls','[]')");
  await open("#connect=" + shared);
  check(!(await H("#connectBox")) && !(await H("#connectPick")) && (await H("#btnConnectOk")) && /골라 주세요/.test(await T("#connectText")), "공용 링크를 열면 아이를 고르는 화면이 뜸");
  check(/아이 A/.test(await T("#btnPickA")) && /아이 B/.test(await T("#btnPickB")), "고르는 버튼에 「아이 A」「아이 B」가 적혀 있음");
  check((await ev("location.hash")) === "" && (await ev("window.__calls().length")) === 0, "고르기 전에는 주소에서 열쇠가 지워지고 요청도 보내지 않음");
  await shot("s8_아이고르기");
  await ev("document.getElementById('btnPickB').click()");
  var askB = await T("#connectText");
  check(/아이 B 용으로 연결할까요/.test(askB) && /⚠.*아이 A/.test(askB) && !(await H("#btnConnectOk")) && (await T("#btnConnectCancel")) === "뒤로", "아이 B 를 고르면 확인 문구와 「아이 A 단원이 지워진다」 경고가 뜸");
  await ev("document.getElementById('btnConnectCancel').click()");
  check(!(await H("#connectBox")) && !(await H("#connectPick")) && (await H("#btnConnectOk")), "「뒤로」를 누르면 아이 고르기로 돌아감(링크를 다시 열 필요 없음)");
  // 아이 A 묶음이 오는 가짜 서버에 아이 B 로 연결 시도 → 거부되고 이전 연결 유지
  await ev("document.getElementById('btnPickB').click(); document.getElementById('btnConnectOk').click()");
  await sleep(700);
  check(!(await H("#connectBox")) && /아이 A 것인데/.test(await T("#connectMsg")), "고른 아이와 묶음 주인이 다르면 거부하고 이유를 보여 줌");
  check((await ev("WT.store.getConnection().child")) === "A" && /단어 Lesson 8/.test(await T("#lessonList")), "거부되면 이전 연결(아이 A)과 단원이 그대로 남음");
  await ev("document.getElementById('btnConnectCancel').click(); document.getElementById('btnConnectCancel').click()");
  check(await H("#connectBox"), "뒤로, 취소를 차례로 누르면 화면이 닫힘");
  // 연결을 끊은 새 기기에서 아이 A 를 골라 연결
  await ev("WT.sync.disconnect()");
  await open("#connect=" + shared);
  await ev("document.getElementById('btnPickA').click()");
  check(!/⚠/.test(await T("#connectText")), "연결이 없는 기기에서는 경고가 없음");
  await ev("document.getElementById('btnConnectOk').click()");
  await sleep(800);
  var calls13 = await ev("window.__calls()");
  check(await H("#connectBox") && /연결했어요\. 단원 3개/.test(await T("#syncMsg")) && /A\.json$/.test(calls13[calls13.length - 1].url), "연결이 없는 기기에서 아이 A 를 고르면 A.json 을 받아 연결됨");
  check((await ev("WT.store.getConnection().child")) === "A" && (await ev("localStorage.getItem('wp.connection.v1')")).indexOf('"child":"A"') > 0, "고른 아이가 연결 정보에 저장됨");
  await shot("s9_공용링크연결");

  ws.close();
  proc.kill();
  console.log(fails === 0 ? "연결 화면 점검 모두 통과" : "실패 " + fails + "건");
  process.exit(fails === 0 ? 0 : 1);
})().catch(function (e) { console.error("점검 중 오류: " + e.message); try { proc.kill(); } catch (x) {} process.exit(1); });
