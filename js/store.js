/* 기기 안 저장(localStorage). 교재 데이터는 이 기기 브라우저에만 저장되고 서버로 보내지 않는다.
 * 저장소를 쓸 수 없는 환경(비공개 창 등)에서는 이번 접속 동안만 메모리에 둔다. */
(function (root) {
  "use strict";
  var WT = (root.WT = root.WT || {});
  var KEY_LESSONS = "wp.lessons.v1";
  var KEY_SETTINGS = "wp.settings.v1";
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

  function list() { return parse(read(KEY_LESSONS), []); }
  function saveList(arr) { write(KEY_LESSONS, JSON.stringify(arr)); }

  function remove(id) { saveList(list().filter(function (x) { return x.id !== id; })); }
  function removeAll() { saveList([]); }

  function settings() { return Object.assign({ nameA: "", nameB: "" }, parse(read(KEY_SETTINGS), {})); }
  function saveSettings(s) { write(KEY_SETTINGS, JSON.stringify(s)); }

  // 하나의 단원 데이터를 검사해서 저장한다. 검사에 실패하면 이유를 던진다.
  function addOne(raw) {
    var kind = raw && raw.kind;
    if (kind === "word") WT.word.load(raw);
    else if (kind === "chunk") WT.chunk.load(raw);
    else throw new Error("kind 가 word 또는 chunk 가 아닙니다");
    var id = lessonId(raw);
    var arr = list();
    var idx = arr.findIndex(function (x) { return x.id === id; });
    var entry = { id: id, kind: kind, addedAt: new Date().toISOString(), data: raw };
    var updated = idx >= 0;
    if (updated) arr[idx] = entry; else arr.push(entry);
    saveList(arr);
    return { id: id, updated: updated };
  }

  // 붙여 넣은 글이나 파일 내용을 가져온다. 단원 하나, 단원 목록, 백업 파일 모두 받는다.
  function importText(text, label) {
    var res = { added: [], updated: [], errors: [], settingsRestored: false };
    var obj;
    try { obj = JSON.parse(text); }
    catch (e) { res.errors.push((label || "입력") + ": JSON 형식이 아닙니다(" + e.message + ")"); return res; }
    var items = [];
    if (Array.isArray(obj)) items = obj;
    else if (obj && Array.isArray(obj.lessons)) {
      items = obj.lessons;
      if (obj.settings) { saveSettings(Object.assign(settings(), obj.settings)); res.settingsRestored = true; }
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

  function exportAll() {
    return JSON.stringify({
      app: "word-practice", version: 1, exportedAt: new Date().toISOString(),
      settings: settings(), lessons: list().map(function (x) { return x.data; })
    }, null, 1);
  }

  WT.store = {
    list: list, remove: remove, removeAll: removeAll, settings: settings, saveSettings: saveSettings,
    importText: importText, exportAll: exportAll, isPersistent: function () { return persistent; }
  };
})(typeof window !== "undefined" ? window : globalThis);
