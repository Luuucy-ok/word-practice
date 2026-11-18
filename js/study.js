/* 암기 모드(2단계): 카드 넘기기, 듣고 쓰기, 첫 글자 힌트 쓰기, 글자 순서 맞추기, chunk 블록 맞추기.
 * - 카드 넘기기: 앞면을 보고 떠올린 뒤 뒤집어 확인하고 「알아요/몰라요」를 누른다. 몰라요 카드는 뒤에 다시 나온다.
 *   스스로 판단하는 연습이라 약한 목록과 점수 기록은 바꾸지 않는다.
 * - 듣고 쓰기: 기기 음성(Web Speech API)으로 단어·콜로케이션·chunk 문장을 들려주고 빈칸을 쓴다.
 *   채점은 화면 시험과 같은 규칙(quiz.compare)이고, 틀린 것은 뒤에 다시 나온다.
 *   처음에 틀린 것은 약한 목록에 넣는다. 맞혀도 약한 목록에서 빼지는 않는다(빼는 것은 화면 시험에서만).
 * - 첫 글자 힌트 쓰기: 뜻과 단어마다 첫 글자·글자 수 힌트를 보고 쓴다. 채점과 약한 목록 규칙은 듣고 쓰기와 같다.
 * - 펜으로 쓰기: 손글씨 칸에 펜(또는 손가락)으로 쓰고 정답을 본 뒤 스스로 「맞았어요/틀렸어요」를 누른다. 약한 목록 규칙은 듣고 쓰기와 같다.
 * - 글자 순서 맞추기: 단어(chunk 단원은 Key Vocabulary 단어)의 섞인 글자를 눌러 순서대로 놓는다.
 * - chunk 블록 맞추기(chunk 단원만): 콜로케이션 전체, chunk 문장의 빈칸 부분을 단어 블록으로 섞어 순서대로 놓는다.
 *   맞추기 두 가지는 조각을 고르는 연습이라 약한 목록을 바꾸지 않는다.
 * - 문항 키는 약한 목록과 같다: 단어는 단어 글자, chunk 는 v|단어 와 c|문장.
 */
(function (root) {
  "use strict";
  var WT = (root.WT = root.WT || {});
  var doc = root.document;
  var KEY_PREF = "wp.study.v1";

  // ================================================================ 기기 음성
  var speech = (function () {
    var listeners = [];
    function synth() { return root.speechSynthesis || null; }
    function supported() { return !!(synth() && root.SpeechSynthesisUtterance); }
    function voices() { try { return supported() ? synth().getVoices() || [] : []; } catch (e) { return []; } }
    function english() { return voices().filter(function (v) { return /^en([-_]|$)/i.test(String(v.lang || "")); }); }
    function pick() {
      var en = english();
      var us = en.filter(function (v) { return /^en[-_]us$/i.test(v.lang); });
      var gb = en.filter(function (v) { return /^en[-_]gb$/i.test(v.lang); });
      var pool = us.length ? us : (gb.length ? gb : en);
      return pool.filter(function (v) { return v.localService; })[0] || pool[0] || null;
    }
    // ok: 영어 음성이 있음, unknown: 목록을 아직 못 받음(그래도 소리는 날 수 있음), noEnglish: 영어 음성이 없음, none: 기능 없음
    function status() {
      if (!supported()) return { code: "none" };
      var v = pick();
      if (v) return { code: "ok", name: v.name, lang: v.lang };
      return { code: voices().length ? "noEnglish" : "unknown" };
    }
    function say(text, slow) {
      if (!supported() || !text) return false;
      var s = synth();
      try { s.cancel(); } catch (e) {}
      var u = new root.SpeechSynthesisUtterance(String(text));
      var v = pick();
      u.lang = v ? v.lang : "en-US";
      if (v) u.voice = v;
      u.rate = slow ? 0.6 : 0.9;
      s.speak(u);
      return true;
    }
    function onChange(fn) { listeners.push(fn); }
    function wire() {
      var s = synth();
      if (!s) return;
      var fire = function () { listeners.forEach(function (f) { try { f(status()); } catch (e) {} }); };
      if (s.addEventListener) s.addEventListener("voiceschanged", fire);
      else s.onvoiceschanged = fire;
      voices();
    }
    function statusText(st) {
      if (st.code === "ok") return "영어 음성: " + st.name + " (" + st.lang + ")";
      if (st.code === "unknown") return "영어 음성 목록을 아직 받지 못했어요. 「영어 소리 들어 보기」를 눌러 소리가 나는지 확인해 주세요.";
      if (st.code === "noEnglish") return "이 기기에서 영어 음성을 찾지 못했어요. 소리가 안 나면 태블릿 설정에서 「텍스트 음성 변환」(TTS) 엔진의 영어 음성을 설치해 주세요. 메뉴 이름은 기기마다 조금 달라요.";
      return "이 브라우저는 소리 읽기를 지원하지 않아요. 크롬에서 열어 주세요.";
    }
    return { supported: supported, status: status, say: say, onChange: onChange, wire: wire, statusText: statusText, english: english };
  })();

  // ================================================================ 항목 만들기(화면 없이 점검할 수 있는 부분)
  function strip(s) { return String(s || "").replace(/[{}]/g, ""); }
  function blanksOf(s) { var out = [], re = /\{(.+?)\}/g, m; while ((m = re.exec(s)) !== null) out.push(m[1]); return out; }

  // 단원 데이터 → 암기 항목 목록.
  //  parts: 화면에 보여 줄 조각({text} 또는 {blank: n}), answers: 빈칸마다의 정답, say: 들려줄 영어
  function items(data) {
    var plain = WT.util.plain;
    if (data.kind === "word") {
      return (data.words || []).map(function (w) {
        return { key: w.word, group: "단어", word: w.word, parts: [{ blank: 0 }], answers: [w.word], say: w.word,
          en: w.en || "", ko: plain(w.ko || ""), pos: w.pos || "", base: !!w.weak };
      });
    }
    var out = [];
    (data.vocab || []).forEach(function (v) {
      var hasColloc = !!(v.colloc && /\{.+?\}/.test(v.colloc));
      var words = hasColloc ? strip(v.colloc).split(/\s+/).filter(Boolean) : [];
      out.push({ key: "v|" + v.word, group: "Key Vocabulary", word: v.word,
        parts: hasColloc ? WT.quiz.segments(v.colloc) : [{ blank: 0 }], answers: hasColloc ? blanksOf(v.colloc) : [v.word],
        say: hasColloc ? strip(v.colloc) : v.word, en: "", ko: plain(v.ko || ""), pos: "", base: !!v.weak,
        // 블록 맞추기: 콜로케이션 전체의 단어 순서
        blocks: words.length >= 2 ? words : null, before: "", after: "" });
    });
    (data.chunks || []).forEach(function (c) {
      var m = /\{(.+?)\}/.exec(c.sentence || "");
      if (!m) return;
      var before = c.sentence.slice(0, m.index), after = c.sentence.slice(m.index + m[0].length);
      var words = m[1].split(/\s+/).filter(Boolean);
      out.push({ key: "c|" + c.sentence, group: "Chunk 문장", word: m[1],
        parts: [{ text: before }, { blank: 0 }, { text: after }],
        answers: [m[1]], say: strip(c.sentence), en: "", ko: plain(c.ko || ""), pos: "", base: !!c.weak,
        // 블록 맞추기: 앞뒤 문장은 그대로 두고 chunk(시험 빈칸) 안의 단어 순서
        blocks: words.length >= 2 ? words : null, before: before, after: after });
    });
    return out;
  }

  // ---------------------------------------------------------------- 활동
  // graded: 처음 틀린 것을 약한 목록에 넣는 활동(직접 쓰는 활동만). 카드와 글자·블록 맞추기는 약한 목록을 바꾸지 않는다.
  var ACTS = [
    { id: "cards", label: "🃏 카드 넘기기", desc: "뜻을 보고 떠올린 뒤 뒤집어 확인해요", short: "카드" },
    { id: "listen", label: "🎧 듣고 쓰기", desc: "영어를 듣고 빈칸을 써요", short: "듣고 쓰기", graded: true },
    { id: "hint", label: "✏️ 첫 글자 힌트 쓰기", desc: "첫 글자와 글자 수를 보고 써요", short: "첫 글자 힌트 쓰기", graded: true },
    { id: "pen", label: "✍️ 펜으로 쓰기", desc: "시험처럼 손으로 쓰고 정답과 비교해요", short: "펜으로 쓰기", graded: true },
    { id: "letters", label: "🔤 글자 순서 맞추기", desc: "섞인 글자를 눌러 단어를 만들어요", short: "글자 순서 맞추기" },
    { id: "blocks", label: "🧩 chunk 블록 맞추기", desc: "섞인 단어 블록을 순서대로 놓아요", short: "chunk 블록 맞추기", chunkOnly: true }
  ];
  function actOf(id) { return ACTS.filter(function (a) { return a.id === id; })[0] || null; }
  function actsFor(kind) { return ACTS.filter(function (a) { return !a.chunkOnly || kind === "chunk"; }); }

  // 이 활동으로 연습할 수 있는 항목인지
  function fits(item, act) {
    if (act === "letters") return item.group !== "Chunk 문장" && item.word.replace(/\s+/g, "").length >= 2;
    if (act === "blocks") return !!(item.blocks && item.blocks.length >= 2);
    return true;
  }

  // 첫 글자 힌트: 단어마다 첫 글자를 보이고 나머지 글자 수만큼 밑줄(문장 부호는 그대로)
  function hintOf(ans) {
    return String(ans).trim().split(/\s+/).map(function (t) {
      return t.charAt(0) + t.slice(1).replace(/[A-Za-z]/g, "_");
    }).join(" ");
  }

  // 맞추기 조각. letters: 단어의 글자(띄어쓰기는 자리만 남김), blocks: 단어 블록
  function tileSpec(item, act) {
    if (act === "letters") {
      var chars = item.word.trim().split("");
      return { kind: "letters", target: item.word.trim(), chars: chars,
        tokens: chars.filter(function (ch) { return !/\s/.test(ch); }), before: "", after: "" };
    }
    return { kind: "blocks", target: item.blocks.join(" "), tokens: item.blocks.slice(), before: item.before || "", after: item.after || "" };
  }
  // 놓은 순서(조각 번호 목록) → 만든 글자
  function tileBuilt(spec, placed) {
    if (spec.kind === "blocks") return placed.map(function (j) { return spec.tokens[j]; }).join(" ");
    var k = 0;
    return spec.chars.map(function (ch) {
      if (/\s/.test(ch)) return ch;
      var j = placed[k++];
      return j === undefined ? "" : spec.tokens[j];
    }).join("");
  }
  // 섞은 조각 순서. 조각이 모두 같지 않으면 정답 순서와 다르게 섞는다.
  function shuffledOrder(tokens, rng) {
    rng = rng || new WT.util.Rng(WT.util.newSeed());
    var idx = tokens.map(function (_, i) { return i; });
    var same = function (o) { return o.map(function (j) { return tokens[j]; }).join("\u0001") === tokens.join("\u0001"); };
    var allEqual = tokens.every(function (t) { return t === tokens[0]; });
    var o = rng.shuffle(idx.slice());
    for (var n = 0; n < 20 && !allEqual && tokens.length > 1 && same(o); n++) o = rng.shuffle(idx.slice());
    return o;
  }

  // opt.weakOnly: 약한 항목만, opt.isWeak(key): 기기에 표시한 약한 항목인지, opt.groups: 고른 묶음(없으면 전부)
  function select(list, opt) {
    opt = opt || {};
    return list.filter(function (x) {
      if (opt.groups && opt.groups.indexOf(x.group) < 0) return false;
      if (opt.weakOnly) return x.base || !!(opt.isWeak && opt.isWeak(x.key));
      return true;
    });
  }

  // 빈칸마다 비교한다. 하나라도 틀리면 틀린 것(0점 방식).
  function check(item, given) {
    given = Array.isArray(given) ? given : [given];
    var bad = null, wrongAt = [];
    item.answers.forEach(function (exp, k) {
      var c = WT.quiz.compare(given[k], exp);
      if (!c.ok) { wrongAt.push(k); if (bad === null) bad = c.reason; }
    });
    return { ok: bad === null, reason: bad, wrongAt: wrongAt };
  }

  // 카드 묶음: 맞힌(알아요) 카드는 빠지고, 틀린(몰라요) 카드는 맨 뒤로 간다.
  function Deck(list, rng) {
    this.queue = (rng || new WT.util.Rng(WT.util.newSeed())).shuffle(list.slice());
    this.total = list.length;
    this.doneN = 0;
    this.missed = []; // 한 번이라도 몰랐거나 틀린 항목(처음 순서대로, 중복 없음)
  }
  Deck.prototype.current = function () { return this.queue[0] || null; };
  Deck.prototype.pass = function () { if (this.queue.length) { this.queue.shift(); this.doneN++; } };
  Deck.prototype.fail = function () {
    var it = this.queue.shift();
    if (!it) return false;
    var first = this.missed.indexOf(it) < 0;
    if (first) this.missed.push(it);
    this.queue.push(it);
    return first;
  };
  Deck.prototype.finished = function () { return !this.queue.length; };

  // ================================================================ 화면
  function $(id) { return doc.getElementById(id); }
  function el(tag, attrs, kids) {
    var n = doc.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (attrs[k] === null || attrs[k] === undefined) return;
      if (k === "class") n.className = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else if (k.indexOf("on") === 0) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? doc.createTextNode(c) : c); });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  function readPref() { try { var p = JSON.parse(root.localStorage.getItem(KEY_PREF)); return p && typeof p === "object" ? p : {}; } catch (e) { return {}; } }
  function writePref(p) { try { root.localStorage.setItem(KEY_PREF, JSON.stringify(p)); } catch (e) {} }

  var cur = null; // { lesson, all, ctx, pref, act, deck, flipped, checked, inputs, added }

  function isWeakKey(key) { return WT.store.isWeak(cur.lesson.id, key); }
  function groupsOf(list) { var g = []; list.forEach(function (x) { if (g.indexOf(x.group) < 0) g.push(x.group); }); return g; }

  function phrase(item, mode, inputs) {
    // mode: blank(빈칸 표시), filled(정답을 굵게), input(입력칸)
    var line = el("div", { "class": "fphrase" });
    item.parts.forEach(function (p) {
      if (p.text !== undefined) { line.appendChild(doc.createTextNode(p.text)); return; }
      if (mode === "filled") line.appendChild(el("b", { text: item.answers[p.blank] }));
      else if (mode === "input") line.appendChild(inputs[p.blank]);
      else line.appendChild(el("span", { "class": "gap", text: "______" }));
    });
    return line;
  }
  function singleBlank(item) { return item.parts.length === 1 && item.parts[0].blank === 0; }
  function meaning(item) {
    return el("div", { "class": "fmean" }, [
      item.en ? el("div", { "class": "fen", text: item.en }) : null,
      item.ko ? el("div", { "class": "fko", text: item.ko }) : null
    ]);
  }
  // 문제에 보여 줄 뜻. 월·수 단어 시험지에는 영문 뜻만 나오므로 단어 항목은 영문 뜻만 보여 주고,
  // 한글 뜻은 답을 확인하거나 카드를 뒤집은 뒤에 보여 준다(koAfter). chunk 시험지에는 한글 뜻·해석이 나오므로 그대로 둔다.
  function koAfter(item) { return item.group === "단어" && !!item.en; }
  function questionMeaning(item) {
    if (koAfter(item)) return el("div", { "class": "fmean" }, [el("div", { "class": "fen", text: item.en })]);
    return item.ko ? el("div", { "class": "fmean" }, [el("div", { "class": "fko", text: item.ko })]) : null;
  }
  function koReveal(item) {
    return koAfter(item) && item.ko ? el("div", { "class": "fko reveal", text: "뜻: " + item.ko }) : null;
  }
  function sayBtn(item, slow, label) {
    return el("button", { type: "button", "class": "say", text: label || (slow ? "🐢 천천히 듣기" : "🔊 듣기"), onclick: function (e) { e.stopPropagation(); speech.say(item.say, slow); } });
  }

  function setSub(text) { $("studySub").textContent = text; }

  // ---------------------------------------------------------------- 1) 고르기
  function renderSetup(note) {
    var body = $("studyBody");
    clear(body);
    setSub(cur.all.length + "개 항목");
    hideProgress();
    var p = cur.pref;
    var groups = groupsOf(cur.all);
    var box = el("div", { "class": "card" });
    if (note) box.appendChild(el("div", { "class": "msg " + note.kind, text: note.text }));

    box.appendChild(el("h3", { "class": "sgroup", text: "무엇을 할까요?" }));
    var acts = el("div", { "class": "row acts" });
    actsFor(cur.lesson.kind).forEach(function (a) {
      acts.appendChild(el("button", { type: "button", "class": "act" + (p.act === a.id ? " on" : ""), "data-act": a.id, onclick: function () { p.act = a.id; renderSetup(); } }, [
        el("b", { text: a.label }), el("span", { text: a.desc })
      ]));
    });
    box.appendChild(acts);

    var weakN = select(cur.all, { weakOnly: true, isWeak: isWeakKey }).length;
    box.appendChild(el("h3", { "class": "sgroup", text: "범위" }));
    var scope = el("div", { "class": "row" });
    [["all", "전체"], ["weak", "약한 항목만 (" + weakN + "개)"]].forEach(function (s) {
      scope.appendChild(el("button", { type: "button", "class": "opt" + (p.scope === s[0] ? " on" : ""), "data-scope": s[0], onclick: function () { p.scope = s[0]; renderSetup(); } }, [s[1]]));
    });
    box.appendChild(scope);

    if (groups.length > 1) {
      var chosen = (p.groups || []).filter(function (g) { return groups.indexOf(g) >= 0; });
      if (!chosen.length) chosen = groups.slice();
      box.appendChild(el("h3", { "class": "sgroup", text: "항목" }));
      var gr = el("div", { "class": "row" });
      groups.forEach(function (g) {
        var on = chosen.indexOf(g) >= 0;
        gr.appendChild(el("button", { type: "button", "class": "opt" + (on ? " on" : ""), "data-group": g, onclick: function () {
          var next = on ? chosen.filter(function (x) { return x !== g; }) : chosen.concat([g]);
          if (!next.length) return; // 하나는 남긴다
          p.groups = next;
          renderSetup();
        } }, [g + " " + cur.all.filter(function (x) { return x.group === g; }).length + "개"]));
      });
      box.appendChild(gr);
    }

    if (p.act === "cards") {
      box.appendChild(el("h3", { "class": "sgroup", text: "카드 앞면" }));
      var face = el("div", { "class": "row" });
      [["meaning", "뜻 보고 영어 떠올리기"], ["english", "영어 보고 뜻 떠올리기"]].forEach(function (f) {
        face.appendChild(el("button", { type: "button", "class": "opt" + (p.face === f[0] ? " on" : ""), "data-face": f[0], onclick: function () { p.face = f[0]; renderSetup(); } }, [f[1]]));
      });
      box.appendChild(face);
    } else if (p.act === "hint") {
      box.appendChild(el("p", { "class": "hint", style: "margin-top:8px", text: "뜻과 첫 글자 힌트를 보고 써요. 철자, 대소문자, -ed·-s 까지 정확히 써야 맞아요. 틀린 것은 다시 나오고, 처음에 틀린 것은 약한 목록에 들어가요." }));
    } else if (p.act === "pen") {
      box.appendChild(el("p", { "class": "hint", style: "margin-top:8px", text: "S펜(없으면 손가락)으로 칸에 쓰고 「정답 보기」를 눌러 비교해요. 맞았는지는 스스로 눌러요. 철자, 대소문자, -ed·-s 까지 같아야 맞아요. 틀린 것은 다시 나오고, 처음에 틀린 것은 약한 목록에 들어가요." }));
    } else if (p.act === "letters") {
      box.appendChild(el("p", { "class": "hint", style: "margin-top:8px", text: "뜻을 보고 섞인 글자를 순서대로 눌러요. 잘못 놓은 글자는 다시 누르면 빠져요." + (cur.lesson.kind === "chunk" ? " chunk 문장은 「chunk 블록 맞추기」에서 연습해요." : "") + " 스스로 익히는 연습이라 약한 목록은 바꾸지 않아요." }));
    } else if (p.act === "blocks") {
      box.appendChild(el("p", { "class": "hint", style: "margin-top:8px", text: "콜로케이션과 chunk 문장의 빈칸 부분을 단어 블록으로 섞어요. 순서대로 눌러 맞춰요. 스스로 익히는 연습이라 약한 목록은 바꾸지 않아요." }));
    } else {
      var st = speech.status();
      box.appendChild(el("div", { "class": "msg " + (st.code === "ok" ? "ok" : "warn"), "id": "studyVoice", text: speech.statusText(st) }));
      box.appendChild(el("div", { "class": "row", style: "margin-top:8px" }, [
        el("button", { type: "button", text: "🔊 영어 소리 들어 보기", onclick: function () { speech.say("Hello! Let's practice spelling.", false); } })
      ]));
      box.appendChild(el("p", { "class": "hint", style: "margin-top:8px", text: (cur.lesson.kind === "word" ? "시험지처럼 영문 뜻이 함께 나오고, 한글 뜻은 답을 확인한 뒤에 나와요. " : "한글 뜻이 함께 나와요. ") + "철자, 대소문자, -ed·-s 까지 정확히 써야 맞아요. 틀린 것은 다시 나오고, 처음에 틀린 것은 약한 목록에 들어가요." }));
    }

    box.appendChild(el("div", { "class": "row solveend" }, [
      el("button", { type: "button", "class": "primary", id: "btnStudyStart", text: "시작하기", onclick: begin })
    ]));
    body.appendChild(box);
  }

  function chosenList() {
    var p = cur.pref;
    var groups = groupsOf(cur.all);
    var g = (p.groups || []).filter(function (x) { return groups.indexOf(x) >= 0; });
    return select(cur.all, { weakOnly: p.scope === "weak", isWeak: isWeakKey, groups: g.length ? g : null });
  }

  function begin(list) {
    var p = cur.pref;
    if (!Array.isArray(list)) list = chosenList();
    if (!list.length) {
      renderSetup({ kind: "warn", text: p.scope === "weak" ? "약한 항목이 없어요. 범위를 「전체」로 바꾸거나, 먼저 시험을 보고 틀린 단어를 표시해 주세요." : "고른 항목이 없어요." });
      return;
    }
    var fit = list.filter(function (x) { return fits(x, p.act); });
    if (!fit.length) {
      renderSetup({ kind: "warn", text: p.act === "letters" && cur.lesson.kind === "chunk"
        ? "「글자 순서 맞추기」는 Key Vocabulary 단어로 해요. 항목에서 「Key Vocabulary」를 골라 주세요."
        : "고른 항목에는 「" + actOf(p.act).short + "」로 연습할 것이 없어요. 항목이나 방법을 바꿔 주세요." });
      return;
    }
    writePref(p);
    cur.act = p.act;
    cur.deck = new Deck(fit);
    cur.added = [];
    cur.again = [];
    renderStep();
  }

  function renderStep() {
    if (cur.act === "cards") renderCard();
    else if (cur.act === "listen" || cur.act === "hint") renderWrite();
    else if (cur.act === "pen") renderPen();
    else renderTiles();
  }

  function progress() {
    var d = cur.deck;
    setSub(actOf(cur.act).short + " · 끝낸 것 " + d.doneN + " / " + d.total + " · 남은 것 " + d.queue.length);
    if (WT.fun) WT.fun.progress($("studyProg"), d.doneN, d.total);
  }
  function hideProgress() { var p = $("studyProg"); if (p) p.hidden = true; }
  // 맞힘·틀림 반응(효과음, 맞히면 작은 색종이)
  function cheer(ok) {
    if (!WT.fun) return;
    WT.fun.sound(ok ? "ok" : "no");
    if (ok) WT.fun.confetti("small");
  }

  // ---------------------------------------------------------------- 2) 카드 넘기기
  function renderCard() {
    var d = cur.deck;
    if (d.finished()) { renderEnd(); return; }
    progress();
    cur.flipped = false;
    var item = d.current();
    var body = $("studyBody");
    clear(body);
    var english = cur.pref.face === "english";
    var front = el("div", { "class": "fside front" }, [
      el("div", { "class": "fgroup", text: item.group + (item.pos ? " · " + item.pos : "") }),
      english ? phrase(item, "filled") : questionMeaning(item),
      !english && !singleBlank(item) ? phrase(item, "blank") : null,
      english ? sayBtn(item, false) : null
    ]);
    var back = el("div", { "class": "fside back", hidden: "hidden" }, [
      english ? meaning(item) : phrase(item, "filled"),
      english ? null : koReveal(item),
      english ? null : el("div", { "class": "row", style: "justify-content:center" }, [sayBtn(item, false), sayBtn(item, true)])
      // 단원 데이터의 note 는 부모님용 메모(교재·시험지 차이 등)라서 아이 화면에는 보여 주지 않는다.
    ]);
    var card = el("div", { "class": "flash", id: "studyCard", role: "button", tabindex: "0", onclick: flip }, [front, back,
      el("div", { "class": "fflip", text: "눌러서 뒤집기" })]);
    body.appendChild(card);
    var row = el("div", { "class": "row fbtns", id: "studyBtns" });
    row.appendChild(el("button", { type: "button", "class": "primary", id: "btnFlip", text: "뒤집기", onclick: flip }));
    body.appendChild(row);
  }

  function flip() {
    if (!cur || cur.flipped) return;
    cur.flipped = true;
    var item = cur.deck.current();
    var card = $("studyCard");
    card.querySelector(".back").hidden = false;
    card.querySelector(".fflip").hidden = true;
    card.classList.add("open");
    if (cur.pref.face !== "english") speech.say(item.say, false);
    var row = $("studyBtns");
    clear(row);
    row.appendChild(el("button", { type: "button", "class": "dunno", id: "btnDunno", text: "몰라요 (다시 볼래요)", onclick: function () { cur.deck.fail(); renderCard(); } }));
    row.appendChild(el("button", { type: "button", "class": "primary", id: "btnKnow", text: "알아요", onclick: function () { if (WT.fun) WT.fun.sound("tap"); cur.deck.pass(); renderCard(); } }));
  }

  // ---------------------------------------------------------------- 3) 듣고 쓰기
  function ansInput(size) {
    var inp = el("input", {
      type: "text", "class": "ans " + (size === "long" ? "long" : "inline"), lang: "en",
      autocapitalize: "off", autocomplete: "off", autocorrect: "off", spellcheck: "false", enterkeyhint: "done", "data-lpignore": "true"
    });
    return WT.kbd ? WT.kbd.prep(inp) : inp; // 앱 영어 자판(기기 키보드의 단어 추천이 안 보이게)
  }

  // 듣고 쓰기(listen)와 첫 글자 힌트 쓰기(hint)가 같은 화면을 쓴다.
  function renderWrite() {
    var d = cur.deck;
    if (d.finished()) { renderEnd(); return; }
    progress();
    cur.checked = null;
    var item = d.current();
    var hint = cur.act === "hint";
    var body = $("studyBody");
    clear(body);
    var long = item.answers.some(function (a) { return a.indexOf(" ") >= 0; });
    cur.inputs = item.answers.map(function () { return ansInput(long ? "long" : "inline"); });
    cur.inputs.forEach(function (inp, k) {
      inp.addEventListener("keydown", function (e) {
        if (e.key !== "Enter") return;
        e.preventDefault();
        if (cur.checked) { nextListen(); return; }
        if (cur.inputs[k + 1]) cur.inputs[k + 1].focus(); else checkListen();
      });
    });
    var card = el("div", { "class": "flash listen", id: "studyCard" }, [
      el("div", { "class": "fgroup", text: item.group + (hint && item.pos ? " · " + item.pos : "") }),
      hint ? null : el("div", { "class": "row", style: "justify-content:center" }, [sayBtn(item, false, "🔊 다시 듣기"), sayBtn(item, true)]),
      questionMeaning(item),
      hint ? el("div", { "class": "fhint", id: "studyHint" }, item.answers.map(function (a, k) {
        return el("span", { text: (item.answers.length > 1 ? (k + 1) + ") " : "") + hintOf(a) });
      })) : null,
      phrase(item, "input", cur.inputs),
      el("div", { id: "studyFix" })
    ]);
    body.appendChild(card);
    body.appendChild(el("div", { "class": "row fbtns", id: "studyBtns" }, [
      el("button", { type: "button", "class": "primary", id: "btnCheck", text: "확인", onclick: checkListen })
    ]));
    if (!hint) speech.say(item.say, false);
    try { cur.inputs[0].focus(); } catch (e) {}
  }

  function checkListen() {
    if (!cur || cur.checked) return;
    var item = cur.deck.current();
    var given = cur.inputs.map(function (i) { return i.value; });
    if (given.every(function (g) { return !String(g).trim(); })) { cur.inputs[0].focus(); return; }
    var r = check(item, given);
    cur.checked = r;
    cur.inputs.forEach(function (i) { i.readOnly = true; });
    if (cur.act === "hint") speech.say(item.say, false); // 힌트 쓰기는 확인한 뒤에 소리를 들려준다
    var fix = $("studyFix");
    var card = $("studyCard");
    cheer(r.ok);
    if (r.ok) {
      card.classList.add("right");
      fix.appendChild(el("div", { "class": "fres" }, [el("span", { "class": "mark o", text: "○" }), doc.createTextNode(" 맞았어요!")]));
    } else {
      card.classList.add("wrong");
      r.wrongAt.forEach(function (k) { cur.inputs[k].classList.add("bad"); });
      fix.appendChild(el("div", { "class": "qfix" }, [
        el("div", {}, [el("span", { "class": "mark x", text: "✕ " }), el("b", { text: "정답 " }), doc.createTextNode(item.answers.join(" / "))]),
        el("div", { "class": "why", text: WT.quiz.reasonText({ kind: cur.lesson.kind }, r.reason) + " · 이 문제는 뒤에서 다시 나와요." })
      ]));
    }
    var kr = koReveal(item);
    if (kr) fix.appendChild(kr);
    var row = $("studyBtns");
    clear(row);
    var nb = el("button", { type: "button", "class": "primary", id: "btnNext", text: "다음", onclick: nextListen });
    row.appendChild(nb);
    try { nb.focus(); } catch (e) {}
  }

  function nextListen() {
    if (!cur || !cur.checked) return;
    var item = cur.deck.current();
    if (cur.checked.ok) cur.deck.pass();
    else if (cur.deck.fail()) {
      // 처음 틀린 것만 약한 목록에 넣는다(이미 있으면 연속 맞힘 횟수가 0으로 돌아간다).
      var res = WT.store.applyGrading(cur.lesson.id, (function () { var o = {}; o[item.key] = false; return o; })());
      if (res.added.length) cur.added.push(item); else cur.again.push(item);
    }
    renderWrite();
  }

  // ---------------------------------------------------------------- 3-1) 펜으로 쓰기(손글씨 칸 + 스스로 채점)
  // 손글씨를 글자로 바꾸지 않는다(브라우저에서 무료로 쓸 수 있는 인식 기능이 없고, 인식기는 틀린 철자를 고쳐 버릴 수 있음).
  // 쓴 글씨와 정답을 나란히 보고 아이가 「맞았어요/틀렸어요」를 누른다. 처음에 틀렸다고 누른 것은 약한 목록에 넣는다.
  function penPad() {
    var wrap = el("div", { "class": "penwrap" });
    var cv = el("canvas", { "class": "pen", id: "penCanvas", "aria-label": "펜으로 쓰는 칸" });
    wrap.appendChild(cv);
    var strokes = [], curStroke = null, sawPen = false, ctx = null, ratio = 1;
    function size() {
      ratio = root.devicePixelRatio || 1;
      var w = cv.clientWidth || 600, h = cv.clientHeight || 200;
      cv.width = Math.round(w * ratio);
      cv.height = Math.round(h * ratio);
      ctx = cv.getContext("2d");
      redraw();
    }
    function color() { try { return root.getComputedStyle(cv).color || "#111"; } catch (e) { return "#111"; } }
    function line(s) {
      if (!ctx || !s.length) return;
      ctx.strokeStyle = color();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (var i = 0; i < s.length; i++) {
        var a = s[i - 1] || s[i], b = s[i];
        ctx.lineWidth = Math.max(2, 3.2 * (b.p || 0.5) + 1.2) * ratio;
        ctx.beginPath();
        ctx.moveTo(a.x * ratio, a.y * ratio);
        ctx.lineTo(b.x * ratio + 0.01, b.y * ratio);
        ctx.stroke();
      }
    }
    function redraw() { if (!ctx) return; ctx.clearRect(0, 0, cv.width, cv.height); strokes.forEach(line); }
    function pt(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, p: e.pointerType === "pen" ? (e.pressure || 0.5) : 0.5 }; }
    cv.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "pen") sawPen = true;
      else if (sawPen && e.pointerType === "touch") return; // 펜으로 쓰는 중에 손바닥이 닿은 것은 무시
      if (pad.locked) return;
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch (x) {}
      curStroke = [pt(e)];
      strokes.push(curStroke);
      redraw();
    });
    cv.addEventListener("pointermove", function (e) {
      if (!curStroke) return;
      e.preventDefault();
      curStroke.push(pt(e));
      line(curStroke.slice(-2));
    });
    function end() { curStroke = null; if (pad.onChange) pad.onChange(); }
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
    var pad = {
      node: wrap, canvas: cv, locked: false, onChange: null,
      size: size,
      count: function () { return strokes.length; },
      undo: function () { strokes.pop(); redraw(); },
      clear: function () { strokes = []; redraw(); },
      _draw: function (pts) { strokes.push(pts.map(function (q) { return { x: q[0], y: q[1], p: 0.5 }; })); redraw(); } // 점검용
    };
    return pad;
  }

  function renderPen() {
    var d = cur.deck;
    if (d.finished()) { renderEnd(); return; }
    progress();
    cur.checked = null;
    var item = d.current();
    var body = $("studyBody");
    clear(body);
    var pad = penPad();
    cur.pad = pad;
    var long = item.answers.some(function (a) { return a.indexOf(" ") >= 0; }) || item.answers.length > 1;
    pad.canvas.classList.add(long ? "tall" : "short");
    var card = el("div", { "class": "flash listen penmode", id: "studyCard" }, [
      el("div", { "class": "fgroup", text: item.group + (item.pos ? " · " + item.pos : "") }),
      questionMeaning(item),
      singleBlank(item) ? null : phrase(item, "blank"),
      pad.node,
      el("div", { "class": "row pentools" }, [
        el("button", { type: "button", id: "btnPenUndo", text: "↶ 한 획 지우기", onclick: function () { pad.undo(); } }),
        el("button", { type: "button", id: "btnPenClear", text: "모두 지우기", onclick: function () { pad.clear(); } })
      ]),
      el("div", { id: "studyFix" })
    ]);
    body.appendChild(card);
    body.appendChild(el("div", { "class": "row fbtns", id: "studyBtns" }, [
      el("button", { type: "button", "class": "primary", id: "btnPenShow", text: "정답 보기", onclick: showPen })
    ]));
    pad.size();
  }

  function showPen() {
    if (!cur || cur.checked) return;
    var item = cur.deck.current();
    var fix = $("studyFix");
    if (!cur.pad.count()) {
      clear(fix);
      fix.appendChild(el("div", { "class": "msg warn", text: "먼저 펜으로 칸에 써 보세요." }));
      return;
    }
    cur.checked = { pending: true };
    cur.pad.locked = true;
    clear(fix);
    fix.appendChild(el("div", { "class": "penans" }, [el("span", { "class": "fgroup", text: "정답" }), phrase(item, "filled")]));
    var kr = koReveal(item);
    if (kr) fix.appendChild(kr);
    fix.appendChild(el("p", { "class": "hint", text: "내가 쓴 것과 한 글자씩 비교해 보세요. 대문자, -ed·-s 도 같아야 맞아요." }));
    speech.say(item.say, false);
    var row = $("studyBtns");
    clear(row);
    row.appendChild(el("button", { type: "button", "class": "dunno", id: "btnPenWrong", text: "❌ 틀렸어요", onclick: function () { markPen(false); } }));
    row.appendChild(el("button", { type: "button", "class": "primary", id: "btnPenRight", text: "⭕ 맞았어요", onclick: function () { markPen(true); } }));
  }

  function markPen(ok) {
    if (!cur || !cur.checked || !cur.checked.pending) return;
    var item = cur.deck.current();
    cur.checked = { ok: ok };
    cheer(ok);
    if (ok) cur.deck.pass();
    else if (cur.deck.fail()) {
      var res = WT.store.applyGrading(cur.lesson.id, (function () { var o = {}; o[item.key] = false; return o; })());
      if (res.added.length) cur.added.push(item); else cur.again.push(item);
    }
    setTimeout(function () { if (cur && cur.act === "pen") renderPen(); }, ok ? 350 : 0);
  }

  // ---------------------------------------------------------------- 3-2) 글자 순서 맞추기, chunk 블록 맞추기
  // 섞인 조각을 눌러 순서대로 놓는다. 다 놓으면 저절로 확인한다. 약한 목록은 바꾸지 않는다.
  function renderTiles() {
    var d = cur.deck;
    if (d.finished()) { renderEnd(); return; }
    progress();
    cur.checked = null;
    var item = d.current();
    var spec = tileSpec(item, cur.act);
    cur.tiles = { spec: spec, order: shuffledOrder(spec.tokens), placed: [] };
    var body = $("studyBody");
    clear(body);
    var card = el("div", { "class": "flash listen tiles", id: "studyCard" }, [
      el("div", { "class": "fgroup", text: item.group + (spec.kind === "letters" && item.pos ? " · " + item.pos : "") }),
      questionMeaning(item),
      el("div", { "class": "tline " + spec.kind, id: "tileSlots" }),
      el("div", { "class": "row tpool", id: "tilePool" }),
      el("div", { id: "studyFix" })
    ]);
    body.appendChild(card);
    body.appendChild(el("div", { "class": "row fbtns", id: "studyBtns" }, [
      el("button", { type: "button", id: "btnTileReset", text: "↺ 다시 놓기", onclick: function () { if (cur.checked) return; cur.tiles.placed = []; drawTiles(); } })
    ]));
    drawTiles();
  }

  function drawTiles() {
    var t = cur.tiles, spec = t.spec, done = !!cur.checked;
    var slots = $("tileSlots");
    clear(slots);
    var slot = function (k) {
      var j = t.placed[k];
      if (j === undefined) return el("span", { "class": "tslot" });
      return el("button", { type: "button", "class": "tile placed", "data-slot": String(k), text: spec.tokens[j], disabled: done ? "disabled" : null,
        onclick: function () { if (cur.checked) return; t.placed.splice(k, 1); drawTiles(); } });
    };
    if (spec.kind === "letters") {
      var k = 0;
      spec.chars.forEach(function (ch) {
        if (/\s/.test(ch)) slots.appendChild(el("span", { "class": "tgap" }));
        else slots.appendChild(slot(k++));
      });
    } else {
      if (spec.before) slots.appendChild(el("span", { "class": "tctx", text: spec.before }));
      spec.tokens.forEach(function (_, i) { slots.appendChild(slot(i)); });
      if (spec.after) slots.appendChild(el("span", { "class": "tctx", text: spec.after }));
    }
    var pool = $("tilePool");
    clear(pool);
    t.order.forEach(function (j) {
      if (t.placed.indexOf(j) >= 0) return;
      pool.appendChild(el("button", { type: "button", "class": "tile", "data-tile": String(j), text: spec.tokens[j],
        onclick: function () {
          if (cur.checked) return;
          t.placed.push(j);
          if (t.placed.length === spec.tokens.length) checkTiles(); else drawTiles();
        } }));
    });
  }

  function checkTiles() {
    var item = cur.deck.current();
    var spec = cur.tiles.spec;
    var built = tileBuilt(spec, cur.tiles.placed);
    var ok = built === spec.target;
    cur.checked = { ok: ok };
    drawTiles();
    speech.say(item.say, false);
    cheer(ok);
    var card = $("studyCard");
    var fix = $("studyFix");
    if (ok) {
      card.classList.add("right");
      fix.appendChild(el("div", { "class": "fres" }, [el("span", { "class": "mark o", text: "○" }), doc.createTextNode(" 맞았어요!")]));
    } else {
      card.classList.add("wrong");
      fix.appendChild(el("div", { "class": "qfix" }, [
        el("div", {}, [el("span", { "class": "mark x", text: "✕ " }), el("b", { text: "정답 " }), doc.createTextNode(spec.target)]),
        el("div", { "class": "why", text: "이 문제는 뒤에서 다시 나와요." })
      ]));
    }
    var kr = koReveal(item);
    if (kr) fix.appendChild(kr);
    var row = $("studyBtns");
    clear(row);
    var nb = el("button", { type: "button", "class": "primary", id: "btnNext", text: "다음", onclick: function () {
      if (!cur || !cur.checked) return;
      if (cur.checked.ok) cur.deck.pass(); else cur.deck.fail();
      renderTiles();
    } });
    row.appendChild(nb);
    try { nb.focus(); } catch (e) {}
  }

  // ---------------------------------------------------------------- 4) 끝
  function renderEnd() {
    var d = cur.deck;
    setSub("끝났어요 · " + d.total + "개");
    var body = $("studyBody");
    clear(body);
    var box = el("div", { "class": "card" });
    box.appendChild(el("div", { "class": "score" }, [el("b", { text: "다 했어요! " }), doc.createTextNode(d.total + "개 중 한 번에 " + (d.total - d.missed.length) + "개")]));
    if (WT.fun) {
      // 끝까지 하면 스티커를 하나 받는다.
      var got = WT.fun.award(cur.lesson.data.owner, "외우기 · " + $("studyTitle").textContent.replace(/^외우기 · /, ""));
      box.appendChild(el("div", { "class": "sgot", id: "studySticker" }, [
        el("span", { "class": "sbig", text: got.s }),
        el("span", { text: "스티커를 받았어요! 모두 " + WT.fun.stickers(WT.fun.codeOfOwner(cur.lesson.data.owner) || WT.fun.currentCode()).length + "개" })
      ]));
      WT.fun.progress($("studyProg"), d.total, d.total);
      WT.fun.sound("done");
      setTimeout(function () { WT.fun.sound("sticker"); }, 450);
      WT.fun.confetti("big");
    }
    if (d.missed.length) {
      box.appendChild(el("p", { "class": "hint", style: "margin-top:8px", text: (cur.act === "cards" ? "처음에 몰랐던 것: " : "처음에 틀린 것: ") + d.missed.map(function (x) { return x.word; }).join(", ") }));
    }
    if (actOf(cur.act).graded && (cur.added.length || cur.again.length)) {
      box.appendChild(el("div", { "class": "msg warn", text: "약한 목록에 넣었어요: " + cur.added.concat(cur.again).map(function (x) { return x.word; }).join(", ") + "\n화면 시험에서 연속 " + WT.store.CLEAR_AFTER + "번 맞히면 빠져요." }));
    }
    var row = el("div", { "class": "row", style: "margin-top:12px" });
    if (d.missed.length) row.appendChild(el("button", { type: "button", "class": "primary", id: "btnStudyMissed", text: "처음에 " + (cur.act === "cards" ? "몰랐던" : "틀린") + " 것만 다시", onclick: function () { begin(d.missed.slice()); } }));
    row.appendChild(el("button", { type: "button", id: "btnStudyAgain", text: "다른 방법 고르기", onclick: function () { renderSetup(); } }));
    row.appendChild(el("button", { type: "button", text: "닫기", onclick: close }));
    box.appendChild(row);
    body.appendChild(box);
  }

  // ---------------------------------------------------------------- 열기·닫기
  function open(lesson, ctx) {
    var all = items(lesson.data);
    var pref = readPref();
    var ok = actsFor(lesson.kind).some(function (a) { return a.id === pref.act; });
    cur = { lesson: lesson, all: all, ctx: ctx || {}, pref: {
      act: ok ? pref.act : "cards",
      // 단원 줄의 「외우기」는 전체로, 「🔁 틀린 항목」은 약한 항목만으로 연다. 범위를 주지 않으면 지난번 고른 범위.
      scope: ctx && (ctx.scope === "weak" || ctx.scope === "all") ? ctx.scope : (pref.scope === "weak" ? "weak" : "all"),
      face: pref.face === "english" ? "english" : "meaning",
      groups: Array.isArray(pref.groups) ? pref.groups : null
    } };
    var d = lesson.data;
    var title = lesson.kind === "word" ? "단어 Lesson " + d.lesson : (d.title || "Chunk Quiz");
    $("studyTitle").textContent = "외우기 · " + (cur.ctx.who ? cur.ctx.who + " · " : "") + title;
    if (WT.fun) WT.fun.enter(cur.ctx.owner || d.owner);
    renderSetup();
    $("study").hidden = false;
    $("study").scrollTop = 0;
    doc.body.classList.add("solving");
  }

  function close() {
    try { if (root.speechSynthesis) root.speechSynthesis.cancel(); } catch (e) {}
    $("study").hidden = true;
    doc.body.classList.remove("solving");
    hideProgress();
    if (WT.fun) WT.fun.leave();
    var ctx = cur && cur.ctx;
    cur = null;
    if (ctx && ctx.onClose) ctx.onClose();
  }

  function bind() {
    $("btnStudyClose").addEventListener("click", close);
    speech.wire();
    speech.onChange(function (st) { var n = $("studyVoice"); if (n) { n.textContent = speech.statusText(st); n.className = "msg " + (st.code === "ok" ? "ok" : "warn"); } });
  }

  WT.speech = speech;
  WT.study = {
    items: items, select: select, check: check, Deck: Deck,
    ACTS: ACTS, actsFor: actsFor, fits: fits, hintOf: hintOf, tileSpec: tileSpec, tileBuilt: tileBuilt, shuffledOrder: shuffledOrder,
    open: open, close: close, bind: bind,
    _current: function () { return cur; } // 점검용
  };
})(typeof window !== "undefined" ? window : globalThis);
