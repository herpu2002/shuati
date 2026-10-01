/* 刷题助手 - 主逻辑（纯本地运行，数据存 localStorage） */
(function () {
  'use strict';

  // ================= 存储层 =================
  var LS = { stats: 'sqt_stats', wrong: 'sqt_wrong', seen: 'sqt_seen', examHistory: 'sqt_exam_history', notes: 'sqt_notes', noteCats: 'sqt_note_cats', errata: 'sqt_errata' };

  function load(key, def) {
    try {
      var v = JSON.parse(localStorage.getItem(key));
      return v === null || v === undefined ? def : v;
    } catch (e) { return def; }
  }
  function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

  var stats = load(LS.stats, { practiced: 0, correct: 0, today: '', todayCount: 0 });
  var wrongBook = load(LS.wrong, {});   // { id: { w: 答错次数, s: 连对次数, t: 加入时间 } }
  var seen = load(LS.seen, {});         // { id: 1 } 已作答过的题
  var examHistory = load(LS.examHistory, []);   // [{ score, total, date, timeUsed }] 最新在前
  var notes = load(LS.notes, {});   // { qid: { content, updatedAt, tags: [] } }
  var noteCats = load(LS.noteCats, []);   // 用户自定义的标签名集合
  var errataBook = load(LS.errata, {});   // 用户纠错记录 { qid: { type, t } }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function ensureToday() {
    if (stats.today !== todayStr()) { stats.today = todayStr(); stats.todayCount = 0; }
  }
  function persist() {
    ensureToday();
    save(LS.stats, stats); save(LS.wrong, wrongBook); save(LS.seen, seen); save(LS.notes, notes); save(LS.noteCats, noteCats); save(LS.errata, errataBook);
  }

  // ================= 题库 =================
  var PRACTICE_BATCH = 20; // 刷题练习每次出题数
  var BANK = window.QUESTION_BANK || [];
  var QUOTES = window.QUOTES_DATA || [];
  var ANALYSIS = window.ANALYSIS_DATA || {};   // { 题id: { a:解析, r:法条依据, o:旧法冲突, n:新规对照 } }
  var byId = {};
  var byType = { single: [], multiple: [], judge: [] };
  BANK.forEach(function (q) {
    byId[q.id] = q;
    if (byType[q.type]) byType[q.type].push(q);
  });
  var TYPE_NAME = { single: '单选题', multiple: '多选题', judge: '判断题' };
  var LETTERS = 'ABCDEFG';

  // ================= 加权抽题 =================
  function weightOf(q) {
    if (wrongBook[q.id]) return 3;
    if (!seen[q.id]) return 5;
    return 1;
  }
  // 加权随机排序（不重复）
  function weightedShuffle(list) {
    return list.map(function (q) {
      return { q: q, k: Math.pow(Math.random(), 1 / weightOf(q)) };
    }).sort(function (a, b) { return b.k - a.k; }).map(function (o) { return o.q; });
  }

  // 按比例定额抽题：从 wrong/unseen/seen 三个池子抽 n 道，各不足时由其他池兜底，保证不重复
  function ratioPick(typeQs, ratio) {
    // ratio: {wrong, unseen, seen} 三个目标数
    var wrong = [], unseen = [], seenQs = [];
    typeQs.forEach(function (q) {
      if (wrongBook[q.id]) wrong.push(q);
      else if (!seen[q.id]) unseen.push(q);
      else seenQs.push(q);
    });
    function shuffle(arr) {
      return arr.slice().sort(function () { return Math.random() - 0.5; });
    }
    var picked = [];
    var used = {};
    function take(pool, n) {
      var s = shuffle(pool);
      for (var i = 0; i < s.length && picked.length < (ratio.wrong + ratio.unseen + ratio.seen); i++) {
        if (used[s[i].id]) continue;
        if (n <= 0) break;
        picked.push(s[i]); used[s[i].id] = 1; n--;
      }
      return n; // 还缺几道
    }
    var needWrong = take(wrong, ratio.wrong);
    var needUnseen = take(unseen, ratio.unseen + needWrong);  // 错题不够，未刷补
    var rem = ratio.wrong + ratio.unseen + ratio.seen - picked.length;
    take(seenQs, ratio.seen + needUnseen + rem);
    // 极端情况（全池都不够），从原始池再补
    if (picked.length < ratio.wrong + ratio.unseen + ratio.seen) {
      take(typeQs, ratio.wrong + ratio.unseen + ratio.seen - picked.length);
    }
    return picked;
  }

  function buildExamPaper() {
    var paper = [], short = [];
    [['single', 40], ['multiple', 30], ['judge', 30]].forEach(function (p) {
      var type = p[0], total = p[1];
      // 模拟试卷比例：未刷60% / 已刷30% / 错题10%
      var ratio = {
        wrong: Math.round(total * 0.1),
        unseen: Math.round(total * 0.6),
        seen: total - Math.round(total * 0.1) - Math.round(total * 0.6)
      };
      var slice = ratioPick(byType[type], ratio);
      if (slice.length < total) short.push(TYPE_NAME[type] + '仅' + slice.length + '题(需' + total + ')');
      paper = paper.concat(slice);
    });
    return { paper: paper, short: short };
  }

  // ================= 工具 =================
  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var toastTimer = null;
  function toast(msg) {
    var t = el('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(function (s) {
      s.classList.toggle('active', s.id === id);
    });
    window.scrollTo(0, 0);
  }
  function fmtSec(sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
  }
  function fmtDur(ms) { return fmtSec(ms / 1000); }

  // ================= 寄语 =================
  // 寄语标签：劝学 / 鼓励 / 自信阔达 / 戒勉 / 立志
  var todayQuoteIds = []; // 当天已使用过的寄语索引，避免短期重复
  function pickQuote(tags, fromInclude) {
    if (!QUOTES.length) return null;
    var tagArr = tags && tags.length ? tags : null;
    function hasTag(q) {
      if (!tagArr) return true;
      var qt = q.tags || [];
      for (var i = 0; i < tagArr.length; i++) {
        if (qt.indexOf(tagArr[i]) >= 0) return true;
      }
      return false;
    }
    function hasFrom(q) {
      if (!fromInclude) return true;
      return String(q.from || '').indexOf(fromInclude) >= 0;
    }
    var pool = [];
    QUOTES.forEach(function (q, i) {
      if (todayQuoteIds.indexOf(i) < 0 && hasTag(q) && hasFrom(q)) pool.push(i);
    });
    if (!pool.length) {
      todayQuoteIds = [];
      QUOTES.forEach(function (q, i) { if (hasTag(q) && hasFrom(q)) pool.push(i); });
    }
    if (!pool.length) return null;
    var idx = pool[Math.floor(Math.random() * pool.length)];
    todayQuoteIds.push(idx);
    if (todayQuoteIds.length > Math.floor(QUOTES.length * 0.6)) {
      todayQuoteIds = todayQuoteIds.slice(-Math.floor(QUOTES.length * 0.3));
    }
    return QUOTES[idx];
  }
  function quoteHtml(q, cls) {
    if (!q) return '';
    return '<div class="' + (cls || 'q-inline-quote') + '">"' + esc(q.text) + '"<span class="qi-from">—— ' + esc(q.from) + '</span></div>';
  }
  function renderHomeQuote() {
    // 首页寄语只取习近平金句（来源含"习近平"）
    var q = pickQuote(null, '习近平');
    if (!q) return;
    el('quote-text').textContent = q.text;
    el('quote-from').textContent = '—— ' + q.from;
  }

  // ================= 作答记录 =================
  // isCorrect: 是否答对; countStreak: 是否计入错题连对（考试不计）
  function recordAnswer(q, isCorrect, countStreak) {
    ensureToday();
    stats.practiced++;
    stats.todayCount++;
    if (isCorrect) stats.correct++;
    seen[q.id] = 1;
    if (!isCorrect) {
      var e = wrongBook[q.id];
      if (!e) { e = wrongBook[q.id] = { w: 0, s: 0, t: Date.now() }; }
      e.w++; e.s = 0;
    } else if (countStreak && wrongBook[q.id]) {
      var w = wrongBook[q.id];
      w.s++;
      if (w.s >= 2) {
        delete wrongBook[q.id];
        toast('该题已连续答对2次，已移出错题本');
      }
    }
    persist();
    renderHome();
  }

  // ================= 首页 =================
  function reloadData() {
    stats = load(LS.stats, stats);
    wrongBook = load(LS.wrong, wrongBook);
    seen = load(LS.seen, seen);
    notes = load(LS.notes, notes);
    errataBook = load(LS.errata, errataBook);
  }
  function renderHome() {
    reloadData();  // 从 localStorage 重新读取，确保数据最新
    ensureToday();
    el('home-date').textContent = new Date().getMonth() + 1 + '月' + new Date().getDate() + '日';
    el('st-practiced').textContent = stats.practiced;
    el('st-acc').textContent = stats.practiced ? Math.round(stats.correct / stats.practiced * 100) + '%' : '--';
    el('st-today').textContent = stats.todayCount;
    var wrongCount = Object.keys(wrongBook).length;
    el('st-wrong').textContent = wrongCount;
    var badge = el('wrong-badge');
    badge.textContent = wrongCount;
    badge.classList.toggle('zero', wrongCount === 0);
    el('exam-last').textContent = examHistory.length ? '上次' + examHistory[0].score + '分' : '未考过';
    // 题库覆盖进度条
    var total = BANK.length;
    var covered = Object.keys(seen).filter(function (id) { return byId[id]; }).length;
    el('st-prog-cur').textContent = covered;
    el('st-prog-total').textContent = total;
    var pct = total ? Math.round(covered / total * 100) : 0;
    if (pct > 100) pct = 100;
    el('st-prog-fill').style.width = pct + '%';
    el('st-prog-pct').textContent = pct + '%';
    var noteCount = Object.keys(notes).length;
    var noteBadge = el('note-badge');
    if (noteBadge) {
      noteBadge.textContent = noteCount;
      noteBadge.classList.toggle('zero', noteCount === 0);
    }
    var changesBadge = el('changes-badge');
    if (changesBadge) {
      var outCount = outdatedQuestions().length;
      changesBadge.textContent = outCount;
      changesBadge.classList.toggle('zero', outCount === 0);
    }
    renderHomeQuote();
  }

  // ================= 练习（刷题 / 错题重做 / 题型专项） =================
  var practice = { mode: 'practice', list: [], idx: 0, done: 0, correct: 0, judged: false, selected: [], pendingPick: null };

  function startPractice(mode, typeFilter) {
    practice.mode = typeFilter === 'judge' ? 'judge' : mode;
    if (mode === 'redo') {
      // 错题重做：错题本随机打乱；题型专项下只取该题型的错题
      var wrongList = Object.keys(wrongBook).map(function (id) { return byId[id]; }).filter(Boolean);
      if (typeFilter) wrongList = wrongList.filter(function (q) { return q.type === typeFilter; });
      practice.list = weightedShuffle(wrongList);
      if (!practice.list.length) { toast(typeFilter ? '该题型没有错题' : '错题本是空的，先去刷题吧'); return; }
    } else {
      if (!BANK.length) { toast('题库为空'); return; }
      var pool = typeFilter ? BANK.filter(function (q) { return q.type === typeFilter; }) : BANK;
      if (!pool.length) { toast('该题型题库为空'); return; }
      // 比例：未刷70% / 已刷20% / 错题10%（共20题）
      var total = Math.min(PRACTICE_BATCH, pool.length);
      var ratio = {
        wrong: Math.round(total * 0.1),
        unseen: Math.round(total * 0.7),
        seen: total - Math.round(total * 0.1) - Math.round(total * 0.7)
      };
      practice.list = ratioPick(pool, ratio);
    }
    practice.idx = 0; practice.done = 0; practice.correct = 0;
    practice.judged = false; practice.selected = []; practice.pendingPick = null;
    showScreen('screen-practice');
    renderPractice();
  }

  function renderPractice() {
    var q = practice.list[practice.idx];
    var titleMap = { practice: '刷题练习', redo: '错题重做', judge: '判断专项' };
    el('p-title').textContent = titleMap[practice.mode] || '刷题练习';
    var body = el('p-body');
    var noTxt = '第 ' + (practice.idx + 1) + ' / ' + practice.list.length + ' 题';
    var html = '<div class="q-card">' +
      '<div class="q-meta"><span class="chip">' + TYPE_NAME[q.type] +
      (practice.mode === 'redo' ? ' · 错题重做' : '') + '</span>' +
      '<span class="q-no">' + noTxt + '</span></div>' +
      '<div class="q-stem">' + esc(q.stem) + '</div>' +
      '<div class="opts" id="p-opts"></div>' +
      '<div id="p-fb"></div>' +
      '<div id="p-analysis"></div>' +
      '<div id="p-actions"></div>' +
      '<div class="note-bar"><button class="btn-note' + (notes[q.id] ? ' has' : '') + '" id="p-note">📝 笔记' + (notes[q.id] ? ' · 已记' : '') + '</button>' +
      '<button class="btn-errata' + (errataBook[q.id] ? ' has' : '') + '" id="p-errata">🚩 纠错</button></div>' +
      '</div>';
    body.innerHTML = html;

    var wrap = el('p-opts');
    q.options.forEach(function (opt, i) {
      var d = document.createElement('div');
      d.className = 'opt';
      d.dataset.val = q.type === 'judge' ? opt : LETTERS[i];
      d.innerHTML = (q.type === 'multiple' ? '<span class="ck">✓</span>' : '') +
        '<span class="opt-k">' + (q.type === 'judge' ? '' : LETTERS[i]) + '</span>' +
        '<span class="opt-t">' + esc(opt) + '</span>';
      d.addEventListener('click', function () { onPracticeOption(q, d); });
      wrap.appendChild(d);
    });

    if (q.type === 'multiple') {
      var act = el('p-actions');
      var btn = document.createElement('button');
      btn.className = 'btn btn-primary btn-block';
      btn.id = 'p-confirm';
      btn.textContent = '确认答案';
      btn.disabled = true;
      btn.addEventListener('click', function () {
        judgePractice(q, practice.selected.slice().sort().join(''));
      });
      act.appendChild(btn);
    }
    var pNoteBtn = el('p-note');
    if (pNoteBtn) pNoteBtn.addEventListener('click', function () { openNote(q.id); });
    var pErrataBtn = el('p-errata');
    if (pErrataBtn) pErrataBtn.addEventListener('click', function () { openErrata(q.id); });
  }

  function onPracticeOption(q, node) {
    if (practice.judged) return;
    if (q.type === 'multiple') {
      var v = node.dataset.val;
      var idx = practice.selected.indexOf(v);
      if (idx >= 0) { practice.selected.splice(idx, 1); node.classList.remove('sel'); }
      else { practice.selected.push(v); node.classList.add('sel'); }
      var btn = el('p-confirm');
      if (btn) btn.disabled = practice.selected.length === 0;
    } else {
      // 单选/判断题：连点两次同一选项才判分，避免误触
      var pick = node.dataset.val;
      if (practice.pendingPick === pick) {
        practice.pendingPick = null;
        judgePractice(q, pick);
      } else {
        practice.pendingPick = pick;
        var wrap = el('p-opts');
        wrap.querySelectorAll('.opt').forEach(function (n) { n.classList.remove('sel'); });
        node.classList.add('sel');
        el('p-fb').innerHTML = '<div class="fb fb-hint">再点一次确认答案</div>';
      }
    }
  }

  function judgePractice(q, picked) {
    if (practice.judged) return;
    practice.pendingPick = null;
    var ok = picked === q.answer;
    practice.judged = true;
    practice.done++;
    if (ok) practice.correct++;
    recordAnswer(q, ok, true);

    var wrap = el('p-opts');
    wrap.classList.add('locked');
    var ansSet = q.type === 'multiple' ? q.answer.split('') : [q.answer];
    var pickSet = q.type === 'multiple' ? picked.split('') : [picked];
    wrap.querySelectorAll('.opt').forEach(function (n) {
      var v = n.dataset.val;
      if (ansSet.indexOf(v) >= 0) n.classList.add('ok');
      if (pickSet.indexOf(v) >= 0 && ansSet.indexOf(v) < 0) n.classList.add('bad');
    });

    var ansTxt = q.answer;
    el('p-fb').innerHTML = ok
      ? '<div class="fb fb-ok">回答正确 ✓</div>'
      : '<div class="fb fb-bad">回答错误 ✗ <span class="fb-ans">正确答案：' + esc(ansTxt) + '</span></div>';

    var act = el('p-actions');
    var last = practice.idx >= practice.list.length - 1;
    act.innerHTML = '<button class="btn btn-primary btn-block" id="p-next">' +
      (last ? '完成练习' : '下一题') + '</button>';
    el('p-next').addEventListener('click', nextPractice);
    el('p-analysis').innerHTML = analysisBlockHtml(q, 'p');
    bindSearch('p-search', q);
  }

  function nextPractice() {
    if (practice.idx >= practice.list.length - 1) { showPracticeSummary(); return; }
    practice.idx++;
    practice.judged = false;
    practice.selected = [];
    practice.pendingPick = null;
    renderPractice();
  }

  function endPracticeSession() {
    persist();
    if (practice.done === 0) { showScreen('screen-home'); renderHome(); return; }
    showPracticeSummary();
  }

  function showPracticeSummary() {
    var acc = practice.done ? Math.round(practice.correct / practice.done * 100) : 0;
    var finished = practice.judged && practice.idx >= practice.list.length - 1;
    var quoteTags = acc >= 80 ? ['自信阔达'] : (acc >= 60 ? ['鼓励'] : ['劝学', '鼓励']);
    var sq = pickQuote(quoteTags);
    el('summary-box').innerHTML =
      '<b style="font-size:16px">本次小结</b>' +
      '<div class="summary-num"><b>' + practice.done + '</b> 题 · 答对 ' + practice.correct +
      ' · 正确率 ' + acc + '%</div>' +
      (finished ? '<div class="muted" style="text-align:center;font-size:13px">本轮题目已刷完</div>' : '') +
      (sq ? quoteHtml(sq, 'summary-quote') : '') +
      '<button class="btn btn-primary btn-block" id="sum-continue">' + (finished ? '再刷一轮' : '继续') + '</button>' +
      '<button class="btn btn-ghost btn-block" id="sum-home" style="margin-top:8px">返回首页</button>';
    openModal('modal-summary');
    el('sum-continue').addEventListener('click', function () {
      closeModal('modal-summary');
      if (finished) { startPractice(practice.mode); }
    });
    el('sum-home').addEventListener('click', function () {
      closeModal('modal-summary');
      showScreen('screen-home');
      renderHome();
    });
  }

  // ================= 错题本 =================
  var wrongFilter = 'all';

  function renderWrongFilter() {
    var row = el('w-filter');
    row.innerHTML = '';
    [['all', '全部'], ['single', '单选'], ['multiple', '多选'], ['judge', '判断']].forEach(function (p) {
      var c = document.createElement('button');
      c.className = 'f-chip' + (wrongFilter === p[0] ? ' on' : '');
      c.textContent = p[1];
      c.addEventListener('click', function () { wrongFilter = p[0]; renderWrongFilter(); renderWrongList(); });
      row.appendChild(c);
    });
  }

  function renderWrongList() {
    var list = el('w-list');
    var ids = Object.keys(wrongBook).filter(function (id) {
      var q = byId[id];
      return q && (wrongFilter === 'all' || q.type === wrongFilter);
    }).sort(function (a, b) { return wrongBook[b].t - wrongBook[a].t; });

    if (!ids.length) {
      list.innerHTML = '<div class="empty-tip">错题本是空的，太棒了！<br>去刷题或模拟考试，答错的题会自动收进来。</div>';
      return;
    }
    list.innerHTML = '';
    ids.forEach(function (id) {
      var q = byId[id], e = wrongBook[id];
      var div = document.createElement('div');
      div.className = 'w-item';
      div.innerHTML =
        '<div class="w-stem">' + esc(q.stem) + '</div>' +
        '<div class="w-meta"><span class="w-type">' + TYPE_NAME[q.type] + '</span>' +
        '<span class="w-times">答错 ' + e.w + ' 次</span>' +
        '<span>连对 ' + e.s + '/2</span>' +
        (notes[q.id] ? '<span class="w-note">📝 有笔记</span>' : '') +
        '<button class="w-remove">移除</button></div>';
      div.addEventListener('click', function () { previewWrong(q); });
      div.querySelector('.w-remove').addEventListener('click', function (ev) {
        ev.stopPropagation();
        showConfirm('确定手动移除该错题吗？', function () {
          delete wrongBook[id];
          persist();
          renderHome();
          renderWrongList();
        }, { okText: '移除', cancelText: '取消' });
      });
      list.appendChild(div);
    });
  }

  // 点错题卡片：预览答案（不计时）
  function previewWrong(q) {
    var e = wrongBook[q.id];
    var ansTxt = q.answer;
    var optsHtml = q.options.map(function (opt, i) {
      var v = q.type === 'judge' ? opt : LETTERS[i];
      var cls = 'opt' + (ansSetHas(q, v) ? ' ok' : '');
      return '<div class="' + cls + '"><span class="opt-k">' + (q.type === 'judge' ? '' : LETTERS[i]) + '</span><span class="opt-t">' + esc(opt) + '</span></div>';
    }).join('');
    function ansSetHas(qq, v) {
      return qq.type === 'judge' ? qq.answer === v : qq.answer.indexOf(v) >= 0;
    }
    el('summary-box').innerHTML =
      '<span class="chip">' + TYPE_NAME[q.type] + '</span>' +
      '<div class="q-stem" style="margin:10px 0">' + esc(q.stem) + '</div>' +
      '<div class="opts locked">' + optsHtml + '</div>' +
      '<div class="fb fb-ok" style="margin-top:10px">正确答案：' + esc(ansTxt) +
      ' <span class="fb-ans">（答错 ' + (e ? e.w : 0) + ' 次 · 连对 ' + (e ? e.s : 0) + '/2）</span></div>' +
      (notes[q.id] ? '<div class="note-preview">' + esc(notes[q.id].content) + '</div>' : '') +
      analysisBlockHtml(q, 'pv') +
      '<div class="btn-row" style="margin-top:10px;grid-template-columns:1fr 1fr 1fr">' +
      '<button class="btn btn-ghost btn-sm" id="pv-note">📝 笔记</button>' +
      '<button class="btn btn-ghost btn-sm' + (errataBook[q.id] ? ' has' : '') + '" id="pv-errata">🚩 纠错</button>' +
      '<button class="btn btn-ghost btn-sm" id="pv-close">关闭</button>' +
      '</div>';
    openModal('modal-summary');
    el('pv-close').addEventListener('click', function () { closeModal('modal-summary'); });
    el('pv-note').addEventListener('click', function () { closeModal('modal-summary'); openNote(q.id); });
    el('pv-errata').addEventListener('click', function () { closeModal('modal-summary'); openErrata(q.id); });
    bindSearch('pv-search', q);
  }

  // ================= 解析 · 法条变动 · 纠错 =================
  var ERRATA_TYPES = { stem: '题干有误', options: '选项有误', answer: '答案有误', other: '其他问题' };

  function getAn(qid) { return ANALYSIS[qid] || null; }
  function isOutdated(qid) { var a = ANALYSIS[qid]; return !!(a && a.o); }
  // 从法条依据字段提取《法律名》作为分组
  function lawNameOf(an) {
    if (an && an.r) { var m = String(an.r).match(/《[^》]+》/); if (m) return m[0]; }
    return '其他';
  }
  function outdatedQuestions() {
    return BANK.filter(function (q) { return isOutdated(q.id); });
  }
  // 外链：Android 壳经 JavascriptInterface 调系统浏览器；浏览器调试时回退 window.open
  function openExternal(url) {
    if (window.AndroidBridge && window.AndroidBridge.openExternal) window.AndroidBridge.openExternal(url);
    else window.open(url, '_blank');
  }
  function buildSearchUrl(q) {
    var an = getAn(q.id);
    var law = lawNameOf(an);
    var stem = String(q.stem).replace(/\s+/g, '').slice(0, 28);
    var kw = stem + ' ' + (law === '其他' ? '法律题解析' : law + ' 法条');
    return 'https://www.baidu.com/s?wd=' + encodeURIComponent(kw);
  }
  // 解析区：冲突横幅 + 解析卡（无预置解析时仅显示联网搜索按钮）
  // listBtn=true 时搜索按钮走 class+data-qid（用于一页多题的成绩列表）
  function analysisBlockHtml(q, prefix, listBtn) {
    var an = getAn(q.id);
    var html = '';
    if (an && an.o) {
      html += '<div class="law-warn">⚠️ 本题依据旧法命题，现行法已修改；判分仍按题库原答案，实际适用以新规为准' +
        (an.n ? '<div class="law-warn-sub">' + esc(an.n) + '</div>' : '') + '</div>';
    }
    if (an && (an.a || an.r)) {
      html += '<div class="analysis-card">' +
        (an.r ? '<div class="an-law">📖 ' + esc(an.r) + '</div>' : '') +
        (an.a ? '<div class="an-text">' + esc(an.a) + '</div>' : '') +
        '</div>';
    }
    html += '<div class="an-search-row"><button class="btn btn-ghost btn-sm' +
      (listBtn ? ' rv-search" data-qid="' + q.id : '" id="' + prefix + '-search"') +
      '>🔍 联网搜解析</button></div>';
    return html;
  }
  function bindSearch(btnId, q) {
    var b = el(btnId);
    if (b) b.addEventListener('click', function () { openExternal(buildSearchUrl(q)); });
  }

  // ---------- 纠错 ----------
  function openErrata(qid) {
    var cur = errataBook[qid];
    var q = byId[qid];
    var rows = Object.keys(ERRATA_TYPES).map(function (k) {
      var on = cur && cur.type === k;
      return '<button class="errata-opt' + (on ? ' on' : '') + '" data-t="' + k + '">' +
        (on ? '✓ ' : '') + ERRATA_TYPES[k] + '</button>';
    }).join('');
    el('confirm-box').innerHTML =
      '<div class="note-modal-head">🚩 题目纠错</div>' +
      (q ? '<div class="note-modal-stem">' + esc(q.stem).slice(0, 80) + (q.stem.length > 80 ? '…' : '') + '</div>' : '') +
      '<div class="muted" style="font-size:13px;margin:6px 0">发现题目问题请选择类型，标记仅保存在本机，方便你复习时留意：</div>' +
      '<div class="errata-opts">' + rows + '</div>' +
      (cur ? '<div class="muted note-updated">已于 ' + new Date(cur.t).toLocaleString('zh-CN') +
        ' 标记为「' + ERRATA_TYPES[cur.type] + '」</div>' : '') +
      '<div class="btn-row" style="margin-top:10px">' +
      (cur ? '<button class="btn btn-ghost btn-sm" id="er-del">取消标记</button>' : '<span></span>') +
      '<button class="btn btn-primary btn-sm" id="er-close">' + (cur ? '完成' : '关闭') + '</button>' +
      '</div>';
    openModal('modal-confirm');
    el('confirm-box').querySelectorAll('.errata-opt').forEach(function (b) {
      b.addEventListener('click', function () {
        var t = b.dataset.t;
        errataBook[qid] = { type: t, t: Date.now() };
        persist(); renderHome();
        closeModal('modal-confirm');
        toast('已标记：' + ERRATA_TYPES[t]);
      });
    });
    var del = el('er-del');
    if (del) del.addEventListener('click', function () {
      delete errataBook[qid]; persist(); renderHome();
      closeModal('modal-confirm'); toast('已取消纠错标记');
    });
    el('er-close').addEventListener('click', function () { closeModal('modal-confirm'); });
  }

  // ---------- 法条变动对照 ----------
  var changeFilter = 'all';   // all 或《法律名》
  var chView = 'changes';     // changes | errata
  function changeGroups() {
    var m = {};
    outdatedQuestions().forEach(function (q) {
      var g = lawNameOf(getAn(q.id));
      (m[g] = m[g] || []).push(q);
    });
    return m;
  }
  function enterChanges() {
    chView = 'changes';
    el('ch-errata').textContent = '我的纠错';
    el('ch-filter').style.display = '';
    changeFilter = 'all';
    renderChangesFilter();
    renderChangesList();
    showScreen('screen-changes');
  }
  function renderChangesFilter() {
    var row = el('ch-filter');
    row.innerHTML = '';
    var groups = changeGroups();
    var total = 0;
    Object.keys(groups).forEach(function (g) { total += groups[g].length; });
    var chips = [['all', '全部(' + total + ')']];
    Object.keys(groups).sort().forEach(function (g) {
      chips.push([g, g + '(' + groups[g].length + ')']);
    });
    chips.forEach(function (p) {
      var c = document.createElement('button');
      c.className = 'f-chip' + (changeFilter === p[0] ? ' on' : '');
      c.textContent = p[1];
      c.addEventListener('click', function () { changeFilter = p[0]; renderChangesFilter(); renderChangesList(); });
      row.appendChild(c);
    });
  }
  function renderChangesList() {
    var list = el('ch-list');
    var qs = outdatedQuestions();
    if (changeFilter !== 'all') qs = qs.filter(function (q) { return lawNameOf(getAn(q.id)) === changeFilter; });
    if (!qs.length) {
      list.innerHTML = '<div class="empty-tip">暂无已标记的法条变动题目<br>解析库更新后此处会自动列出旧法题</div>';
      return;
    }
    list.innerHTML = '';
    qs.forEach(function (q) {
      var an = getAn(q.id);
      var div = document.createElement('div');
      div.className = 'w-item change-item';
      div.innerHTML =
        '<div class="w-meta" style="margin:0 0 6px"><span class="w-type">' + TYPE_NAME[q.type] + '</span>' +
        '<span class="ch-law">' + esc(lawNameOf(an)) + '</span></div>' +
        '<div class="w-stem">' + esc(q.stem) + '</div>' +
        '<div class="ch-new">新规：' + esc((an.n || '现行法已修改，详见解析').slice(0, 90)) +
        ((an.n || '').length > 90 ? '…' : '') + '</div>' +
        '<div class="w-meta"><span class="ch-old-ans">题库旧答案 ' + esc(q.answer) + '</span></div>';
      div.addEventListener('click', function () { showChangeDetail(q); });
      list.appendChild(div);
    });
  }
  function showChangeDetail(q) {
    var an = getAn(q.id);
    var optsHtml = q.options.map(function (opt, i) {
      var v = q.type === 'judge' ? opt : LETTERS[i];
      var ok = q.type === 'judge' ? q.answer === v : q.answer.indexOf(v) >= 0;
      return '<div class="opt' + (ok ? ' ok' : '') + '"><span class="opt-k">' +
        (q.type === 'judge' ? '' : LETTERS[i]) + '</span><span class="opt-t">' + esc(opt) + '</span></div>';
    }).join('');
    el('summary-box').innerHTML =
      '<span class="chip">' + TYPE_NAME[q.type] + '</span>' +
      '<div class="q-stem" style="margin:10px 0">' + esc(q.stem) + '</div>' +
      '<div class="opts locked">' + optsHtml + '</div>' +
      '<div class="law-warn" style="margin-top:10px">⚠️ 本题依据旧法命题，题库原答案为 <b>' + esc(q.answer) +
      '</b>，现行法已修改' + (an.n ? '<div class="law-warn-sub">' + esc(an.n) + '</div>' : '') + '</div>' +
      (an.r ? '<div class="an-law" style="margin-top:8px">📖 ' + esc(an.r) + '</div>' : '') +
      (an.a ? '<div class="analysis-card"><div class="an-text">' + esc(an.a) + '</div></div>' : '') +
      '<div class="an-search-row" style="margin-top:8px"><button class="btn btn-ghost btn-sm" id="chd-search">🔍 联网搜解析</button></div>' +
      '<div class="btn-row" style="margin-top:10px;grid-template-columns:1fr 1fr">' +
      '<button class="btn btn-ghost btn-sm' + (errataBook[q.id] ? ' has' : '') + '" id="chd-errata">🚩 标记此题有误</button>' +
      '<button class="btn btn-primary btn-sm" id="chd-close">关闭</button></div>';
    openModal('modal-summary');
    el('chd-close').addEventListener('click', function () { closeModal('modal-summary'); });
    el('chd-search').addEventListener('click', function () { openExternal(buildSearchUrl(q)); });
    el('chd-errata').addEventListener('click', function () { closeModal('modal-summary'); openErrata(q.id); });
  }

  // ---------- 我的纠错 ----------
  function toggleErrataView() {
    if (chView === 'changes') {
      chView = 'errata';
      el('ch-errata').textContent = '返回对照';
      el('ch-filter').style.display = 'none';
      renderErrataBook();
    } else {
      chView = 'changes';
      el('ch-errata').textContent = '我的纠错';
      el('ch-filter').style.display = '';
      renderChangesList();
    }
  }
  function renderErrataBook() {
    var list = el('ch-list');
    var ids = Object.keys(errataBook).sort(function (a, b) { return errataBook[b].t - errataBook[a].t; });
    if (!ids.length) {
      list.innerHTML = '<div class="empty-tip">还没有纠错记录<br>在题卡中点"🚩 纠错"即可标记可疑题目</div>';
      return;
    }
    list.innerHTML = '';
    ids.forEach(function (qid) {
      var q = byId[qid], eRec = errataBook[qid];
      var stem = q ? q.stem : '[题目已删除]';
      var div = document.createElement('div');
      div.className = 'w-item';
      div.innerHTML =
        '<div class="w-meta" style="margin:0 0 6px"><span class="w-type">' + esc(ERRATA_TYPES[eRec.type] || '其他问题') + '</span>' +
        '<span class="muted">' + new Date(eRec.t).toLocaleDateString('zh-CN') + '</span></div>' +
        '<div class="w-stem">' + esc(stem).slice(0, 90) + (stem.length > 90 ? '…' : '') + '</div>' +
        '<div class="w-meta"><button class="w-remove er-remove">删除标记</button></div>';
      if (q) div.addEventListener('click', function () { showChangeDetail(q); });
      div.querySelector('.er-remove').addEventListener('click', function (ev) {
        ev.stopPropagation();
        delete errataBook[qid]; persist(); renderHome(); renderErrataBook();
      });
      list.appendChild(div);
    });
  }

  // ================= 模拟考试 =================
  var exam = { paper: [], answers: {}, idx: 0, endAt: 0, startAt: 0, timer: null };

  function showExamInfo() {
    var box = el('ei-last');
    if (!examHistory.length) {
      box.innerHTML = '还没有考试记录，来试试吧。';
    } else {
      var h = examHistory[0];
      var html = '最近成绩：<b>' + h.score + ' 分</b>（' + h.date + '，用时 ' + h.timeUsed + '）';
      html += '<div class="exam-hist-list">';
      examHistory.slice(0, 10).forEach(function (r, i) {
        html += '<div class="exam-hist-row"><span class="eh-no">#' + (examHistory.length - i) + '</span>' +
          '<b class="eh-score">' + r.score + '分</b>' +
          '<span class="muted">' + r.date + ' · ' + r.timeUsed + '</span></div>';
      });
      html += '</div>';
      if (examHistory.length > 10) html += '<div class="muted exam-hist-more">共 ' + examHistory.length + ' 次，仅显示最近10次</div>';
      box.innerHTML = html;
    }
    showScreen('screen-exam-info');
  }

  function startExam() {
    var r = buildExamPaper();
    if (!r.paper.length) { toast('题库为空'); return; }
    if (r.short.length) toast('题量不足：' + r.short.join('，'));
    exam.paper = r.paper;
    exam.answers = {};
    exam.idx = 0;
    exam.startAt = Date.now();
    exam.endAt = exam.startAt + 45 * 60 * 1000;
    showScreen('screen-exam');
    renderExam();
    clearInterval(exam.timer);
    exam.timer = setInterval(tickExam, 500);
    tickExam();
  }

  function tickExam() {
    var left = exam.endAt - Date.now();
    var t = el('e-timer');
    if (left <= 0) { t.textContent = '00:00'; submitExam(true); return; }
    t.textContent = fmtSec(left / 1000);
    t.classList.toggle('danger', left <= 5 * 60 * 1000);
  }

  function renderExam() {
    var q = exam.paper[exam.idx];
    var answered = exam.paper.filter(function (x) { return exam.answers[x.id]; }).length;
    var body = el('e-body');
    body.innerHTML = '<div class="q-card">' +
      '<div class="q-meta"><span class="chip">' + TYPE_NAME[q.type] + '</span>' +
      '<span class="q-no">第 ' + (exam.idx + 1) + ' / ' + exam.paper.length + ' 题 · 已答 ' + answered + '</span></div>' +
      '<div class="q-stem">' + esc(q.stem) + '</div>' +
      '<div class="opts" id="e-opts"></div>' +
      '<div class="btn-row">' +
      '<button class="btn btn-ghost btn-sm" id="e-prev">上一题</button>' +
      '<button class="btn btn-ghost btn-sm" id="e-pal">答题卡</button>' +
      '<button class="btn btn-ghost btn-sm" id="e-next">下一题</button>' +
      '</div>' +
      '<div class="note-bar"><button class="btn-note' + (notes[q.id] ? ' has' : '') + '" id="e-note">📝 笔记' + (notes[q.id] ? ' · 已记' : '') + '</button>' +
      '<button class="btn-errata' + (errataBook[q.id] ? ' has' : '') + '" id="e-errata">🚩 纠错</button></div>' +
      '</div>';

    var wrap = el('e-opts');
    var cur = exam.answers[q.id] || (q.type === 'multiple' ? '' : '');
    q.options.forEach(function (opt, i) {
      var v = q.type === 'judge' ? opt : LETTERS[i];
      var d = document.createElement('div');
      d.className = 'opt';
      if (q.type === 'multiple') {
        if (cur.indexOf(v) >= 0) d.classList.add('sel');
        d.innerHTML = '<span class="ck">✓</span>';
      } else if (cur === v) d.classList.add('sel');
      d.innerHTML += '<span class="opt-k">' + (q.type === 'judge' ? '' : LETTERS[i]) + '</span>' +
        '<span class="opt-t">' + esc(opt) + '</span>';
      d.addEventListener('click', function () {
        if (q.type === 'multiple') {
          var now = exam.answers[q.id] || '';
          exam.answers[q.id] = now.indexOf(v) >= 0 ? now.replace(v, '') : (now + v).split('').sort().join('');
          d.classList.toggle('sel', exam.answers[q.id].indexOf(v) >= 0);
        } else {
          exam.answers[q.id] = v;
          wrap.querySelectorAll('.opt').forEach(function (n) { n.classList.remove('sel'); });
          d.classList.add('sel');
        }
      });
      wrap.appendChild(d);
    });

    el('e-prev').disabled = exam.idx === 0;
    el('e-prev').addEventListener('click', function () { if (exam.idx > 0) { exam.idx--; renderExam(); } });
    el('e-next').addEventListener('click', function () {
      if (exam.idx < exam.paper.length - 1) { exam.idx++; renderExam(); }
      else openPalette();
    });
    el('e-pal').addEventListener('click', openPalette);
    var eNoteBtn = el('e-note');
    if (eNoteBtn) eNoteBtn.addEventListener('click', function () { openNote(q.id); });
    var eErrataBtn = el('e-errata');
    if (eErrataBtn) eErrataBtn.addEventListener('click', function () { openErrata(q.id); });
  }

  function openPalette() {
    var answered = exam.paper.filter(function (x) { return exam.answers[x.id]; }).length;
    var html = '<div class="pal-head"><b>答题卡</b><span class="muted">已答 ' + answered + ' / ' + exam.paper.length + '</span>' +
      '<button class="nav-btn" id="pal-close">关闭</button></div><div class="pal-grid">';
    exam.paper.forEach(function (q, i) {
      var a = exam.answers[q.id];
      html += '<div class="pal-cell' + (i === exam.idx ? ' cur' : '') + (a ? ' done' : '') +
        '" data-i="' + i + '">' + (i + 1) + '</div>';
    });
    html += '</div>';
    el('palette-box').innerHTML = html;
    openModal('modal-palette');
    el('pal-close').addEventListener('click', function () { closeModal('modal-palette'); });
    el('palette-box').querySelectorAll('.pal-cell').forEach(function (c) {
      c.addEventListener('click', function () {
        exam.idx = parseInt(c.dataset.i, 10);
        closeModal('modal-palette');
        renderExam();
      });
    });
  }

  function submitExam(auto) {
    if (auto) { clearInterval(exam.timer); gradeExam(); return; }
    var unanswered = exam.paper.filter(function (x) { return !exam.answers[x.id]; }).length;
    var usedMin = Math.floor((Date.now() - exam.startAt) / 60000);
    var msg1 = unanswered
      ? '还有 ' + unanswered + ' 题未作答，已用 ' + usedMin + ' 分钟，确定交卷吗？'
      : '已用 ' + usedMin + ' 分钟，确定交卷吗？';
    showConfirm(msg1, function () {
      showConfirm('最终确认：交卷后不可修改，是否继续？', function () {
        clearInterval(exam.timer);
        gradeExam();
      }, { okText: '确认交卷', cancelText: '再想想' });
    }, { okText: '继续', cancelText: '取消' });
  }

  function gradeExam() {
    var score = 0;
    var per = { single: { ok: 0, n: 0 }, multiple: { ok: 0, n: 0 }, judge: { ok: 0, n: 0 } };
    var wrongList = [];
    exam.paper.forEach(function (q) {
      var picked = exam.answers[q.id] || '';
      var ok = picked === q.answer;
      seen[q.id] = 1;
      per[q.type].n++;
      if (ok) { score++; per[q.type].ok++; }
      else {
        wrongList.push({ q: q, picked: picked });
        var e = wrongBook[q.id];
        if (!e) { e = wrongBook[q.id] = { w: 0, s: 0, t: Date.now() }; }
        e.w++; e.s = 0;
      }
    });
    persist();
    examHistory.unshift({
      score: score, total: exam.paper.length, date: todayStr(),
      timeUsed: fmtDur(Date.now() - exam.startAt)
    });
    if (examHistory.length > 50) examHistory = examHistory.slice(0, 50);
    save(LS.examHistory, examHistory);
    renderResult(score, per, wrongList);
  }

  function renderResult(score, per, wrongList) {
    var body = el('r-body');
    var html = '<div class="q-card result-card">' +
      '<div class="score-num' + (score < 60 ? ' fail' : '') + '">' + score + '</div>' +
      '<div class="score-sub">满分 ' + exam.paper.length + ' · 用时 ' + fmtDur(Date.now() - exam.startAt) + '</div>' +
      '<div class="per-row"><span>单选题</span><b>' + per.single.ok + ' / ' + per.single.n + '</b></div>' +
      '<div class="per-row"><span>多选题</span><b>' + per.multiple.ok + ' / ' + per.multiple.n + '</b></div>' +
      '<div class="per-row"><span>判断题</span><b>' + per.judge.ok + ' / ' + per.judge.n + '</b></div>' +
      '</div>';
    var outdatedCount = exam.paper.filter(function (q) { return isOutdated(q.id); }).length;
    if (outdatedCount) {
      html += '<div class="exam-outdated-note">⚠️ 本卷含 ' + outdatedCount +
        ' 道依据旧法命题的题目，已按题库原答案判分；可在首页「法条变动对照」查看新规</div>';
    }
    html += '<div class="section-title">错题回顾（' + wrongList.length + '）· 已自动加入错题本</div>';
    if (!wrongList.length) {
      html += '<div class="empty-tip">全对！太棒了！</div>';
    }
    wrongList.forEach(function (w) {
      var q = w.q;
      var pickedTxt = w.picked ? w.picked : '未作答';
      html += '<div class="rv-item">' +
        '<div class="w-meta" style="margin:0 0 6px"><span class="w-type">' + TYPE_NAME[q.type] + '</span></div>' +
        '<div class="rv-stem">' + esc(q.stem) + '</div>' +
        '<div class="rv-ans"><span class="a-bad">你的答案：' + esc(pickedTxt) + '</span>' +
        '<span class="a-ok">正确答案：' + esc(q.answer) + '</span></div>' +
        analysisBlockHtml(q, 'rv', true) +
        '</div>';
    });
    var rq = pickQuote(score >= 90 ? ['戒勉'] : (score >= 60 ? ['自信阔达'] : ['鼓励', '劝学']));
    if (rq) html += quoteHtml(rq, 'q-inline-quote');
    body.innerHTML = html;
    body.querySelectorAll('.rv-search').forEach(function (b) {
      b.addEventListener('click', function () {
        var q = byId[b.dataset.qid];
        if (q) openExternal(buildSearchUrl(q));
      });
    });
    showScreen('screen-result');
    renderHome();
  }

  // ================= 弹层 =================
  function openModal(id) { el(id).classList.add('open'); }
  function closeModal(id) { el(id).classList.remove('open'); }

  // ================= 笔记 =================
  function getNoteTags(n) { return (n && Array.isArray(n.tags)) ? n.tags : []; }
  function openNote(qid) {
    var q = byId[qid] || (exam.paper && exam.paper.filter(function (x) { return x.id === qid; })[0]) || null;
    var cur = notes[qid];
    var curTags = getNoteTags(cur).slice();

    function renderTagRow() {
      var box = el('note-tags');
      if (!box) return;
      var html = '';
      curTags.forEach(function (t, i) {
        html += '<span class="tag-chip">' + esc(t) + '<span class="tag-x" data-i="' + i + '">×</span></span>';
      });
      html += '<button class="tag-add-btn" id="tag-add">+ 添加标签</button>';
      box.innerHTML = html;
      box.querySelectorAll('.tag-x').forEach(function (x) {
        x.addEventListener('click', function (e) {
          e.stopPropagation();
          var i = parseInt(x.dataset.i, 10);
          curTags.splice(i, 1);
          renderTagRow();
        });
      });
      var addBtn = el('tag-add');
      if (addBtn) addBtn.addEventListener('click', function () {
        var addBox = el('tag-add-box');
        var sugg = noteCats.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('');
        addBox.innerHTML =
          '<div class="tag-input-wrap">' +
          '<input type="text" class="tag-input" id="tag-new" placeholder="输入标签名（最多5个）" list="tag-list">' +
          '<datalist id="tag-list">' + sugg + '</datalist></div>' +
          '<div class="btn-row" style="margin-top:6px">' +
          '<button class="btn btn-ghost btn-sm" id="tag-cancel">取消</button>' +
          '<button class="btn btn-primary btn-sm" id="tag-ok">添加</button>' +
          '</div>';
        el('tag-new').focus();
        el('tag-cancel').addEventListener('click', function () { addBox.innerHTML = ''; });
        el('tag-ok').addEventListener('click', function () {
          var v = (el('tag-new').value || '').trim();
          if (!v) { addBox.innerHTML = ''; return; }
          if (v === 'all' || v === 'none') { toast('该名称为系统保留'); return; }
          if (curTags.indexOf(v) >= 0) { toast('该标签已存在'); return; }
          if (curTags.length >= 5) { toast('最多5个标签'); return; }
          curTags.push(v);
          addBox.innerHTML = '';
          renderTagRow();
        });
        el('tag-new').addEventListener('keydown', function (e) {
          if (e.key === 'Enter') el('tag-ok').click();
          else if (e.key === 'Escape') el('tag-cancel').click();
        });
      });
    }

    el('confirm-box').innerHTML =
      '<div class="note-modal-head">📝 笔记</div>' +
      (q ? '<div class="note-modal-stem">' + esc(q.stem).slice(0, 80) + (q.stem.length > 80 ? '…' : '') + '</div>' : '') +
      '<textarea class="note-textarea" id="note-input" placeholder="记录本题的解题思路、法条依据、易错点等...">' +
      (cur ? esc(cur.content) : '') + '</textarea>' +
      '<div class="note-tag-label muted">标签（自行分类，最多5个）</div>' +
      '<div class="note-tag-row" id="note-tags"></div>' +
      '<div id="tag-add-box"></div>' +
      (cur ? '<div class="muted note-updated">更新于 ' + new Date(cur.updatedAt).toLocaleString('zh-CN') + '</div>' : '') +
      '<div class="btn-row" style="margin-top:10px">' +
      (cur ? '<button class="btn btn-ghost btn-sm" id="note-del">删除</button>' : '<span></span>') +
      '<button class="btn btn-ghost btn-sm" id="note-cancel">取消</button>' +
      '<button class="btn btn-primary btn-sm" id="note-save">保存</button>' +
      '</div>';
    openModal('modal-confirm');
    renderTagRow();
    el('note-cancel').addEventListener('click', function () { closeModal('modal-confirm'); });
    el('note-save').addEventListener('click', function () {
      var v = el('note-input').value.trim();
      if (!v) { toast('笔记内容不能为空'); return; }
      // 把新标签加入 noteCats
      curTags.forEach(function (t) { if (noteCats.indexOf(t) < 0) noteCats.push(t); });
      notes[qid] = { content: v, updatedAt: Date.now(), tags: curTags.slice() };
      persist(); renderHome();
      closeModal('modal-confirm');
      toast('笔记已保存');
      if (el('screen-notes') && el('screen-notes').classList.contains('active')) {
        renderNotesList();
      }
    });
    var delBtn = el('note-del');
    if (delBtn) delBtn.addEventListener('click', function () {
      showConfirm('确定删除该题笔记吗？', function () {
        delete notes[qid];
        persist(); renderHome();
        closeModal('modal-confirm');
        toast('笔记已删除');
        if (el('screen-notes') && el('screen-notes').classList.contains('active')) {
          renderNotesList();
        }
      }, { okText: '删除', cancelText: '取消' });
    });
  }

  // 笔记列表屏幕（独立屏幕，类似错题本）
  var noteFilter = 'all';
  function renderNotesFilter() {
    var row = el('n-filter');
    if (!row) return;
    row.innerHTML = '';
    var chips = [['all', '全部'], ['none', '未标签']];
    noteCats.forEach(function (c) { chips.push([c, c]); });
    chips.forEach(function (p) {
      var c = document.createElement('button');
      c.className = 'f-chip' + (noteFilter === p[0] ? ' on' : '');
      c.textContent = p[1];
      c.addEventListener('click', function () { noteFilter = p[0]; renderNotesFilter(); renderNotesList(); });
      row.appendChild(c);
    });
  }
  function renderNotesList() {
    var list = el('n-list');
    if (!list) return;
    var total = Object.keys(notes).length;
    var ids = Object.keys(notes).filter(function (qid) {
      if (noteFilter === 'all') return true;
      var tags = getNoteTags(notes[qid]);
      if (noteFilter === 'none') return tags.length === 0;
      return tags.indexOf(noteFilter) >= 0;
    }).sort(function (a, b) { return notes[b].updatedAt - notes[a].updatedAt; });

    if (!ids.length) {
      list.innerHTML = '<div class="empty-tip">' +
        (total ? '该分类下暂无笔记' : '还没有笔记<br>在题卡中点 "📝 笔记" 即可记录') +
        '</div>';
      return;
    }
    list.innerHTML = '';
    ids.forEach(function (qid) {
      var q = byId[qid], n = notes[qid];
      var stem = q ? q.stem : '[题目已删除]';
      var tags = getNoteTags(n);
      var div = document.createElement('div');
      div.className = 'w-item note-list-item';
      var tagHtml = tags.length
        ? '<div class="note-item-tags">' + tags.map(function (t) {
            return '<span class="tag-chip">' + esc(t) + '</span>';
          }).join('') + '</div>'
        : '';
      div.innerHTML =
        '<div class="w-stem">' + esc(stem).slice(0, 60) + (stem.length > 60 ? '…' : '') + '</div>' +
        '<div class="note-item-content">' + esc(n.content).slice(0, 200) + (n.content.length > 200 ? '…' : '') + '</div>' +
        tagHtml +
        '<div class="muted note-item-meta">' + new Date(n.updatedAt).toLocaleString('zh-CN') + '</div>';
      div.addEventListener('click', function () {
        if (byId[qid]) {
          openNote(qid);
        } else {
          toast('原题目已不在题库，但仍可编辑笔记');
          openNote(qid);
        }
      });
      list.appendChild(div);
    });
  }

  // 自定义确认弹层（替代浏览器 confirm()，WebView 默认不弹 confirm）
  function showConfirm(msg, onOk, opts) {
    opts = opts || {};
    var box = el('confirm-box') || el('summary-box');
    box.innerHTML =
      '<div class="confirm-msg">' + esc(msg) + '</div>' +
      '<div class="btn-row" style="margin-top:16px">' +
      '<button class="btn btn-ghost btn-sm" id="cf-cancel">' + (opts.cancelText || '取消') + '</button>' +
      '<button class="btn btn-primary btn-sm" id="cf-ok">' + (opts.okText || '确定') + '</button>' +
      '</div>';
    openModal('modal-confirm');
    el('cf-cancel').addEventListener('click', function () {
      closeModal('modal-confirm');
      if (opts.onCancel) opts.onCancel();
    });
    el('cf-ok').addEventListener('click', function () {
      closeModal('modal-confirm');
      if (onOk) onOk();
    });
  }

  // ================= 清空数据 =================
  function resetAll() {
    showConfirm('将清空所有刷题记录、错题本、笔记与考试成绩，且无法恢复。确定吗？', function () {
      [LS.stats, LS.wrong, LS.seen, LS.examHistory, LS.notes, LS.noteCats, LS.errata].forEach(function (k) { localStorage.removeItem(k); });
      stats = { practiced: 0, correct: 0, today: '', todayCount: 0 };
      wrongBook = {}; seen = {}; examHistory = []; notes = {}; noteCats = []; errataBook = {};
      renderHome();
      toast('已清空全部数据');
    }, { okText: '清空', cancelText: '取消' });
  }

  // ================= v6.0 去重迁移 =================
  // v6.0 删除了 7238 道"题干+选项完全一致"的副本（每组保留最小 id）。
  // 被删 id 的旧进度（已刷/错题/笔记/纠错）经 window.PROGRESS_MAP 迁移到保留题，然后清掉死键。幂等。
  function sanitizeProgress() {
    var map = window.PROGRESS_MAP || {};
    var changed = false;
    Object.keys(seen).forEach(function (id) {
      var dst = map[id];
      if (dst != null && !byId[id]) { seen[dst] = 1; delete seen[id]; changed = true; }
    });
    function remap(obj, mergeFn) {
      Object.keys(obj).forEach(function (id) {
        if (byId[id]) return;               // 仍在库中，不动
        var dst = map[id];
        if (dst == null) { delete obj[id]; changed = true; return; } // 无映射的死键，清理
        if (obj[dst] && mergeFn) mergeFn(obj[dst], obj[id]);
        else if (!obj[dst]) obj[dst] = obj[id];
        delete obj[id];
        changed = true;
      });
    }
    remap(wrongBook, function (d, s) {
      d.w = Math.max(d.w || 0, s.w || 0);
      d.s = Math.min(d.s || 0, s.s || 0);
      if (!d.t || (s.t && s.t < d.t)) d.t = s.t;
    });
    remap(notes);
    remap(errataBook);
    if (changed) { persist(); toast('数据已兼容新版题库'); }
  }

  // ================= 初始化 =================
  function init() {
    sanitizeProgress();
    // 页面隐藏/关闭时强制保存（移动端按Home键、返回键时可靠触发）
    function saveNow() { try { persist(); } catch (e) {} }
    window.addEventListener('pagehide', saveNow);
    window.addEventListener('beforeunload', saveNow);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') saveNow();
    });

    el('card-practice').addEventListener('click', function () { startPractice('practice'); });
    el('card-judge').addEventListener('click', function () { startPractice('practice', 'judge'); });
    el('card-wrong').addEventListener('click', function () {
      wrongFilter = 'all';
      renderWrongFilter(); renderWrongList();
      showScreen('screen-wrong');
    });
    el('card-notes').addEventListener('click', function () {
      noteFilter = 'all';
      renderNotesFilter(); renderNotesList();
      showScreen('screen-notes');
    });
    el('card-exam').addEventListener('click', showExamInfo);
    el('btn-reset').addEventListener('click', resetAll);

    el('card-changes').addEventListener('click', enterChanges);
    el('ch-back').addEventListener('click', function () { showScreen('screen-home'); });
    el('ch-errata').addEventListener('click', toggleErrataView);

    el('p-back').addEventListener('click', endPracticeSession);
    el('p-end').addEventListener('click', endPracticeSession);

    el('w-back').addEventListener('click', function () { showScreen('screen-home'); });
    el('w-redo').addEventListener('click', function () { startPractice('redo'); });

    el('n-back').addEventListener('click', function () { showScreen('screen-home'); });

    el('ei-back').addEventListener('click', function () { showScreen('screen-home'); });
    el('ei-start').addEventListener('click', startExam);

    el('e-submit').addEventListener('click', function () { submitExam(false); });

    el('r-back').addEventListener('click', function () { showScreen('screen-home'); });

    renderHome();
  }

  init();
})();
