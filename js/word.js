/* 월·수 단어 시험지 생성 규칙.
 * 파이썬 스크립트(make_word_test.py)와 같은 규칙을 그대로 옮긴 것이다.
 *  - regular   : 학원 시험 모양. 쓰기 6문항 + 보기 번호 4문항 = 10문항
 *  - all-write : 모든 단어를 직접 쓰는 철자 확인용 연습
 * 같은 시험지 번호(seed)면 같은 시험지가 나오고, 번호가 다르면 순서가 달라진다.
 */
(function (root) {
  "use strict";
  var WT = (root.WT = root.WT || {});
  var U = WT.util;
  var esc = U.esc;
  var Rng = U.Rng;
  var CIRCLED = "①②③④⑤⑥";
  var ALL_SOURCES = ["practice", "book", "exam", "new"];
  var SOURCE_LABEL = {
    practice: "연습 페이지",
    book: "교재 예문(Sentence 열)",
    exam: "지난 시험 문장",
    "new": "새 문장(책에 없음)"
  };

  var CSS = [
    "@page{size:A4;margin:12mm}",
    "*{box-sizing:border-box}",
    'body{font-family:"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",Arial,sans-serif;font-size:10.5pt;color:#111;line-height:1.4;word-break:keep-all;margin:0;background:#fff}',
    ".toolbar{padding:8px 12px;background:#f1f5f9;border-bottom:1px solid #cbd5e1;font-size:10pt}",
    ".toolbar button{font-size:10pt;padding:4px 10px;margin-right:8px}",
    "@media print{.toolbar{display:none}}",
    ".page{width:186mm;margin:0 auto;padding:2mm 0;page-break-after:always}",
    ".page:last-child{page-break-after:auto}",
    ".top{display:flex;justify-content:space-between;align-items:flex-end;font-size:10pt;margin-bottom:2mm}",
    ".top .name{font-weight:700}",
    ".line{display:inline-block;border-bottom:1px solid #111;min-width:55mm;height:1.2em;vertical-align:bottom}",
    "hr.rule{border:0;border-top:1.5px solid #111;margin:2mm 0 3mm}",
    "h1.title{font-size:15pt;text-align:center;margin:2mm 0 4mm;font-weight:600}",
    "h3.part{font-size:11.5pt;margin:3mm 0 2mm}",
    "table.t{width:100%;border-collapse:collapse;border:1.5px solid #111;table-layout:fixed}",
    "table.t th{background:#e5e7eb;border:1px solid #111;padding:2mm;font-size:10pt}",
    "table.t td{border:1px solid #111;padding:2mm 3mm;vertical-align:middle}",
    "table.t tr{page-break-inside:avoid}",
    "td.no{width:10mm;text-align:center;font-weight:700;background:#f3f4f6}",
    "td.q{width:84mm;text-align:center}",
    "td.a{width:92mm}",
    "td.pt{width:16mm;text-align:right;color:#555}",
    "tr.w td,tr.m td{height:17mm}",
    "table.t3 tr.w td,table.t3 tr.m td{height:15mm}",
    ".blank{display:inline-block;border-bottom:1px solid #111;min-width:26mm;height:1em;vertical-align:baseline}",
    ".opts{display:grid;grid-template-columns:1fr 1fr;gap:1mm 3mm;font-size:11pt}",
    ".bankline{border:1px solid #111;padding:2mm 3mm;margin:0 0 3mm;font-size:11pt;text-align:center;background:#fafafa}",
    ".grade{margin:5mm 0 0 auto;width:42mm;border:1.5px solid #111}",
    ".grade .h{background:#e5e7eb;text-align:center;border-bottom:1px solid #111;padding:1mm}",
    ".grade .b{height:14mm;display:flex;align-items:flex-end;justify-content:flex-end;padding:1mm 2mm;color:#555}",
    ".foot{color:#777;font-size:8.5pt;margin-top:3mm}",
    "h2.key{font-size:13pt;margin:0 0 3mm}",
    "table.k{width:100%;border-collapse:collapse;font-size:10pt;margin-bottom:3mm}",
    "table.k th,table.k td{border:1px solid #888;padding:1.5mm 2mm;vertical-align:top}",
    "table.k th{background:#eef2f7;text-align:left}",
    ".box{border:1px solid #888;padding:2mm 3mm;margin:3mm 0;font-size:10pt;background:#fafafa}",
    ".box ul{margin:1mm 0 0 4mm;padding:0}",
    "table.k.tight th,table.k.tight td{padding:0.8mm 2mm}"
  ].join("\n");

  function blankify(sentence) {
    return esc(sentence).split("___").join('<span class="blank"></span>');
  }
  function filled(sentence, word) {
    return esc(sentence).split("___").join("<b>" + esc(word) + "</b>");
  }
  function koHtml(sent) {
    if (!sent.ko) return "";
    return "<br>" + esc(sent.ko).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  }
  function missingKo(data, sentences) {
    if (!data.require_sentence_ko) return [];
    return sentences.filter(function (x) { return !x.ko; }).map(function (x) { return x.text; });
  }

  // ---------------------------------------------------------------- 데이터 읽기
  // 누구 것인지와 반 규칙이 데이터에 없으면 시험지를 만들지 않는다(재발 방지).
  function load(raw) {
    var data = JSON.parse(JSON.stringify(raw));
    if (data.kind !== "word") throw new Error("데이터의 kind 가 word 가 아닙니다");
    if (!data.words || !data.words.length) throw new Error("words 가 비어 있습니다");
    var missing = ["owner", "sentence_sources", "require_sentence_ko"].filter(function (k) { return !(k in data); });
    if (missing.length) {
      throw new Error("데이터에 필수 항목이 없습니다: " + missing.join(", ") +
        "\n  owner(누구 것인지), sentence_sources(문장 출처 규칙), require_sentence_ko(해석 필수 여부)는 사용자에게 확인해서 적으세요. 짐작해서 채우지 마세요.");
    }
    var srcs = data.sentence_sources;
    if (!Array.isArray(srcs) || !srcs.length || srcs.some(function (x) { return ALL_SOURCES.indexOf(x) < 0; })) {
      throw new Error("sentence_sources 는 " + ALL_SOURCES.join(", ") + " 중에서 고른 목록이어야 합니다");
    }
    if (typeof data.require_sentence_ko !== "boolean") throw new Error("require_sentence_ko 는 true 또는 false 여야 합니다");
    data.words.forEach(function (w, i) {
      if (!w.word || !w.en) throw new Error((i + 1) + "번째 단어에 word 또는 en(영문 뜻)이 없습니다");
    });
    return data;
  }

  function allowedSources(data) { return new Set(data.sentence_sources); }

  function srcTag(x) {
    var source = x.source;
    var label = SOURCE_LABEL[source] || "출처 미상";
    if (source === "practice" && x.ref) label = "연습 페이지 " + x.ref + "번";
    var color = source === "practice" ? "#666" : "#b45309";
    return ' <small style="color:' + color + '">[' + label + "]</small>";
  }
  function sheetNote(data) {
    var note = "대상 " + data.owner;
    if (!data.verified) note += " · ※ 교재 대조 전 데이터";
    return note;
  }

  function usable(word, sources) {
    return (word.sentences || []).filter(function (s) {
      if (U.countBlank(s.text) !== 1) return false;
      if (sources && sources.size && !sources.has(s.source)) return false;
      return true;
    });
  }
  function conflict(a, b) {
    return (a.confusable || []).indexOf(b.word) >= 0 || (b.confusable || []).indexOf(a.word) >= 0;
  }
  function hasConflict(group) {
    for (var i = 0; i < group.length; i++)
      for (var j = i + 1; j < group.length; j++)
        if (conflict(group[i], group[j])) return true;
    return false;
  }
  function spellingFlags(w) {
    var flags = [];
    var word = w.word;
    var m = /([a-zA-Z])\1/.exec(word);
    if (m) flags.push("겹자음·겹모음(" + m[0] + ")");
    if (/(tion|sion)$/.test(word)) flags.push("-tion/-sion");
    if (/^[A-Z]/.test(word)) flags.push("첫 글자 대문자");
    if (word.indexOf(" ") >= 0) flags.push("두 단어 표현(모두 써야 정답)");
    return flags;
  }
  function noteFor(w) {
    var note = spellingFlags(w);
    if (w.note) note.push(w.note);
    if (w.weak) note.unshift("약한 단어");
    return note.join(" / ");
  }
  function names(list) { return list.map(function (w) { return w.word; }); }

  // ---------------------------------------------------------------- regular 모드
  function makeRegular(data, mcqN, sources, seed) {
    var rng = new Rng(seed);
    var words = data.words;
    var warnings = [];
    var elig = words.filter(function (w) { return usable(w, sources).length > 0; });
    if (mcqN > elig.length) {
      warnings.push("보기 문항에 쓸 수 있는 단어가 " + elig.length + "개뿐이라 보기 문항을 " + elig.length + "개로 줄였습니다");
      mcqN = elig.length;
    }
    var pick = null;
    for (var t = 0; t < 3000; t++) {
      var cand = rng.sample(elig, mcqN);
      if (hasConflict(cand)) continue;
      var group = new Set(names(cand));
      var ok = cand.every(function (w) {
        return usable(w, sources).some(function (x) { return !U.intersects(x.ambiguous || [], group); });
      });
      if (ok) { pick = cand; break; }
    }
    if (pick === null) {
      pick = rng.sample(elig, mcqN);
      warnings.push("헷갈리는 단어쌍을 완전히 피하지 못했습니다. 보기 문항을 직접 확인하세요");
    }
    var grp = new Set(names(pick));
    var mcq = [];
    pick.forEach(function (w) {
      var cands = usable(w, sources);
      var clean = cands.filter(function (x) { return !U.intersects(x.ambiguous || [], grp); });
      if (!clean.length) {
        warnings.push(w.word + " 의 문장이 모두 같은 보기의 다른 단어와 헷갈릴 수 있습니다");
        clean = cands;
      }
      mcq.push([w, rng.choice(clean)]);
    });
    rng.shuffle(mcq);
    var options = mcq.map(function (p) { return p[0]; });
    rng.shuffle(options);
    var written = words.filter(function (w) { return pick.indexOf(w) < 0; });
    var bookOrder = written.slice();
    for (var i = 0; i < 30; i++) {
      rng.shuffle(written);
      if (written.length < 2 || !U.sameOrder(written, bookOrder)) break;
    }
    return { mode: "regular", seed: seed, written: written, mcq: mcq, options: options, warnings: warnings };
  }

  function validateRegular(data, s) {
    var errs = [];
    var used = names(s.written).concat(s.mcq.map(function (p) { return p[0].word; }));
    if (!U.sameMembers(used, names(data.words))) errs.push("모든 단어가 정확히 한 번씩 출제되지 않았습니다");
    if (!U.sameMembers(names(s.options), s.mcq.map(function (p) { return p[0].word; })))
      errs.push("보기와 보기 문항의 단어가 맞지 않습니다");
    s.mcq.forEach(function (p) {
      if (U.countBlank(p[1].text) !== 1) errs.push(p[0].word + " 문장의 빈칸이 1개가 아닙니다");
    });
    if (hasConflict(s.mcq.map(function (p) { return p[0]; }))) errs.push("헷갈리는 단어쌍이 같은 보기에 있습니다");
    var allowed = allowedSources(data);
    s.mcq.forEach(function (p) {
      if (!allowed.has(p[1].source))
        errs.push(p[0].word + " 문장의 출처(" + p[1].source + ")가 이 데이터에서 허용된 출처가 아닙니다");
    });
    return errs;
  }

  function doc(title, body, toolbar) {
    return '<!doctype html><html lang="ko"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      "<title>" + esc(title) + "</title><style>" + CSS + "</style></head><body>" + (toolbar || "") + body + "</body></html>";
  }

  function buildRegular(data, s, opt) {
    opt = opt || {};
    var lesson = data.lesson === undefined ? "" : data.lesson;
    var title = data.title || "";
    var nTotal = s.written.length + s.mcq.length;
    var per = data.points_per_question || 10;
    var total = per * nTotal;
    var rows = [];
    var no = 1;
    s.written.forEach(function (w) {
      rows.push('<tr class="w"><td class="no">' + no + '</td><td class="q">' + esc(w.en) + '</td><td class="a"></td></tr>');
      no++;
    });
    var optsHtml = s.options.map(function (w, i) { return "<span>" + CIRCLED[i] + " " + esc(w.word) + "</span>"; }).join("");
    s.mcq.forEach(function (p) {
      rows.push('<tr class="m"><td class="no">' + no + '</td><td class="q">' + blankify(p[1].text) +
        '</td><td class="a"><div class="opts">' + optsHtml + "</div></td></tr>");
      no++;
    });
    var left = opt.classCode ? esc(opt.classCode) : (data.class_code ? esc(data.class_code) : "&nbsp;");
    var page1 = '<div class="page"><div class="top"><div>' + left + '</div><div class="name">Name : <span class="line"></span></div></div>' +
      '<hr class="rule"><h1 class="title">Lesson ' + esc(lesson) + " &nbsp; " + esc(title) + "</h1>" +
      '<table class="t"><tr><th style="width:10mm"></th><th>Questions</th><th>Answers</th></tr>' + rows.join("") + "</table>" +
      '<div class="grade"><div class="h">Score</div><div class="b">/ ' + total + "</div></div>" +
      '<div class="foot">시험지 번호 ' + s.seed + " · " + esc(sheetNote(data)) + " · 다시 만들면 순서가 달라집니다</div></div>";

    var page2 = "";
    if (opt.showKey !== false) {
      var krows = [];
      no = 1;
      s.written.forEach(function (w) {
        krows.push("<tr><td>" + no + "</td><td><b>" + esc(w.word) + "</b></td><td>" + esc(w.ko || "") + "</td><td>" + esc(noteFor(w)) + "</td></tr>");
        no++;
      });
      s.mcq.forEach(function (p) {
        var w = p[0], sent = p[1];
        var letter = CIRCLED[s.options.indexOf(w)];
        krows.push("<tr><td>" + no + "</td><td><b>" + letter + " " + esc(w.word) + "</b></td><td>" + esc(w.ko || "") + "<br>" +
          filled(sent.text, w.word) + srcTag(sent) + koHtml(sent) + "</td><td>" + esc(noteFor(w)) + "</td></tr>");
        no++;
      });
      var weak = data.words.filter(function (w) { return w.weak; }).map(function (w) { return w.word; });
      var weakTxt = weak.length ? weak.join(", ") : "없음";
      page2 = '<div class="page"><h2 class="key">Answer Key (부모용 · 인쇄할 때 빼기)</h2>' +
        '<table class="k"><tr><th style="width:8mm">No.</th><th style="width:34mm">정답</th><th>한글 뜻 · 문장</th><th style="width:48mm">주의</th></tr>' + krows.join("") + "</table>" +
        '<div class="box"><b>채점 규칙 (집 채점은 항상 0점 방식)</b><ul>' +
        "<li>문항당 " + per + "점, 합계 " + total + "점입니다.</li>" +
        "<li>쓰기 문항은 철자 한 글자, 대소문자, -ed·-s 빠뜨림 중 어느 것이든 틀리면 0점입니다. 반점은 없습니다.</li>" +
        "<li>번호 문항은 번호가 맞으면 " + per + "점, 틀리면 0점입니다.</li>" +
        "<li>보기 번호 문항은 철자를 확인하지 못합니다. 모든 단어의 철자를 확인하려면 전체 쓰기 연습 시험지를 쓰세요.</li>" +
        "<li>틀린 단어는 약한 단어에 추가해서 다음 시험에 다시 냅니다.</li></ul></div>" +
        '<div class="box"><b>약한 단어</b>: ' + esc(weakTxt) + "</div>" +
        '<div class="foot">시험지 번호 ' + s.seed + "</div></div>";
    }
    return doc("Lesson " + lesson + " 단어 시험지", page1 + page2, opt.toolbar);
  }

  // ---------------------------------------------------------------- all-write 모드
  function makeAllWrite(data, sources, seed) {
    var rng = new Rng(seed);
    var words = data.words;
    var warnings = [];
    var bookOrder = words.slice();
    var aOrder = words.slice();
    for (var i = 0; i < 30; i++) {
      rng.shuffle(aOrder);
      if (aOrder.length < 2 || !U.sameOrder(aOrder, bookOrder)) break;
    }
    var allWords = new Set(names(words));
    var bItems = [];
    words.forEach(function (w) {
      var cands = usable(w, sources);
      if (!cands.length) {
        warnings.push(w.word + " 는 문장이 없어 Part B 에서 뺐습니다");
        return;
      }
      var clean = cands.filter(function (x) { return !U.intersects(x.ambiguous || [], allWords); });
      if (!clean.length) {
        warnings.push(w.word + " 는 쓸 수 있는 문장이 모두 다른 단어와 헷갈릴 수 있어 Part B 에서 뺐습니다(Part A 에서 확인)");
        return;
      }
      bItems.push([w, rng.choice(clean)]);
    });
    var aNames = names(aOrder);
    for (var k = 0; k < 30; k++) {
      rng.shuffle(bItems);
      if (bItems.length < 2 || !U.sameOrder(bItems.map(function (p) { return p[0].word; }), aNames)) break;
    }
    var bank = bItems.map(function (p) { return p[0]; });
    rng.shuffle(bank);
    return { mode: "all-write", seed: seed, a: aOrder, b: bItems, bank: bank, warnings: warnings };
  }

  function validateAllWrite(data, s, parts) {
    var errs = [];
    var nm = names(data.words);
    if (parts.has("A") && !U.sameMembers(names(s.a), nm)) errs.push("Part A 에 모든 단어가 한 번씩 나오지 않았습니다");
    if (parts.has("B")) {
      var bNames = s.b.map(function (p) { return p[0].word; });
      if (new Set(bNames).size !== bNames.length) errs.push("Part B 에 같은 단어가 두 번 나왔습니다");
      if (bNames.some(function (x) { return nm.indexOf(x) < 0; })) errs.push("Part B 에 단원에 없는 단어가 있습니다");
      if (!bNames.length) errs.push("Part B 에 쓸 수 있는 문장이 없습니다");
      var texts = s.b.map(function (p) { return p[1].text; });
      if (new Set(texts).size !== texts.length) errs.push("Part B 에 같은 문장이 두 번 나왔습니다");
      s.b.forEach(function (p) {
        if (U.countBlank(p[1].text) !== 1) errs.push(p[0].word + " 문장의 빈칸이 1개가 아닙니다");
      });
      if (!U.sameMembers(names(s.bank), bNames)) errs.push("보기 박스와 Part B 의 단어가 맞지 않습니다");
      var allowed = allowedSources(data);
      s.b.forEach(function (p) {
        if (!allowed.has(p[1].source))
          errs.push(p[0].word + " 문장의 출처(" + p[1].source + ")가 이 데이터에서 허용된 출처가 아닙니다");
      });
    }
    return errs;
  }

  function buildAllWrite(data, s, opt) {
    opt = opt || {};
    var parts = opt.parts || new Set(["A", "B"]);
    var lesson = data.lesson === undefined ? "" : data.lesson;
    var title = data.title || "";
    var nA = parts.has("A") ? s.a.length : 0;
    var nB = parts.has("B") ? s.b.length : 0;
    var per = data.points_per_question_write || 5;
    var totalPts = per * (nA + nB);
    var left = opt.classCode ? esc(opt.classCode) : (data.class_code ? esc(data.class_code) : "&nbsp;");
    var head = '<div class="top"><div>' + left + '</div><div class="name">Name : <span class="line"></span></div></div>' +
      '<hr class="rule"><h1 class="title">Lesson ' + esc(lesson) + " &nbsp; " + esc(title) + " &nbsp;<small>(전체 쓰기 연습)</small></h1>";
    var smallHead = '<div class="top"><div>Lesson ' + esc(lesson) + '</div><div class="name">Name : <span class="line"></span></div></div><hr class="rule">';
    var score = '<div class="grade"><div class="h">Score</div><div class="b">/ ' + totalPts + "</div></div>";
    var foot = '<div class="foot">시험지 번호 ' + s.seed + " · " + esc(sheetNote(data)) + " · 모든 단어를 직접 써서 철자를 확인합니다 · 다시 만들면 순서가 달라집니다</div>";
    var pages = [];
    var no = 1;
    var rows;
    if (nA) {
      rows = [];
      s.a.forEach(function (w) {
        rows.push('<tr class="w"><td class="no">' + no + '</td><td class="q" style="text-align:left">' + esc(w.en) +
          '</td><td class="a"></td><td class="pt">/' + per + "</td></tr>");
        no++;
      });
      pages.push('<div class="page">' + head + '<h3 class="part">Part A. Read the meaning and write the word.</h3>' +
        '<table class="t t3"><tr><th style="width:10mm">No.</th><th>Meaning</th><th style="width:62mm">Word</th><th style="width:16mm">Points</th></tr>' +
        rows.join("") + "</table>" + (nB ? "" : score) + foot + "</div>");
    }
    if (nB) {
      rows = [];
      s.b.forEach(function (p) {
        rows.push('<tr class="m"><td class="no">' + no + '</td><td class="q" style="text-align:left">' + blankify(p[1].text) +
          '</td><td class="a"></td><td class="pt">/' + per + "</td></tr>");
        no++;
      });
      var bank = s.bank.map(function (w) { return esc(w.word); }).join(" &nbsp;·&nbsp; ");
      pages.push('<div class="page">' + (nA ? smallHead : head) + '<h3 class="part">Part B. Use the words below to complete the sentences.</h3>' +
        '<div class="bankline">' + bank + "</div>" +
        '<table class="t t3"><tr><th style="width:10mm">No.</th><th>Sentence</th><th style="width:50mm">Answer</th><th style="width:16mm">Points</th></tr>' +
        rows.join("") + "</table>" + score + foot + "</div>");
    }
    var key = "";
    if (opt.showKey !== false) {
      var aCells = "";
      if (nA) {
        aCells = s.a.map(function (w, i) {
          return '<span style="display:inline-block;width:46mm;margin:0.5mm 0">' + (i + 1) + ". <b>" + esc(w.word) + "</b></span>";
        }).join("");
        aCells = '<h3 class="part">Part A 정답</h3><div class="box" style="margin-top:0">' + aCells + "</div>";
      }
      var bTable = "";
      if (nB) {
        var brows = s.b.map(function (p, i) {
          var w = p[0], x = p[1];
          return "<tr><td>" + (nA + i + 1) + "</td><td><b>" + esc(w.word) + "</b></td><td>" + filled(x.text, w.word) + srcTag(x) + koHtml(x) +
            "</td><td>" + esc(w.ko || "") + "</td></tr>";
        });
        bTable = '<h3 class="part">Part B 정답</h3><table class="k tight" style="font-size:8.5pt"><tr><th style="width:10mm">No.</th><th style="width:28mm">정답</th><th>문장</th><th style="width:28mm">뜻</th></tr>' +
          brows.join("") + "</table>";
      }
      var notes = [];
      data.words.forEach(function (w) {
        var n = noteFor(w);
        if (n) notes.push("<li><b>" + esc(w.word) + "</b> (" + esc(w.ko || "") + "): " + esc(n) + "</li>");
      });
      var notesHtml = notes.length ? '<div class="box" style="font-size:8.5pt;margin:2mm 0"><b>단어별 주의</b><ul>' + notes.join("") + "</ul></div>" : "";
      key = '<div class="page"><h2 class="key">Answer Key (부모용 · 인쇄할 때 빼기)</h2>' + aCells + bTable + notesHtml +
        '<div class="box" style="font-size:8.5pt;margin:2mm 0"><b>채점 규칙 (집 채점은 항상 0점 방식)</b><ul>' +
        "<li>문항당 " + per + "점, 합계 " + totalPts + "점입니다 (Part A " + nA + "문항 + Part B " + nB + "문항).</li>" +
        "<li>철자 한 글자, 대소문자, -ed·-s 빠뜨림 중 어느 것이든 틀리면 0점입니다. 반점은 없습니다.</li>" +
        "<li>틀린 단어는 표시해 두었다가 다시 쓰기 연습을 하고, 다음 시험에 다시 냅니다.</li></ul></div>" +
        '<div class="foot">시험지 번호 ' + s.seed + "</div></div>";
    }
    return doc("Lesson " + lesson + " 전체 쓰기 연습", pages.join("") + key, opt.toolbar);
  }

  // ---------------------------------------------------------------- 확인 표
  function checkTable(data) {
    var allowed = allowedSources(data);
    var noPrac = [], noRef = 0, noKo = 0, outside = 0;
    var rows = data.words.map(function (w) {
      var sents = w.sentences || [];
      var ok = sents.filter(function (x) { return allowed.has(x.source) && U.countBlank(x.text) === 1; });
      outside += sents.filter(function (x) { return !allowed.has(x.source); }).length;
      var prac = sents.filter(function (x) { return x.source === "practice"; });
      if (!prac.length) noPrac.push(w.word);
      noRef += prac.filter(function (x) { return !x.ref; }).length;
      if (data.require_sentence_ko) noKo += ok.filter(function (x) { return !x.ko; }).length;
      return { no: w.no, word: w.word, pos: w.pos || "", ko: w.ko || "", page: w.page, en: w.en,
        practice: prac.map(function (x) { return { ref: x.ref, text: x.text }; }) };
    });
    return {
      title: (data.book || "") + " Lesson " + (data.lesson === undefined ? "" : data.lesson) + " " + (data.title || ""),
      owner: data.owner, sources: data.sentence_sources, requireKo: data.require_sentence_ko, verified: !!data.verified,
      rows: rows, noPractice: noPrac, outside: outside, noRef: noRef, noKo: noKo
    };
  }

  // ---------------------------------------------------------------- 자체 점검
  function selftest(data, n, mcqN, sources, mode, parts) {
    var bad = 0, warn = 0;
    for (var seed = 1; seed <= n; seed++) {
      var s, errs;
      if (mode === "all-write") { s = makeAllWrite(data, sources, seed); errs = validateAllWrite(data, s, parts); }
      else { s = makeRegular(data, mcqN, sources, seed); errs = validateRegular(data, s); }
      if (s.warnings.length) warn++;
      if (errs.length) bad++;
    }
    return { n: n, bad: bad, warn: warn };
  }

  function defaultMcq(data) {
    var n = data.words.length;
    return n >= 8 ? 4 : Math.max(1, Math.floor(n / 3));
  }
  function onlyWeak(data) {
    var weak = data.words.filter(function (w) { return w.weak; });
    if (!weak.length) throw new Error("약한 단어(weak: true)가 없습니다. 먼저 틀린 단어를 표시하세요");
    var d = Object.assign({}, data);
    d.words = weak;
    return d;
  }

  WT.word = {
    CSS: CSS, load: load, allowedSources: allowedSources, makeRegular: makeRegular, validateRegular: validateRegular,
    buildRegular: buildRegular, makeAllWrite: makeAllWrite, validateAllWrite: validateAllWrite, buildAllWrite: buildAllWrite,
    checkTable: checkTable, selftest: selftest, defaultMcq: defaultMcq, onlyWeak: onlyWeak, sheetNote: sheetNote,
    missingKo: missingKo
  };
})(typeof window !== "undefined" ? window : globalThis);
