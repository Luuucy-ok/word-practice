/* 기기 안 저장(localStorage). 교재 데이터는 이 기기 브라우저에만 저장되고 서버로 보내지 않는다.
 * 저장소를 쓸 수 없는 환경(비공개 창 등)에서는 이번 접속 동안만 메모리에 둔다. */
(function (root) {
  "use strict";
  var WT = (root.WT = root.WT || {});
  var KEY_LESSONS = "wp.lessons.v1";
  var KEY_SETTINGS = "wp.settings.v1";
  var KEY_SYNCED_OLD = "wp.synced.v1";
  var KEY_SYNCED = "wp.synced.v2";
  var KEY_CONN = "wp.connection.v1";
  var KEY_WEAK = "wp.weak.v1"; // 틀린 단어 표시: { 단원 id: { 항목 키: { at: 표시한 시각, ok: 표시 뒤 연속으로 맞힌 횟수 } } }. 단원 데이터와 따로 저장해서 새 단원을 받아도 남는다.
  var KEY_FIXES = "wp.fixes.v1"; // 확인 표에서 적어 둔 고칠 곳(앱의 단원은 바꾸지 않음)
  var KEY_RESULTS = "wp.results.v1"; // 화면에서 푼 시험 기록(최근 것부터 최대 MAX_RESULTS 개)
  var KEY_BOX = "wp.box.v1"; // 5칸 상자 복습 기록(아래 「5칸 상자 복습」)
  var KEY_BOXDAY = "wp.boxday.v1"; // 오늘 복습한 항목(하루 최대 개수 세기용)
  var MAX_RESULTS = 300;
  var CLEAR_AFTER = 2; // 약한 항목을 화면 시험에서 연속으로 이만큼 맞히면 약한 목록에서 뺀다
  var mem = {};
  var persistent = true;

  function read(key) {
    try {
      var v = root.localStorage.getItem(key);
      return v === null ? (mem[key] || null) : v;
    } catch (e) { persistent = false; return mem[key] || null; }
  }
  function write(key, val) {
    mem[key] = val;
    try { root.localStorage.setItem(key, val); } catch (e) { persistent = false; }
  }

  function parse(text, fallback) {
    try { var v = JSON.parse(text); return v === null ? fallback : v; } catch (e) { return fallback; }
  }

  function lessonId(d) {
    return [d.kind, d.owner, d.book || "", d.kind === "word" ? "L" + d.lesson : "", d.title || "", d.class_code || ""].join("|");
  }

  // 직접 가져온 단원(수동)과, 부모님 데이터 저장소에서 자동으로 받은 단원(synced)을 따로 저장한다.
  // 자동으로 받은 단원은 받을 때마다 통째로 바뀌고, 직접 가져온 단원은 그대로 남는다.
  function manualList() { return parse(read(KEY_LESSONS), []); }
  function saveList(arr) { write(KEY_LESSONS, JSON.stringify(arr)); }

  // 자동으로 받은 단원은 아이별로 따로 저장한다: { A: { publishedAt, syncedAt, lessons }, B: { ... } }.
  // 아이 한 명만 연결하던 예전 형식(wp.synced.v1)은 읽을 때 새 형식으로 옮긴다.
  function syncedAll() {
    var s = parse(read(KEY_SYNCED), null);
    var out = {};
    if (isObj(s)) {
      ["A", "B"].forEach(function (c) { if (isObj(s[c]) && Array.isArray(s[c].lessons)) out[c] = s[c]; });
      return out;
    }
    var old = parse(read(KEY_SYNCED_OLD), null);
    if (old && (old.child === "A" || old.child === "B") && Array.isArray(old.lessons)) {
      out[old.child] = { publishedAt: old.publishedAt || null, syncedAt: old.syncedAt, lessons: old.lessons };
    }
    return out;
  }
  function saveSyncedAll(all) { write(KEY_SYNCED, JSON.stringify(all)); write(KEY_SYNCED_OLD, "null"); }

  // child 를 주면 그 아이의 자동 단원을, 주지 않으면 자동 단원이 한 아이 것뿐일 때 그 아이의 것을 돌려준다.
  function syncedState(child) {
    var all = syncedAll();
    if (!child) {
      var ks = Object.keys(all);
      if (ks.length !== 1) return null;
      child = ks[0];
    }
    var s = all[child];
    return s ? { child: child, publishedAt: s.publishedAt, syncedAt: s.syncedAt, lessons: s.lessons } : null;
  }
  function setSynced(state) {
    var all = syncedAll();
    all[state.child] = { publishedAt: state.publishedAt, syncedAt: state.syncedAt, lessons: state.lessons };
    saveSyncedAll(all);
  }
  function clearSynced(child) {
    if (!child) { saveSyncedAll({}); return; }
    var all = syncedAll();
    delete all[child];
    saveSyncedAll(all);
  }
  function syncedSnapshot() { return JSON.parse(JSON.stringify(syncedAll())); }
  function restoreSynced(snap) { saveSyncedAll(snap || {}); }

  // 연결 정보: { token, expires, connectedAt, children: { A: { etag }, B: { etag } }, active, lastSync ... }.
  // 읽을 때 child(= active, 지금 보는 아이)와 kids(연결된 아이 목록)를 덧붙인다. 아이 한 명 형식(child, etag)도 새 형식으로 옮긴다.
  function getConnection() {
    var c = parse(read(KEY_CONN), null);
    if (!isObj(c) || !c.token) return null;
    var kids = isObj(c.children) ? Object.keys(c.children).filter(function (k) { return k === "A" || k === "B"; }).sort() : [];
    if (!kids.length) {
      if (c.child !== "A" && c.child !== "B") return null;
      c.children = {};
      c.children[c.child] = { etag: c.etag || null };
      kids = [c.child];
    }
    delete c.etag;
    if (kids.indexOf(c.active) < 0) c.active = kids.indexOf(c.child) >= 0 ? c.child : kids[0];
    c.child = c.active;
    c.kids = kids;
    return c;
  }
  function saveConnection(c) {
    var copy = Object.assign({}, c);
    delete copy.kids;
    if (copy.active) copy.child = copy.active;
    write(KEY_CONN, JSON.stringify(copy));
  }
  function clearConnection() { write(KEY_CONN, "null"); }
  function setActive(code) {
    var c = getConnection();
    if (!c || c.kids.indexOf(code) < 0) return false;
    c.active = code;
    saveConnection(c);
    return true;
  }

  // 화면에 보여 줄 전체 목록(두 아이를 함께 연결했으면 두 아이 것이 모두 들어 있다). 같은 단원이 양쪽에 있으면 자동으로 받은 쪽을 쓴다.
  function list() {
    var manual = manualList();
    var all = syncedAll();
    var ids = {};
    var out = [];
    Object.keys(all).sort().forEach(function (child) {
      var s = all[child];
      s.lessons.forEach(function (raw) {
        var id = lessonId(raw);
        ids[id] = true;
        out.push({ id: id, kind: raw.kind, addedAt: s.syncedAt, data: raw, synced: true });
      });
    });
    manual.forEach(function (x) { if (!ids[x.id]) out.push(x); });
    return out;
  }

  function remove(id) { saveList(manualList().filter(function (x) { return x.id !== id; })); }
  function removeAll() { saveList([]); }

  function settings() { return Object.assign({ nameA: "", nameB: "" }, parse(read(KEY_SETTINGS), {})); }
  function saveSettings(s) { write(KEY_SETTINGS, JSON.stringify(s)); }

  // 학원 시험을 본 단원(「시험 끝」 표시): settings.done = { 단원 id: 표시한 시각 }. 단원 id 는 다시 받아도 같아서 표시가 남는다.
  function doneAt(id) { var d = settings().done; return isObj(d) && typeof d[id] === "string" ? d[id] : null; }
  // 학원 시험 점수(단원마다 하나, 다시 적으면 고침): settings.academy = { 단원 id: { date, score, total, memo, wrong: [항목 키], owner, title, kind, at, trophy } }
  function academyAll() { var a = settings().academy; return isObj(a) ? a : {}; }
  function academyFor(id) { var r = academyAll()[id]; return isObj(r) && typeof r.score === "number" ? r : null; }
  function setAcademy(id, rec) {
    var s = settings();
    s.academy = Object.assign({}, isObj(s.academy) ? s.academy : {});
    if (rec) s.academy[id] = Object.assign({}, rec, { at: new Date().toISOString() }); else delete s.academy[id];
    saveSettings(s);
  }
  function setDone(id, on) {
    var s = settings();
    s.done = Object.assign({}, isObj(s.done) ? s.done : {});
    if (on) s.done[id] = new Date().toISOString(); else delete s.done[id];
    saveSettings(s);
  }

  // ---------------------------------------------------------------- 틀린 단어(약한 단어) 표시
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isObj(v) { return v && typeof v === "object" && !Array.isArray(v); }

  function weakAll() {
    var w = parse(read(KEY_WEAK), {});
    return isObj(w) ? w : {};
  }
  function saveWeak(all) { write(KEY_WEAK, JSON.stringify(all)); }

  // 단원 안의 표시할 수 있는 항목. 키는 단원 데이터가 바뀌어도 같게 유지되도록 단어·문장 글자로 만든다.
  function weakItems(raw) {
    var plain = WT.util.plain;
    if (raw.kind === "word") {
      return (raw.words || []).map(function (w) {
        return { key: w.word, group: "단어", label: w.word, sub: plain(w.ko || ""), base: !!w.weak };
      });
    }
    var out = [];
    (raw.vocab || []).forEach(function (v) {
      out.push({ key: "v|" + v.word, group: "Key Vocabulary", label: v.word, sub: plain(v.ko || ""), base: !!v.weak });
    });
    (raw.chunks || []).forEach(function (c) {
      out.push({ key: "c|" + c.sentence, group: "Chunk 문장", label: c.sentence.replace(/[{}]/g, ""), sub: plain(c.ko || ""), base: !!c.weak });
    });
    return out;
  }

  function isWeak(id, key) { var m = weakAll()[id]; return !!(m && isObj(m) && has(m, key)); }

  function setWeak(id, key, on) {
    var all = weakAll();
    var m = isObj(all[id]) ? all[id] : {};
    if (on) m[key] = { at: new Date().toISOString() }; else delete m[key];
    if (Object.keys(m).length) all[id] = m; else delete all[id];
    saveWeak(all);
  }

  function clearWeak(id) {
    var all = weakAll();
    delete all[id];
    saveWeak(all);
  }

  // 이 단원에서 지금 약한 항목 수(기기에 표시한 것 + 단원 데이터 자체의 weak 표시). 데이터에서 사라진 항목은 세지 않는다.
  function weakCount(it) {
    return weakItems(it.data).filter(function (x) { return x.base || isWeak(it.id, x.key); }).length;
  }

  // 화면 시험의 채점 결과를 틀린 표시에 반영한다. byKey: { 항목 키: 맞혔는지 }.
  // 틀리면 약한 목록에 넣고(이미 있으면 연속 맞힘 횟수를 0으로), 약한 항목을 맞히면 횟수를 올려 CLEAR_AFTER 번 연속이면 뺀다.
  // 단원 데이터 자체의 weak 표시는 바꾸지 않는다.
  function applyGrading(id, byKey) {
    var all = weakAll();
    var m = isObj(all[id]) ? all[id] : {};
    var now = new Date().toISOString();
    var res = { added: [], again: [], cleared: [], progress: [] };
    Object.keys(byKey).forEach(function (key) {
      if (!byKey[key]) {
        (has(m, key) ? res.again : res.added).push(key);
        m[key] = { at: now, ok: 0 };
      } else if (has(m, key)) {
        var n = (isObj(m[key]) && typeof m[key].ok === "number" ? m[key].ok : 0) + 1;
        if (n >= CLEAR_AFTER) { delete m[key]; res.cleared.push(key); }
        else { m[key] = { at: (isObj(m[key]) && m[key].at) || now, ok: n }; res.progress.push(key); }
      }
    });
    if (Object.keys(m).length) all[id] = m; else delete all[id];
    saveWeak(all);
    return res;
  }

  // ---------------------------------------------------------------- 5칸 상자 복습(Leitner)
  // { 단원 id: { 항목 키: { b: 칸(1~5, 6 = 졸업), due: "YYYY-MM-DD"(졸업이면 null), at: 마지막으로 바뀐 시각 } } }
  // 외우기(직접 쓰는 활동)나 태블릿 시험에서 처음 답한 항목이 들어온다(틀리면 1칸, 맞으면 2칸). 이미 있는 항목은 바꾸지 않는다.
  // 칸은 「오늘의 복습」에서만 움직인다: 맞히면 한 칸 위로(5칸에서 맞히면 졸업), 틀리면 1칸으로. 틀린 단어 표시와는 따로 둔다.
  var BOX_DAYS = [0, 1, 2, 4, 7, 14]; // 칸마다 다음 복습까지 날짜 수(1칸 매일 … 5칸 2주)
  var BOX_GRAD = 6;
  var REVIEW_MAX = 20; // 하루에 내는 복습 최대 개수(남은 것은 다음 날로)
  var dayShift = 0; // 점검용: 날짜를 앞으로 옮긴다
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function dayStr(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function today() { return dayStr(new Date(Date.now() + dayShift * 864e5)); }
  function addDays(day, n) { var p = day.split("-"); return dayStr(new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n)); }
  function daysBetween(a, b) {
    var pa = a.split("-"), pb = b.split("-");
    return Math.round((new Date(Number(pb[0]), Number(pb[1]) - 1, Number(pb[2])) - new Date(Number(pa[0]), Number(pa[1]) - 1, Number(pa[2]))) / 864e5);
  }

  function boxAll() { var b = parse(read(KEY_BOX), {}); return isObj(b) ? b : {}; }
  function saveBox(all) { write(KEY_BOX, JSON.stringify(all)); }
  function boxOf(id, key) { var m = boxAll()[id]; return isObj(m) && isObj(m[key]) && typeof m[key].b === "number" ? m[key] : null; }

  // byKey: { 항목 키: 맞혔는지 }. 상자에 없는 항목만 넣는다. 넣은 개수를 돌려준다.
  function boxEnter(id, byKey) {
    var all = boxAll();
    var m = isObj(all[id]) ? all[id] : {};
    var t = today(), now = new Date().toISOString(), n = 0;
    Object.keys(byKey).forEach(function (key) {
      if (isObj(m[key])) return;
      var b = byKey[key] ? 2 : 1;
      m[key] = { b: b, due: addDays(t, BOX_DAYS[b]), at: now };
      n++;
    });
    if (n) { all[id] = m; saveBox(all); }
    return n;
  }

  // 오늘의 복습에서 답한 결과로 칸을 옮긴다. { from, to, due } 를 돌려준다(to 가 6 이면 졸업).
  function boxAnswer(id, key, ok) {
    var all = boxAll();
    var m = isObj(all[id]) ? all[id] : {};
    var cur = isObj(m[key]) && typeof m[key].b === "number" ? m[key].b : 1;
    var to = ok ? Math.min(cur + 1, BOX_GRAD) : 1;
    var due = to >= BOX_GRAD ? null : addDays(today(), BOX_DAYS[to]);
    m[key] = { b: to, due: due, at: new Date().toISOString() };
    all[id] = m;
    saveBox(all);
    return { from: cur, to: to, due: due };
  }

  // 단원 목록(store.list() 의 항목들)에서 상자에 든 항목. 단원 데이터에서 사라진 항목은 뺀다.
  function boxEntries(lessons) {
    var all = boxAll(), out = [];
    lessons.forEach(function (it) {
      var m = all[it.id];
      if (!isObj(m)) return;
      var keys = {};
      weakItems(it.data).forEach(function (x) { keys[x.key] = 1; });
      Object.keys(m).forEach(function (key) {
        var e = m[key];
        if (!keys[key] || !isObj(e) || typeof e.b !== "number") return;
        out.push({ id: it.id, key: key, b: e.b, due: e.due, lesson: it });
      });
    });
    return out;
  }

  // 오늘 이미 복습한 것(아이마다 하루치): { 아이: { date, keys: ["단원 id\u0001항목 키"] } }. 백업에는 넣지 않는다.
  function reviewDay(owner) {
    var d = parse(read(KEY_BOXDAY), {});
    var r = isObj(d) && isObj(d[owner]) ? d[owner] : null;
    return r && r.date === today() && Array.isArray(r.keys) ? r.keys : [];
  }
  function reviewDayAdd(owner, id, key) {
    var d = parse(read(KEY_BOXDAY), {});
    if (!isObj(d)) d = {};
    var keys = reviewDay(owner);
    var k = id + "\u0001" + key;
    if (keys.indexOf(k) < 0) keys.push(k);
    d[owner] = { date: today(), keys: keys };
    write(KEY_BOXDAY, JSON.stringify(d));
  }

  // 한 아이의 상자 현황: counts[1..5], grad(졸업 수), due(오늘 낼 항목, 칸 낮은 것·오래된 것 먼저, 하루 최대까지),
  // dueAll(밀린 것 포함 전체), doneToday(오늘 복습한 수), next({ date, n }: 오늘 이후 가장 가까운 복습)
  function reviewPlan(lessons, owner) {
    var mine = lessons.filter(function (it) { return it.data.owner === owner; });
    var ents = boxEntries(mine);
    var t = today();
    var counts = [0, 0, 0, 0, 0, 0], grad = 0;
    ents.forEach(function (e) { if (e.b >= BOX_GRAD) grad++; else counts[Math.max(1, e.b)]++; });
    var doneKeys = reviewDay(owner);
    var dueAll = ents.filter(function (e) { return e.b < BOX_GRAD && e.due && e.due <= t && doneKeys.indexOf(e.id + "\u0001" + e.key) < 0; })
      .sort(function (a, b) { return a.b - b.b || String(a.due).localeCompare(String(b.due)); });
    var room = Math.max(0, REVIEW_MAX - doneKeys.length);
    var later = ents.filter(function (e) { return e.b < BOX_GRAD && e.due && e.due > t; });
    var next = null;
    later.forEach(function (e) { if (!next || e.due < next.date) next = { date: e.due, n: 0 }; });
    if (next) next.n = later.filter(function (e) { return e.due === next.date; }).length;
    return { owner: owner, total: ents.length, counts: counts, grad: grad, due: dueAll.slice(0, room), dueAll: dueAll, doneToday: doneKeys.length, doneKeys: doneKeys, next: next, today: t };
  }

  // 백업의 상자 기록을 합친다. 같은 항목은 더 나중에 바뀐 것을 남긴다.
  function mergeBox(incoming) {
    if (!isObj(incoming)) return 0;
    var all = boxAll(), n = 0;
    Object.keys(incoming).forEach(function (id) {
      var m = incoming[id];
      if (!isObj(m)) return;
      Object.keys(m).forEach(function (key) {
        var e = m[key];
        if (!isObj(e) || typeof e.b !== "number") return;
        if (!isObj(all[id])) all[id] = {};
        var x = all[id][key];
        if (!isObj(x) || String(e.at || "") > String(x.at || "")) { all[id][key] = e; n++; }
      });
    });
    if (n) saveBox(all);
    return n;
  }

  // ---------------------------------------------------------------- 확인 표의 고칠 곳 목록
  // 앱의 단원은 바꾸지 않고, 부모님이 원본(PC 의 단원 데이터)을 고칠 수 있게 「어디를 무엇으로」만 모아 둔다.
  // 항목: { id: 단원 id, label: 단원 이름, owner, path: ["words", 2, "ko"] 같은 위치, where: 사람이 읽는 위치, before, after, at }
  function fixesAll() {
    var r = parse(read(KEY_FIXES), []);
    return Array.isArray(r) ? r.filter(function (f) { return isObj(f) && typeof f.id === "string" && Array.isArray(f.path); }) : [];
  }
  function saveFixes(arr) { write(KEY_FIXES, JSON.stringify(arr)); }
  function samePath(a, b) { return a.length === b.length && a.every(function (x, i) { return x === b[i]; }); }
  function valueAt(data, path) {
    var v = data;
    for (var i = 0; i < path.length; i++) { if (v === null || v === undefined) return undefined; v = v[path[i]]; }
    return v;
  }
  // 같은 칸을 다시 적으면 바꾼다. after 가 비었거나 원래 내용과 같으면 그 칸의 고칠 곳을 지운다.
  function setFix(fix) {
    var arr = fixesAll().filter(function (f) { return !(f.id === fix.id && samePath(f.path, fix.path)); });
    var after = String(fix.after === undefined || fix.after === null ? "" : fix.after).trim();
    if (after && after !== String(fix.before)) arr.push(Object.assign({}, fix, { after: after, at: new Date().toISOString() }));
    saveFixes(arr);
  }
  function fixesFor(id) { return fixesAll().filter(function (f) { return f.id === id; }); }
  function fixAt(id, path) { return fixesAll().filter(function (f) { return f.id === id && samePath(f.path, path); })[0] || null; }
  function clearFixes(id) { saveFixes(id ? fixesAll().filter(function (f) { return f.id !== id; }) : []); }
  // 원본이 고쳐져 새로 받은 단원의 그 칸이 적어 둔 내용과 같아지면 목록에서 뺀다. 뺀 개수를 돌려준다.
  function pruneFixes() {
    var lessons = {};
    list().forEach(function (x) { lessons[x.id] = x.data; });
    var arr = fixesAll();
    var keep = arr.filter(function (f) { return !(lessons[f.id] && String(valueAt(lessons[f.id], f.path)) === f.after); });
    if (keep.length !== arr.length) saveFixes(keep);
    return arr.length - keep.length;
  }
  // 저에게(또는 부모님 작업실에) 붙여 넣을 글. 아이 이름은 넣지 않는다.
  function fixesText() {
    var arr = fixesAll();
    if (!arr.length) return "";
    var groups = [];
    arr.forEach(function (f) {
      var g = groups.filter(function (x) { return x.id === f.id; })[0];
      if (!g) { g = { id: f.id, label: f.label, owner: f.owner, items: [] }; groups.push(g); }
      g.items.push(f);
    });
    var lines = ["[단어 연습 앱 · 확인 표 고칠 곳 " + arr.length + "개] " + new Date().toISOString().slice(0, 10)];
    groups.forEach(function (g, i) {
      lines.push("");
      lines.push((i + 1) + ") " + (g.owner || "") + " · " + g.label);
      lines.push("   단원 id: " + g.id);
      g.items.forEach(function (f) { lines.push("   - " + f.where + ": 「" + f.before + "」 → 「" + f.after + "」"); });
    });
    return lines.join("\n");
  }
  function mergeFixes(incoming) {
    if (!Array.isArray(incoming)) return 0;
    var arr = fixesAll();
    var n = 0;
    incoming.forEach(function (f) {
      if (!isObj(f) || typeof f.id !== "string" || !Array.isArray(f.path) || typeof f.after !== "string") return;
      if (arr.some(function (x) { return x.id === f.id && samePath(x.path, f.path); })) return;
      arr.push(f);
      n++;
    });
    if (n) saveFixes(arr);
    return n;
  }

  // ---------------------------------------------------------------- 화면 시험 기록
  function resultsAll() {
    var r = parse(read(KEY_RESULTS), []);
    return Array.isArray(r) ? r.filter(isObj) : [];
  }
  function addResult(rec) {
    var all = resultsAll();
    all.unshift(rec);
    write(KEY_RESULTS, JSON.stringify(all.slice(0, MAX_RESULTS)));
  }
  function resultsFor(id) { return resultsAll().filter(function (r) { return r.lessonId === id; }); }
  function mergeResults(incoming) {
    if (!Array.isArray(incoming)) return 0;
    var all = resultsAll();
    var seen = {};
    all.forEach(function (r) { seen[r.at + "|" + r.lessonId] = true; });
    var n = 0;
    incoming.forEach(function (r) {
      if (!isObj(r) || typeof r.at !== "string" || typeof r.lessonId !== "string" || typeof r.score !== "number") return;
      if (seen[r.at + "|" + r.lessonId]) return;
      seen[r.at + "|" + r.lessonId] = true;
      all.push(r);
      n++;
    });
    if (n) {
      all.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
      write(KEY_RESULTS, JSON.stringify(all.slice(0, MAX_RESULTS)));
    }
    return n;
  }

  // 시험지 만들기에 넘길 단원 데이터 사본. 기기에 표시한 틀린 항목에 weak: true 를 붙인다.
  function withWeak(it) {
    var copy = JSON.parse(JSON.stringify(it.data));
    var m = weakAll()[it.id];
    if (!isObj(m)) return copy;
    if (copy.kind === "word") {
      (copy.words || []).forEach(function (w) { if (has(m, w.word)) w.weak = true; });
    } else {
      (copy.vocab || []).forEach(function (v) { if (has(m, "v|" + v.word)) v.weak = true; });
      (copy.chunks || []).forEach(function (c) { if (has(m, "c|" + c.sentence)) c.weak = true; });
    }
    return copy;
  }

  // 하나의 단원 데이터를 검사해서 저장한다. 검사에 실패하면 이유를 던진다.
  function addOne(raw) {
    var kind = raw && raw.kind;
    if (kind === "word") WT.word.load(raw);
    else if (kind === "chunk") WT.chunk.load(raw);
    else throw new Error("kind 가 word 또는 chunk 가 아닙니다");
    var id = lessonId(raw);
    var arr = manualList();
    var idx = arr.findIndex(function (x) { return x.id === id; });
    var entry = { id: id, kind: kind, addedAt: new Date().toISOString(), data: raw };
    var updated = idx >= 0;
    if (updated) arr[idx] = entry; else arr.push(entry);
    saveList(arr);
    return { id: id, updated: updated };
  }

  // 백업의 설정을 합친다. 스티커는 아이마다 합쳐서(같은 시각·같은 스티커는 하나로) 지금 기기에서 받은 것이 지워지지 않게 한다.
  function mergeSettings(now, from) {
    var out = Object.assign({}, now, from);
    if (isObj(from.done) || isObj(now.done)) out.done = Object.assign({}, isObj(from.done) ? from.done : {}, isObj(now.done) ? now.done : {}); // 시험 끝 표시는 합친다
    if (isObj(from.academy) || isObj(now.academy)) { // 학원 점수는 단원마다 더 나중에 적은 것을 남긴다
      var acA = isObj(now.academy) ? now.academy : {}, acB = isObj(from.academy) ? from.academy : {};
      out.academy = {};
      Object.keys(Object.assign({}, acA, acB)).forEach(function (k) {
        var x = acA[k], y = acB[k];
        out.academy[k] = !isObj(y) ? x : !isObj(x) ? y : (String(y.at || "") > String(x.at || "") ? y : x);
      });
    }
    if (isObj(from.stickers) || isObj(now.stickers)) {
      var a = isObj(now.stickers) ? now.stickers : {}, b = isObj(from.stickers) ? from.stickers : {};
      out.stickers = {};
      Object.keys(Object.assign({}, a, b)).forEach(function (code) {
        var seen = {}, list = [];
        [].concat(Array.isArray(a[code]) ? a[code] : [], Array.isArray(b[code]) ? b[code] : []).forEach(function (x) {
          if (!isObj(x) || typeof x.s !== "string") return;
          var k = x.at + "|" + x.s;
          if (seen[k]) return;
          seen[k] = 1;
          list.push(x);
        });
        list.sort(function (x, y) { return String(x.at).localeCompare(String(y.at)); });
        out.stickers[code] = list;
      });
    }
    return out;
  }

  // 붙여 넣은 글이나 파일 내용을 가져온다. 단원 하나, 단원 목록, 백업 파일 모두 받는다.
  function importText(text, label) {
    var res = { added: [], updated: [], errors: [], settingsRestored: false, weakRestored: 0, resultsRestored: 0, fixesRestored: 0, boxRestored: 0 };
    var obj;
    try { obj = JSON.parse(text); }
    catch (e) { res.errors.push((label || "입력") + ": JSON 형식이 아닙니다(" + e.message + ")"); return res; }
    var items = [];
    if (Array.isArray(obj)) items = obj;
    else if (obj && Array.isArray(obj.lessons)) {
      items = obj.lessons;
      if (obj.settings) { saveSettings(mergeSettings(settings(), obj.settings)); res.settingsRestored = true; }
      if (isObj(obj.weak)) res.weakRestored = mergeWeak(obj.weak);
      if (Array.isArray(obj.results)) res.resultsRestored = mergeResults(obj.results);
      if (Array.isArray(obj.fixes)) res.fixesRestored = mergeFixes(obj.fixes);
      if (isObj(obj.box)) res.boxRestored = mergeBox(obj.box);
    } else items = [obj];
    items.forEach(function (raw, i) {
      var name = (label || "입력") + (items.length > 1 ? " #" + (i + 1) : "");
      try {
        var r = addOne(raw);
        (r.updated ? res.updated : res.added).push(name);
      } catch (e) { res.errors.push(name + ": " + e.message.split("\n")[0]); }
    });
    return res;
  }

  // 백업 파일의 틀린 단어 표시를 이 기기의 표시와 합친다(이미 있는 표시는 그대로 두고, 없는 것만 더한다). 더한 개수를 돌려준다.
  function mergeWeak(incoming) {
    var all = weakAll();
    var n = 0;
    Object.keys(incoming).forEach(function (id) {
      var m = incoming[id];
      if (!isObj(m)) return;
      Object.keys(m).forEach(function (key) {
        var at = isObj(m[key]) && typeof m[key].at === "string" ? m[key].at : new Date().toISOString();
        if (!isObj(all[id])) all[id] = {};
        if (!has(all[id], key)) { all[id][key] = { at: at }; n++; }
      });
    });
    if (n) saveWeak(all);
    return n;
  }

  // 백업에는 직접 가져온 단원, 설정, 틀린 단어 표시, 시험 기록, 복습 상자만 넣는다. 연결 열쇠와 자동으로 받은 단원은 넣지 않는다.
  function exportAll() {
    return JSON.stringify({
      app: "word-practice", version: 1, exportedAt: new Date().toISOString(),
      settings: settings(), weak: weakAll(), results: resultsAll(), fixes: fixesAll(), box: boxAll(), lessons: manualList().map(function (x) { return x.data; })
    }, null, 1);
  }

  WT.store = {
    list: list, remove: remove, removeAll: removeAll, settings: settings, saveSettings: saveSettings, mergeSettings: mergeSettings, doneAt: doneAt, setDone: setDone, academyAll: academyAll, academyFor: academyFor, setAcademy: setAcademy,
    importText: importText, exportAll: exportAll, isPersistent: function () { return persistent; },
    weakItems: weakItems, isWeak: isWeak, setWeak: setWeak, clearWeak: clearWeak, weakCount: weakCount, withWeak: withWeak,
    applyGrading: applyGrading, addResult: addResult, resultsFor: resultsFor, CLEAR_AFTER: CLEAR_AFTER,
    boxEnter: boxEnter, boxAnswer: boxAnswer, boxOf: boxOf, boxEntries: boxEntries, reviewPlan: reviewPlan, reviewDayAdd: reviewDayAdd, mergeBox: mergeBox,
    today: today, daysBetween: daysBetween, BOX_DAYS: BOX_DAYS, BOX_GRAD: BOX_GRAD, REVIEW_MAX: REVIEW_MAX,
    _shiftDays: function (n) { dayShift = n; }, // 점검용
    setFix: setFix, fixesFor: fixesFor, fixAt: fixAt, fixesAll: fixesAll, clearFixes: clearFixes, pruneFixes: pruneFixes, fixesText: fixesText, valueAt: valueAt,
    lessonId: lessonId, syncedState: syncedState, setSynced: setSynced, clearSynced: clearSynced,
    syncedSnapshot: syncedSnapshot, restoreSynced: restoreSynced, setActive: setActive,
    getConnection: getConnection, saveConnection: saveConnection, clearConnection: clearConnection
  };
})(typeof window !== "undefined" ? window : globalThis);
