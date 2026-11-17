/* 기기 안 저장(localStorage). 교재 데이터는 이 기기 브라우저에만 저장되고 서버로 보내지 않는다.
 * 저장소를 쓸 수 없는 환경(비공개 창 등)에서는 이번 접속 동안만 메모리에 둔다. */
(function (root) {
  "use strict";
  var WT = (root.WT = root.WT || {});
  var KEY_LESSONS = "wp.lessons.v1";
  var KEY_SETTINGS = "wp.settings.v1";
  var KEY_SYNCED = "wp.synced.v1";
  var KEY_CONN = "wp.connection.v1";
  var KEY_WEAK = "wp.weak.v1"; // 틀린 단어 표시: { 단원 id: { 항목 키: { at: 표시한 시각 } } }. 단원 데이터와 따로 저장해서 새 단원을 받아도 남는다.
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

  function syncedState() {
    var s = parse(read(KEY_SYNCED), null);
    return s && Array.isArray(s.lessons) ? s : null;
  }
  function setSynced(state) { write(KEY_SYNCED, JSON.stringify(state)); }
  function clearSynced() { write(KEY_SYNCED, "null"); }

  function getConnection() {
    var c = parse(read(KEY_CONN), null);
    return c && c.child && c.token ? c : null;
  }
  function saveConnection(c) { write(KEY_CONN, JSON.stringify(c)); }
  function clearConnection() { write(KEY_CONN, "null"); }

  // 화면에 보여 줄 전체 목록. 같은 단원이 양쪽에 있으면 자동으로 받은 쪽을 쓴다.
  function list() {
    var manual = manualList();
    var s = syncedState();
    if (!s) return manual;
    var ids = {};
    var out = s.lessons.map(function (raw) {
      var id = lessonId(raw);
      ids[id] = true;
      return { id: id, kind: raw.kind, addedAt: s.syncedAt, data: raw, synced: true };
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
    var res = { added: [], updated: [], errors: [], settingsRestored: false, weakRestored: 0 };
    var obj;
    try { obj = JSON.parse(text); }
    catch (e) { res.errors.push((label || "입력") + ": JSON 형식이 아닙니다(" + e.message + ")"); return res; }
    var items = [];
    if (Array.isArray(obj)) items = obj;
    else if (obj && Array.isArray(obj.lessons)) {
      items = obj.lessons;
      if (obj.settings) { saveSettings(Object.assign(settings(), obj.settings)); res.settingsRestored = true; }
      if (isObj(obj.weak)) res.weakRestored = mergeWeak(obj.weak);
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

  // 백업에는 직접 가져온 단원, 설정, 틀린 단어 표시만 넣는다. 연결 열쇠와 자동으로 받은 단원은 넣지 않는다.
  function exportAll() {
    return JSON.stringify({
      app: "word-practice", version: 1, exportedAt: new Date().toISOString(),
      settings: settings(), weak: weakAll(), lessons: manualList().map(function (x) { return x.data; })
    }, null, 1);
  }

  WT.store = {
    list: list, remove: remove, removeAll: removeAll, settings: settings, saveSettings: saveSettings,
    importText: importText, exportAll: exportAll, isPersistent: function () { return persistent; },
    weakItems: weakItems, isWeak: isWeak, setWeak: setWeak, clearWeak: clearWeak, weakCount: weakCount, withWeak: withWeak,
    lessonId: lessonId, syncedState: syncedState, setSynced: setSynced, clearSynced: clearSynced,
    getConnection: getConnection, saveConnection: saveConnection, clearConnection: clearConnection
  };
})(typeof window !== "undefined" ? window : globalThis);
