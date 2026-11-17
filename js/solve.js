/* 태블릿에서 직접 푸는 화면(3단계). 문항 만들기와 채점은 quiz.js 가 하고, 여기서는 화면만 다룬다.
 * - 입력칸은 자동 대문자, 자동 수정, 맞춤법 검사를 끈다(켜져 있으면 정답도 0점이 되기 때문).
 * - 푸는 중인 답은 이 기기에 바로 저장해서, 화면이 꺼지거나 새로 고쳐져도 이어서 풀 수 있다.
 * - 채점 결과는 ctx.onGraded 로 넘기고, 돌려받은 요약(약한 목록에 넣은 것·뺀 것)을 보여 준다.
 */
(function (root) {
  "use strict";
  var WT = (root.WT = root.WT || {});
  var KEY_DRAFT = "wp.draft.v1";
  var doc = root.document;

  function $(id) { return doc.getElementById(id); }
  function el(tag, attrs, kids) {
    var n = doc.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "class") n.className = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else if (k.indexOf("on") === 0) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? doc.createTextNode(c) : c); });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  function readDraft() { try { var d = JSON.parse(root.localStorage.getItem(KEY_DRAFT)); return d && typeof d === "object" ? d : null; } catch (e) { return null; } }
  function writeDraft(d) { try { root.localStorage.setItem(KEY_DRAFT, JSON.stringify(d)); } catch (e) {} }
  function dropDraft() { try { root.localStorage.removeItem(KEY_DRAFT); } catch (e) {} }

  var cur = null; // { quiz, ctx, answers, graded, inputs, practice }

  function input(cls, size) {
    return el("input", {
      type: "text", "class": "ans " + (cls || ""), size: String(size || 14), lang: "en",
      autocapitalize: "off", autocomplete: "off", autocorrect: "off", spellcheck: "false", enterkeyhint: "next",
      "data-lpignore": "true"
    });
  }
  // 문장의 ___ 자리를 보여 주는 조각. fillNode 가 있으면 그 자리에 넣는다.
  function sentenceNodes(text, fillNode) {
    var parts = String(text).split("___");
    var out = [];
    parts.forEach(function (p, i) {
      out.push(doc.createTextNode(p));
      if (i < parts.length - 1) out.push(fillNode || el("span", { "class": "gap", text: "______" }));
    });
    return out;
  }

  function save() {
    if (!cur || cur.graded || cur.practice) return;
    writeDraft({ key: cur.ctx.draftKey, answers: cur.answers, at: new Date().toISOString() });
  }

  function blanksLeft() {
    var n = 0;
    cur.quiz.items.forEach(function (it, i) {
      var a = cur.answers[i];
      if (it.type === "mcq") { if (typeof a !== "number") n++; }
      else if (it.type === "colloc") { if (!Array.isArray(a) || a.some(function (x) { return !String(x || "").trim(); }) || a.length < it.answers.length) n++; }
      else if (!String(a || "").trim()) n++;
    });
    return n;
  }

  // Enter 를 누르면 다음 입력칸으로 간다.
  function wireEnter() {
    var all = Array.prototype.slice.call($("solveBody").querySelectorAll("input.ans"));
    all.forEach(function (inp, i) {
      inp.addEventListener("keydown", function (e) {
        if (e.key !== "Enter") return;
        e.preventDefault();
        if (all[i + 1]) all[i + 1].focus(); else inp.blur();
      });
    });
  }

  function renderMcq(it, i, box) {
    box.querySelectorAll("button.opt").forEach(function (b) {
      var k = Number(b.getAttribute("data-k"));
      var mine = cur.answers[i] === k;
      var elsewhere = cur.answers.some(function (a, j) { return j !== i && cur.quiz.items[j].type === "mcq" && a === k; });
      b.className = "opt" + (mine ? " on" : "") + (elsewhere ? " used" : "");
    });
    var gap = box.querySelector(".gap");
    if (gap) gap.textContent = typeof cur.answers[i] === "number" ? " " + WT.quiz.CIRCLED.charAt(cur.answers[i]) + " " + it.options[cur.answers[i]] + " " : "______";
  }

  function renderItems() {
    var body = $("solveBody");
    clear(body);
    var q = cur.quiz;
    var group = null;
    var mcqBoxes = [];
    q.items.forEach(function (it, i) {
      if (it.group !== group) {
        group = it.group;
        body.appendChild(el("h3", { "class": "sgroup", text: group }));
        if (it.bank && it.type !== "mcq") {
          body.appendChild(el("div", { "class": "sbank" }, it.bank.map(function (b) { return el("span", { text: b }); })));
        }
      }
      var card = el("div", { "class": "qcard", "data-i": String(i) });
      var head = el("div", { "class": "qhead" }, [el("span", { "class": "qno", text: it.no + "." }), el("span", { "class": "qpts", text: it.pts + "점" })]);
      card.appendChild(head);
      var line = el("div", { "class": "qline" });
      if (it.type === "write") {
        if (it.sentence) sentenceNodes(it.sentence).forEach(function (n) { line.appendChild(n); });
        else line.appendChild(el("span", { text: it.prompt }));
        card.appendChild(line);
        var inp = input("", 18);
        inp.value = cur.answers[i] || "";
        inp.addEventListener("input", function () { cur.answers[i] = inp.value; save(); });
        card.appendChild(el("div", { "class": "qans" }, [inp]));
      } else if (it.type === "mcq") {
        sentenceNodes(it.sentence).forEach(function (n) { line.appendChild(n); });
        card.appendChild(line);
        var opts = el("div", { "class": "opts" });
        it.options.forEach(function (w, k) {
          opts.appendChild(el("button", { type: "button", "class": "opt", "data-k": String(k), text: WT.quiz.CIRCLED.charAt(k) + " " + w, onclick: function () {
            if (cur.graded) return;
            // 보기는 한 번씩만 쓴다: 다른 문항에서 고른 같은 보기는 풀린다.
            cur.answers.forEach(function (a, j) { if (j !== i && cur.quiz.items[j].type === "mcq" && a === k) cur.answers[j] = null; });
            cur.answers[i] = cur.answers[i] === k ? null : k;
            mcqBoxes.forEach(function (m) { renderMcq(m.it, m.i, m.box); });
            save();
          } }));
        });
        card.appendChild(opts);
        mcqBoxes.push({ it: it, i: i, box: card });
      } else if (it.type === "colloc") {
        if (!Array.isArray(cur.answers[i])) cur.answers[i] = it.answers.map(function () { return ""; });
        it.segments.forEach(function (sg) {
          if (sg.text !== undefined) { line.appendChild(el("span", { text: sg.text })); return; }
          var inp2 = input("inline", 10);
          inp2.value = cur.answers[i][sg.blank] || "";
          inp2.addEventListener("input", function () { cur.answers[i][sg.blank] = inp2.value; save(); });
          line.appendChild(inp2);
        });
        card.appendChild(line);
        if (it.ko) card.appendChild(el("div", { "class": "qko", text: it.ko }));
      } else {
        // chunk, fill: 문장 가운데 빈칸에 구절을 쓴다
        line.appendChild(el("span", { text: it.before }));
        var inp3 = input("long", 28);
        inp3.value = cur.answers[i] || "";
        inp3.addEventListener("input", function () { cur.answers[i] = inp3.value; save(); });
        line.appendChild(inp3);
        line.appendChild(el("span", { text: it.after }));
        card.appendChild(line);
        if (it.type === "fill") card.appendChild(el("div", { "class": "qhint", text: it.hintText ? "첫 글자 힌트: " + it.hintText : "단어 " + it.words + "개" }));
        if (it.ko) card.appendChild(el("div", { "class": "qko", text: it.ko }));
      }
      body.appendChild(card);
    });
    mcqBoxes.forEach(function (m) { renderMcq(m.it, m.i, m.box); });
    wireEnter();
  }

  function labelFor(key) {
    var it = cur.quiz.items.filter(function (x) { return x.key === key; })[0];
    return it ? it.word : key;
  }

  function showResult(g, summary) {
    var q = cur.quiz;
    // 문항마다 표시: 맞으면 빨간 동그라미, 틀리면 ✕ 와 내 답·정답·이유
    g.items.forEach(function (r) {
      var card = $("solveBody").querySelector('.qcard[data-i="' + r.id + '"]');
      if (!card) return;
      card.classList.add(r.correct ? "right" : "wrong");
      card.querySelector(".qhead").insertBefore(el("span", { "class": "mark " + (r.correct ? "o" : "x"), text: r.correct ? "○" : "✕" }), card.querySelector(".qpts"));
      card.querySelector(".qpts").textContent = r.got + " / " + r.pts + "점";
      if (!r.correct) {
        card.appendChild(el("div", { "class": "qfix" }, [
          el("div", {}, [el("b", { text: "내 답 " }), document.createTextNode(r.given || "(비워 둠)")]),
          el("div", {}, [el("b", { text: "정답 " }), document.createTextNode(r.expected)]),
          el("div", { "class": "why", text: WT.quiz.reasonText(q, r.reason) })
        ]));
      }
    });
    Array.prototype.forEach.call($("solveBody").querySelectorAll("input.ans"), function (inp) { inp.readOnly = true; });
    var top = $("solveTop");
    clear(top);
    var lines = [el("div", { "class": "score" }, [el("b", { text: g.score + " / " + g.total + "점" }), doc.createTextNode(" · 맞힌 문항 " + g.correct + " / " + g.items.length)])];
    if (cur.practice) {
      lines.push(el("div", { "class": "hint", text: "틀린 문항만 다시 푼 연습이라 점수 기록과 약한 목록에는 넣지 않았어요." }));
    } else if (summary) {
      if (summary.added.length || summary.again.length) lines.push(el("div", { "class": "msg warn", text: "약한 목록에 넣었어요: " + summary.added.concat(summary.again).map(labelFor).join(", ") }));
      if (summary.cleared.length) lines.push(el("div", { "class": "msg ok", text: "연속 " + WT.store.CLEAR_AFTER + "번 맞혀서 약한 목록에서 뺐어요: " + summary.cleared.map(labelFor).join(", ") }));
      if (summary.progress.length) lines.push(el("div", { "class": "hint", text: "약한 단어를 맞혔어요(한 번 더 맞히면 빠져요): " + summary.progress.map(labelFor).join(", ") }));
    }
    var wrong = g.items.filter(function (r) { return !r.correct; });
    var row = el("div", { "class": "row" });
    if (wrong.length) row.appendChild(el("button", { type: "button", "class": "primary", text: "틀린 문항만 다시 풀기", onclick: function () {
      var sub = Object.assign({}, q, { items: wrong.map(function (r) { return Object.assign({}, q.items[r.id]); }) });
      var no = 1;
      sub.items.forEach(function (it, k) { it.id = k; it.no = no++; });
      sub.total = sub.items.reduce(function (n, it) { return n + it.pts; }, 0);
      start(sub, Object.assign({}, cur.ctx), true);
    } }));
    row.appendChild(el("button", { type: "button", text: "닫기", onclick: close }));
    lines.push(row);
    lines.forEach(function (n) { top.appendChild(n); });
    top.hidden = false;
    $("btnSolveGrade").hidden = true;
    $("solve").scrollTop = 0;
    root.scrollTo && root.scrollTo(0, 0);
  }

  function gradeNow() {
    if (!cur || cur.graded) return;
    var left = blanksLeft();
    if (left && !root.confirm("비워 둔 문항이 " + left + "개 있어요. 그래도 채점할까요?")) return;
    var g = WT.quiz.grade(cur.quiz, cur.answers);
    cur.graded = true;
    var summary = null;
    if (!cur.practice) {
      dropDraft();
      summary = cur.ctx.onGraded ? cur.ctx.onGraded(g, cur.quiz) : null;
    }
    showResult(g, summary);
  }

  function start(quiz, ctx, practice) {
    cur = { quiz: quiz, ctx: ctx || {}, answers: [], graded: false, practice: !!practice };
    var restored = false;
    if (!practice) {
      var d = readDraft();
      if (d && d.key === cur.ctx.draftKey && Array.isArray(d.answers) && d.answers.length === quiz.items.length) { cur.answers = d.answers; restored = true; }
    }
    quiz.items.forEach(function (it, i) { if (cur.answers[i] === undefined) cur.answers[i] = it.type === "mcq" ? null : (it.type === "colloc" ? it.answers.map(function () { return ""; }) : ""); });
    $("solveTitle").textContent = (practice ? "다시 풀기 · " : "") + (cur.ctx.who ? cur.ctx.who + " · " : "") + quiz.title;
    $("solveSub").textContent = "시험지 번호 " + quiz.seed + " · " + quiz.items.length + "문항 · " + quiz.total + "점";
    var top = $("solveTop");
    clear(top);
    top.appendChild(el("div", { "class": "hint", text: restored ? "아까 풀던 답을 불러왔어요. 이어서 풀어요." : "철자, 대소문자, -ed·-s 까지 정확히 써야 맞아요. 다 풀면 맨 아래 「채점하기」를 눌러요." }));
    top.hidden = false;
    $("btnSolveGrade").hidden = false;
    renderItems();
    $("solve").hidden = false;
    $("solve").scrollTop = 0;
    doc.body.classList.add("solving");
  }

  function close() {
    if (cur && !cur.graded && !cur.practice && !root.confirm("푸는 중인 답은 이 기기에 저장되어 있어요. 닫을까요?")) return;
    $("solve").hidden = true;
    doc.body.classList.remove("solving");
    var ctx = cur && cur.ctx;
    cur = null;
    if (ctx && ctx.onClose) ctx.onClose();
  }

  function bind() {
    $("btnSolveGrade").addEventListener("click", gradeNow);
    $("btnSolveClose").addEventListener("click", close);
  }

  WT.solve = {
    open: function (quiz, ctx) { start(quiz, ctx, false); }, close: close, bind: bind, grade: gradeNow, _draftKey: KEY_DRAFT,
    _current: function () { return cur; } // 점검용: 지금 푸는 문항
  };
})(typeof window !== "undefined" ? window : globalThis);
