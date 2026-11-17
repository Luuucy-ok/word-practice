/* 자동 받기 점검: 가짜 GitHub 응답으로 연결 링크, 받기, 오류 처리, 저장 규칙을 확인한다. (인터넷 접속 없음)
 * 사용: node test/sync.js "<단원 데이터 폴더>"
 * 교재 데이터는 이 저장소에 두지 않는다. 폴더는 저장소 밖의 경로를 준다.
 */
"use strict";
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var store = new Map();
globalThis.localStorage = {
  getItem: function (k) { return store.has(k) ? store.get(k) : null; },
  setItem: function (k, v) { store.set(k, String(v)); },
  removeItem: function (k) { store.delete(k); }
};
var root = path.join(__dirname, "..");
["js/util.js", "js/word.js", "js/chunk.js", "js/store.js", "js/sync.js"].forEach(function (f) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), "utf8"), { filename: f });
});
var WT = globalThis.WT;

var dataDir = process.argv[2];
if (!dataDir) { console.error("단원 데이터 폴더를 인자로 주세요"); process.exit(2); }
var fails = 0;
function check(c, m) { console.log((c ? "통과: " : "실패: ") + m); if (!c) fails++; }
function load(re) {
  var f = fs.readdirSync(dataDir).filter(function (x) { return re.test(x); })[0];
  return JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8"));
}
function enc(o) { return Buffer.from(JSON.stringify(o), "utf8").toString("base64url"); }

var TOKEN = "github_pat_" + "x".repeat(40);
var A7 = load(/^A_단어.*L07/), A8 = load(/^A_단어.*L08/), B7 = load(/^B_단어.*L07/);
function bundle(owner, lessons) { return { app: "word-practice-bundle", version: 1, owner: owner, publishedAt: "2026-11-17T00:00:00Z", lessons: lessons }; }

// 가짜 서버
var server = { status: 200, body: null, etag: '"e1"', calls: [], throwNet: false };
WT.sync._fetch = function (url, opts) {
  server.calls.push({ url: url, headers: opts.headers });
  if (server.throwNet) return Promise.reject(new TypeError("network"));
  var inm = opts.headers["If-None-Match"];
  if (server.status === 200 && inm && inm === server.etag) return Promise.resolve({ status: 304, headers: { get: function () { return server.etag; } }, text: function () { return Promise.resolve(""); } });
  return Promise.resolve({
    status: server.status,
    headers: { get: function (h) { return h.toLowerCase() === "etag" ? server.etag : null; } },
    text: function () { return Promise.resolve(typeof server.body === "string" ? server.body : JSON.stringify(server.body)); }
  });
};
var clock = Date.parse("2026-11-17T01:00:00Z");
WT.sync._now = function () { return clock; };

function throws(fn) { try { fn(); return null; } catch (e) { return e.message; } }

(async function () {
  // --- 연결 링크 해석
  check(WT.sync.parseConnect("#other") === null && WT.sync.parseConnect("") === null, "연결 링크가 아닌 주소는 무시함");
  var p = WT.sync.parseConnect("#connect=" + enc({ v: 1, c: "A", t: TOKEN, x: "2027-11-16T15:00:00Z" }));
  check(p && p.child === "A" && p.token === TOKEN && p.expires === "2027-11-16T15:00:00Z", "정상 링크를 해석함");
  check(/깨져/.test(throws(function () { WT.sync.parseConnect("#connect=%%%"); }) || "") === false, "(주소 문자 규칙 밖이면 링크로 보지 않음)");
  check(/깨져/.test(throws(function () { WT.sync.parseConnect("#connect=abcd"); })), "내용이 JSON 이 아니면 이유를 알려 줌");
  check(/대상 아이/.test(throws(function () { WT.sync.parseConnect("#connect=" + enc({ v: 1, c: "C", t: TOKEN })); })), "알 수 없는 아이 코드를 거부함");
  check(/열쇠/.test(throws(function () { WT.sync.parseConnect("#connect=" + enc({ v: 1, c: "A", t: "짧음 abc" })); })), "열쇠 형식이 이상하면 거부함");
  check(/이 앱에서 쓸 수 없는/.test(throws(function () { WT.sync.parseConnect("#connect=" + enc({ v: 2, c: "A", t: TOKEN })); })), "버전이 다른 링크를 거부함");

  // --- 연결 전에는 아무것도 하지 않음
  var r0 = await WT.sync.run(true);
  check(r0.status === "none" && server.calls.length === 0, "연결 전에는 요청을 보내지 않음");

  // --- 직접 가져온 단원 하나
  WT.store.importText(JSON.stringify(B7), "수동");
  check(WT.store.list().length === 1, "수동 가져오기 1개");

  // --- 한나 기기로 연결: 한나 묶음 받기
  server.body = bundle("아이 A", [A7, A8]);
  var c1 = await WT.sync.connect(p);
  check(c1.status === "updated" && c1.total === 2 && c1.added.length === 2, "연결하면 단원 2개를 받음: " + c1.message);
  check(/\/contents\/A\.json$/.test(server.calls[0].url) && server.calls[0].url.indexOf("Luuucy-ok/word-practice-data") > 0, "정해진 저장소의 A.json 만 요청함");
  check(server.calls[0].headers.Authorization === "Bearer " + TOKEN, "열쇠를 Authorization 으로만 보냄");
  var names = WT.store.list().map(function (x) { return x.synced ? "자동" : "수동"; }).sort().join();
  check(names === "수동,자동,자동", "자동 받은 단원과 수동 단원이 함께 보임(" + names + ")");
  check(WT.store.getConnection().child === "A" && WT.store.getConnection().expires === p.expires, "연결 정보가 저장됨");

  // --- 백업에는 열쇠와 자동 받은 단원이 없음
  var bk = WT.store.exportAll();
  check(bk.indexOf(TOKEN) < 0 && JSON.parse(bk).lessons.length === 1, "백업에 열쇠가 없고 수동 단원만 들어감");

  // --- 바뀐 것이 없으면 304
  clock += 11 * 60 * 1000;
  var u1 = await WT.sync.run(false);
  check(u1.status === "unchanged" && server.calls[server.calls.length - 1].headers["If-None-Match"] === '"e1"', "바뀐 것이 없으면 304 로 끝남");

  // --- 10분 안에 다시 부르면 건너뜀
  var n = server.calls.length;
  var sk = await WT.sync.run(false);
  check(sk.status === "skipped" && server.calls.length === n, "10분 안에는 다시 확인하지 않음");

  // --- 새 단원이 올라옴: 알림, 없어진 단원 제거
  server.etag = '"e2"';
  server.body = bundle("아이 A", [A8, load(/^A_단어.*L05/)]);
  var u2 = await WT.sync.run(true);
  check(u2.status === "updated" && u2.added.length === 1 && /Lesson 5/.test(WT.sync.lessonLabel(u2.added[0])), "새 단원 1개를 알려 줌: " + u2.message);
  check(WT.store.list().filter(function (x) { return x.synced; }).length === 2, "묶음에서 빠진 단원(L7)은 이 기기에서도 사라짐");
  check(WT.store.list().filter(function (x) { return !x.synced; }).length === 1, "수동 단원은 그대로 남음");

  // --- 같은 단원이 수동과 자동에 모두 있으면 자동 쪽이 보임
  WT.store.importText(JSON.stringify(A8), "수동 A8");
  var l8 = WT.store.list().filter(function (x) { return x.id === WT.store.lessonId(A8); });
  check(l8.length === 1 && l8[0].synced === true, "같은 단원은 한 번만 보이고 자동 쪽을 씀");

  // --- 오류: 대상이 다른 단원이 섞임(한선 단원이 한나 묶음에)
  server.etag = '"e3"';
  server.body = bundle("아이 A", [A8, B7]);
  var before = JSON.stringify(WT.store.syncedState().lessons);
  var e1 = await WT.sync.run(true);
  check(e1.status === "error" && e1.errors.length === 1 && /아이 B/.test(e1.errors[0]), "다른 아이 단원이 섞이면 거부함: " + e1.errors[0]);
  check(JSON.stringify(WT.store.syncedState().lessons) === before, "거부했을 때 이전 단원을 그대로 둠");

  // --- 오류: 묶음 대상이 다름
  server.body = bundle("아이 B", [B7]);
  var e2 = await WT.sync.run(true);
  check(e2.status === "error" && /아이 B 것인데/.test(e2.errors[0]), "묶음 대상이 다르면 거부함");

  // --- 오류: 필수 항목이 빠진 단원
  var broken = JSON.parse(JSON.stringify(A8)); delete broken.sentence_sources;
  server.body = bundle("아이 A", [broken]);
  var e3 = await WT.sync.run(true);
  check(e3.status === "error" && /sentence_sources/.test(e3.errors[0]), "필수 항목이 없는 단원을 거부함");
  check(WT.store.syncedState().lessons.length === 2, "필수 항목 오류 뒤에도 이전 단원이 남음");

  // --- 오류: JSON 이 아님, HTTP 오류들
  server.body = "<html>nope</html>";
  var e4 = await WT.sync.run(true);
  check(e4.status === "error" && /읽지 못했어요/.test(e4.message), "깨진 파일을 거부함");
  server.body = bundle("아이 A", [A8]);
  server.status = 401;
  var e5 = await WT.sync.run(true);
  check(e5.status === "error" && e5.auth === true && /만료되었거나/.test(e5.message), "401 은 열쇠 문제로 알려 줌");
  server.status = 404;
  var e6 = await WT.sync.run(true);
  check(e6.status === "error" && /찾지 못했어요/.test(e6.message), "404 는 파일 없음으로 알려 줌");
  server.status = 403;
  check((await WT.sync.run(true)).status === "error", "403 도 오류로 알려 줌");
  server.status = 200; server.throwNet = true;
  var e7 = await WT.sync.run(true);
  check(e7.status === "offline" && WT.store.syncedState().lessons.length === 2, "인터넷이 없으면 저장된 단원을 그대로 보여 줌");
  server.throwNet = false;
  check(WT.store.getConnection().lastStatus === "offline" && !!WT.store.getConnection().lastSync, "마지막으로 성공한 시각은 오류가 나도 지워지지 않음");

  // --- 만료
  var days = WT.sync.daysLeft(WT.store.getConnection());
  check(days > 360 && days < 370, "만료까지 남은 날짜를 셈: " + days);
  clock = Date.parse("2027-11-17T00:00:00Z");
  var ex = await WT.sync.run(true);
  check(ex.status === "error" && ex.auth === true && /만료되었어요/.test(ex.message), "만료일이 지나면 요청 없이 안내함");
  clock = Date.parse("2026-11-17T01:00:00Z");

  // --- 잘못된 열쇠로 새로 연결하면 저장하지 않음
  var callsBefore = JSON.stringify(WT.store.getConnection());
  server.status = 401;
  var bad = await WT.sync.connect(WT.sync.parseConnect("#connect=" + enc({ v: 1, c: "A", t: "github_pat_" + "y".repeat(40) })));
  check(bad.status === "error" && JSON.stringify(WT.store.getConnection()) === callsBefore, "실패한 연결은 기존 연결을 바꾸지 않음");
  server.status = 200;

  // --- 다른 아이로 바꾸기: 성공하면 이전 아이 단원이 사라짐, 실패하면 되돌림
  var pB = WT.sync.parseConnect("#connect=" + enc({ v: 1, c: "B", t: TOKEN }));
  server.status = 404;
  var sw1 = await WT.sync.connect(pB);
  check(sw1.status === "error" && WT.store.getConnection().child === "A" && WT.store.syncedState().lessons.length === 2, "아이 B 로 바꾸다 실패하면 아이 A 연결과 단원이 그대로임");
  server.status = 200; server.etag = '"b1"';
  server.body = bundle("아이 B", [B7]);
  var sw2 = await WT.sync.connect(pB);
  var after = WT.store.list().filter(function (x) { return x.synced; });
  check(sw2.status === "updated" && WT.store.getConnection().child === "B" && after.length === 1 && after[0].data.owner === "아이 B", "아이 B 로 바꾸면 아이 B 단원만 자동 단원으로 남음");

  // --- 연결 끊기
  WT.sync.disconnect();
  check(WT.store.getConnection() === null && WT.store.list().every(function (x) { return !x.synced; }), "연결을 끊으면 열쇠와 자동 단원이 지워지고 수동 단원은 남음");
  check(Array.from(store.values()).every(function (v) { return v.indexOf(TOKEN) < 0; }), "연결을 끊은 뒤 저장소 어디에도 열쇠가 없음");

  console.log(fails === 0 ? "자동 받기 점검 모두 통과" : "실패 " + fails + "건");
  process.exit(fails === 0 ? 0 : 1);
})().catch(function (e) { console.error("점검 중 오류: " + e.stack); process.exit(1); });
