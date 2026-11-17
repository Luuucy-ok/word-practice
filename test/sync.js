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
var A7 = load(/^A_단어.*L07/), A8 = load(/^A_단어.*L08/), B7 = load(/^B_단어.*L07/), B8 = load(/^B_단어.*L08/);
function bundle(owner, lessons) { return { app: "word-practice-bundle", version: 1, owner: owner, publishedAt: "2026-11-17T00:00:00Z", lessons: lessons }; }

// 가짜 서버
// server.files 가 있으면 A.json, B.json 마다 따로 응답한다(두 아이 함께 연결 점검용).
var server = { status: 200, body: null, etag: '"e1"', calls: [], throwNet: false, files: null };
WT.sync._fetch = function (url, opts) {
  server.calls.push({ url: url, headers: opts.headers });
  if (server.throwNet) return Promise.reject(new TypeError("network"));
  var f = server.files ? server.files[/\/([AB])\.json$/.exec(url)[1]] : server;
  var inm = opts.headers["If-None-Match"];
  if (f.status === 200 && inm && inm === f.etag) return Promise.resolve({ status: 304, headers: { get: function () { return f.etag; } }, text: function () { return Promise.resolve(""); } });
  return Promise.resolve({
    status: f.status,
    headers: { get: function (h) { return h.toLowerCase() === "etag" ? f.etag : null; } },
    text: function () { return Promise.resolve(typeof f.body === "string" ? f.body : JSON.stringify(f.body)); }
  });
};
// 기기 저장을 비우고, 저장 코드가 메모리에 따로 들고 있는 값도 새로 시작하게 다시 읽어 들인다.
function resetStore() { store.clear(); vm.runInThisContext(fs.readFileSync(path.join(root, "js/store.js"), "utf8"), { filename: "js/store.js" }); }
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
  var pn = WT.sync.parseConnect("#connect=" + enc({ v: 1, t: TOKEN, x: "2027-11-16T15:00:00Z" }));
  check(pn && pn.child === null && pn.token === TOKEN && pn.expires === "2027-11-16T15:00:00Z", "아이 코드가 없는 링크는 child null 로 해석함(기기에서 고름)");
  check(/대상 아이/.test(throws(function () { WT.sync.parseConnect("#connect=" + enc({ v: 1, c: "", t: TOKEN })); })), "빈 아이 코드는 거부함");
  var before = server.calls.length;
  var noPick = await WT.sync.connect(pn);
  check(noPick.status === "error" && /골라/.test(noPick.message) && server.calls.length === before && WT.store.getConnection() === null, "아이를 고르지 않고 연결을 시도하면 요청 없이 거부함");
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

  // --- 두 아이를 한 기기에 함께 연결
  resetStore();
  server.files = {
    A: { status: 200, body: bundle("아이 A", [A7, A8]), etag: '"fa1"' },
    B: { status: 200, body: bundle("아이 B", [B7]), etag: '"fb1"' }
  };
  server.calls.length = 0;
  var pShared = WT.sync.parseConnect("#connect=" + enc({ v: 1, t: TOKEN, x: "2027-11-16T15:00:00Z" }));
  var both = await WT.sync.connect(Object.assign({}, pShared, { kids: ["A", "B"] }));
  var cn = WT.store.getConnection();
  check(both.status === "updated" && both.total === 3 && cn.kids.join() === "A,B" && cn.active === "A" && cn.child === "A", "두 아이를 함께 연결하면 두 묶음(3개)을 받고 연결 정보에 두 아이가 들어감");
  check(server.calls.length === 2 && /A\.json$/.test(server.calls[0].url) && /B\.json$/.test(server.calls[1].url) && server.calls.every(function (c) { return c.headers.Authorization === "Bearer " + TOKEN; }), "A.json, B.json 을 한 번씩 같은 열쇠로 요청함");
  check(WT.store.syncedState("A").lessons.length === 2 && WT.store.syncedState("B").lessons.length === 1 && WT.store.syncedState() === null, "아이별로 따로 저장되고, 아이를 정하지 않고 물으면 한 아이 것으로 보지 않음");
  var listed2 = WT.store.list().filter(function (x) { return x.synced; });
  check(listed2.length === 3 && listed2.filter(function (x) { return x.data.owner === "아이 A"; }).length === 2 && listed2.filter(function (x) { return x.data.owner === "아이 B"; }).length === 1, "목록에는 두 아이 단원이 모두 들어 있음(화면에서 지금 보는 아이로 걸러서 보여 줌)");

  server.calls.length = 0;
  var again2 = await WT.sync.run(true);
  check(again2.status === "unchanged" && server.calls.length === 2 && server.calls.every(function (c) { return c.headers["If-None-Match"] === (/A\.json$/.test(c.url) ? '"fa1"' : '"fb1"'); }), "다시 확인하면 아이마다 자기 ETag 로 물어보고 둘 다 바뀐 것이 없다고 나옴");

  server.files.B = { status: 200, body: bundle("아이 B", [B7, B8]), etag: '"fb2"' };
  var upd = await WT.sync.run(true);
  check(upd.status === "updated" && upd.added.length === 1 && upd.added[0].owner === "아이 B" && upd.total === 4 && WT.store.syncedState("B").lessons.length === 2 && WT.store.syncedState("A").lessons.length === 2, "한쪽 아이에게만 새 단원이 올라오면 그 아이 것만 바뀌고 새 단원으로 알려 줌");

  server.files.A = { status: 401, body: "{}", etag: '"fa1"' };
  server.files.B = { status: 200, body: bundle("아이 B", [B7]), etag: '"fb3"' };
  var half = await WT.sync.run(true);
  check(half.status === "error" && half.auth === true && /아이 A: 열쇠가 만료/.test(half.message) && WT.store.syncedState("B").lessons.length === 1 && WT.store.syncedState("A").lessons.length === 2, "한 아이가 오류여도 어느 아이인지 알리고, 오류난 아이 단원은 그대로이며 나머지 아이는 정상으로 받음");
  server.files.A = { status: 200, body: bundle("아이 B", [B7]), etag: '"fa2"' };
  var wrongOwner = await WT.sync.run(true);
  check(wrongOwner.status === "error" && /^아이 A: /.test(wrongOwner.message) && wrongOwner.errors.some(function (e) { return /아이 B 것인데/.test(e); }) && WT.store.syncedState("A").lessons.length === 2, "아이 A 묶음에 아이 B 단원이 섞여 오면 거부하고 아이 A 단원은 그대로임");
  server.files.A = { status: 200, body: bundle("아이 A", [A7, A8]), etag: '"fa1"' };

  // 하나라도 받지 못하면 새 연결을 하지 않음(이전 연결과 단원 그대로)
  var beforeConn = JSON.stringify(WT.store.getConnection()), beforeSynced = JSON.stringify(WT.store.syncedSnapshot());
  server.files.B = { status: 404, body: "{}", etag: '"x"' };
  var partial = await WT.sync.connect(Object.assign({}, pShared, { kids: ["A", "B"], token: "github_pat_" + "z".repeat(40) }));
  check(partial.status === "error" && JSON.stringify(WT.store.getConnection()) === beforeConn && JSON.stringify(WT.store.syncedSnapshot()) === beforeSynced, "두 아이 연결 중 한쪽을 받지 못하면 이전 연결과 단원을 그대로 두고 새 열쇠는 저장하지 않음");
  server.files.B = { status: 200, body: bundle("아이 B", [B7, B8]), etag: '"fb2"' };

  // 지금 보는 아이 바꾸기
  check(WT.store.setActive("B") === true && WT.store.getConnection().active === "B" && WT.store.getConnection().child === "B" && WT.store.setActive("C") === false && WT.store.getConnection().active === "B", "지금 보는 아이를 바꿀 수 있고, 모르는 아이는 거부함");
  check(JSON.parse(store.get("wp.connection.v1")).active === "B", "지금 보는 아이가 저장되어 새로 열어도 유지됨");

  // 한 아이 빼기와 다시 더하기(링크 없이, 저장된 열쇠로)
  check(WT.sync.removeChild("B") === true && WT.store.getConnection().kids.join() === "A" && WT.store.getConnection().active === "A" && WT.store.syncedState("B") === null && WT.store.syncedState("A").lessons.length === 2, "아이 B 를 빼면 아이 B 단원만 지워지고 지금 보는 아이는 아이 A 로 돌아옴");
  check(WT.sync.removeChild("A") === false && WT.store.getConnection().kids.join() === "A", "마지막 한 아이는 뺄 수 없음");
  server.calls.length = 0;
  server.files.B = { status: 404, body: "{}", etag: '"x"' };
  var addFail = await WT.sync.addChild("B");
  check(addFail.status === "error" && WT.store.getConnection().kids.join() === "A" && WT.store.syncedState("B") === null, "아이 B 를 더하다 실패하면 아무것도 바꾸지 않음");
  server.files.B = { status: 200, body: bundle("아이 B", [B7, B8]), etag: '"fb2"' };
  server.calls.length = 0;
  var add = await WT.sync.addChild("B");
  check(add.status === "updated" && WT.store.getConnection().kids.join() === "A,B" && WT.store.syncedState("B").lessons.length === 2 && server.calls.length === 1 && /B\.json$/.test(server.calls[0].url) && server.calls[0].headers.Authorization === "Bearer " + TOKEN, "링크 없이 저장된 열쇠로 아이 B 를 더하면 B.json 만 한 번 받음");
  var addAgain = await WT.sync.addChild("B");
  check(addAgain.status === "unchanged" && /이미 연결/.test(addAgain.message), "이미 연결된 아이를 또 더하지 않음");

  // 두 아이 연결에서 한 아이 전용으로 다시 연결하면 다른 아이 단원이 지워짐
  var solo = await WT.sync.connect(Object.assign({}, pShared, { child: "A" }));
  check(solo.status === "updated" && WT.store.getConnection().kids.join() === "A" && WT.store.syncedState("B") === null, "한 아이 전용으로 다시 연결하면 다른 아이 단원이 이 기기에서 지워짐");
  WT.sync.disconnect();
  check(WT.store.getConnection() === null && WT.store.list().every(function (x) { return !x.synced; }), "두 아이를 연결했어도 연결을 끊으면 열쇠와 단원이 모두 지워짐");

  // --- 한 아이만 연결하던 예전 저장 형식을 새 형식으로 읽음(이미 쓰고 있는 태블릿)
  resetStore();
  store.set("wp.connection.v1", JSON.stringify({ child: "B", token: TOKEN, expires: "2027-11-16T15:00:00Z", etag: '"old"', connectedAt: "2026-11-17T01:00:00Z", lastSync: "2026-11-17T01:00:00Z", lastStatus: "updated" }));
  store.set("wp.synced.v1", JSON.stringify({ child: "B", publishedAt: "p", syncedAt: "s", lessons: [B7] }));
  var legacy = WT.store.getConnection();
  check(legacy && legacy.kids.join() === "B" && legacy.child === "B" && legacy.active === "B" && legacy.children.B.etag === '"old"' && !("etag" in legacy), "예전 형식 연결 정보를 새 형식으로 읽음(아이 B, ETag 유지)");
  check(WT.store.syncedState("B").lessons.length === 1 && WT.store.syncedState().child === "B" && WT.store.list().filter(function (x) { return x.synced; }).length === 1, "예전 형식으로 받아 둔 단원도 그대로 보임");
  server.files = { A: { status: 200, body: bundle("아이 A", [A7]), etag: '"fa1"' }, B: { status: 200, body: bundle("아이 B", [B7]), etag: '"old"' } };
  server.calls.length = 0;
  var legacyRun = await WT.sync.run(true);
  check(legacyRun.status === "unchanged" && server.calls.length === 1 && server.calls[0].headers["If-None-Match"] === '"old"', "예전 형식 기기도 저장된 ETag 로 물어보고 바뀐 것이 없으면 304 로 끝남");
  var addToLegacy = await WT.sync.addChild("A");
  check(addToLegacy.status === "updated" && WT.store.getConnection().kids.join() === "A,B" && WT.store.getConnection().active === "B" && WT.store.syncedState("B").lessons.length === 1, "예전 형식 기기에 아이 A 를 더해도 지금 보던 아이 B 와 단원이 그대로임");
  check(store.get("wp.synced.v1") === "null" && JSON.parse(store.get("wp.synced.v2")).A && JSON.parse(store.get("wp.synced.v2")).B, "새 형식으로 저장하면 예전 저장값은 비움");
  server.files = null;

  console.log(fails === 0 ? "자동 받기 점검 모두 통과" : "실패 " + fails + "건");
  process.exit(fails === 0 ? 0 : 1);
})().catch(function (e) { console.error("점검 중 오류: " + e.stack); process.exit(1); });
