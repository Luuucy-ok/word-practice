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
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
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
  // 두 아이를 함께 연결한 기기면 연결 정보를, 아니면 null 을 돌려준다.
  function multiChild() {
    var c = WT.store.getConnection();
    return c && c.kids.length > 1 ? c : null;
  }
  function childLabel(code) {
    var name = WT.store.settings()["name" + code];
    return WT.sync.CHILD_OWNER[code] + (name ? "(" + name + ")" : "");
  }

  function find(id) {
    if (state.virtual && state.virtual.id === id) return state.virtual; // 누적 시험지용으로 합친 단원
    return WT.store.list().filter(function (x) { return x.id === id; })[0];
  }

  // ---------------------------------------------------------------- 꾸미기와 스티커
  // 설정의 「꾸미기」: 연결된 아이마다(연결하지 않은 기기는 「이 기기」 하나) 테마를 고른다.
  function renderThemeCard() {
    var box = $("themeRows");
    if (!box) return;
    clear(box);
    var conn = WT.store.getConnection();
    var codes = conn ? conn.kids : ["_"];
    codes.forEach(function (code) {
      var now = WT.fun.themeOf(code);
      box.appendChild(el("div", { "class": "themerow" }, [
        el("div", { "class": "tname", text: code === "_" ? "이 기기" : childLabel(code) }),
        el("div", { "class": "row" }, WT.fun.ORDER.map(function (name) {
          var t = WT.fun.THEMES[name];
          return el("button", { type: "button", "class": "opt themeopt" + (now === name ? " on" : ""), "data-pick": name, "data-code": code, onclick: function () {
            WT.fun.setTheme(code, name);
            WT.fun.apply();
            WT.fun.sound("tap");
            renderThemeCard();
            renderStickers();
          } }, [el("span", { "class": "sw sw-" + name }), (t.icon ? t.icon + " " : "") + t.label]);
        }))
      ]));
    });
    $("soundOn").checked = WT.fun.soundOn();
  }

  // 단원 화면 위의 스티커 판. 연결된 기기는 지금 보는 아이 것만, 아니면 스티커가 있는 아이마다 보여 준다.
  function renderStickers() {
    var box = $("stickerBox");
    clear(box);
    if (!WT.store.list().length) return;
    var conn = WT.store.getConnection();
    var codes = conn ? [conn.child] : ["A", "B", "_"].filter(function (c) { return WT.fun.stickers(c).length; });
    if (!codes.length) codes = ["_"];
    codes.forEach(function (code) {
      var list = WT.fun.stickers(code);
      var who = code === "_" ? "" : childLabel(code) + " ";
      var recent = list.slice(-6).reverse().map(function (x) { return x.s; }).join("");
      var card = el("details", { "class": "card stickers", "data-code": code }, [
        el("summary", {}, [
          el("span", { "class": "stitle", text: "🏅 " + who + "스티커 " + list.length + "개" }),
          el("span", { "class": "srecent" + (list.length ? "" : " empty"), text: list.length ? recent : "눌러서 받는 방법 보기" })
        ])
      ]);
      if (list.length) {
        var board = el("div", { "class": "sboard" });
        list.slice().reverse().slice(0, 200).forEach(function (x) {
          board.appendChild(el("span", { title: fmtDay(x.at) + (x.from ? " · " + x.from : ""), text: x.s }));
        });
        card.appendChild(board);
        if (list.length > 200) card.appendChild(el("div", { "class": "hint", text: "최근 200개만 보여 줘요." }));
      } else {
        card.appendChild(el("p", { "class": "hint", style: "margin-top:8px", text: "외우기를 끝까지 하거나 태블릿에서 시험을 채점하면 스티커를 하나씩 받아요. 만점이면 하나 더 받아요." }));
      }
      box.appendChild(card);
    });
  }

  function renderLessons() {
    renderStickers();
    renderAcademy();
    var box = $("lessonList");
    clear(box);
    WT.store.pruneFixes(); // 원본이 고쳐져 새로 받은 단원에 반영된 고칠 곳은 목록에서 뺀다
    var items = WT.store.list();
    var mc = multiChild();
    // 두 아이를 함께 연결한 기기에서는 지금 보는 아이의 단원만 보여 준다.
    if (mc) items = items.filter(function (x) { return x.data.owner === WT.sync.CHILD_OWNER[mc.active]; });
    if (!items.length) {
      box.appendChild(el("div", { "class": "card", text: WT.store.getConnection()
        ? "아직 받은 단원이 없어요. 부모님이 단원을 올리면 아래 「지금 새로 받기」로 받을 수 있어요."
        : "아직 가져온 단원이 없어요. 부모님께 받은 연결 링크를 열면 단원이 자동으로 들어와요. 파일이 있으면 아래의 「단원 파일을 직접 가져오기」를 눌러 넣을 수 있어요." }));
      return;
    }
    // 단어 시험(월·수) 먼저, 그다음 Chunk 시험(금). 그 안에서는 아이, 단원 번호 순서.
    items.sort(function (a, b) {
      return ((a.kind === "word" ? "0" : "1") + a.data.owner + String(a.data.lesson || a.data.title)).localeCompare((b.kind === "word" ? "0" : "1") + b.data.owner + String(b.data.lesson || b.data.title), "ko", { numeric: true });
    });
    // 한 아이 단원만 보일 때는 줄마다 같은 아이 이름을 숨긴다(글자는 남겨 찾기·읽기 프로그램용).
    var ownerSet = {};
    items.forEach(function (x) { ownerSet[x.data.owner] = 1; });
    box.classList.toggle("single", Object.keys(ownerSet).length < 2);
    // 「시험 끝」으로 표시한 단원은 맨 아래의 접힌 묶음으로 보낸다(최근에 끝낸 것부터).
    var todo = items.filter(function (it) { return !WT.store.doneAt(it.id); });
    var done = items.filter(function (it) { return !!WT.store.doneAt(it.id); })
      .sort(function (a, b) { return WT.store.doneAt(b.id).localeCompare(WT.store.doneAt(a.id)); });
    if (state.doneNotice) {
      var nid = state.doneNotice;
      state.doneNotice = null;
      var nit = items.filter(function (x) { return x.id === nid; })[0];
      if (nit && WT.store.doneAt(nid)) box.appendChild(el("div", { "class": "msg ok donenote", id: "doneNotice" }, [
        document.createTextNode("「" + lessonTitle(nit) + "」을(를) 시험 끝난 단원으로 옮겼어요. 맨 아래에서 볼 수 있어요. "),
        el("button", { type: "button", id: "btnUndoDone", text: "되돌리기", onclick: function () { WT.store.setDone(nid, false); renderLessons(); } })
      ]));
    }
    if (state.academyNotice) {
      var aid = state.academyNotice;
      state.academyNotice = null;
      var ait = items.filter(function (x) { return x.id === aid; })[0];
      if (ait) box.appendChild(el("div", { "class": "msg ok donenote", id: "academyNotice", text: "🏆 「" + lessonTitle(ait) + "」 학원 시험 만점! 트로피 스티커를 받았어요." }));
    }
    if (!todo.length) box.appendChild(el("div", { "class": "card", text: "지금 공부할 단원이 없어요. 시험 끝난 단원은 아래에 있어요." }));
    // 종류마다 큰 머리말을 두어 단어 시험과 Chunk 시험을 한눈에 나눈다(카드는 #lessonList 바로 아래에 둔다).
    // 같은 아이 단원이 2개 이상이면 머리말에 「📚 누적 시험지」 버튼을 둔다(모두 시험 끝이어도 머리말은 보임).
    ["word", "chunk"].forEach(function (kind) {
      var mine = todo.filter(function (it) { return it.kind === kind; });
      var cum = cumulativeOwners(items, kind).length > 0;
      if (!mine.length && !cum) return;
      box.appendChild(el("h2", { "class": "kindhead k-" + kind }, [
        el("span", { "class": "ki", text: KIND[kind].icon }),
        el("span", { text: KIND[kind].name }),
        el("span", { "class": "kday", text: KIND[kind].day }),
        el("span", { "class": "kn", text: mine.length ? mine.length + "개" : "모두 시험 끝" }),
        cum ? el("button", { type: "button", "class": "cumbtn", "data-kind": kind, text: "📚 누적 시험지", onclick: function () { openCumulative(kind); } }) : null
      ]));
      mine.forEach(function (it) { box.appendChild(lessonCard(it)); });
    });
    if (done.length) {
      var grp = el("details", { "class": "donegroup", id: "doneGroup" }, [
        el("summary", { text: "✅ 시험 끝난 단원 " + done.length + "개" })
      ]);
      if (state.doneOpen) grp.open = true;
      grp.addEventListener("toggle", function () { state.doneOpen = grp.open; });
      done.forEach(function (it) { grp.appendChild(lessonCard(it)); });
      box.appendChild(grp);
    }
  }

  // 단원 종류: 아이가 한눈에 구분하도록 그림·이름·요일·색을 나눈다.
  var KIND = {
    word: { icon: "📘", name: "단어 시험", day: "월·수", short: "단어" },
    chunk: { icon: "🧩", name: "Chunk 시험", day: "금", short: "Chunk" }
  };

  // 카드 큰 제목: 「단어」/「Chunk Quiz」는 작게, Lesson 번호는 크게, 단원 이름은 아래 작게.
  function titleParts(it) {
    var d = it.data;
    if (it.kind === "word") return { pre: "단어", main: "Lesson " + d.lesson, sub: d.title || "" };
    var t = d.title || "Chunk Quiz";
    var m = /^(Chunk Quiz)\s+(.+)$/i.exec(t);
    return m ? { pre: m[1], main: m[2], sub: "" } : { pre: "", main: t, sub: "" };
  }

  // 번호 상자에 넣을 글자: 단어는 Lesson 번호, chunk 는 제목의 숫자들(예: 7·8)
  function lessonNo(it) {
    if (it.kind === "word") return String(it.data.lesson);
    var nums = String(it.data.title || "").match(/\d+/g);
    return nums ? nums.join("·") : "?";
  }

  // 단원 한 줄(A안): [번호 상자] 이름·상태 [외우기][시험지 만들기][⋯]. ⋯ 이나 이름을 누르면 나머지 버튼이 펼쳐진다.
  function lessonCard(it) {
    var doneAt = WT.store.doneAt(it.id);
    var d = it.data;
    var verified = !!d.verified;
    var tp = titleParts(it);
    var meta = it.kind === "word"
      ? "단어 " + d.words.length + "개 · 문장 출처: " + sourcesText(d.sentence_sources) + " · 해석 필수: " + (d.require_sentence_ko ? "예" : "아니오")
      : "Key Vocabulary " + (d.vocab || []).length + "개 · chunk 문장 " + (d.chunks || []).length + "개 · Fill in 첫 글자 힌트: " + (d.hint === "first" ? "있음" : "없음");
    var weakN = WT.store.weakCount(it);
    var fixN = WT.store.fixesFor(it.id).length;
    var ac = WT.store.academyFor(it.id);
    var rs = WT.store.resultsFor(it.id)[0];
    var open = !!(state.openRows && state.openRows[it.id]);
    var study = function (scope) { WT.study.open(it, { who: ownerLabel(it.data.owner), owner: it.data.owner, scope: scope, onClose: function () { renderLessons(); updateWeakControls(); } }); };
    var card, exp;
    function toggle() {
      state.openRows = state.openRows || {};
      open = !open;
      state.openRows[it.id] = open;
      exp.hidden = !open;
      card.classList.toggle("open", open);
      more.setAttribute("aria-expanded", open ? "true" : "false");
    }
    var parent = el("details", { "class": "parentbox" }, [
      el("summary", { text: "⋯ 부모님용" + (fixN ? " · 고칠 곳 " + fixN + "개" : "") }),
      el("div", { "class": "pbadges" }, [
        el("span", { "class": "badge " + (verified ? "ok" : "warn"), text: verified ? "교재 대조 완료" : "교재 대조 전" }),
        it.synced ? el("span", { "class": "badge kind", text: "부모님이 올림" }) : null,
        fixN ? el("span", { "class": "badge kind", text: "고칠 곳 " + fixN + "개" }) : null
      ]),
      el("div", { "class": "meta", text: meta }),
      el("div", { "class": "row" }, [
        el("button", { type: "button", text: "확인 표", onclick: function () { openCheck(it.id); } })
      ].concat(it.synced ? [] : [
        el("button", { type: "button", "class": "danger", text: "삭제", onclick: function () {
          if (window.confirm("이 단원을 이 기기에서 지울까요?")) { WT.store.remove(it.id); renderLessons(); }
        } })
      ]))
    ]);
    exp = el("div", { "class": "lexp" }, [
      recentLine(it),
      academyLine(it),
      el("div", { "class": "row subbtns" }, [
        el("button", { type: "button", "data-b": "weak", text: "틀린 단어 표시", onclick: function () { openWeak(it.id); } }),
        el("button", { type: "button", "class": "acadbtn", "data-b": "academy", text: "📝 학원 점수", onclick: function () { openAcademy(it.id); } }),
        doneAt
          ? el("button", { type: "button", "class": "donebtn", text: "↩ 다시 위로", onclick: function () { WT.store.setDone(it.id, false); renderLessons(); } })
          : el("button", { type: "button", "class": "donebtn", text: "✅ 시험 봤어요", onclick: function () {
            WT.store.setDone(it.id, true);
            state.doneNotice = it.id;
            renderLessons();
            window.scrollTo(0, 0);
          } })
      ]),
      parent
    ]);
    exp.hidden = !open;
    var more = el("button", { type: "button", "class": "lmore", "aria-label": "더 보기", "aria-expanded": open ? "true" : "false", text: "⋯", onclick: toggle });
    card = el("div", { "class": "card lesson k-" + it.kind + (doneAt ? " done" : "") + (open ? " open" : ""), "data-id": it.id }, [
      el("div", { "class": "lrow" }, [
        el("div", { "class": "lnum", "aria-hidden": "true" }, [el("small", { text: it.kind === "word" ? "Lesson" : "Chunk" }), el("b", { text: lessonNo(it) })]),
        el("div", { "class": "head", role: "button", tabindex: "0", onclick: toggle }, [
          // 화면에는 숨기고 읽기 프로그램·찾기용으로 전체 이름을 둔다(예: 단어 Lesson 7 The Coin Club)
          el("span", { "class": "sr", text: lessonTitle(it) }),
          el("div", { "class": "ln1" }, [
            el("span", { "class": "lname", text: it.kind === "word" ? (tp.sub || "Lesson " + d.lesson) : (tp.pre || "Chunk Quiz") }),
            el("span", { "class": "owner", text: ownerLabel(d.owner) })
          ]),
          el("div", { "class": "chips" }, [
            doneAt ? el("span", { "class": "chip done", text: "✅ 시험 끝 " + fmtDay(doneAt) }) : null,
            // 틀린 항목이 있으면 누르면 바로 「틀린 것만 외우기」가 열리는 버튼
            weakN ? el("button", { type: "button", "class": "chip weak", "data-r": "review", text: "🔁 틀린 항목 " + weakN + "개", onclick: function (e) { e.stopPropagation(); study("weak"); } }) : null,
            ac ? el("span", { "class": "chip ac", text: "📝 학원 " + scoreText(ac) + (ac.score === ac.total ? " 🏆" : "") }) : null,
            rs ? el("span", { "class": "chip tab", text: "태블릿 " + rs.score + "/" + rs.total }) : null,
            !weakN && !ac && !rs && !doneAt ? el("span", { "class": "chip none", text: "아직 안 해 봤어요" }) : null
          ])
        ]),
        el("div", { "class": "lacts" }, [
          // 진한 버튼은 「외우기」 하나만, 「시험지 만들기」는 테두리 버튼
          el("button", { type: "button", "class": "primary", "data-b": "study", text: "외우기", onclick: function () { study("all"); } }),
          el("button", { type: "button", "data-b": "make", text: "시험지 만들기", onclick: function () { openMaker(it.id); } }),
          more
        ])
      ]),
      exp
    ]);
    return card;
  }

  // ---------------------------------------------------------------- 누적 시험지
  // 같은 아이의 여러 단원을 합쳐 한 장으로 낸다. 단어는 전체 쓰기, chunk 는 범위 전체 형식.
  // 문장 규칙(문장 출처, 해석 필수)이나 Fill 힌트가 다른 단원은 섞지 않는다(아이마다 반 규칙이 다름).
  // 문제 수를 고르면 약한 항목(틀린 것)을 먼저 넣고 나머지는 무작위로 채운다. 태블릿에서 틀린 것은 원래 단원의 약한 목록에 들어간다.
  var CUM_COUNTS = [10, 20, 30, 0]; // 0 = 전부

  // 이 종류에서 단원이 2개 이상인 아이들
  function cumulativeOwners(items, kind) {
    var n = {};
    items.forEach(function (it) { if (it.kind === kind) n[it.data.owner] = (n[it.data.owner] || 0) + 1; });
    return Object.keys(n).filter(function (o) { return n[o] >= 2; }).sort();
  }
  function lessonNums(it) { return it.kind === "word" ? String(it.data.lesson) : lessonNo(it); }
  function ruleKey(it) {
    var d = it.data;
    return it.kind === "word" ? (d.sentence_sources || []).slice().sort().join(",") + "|" + !!d.require_sentence_ko : String(d.hint);
  }
  // 고른 단원의 항목(약한 표시 포함) → [{ key, src, weak, part: "w"|"v"|"c", obj }]
  function cumulativeItems(lessons) {
    var seen = {}, out = [];
    lessons.forEach(function (it) {
      var d = WT.store.withWeak(it); // 기기의 약한 표시를 항목의 weak 로 옮긴 복사본
      if (it.kind === "word") {
        (d.words || []).forEach(function (w) { var k = w.word; if (seen[k]) return; seen[k] = 1; out.push({ key: k, src: it.id, weak: !!w.weak, part: "w", obj: w }); });
      } else {
        (d.vocab || []).forEach(function (v) { if (!(v.colloc && /\{.+?\}/.test(v.colloc))) return; var k = "v|" + v.word; if (seen[k]) return; seen[k] = 1; out.push({ key: k, src: it.id, weak: !!v.weak, part: "v", obj: v }); });
        (d.chunks || []).forEach(function (c) { var k = "c|" + c.sentence; if (seen[k]) return; seen[k] = 1; out.push({ key: k, src: it.id, weak: !!c.weak, part: "c", obj: c }); });
      }
    });
    return out;
  }
  // 약한 것 먼저, 나머지는 무작위로 n 개(0 이면 전부). 고른 뒤에는 원래 순서(단원·항목 순)로 둔다.
  function pickCumulative(list, n) {
    if (!n || n >= list.length) return list.slice();
    var rng = new WT.util.Rng(WT.util.newSeed());
    var weak = rng.shuffle(list.filter(function (x) { return x.weak; }));
    var rest = rng.shuffle(list.filter(function (x) { return !x.weak; }));
    var chosen = weak.concat(rest).slice(0, n);
    return list.filter(function (x) { return chosen.indexOf(x) >= 0; });
  }
  // 합친 단원(시험지 탭에 넘길 가상 단원)
  function buildCumulative(kind, lessons, picked) {
    var first = lessons[0].data;
    var nums = lessons.map(lessonNums).join("·");
    var keyMap = {};
    picked.forEach(function (x) { keyMap[x.key] = x.src; });
    var data;
    if (kind === "word") {
      data = { kind: "word", owner: first.owner, book: first.book, class_code: first.class_code,
        sentence_sources: first.sentence_sources.slice(), require_sentence_ko: !!first.require_sentence_ko,
        verified: lessons.every(function (it) { return !!it.data.verified; }),
        lesson: nums, title: "누적 복습", words: picked.map(function (x) { return x.obj; }) };
    } else {
      data = { kind: "chunk", owner: first.owner, hint: first.hint, class_code: first.class_code,
        verified: lessons.every(function (it) { return !!it.data.verified; }),
        title: "Chunk Quiz 누적 복습 (" + nums + ")",
        vocab: picked.filter(function (x) { return x.part === "v"; }).map(function (x) { return x.obj; }),
        chunks: picked.filter(function (x) { return x.part === "c"; }).map(function (x) { return x.obj; }) };
    }
    return { id: "cum|" + kind + "|" + Date.now(), kind: kind, data: data, synced: true, virtual: true, keyMap: keyMap,
      srcIds: lessons.map(function (it) { return it.id; }), count: picked.length };
  }

  function openCumulative(kind) {
    var all = WT.store.list();
    var mc = multiChild();
    if (mc) all = all.filter(function (x) { return x.data.owner === WT.sync.CHILD_OWNER[mc.active]; });
    var owners = cumulativeOwners(all, kind);
    if (!owners.length) return;
    var st = state.cum = state.cum && state.cum.kind === kind ? state.cum : { kind: kind, owner: owners[0], n: 20, checked: null };
    if (owners.indexOf(st.owner) < 0) st.owner = owners[0];
    var body = $("dlgBody");
    clear(body);
    $("dlgTitle").textContent = "📚 누적 시험지 · " + KIND[kind].name;
    body.appendChild(el("p", { "class": "hint", text: "여러 단원을 한 장으로 묶어 복습해요. " + (kind === "word" ? "모든 단어를 직접 쓰는 「전체 쓰기」" : "「범위 전체」") + " 형식이고, 틀린 항목을 먼저 넣어요. 태블릿에서 풀면 틀린 것은 원래 단원의 약한 목록에 들어가요." }));
    if (owners.length > 1) {
      body.appendChild(el("div", { "class": "seg cumowner", role: "group", "aria-label": "아이" }, owners.map(function (o) {
        return el("button", { type: "button", "class": o === st.owner ? "on" : "", "data-owner": o, text: ownerLabel(o), onclick: function () { st.owner = o; st.checked = null; openCumulative(kind); } });
      })));
    }
    var mine = all.filter(function (it) { return it.kind === kind && it.data.owner === st.owner; });
    mine.sort(function (a, b) { return String(lessonNums(a)).localeCompare(String(lessonNums(b)), "ko", { numeric: true }); });
    if (!st.checked) { st.checked = {}; mine.forEach(function (it) { if (WT.store.doneAt(it.id)) st.checked[it.id] = 1; }); }
    body.appendChild(el("div", { "class": "weakgroup", text: "넣을 단원 (시험 끝난 단원은 처음부터 체크돼 있어요)" }));
    var list = el("div", { "class": "weaklist cumlist" });
    mine.forEach(function (it) {
      var cb = el("input", { type: "checkbox", "data-id": it.id });
      cb.checked = !!st.checked[it.id];
      var weakN = WT.store.weakCount(it);
      var lab = el("label", { "class": cb.checked ? "on" : "" }, [cb, el("span", { "class": "t" }, [
        el("span", { "class": "w", text: lessonTitle(it) }),
        el("span", { "class": "s", text: (WT.store.doneAt(it.id) ? "✅ 시험 끝 " + fmtDay(WT.store.doneAt(it.id)) : "공부 중") + (weakN ? " · 🔁 틀린 항목 " + weakN + "개" : "") })
      ])]);
      cb.addEventListener("change", function () { if (cb.checked) st.checked[it.id] = 1; else delete st.checked[it.id]; lab.classList.toggle("on", cb.checked); summary(); });
      list.appendChild(lab);
    });
    body.appendChild(list);
    body.appendChild(el("div", { "class": "weakgroup", text: "문제 수 (틀린 항목을 먼저 넣어요)" }));
    var seg = el("div", { "class": "seg cumcount", role: "group", "aria-label": "문제 수" });
    CUM_COUNTS.forEach(function (n) {
      seg.appendChild(el("button", { type: "button", "class": n === st.n ? "on" : "", "data-n": String(n), text: n ? n + "개" : "전부", onclick: function () {
        st.n = n;
        Array.prototype.forEach.call(seg.querySelectorAll("button"), function (b) { b.classList.toggle("on", Number(b.getAttribute("data-n")) === n); });
        summary();
      } }));
    });
    body.appendChild(seg);
    var sum = el("p", { "class": "hint", id: "cumSummary", style: "margin-top:10px" });
    body.appendChild(sum);
    var out = el("div", { id: "cumMsg", role: "status" });
    body.appendChild(out);
    body.appendChild(el("div", { "class": "row", style: "margin-top:10px" }, [
      el("button", { type: "button", "class": "primary", id: "btnCumMake", text: "📚 누적 시험지 만들기", onclick: make }),
      el("button", { type: "button", text: "취소", onclick: function () { $("dlg").hidden = true; } })
    ]));
    summary();
    $("dlg").hidden = false;

    function chosen() { return mine.filter(function (it) { return st.checked[it.id]; }); }
    function summary() {
      var ls = chosen();
      if (!ls.length) { sum.textContent = "단원을 하나 이상 골라 주세요."; return; }
      var items = cumulativeItems(ls);
      var w = items.filter(function (x) { return x.weak; }).length;
      var n = st.n && st.n < items.length ? st.n : items.length;
      sum.textContent = "고른 단원 " + ls.length + "개 · " + (kind === "word" ? "단어 " : "항목 ") + items.length + "개(틀린 것 " + w + "개) → " + n + "개를 내요";
    }
    function make() {
      var ls = chosen();
      if (!ls.length) { msg(out, "err", "단원을 하나 이상 골라 주세요."); return; }
      var rules = {};
      ls.forEach(function (it) { rules[ruleKey(it)] = 1; });
      if (Object.keys(rules).length > 1) {
        msg(out, "err", kind === "word" ? "문장 규칙(문장 출처, 해석 필수)이 다른 단원은 함께 낼 수 없어요. 같은 규칙의 단원만 골라 주세요." : "Fill in 첫 글자 힌트가 다른 단원은 함께 낼 수 없어요.");
        return;
      }
      var v = buildCumulative(kind, ls, pickCumulative(cumulativeItems(ls), st.n));
      state.virtual = v;
      $("dlg").hidden = true;
      openMaker(v.id);
    }
  }

  // ---------------------------------------------------------------- 학원 시험 점수
  var FULL = { word: 100, chunk: 20 }; // 기본 만점: 월·수 단어 시험 10문항 × 10점, Chunk Quiz 20점
  function scoreText(r) { return r.score + "/" + r.total; }
  function academyLine(it) {
    var r = WT.store.academyFor(it.id);
    if (!r) return null;
    return el("div", { "class": "recent academy" }, [
      el("b", { text: "📝 학원 점수 " + scoreText(r) + (r.score === r.total ? " 🏆" : "") }),
      document.createTextNode(" (" + fmtDay(r.date + "T00:00:00") + ")" + (r.wrong && r.wrong.length ? " · 틀린 것 " + r.wrong.length + "개" : "") + (r.memo ? " · " + r.memo : ""))
    ]);
  }
  function todayStr() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }

  // 학원 점수 적기: 날짜, 점수/만점, 틀린 것 체크(약한 목록에도 넣음), 짧은 메모. 단원마다 하나이고 다시 적으면 고친다.
  function openAcademy(id) {
    var it = find(id);
    if (!it) return;
    var old = WT.store.academyFor(id);
    dlgRefresh = id;
    var body = $("dlgBody");
    clear(body);
    $("dlgTitle").textContent = "학원 점수 · " + ownerLabel(it.data.owner) + " · " + lessonTitle(it);
    var date = el("input", { type: "date", id: "acDate", value: old ? old.date : todayStr() });
    var score = el("input", { type: "number", id: "acScore", inputmode: "numeric", min: "0", step: "1", "class": "num", value: old ? String(old.score) : "" });
    var total = el("input", { type: "number", id: "acTotal", inputmode: "numeric", min: "1", step: "1", "class": "num", value: String(old ? old.total : FULL[it.kind] || 100) });
    var memo = el("input", { type: "text", id: "acMemo", maxlength: "40", placeholder: "예: 대문자 실수", value: old && old.memo ? old.memo : "" });
    body.appendChild(el("div", { "class": "acform" }, [
      el("label", { "class": "field" }, ["시험 본 날", date]),
      el("label", { "class": "field" }, ["점수", el("span", { "class": "acscore" }, [score, " / ", total, " 점"])])
    ]));
    body.appendChild(el("p", { "class": "hint", text: it.kind === "word" ? "단어 시험은 한 문제에 10점이에요(10문항, 100점)." : "Chunk Quiz 는 20점 만점이에요. 만점이 다르면 오른쪽 칸을 고쳐요." }));
    body.appendChild(el("div", { "class": "weakgroup", text: "틀린 것 체크 (체크한 것은 약한 목록에도 들어가요)" }));
    var wrong = old && Array.isArray(old.wrong) ? old.wrong.slice() : [];
    var group = null, list = null;
    var items = WT.store.weakItems(it.data);
    var multi = items.some(function (x) { return x.group !== items[0].group; });
    items.forEach(function (x) {
      if (x.group !== group) {
        group = x.group;
        if (multi) body.appendChild(el("div", { "class": "weakgroup sub", text: group }));
        list = el("div", { "class": "weaklist" });
        body.appendChild(list);
      }
      var cb = el("input", { type: "checkbox", "data-key": x.key });
      cb.checked = wrong.indexOf(x.key) >= 0;
      var lab = el("label", { "class": cb.checked ? "on" : "" }, [cb, el("span", { "class": "t" }, [el("span", { "class": "w", text: x.label }), el("span", { "class": "s", text: x.sub })])]);
      cb.addEventListener("change", function () { lab.classList.toggle("on", cb.checked); });
      list.appendChild(lab);
    });
    body.appendChild(el("label", { "class": "field", style: "margin-top:14px" }, ["메모 (한 줄, 40자까지)", memo]));
    var out = el("div", { id: "acMsg", role: "status" });
    body.appendChild(out);
    var row = el("div", { "class": "row", style: "margin-top:10px" }, [
      el("button", { type: "button", "class": "primary", id: "btnAcSave", text: "저장", onclick: save })
    ]);
    if (old) row.appendChild(el("button", { type: "button", "class": "danger", id: "btnAcDelete", text: "기록 지우기", onclick: function () {
      if (!window.confirm("이 단원의 학원 점수 기록을 지울까요?")) return;
      WT.store.setAcademy(id, null);
      closeDlg();
    } }));
    row.appendChild(el("button", { type: "button", text: "취소", onclick: closeDlg }));
    body.appendChild(row);
    $("dlg").hidden = false;

    function save() {
      var s = Number(score.value), t = Number(total.value);
      if (score.value === "" || !isFinite(s) || s < 0 || Math.floor(s) !== s) { msg(out, "err", "점수를 0 이상의 정수로 적어 주세요."); return; }
      if (!isFinite(t) || t < 1 || Math.floor(t) !== t) { msg(out, "err", "만점을 1 이상의 정수로 적어 주세요."); return; }
      if (s > t) { msg(out, "err", "점수가 만점(" + t + "점)보다 커요."); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value)) { msg(out, "err", "시험 본 날을 골라 주세요."); return; }
      var keys = Array.prototype.map.call(body.querySelectorAll("input[type=checkbox]:checked"), function (c) { return c.getAttribute("data-key"); });
      keys.forEach(function (k) { WT.store.setWeak(id, k, true); }); // 틀린 것은 약한 목록에도 넣는다(체크를 풀어도 약한 목록에서는 빼지 않음)
      var full = s === t;
      var trophy = !!(old && old.trophy);
      var got = null;
      if (full && !trophy) { got = WT.fun.award(it.data.owner, "학원 시험 만점 · " + lessonTitle(it), "🏆"); trophy = true; }
      WT.store.setAcademy(id, { date: date.value, score: s, total: t, memo: memo.value.trim().slice(0, 40), wrong: keys,
        owner: it.data.owner, title: lessonTitle(it), kind: it.kind, trophy: trophy });
      closeDlg();
      if (got) {
        state.academyNotice = it.id;
        renderLessons();
        WT.fun.sound("done");
        setTimeout(function () { WT.fun.sound("sticker"); }, 450);
        WT.fun.confetti("big");
      }
    }
  }

  // 단원 화면 위의 「학원 점수 기록」: 아이마다 날짜·단원·점수·메모 표와 단어/chunk 평균
  function renderAcademy() {
    var box = $("academyBox");
    clear(box);
    var all = WT.store.academyAll();
    var lessons = WT.store.list();
    var mc = multiChild();
    var conn = WT.store.getConnection();
    var rows = Object.keys(all).map(function (id) {
      var r = all[id];
      if (!r || typeof r.score !== "number") return null;
      var it = lessons.filter(function (x) { return x.id === id; })[0];
      return Object.assign({ id: id, title: it ? lessonTitle(it) : (r.title || id), owner: it ? it.data.owner : r.owner, kind: it ? it.kind : r.kind }, r);
    }).filter(Boolean);
    if (conn) rows = rows.filter(function (r) { return r.owner === WT.sync.CHILD_OWNER[mc ? mc.active : conn.child]; });
    if (!rows.length) {
      // 기록이 없어도 칸은 보여 주고 적는 방법을 알려 준다(숨기면 기능이 없는 줄 앎).
      if (!lessons.length) return;
      var who = conn ? ownerLabel(WT.sync.CHILD_OWNER[mc ? mc.active : conn.child]) + " " : "";
      box.appendChild(el("details", { "class": "card acboard", id: "academyEmpty" }, [
        el("summary", {}, [el("span", { "class": "stitle", text: "📊 " + who + "학원 점수" }), el("span", { "class": "srecent", text: "아직 기록한 점수가 없어요" })]),
        el("p", { "class": "hint", style: "margin-top:8px", text: "학원에서 시험을 보면 그 단원 줄의 「⋯」을 누르고 「📝 학원 점수」에서 날짜, 점수, 틀린 것, 메모를 적어요. 적은 점수는 여기에 표로 모이고 단어 시험·Chunk Quiz 평균도 보여요." })
      ]));
      return;
    }
    var owners = [];
    rows.forEach(function (r) { if (owners.indexOf(r.owner) < 0) owners.push(r.owner); });
    owners.sort().forEach(function (owner) {
      var mine = rows.filter(function (r) { return r.owner === owner; }).sort(function (a, b) { return (b.date + b.at).localeCompare(a.date + a.at); });
      var avg = function (kind) {
        var xs = mine.filter(function (r) { return r.kind === kind; });
        if (!xs.length) return null;
        var full = FULL[kind];
        var v = xs.reduce(function (n, r) { return n + r.score / r.total * full; }, 0) / xs.length;
        return (kind === "word" ? "단어 시험 평균 " : "Chunk Quiz 평균 ") + (Math.round(v * 10) / 10) + "/" + full + "점 (" + xs.length + "번)";
      };
      var avgs = [avg("word"), avg("chunk")].filter(Boolean);
      var table = el("table", { "class": "ct actable" }, [
        el("thead", {}, [el("tr", {}, [el("th", { text: "날짜" }), el("th", { text: "단원" }), el("th", { text: "점수" }), el("th", { text: "메모" })])]),
        el("tbody", {}, mine.map(function (r) {
          return el("tr", {}, [
            el("td", { text: fmtDay(r.date + "T00:00:00") }),
            el("td", { text: r.title }),
            el("td", { "class": "sc", text: scoreText(r) + (r.score === r.total ? " 🏆" : "") }),
            el("td", { text: (r.wrong && r.wrong.length ? "틀린 것 " + r.wrong.length + "개" : "") + (r.memo ? (r.wrong && r.wrong.length ? " · " : "") + r.memo : "") })
          ]);
        }))
      ]);
      box.appendChild(el("details", { "class": "card acboard", "data-owner": owner }, [
        el("summary", {}, [el("span", { "class": "stitle", text: "📊 " + ownerLabel(owner) + " 학원 점수 " + mine.length + "개" }), el("span", { "class": "srecent empty", text: avgs.join(" · ") })]),
        table
      ]));
    });
  }

  // 단원 카드에 최근 화면 시험 점수(최대 3개)를 보여 준다.
  function recentLine(it) {
    var rs = WT.store.resultsFor(it.id).slice(0, 3);
    if (!rs.length) return null;
    return el("div", { "class": "recent", text: "최근 점수: " + rs.map(function (r) { return r.score + "/" + r.total + "(" + fmtDay(r.at) + (r.weakOnly ? " 재시험" : "") + ")"; }).join(", ") });
  }

  function summarize(res) {
    var parts = [];
    if (res.added.length) parts.push("새로 넣음: " + res.added.length + "개");
    if (res.updated.length) parts.push("덮어씀: " + res.updated.length + "개");
    if (res.settingsRestored) parts.push("설정도 가져옴");
    if (res.weakRestored) parts.push("틀린 단어 표시 " + res.weakRestored + "개도 가져옴");
    if (res.resultsRestored) parts.push("시험 기록 " + res.resultsRestored + "개도 가져옴");
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
      var total = { added: [], updated: [], errors: [], settingsRestored: false, weakRestored: 0 };
      list.forEach(function (j) {
        var r = WT.store.importText(j.text, j.label);
        total.added = total.added.concat(r.added);
        total.updated = total.updated.concat(r.updated);
        total.errors = total.errors.concat(r.errors);
        total.weakRestored += r.weakRestored || 0;
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
    WT.fun.apply(); // 지금 보는 아이의 꾸미기
    renderThemeCard();
    renderChildBar();
    renderChildActions();
    $("syncBox").hidden = !conn;
    $("btnDisconnect").hidden = !conn;
    $("importBox").open = !conn && !WT.store.list().length; // 처음 쓰는 기기에서만 펼쳐 둔다
    if (!conn) {
      $("connState").textContent = "연결되어 있지 않아요. 부모님께 받은 연결 링크를 이 기기에서 열면 단원이 자동으로 들어와요.";
      return;
    }
    var line;
    if (conn.kids.length > 1) {
      var counts = conn.kids.map(function (k) { var s2 = WT.store.syncedState(k); return childLabel(k) + " " + (s2 ? s2.lessons.length : 0) + "개"; });
      line = "두 아이 함께 연결됨 · 단원 " + counts.join(", ") + " · 마지막 확인 " + fmtTime(conn.lastSync);
    } else {
      var s = WT.store.syncedState(conn.child);
      line = WT.sync.CHILD_OWNER[conn.child] + "(" + (WT.store.settings()["name" + conn.child] || "이름 미설정") + ") 용으로 연결됨 · 단원 " + (s ? s.lessons.length : 0) + "개 · 마지막 확인 " + fmtTime(conn.lastSync);
    }
    $("syncStatus").textContent = line;
    $("connState").textContent = line + (conn.expires ? " · 열쇠 만료 " + conn.expires.slice(0, 10) : "");
    var ex = expiryNote(conn);
    var slot = $("syncExpiry");
    if (slot) msg(slot, ex.kind, ex.text);
  }

  // 두 아이를 함께 연결한 기기의 맨 위 「지금 보는 아이」 전환 칸
  function renderChildBar() {
    var mc = multiChild();
    $("childBar").hidden = !mc;
    if (!mc) return;
    ["A", "B"].forEach(function (code) {
      var b = $("btnActive" + code);
      var on = mc.active === code;
      b.textContent = (on ? "✓ " : "") + childLabel(code);
      b.className = on ? "primary" : "";
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    var s = WT.store.settings();
    $("childBarHint").textContent = (!s.nameA || !s.nameB) ? "설정에서 아이 이름을 적어 두면 버튼에 이름이 같이 나와요." : "";
  }

  // 만든 시험지와 고른 단원을 비운다(지금 보는 아이가 바뀌거나 아이를 뺄 때 다른 아이 시험지가 남지 않게).
  function resetMaker() {
    state.lessonId = null;
    state.last = null;
    $("btnSolve").disabled = true;
    $("makePanel").hidden = true;
    $("makeEmpty").hidden = false;
    $("sheet").srcdoc = "";
  }

  function switchActive(code) {
    var mc = multiChild();
    if (!mc || mc.active === code) return;
    if (!window.confirm("지금 보는 아이를 " + childLabel(code) + "(으)로 바꿀까요?")) return;
    WT.store.setActive(code);
    resetMaker();
    renderSync();
    renderLessons();
    showTab("lessons");
  }

  // 설정 화면: 다른 아이를 더하거나(링크 없이 저장된 열쇠로 받음) 한 아이만 쓰도록 되돌린다.
  function renderChildActions() {
    var box = $("childActions");
    clear(box);
    var conn = WT.store.getConnection();
    if (!conn) return;
    if (conn.kids.length === 1) {
      var other = conn.kids[0] === "A" ? "B" : "A";
      box.appendChild(el("button", { type: "button", text: childLabel(other) + "도 이 기기에서 쓰기", onclick: function () { addChild(other); } }));
    } else {
      conn.kids.forEach(function (k) {
        var gone = k === "A" ? "B" : "A";
        box.appendChild(el("button", { type: "button", text: childLabel(k) + "만 쓰기", onclick: function () {
          if (!window.confirm(childLabel(gone) + " 단원이 이 기기에서 지워져요. " + childLabel(k) + "만 쓰는 기기로 바꿀까요?")) return;
          WT.sync.removeChild(gone);
          resetMaker();
          msg($("childMsg"), "ok", childLabel(gone) + " 단원을 이 기기에서 지웠어요.");
          renderSync();
          renderLessons();
        } }));
      });
    }
  }

  function addChild(code) {
    msg($("childMsg"), "ok", childLabel(code) + " 단원을 받는 중이에요…");
    WT.sync.addChild(code).then(function (r) {
      if (r.status === "updated") {
        msg($("childMsg"), "ok", r.message + "\n단원 화면 위에서 지금 보는 아이를 바꿀 수 있어요.");
      } else {
        msg($("childMsg"), r.status === "unchanged" ? "ok" : "err", [r.message].concat(r.errors || []).join("\n"));
      }
      renderSync();
      renderLessons();
    });
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
  var pickBase = null; // 아이를 고르는 링크로 들어온 경우, 고르기 전의 연결 정보(뒤로 갈 때 쓴다)

  // 새로 연결하면 이 기기에서 지워지는 아이(지금 연결된 아이 중 이번에 고르지 않은 아이)를 알리는 경고
  function oldChildWarning(kids) {
    var old = WT.store.getConnection();
    if (!old) return "";
    var lost = old.kids.filter(function (k) { return kids.indexOf(k) < 0; });
    if (!lost.length) return "";
    var names = lost.map(function (k) { return WT.sync.CHILD_OWNER[k]; }).join(", ");
    return "\n\n⚠ 이 기기에는 지금 " + names + " 단원이 있어요. 연결하면 " + names + " 단원은 이 기기에서 지워져요.";
  }

  // 링크에 아이가 정해져 있지 않으면 이 기기를 누가 쓸지 고르게 한다. 한 아이 전용이나 두 아이 함께 쓰기를 고를 수 있다.
  function showPick(parsed) {
    pickBase = parsed;
    pendingConnect = null;
    var p = $("connectText");
    p.textContent = "이 기기를 누가 쓸지 골라 주세요. 고르면 부모님이 올린 단원이 자동으로 들어와요.\n· 한 아이만 쓰는 기기면 그 아이를 골라요.\n· 한 기기를 두 아이가 번갈아 쓰면 「두 아이 모두」를 골라요. 화면 위에서 지금 보는 아이를 바꿀 수 있어요.";
    p.style.whiteSpace = "pre-line";
    $("btnPickA").textContent = childLabel("A") + " 전용";
    $("btnPickB").textContent = childLabel("B") + " 전용";
    $("connectPick").hidden = false;
    $("btnConnectOk").hidden = true;
    $("btnConnectCancel").textContent = "취소";
    msg($("connectMsg"), "", "");
    $("connectBox").hidden = false;
    showTab("lessons");
  }

  function askConnect(parsed) {
    var kids = parsed.kids || (parsed.child ? [parsed.child] : null);
    if (!kids) { showPick(parsed); return; }
    pendingConnect = parsed;
    var text = kids.length > 1
      ? "이 기기를 " + childLabel("A") + "와(과) " + childLabel("B") + " 두 아이가 같이 쓰도록 연결할까요? 두 아이 단원이 모두 들어오고, 화면 위에서 지금 보는 아이를 바꿀 수 있어요."
      : "이 기기를 " + childLabel(kids[0]) + " 용으로 연결할까요? 연결하면 부모님이 올린 " + WT.sync.CHILD_OWNER[kids[0]] + " 단원이 자동으로 들어와요.";
    text += oldChildWarning(kids);
    var p = $("connectText");
    p.textContent = text;
    p.style.whiteSpace = "pre-line";
    msg($("connectMsg"), "", "");
    $("connectPick").hidden = true;
    $("btnConnectOk").hidden = false;
    $("btnConnectCancel").textContent = pickBase ? "뒤로" : "취소";
    $("connectBox").hidden = false;
    showTab("lessons");
  }

  function pickChild(code) {
    if (!pickBase) return;
    if (code === "AB") askConnect(Object.assign({}, pickBase, { child: null, kids: ["A", "B"] }));
    else askConnect(Object.assign({}, pickBase, { child: code, kids: null }));
  }

  function cancelConnect() {
    if (pickBase && pendingConnect) { showPick(pickBase); return; } // 확인 단계에서는 아이 고르기로 돌아간다
    closeConnect();
  }

  function closeConnect() {
    pendingConnect = null;
    pickBase = null;
    $("connectPick").hidden = true;
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
        resetMaker();
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
      pickBase = null;
      $("connectPick").hidden = true;
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
  // 확인 표의 「고칠 곳 적기」: 칸을 누르면 바른 내용을 적어 둔다. 앱의 단원은 바꾸지 않고, 목록을 복사해 원본을 고치는 데 쓴다.
  var checkFixMode = false;

  function copyText(text, out, container) {
    function fallback() {
      var ta = el("textarea", { "class": "fixtext", rows: "6", readonly: "readonly" });
      ta.value = text;
      if (container) { container.appendChild(ta); ta.focus(); ta.select(); }
      msg(out, "warn", "자동으로 복사하지 못했어요. " + (container ? "아래 칸의 글을 길게 눌러 모두 선택한 뒤 복사해 주세요." : "설정의 「고칠 곳 목록」 칸에서 복사해 주세요."));
    }
    try {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(function () { msg(out, "ok", "복사했어요. 대화창에 붙여 넣어 보내 주세요. 원본을 고쳐 다시 올리면 이 목록에서 저절로 빠져요."); }, fallback);
      } else fallback();
    } catch (e) { fallback(); }
  }

  function openCheck(id, keepScroll) {
    var it = find(id);
    if (!it) return;
    var scroll = $("dlg").scrollTop;
    var raw = it.data;
    var body = $("dlgBody");
    clear(body);
    var box = el("div");
    var label = lessonTitle(it);
    // 고칠 수 있는 칸. path 는 단원 데이터 안의 위치(예: ["words", 2, "ko"]).
    function fixNode(tag, path, where, opt) {
      opt = opt || {};
      var cur = WT.store.valueAt(raw, path);
      var curText = cur === undefined || cur === null ? "" : String(cur);
      var f = WT.store.fixAt(id, path);
      var n = el(tag, opt.cls ? { "class": opt.cls } : {});
      if (opt.prefix) n.appendChild(document.createTextNode(opt.prefix));
      if (f) {
        n.classList.add("fixed");
        n.appendChild(el("del", { text: WT.util.plain(curText) || "(비어 있음)" }));
        n.appendChild(el("span", { "class": "after", text: " → " + f.after }));
      } else {
        n.appendChild(document.createTextNode(WT.util.plain(curText) || opt.empty || ""));
      }
      if (checkFixMode) {
        n.classList.add("fixable");
        n.addEventListener("click", function () {
          var v = window.prompt(where + "\n지금: " + (curText || "(비어 있음)") + "\n\n바른 내용을 적어 주세요. 비우고 확인하면 적어 둔 것을 지워요.", f ? f.after : curText);
          if (v === null) return;
          WT.store.setFix({ id: id, label: label, owner: raw.owner, path: path, where: where, before: curText, after: v });
          openCheck(id, true);
          renderLessons();
          renderFixCard();
        });
      }
      return n;
    }
    box.appendChild(el("div", { "class": "row" }, [
      el("button", { type: "button", "class": checkFixMode ? "primary" : "", text: checkFixMode ? "고칠 곳 적기 끝내기" : "고칠 곳 적기", onclick: function () { checkFixMode = !checkFixMode; openCheck(id, true); } })
    ]));
    if (checkFixMode) {
      box.appendChild(el("p", { "class": "msg warn", text: "고칠 칸을 누르면 바른 내용을 적을 수 있어요. 앱의 단원은 바뀌지 않아요. 다 적으면 아래 「수정 목록 복사」로 부모님 작업실에 보내 주세요." + (it.kind === "chunk" ? "\nchunk 문장과 콜로케이션은 빈칸이 될 부분을 { } 로 감싸 주세요." : "") }));
    }
    if (it.kind === "word") {
      var t = WT.word.checkTable(WT.word.load(it.data));
      $("dlgTitle").textContent = "확인 표 · " + ownerLabel(t.owner) + " · " + t.title;
      box.appendChild(el("p", { "class": "hint", text: "문장 출처 규칙: " + sourcesText(t.sources) + " · 해석 필수: " + (t.requireKo ? "예" : "아니오") + " · 교재 대조: " + (t.verified ? "완료" : "아직 안 됨") }));
      var tbl = el("table", { "class": "ct" }, [el("tr", {}, ["#", "단어", "품사", "한글 뜻", "쪽", "영문 뜻 · 연습 페이지 문장"].map(function (h) { return el("th", { text: h }); }))]);
      raw.words.forEach(function (w, i) {
        var nm = "단어 " + w.word;
        var last = el("td", {}, [fixNode("div", ["words", i, "en"], nm + " · 영문 뜻")]);
        (w.sentences || []).forEach(function (x, j) {
          if (x.source !== "practice") return;
          last.appendChild(fixNode("div", ["words", i, "sentences", j, "text"], nm + " · 연습 " + (x.ref || "?") + "번 문장", { cls: "hint", prefix: "연습 " + (x.ref || "?") + "번: " }));
        });
        tbl.appendChild(el("tr", {}, [
          el("td", { text: String(w.no || "") }),
          fixNode("td", ["words", i, "word"], nm + " · 철자"),
          fixNode("td", ["words", i, "pos"], nm + " · 품사"),
          fixNode("td", ["words", i, "ko"], nm + " · 한글 뜻"),
          el("td", { text: String(w.page || "") }),
          last
        ]));
      });
      box.appendChild(tbl);
      box.appendChild(el("p", { "class": "hint", text: "연습 페이지에 문장이 없는 단어(쓰기 문항으로만 나옴): " + (t.noPractice.join(", ") || "없음") }));
      box.appendChild(el("p", { "class": "hint", text: "허용 출처 밖이라 쓰이지 않는 문장: " + t.outside + "개" + (t.requireKo ? " · 해석이 없는 문장: " + t.noKo + "개" : "") }));
    } else {
      var c = WT.chunk.checkTable(WT.chunk.load(it.data));
      $("dlgTitle").textContent = "확인 표 · " + ownerLabel(c.owner) + " · " + c.title;
      box.appendChild(el("p", { "class": "hint", text: "Fill in 힌트: " + (c.hint === "first" ? "첫 글자 있음" : "없음") + " · 교재 대조: " + (c.verified ? "완료" : "아직 안 됨") }));
      var vt = el("table", { "class": "ct" }, [el("tr", {}, ["단원", "단어", "콜로케이션", "한글 뜻"].map(function (h) { return el("th", { text: h }); }))]);
      (raw.vocab || []).forEach(function (v, i) {
        var nm = "Key Vocabulary " + v.word;
        vt.appendChild(el("tr", {}, [
          el("td", { text: "L" + v.lesson }),
          fixNode("td", ["vocab", i, "word"], nm + " · 단어"),
          fixNode("td", ["vocab", i, "colloc"], nm + " · 콜로케이션", { empty: "(콜로케이션 없음)" }),
          fixNode("td", ["vocab", i, "ko"], nm + " · 한글 뜻")
        ]));
      });
      box.appendChild(vt);
      var ct = el("table", { "class": "ct", style: "margin-top:12px" }, [el("tr", {}, ["단원", "chunk 문장 (빈칸이 될 부분은 { })"].map(function (h) { return el("th", { text: h }); }))]);
      (raw.chunks || []).forEach(function (x, i) {
        ct.appendChild(el("tr", {}, [el("td", { text: "L" + x.lesson }), fixNode("td", ["chunks", i, "sentence"], "chunk 문장 " + (i + 1) + "번(L" + x.lesson + ")")]));
      });
      box.appendChild(ct);
      box.appendChild(el("p", { "class": "hint", text: "콜로케이션이 없어 Key Vocabulary에서 빠지는 단어: " + (c.noColloc.join(", ") || "없음") }));
    }
    box.appendChild(el("p", { "class": "hint", text: "※ 영문 뜻, 한글 뜻, 문장을 교재와 한 글자씩 대조해 주세요. 틀린 곳은 「고칠 곳 적기」로 적어 두세요." }));
    // 이 단원에서 적은 고칠 곳과 복사
    var mine = WT.store.fixesFor(id).length, allN = WT.store.fixesAll().length;
    if (allN) {
      var out = el("div", { role: "status" });
      var fixBox = el("div", { "class": "card fixbox" }, [
        el("b", { text: "이 단원에서 적은 고칠 곳 " + mine + "개" + (allN !== mine ? " (전체 " + allN + "개)" : "") }),
        el("div", { "class": "row", style: "margin-top:8px" }, [
          el("button", { type: "button", "class": "primary", text: "수정 목록 복사", onclick: function () { copyText(WT.store.fixesText(), out, fixBox); } }),
          mine ? el("button", { type: "button", text: "이 단원 목록 지우기", onclick: function () {
            if (!window.confirm("이 단원에서 적은 고칠 곳 " + mine + "개를 지울까요?")) return;
            WT.store.clearFixes(id);
            openCheck(id, true);
            renderLessons();
            renderFixCard();
          } }) : null
        ]),
        out
      ]);
      box.appendChild(fixBox);
    }
    body.appendChild(box);
    $("dlg").hidden = false;
    if (keepScroll) $("dlg").scrollTop = scroll;
  }

  // 설정의 「고칠 곳 목록」 칸
  function renderFixCard() {
    var n = WT.store.fixesAll().length;
    $("fixCount").textContent = n ? "적어 둔 고칠 곳이 " + n + "개 있어요. 복사해서 부모님 작업실에 보내 주세요." : "적어 둔 고칠 곳이 없어요. 단원의 「확인 표」에서 「고칠 곳 적기」를 눌러 적을 수 있어요.";
    $("fixText").value = WT.store.fixesText();
    $("fixText").hidden = !n;
    $("btnFixCopy").disabled = !n;
    $("btnFixClear").disabled = !n;
  }

  // ---------------------------------------------------------------- 틀린 단어 표시(약한 단어)
  var weakDlgId = null;

  function lessonTitle(it) {
    var d = it.data;
    return it.kind === "word" ? "단어 Lesson " + d.lesson + (d.title ? " " + d.title : "") : (d.title || "Chunk Quiz");
  }

  // 시험지 만들기 화면의 「약한 항목만」 칸을 지금 표시된 개수에 맞춘다.
  function updateWeakControls() {
    var it = find(state.lessonId);
    if (!it) return;
    var n = WT.store.weakCount(it);
    var isWord = it.kind === "word";
    var box = isWord ? $("wWeak") : $("cWeak");
    var text = isWord ? $("wWeakText") : $("cWeakText");
    box.disabled = n === 0;
    if (n === 0) box.checked = false;
    text.textContent = (isWord ? "🔁 약한 단어만" : "🔁 약한 항목만") + (n ? " · " + n + "개" : " · 표시한 것이 없어요");
  }

  // 틀린 단어를 고르는 화면. 누를 때마다 이 기기에 바로 저장한다.
  function openWeak(id) {
    var it = find(id);
    if (!it) return;
    weakDlgId = id;
    var body = $("dlgBody");
    clear(body);
    $("dlgTitle").textContent = "틀린 단어 표시 · " + ownerLabel(it.data.owner) + " · " + lessonTitle(it);
    body.appendChild(el("p", { "class": "hint", text: "시험에서 틀린 것을 눌러 표시해요. 표시한 것은 이 기기에 저장되고, 시험지 만들기에서 「약한 항목만」을 고르면 그것만으로 재시험지가 나와요. 다시 맞히게 되면 눌러서 표시를 지워요." }));
    var counter = el("p", { "class": "msg warn" });
    var clearBtn = el("button", { type: "button", text: "표시 모두 지우기", onclick: function () {
      if (!window.confirm("이 단원에서 표시한 틀린 항목을 모두 지울까요?")) return;
      WT.store.clearWeak(id);
      openWeak(id);
    } });
    body.appendChild(el("div", { "class": "row" }, [clearBtn]));
    body.appendChild(counter);
    function refresh() {
      var n = WT.store.weakCount(find(id));
      counter.textContent = n ? "틀린 항목 " + n + "개를 표시했어요." : "표시한 것이 없어요.";
      counter.hidden = false;
    }
    var group = null, list = null;
    var items = WT.store.weakItems(it.data);
    var groups = {};
    items.forEach(function (x) { groups[x.group] = true; });
    items.forEach(function (x) {
      if (x.group !== group) {
        group = x.group;
        if (Object.keys(groups).length > 1) body.appendChild(el("div", { "class": "weakgroup", text: group }));
        list = el("div", { "class": "weaklist" });
        body.appendChild(list);
      }
      var cb = el("input", { type: "checkbox" });
      cb.checked = x.base || WT.store.isWeak(id, x.key);
      cb.disabled = x.base && !WT.store.isWeak(id, x.key);
      var lab = el("label", { "class": cb.checked ? "on" : "" }, [
        cb,
        el("span", { "class": "t" }, [
          el("span", { "class": "w", text: x.label }),
          el("span", { "class": "s", text: x.sub + (cb.disabled ? " (단원 데이터에서 이미 표시됨)" : "") })
        ])
      ]);
      cb.addEventListener("change", function () {
        WT.store.setWeak(id, x.key, cb.checked);
        lab.classList.toggle("on", cb.checked || x.base);
        refresh();
      });
      list.appendChild(lab);
    });
    refresh();
    $("dlg").hidden = false;
  }

  var dlgRefresh = null; // 학원 점수 창을 닫으면 단원 목록을 다시 그린다
  function closeDlg() {
    $("dlg").hidden = true;
    if (dlgRefresh) {
      var rid = dlgRefresh;
      dlgRefresh = null;
      renderLessons();
      if (state.lessonId === rid) updateWeakControls();
    }
    if (!weakDlgId) return;
    var id = weakDlgId;
    weakDlgId = null;
    renderLessons();
    if (state.lessonId === id) { updateWeakControls(); generate(); } // 표시가 바뀌었으니 열려 있는 시험지도 다시 만든다
  }

  // ---------------------------------------------------------------- 시험지 만들기
  function openMaker(id) {
    var it = find(id);
    if (!it) return;
    state.lessonId = id;
    var d = it.data;
    $("makeEmpty").hidden = true;
    $("makePanel").hidden = false;
    $("makeTitle").textContent = (it.virtual ? "📚 " : KIND[it.kind].icon + " ") + (it.kind === "word" ? "Lesson " + d.lesson + (d.title ? " " + d.title : "") : (d.title || "Chunk Quiz")) + " · " + ownerLabel(d.owner) + (it.virtual ? " · " + it.count + "개" : "");
    $("optsWord").hidden = it.kind !== "word";
    $("optsChunk").hidden = it.kind !== "chunk";
    $("cHintBox").hidden = it.kind !== "chunk";
    // 누적 시험지는 전체 쓰기·범위 전체로만 내고, 약한 것만·틀린 단어 표시는 원래 단원에서 한다.
    var v = !!it.virtual;
    Array.prototype.forEach.call(document.querySelectorAll(".seg[data-for=wMode], .seg[data-for=cMode]"), function (g) { g.hidden = v; });
    $("wWeak").closest(".chipcheck").hidden = v;
    $("cWeak").closest(".chipcheck").hidden = v;
    $("btnWeakEdit").hidden = v;
    if (!v && state.virtual) state.virtual = null; // 보통 단원을 열면 합친 단원은 버린다
    $("optSeed").value = "";
    $("optClass").value = d.class_code || "";
    $("makeInfo").hidden = true;
    $("sheet").srcdoc = "";
    $("wWeak").checked = false;
    $("cWeak").checked = false;
    updateWeakControls();
    if (it.kind === "word") {
      // 단어는 「전체 쓰기」(모든 단어를 직접 쓰기)가 기본(2026-11-18 사용자 요청). 학원 시험 모양은 버튼으로 고름
      $("wMode").value = "all-write";
      $("wPartsBox").hidden = false;
    } else {
      $("cMode").value = "full"; // chunk 는 「범위 전체」가 기본(2026-11-18 사용자 요청). 학원 시험 모양은 버튼으로 고름
      var sel = $("cHint");
      clear(sel);
      sel.appendChild(el("option", { value: "", text: "이 데이터의 기준 (" + (d.hint === "first" ? "첫 글자 있음" : "없음") + ")" }));
      sel.appendChild(el("option", { value: "none", text: "첫 글자 힌트 없음" }));
      sel.appendChild(el("option", { value: "first", text: "첫 글자 힌트 있음" }));
      sel.value = "";
    }
    syncSegs();
    showTab("make");
    generate();
  }

  // 종류 고르기 버튼(.seg)을 숨긴 선택 상자 값에 맞춰 켠다.
  function syncSegs() {
    Array.prototype.forEach.call(document.querySelectorAll(".seg[data-for]"), function (g) {
      var v = $(g.getAttribute("data-for")).value;
      Array.prototype.forEach.call(g.querySelectorAll("button"), function (b) {
        var on = b.getAttribute("data-v") === v;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    });
  }

  function infoLine(data, kind, seed, warnings) {
    var box = $("makeInfo");
    clear(box);
    var rule = kind === "word"
      ? "문장 규칙: " + sourcesText(data.sentence_sources) + (data.require_sentence_ko ? " (정답지에 해석 포함)" : "")
      : "Fill in 힌트: " + (data.hint === "first" ? "첫 글자 있음" : "없음");
    // 아이에게는 시험지 번호만 보이고, 대상·문장 규칙·교재 대조 경고는 「⋯ 부모님용」 안에 접어 둔다.
    // 만들 때 알림(뺀 단어, 다른 힌트, 범위 전체 방식 등)도 부모님용이라 같이 접고, 요약 줄에 개수만 보인다.
    var ws = warnings || [];
    box.appendChild(el("div", { "class": "mkline" }, [
      el("span", { "class": "seedno", text: "시험지 번호 " + seed }),
      el("details", { "class": "parentbox inline" }, [
        el("summary", { text: "⋯ 부모님용" + (data.verified ? "" : " · 교재 대조 전") + (ws.length ? " · 알림 " + ws.length + "개" : "") }),
        el("div", { "class": "hint", style: "margin:4px 0 0", text: "대상 " + ownerLabel(data.owner) + " · " + (kind === "word" ? "단원 Lesson " + data.lesson : (data.title || "")) + " · " + rule }),
        data.verified ? null : el("div", { "class": "msg err", text: "⚠ 교재와 대조하기 전 데이터예요. 아이에게 주기 전에 부모님이 확인해 주세요." })
      ].concat(ws.map(function (w) { return el("div", { "class": "msg warn", text: w }); })))
    ]));
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
    var last = null; // 화면에서 풀 때 쓸 출제 결과(종이 시험지와 같은 문항)
    state.last = null;
    $("btnSolve").disabled = true;
    try {
      if (it.kind === "word") {
        var data = WT.word.load(WT.store.withWeak(it));
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
          last = { quiz: function () { return WT.quiz.fromWord(data, s, { parts: parts }); }, mode: "all-write", parts: $("wParts").value };
        } else {
          var s2 = WT.word.makeRegular(data, WT.word.defaultMcq(data), src, seed);
          errs = WT.word.validateRegular(data, s2);
          warnings = s2.warnings.slice();
          sentences = s2.mcq.map(function (p) { return p[1]; });
          html = WT.word.buildRegular(data, s2, common);
          last = { quiz: function () { return WT.quiz.fromWord(data, s2, {}); }, mode: "regular", parts: "" };
        }
        var miss = WT.word.missingKo(data, sentences);
        if (miss.length) warnings.push("정답지에 해석이 없는 문장이 " + miss.length + "개 있어요: " + miss.slice(0, 3).join(" / "));
        if (!errs.length) infoLine(data, "word", seed, warnings);
      } else {
        var cd = WT.chunk.load(WT.store.withWeak(it));
        var mode = $("cMode").value;
        if ($("cWeak").checked) {
          cd = WT.chunk.onlyWeak(cd);
          mode = "full";
          warnings.push("약한 항목만 낼 때는 표시한 것을 전부 내는 「범위 전체」 방식으로 만들어요.");
        }
        var hint = $("cHint").value || cd.hint;
        var cs = WT.chunk.makeSet(cd, mode, 6, 3, 2, 1, seed);
        errs = WT.chunk.validate(cd, cs);
        if (cs.skipped.length) warnings.push("콜로케이션이 없어 뺀 단어: " + cs.skipped.join(", "));
        if (hint !== cd.hint) warnings.push("데이터 기준(" + (cd.hint === "first" ? "첫 글자 있음" : "없음") + ")과 다른 힌트로 만들었어요.");
        html = WT.chunk.build(cd, cs, Object.assign({ hint: hint }, common));
        last = { quiz: function () { return WT.quiz.fromChunk(cd, cs, { hint: hint }); }, mode: mode, parts: hint };
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
    if (last) {
      var weakOnly = it.kind === "word" ? $("wWeak").checked : $("cWeak").checked;
      state.last = Object.assign(last, { lessonId: it.id, kind: it.kind, seed: seed, weakOnly: weakOnly });
      $("btnSolve").disabled = false;
    }
  }

  // ---------------------------------------------------------------- 태블릿에서 풀기
  function openSolve() {
    var L = state.last;
    if (!L) return;
    var it = find(L.lessonId);
    if (!it) return;
    var quiz;
    try { quiz = L.quiz(); }
    catch (e) { window.alert("풀 문항을 만들지 못했어요: " + e.message); return; }
    var key = [L.lessonId, L.kind, L.mode, L.seed, L.parts, L.weakOnly ? "weak" : ""].join("|");
    WT.solve.open(quiz, {
      draftKey: key,
      who: ownerLabel(it.data.owner),
      owner: it.data.owner,
      onGraded: function (g, q) {
        // 틀린 것은 약한 목록에 넣고, 약한 항목을 연속으로 맞히면 빼고, 점수를 기록한다.
        var summary;
        if (it.virtual) {
          // 누적 시험지: 항목마다 원래 단원을 찾아 그 단원의 약한 목록에 반영한다.
          var bySrc = {};
          Object.keys(g.byKey).forEach(function (k) {
            var src = it.keyMap[k];
            if (!src) return;
            (bySrc[src] = bySrc[src] || {})[k] = g.byKey[k];
          });
          summary = { added: [], again: [], cleared: [], progress: [] };
          Object.keys(bySrc).forEach(function (src) {
            var r = WT.store.applyGrading(src, bySrc[src]);
            ["added", "again", "cleared", "progress"].forEach(function (f) { summary[f] = summary[f].concat(r[f]); });
          });
        } else summary = WT.store.applyGrading(L.lessonId, g.byKey);
        WT.store.addResult({
          at: new Date().toISOString(), lessonId: L.lessonId, owner: it.data.owner, title: q.title, kind: q.kind, mode: q.mode,
          seed: q.seed, weakOnly: !!L.weakOnly, score: g.score, total: g.total,
          wrong: g.items.filter(function (r) { return !r.correct; }).map(function (r) { return q.items[r.id].word; })
        });
        return summary;
      },
      onClose: function () { renderLessons(); updateWeakControls(); }
    });
  }

  function fmtDay(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? "" : (d.getMonth() + 1) + "/" + d.getDate();
  }

  // 설정의 키보드 확인: american 을 소문자로 쓰게 해서 키보드가 바꾸는지 본다.
  function checkKeyboard() {
    var v = $("kbdTest").value;
    var out = $("kbdMsg");
    if (!v) { msg(out, "", ""); return; }
    if (v === "american") msg(out, "ok", "정상이에요. 키보드가 글자를 바꾸지 않았어요.");
    else if (v.toLowerCase() === "american") msg(out, "err", "첫 글자가 대문자로 바뀌었어요. 이대로면 소문자 정답도 틀린 것으로 채점돼요. 삼성 키보드 설정에서 「자동 대문자」를 꺼 주세요.");
    else if (v.length >= 8) msg(out, "warn", "american 과 다르게 입력됐어요(" + v + "). 자동 수정이나 예측 텍스트가 바꿨을 수 있어요. 키보드 설정에서 꺼 주세요.");
    else msg(out, "", "");
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
    $("appKbd").checked = WT.kbd.enabled();
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
    $("btnConnectCancel").addEventListener("click", cancelConnect);
    $("btnPickA").addEventListener("click", function () { pickChild("A"); });
    $("btnPickB").addEventListener("click", function () { pickChild("B"); });
    $("btnPickAB").addEventListener("click", function () { pickChild("AB"); });
    $("btnActiveA").addEventListener("click", function () { switchActive("A"); });
    $("btnActiveB").addEventListener("click", function () { switchActive("B"); });
    $("btnDisconnect").addEventListener("click", function () {
      if (!window.confirm("연결을 끊을까요? 부모님이 올려 준 단원이 이 기기에서 지워지고, 다시 받으려면 새 연결 링크가 필요해요.")) return;
      WT.sync.disconnect();
      resetMaker();
      msg($("syncMsg"), "", "");
      msg($("childMsg"), "", "");
      renderSync();
      renderLessons();
    });
    document.addEventListener("visibilitychange", function () { if (!document.hidden) runSync(false); });
    window.addEventListener("online", function () { runSync(false); });
    $("btnMake").addEventListener("click", function () { $("optSeed").value = ""; generate(); });
    // 종류 고르기 버튼: 숨긴 선택 상자 값을 바꾸고 change 를 보내 기존 흐름(시험지 다시 만들기)을 탄다.
    Array.prototype.forEach.call(document.querySelectorAll(".seg[data-for] button"), function (b) {
      b.addEventListener("click", function () {
        var sel = $(b.parentNode.getAttribute("data-for"));
        if (sel.value === b.getAttribute("data-v")) return;
        sel.value = b.getAttribute("data-v");
        sel.dispatchEvent(new Event("change"));
      });
    });
    $("btnPrint").addEventListener("click", printSheet);
    $("btnSolve").addEventListener("click", openSolve);
    WT.solve.bind();
    WT.study.bind();
    $("kbdTest").addEventListener("input", checkKeyboard);
    $("soundOn").addEventListener("change", function () { WT.fun.setSound($("soundOn").checked); WT.fun.sound("ok"); });
    WT.kbd.bind();
    $("appKbd").addEventListener("change", function () { WT.kbd.setEnabled($("appKbd").checked); });
    $("btnVoiceTest").addEventListener("click", function () {
      var ok = WT.speech.say("Hello! Let's practice spelling.", false);
      var st = WT.speech.status();
      msg($("voiceMsg"), ok && st.code === "ok" ? "ok" : "warn", WT.speech.statusText(st) + (ok ? "\n소리가 들리면 듣고 쓰기를 쓸 수 있어요." : ""));
    });
    $("btnFixCopy").addEventListener("click", function () { copyText(WT.store.fixesText(), $("fixMsg"), null); $("fixText").hidden = false; });
    $("btnFixClear").addEventListener("click", function () {
      var n = WT.store.fixesAll().length;
      if (!n || !window.confirm("적어 둔 고칠 곳 " + n + "개를 모두 지울까요? 부모님께 보냈는지 먼저 확인해 주세요.")) return;
      WT.store.clearFixes();
      msg($("fixMsg"), "ok", "지웠어요.");
      renderLessons();
      renderFixCard();
    });
    // 번호를 입력하면 그 번호의 시험지를 다시 만든다
    $("optSeed").addEventListener("change", generate);
    ["wMode", "wParts", "wWeak", "cMode", "cHint", "cWeak", "optKey"].forEach(function (id) {
      $(id).addEventListener("change", function () {
        if (id === "wMode") $("wPartsBox").hidden = $("wMode").value !== "all-write";
        syncSegs();
        $("optSeed").value = "";
        generate();
      });
    });
    $("dlgClose").addEventListener("click", closeDlg);
    $("dlg").addEventListener("click", function (e) { if (e.target === $("dlg")) closeDlg(); });
    $("btnWeakEdit").addEventListener("click", function () { if (state.lessonId) openWeak(state.lessonId); });
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
        renderSync(); // 백업의 꾸미기(테마)도 반영
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
    renderFixCard();
    // 연결 링크로 열었으면 확인 화면을 먼저 보여 주고, 이미 연결된 기기는 새 단원이 있는지 저절로 확인한다.
    if (!handleConnectLink()) runSync(false);
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
