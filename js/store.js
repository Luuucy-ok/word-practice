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
  var KEY_RESULTS = "wp.results.v1"; // 화면에서 푼 시험 기록(최근 것부터 최대 MAX_RESULTS 개)
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

  // 붙여 넣은 글이나 파일 내용을 가져온다. 단원 하나, 단원 목록, 백업 파일 모두 받는다.
  function importText(text, label) {
    var res = { added: [], updated: [], errors: [], settingsRestored: false, weakRestored: 0, resultsRestored: 0 };
    var obj;
    try { obj = JSON.parse(text); }
    catch (e) { res.errors.push((label || "입력") + ": JSON 형식이 아닙니다(" + e.message + ")"); return res; }
    var items = [];
    if (Array.isArray(obj)) items = obj;
    else if (obj && Array.isArray(obj.lessons)) {
      items = obj.lessons;
      if (obj.settings) { saveSettings(Object.assign(settings(), obj.settings)); res.settingsRestored = true; }
      if (isObj(obj.weak)) res.weakRestored = mergeWeak(obj.weak);
      if (Array.isArray(obj.results)) res.resultsRestored = mergeResults(obj.results);
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

  // 백업에는 직접 가져온 단원, 설정, 틀린 단어 표시, 시험 기록만 넣는다. 연결 열쇠와 자동으로 받은 단원은 넣지 않는다.
  function exportAll() {
    return JSON.stringify({
      app: "word-practice", version: 1, exportedAt: new Date().toISOString(),
      settings: settings(), weak: weakAll(), results: resultsAll(), lessons: manualList().map(function (x) { return x.data; })
    }, null, 1);
  }

  WT.store = {
    list: list, remove: remove, removeAll: removeAll, settings: settings, saveSettings: saveSettings,
    importText: importText, exportAll: exportAll, isPersistent: function () { return persistent; },
    weakItems: weakItems, isWeak: isWeak, setWeak: setWeak, clearWeak: clearWeak, weakCount: weakCount, withWeak: withWeak,
    applyGrading: applyGrading, addResult: addResult, resultsFor: resultsFor, CLEAR_AFTER: CLEAR_AFTER,
    lessonId: lessonId, syncedState: syncedState, setSynced: setSynced, clearSynced: clearSynced,
    syncedSnapshot: syncedSnapshot, restoreSynced: restoreSynced, setActive: setActive,
    getConnection: getConnection, saveConnection: saveConnection, clearConnection: clearConnection
  };
})(typeof window !== "undefined" ? window : globalThis);
