/* 실제 저장소 점검: 진짜 연결 링크처럼 열쇠를 넣어 Edge 로 앱을 열고, 실제 GitHub 에서 단원을 받아 오는지 확인한다.
 * 열쇠는 환경 변수 WP_READ_TOKEN 으로만 받고 화면에 출력하지 않는다.
 * 사용(PowerShell): $env:WP_READ_TOKEN = "<열쇠>"; $env:CHILD = "A"; node test/live.js "<스크린샷 폴더>"
 * APP_URL 을 주면 그 주소(예: 공개된 앱 주소)를, 주지 않으면 이 폴더의 index.html 을 연다.
 */
"use strict";
var fs = require("fs");
var path = require("path");
var cp = require("child_process");
var http = require("http");

var shotDir = process.argv[2];
var token = process.env.WP_READ_TOKEN;
var child = process.env.CHILD || "A";
if (!shotDir || !token) { console.error("스크린샷 폴더와 환경 변수 WP_READ_TOKEN 이 필요해요"); process.exit(2); }
fs.mkdirSync(shotDir, { recursive: true });
var edge = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"].filter(fs.existsSync)[0];
var index = process.env.APP_URL || ("file:///" + path.join(__dirname, "..", "index.html").replace(/\\/g, "/"));
var port = 9335;
var profile = path.join(shotDir, "profile-live");
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
    if (r.result.exceptionDetails) throw new Error("화면 안 오류");
    return r.result.result.value;
  }
  async function shot(name) {
    var r = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(shotDir, name + ".png"), Buffer.from(r.result.data, "base64"));
  }
  var T = function (sel) { return ev("document.querySelector(" + JSON.stringify(sel) + ").innerText"); };

  await send("Page.enable");
  await send("Runtime.enable");
  // 진짜 링크처럼 아이 코드 없는 공용 링크를 열고, 기기에서 아이를 고른다.
  var link = Buffer.from(JSON.stringify({ v: 1, t: token }), "utf8").toString("base64url");
  await send("Page.navigate", { url: index + "#connect=" + link });
  await sleep(1500);
  check(/골라 주세요/.test(await T("#connectText")), "아이를 고르는 화면이 뜸");
  var both = child === "AB"; // CHILD=AB 이면 「두 아이 모두」로 연결한다
  await ev("document.getElementById('btnPick" + child + "').click()");
  check(both ? /두 아이가 같이 쓰도록 연결할까요/.test(await T("#connectText")) : /용으로 연결할까요/.test(await T("#connectText")), "연결 확인 화면이 뜸");
  await ev("document.getElementById('btnConnectOk').click()");
  await sleep(both ? 5000 : 3500);
  var msg = await T("#syncMsg");
  var connMsg = await T("#connectMsg");
  check(/연결했어요\. 단원 \d+개를 받았어요/.test(msg), "실제 저장소에서 단원을 받음: " + (msg.split("\n")[0] || connMsg.split("\n")[0]));
  var list = await ev("document.getElementById('lessonList').textContent");
  var n = (list.match(/부모님이 올림/g) || []).length;
  check(n >= 1, "목록에 받은 단원이 보임(" + n + "개)");
  if (both) {
    check(!(await ev("document.getElementById('childBar').hidden")), "「지금 보는 아이」 칸이 보임");
    check(list.indexOf("아이 B") < 0, "처음에는 아이 A 단원만 보임");
    await ev("window.confirm=function(){return true}; document.getElementById('btnActiveB').click()");
    await sleep(500);
    var listB = await ev("document.getElementById('lessonList').textContent");
    var nB = (listB.match(/부모님이 올림/g) || []).length;
    check(nB >= 1 && listB.indexOf("아이 A") < 0, "아이 B 로 바꾸면 아이 B 단원(" + nB + "개)만 보임");
    check(n + nB === 12, "두 아이 단원이 합쳐서 12개(" + n + " + " + nB + ")");
  } else {
    var otherOwner = child === "A" ? "아이 B" : "아이 A";
    check(list.indexOf(otherOwner) < 0, "다른 아이(" + otherOwner + ") 단원은 보이지 않음");
  }
  await shot("live_연결됨");

  // 새로 열면 저절로 확인해서 304 로 끝나는지(요청 횟수와 상태는 화면 메시지로 확인)
  await send("Page.navigate", { url: "about:blank" });
  await sleep(200);
  await send("Page.navigate", { url: index });
  await sleep(2500);
  await ev("document.getElementById('btnSync').click()");
  await sleep(2500);
  var again = await T("#syncMsg");
  check(/새로 올라온 단원은 없어요|단원을 새로 확인했어요/.test(again), "다시 열어 새로 받기: " + again.split("\n")[0]);
  check(!(await ev("document.body.innerText")).includes(token) && !(await ev("location.href")).includes(token), "화면과 주소에 열쇠가 보이지 않음");

  ws.close();
  proc.kill();
  console.log(fails === 0 ? "실제 저장소 점검 모두 통과" : "실패 " + fails + "건");
  process.exit(fails === 0 ? 0 : 1);
})().catch(function (e) { console.error("점검 중 오류: " + e.message); try { proc.kill(); } catch (x) {} process.exit(1); });
