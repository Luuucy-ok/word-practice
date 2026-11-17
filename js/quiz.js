/* 태블릿에서 직접 푸는 시험(3단계)의 문항 만들기와 채점.
 * 인쇄 시험지와 같은 출제 결과(s)를 받아서 문항 목록으로 바꾸므로, 같은 시험지 번호면 종이와 화면의 문항이 같다.
 * 채점은 집 채점 규칙(항상 0점 방식)을 따른다.
 *  - 앞뒤 공백은 무시하고, 단어 사이의 연속 공백은 하나로 본다. 대소문자는 구분한다.
 *  - 쓰기 문항은 철자 한 글자, 대소문자, -ed·-s 빠뜨림 중 하나라도 틀리면 0점.
 *  - chunk 는 문항 안에서 한 칸이라도 틀리면 그 문항은 0점. 틀린 이유는 시험지 아래의 5가지로 적는다.
 *  - 구절 앞뒤의 문장 부호(. , ! ? ; :)는 시험지에 칸이 없으므로 채점에서 보지 않는다.
 */
(function (root) {
  "use strict";
  var WT = (root.WT = root.WT || {});
  var U = WT.util;
  var CIRCLED = "①②③④⑤⑥";

  var REASON_EN = {
    spelling: "Spelling error", capitalization: "capitalization error", missing: "missing word",
    added: "added word", different: "different word", blank: "not answered"
  };
  var REASON_KO = {
    spelling: "철자가 달라요", capitalization: "대소문자가 달라요", missing: "빠진 단어가 있어요",
    added: "더 쓴 단어가 있어요", different: "다른 단어예요", blank: "답을 쓰지 않았어요", choice: "다른 번호를 골랐어요"
  };

  // ---------------------------------------------------------------- 비교
  function norm(s) {
    return String(s === undefined || s === null ? "" : s)
      .normalize("NFC")
      .replace(/[‘’ʼ′]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[  -​　]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  function core(t) { return t.replace(/^[.,!?;:]+|[.,!?;:]+$/g, ""); }
  function tokens(s) { return norm(s).split(" ").map(core).filter(Boolean); }

  function lev(a, b) {
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev.push(j);
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) {
        cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1)));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  // 쓴 답과 정답을 비교한다. 틀리면 이유(spelling, capitalization, missing, added, different, blank)를 돌려준다.
  function compare(given, expected) {
    var g = tokens(given), e = tokens(expected);
    if (!g.length) return { ok: false, reason: "blank" };
    var gs = g.join(" "), es = e.join(" ");
    if (gs === es) return { ok: true, reason: null };
    if (gs.toLowerCase() === es.toLowerCase()) return { ok: false, reason: "capitalization" };
    if (g.length < e.length) return { ok: false, reason: "missing" };
    if (g.length > e.length) return { ok: false, reason: "added" };
    var spelling = true;
    for (var i = 0; i < e.length; i++) {
      if (g[i] === e[i]) continue;
      var d = lev(g[i].toLowerCase(), e[i].toLowerCase());
      if (d > Math.max(2, Math.floor(e[i].length / 3))) spelling = false;
    }
    return { ok: false, reason: spelling ? "spelling" : "different" };
  }

  // ---------------------------------------------------------------- 문항 만들기
  function lessonTitle(data) {
    return "Lesson " + (data.lesson === undefined ? "" : data.lesson) + (data.title ? " " + data.title : "");
  }
  function finish(q) {
    var no = 1;
    q.items.forEach(function (it, i) { it.id = i; it.no = no++; });
    q.total = q.items.reduce(function (n, it) { return n + it.pts; }, 0);
    return q;
  }

  // 월·수 단어 시험. mode 는 regular 또는 all-write, parts 는 all-write 에서 낼 파트(Set: "A", "B").
  function fromWord(data, s, opt) {
    opt = opt || {};
    var q = { kind: "word", mode: s.mode, seed: s.seed, owner: data.owner, title: lessonTitle(data), items: [] };
    if (s.mode === "regular") {
      var per = data.points_per_question || 10;
      s.written.forEach(function (w) {
        q.items.push({ type: "write", group: "Questions", prompt: w.en, answers: [w.word], key: w.word, word: w.word, ko: U.plain(w.ko || ""), pts: per });
      });
      var options = s.options.map(function (w) { return w.word; });
      s.mcq.forEach(function (p) {
        q.items.push({ type: "mcq", group: "Questions", sentence: p[1].text, options: options, answer: s.options.indexOf(p[0]),
          answers: [p[0].word], key: p[0].word, word: p[0].word, ko: U.plain(p[1].ko || p[0].ko || ""), pts: per });
      });
    } else {
      var parts = opt.parts || new Set(["A", "B"]);
      var perW = data.points_per_question_write || 5;
      if (parts.has("A")) {
        s.a.forEach(function (w) {
          q.items.push({ type: "write", group: "Part A. Read the meaning and write the word.", prompt: w.en, answers: [w.word], key: w.word, word: w.word, ko: U.plain(w.ko || ""), pts: perW });
        });
      }
      if (parts.has("B")) {
        var bank = s.bank.map(function (w) { return w.word; });
        s.b.forEach(function (p) {
          q.items.push({ type: "write", group: "Part B. Use the words below to complete the sentences.", sentence: p[1].text, bank: bank,
            answers: [p[0].word], key: p[0].word, word: p[0].word, ko: U.plain(p[1].ko || p[0].ko || ""), pts: perW });
        });
      }
    }
    return finish(q);
  }

  // 「builds a {bond}」 → [{text:"builds a "}, {blank:0}]
  function segments(colloc) {
    var out = [], re = /\{(.+?)\}/g, last = 0, m, n = 0;
    while ((m = re.exec(colloc)) !== null) {
      if (m.index > last) out.push({ text: colloc.slice(last, m.index) });
      out.push({ blank: n++ });
      last = m.index + m[0].length;
    }
    if (last < colloc.length) out.push({ text: colloc.slice(last) });
    return out;
  }

  // 첫 글자 힌트: 그대로 두는 짧은 단어(a, the, and …)는 보여 주고, 나머지는 첫 글자만 보여 준다.
  function hintPattern(phrase, keep) {
    return phrase.split(/\s+/).filter(Boolean).map(function (t) {
      var c = core(t);
      return keep.has(c.toLowerCase()) ? t : c.charAt(0) + "…";
    }).join(" ");
  }

  // 금요일 chunk 시험. opt.hint 는 none 또는 first, opt.pts 는 [Key Vocabulary, Chunk, Fill] 문항당 점수.
  function fromChunk(data, s, opt) {
    opt = opt || {};
    var pts = opt.pts || [1, 2, 4];
    var hint = opt.hint || data.hint || "none";
    var keep = opt.keep || WT.chunk.KEEP_DEFAULT;
    var q = { kind: "chunk", mode: s.mode, seed: s.seed, owner: data.owner, title: data.title || "Chunk Quiz", hint: hint, items: [] };
    s.vocab.forEach(function (v) {
      q.items.push({ type: "colloc", group: "Key Vocabulary", segments: segments(v.colloc), answers: v._answers.slice(), key: "v|" + v.word, word: v.word,
        ko: U.plain(v.ko || ""), pts: pts[0] });
    });
    s.chunk.forEach(function (c) {
      q.items.push({ type: "chunk", group: "Chunk", before: c._before, after: c._after, bank: s.bank.slice(), answers: [c._phrase], key: "c|" + c.sentence,
        word: c._phrase, ko: U.plain(c.ko || ""), pts: pts[1] });
    });
    s.fill.forEach(function (c) {
      var n = c._phrase.split(/\s+/).filter(Boolean).length;
      q.items.push({ type: "fill", group: "Fill in the blanks", before: c._before, after: c._after, words: n,
        hintText: hint === "first" ? hintPattern(c._phrase, keep) : null, answers: [c._phrase], key: "c|" + c.sentence,
        word: c._phrase, ko: U.plain(c.ko || ""), pts: pts[2] });
    });
    return finish(q);
  }

  // ---------------------------------------------------------------- 채점
  // answers[i]: write·chunk·fill 은 글자, colloc 은 칸마다의 글자 배열, mcq 는 고른 보기 번호(0부터, 안 골랐으면 null).
  function grade(quiz, answers) {
    answers = answers || [];
    var out = { items: [], score: 0, total: quiz.total, correct: 0, byKey: {} };
    quiz.items.forEach(function (it, i) {
      var a = answers[i];
      var r = { id: it.id, no: it.no, type: it.type, key: it.key, pts: it.pts, got: 0, correct: false, reason: null, given: "", expected: "" };
      if (it.type === "mcq") {
        var pick = typeof a === "number" ? a : null;
        r.correct = pick === it.answer;
        r.reason = r.correct ? null : (pick === null ? "blank" : "choice");
        r.given = pick === null ? "" : CIRCLED.charAt(pick) + " " + it.options[pick];
        r.expected = CIRCLED.charAt(it.answer) + " " + it.options[it.answer];
      } else if (it.type === "colloc") {
        var arr = Array.isArray(a) ? a : [];
        var bad = null;
        it.answers.forEach(function (exp, k) {
          var c = compare(arr[k], exp);
          if (!c.ok && bad === null) bad = c.reason;
        });
        r.correct = bad === null;
        r.reason = bad;
        r.given = it.answers.map(function (x, k) { return norm(arr[k]) || "(빈칸)"; }).join(" / ");
        r.expected = it.answers.join(" / ");
      } else {
        var c2 = compare(a, it.answers[0]);
        r.correct = c2.ok;
        r.reason = c2.reason;
        r.given = norm(a);
        r.expected = it.answers[0];
      }
      if (r.correct) { r.got = it.pts; out.score += it.pts; out.correct++; }
      // 같은 단어·chunk 가 두 문항에 나오면(예: Chunk 와 Fill) 둘 다 맞아야 맞힌 것으로 본다.
      out.byKey[it.key] = (it.key in out.byKey ? out.byKey[it.key] : true) && r.correct;
      out.items.push(r);
    });
    return out;
  }

  function reasonText(quiz, reason) {
    if (!reason) return "";
    if (quiz.kind === "chunk" && REASON_EN[reason]) return REASON_EN[reason] + " · " + (REASON_KO[reason] || "");
    return REASON_KO[reason] || reason;
  }

  WT.quiz = {
    CIRCLED: CIRCLED, norm: norm, tokens: tokens, compare: compare, lev: lev,
    fromWord: fromWord, fromChunk: fromChunk, grade: grade, reasonText: reasonText, segments: segments, hintPattern: hintPattern
  };
})(typeof window !== "undefined" ? window : globalThis);
