/* 공통 도구: 글자 이스케이프, 무작위(시드 지정 가능) */
(function (root) {
  "use strict";
  var WT = (root.WT = root.WT || {});

  // HTML 이스케이프 (파이썬 html.escape(quote=False) 와 같다)
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // **굵게** 표시를 <b> 로 바꾼다
  function bold(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  }

  // **굵게** 표시를 없앤다
  function plain(s) {
    return String(s).replace(/\*\*(.+?)\*\*/g, "$1");
  }

  // 빈칸(___) 개수
  function countBlank(t) {
    return String(t).split("___").length - 1;
  }

  // 글자 수를 세는 도우미: 두 목록이 같은 순서인지
  function sameOrder(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // 정렬한 두 문자열 목록이 같은지(순서 무시)
  function sameMembers(a, b) {
    var x = a.slice().sort();
    var y = b.slice().sort();
    return sameOrder(x, y);
  }

  // 두 목록에 겹치는 값이 있는지
  function intersects(list, set) {
    for (var i = 0; i < list.length; i++) if (set.has(list[i])) return true;
    return false;
  }

  // 시드를 줄 수 있는 무작위 (mulberry32)
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function Rng(seed) {
    this.f = mulberry32(seed >>> 0);
  }
  Rng.prototype.int = function (n) {
    return Math.floor(this.f() * n);
  };
  Rng.prototype.shuffle = function (a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = this.int(i + 1);
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  };
  Rng.prototype.choice = function (a) {
    return a[this.int(a.length)];
  };
  Rng.prototype.sample = function (a, k) {
    var c = a.slice();
    this.shuffle(c);
    return c.slice(0, k);
  };

  // 새 시험지 번호(여섯 자리)
  function newSeed() {
    var n = 100000 + Math.floor(Math.random() * 900000);
    try {
      if (root.crypto && root.crypto.getRandomValues) {
        var u = new Uint32Array(1);
        root.crypto.getRandomValues(u);
        n = 100000 + (u[0] % 900000);
      }
    } catch (e) {}
    return n;
  }

  WT.util = {
    esc: esc, bold: bold, plain: plain, countBlank: countBlank, sameOrder: sameOrder,
    sameMembers: sameMembers, intersects: intersects, Rng: Rng, newSeed: newSeed
  };
})(typeof window !== "undefined" ? window : globalThis);
