/* 화면 동작. 단원 가져오기 → 시험지 만들기 → 인쇄. */
(function () {
  "use strict";
  var WT = window.WT;
  var $ = function (id) { return document.getElementById(id); };
  var state = { lessonId: null };

  var SOURCE_LABEL = { practice: "연습 페이지", book: "교재 예문", exam: "지난 시험 문장", "new": "새 문장" };

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "class") n.className = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else if (k.indexOf("on") === 0) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function msg(node, kind, text) {
    clear(node);
    if (!text) return;
    node.appendChild(el("div", { "class": "msg " + kind, text: text }));
  }

  function ownerLabel(owner) {
    var s = WT.store.settings();
    if (owner === "아이 A" && s.nameA) return owner + "(" + s.nameA + ")";
    if (owner === "아이 B" && s.nameB) return owner + "(" + s.nameB + ")";
    return owner;
  }
  function sourcesText(list) {
    if (list.length === 1 && list[0] === "practice") return "연습 페이지 문장만";
    return list.map(function (x) { return SOURCE_LABEL[x] || x; }).join(", ");
  }

  // ---------------------------------------------------------------- 탭
  function showTab(name) {
    ["lessons", "make", "settings"].forEach(function (t) { $("tab-" + t).hidden = t !== name; });
    Array.prototype.forEach.call(document.querySelectorAll("#tabs button"), function (b) {
      b.classList.toggle("on", b.getAttribute("data-tab") === name);
    });
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- 단원 목록
  function find(id) {
    return WT.store.list().filter(function (x) { return x.id === id; })[0];
  }

  function renderLessons() {
    var box = $("lessonList");
    clear(box);
    var items = WT.store.list();
    if (!items.length) {
      box.appendChild(el("div", { "class": "card", text: WT.store.getConnection()
        ? "아직 받은 단원이 없어요. 부모님이 단원을 올리면 「지금 새로 받기」로 받을 수 있어요."
        : "아직 가져온 단원이 없어요. 부모님께 받은 연결 링크를 열면 단원이 자동으로 들어와요. 파일이 있으면 위의 「단원 파일을 직접 가져오기」를 눌러 넣을 수 있어요." }));
      return;
    }
    items.sort(function (a, b) {
      return (a.data.owner + a.kind + String(a.data.lesson || a.data.title)).localeCompare(b.data.owner + b.kind + String(b.data.lesson || b.data.title), "ko", { numeric: true });
    });
    items.forEach(function (it) {
      var d = it.data;
      var verified = !!d.verified;
      var title = it.kind === "word"
        ? "단어 Lesson " + d.lesson + (d.title ? " " + d.title : "")
        : (d.title || "Chunk Quiz");
      var meta = it.kind === "word"
        ? "단어 " + d.words.length + "개 · 문장 출처: " + sourcesText(d.sentence_sources) + " · 해석 필수: " + (d.require_sentence_ko ? "예" : "아니오")
        : "Key Vocabulary " + (d.vocab || []).length + "개 · chunk 문장 " + (d.chunks || []).length + "개 · Fill in 첫 글자 힌트: " + (d.hint === "first" ? "있음" : "없음");
      box.appendChild(el("div", { "class": "card lesson" }, [
        el("div", { "class": "head" }, [
          el("span", { text: ownerLabel(d.owner) }),
          el("span", { "class": "badge kind", text: it.kind === "word" ? "단어" : "chunk" }),
          el("span", { text: title }),
          el("span", { "class": "badge " + (verified ? "ok" : "warn"), text: verified ? "교재 대조 완료" : "교재 대조 전" })
        ].concat(it.synced ? [el("span", { "class": "badge kind", text: "부모님이 올림" })] : [])),
        el("div", { "class": "meta", text: meta }),
        el("div", { "class": "row" }, [
          el("button", { type: "button", "class": "primary", text: "시험지 만들기", onclick: function () { openMaker(it.id); } }),
          el("button", { type: "button", text: "확인 표", onclick: function () { openCheck(it.id); } })
        ].concat(it.synced ? [] : [
          el("button", { type: "button", "class": "danger", text: "삭제", onclick: function () {
            if (window.confirm("이 단원을 이 기기에서 지울까요?")) { WT.store.remove(it.id); renderLessons(); }
          } })
        ]))
      ]));
    });
  }

  function summarize(res) {
    var parts = [];
    if (res.added.length) parts.push("새로 넣음: " + res.added.length + "개");
    if (res.updated.length) parts.push("덮어씀: " + res.updated.length + "개");
    if (res.settingsRestored) parts.push("설정도 가져옴");
    return parts.join(" · ");
  }

  function doImport() {
    var out = $("importMsg");
    var files = Array.prototype.slice.call($("fileIn").files || []);
    var text = $("pasteIn").value.trim();
    var jobs = files.map(function (f) { return f.text().then(function (t) { return { label: f.name, text: t }; }); });
    if (text) jobs.push(Promise.resolve({ label: "붙여 넣은 내용", text: text }));
    if (!jobs.length) { msg(out, "warn", "파일을 고르거나 내용을 붙여 넣어 주세요."); return; }
    Promise.all(jobs).then(function (list) {
      var total = { added: [], updated: [], errors: [], settingsRestored: false };
      list.forEach(function (j) {
        var r = WT.store.importText(j.text, j.label);
        total.added = total.added.concat(r.added);
        total.updated = total.updated.concat(r.updated);
        total.errors = total.errors.concat(r.errors);
        total.settingsRestored = total.settingsRestored || r.settingsRestored;
      });
      var ok = summarize(total);
      var text2 = (ok ? ok + "\n" : "") + (total.errors.length ? "넣지 못한 것:\n" + total.errors.join("\n") : "");
      msg(out, total.errors.length ? (ok ? "warn" : "err") : "ok", text2 || "가져올 단원이 없어요.");
      if (!total.errors.length) { $("fileIn").value = ""; $("pasteIn").value = ""; }
      renderLessons();
    }).catch(function (e) { msg(out, "err", "읽지 못했어요: " + e.message); });
  }

  // ---------------------------------------------------------------- 부모님 단원 연결(자동 받기)
  function fmtTime(iso) {
    if (!iso) return "아직 없음";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "알 수 없음";
    return (d.getMonth() + 1) + "월 " + d.getDate() + "일 " + (d.getHours() < 12 ? "오전 " : "오후 ") + ((d.getHours() % 12) || 12) + ":" + ("0" + d.getMinutes()).slice(-2);
  }

  // 만료가 가까우면 알려 준다. 30일 안이면 안내, 지나면 오류.
  function expiryNote(conn) {
    var left = WT.sync.daysLeft(conn);
    if (left === null) return { text: "", kind: "" };
    if (left <= 0) return { text: "열쇠가 만료되었어요. 부모님께 새 연결 링크를 받아 주세요.", kind: "err" };
    if (left <= WT.sync.WARN_DAYS) return { text: "열쇠가 " + left + "일 뒤에 만료돼요. 부모님께 새 연결 링크를 받아 두세요.", kind: "warn" };
    return { text: "", kind: "" };
  }

  function renderSync() {
    var conn = WT.store.getConnection();
    $("syncBox").hidden = !conn;
    $("btnDisconnect").hidden = !conn;
    $("importBox").open = !conn;
    if (!conn) {
      $("connState").textContent = "연결되어 있지 않아요. 부모님께 받은 연결 링크를 이 기기에서 열면 단원이 자동으로 들어와요.";
      return;
    }
    var s = WT.store.syncedState();
    var who = WT.sync.CHILD_OWNER[conn.child];
    var line = who + "(" + (WT.store.settings()["name" + conn.child] || "이름 미설정") + ") 용으로 연결됨 · 단원 " + (s ? s.lessons.length : 0) + "개 · 마지막 확인 " + fmtTime(conn.lastSync);
    $("syncStatus").textContent = line;
    $("connState").textContent = line + (conn.expires ? " · 열쇠 만료 " + conn.expires.slice(0, 10) : "");
    var ex = expiryNote(conn);
    var slot = $("syncExpiry");
    if (slot) msg(slot, ex.kind, ex.text);
  }

  function addedLines(r) {
    return (r.added || []).map(function (x) { return "· " + WT.sync.lessonLabel(x); }).join("\n");
  }

  // manual 이 아니면(저절로 확인했을 때) 바뀐 것이 없다는 말은 보여 주지 않는다.
  function showSyncResult(r, manual) {
    var out = $("syncMsg");
    if (r.status === "skipped" || r.status === "none" || (r.status === "unchanged" && !manual)) { msg(out, "", ""); return; }
    var kind = r.status === "error" ? "err" : (r.status === "offline" ? "warn" : "ok");
    var lines = [r.message];
    if (r.status === "updated" && r.added.length) lines.push(addedLines(r));
    if (r.errors && r.errors.length) lines.push("자세히:\n" + r.errors.join("\n"));
    msg(out, kind, lines.join("\n"));
  }

  function runSync(force) {
    if (!WT.store.getConnection()) return Promise.resolve();
    if (force) msg($("syncMsg"), "ok", "단원을 확인하는 중이에요…");
    return WT.sync.run(!!force).then(function (r) {
      showSyncResult(r, !!force);
      renderSync();
      renderLessons();
    });
  }

  var pendingConnect = null;
  function askConnect(parsed) {
    pendingConnect = parsed;
    var old = WT.store.getConnection();
    var s = WT.store.settings();
    var who = WT.sync.CHILD_OWNER[parsed.child];
    var name = s["name" + parsed.child];
    var text = "이 기기를 " + who + (name ? "(" + name + ")" : "") + " 용으로 연결할까요? 연결하면 부모님이 올린 " + who + " 단원이 자동으로 들어와요.";
    if (old && old.child !== parsed.child) {
      text += "\n\n⚠ 이 기기는 지금 " + WT.sync.CHILD_OWNER[old.child] + " 용으로 연결돼 있어요. 연결하면 " + WT.sync.CHILD_OWNER[old.child] + " 단원은 이 기기에서 지워져요.";
    }
    var p = $("connectText");
    p.textContent = text;
    p.style.whiteSpace = "pre-line";
    msg($("connectMsg"), "", "");
    $("btnConnectOk").hidden = false;
    $("btnConnectCancel").textContent = "취소";
    $("connectBox").hidden = false;
    showTab("lessons");
  }

  function closeConnect() {
    pendingConnect = null;
    $("connectBox").hidden = true;
    msg($("connectMsg"), "", "");
  }

  function doConnect() {
    if (!pendingConnect) return;
    var parsed = pendingConnect;
    $("btnConnectOk").disabled = true;
    msg($("connectMsg"), "ok", "연결하는 중이에요…");
    WT.sync.connect(parsed).then(function (r) {
      $("btnConnectOk").disabled = false;
      if (r.status === "updated" || r.status === "unchanged") {
        closeConnect();
        renderSync();
        renderLessons();
        msg($("syncMsg"), "ok", "연결했어요. 단원 " + r.total + "개를 받았어요." + (r.added.length ? "\n" + addedLines(r) : ""));
      } else {
        msg($("connectMsg"), "err", [r.message].concat(r.errors || []).join("\n"));
      }
    });
  }

  // 주소에 연결 링크가 있으면 열쇠가 주소창과 기록에 남지 않도록 바로 지우고, 확인 화면을 띄운다.
  function handleConnectLink() {
    var hash = location.hash;
    if (hash.indexOf("#connect=") !== 0) return false;
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    var parsed;
    try { parsed = WT.sync.parseConnect(hash); }
    catch (e) {
      pendingConnect = null;
      $("connectText").textContent = "연결하지 못했어요.";
      msg($("connectMsg"), "err", e.message);
      $("btnConnectOk").hidden = true;
      $("btnConnectCancel").textContent = "닫기";
      $("connectBox").hidden = false;
      return true;
    }
    askConnect(parsed);
    return true;
  }

  // ---------------------------------------------------------------- 확인 표
  function openCheck(id) {
    var it = find(id);
    if (!it) return;
    var body = $("dlgBody");
    clear(body);
    var box = el("div");
    if (it.kind === "word") {
      var t = WT.word.checkTable(WT.word.load(it.data));
      $("dlgTitle").textContent = "확인 표 · " + ownerLabel(t.owner) + " · " + t.title;
      box.appendChild(el("p", { "class": "hint", text: "문장 출처 규칙: " + sourcesText(t.sources) + " · 해석 필수: " + (t.requireKo ? "예" : "아니오") + " · 교재 대조: " + (t.verified ? "완료" : "아직 안 됨") }));
      var tbl = el("table", { "class": "ct" }, [el("tr", {}, ["#", "단어", "품사", "한글 뜻", "쪽", "영문 뜻 · 연습 페이지 문장"].map(function (h) { return el("th", { text: h }); }))]);
      t.rows.forEach(function (r) {
        var last = el("td", {}, [el("div", { text: r.en })]);
        r.practice.forEach(function (p) { last.appendChild(el("div", { "class": "hint", text: "연습 " + (p.ref || "?") + "번: " + p.text })); });
        tbl.appendChild(el("tr", {}, [el("td", { text: String(r.no || "") }), el("td", { text: r.word }), el("td", { text: r.pos }), el("td", { text: r.ko }), el("td", { text: String(r.page || "") }), last]));
      });
      box.appendChild(tbl);
      box.appendChild(el("p", { "class": "hint", text: "연습 페이지에 문장이 없는 단어(쓰기 문항으로만 나옴): " + (t.noPractice.join(", ") || "없음") }));
      box.appendChild(el("p", { "class": "hint", text: "허용 출처 밖이라 쓰이지 않는 문장: " + t.outside + "개" + (t.requireKo ? " · 해석이 없는 문장: " + t.noKo + "개" : "") }));
    } else {
      var c = WT.chunk.checkTable(WT.chunk.load(it.data));
      $("dlgTitle").textContent = "확인 표 · " + ownerLabel(c.owner) + " · " + c.title;
      box.appendChild(el("p", { "class": "hint", text: "Fill in 힌트: " + (c.hint === "first" ? "첫 글자 있음" : "없음") + " · 교재 대조: " + (c.verified ? "완료" : "아직 안 됨") }));
      var vt = el("table", { "class": "ct" }, [el("tr", {}, ["단원", "단어", "콜로케이션", "한글 뜻"].map(function (h) { return el("th", { text: h }); }))]);
      c.vocab.forEach(function (v) {
        vt.appendChild(el("tr", {}, [el("td", { text: "L" + v.lesson }), el("td", { text: v.word }), el("td", { text: v.colloc || "(콜로케이션 없음)" }), el("td", { text: v.ko })]));
      });
      box.appendChild(vt);
      var ct = el("table", { "class": "ct", style: "margin-top:12px" }, [el("tr", {}, ["단원", "chunk 문장 (빈칸이 될 부분은 { })"].map(function (h) { return el("th", { text: h }); }))]);
      c.chunks.forEach(function (x) { ct.appendChild(el("tr", {}, [el("td", { text: "L" + x.lesson }), el("td", { text: x.sentence })])); });
      box.appendChild(ct);
      box.appendChild(el("p", { "class": "hint", text: "콜로케이션이 없어 Key Vocabulary에서 빠지는 단어: " + (c.noColloc.join(", ") || "없음") }));
    }
    box.appendChild(el("p", { "class": "hint", text: "※ 영문 뜻, 한글 뜻, 문장을 교재와 한 글자씩 대조해 주세요." }));
    body.appendChild(box);
    $("dlg").hidden = false;
  }

  // ---------------------------------------------------------------- 시험지 만들기
  function openMaker(id) {
    var it = find(id);
    if (!it) return;
    state.lessonId = id;
    var d = it.data;
    $("makeEmpty").hidden = true;
    $("makePanel").hidden = false;
    $("makeTitle").textContent = ownerLabel(d.owner) + " · " + (it.kind === "word" ? "단어 Lesson " + d.lesson + (d.title ? " " + d.title : "") : (d.title || "Chunk Quiz"));
    $("optsWord").hidden = it.kind !== "word";
    $("optsChunk").hidden = it.kind !== "chunk";
    $("optSeed").value = "";
    $("optClass").value = d.class_code || "";
    $("makeInfo").hidden = true;
    $("sheet").srcdoc = "";
    if (it.kind === "word") {
      $("wMode").value = "regular";
      $("wPartsBox").hidden = true;
      var hasWeak = d.words.some(function (w) { return w.weak; });
      $("wWeak").checked = false;
      $("wWeak").disabled = !hasWeak;
    } else {
      $("cMode").value = "sample";
      var sel = $("cHint");
      clear(sel);
      sel.appendChild(el("option", { value: "", text: "이 데이터의 기준 (" + (d.hint === "first" ? "첫 글자 있음" : "없음") + ")" }));
      sel.appendChild(el("option", { value: "none", text: "첫 글자 힌트 없음" }));
      sel.appendChild(el("option", { value: "first", text: "첫 글자 힌트 있음" }));
      sel.value = "";
    }
    showTab("make");
    generate();
  }

  function infoLine(data, kind, seed, warnings) {
    var box = $("makeInfo");
    clear(box);
    var rule = kind === "word"
      ? "문장 규칙: " + sourcesText(data.sentence_sources) + (data.require_sentence_ko ? " (정답지에 해석 포함)" : "")
      : "Fill in 힌트: " + (data.hint === "first" ? "첫 글자 있음" : "없음");
    box.appendChild(el("div", { text: "대상 " + ownerLabel(data.owner) + " · " + (kind === "word" ? "단원 Lesson " + data.lesson : (data.title || "")) + " · " + rule + " · 시험지 번호 " + seed }));
    if (!data.verified) {
      box.appendChild(el("div", { "class": "msg err", text: "⚠ 교재와 대조하기 전 데이터예요. 아이에게 주기 전에 부모님이 확인해 주세요." }));
    }
    (warnings || []).forEach(function (w) { box.appendChild(el("div", { "class": "msg warn", text: w })); });
    box.hidden = false;
  }

  function generate() {
    var it = find(state.lessonId);
    if (!it) return;
    var info = $("makeInfo");
    var seedText = $("optSeed").value.trim();
    var seed = seedText && /^\d+$/.test(seedText) ? parseInt(seedText, 10) : WT.util.newSeed();
    var common = { classCode: $("optClass").value.trim() || null, showKey: $("optKey").checked };
    var html, warnings = [], errs = [];
    try {
      if (it.kind === "word") {
        var data = WT.word.load(it.data);
        if ($("wWeak").checked) data = WT.word.onlyWeak(data);
        var src = WT.word.allowedSources(data);
        var sentences;
        if ($("wMode").value === "all-write") {
          var parts = new Set($("wParts").value.split(""));
          var s = WT.word.makeAllWrite(data, src, seed);
          errs = WT.word.validateAllWrite(data, s, parts);
          warnings = s.warnings.slice();
          sentences = s.b.map(function (p) { return p[1]; });
          html = WT.word.buildAllWrite(data, s, Object.assign({ parts: parts }, common));
        } else {
          var s2 = WT.word.makeRegular(data, WT.word.defaultMcq(data), src, seed);
          errs = WT.word.validateRegular(data, s2);
          warnings = s2.warnings.slice();
          sentences = s2.mcq.map(function (p) { return p[1]; });
          html = WT.word.buildRegular(data, s2, common);
        }
        var miss = WT.word.missingKo(data, sentences);
        if (miss.length) warnings.push("정답지에 해석이 없는 문장이 " + miss.length + "개 있어요: " + miss.slice(0, 3).join(" / "));
        if (!errs.length) infoLine(data, "word", seed, warnings);
      } else {
        var cd = WT.chunk.load(it.data);
        var mode = $("cMode").value;
        var hint = $("cHint").value || cd.hint;
        var cs = WT.chunk.makeSet(cd, mode, 6, 3, 2, 1, seed);
        errs = WT.chunk.validate(cd, cs);
        if (cs.skipped.length) warnings.push("콜로케이션이 없어 뺀 단어: " + cs.skipped.join(", "));
        if (hint !== cd.hint) warnings.push("데이터 기준(" + (cd.hint === "first" ? "첫 글자 있음" : "없음") + ")과 다른 힌트로 만들었어요.");
        html = WT.chunk.build(cd, cs, Object.assign({ hint: hint }, common));
        if (!errs.length) infoLine(cd, "chunk", seed, warnings);
      }
    } catch (e) {
      info.hidden = false;
      clear(info);
      info.appendChild(el("div", { "class": "msg err", text: "시험지를 만들지 않았어요.\n" + e.message }));
      $("sheet").srcdoc = "";
      return;
    }
    if (errs.length) {
      info.hidden = false;
      clear(info);
      info.appendChild(el("div", { "class": "msg err", text: "규칙 점검에서 걸려 시험지를 만들지 않았어요.\n" + errs.join("\n") }));
      $("sheet").srcdoc = "";
      return;
    }
    $("sheet").srcdoc = html;
  }

  function printSheet() {
    var f = $("sheet");
    if (!f.srcdoc) { window.alert("먼저 시험지를 만들어 주세요."); return; }
    try { f.contentWindow.focus(); f.contentWindow.print(); }
    catch (e) { window.alert("인쇄 화면을 열지 못했어요: " + e.message); }
  }

  // ---------------------------------------------------------------- 설정
  function initSettings() {
    var s = WT.store.settings();
    $("nameA").value = s.nameA;
    $("nameB").value = s.nameB;
    $("storageNote").textContent = WT.store.isPersistent()
      ? "가져온 단원은 이 기기의 브라우저에 저장돼요. 브라우저 데이터를 지우면 사라지니 백업 파일을 만들어 두세요."
      : "이 브라우저에서는 저장을 쓸 수 없어서, 창을 닫으면 가져온 단원이 사라져요. 비공개 창이면 일반 창으로 열어 주세요.";
  }

  function download(name, text) {
    var blob = new Blob([text], { type: "application/json" });
    var a = el("a", { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function bind() {
    Array.prototype.forEach.call(document.querySelectorAll("#tabs button"), function (b) {
      b.addEventListener("click", function () { showTab(b.getAttribute("data-tab")); });
    });
    $("btnImport").addEventListener("click", doImport);
    $("btnSync").addEventListener("click", function () { runSync(true); });
    $("btnConnectOk").addEventListener("click", doConnect);
    $("btnConnectCancel").addEventListener("click", closeConnect);
    $("btnDisconnect").addEventListener("click", function () {
      if (!window.confirm("연결을 끊을까요? 부모님이 올려 준 단원이 이 기기에서 지워지고, 다시 받으려면 새 연결 링크가 필요해요.")) return;
      WT.sync.disconnect();
      state.lessonId = null;
      $("makePanel").hidden = true;
      $("makeEmpty").hidden = false;
      msg($("syncMsg"), "", "");
      renderSync();
      renderLessons();
    });
    document.addEventListener("visibilitychange", function () { if (!document.hidden) runSync(false); });
    window.addEventListener("online", function () { runSync(false); });
    $("btnMake").addEventListener("click", function () { $("optSeed").value = ""; generate(); });
    $("btnPrint").addEventListener("click", printSheet);
    // 번호를 입력하면 그 번호의 시험지를 다시 만든다
    $("optSeed").addEventListener("change", generate);
    ["wMode", "wParts", "wWeak", "cMode", "cHint", "optKey"].forEach(function (id) {
      $(id).addEventListener("change", function () {
        if (id === "wMode") $("wPartsBox").hidden = $("wMode").value !== "all-write";
        $("optSeed").value = "";
        generate();
      });
    });
    $("dlgClose").addEventListener("click", function () { $("dlg").hidden = true; });
    $("dlg").addEventListener("click", function (e) { if (e.target === $("dlg")) $("dlg").hidden = true; });
    $("btnNames").addEventListener("click", function () {
      var s = WT.store.settings();
      s.nameA = $("nameA").value.trim();
      s.nameB = $("nameB").value.trim();
      WT.store.saveSettings(s);
      $("namesMsg").textContent = " 저장했어요.";
      renderSync();
      renderLessons();
    });
    $("btnExport").addEventListener("click", function () {
      var stamp = new Date().toISOString().slice(0, 10);
      download("단어연습-백업-" + stamp + ".json", WT.store.exportAll());
      msg($("backupMsg"), "ok", "백업 파일을 만들었어요. 다운로드 폴더를 확인해 주세요.");
    });
    $("backupIn").addEventListener("change", function () {
      var f = $("backupIn").files[0];
      if (!f) return;
      f.text().then(function (t) {
        var r = WT.store.importText(t, f.name);
        var ok = summarize(r);
        msg($("backupMsg"), r.errors.length ? (ok ? "warn" : "err") : "ok", (ok ? ok + "\n" : "") + r.errors.join("\n"));
        renderLessons();
        initSettings();
      });
      $("backupIn").value = "";
    });
    $("btnWipe").addEventListener("click", function () {
      if (window.confirm("직접 가져온 단원을 모두 지울까요? 백업 파일이 없으면 되돌릴 수 없어요.")) {
        WT.store.removeAll();
        state.lessonId = null;
        $("makePanel").hidden = true;
        $("makeEmpty").hidden = false;
        renderLessons();
      }
    });
  }

  function init() {
    bind();
    initSettings();
    renderSync();
    renderLessons();
    // 연결 링크로 열었으면 확인 화면을 먼저 보여 주고, 이미 연결된 기기는 새 단원이 있는지 저절로 확인한다.
    if (!handleConnectLink()) runSync(false);
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
