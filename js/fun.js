/* 꾸미기와 재미 요소: 테마(아이마다 고름), 진행 표시, 색종이, 효과음, 스티커 모으기.
 * - 테마·스티커·효과음 설정은 기기 설정(wp.settings.v1)의 theme, stickers, sound 에 저장한다. 그래서 백업에 함께 들어간다.
 * - 아이 코드: "A", "B", 연결하지 않은 기기의 공용 "_".
 * - 인쇄 시험지(iframe)는 꾸미지 않는다. 화면에만 적용한다.
 */
(function (root) {
  "use strict";
  var WT = (root.WT = root.WT || {});
  var doc = root.document;

  var THEMES = {
    basic: { label: "기본", icon: "", color: "#1d4ed8", stickers: ["⭐", "🌈", "🍀", "🎈", "🐶", "🐱", "🍎", "🚀", "🎵", "🌻", "🐳", "🍦"] },
    pastel: { label: "파스텔 다이어리", icon: "🌷", color: "#a689f0", stickers: ["🐰", "🌷", "🍓", "⭐", "🧸", "🌸", "🎀", "🍰", "🦋", "🌈", "🍑", "🐣"] },
    berry: { label: "딸기 우유", icon: "🍓", color: "#ff5c8a", stickers: ["💖", "🍓", "🧁", "🎀", "🍭", "🍒", "🐱", "🌸", "🍩", "💗", "🦄", "🍬"] },
    star: { label: "별빛 마법", icon: "✨", color: "#7c5cff", stickers: ["⭐", "🌙", "🦄", "💜", "🔮", "🌟", "🪐", "🧚", "🌠", "💫", "🌈", "🐬"] }
  };
  var ORDER = ["basic", "pastel", "berry", "star"];
  var MAX_STICKERS = 999;

  function settings() { return WT.store.settings(); }
  function save(s) { WT.store.saveSettings(s); }

  // ---------------------------------------------------------------- 아이 코드
  function codeOfOwner(owner) {
    if (owner === "아이 A") return "A";
    if (owner === "아이 B") return "B";
    return null;
  }
  // 지금 보는 아이: 연결된 기기면 그 아이, 아니면 공용
  function currentCode() {
    var c = WT.store.getConnection && WT.store.getConnection();
    return c && c.child ? c.child : "_";
  }

  // ---------------------------------------------------------------- 테마
  function themeOf(code) {
    var t = settings().theme || {};
    var name = t[code] || t._ || "basic";
    return THEMES[name] ? name : "basic";
  }
  function setTheme(code, name) {
    if (!THEMES[name]) return;
    var s = settings();
    s.theme = Object.assign({}, s.theme || {});
    s.theme[code] = name;
    save(s);
  }
  var shown = null;
  function apply(code) {
    var name = themeOf(code || currentCode());
    shown = name;
    var html = doc.documentElement;
    if (name === "basic") html.removeAttribute("data-theme"); else html.setAttribute("data-theme", name);
    var meta = doc.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", THEMES[name].color);
    return name;
  }
  // 외우기·풀기 화면을 열 때는 그 단원 주인의 테마로, 닫으면 지금 보는 아이의 테마로 돌아간다.
  function enter(owner) { apply(codeOfOwner(owner) || currentCode()); }
  function leave() { apply(currentCode()); }

  // ---------------------------------------------------------------- 진행 표시
  // 테마에 맞는 진행 표시를 node 안에 그린다. 하트·별은 최대 10개로 나눠 보여 준다.
  function progress(node, done, total) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
    if (!total) { node.hidden = true; return; }
    node.hidden = false;
    var name = shown || themeOf(currentCode());
    var ratio = Math.max(0, Math.min(1, done / total));
    if (name === "berry" || name === "star") {
      var n = Math.min(10, total);
      var on = Math.round(ratio * n);
      var mark = name === "berry" ? "♥" : "★";
      for (var i = 0; i < n; i++) {
        var sp = doc.createElement("span");
        sp.className = "pmark" + (i < on ? " on" : "");
        sp.textContent = mark;
        node.appendChild(sp);
      }
    } else {
      var bar = doc.createElement("span");
      bar.className = "pbar";
      var fill = doc.createElement("i");
      fill.style.width = Math.round(ratio * 100) + "%";
      bar.appendChild(fill);
      node.appendChild(bar);
    }
    node.setAttribute("aria-label", "진행 " + done + " / " + total);
  }

  // ---------------------------------------------------------------- 색종이
  function reduced() {
    try { return root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; }
  }
  var COLORS = {
    basic: ["#1d4ed8", "#f59e0b", "#10b981", "#ef4444"],
    pastel: ["#ffb7ce", "#a689f0", "#a0e2c8", "#ffd7b0"],
    berry: ["#ff5c8a", "#ffb86b", "#b79cff", "#7ad3ff"],
    star: ["#7c5cff", "#5aa9ff", "#ffc93c", "#ff8fd8"]
  };
  // size: small(맞혔을 때), big(다 했을 때)
  function confetti(size) {
    if (!doc.body || reduced()) return;
    var n = size === "big" ? 70 : 22;
    var colors = COLORS[shown || "basic"] || COLORS.basic;
    var box = doc.createElement("div");
    box.className = "confetti";
    box.setAttribute("aria-hidden", "true");
    for (var i = 0; i < n; i++) {
      var p = doc.createElement("i");
      var x = size === "big" ? Math.random() * 100 : 30 + Math.random() * 40;
      p.style.left = x + "%";
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = (Math.random() * (size === "big" ? 0.5 : 0.15)) + "s";
      p.style.animationDuration = (1.1 + Math.random() * 0.9) + "s";
      p.style.setProperty("--dx", Math.round((Math.random() - 0.5) * 160) + "px");
      p.style.setProperty("--rot", Math.round(360 + Math.random() * 540) + "deg");
      if (i % 3 === 0) p.style.borderRadius = "50%";
      box.appendChild(p);
    }
    doc.body.appendChild(box);
    setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 2800);
  }

  // ---------------------------------------------------------------- 효과음(Web Audio, 파일 없음)
  var ctx = null;
  function soundOn() { return settings().sound !== false; }
  function setSound(on) { var s = settings(); s.sound = !!on; save(s); }
  function audio() {
    if (ctx) return ctx;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { ctx = null; }
    return ctx;
  }
  function tone(ac, freq, start, dur, type, vol) {
    var o = ac.createOscillator(), g = ac.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, ac.currentTime + start);
    g.gain.setValueAtTime(0.0001, ac.currentTime + start);
    g.gain.exponentialRampToValueAtTime(vol || 0.18, ac.currentTime + start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + start + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(ac.currentTime + start);
    o.stop(ac.currentTime + start + dur + 0.05);
  }
  var SOUNDS = {
    ok: [[784, 0, 0.12], [1047, 0.09, 0.22]],                         // 솔 → 도(높은)
    no: [[330, 0, 0.18, "triangle", 0.12], [262, 0.12, 0.26, "triangle", 0.1]],
    done: [[523, 0, 0.14], [659, 0.1, 0.14], [784, 0.2, 0.14], [1047, 0.3, 0.35]],
    sticker: [[1319, 0, 0.1], [1568, 0.07, 0.1], [2093, 0.14, 0.25]],
    tap: [[660, 0, 0.06, "sine", 0.08]]
  };
  var played = []; // 점검용: 낸 소리 이름
  function sound(name) {
    if (!soundOn() || !SOUNDS[name]) return false;
    played.push(name);
    var ac = audio();
    if (!ac) return false;
    try {
      if (ac.state === "suspended" && ac.resume) ac.resume();
      SOUNDS[name].forEach(function (t) { tone(ac, t[0], t[1], t[2], t[3], t[4]); });
      return true;
    } catch (e) { return false; }
  }

  // ---------------------------------------------------------------- 스티커
  function stickers(code) {
    var all = settings().stickers || {};
    return Array.isArray(all[code]) ? all[code] : [];
  }
  // 외우기를 끝내거나 시험을 채점하면 스티커를 하나 받는다. 받은 스티커를 돌려준다.
  function award(owner, from) {
    var code = codeOfOwner(owner) || currentCode();
    var theme = themeOf(code);
    var set = THEMES[theme].stickers;
    var s = settings();
    s.stickers = Object.assign({}, s.stickers || {});
    var list = Array.isArray(s.stickers[code]) ? s.stickers[code].slice() : [];
    var got = { s: set[Math.floor(Math.random() * set.length)], at: new Date().toISOString(), from: String(from || "").slice(0, 60) };
    list.push(got);
    if (list.length > MAX_STICKERS) list = list.slice(list.length - MAX_STICKERS);
    s.stickers[code] = list;
    save(s);
    return got;
  }

  WT.fun = {
    THEMES: THEMES, ORDER: ORDER,
    codeOfOwner: codeOfOwner, currentCode: currentCode,
    themeOf: themeOf, setTheme: setTheme, apply: apply, enter: enter, leave: leave,
    progress: progress, confetti: confetti,
    sound: sound, soundOn: soundOn, setSound: setSound, _played: played,
    stickers: stickers, award: award
  };
})(typeof window !== "undefined" ? window : globalThis);
