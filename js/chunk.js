/* 금요일 chunk 시험지 생성 규칙.
 * 파이썬 스크립트(make_chunk_test.py)와 같은 규칙을 그대로 옮긴 것이다.
 *  Key Vocabulary(문항당 1점) + Chunk(문항당 2점) + Fill in the blanks(문항당 4점)
 *  sample: 범위의 일부만 출제(기본 6 + 3 + 2문항, 20점) / full: 범위 전체
 *  hint none: 단어마다 빈칸 / first: 단어마다 첫 글자 힌트
 */
(function (root) {
  "use strict";
  var WT = (root.WT = root.WT || {});
  var U = WT.util;
  var esc = U.esc, bold = U.bold, plain = U.plain, Rng = U.Rng;
  var KEEP_DEFAULT = new Set(["a", "an", "the", "in", "on", "at", "of", "to", "for", "with", "by", "from", "and", "or", "as"]);

  var CSS = [
    "@page{size:A4;margin:12mm}",
    "*{box-sizing:border-box}",
    'body{font-family:"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",Arial,sans-serif;font-size:9.5pt;color:#111;line-height:1.4;word-break:keep-all;margin:0;background:#fff}',
    ".toolbar{padding:8px 12px;background:#f1f5f9;border-bottom:1px solid #cbd5e1;font-size:10pt}",
    ".toolbar button{font-size:10pt;padding:4px 10px;margin-right:8px}",
    "@media print{.toolbar{display:none}}",
    ".page{width:186mm;margin:0 auto;padding:2mm 0;page-break-after:always}",
    ".page:last-child{page-break-after:auto}",
    ".top{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:1mm}",
    ".top .cls{font-size:11pt;font-weight:600}",
    ".top .name{font-weight:700}",
    ".line{display:inline-block;border-bottom:1px solid #111;min-width:50mm;height:1.2em;vertical-align:bottom}",
    "h1.title{font-size:14pt;text-align:center;margin:1mm 0 3mm;font-weight:700}",
    "table.t{width:100%;border-collapse:collapse;border:1.5px solid #111;table-layout:fixed;margin-bottom:0}",
    "table.t th,table.t td{border:1px solid #111;padding:1.1mm 2.5mm;vertical-align:middle}",
    "table.t th{background:#9ca3af;text-align:left;font-size:10pt}",
    "table.t th.pt{width:20mm;text-align:center}",
    "table.t tr{page-break-inside:avoid}",
    "td.sub{background:#fff;font-weight:700;font-size:10pt}",
    "td.p{width:20mm;text-align:right;color:#555}",
    "td.mean{width:62mm}",
    "td.bank{padding:1.5mm 2mm}",
    ".bank span{display:inline-block;border:1px solid #111;padding:0.5mm 2.5mm;margin:0.5mm 1mm}",
    ".blank{display:inline-block;border-bottom:1px solid #111;min-width:30mm;height:1em;vertical-align:baseline}",
    ".blank.long{min-width:92mm}",
    ".blank.s{min-width:20mm}",
    ".blank.w{min-width:16mm;margin:0 1mm}",
    ".hw{display:inline-block;margin:0 1mm}",
    ".kw{display:inline-block;margin:0 1mm}",
    ".ko{font-size:9pt;margin-top:0.5mm}",
    ".total{margin:3mm 0 0 auto;width:50mm;border:1.5px solid #111}",
    ".total .h{background:#e5e7eb;text-align:center;border-bottom:1px solid #111;padding:0.5mm}",
    ".total .b{height:9mm;display:flex;align-items:flex-end;justify-content:flex-end;padding:1mm 2mm;color:#555}",
    ".mark{font-size:8.5pt;margin-top:3mm}",
    ".foot{color:#777;font-size:8.5pt;margin-top:2mm}",
    "h2.key{font-size:13pt;margin:0 0 3mm}",
    "table.k{width:100%;border-collapse:collapse;font-size:9pt;margin-bottom:3mm}",
    "table.k th,table.k td{border:1px solid #888;padding:1mm 2mm;vertical-align:top}",
    "table.k th{background:#eef2f7;text-align:left}",
    ".box{border:1px solid #888;padding:2mm 3mm;margin:3mm 0;font-size:10pt;background:#fafafa}",
    ".box ul{margin:1mm 0 0 4mm;padding:0}"
  ].join("\n");

  // ---------------------------------------------------------------- 데이터 읽기
  function load(raw) {
    var data = JSON.parse(JSON.stringify(raw));
    if (data.kind !== "chunk") throw new Error("데이터의 kind 가 chunk 가 아닙니다");
    var missing = ["owner", "hint"].filter(function (k) { return !(k in data); });
    if (missing.length) {
      throw new Error("데이터에 필수 항목이 없습니다: " + missing.join(", ") +
        "\n  owner(누구 것인지)와 hint(Fill in 첫 글자 힌트: none 또는 first)는 사용자에게 확인해서 적으세요. 짐작해서 채우지 마세요.");
    }
    if (data.hint !== "none" && data.hint !== "first") throw new Error("hint 는 none 또는 first 여야 합니다");
    (data.chunks || []).forEach(function (c) {
      var m = /\{(.+?)\}/.exec(c.sentence);
      if (!m) throw new Error("chunk 문장에 {…} 표시가 없습니다: " + c.sentence);
      c._before = c.sentence.slice(0, m.index);
      c._phrase = m[1];
      c._after = c.sentence.slice(m.index + m[0].length);
    });
    (data.vocab || []).forEach(function (v) {
      v._answers = [];
      if (v.colloc) {
        var re = /\{(.+?)\}/g, mm;
        while ((mm = re.exec(v.colloc)) !== null) v._answers.push(mm[1]);
      }
    });
    if (!(data.vocab || []).length && !(data.chunks || []).length) throw new Error("vocab 과 chunks 가 모두 비어 있습니다");
    return data;
  }

  function sheetNote(data) {
    var note = "대상 " + data.owner;
    if (!data.verified) note += " · ※ 교재 대조 전 데이터";
    return note;
  }

  // ---------------------------------------------------------------- 출제
  function pickSpread(items, n, rng) {
    n = Math.min(n, items.length);
    var by = new Map();
    items.forEach(function (it) {
      if (!by.has(it.lesson)) by.set(it.lesson, []);
      by.get(it.lesson).push(it);
    });
    var weakFirst = function (a, b) { return (a.weak ? 0 : 1) - (b.weak ? 0 : 1); };
    by.forEach(function (list) { rng.shuffle(list); list.sort(weakFirst); });
    var keys = Array.from(by.keys());
    rng.shuffle(keys);
    var quota = new Map();
    keys.forEach(function (k) { quota.set(k, 0); });
    for (var i = 0; i < n; i++) {
      var k = keys[i % keys.length];
      quota.set(k, quota.get(k) + 1);
    }
    var picked = [], left = [];
    keys.forEach(function (k) {
      picked = picked.concat(by.get(k).slice(0, quota.get(k)));
      left = left.concat(by.get(k).slice(quota.get(k)));
    });
    if (picked.length < n) {
      rng.shuffle(left);
      left.sort(weakFirst);
      picked = picked.concat(left.slice(0, n - picked.length));
    }
    return picked;
  }

  function makeSet(data, mode, vocabN, chunkN, fillN, distractors, seed) {
    var rng = new Rng(seed);
    var vocabPool = (data.vocab || []).filter(function (v) { return v.colloc && v._answers.length; });
    var chunks = data.chunks || [];
    var skipped = (data.vocab || []).filter(function (v) { return !(v.colloc && v._answers.length); }).map(function (v) { return v.word; });
    var vocab, chunkItems, fillItems, bank;
    if (mode === "full") {
      vocab = vocabPool.slice();
      rng.shuffle(vocab);
      chunkItems = chunks.slice();
      rng.shuffle(chunkItems);
      fillItems = chunks.slice();
      for (var i = 0; i < 30; i++) {
        rng.shuffle(fillItems);
        if (fillItems.length < 2 || !U.sameOrder(fillItems, chunkItems)) break;
      }
      bank = chunkItems.map(function (c) { return c._phrase; });
      rng.shuffle(bank);
    } else {
      vocab = pickSpread(vocabPool, vocabN, rng);
      rng.shuffle(vocab);
      var pool = pickSpread(chunks, chunkN + fillN, rng);
      rng.shuffle(pool);
      chunkItems = pool.slice(0, chunkN);
      fillItems = pool.slice(chunkN, chunkN + fillN);
      var rest = chunks.filter(function (c) { return pool.indexOf(c) < 0; });
      rng.shuffle(rest);
      var extra = rest.slice(0, distractors).map(function (c) { return c._phrase; });
      bank = chunkItems.map(function (c) { return c._phrase; }).concat(extra);
      rng.shuffle(bank);
    }
    return { seed: seed, vocab: vocab, chunk: chunkItems, fill: fillItems, bank: bank, skipped: skipped, mode: mode };
  }

  function validate(data, s) {
    var errs = [];
    if (new Set(s.vocab.map(function (v) { return v.word; })).size !== s.vocab.length) errs.push("Key Vocabulary 에 같은 단어가 두 번 나왔습니다");
    if (new Set(s.chunk.map(function (c) { return c.sentence; })).size !== s.chunk.length) errs.push("Chunk 에 같은 문장이 두 번 나왔습니다");
    if (s.mode === "sample") {
      var a = new Set(s.chunk.map(function (c) { return c.sentence; }));
      if (s.fill.some(function (c) { return a.has(c.sentence); })) errs.push("Chunk 와 Fill in 에 같은 문장이 있습니다");
    }
    s.chunk.forEach(function (c) {
      var cnt = s.bank.filter(function (b) { return b === c._phrase; }).length;
      if (cnt !== 1) errs.push("Chunk 보기에 정답 " + c._phrase + " 가 한 번만 있어야 합니다");
    });
    if (new Set(s.bank).size !== s.bank.length) errs.push("Chunk 보기에 같은 항목이 있습니다");
    return errs;
  }

  // ---------------------------------------------------------------- 시험지 만들기
  function vocabRow(no, v, pts) {
    var colloc = esc(v.colloc).replace(/\{(.+?)\}/g, '<span class="blank"></span>');
    return "<tr><td>" + no + ". " + colloc + '</td><td class="mean">' + bold(v.ko || "") + '</td><td class="p">/' + pts[0] + "</td></tr>";
  }

  function fillBlanks(c, hint, keep) {
    var parts = [];
    c._phrase.split(/\s+/).filter(Boolean).forEach(function (t) {
      var core = t.replace(/^[.,!?;:]+|[.,!?;:]+$/g, "");
      if (hint === "first") {
        if (keep.has(core.toLowerCase())) parts.push('<span class="kw">' + esc(t) + "</span>");
        else parts.push('<span class="hw">' + esc(core.charAt(0)) + '<span class="blank s"></span></span>');
      } else {
        parts.push('<span class="blank w"></span>');
      }
    });
    return esc(c._before) + parts.join(" ") + esc(c._after);
  }

  function build(data, s, opt) {
    opt = opt || {};
    var pts = opt.pts || [1, 2, 4];
    var hint = opt.hint || data.hint || "none";
    var keep = opt.keep || KEEP_DEFAULT;
    var title = data.title || "Chunk Quiz";
    var nV = s.vocab.length, nC = s.chunk.length, nF = s.fill.length;
    var total = nV * pts[0] + nC * pts[1] + nF * pts[2];
    var no = 1;
    var rows = [];
    rows.push('<table class="t"><tr><th colspan="2">Key Vocabulary</th><th class="pt">Points</th></tr>' +
      '<tr><td colspan="3" class="sub">Complete the collocation using right vocabulary.</td></tr>' +
      '<tr><th style="font-weight:400;background:#d1d5db;text-align:center">Collocation</th>' +
      '<th style="font-weight:400;background:#d1d5db;text-align:center">Meaning</th><th class="pt"></th></tr>');
    s.vocab.forEach(function (v) { rows.push(vocabRow(no, v, pts)); no++; });
    rows.push("</table>");

    rows.push('<table class="t" style="border-top:0"><tr><th class="pt" style="text-align:left;width:auto">Chunk</th><th class="pt">Points</th></tr>' +
      '<tr><td colspan="2" class="sub">Complete the sentence using right chunk.</td></tr>' +
      '<tr><td colspan="2" class="bank">' + s.bank.map(function (b) { return "<span>" + esc(b) + "</span>"; }).join("") + "</td></tr>");
    s.chunk.forEach(function (c) {
      var blanks, afterHtml;
      if (c._phrase.length <= 26) {
        blanks = c._after.trim().length <= 2
          ? '<span style="white-space:nowrap"><span class="blank long"></span>' + esc(c._after) + "</span>"
          : '<span class="blank long"></span>' + esc(c._after);
        afterHtml = "";
      } else {
        blanks = '<span class="blank long"></span><br><span class="blank long"></span>';
        afterHtml = esc(c._after);
      }
      rows.push("<tr><td>" + no + ". " + esc(c._before) + blanks + afterHtml + '<div class="ko">' + bold(c.ko || "") + '</div></td><td class="p">/' + pts[1] + "</td></tr>");
      no++;
    });
    rows.push("</table>");

    rows.push('<table class="t" style="border-top:0"><tr><th style="width:auto">Fill in the blanks.</th><th class="pt">Points</th></tr>');
    s.fill.forEach(function (c) {
      rows.push("<tr><td>" + no + ". " + fillBlanks(c, hint, keep) + '<div class="ko">' + bold(c.ko || "") + '</div></td><td class="p">/' + pts[2] + "</td></tr>");
      no++;
    });
    rows.push("</table>");

    var left = opt.classCode ? esc(opt.classCode) : esc(data.class_code || "");
    var page1 = '<div class="page"><div class="top"><div class="cls">' + left + '</div><div class="name">Name: <span class="line"></span></div></div>' +
      '<h1 class="title">' + esc(title) + "</h1>" + rows.join("") +
      '<div class="total"><div class="h">Total</div><div class="b">/ ' + total + "</div></div>" +
      '<div class="mark"><b>Marking</b> · Possible errors: Spelling error, capitalization error, missing word, added word, different word</div>' +
      '<div class="foot">시험지 번호 ' + s.seed + " · " + (s.mode === "full" ? "범위 전체 연습" : "출제 범위의 일부") + " · " + esc(sheetNote(data)) + " · 다시 만들면 순서가 달라집니다</div></div>";

    var page2 = "";
    if (opt.showKey !== false) {
      var k = [];
      k.push('<table class="k"><tr><th colspan="3">Key Vocabulary (문항당 ' + pts[0] + '점)</th></tr><tr><th style="width:8mm">No.</th><th style="width:60mm">정답</th><th>콜로케이션 · 한글 뜻</th></tr>');
      no = 1;
      s.vocab.forEach(function (v) {
        var full = esc(v.colloc).replace(/\{(.+?)\}/g, "<b>$1</b>");
        k.push("<tr><td>" + no + "</td><td><b>" + esc(v._answers.join(" / ")) + "</b></td><td>" + full + "<br>" + esc(plain(v.ko || "")) + "</td></tr>");
        no++;
      });
      k.push("</table>");
      k.push('<table class="k"><tr><th colspan="3">Chunk (문항당 ' + pts[1] + '점)</th></tr><tr><th style="width:8mm">No.</th><th style="width:60mm">정답</th><th>문장 · 한글 해석</th></tr>');
      s.chunk.forEach(function (c) {
        k.push("<tr><td>" + no + "</td><td><b>" + esc(c._phrase) + "</b></td><td>" + esc(c._before) + "<b>" + esc(c._phrase) + "</b>" + esc(c._after) + "<br>" + esc(plain(c.ko || "")) + "</td></tr>");
        no++;
      });
      k.push("</table>");
      k.push('<table class="k"><tr><th colspan="3">Fill in the blanks (문항당 ' + pts[2] + '점)</th></tr><tr><th style="width:8mm">No.</th><th style="width:60mm">정답</th><th>문장 · 한글 해석</th></tr>');
      s.fill.forEach(function (c) {
        k.push("<tr><td>" + no + "</td><td><b>" + esc(c._phrase) + "</b></td><td>" + esc(c._before) + "<b>" + esc(c._phrase) + "</b>" + esc(c._after) + "<br>" + esc(plain(c.ko || "")) + "</td></tr>");
        no++;
      });
      k.push("</table>");
      var weak = (data.vocab || []).filter(function (v) { return v.weak; }).map(function (v) { return v.word; })
        .concat((data.chunks || []).filter(function (c) { return c.weak; }).map(function (c) { return c._phrase; }));
      var skipped = s.skipped.length ? s.skipped.join(", ") : "없음";
      page2 = '<div class="page"><h2 class="key">Answer Key (부모용 · 인쇄할 때 빼기)</h2>' + k.join("") +
        '<div class="box"><b>채점 규칙 (집 채점은 문항 단위 0점)</b><ul>' +
        "<li>문항 안에서 하나라도 틀리면 그 문항은 0점이고, 반점은 없습니다. 틀린 칸과 이유를 표시합니다.</li>" +
        "<li>틀린 이유는 시험지 아래의 5가지로 적습니다: Spelling error, capitalization error, missing word, added word, different word.</li>" +
        "<li>철자 한 글자, 대소문자, -ed·-s 빠뜨림도 모두 틀린 것입니다.</li>" +
        "<li>틀린 단어와 chunk 는 약한 목록에 추가해서 다음 시험에 먼저 냅니다.</li></ul></div>" +
        '<div class="box"><b>약한 목록</b>: ' + esc(weak.length ? weak.join(", ") : "없음") + "<br><b>콜로케이션이 없어 Key Vocabulary 에서 뺀 단어</b>: " + esc(skipped) + "</div>" +
        '<div class="foot">시험지 번호 ' + s.seed + "</div></div>";
    }
    return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      "<title>" + esc(title) + "</title><style>" + CSS + "</style></head><body>" + (opt.toolbar || "") + page1 + page2 + "</body></html>";
  }

  // ---------------------------------------------------------------- 확인 표
  function checkTable(data) {
    var vocab = data.vocab || [];
    return {
      title: data.title || "", owner: data.owner, hint: data.hint, verified: !!data.verified,
      vocab: vocab.map(function (v) { return { lesson: v.lesson, word: v.word, colloc: v.colloc || null, ko: plain(v.ko || "") }; }),
      chunks: (data.chunks || []).map(function (c) { return { lesson: c.lesson, sentence: c.sentence }; }),
      noColloc: vocab.filter(function (v) { return !v.colloc; }).map(function (v) { return v.word; })
    };
  }

  function selftest(data, n, opt) {
    opt = opt || {};
    var bad = 0;
    for (var seed = 1; seed <= n; seed++) {
      var s = makeSet(data, opt.mode || "sample", opt.vocabN || 6, opt.chunkN || 3, opt.fillN || 2, opt.distractors === undefined ? 1 : opt.distractors, seed);
      if (validate(data, s).length) bad++;
    }
    return { n: n, bad: bad };
  }

  WT.chunk = {
    CSS: CSS, KEEP_DEFAULT: KEEP_DEFAULT, load: load, makeSet: makeSet, validate: validate, build: build,
    checkTable: checkTable, selftest: selftest, sheetNote: sheetNote
  };
})(typeof window !== "undefined" ? window : globalThis);
