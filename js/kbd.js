/* 앱 안 영어 자판: 시험·외우기 입력칸에서 기기 키보드 대신 쓴다.
 * - 기기 키보드(특히 삼성 키보드)는 웹페이지의 자동 완성 끄기 설정을 무시하고 단어 추천을 띄워 철자가 보이므로,
 *   입력칸에 inputmode="none" 을 주어 기기 키보드를 띄우지 않고 이 자판으로 입력한다. 추천 줄은 없다.
 * - 대문자 키(⇧)는 한 글자만 대문자로 쓰고 돌아온다. 자동 대문자는 없다.
 * - 적용 대상: #solve(태블릿 시험), #study(외우기) 안의 input.ans. 설정의 「키보드 확인」 칸은 기기 키보드 그대로.
 * - 설정 settings.appKeyboard 가 false 면 쓰지 않는다(기본은 켬). PC 의 실제 키보드 입력은 그대로 된다.
 * - S펜으로 입력칸을 누르면 앱 자판을 띄우지 않고 기기의 S펜 텍스트 입력을 쓴다(손가락은 앱 자판).
 */
(function (root) {
  "use strict";
  var WT = (root.WT = root.WT || {});
  var doc = root.document;

  var ROWS = [
    ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
    ["shift", "z", "x", "c", "v", "b", "n", "m", "back"],
    ["hide", "'", "-", "space", ".", ",", "?", "!", "enter"]
  ];

  var pad = null, target = null, shift = false;

  function enabled() {
    try { return WT.store.settings().appKeyboard !== false; } catch (e) { return true; }
  }
  function setEnabled(on) {
    var s = WT.store.settings();
    s.appKeyboard = !!on;
    WT.store.saveSettings(s);
  }
  function isTarget(n) {
    return !!(n && n.tagName === "INPUT" && n.classList.contains("ans") && n.closest && n.closest("#solve, #study"));
  }
  // 입력칸을 만들 때 부른다: 앱 자판을 쓰면 기기 키보드를 띄우지 않게 한다.
  function prep(inp) {
    if (enabled()) inp.setAttribute("inputmode", "none");
    else inp.removeAttribute("inputmode");
    return inp;
  }

  function keyLabel(k) {
    if (k === "shift") return "⇧";
    if (k === "back") return "⌫";
    if (k === "space") return "띄어쓰기";
    if (k === "hide") return "내리기"; // 「⌄」는 글자 v 와 헷갈려서 글로 적는다
    if (k === "enter") return target && target.closest("#study") ? "확인 ↵" : "다음 ↵";
    return shift ? k.toUpperCase() : k;
  }
  function keyName(k) {
    return { shift: "대문자", back: "지우기", space: "띄어쓰기", hide: "자판 내리기", enter: "확인" }[k] || k;
  }

  function build() {
    pad = doc.createElement("div");
    pad.id = "kbd";
    pad.className = "kbd";
    pad.hidden = true;
    pad.setAttribute("role", "group");
    pad.setAttribute("aria-label", "영어 자판");
    ROWS.forEach(function (row) {
      var r = doc.createElement("div");
      r.className = "krow";
      row.forEach(function (k) {
        var b = doc.createElement("button");
        b.type = "button";
        b.className = "key k-" + (k.length === 1 ? (/[a-z]/.test(k) ? "ch" : "sym") : k);
        b.setAttribute("data-key", k);
        b.setAttribute("aria-label", keyName(k));
        b.textContent = keyLabel(k);
        // 자판을 눌러도 입력칸의 포커스가 빠지지 않게 한다.
        b.addEventListener("pointerdown", function (e) { e.preventDefault(); });
        b.addEventListener("mousedown", function (e) { e.preventDefault(); });
        b.addEventListener("click", function () { press(k); });
        r.appendChild(b);
      });
      pad.appendChild(r);
    });
    doc.body.appendChild(pad);
  }

  function refresh() {
    if (!pad) return;
    Array.prototype.forEach.call(pad.querySelectorAll("button.key"), function (b) {
      var k = b.getAttribute("data-key");
      b.textContent = keyLabel(k);
      if (k === "shift") b.classList.toggle("on", shift);
    });
  }

  function insert(text) {
    var t = target;
    if (!t || t.readOnly || t.disabled) return;
    var s = t.selectionStart, e = t.selectionEnd;
    if (s === null || s === undefined) { s = e = t.value.length; }
    t.setRangeText(text, s, e, "end");
    t.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function backspace() {
    var t = target;
    if (!t || t.readOnly || t.disabled) return;
    var s = t.selectionStart, e = t.selectionEnd;
    if (s === null || s === undefined) { s = e = t.value.length; }
    if (s === e) { if (s === 0) return; s -= 1; }
    t.setRangeText("", s, e, "end");
    t.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function press(k) {
    if (!target) return;
    if (k === "shift") { shift = !shift; refresh(); return; }
    if (k === "back") { backspace(); return; }
    if (k === "hide") { var t = target; t.blur(); hide(); return; }
    if (k === "enter") {
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      return;
    }
    if (k === "space") { insert(" "); return; }
    insert(shift ? k.toUpperCase() : k);
    if (shift) { shift = false; refresh(); } // 대문자는 한 글자만
  }

  function show(inp) {
    if (!pad) build();
    target = inp;
    shift = false;
    refresh();
    pad.hidden = false;
    doc.body.classList.add("kbd-open");
    // 자판에 가리지 않게 입력칸을 화면 가운데로
    setTimeout(function () { try { inp.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) {} }, 30);
  }
  function hide() {
    target = null;
    if (pad) pad.hidden = true;
    doc.body.classList.remove("kbd-open");
  }

  // S펜으로 입력칸을 누르면 앱 자판 대신 태블릿의 S펜 텍스트 입력을 쓰게 한다(2026-11-18 태블릿에서 틀린 철자 freind 가
  // 고쳐지지 않고 그대로 남는 것을 확인). 손가락·마우스로 누르면 앱 자판을 쓴다. 포커스는 pointerdown 다음에 오므로 여기서 정한다.
  var penFocus = false;
  function bind() {
    doc.addEventListener("pointerdown", function (e) {
      if (!isTarget(e.target)) return;
      if (e.pointerType === "pen") {
        penFocus = true;
        e.target.removeAttribute("inputmode");
        if (target) hide();
      } else {
        penFocus = false;
        prep(e.target);
      }
    }, true);
    doc.addEventListener("focusin", function (e) {
      if (!(enabled() && isTarget(e.target))) return;
      if (penFocus) { penFocus = false; return; }
      show(e.target);
    });
    doc.addEventListener("focusout", function () {
      // 다른 입력칸으로 옮기는 중이면 그대로 두고, 아니면 내린다.
      setTimeout(function () {
        var a = doc.activeElement;
        if (!(enabled() && isTarget(a))) hide();
      }, 0);
    });
    // 화면이 다시 그려져 입력칸이 없어지거나(포커스 이벤트가 오지 않음) 시험·외우기 화면이 닫히면 내린다.
    if (root.MutationObserver) {
      new root.MutationObserver(function () {
        if (target && (!target.isConnected || target.offsetParent === null)) hide();
      }).observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
    }
  }

  WT.kbd = { enabled: enabled, setEnabled: setEnabled, prep: prep, bind: bind, press: press, hide: hide,
    _target: function () { return target; } };
})(typeof window !== "undefined" ? window : globalThis);
