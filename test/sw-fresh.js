/* 새로 올린 앱이 10분 늦게 반영되지 않는지 점검: GitHub Pages 처럼 max-age=600 을 붙여 서버를 열고,
 * 서버 쪽 파일을 바꾼 뒤 다시 열었을 때 새 내용이 바로 오는지 본다.
 * 사용: node test/sw-fresh.js ["<비교할 sw.js 경로>"]   (경로를 주면 그 서비스 워커로 점검한다)
 */
"use strict";
var fs = require("fs");
var path = require("path");
var http = require("http");
var cp = require("child_process");
var crypto = require("crypto");

var root = path.join(__dirname, "..");
var swFile = process.argv[2] || path.join(root, "sw.js");
var marker = 1;
var server = http.createServer(function (req, res) {
  var u = req.url.split("?")[0];
  if (u === "/__set") { marker = Number(req.url.split("n=")[1]); res.end("ok"); return; }
  var rel = u === "/" ? "index.html" : u.slice(1);
  var file = rel === "sw.js" ? swFile : path.join(root, rel);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; res.end(); return; }
  var body = fs.readFileSync(file);
  if (rel === "js/util.js") body = Buffer.concat([body, Buffer.from("\nwindow.__marker=" + marker + ";")]);
  var etag = '"' + crypto.createHash("md5").update(body).digest("hex") + '"';
  var types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
  res.setHeader("Cache-Control", "max-age=600");
  res.setHeader("ETag", etag);
  res.setHeader("Content-Type", types[path.extname(rel)] || "application/octet-stream");
  if (req.headers["if-none-match"] === etag) { res.statusCode = 304; res.end(); return; }
  res.end(body);
});

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function getJson(url) { return new Promise(function (res, rej) { http.get(url, function (r) { var b = ""; r.on("data", function (d) { b += d; }); r.on("end", function () { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on("error", rej); }); }

server.listen(0, "127.0.0.1", async function () {
  var base = "http://127.0.0.1:" + server.address().port + "/";
  var edge = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"].filter(fs.existsSync)[0];
  var port = 9336;
  var profile = path.join(require("os").tmpdir(), "wp-sw-fresh-" + Date.now());
  var proc = cp.spawn(edge, ["--headless=new", "--disable-gpu", "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "about:blank"], { stdio: "ignore" });
  var fails = 0;
  try {
    var targets;
    for (var i = 0; i < 40; i++) { try { targets = await getJson("http://127.0.0.1:" + port + "/json"); if (targets.length) break; } catch (e) {} await sleep(250); }
    var page = targets.filter(function (t) { return t.type === "page"; })[0];
    var ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise(function (r) { ws.onopen = r; });
    var id = 0, pending = {};
    ws.onmessage = function (m) { var d = JSON.parse(m.data); if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; } };
    var send = function (method, params) { return new Promise(function (r) { var n = ++id; pending[n] = r; ws.send(JSON.stringify({ id: n, method: method, params: params || {} })); }); };
    var ev = async function (expr) { var r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); return r.result.result.value; };
    await send("Page.enable"); await send("Runtime.enable");
    await send("Page.navigate", { url: base }); await sleep(2500);
    await send("Page.navigate", { url: base }); await sleep(1500);
    var m1 = await ev("window.__marker");
    var sw = await ev("navigator.serviceWorker.controller ? 'yes' : 'no'");
    console.log("처음: marker=" + m1 + ", 서비스 워커 제어=" + sw);
    await ev("fetch('/__set?n=2').then(function(r){return r.text()})");
    await send("Page.navigate", { url: "about:blank" }); await sleep(300); // 앱을 닫았다가 다시 여는 것과 같게 한다
    await send("Page.navigate", { url: base }); await sleep(2000);
    var m2 = await ev("window.__marker");
    var ok = m2 === 2;
    console.log((ok ? "통과: " : "실패: ") + "서버 파일을 바꾼 뒤 다시 열면 바로 새 내용이 옴(marker=" + m2 + ")");
    if (!ok) fails++;
    ws.close();
  } catch (e) { console.error("점검 중 오류: " + e.message); fails++; }
  try { proc.kill(); } catch (e) {}
  server.close();
  process.exit(fails ? 1 : 0);
});
