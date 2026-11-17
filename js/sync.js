/* 부모님 데이터 저장소(비공개 GitHub 저장소)에서 이 아이의 단원 묶음을 자동으로 받아 온다.
 * - 연결 링크(#connect=...)에 담긴 읽기 전용 열쇠를 이 기기에만 저장한다. 열쇠는 api.github.com 으로만 보낸다.
 * - 받는 곳(저장소 이름)은 이 파일에 고정되어 있어서, 링크로 다른 곳을 지정할 수 없다.
 * - 받은 묶음에 문제가 하나라도 있으면 이전 단원을 그대로 두고 이유를 알려 준다(일부만 바꾸지 않는다). */
(function (root) {
  "use strict";
  var WT = (root.WT = root.WT || {});

  var REPO = { owner: "Luuucy-ok", repo: "word-practice-data" };
  var CHILD_FILE = { A: "A.json", B: "B.json" };
  var CHILD_OWNER = { A: "아이 A", B: "아이 B" };
  var MIN_GAP_MS = 10 * 60 * 1000;
  var WARN_DAYS = 30;
  var lastAttempt = 0;
  var running = null;

  function fetchFn() { return WT.sync._fetch || root.fetch.bind(root); }
  function nowMs() { return WT.sync._now ? WT.sync._now() : Date.now(); }

  function b64urlDecode(s) {
    var b = s.replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    var bin = root.atob(b);
    var pct = "";
    for (var i = 0; i < bin.length; i++) pct += "%" + ("00" + bin.charCodeAt(i).toString(16)).slice(-2);
    return decodeURIComponent(pct);
  }

  // 주소의 # 뒷부분이 연결 링크가 아니면 null. 링크인데 내용이 이상하면 이유를 던진다.
  function parseConnect(hash) {
    var m = /^#connect=([A-Za-z0-9_-]+)$/.exec(hash || "");
    if (!m) return null;
    var o;
    try { o = JSON.parse(b64urlDecode(m[1])); }
    catch (e) { throw new Error("연결 링크가 깨져 있어요. 링크를 끝까지 복사했는지 확인하고, 안 되면 부모님께 새 링크를 받아 주세요."); }
    // 아이 코드(c)가 없는 링크는 이 기기에서 아이를 고르게 한다(child: null). 코드가 있으면 알려진 값이어야 한다.
    var hasChild = o && o.c !== undefined && o.c !== null;
    if (!o || o.v !== 1 || (hasChild && !CHILD_FILE[o.c])) throw new Error("이 앱에서 쓸 수 없는 연결 링크예요(대상 아이를 알 수 없어요).");
    if (typeof o.t !== "string" || !/^[A-Za-z0-9_]{20,300}$/.test(o.t)) throw new Error("연결 링크에 열쇠가 없거나 형식이 달라요.");
    var expires = null;
    if (o.x !== undefined && o.x !== null) {
      if (typeof o.x !== "string" || isNaN(Date.parse(o.x))) throw new Error("연결 링크의 만료 정보가 이상해요.");
      expires = o.x;
    }
    return { child: hasChild ? o.c : null, token: o.t, expires: expires };
  }

  function daysLeft(conn) {
    if (!conn || !conn.expires) return null;
    return Math.ceil((Date.parse(conn.expires) - nowMs()) / 86400000);
  }

  function lessonLabel(raw) {
    return (raw.owner || "") + " " + (raw.kind === "word" ? "단어 Lesson " + raw.lesson : (raw.title || "Chunk Quiz"));
  }

  // 받은 묶음을 검사한다. 통과하면 단원 목록을, 아니면 이유 목록을 돌려준다.
  function checkBundle(bundle, child) {
    var errs = [];
    if (!bundle || bundle.app !== "word-practice-bundle" || bundle.version !== 1 || !Array.isArray(bundle.lessons)) {
      return { errors: ["단원 묶음 형식이 아니에요."] };
    }
    if (bundle.owner !== CHILD_OWNER[child]) {
      return { errors: ["이 묶음은 " + bundle.owner + " 것인데 이 기기는 " + CHILD_OWNER[child] + " 용으로 연결돼 있어요."] };
    }
    bundle.lessons.forEach(function (raw, i) {
      var name = "#" + (i + 1);
      try {
        if (!raw || typeof raw !== "object") throw new Error("단원 데이터가 아니에요");
        if (raw.owner !== CHILD_OWNER[child]) throw new Error("대상이 " + raw.owner + " 라서 이 기기에 넣지 않아요");
        name = lessonLabel(raw);
        if (raw.kind === "word") WT.word.load(raw);
        else if (raw.kind === "chunk") WT.chunk.load(raw);
        else throw new Error("kind 가 word 또는 chunk 가 아니에요");
      } catch (e) { errs.push(name + ": " + e.message.split("\n")[0]); }
    });
    return errs.length ? { errors: errs } : { lessons: bundle.lessons, publishedAt: bundle.publishedAt || null };
  }

  function result(status, message, extra) {
    return Object.assign({ status: status, message: message, added: [], total: 0, errors: [] }, extra || {});
  }

  function who(child) { return CHILD_OWNER[child]; }

  // 한 아이의 묶음 파일을 한 번 받아 저장한다. 연결 정보는 직접 고치지 않고, 그 아이의 ETag 만 새 값으로 돌려준다.
  function pullChild(conn, child) {
    var url = "https://api.github.com/repos/" + REPO.owner + "/" + REPO.repo + "/contents/" + CHILD_FILE[child];
    var prev = WT.store.syncedState(child);
    var hasData = !!prev;
    var oldEtag = conn.children && conn.children[child] ? conn.children[child].etag || null : null;
    var headers = { Authorization: "Bearer " + conn.token, Accept: "application/vnd.github.raw+json" };
    if (hasData && oldEtag) headers["If-None-Match"] = oldEtag;
    function keep(out) { return { child: child, out: out, etag: oldEtag }; }

    return fetchFn()(url, { headers: headers, cache: "no-store" }).then(function (res) {
      var etag = res.headers && res.headers.get ? res.headers.get("ETag") : null;
      if (res.status === 304) return keep(result("unchanged", "새로 올라온 단원은 없어요.", { total: hasData ? prev.lessons.length : 0 }));
      if (res.status === 401) return keep(result("error", "열쇠가 만료되었거나 취소되었어요. 부모님께 새 연결 링크를 받아 주세요. 지금 있는 단원은 그대로 쓸 수 있어요.", { auth: true }));
      if (res.status === 404) return keep(result("error", "단원 파일을 찾지 못했어요. 부모님이 아직 올리지 않았거나 열쇠 권한이 맞지 않을 수 있어요."));
      if (res.status === 403 || res.status === 429) return keep(result("error", "지금은 받을 수 없어요. 잠시 뒤에 다시 눌러 보세요."));
      if (res.status !== 200) return keep(result("error", "받는 중 문제가 생겼어요(응답 " + res.status + ")."));
      return res.text().then(function (text) {
        var bundle;
        try { bundle = JSON.parse(text); }
        catch (e) { return keep(result("error", "받은 파일을 읽지 못했어요. 부모님께 알려 주세요. 이전 단원은 그대로 두었어요.")); }
        var chk = checkBundle(bundle, child);
        if (chk.errors) {
          return keep(result("error", "받은 단원에 문제가 있어서 바꾸지 않았어요. 이전 단원은 그대로예요. 부모님께 알려 주세요.", { errors: chk.errors }));
        }
        var oldIds = {};
        if (hasData) prev.lessons.forEach(function (r) { oldIds[WT.store.lessonId(r)] = true; });
        var added = chk.lessons.filter(function (r) { return !oldIds[WT.store.lessonId(r)]; });
        WT.store.setSynced({ child: child, publishedAt: chk.publishedAt, syncedAt: new Date(nowMs()).toISOString(), lessons: chk.lessons });
        return {
          child: child,
          out: result("updated", added.length ? "새 단원 " + added.length + "개를 받았어요." : "단원을 새로 확인했어요.", { added: added, total: chk.lessons.length }),
          etag: etag || null
        };
      });
    }, function () {
      return keep(result("offline", "인터넷에 연결되지 않아서 저장된 단원을 보여 줘요."));
    });
  }

  // 여러 아이의 묶음을 차례로 받는다(한 아이 연결이면 그 아이 하나만).
  function pullKids(conn, kids) {
    var results = [];
    return kids.reduce(function (p, child) {
      return p.then(function () {
        return pullChild(conn, child).then(function (r) { results.push(r); }, function () {
          results.push({ child: child, out: result("error", "받는 중 문제가 생겼어요. 잠시 뒤에 다시 눌러 보세요."), etag: conn.children && conn.children[child] ? conn.children[child].etag || null : null });
        });
      });
    }, Promise.resolve()).then(function () { return results; });
  }

  // 아이별 결과를 하나로 합친다. 한 아이뿐이면 그 결과를 그대로 쓴다. 오류가 하나라도 있으면 오류로 알린다.
  function combine(results) {
    if (results.length === 1) return results[0].out;
    var errs = results.filter(function (r) { return r.out.status === "error"; });
    if (errs.length) {
      return result("error", errs.map(function (r) { return who(r.child) + ": " + r.out.message; }).join("\n"), {
        errors: errs.reduce(function (acc, r) { return acc.concat(r.out.errors.map(function (e) { return who(r.child) + " " + e; })); }, []),
        auth: errs.some(function (r) { return r.out.auth; })
      });
    }
    var total = results.reduce(function (n, r) { return n + (r.out.total || 0); }, 0);
    var off = results.filter(function (r) { return r.out.status === "offline"; });
    if (off.length) return result("offline", off[0].out.message, { total: total });
    var added = results.reduce(function (acc, r) { return acc.concat(r.out.added); }, []);
    if (results.some(function (r) { return r.out.status === "updated"; })) {
      return result("updated", added.length ? "새 단원 " + added.length + "개를 받았어요." : "단원을 새로 확인했어요.", { added: added, total: total });
    }
    return result("unchanged", "새로 올라온 단원은 없어요.", { total: total });
  }

  // 받은 결과를 연결 정보에 반영해 저장한다(아이별 ETag, 마지막 확인 시각).
  function finish(conn, results) {
    var out = combine(results);
    var c = Object.assign({}, conn, { lastAttempt: new Date(nowMs()).toISOString(), lastStatus: out.status });
    c.children = Object.assign({}, conn.children);
    results.forEach(function (r) { c.children[r.child] = Object.assign({}, c.children[r.child], { etag: r.etag }); });
    if (out.status === "updated" || out.status === "unchanged") c.lastSync = c.lastAttempt;
    WT.store.saveConnection(c);
    return out;
  }

  // 이미 연결된 기기에서 새 단원이 있는지 확인한다. force 가 아니면 최근에 확인했을 때는 건너뛴다.
  function run(force) {
    var conn = WT.store.getConnection();
    if (!conn) return Promise.resolve(result("none", "연결되어 있지 않아요."));
    if (running) return running;
    var left = daysLeft(conn);
    if (left !== null && left <= 0) return Promise.resolve(result("error", "열쇠가 만료되었어요. 부모님께 새 연결 링크를 받아 주세요. 지금 있는 단원은 그대로 쓸 수 있어요.", { auth: true }));
    if (!force && nowMs() - lastAttempt < MIN_GAP_MS) return Promise.resolve(result("skipped", ""));
    lastAttempt = nowMs();
    running = pullKids(conn, conn.kids).then(function (rs) { running = null; return finish(conn, rs); }, function () {
      running = null;
      return result("error", "받는 중 문제가 생겼어요. 잠시 뒤에 다시 눌러 보세요.");
    });
    return running;
  }

  // 새 연결 링크로 처음 연결한다. parsed.child 는 한 아이 전용, parsed.kids(["A","B"])는 두 아이 함께 쓰기.
  // 고른 아이 모두 받기에 성공해야 열쇠를 저장하고, 하나라도 실패하면 이전 연결과 단원을 그대로 둔다.
  function connect(parsed) {
    var kids = (parsed.kids || (parsed.child ? [parsed.child] : [])).filter(function (k, i, a) { return a.indexOf(k) === i; }).sort();
    if (!kids.length || kids.some(function (k) { return !CHILD_FILE[k]; })) return Promise.resolve(result("error", "어느 아이 용으로 연결할지 골라 주세요."));
    var old = WT.store.getConnection();
    var snapshot = WT.store.syncedSnapshot();
    var children = {};
    kids.forEach(function (k) { children[k] = { etag: null }; });
    var active = old && kids.indexOf(old.active) >= 0 ? old.active : kids[0];
    var conn = { token: parsed.token, expires: parsed.expires, children: children, active: active, child: active, kids: kids, connectedAt: new Date(nowMs()).toISOString() };
    function undo() { WT.store.restoreSynced(snapshot); }
    return pullKids(conn, kids).then(function (rs) {
      var out = combine(rs);
      if (out.status === "updated" || out.status === "unchanged") {
        // 이번에 고르지 않은 아이의 자동 단원은 이 기기에서 지운다.
        ["A", "B"].forEach(function (k) { if (kids.indexOf(k) < 0) WT.store.clearSynced(k); });
        lastAttempt = nowMs();
        return finish(conn, rs);
      }
      undo();
      return out;
    }, function () {
      undo();
      return result("error", "받는 중 문제가 생겼어요. 잠시 뒤에 다시 눌러 보세요.");
    });
  }

  // 이미 연결된 기기(저장된 열쇠)에 다른 아이를 더한다. 링크가 필요 없다. 실패하면 아무것도 바꾸지 않는다.
  function addChild(code) {
    var conn = WT.store.getConnection();
    if (!conn) return Promise.resolve(result("error", "연결되어 있지 않아요."));
    if (!CHILD_FILE[code]) return Promise.resolve(result("error", "어느 아이인지 알 수 없어요."));
    if (conn.kids.indexOf(code) >= 0) return Promise.resolve(result("unchanged", who(code) + " 은(는) 이미 연결되어 있어요.", { total: (WT.store.syncedState(code) || { lessons: [] }).lessons.length }));
    var left = daysLeft(conn);
    if (left !== null && left <= 0) return Promise.resolve(result("error", "열쇠가 만료되었어요. 부모님께 새 연결 링크를 받아 주세요.", { auth: true }));
    var snapshot = WT.store.syncedSnapshot();
    var tmp = Object.assign({}, conn, { children: Object.assign({}, conn.children) });
    tmp.children[code] = { etag: null };
    return pullChild(tmp, code).then(function (r) {
      if (r.out.status !== "updated" && r.out.status !== "unchanged") { WT.store.restoreSynced(snapshot); return r.out; }
      var c = Object.assign({}, conn);
      c.children = Object.assign({}, conn.children);
      c.children[code] = { etag: r.etag };
      WT.store.saveConnection(c);
      return result("updated", who(code) + " 단원 " + r.out.total + "개를 받았어요.", { added: r.out.added, total: r.out.total });
    }, function () {
      WT.store.restoreSynced(snapshot);
      return result("error", "받는 중 문제가 생겼어요. 잠시 뒤에 다시 눌러 보세요.");
    });
  }

  // 두 아이를 함께 연결한 기기에서 한 아이를 뺀다(그 아이의 자동 단원은 이 기기에서 지워진다). 마지막 한 아이는 뺄 수 없다.
  function removeChild(code) {
    var conn = WT.store.getConnection();
    if (!conn || conn.kids.indexOf(code) < 0 || conn.kids.length < 2) return false;
    var c = Object.assign({}, conn);
    c.children = Object.assign({}, conn.children);
    delete c.children[code];
    c.active = conn.active === code ? conn.kids.filter(function (k) { return k !== code; })[0] : conn.active;
    WT.store.saveConnection(c);
    WT.store.clearSynced(code);
    return true;
  }

  function disconnect() {
    WT.store.clearConnection();
    WT.store.clearSynced();
    lastAttempt = 0;
  }

  WT.sync = {
    REPO: REPO, CHILD_OWNER: CHILD_OWNER, WARN_DAYS: WARN_DAYS,
    parseConnect: parseConnect, daysLeft: daysLeft, checkBundle: checkBundle, lessonLabel: lessonLabel,
    run: run, connect: connect, addChild: addChild, removeChild: removeChild, disconnect: disconnect,
    _fetch: null, _now: null
  };
})(typeof window !== "undefined" ? window : globalThis);
