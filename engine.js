/*
  タスクの計算のルール。アプリ(行軍表)とActionsの両方がこのファイルを使う。

  数字は保存しない。タスクの定義と毎日の記録を、最初の日から順にたどって
  累計・連続・最長連続・未実行連続・世代内累計・貯金・状況を毎回出し直す。
  同じ記録からは必ず同じ結果が出るので、持ち越しのずれや上書きが起きない。

  規則は Notion 時代の毎朝の生成(generate_daily_tasks v23)と同じ。
    - 新規は累計3で進行中へ。未実行2日連続で要再設定
    - 進行中は未実行3日連続で要再設定。14日連続で定着
    - 定着は60日連続で熟達。1日でも落とせば進行中へ
    - 熟達は落とせば定着へ
    - 実験と随時は上がりも落ちもしない
    - 「今日は該当しない」は無かった日として扱う。連続を保ち、累計は増やさない
    - 定着と熟達は記録が無ければ完了、随時は該当しない、貯金が1日分あれば完了
*/
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TaskEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DONE = new Set(["完了", "超過完了", "不完全な完了"]);
  const EXCUSED = new Set(["今日は該当しない"]);
  const AUTO_DONE = new Set(["定着", "熟達"]);
  // 毎日の行が立つ状況。休止中・実験終了・殿堂入り・達成済み・アーカイブは立たない
  const GENERATED = new Set(["新規", "進行中", "要再設定", "実験", "定着", "熟達", "随時"]);
  const RULES = { PROMOTE_AT: 3, DROP_NEW_AT: 2, DROP_ACTIVE_AT: 3, TO_SETTLED: 14, TO_MASTERED: 60 };
  const WEEKDAYS = "月火水木金土日";

  function addDays(d, n) {
    const t = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) + n * 86400000;
    return new Date(t).toISOString().slice(0, 10);
  }
  function daysBetween(a, b) {
    return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
  }
  function weekdayMon0(d) { return (new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7; }

  // 実行間隔。空欄なら毎日、数字があれば最終達成日からその日数ごと、曜日があればその曜日だけ
  function isDue(spec, day, lastDone) {
    spec = (spec || "").trim();
    if (!spec) return true;
    const m = spec.match(/(\d+)/);
    if (m) {
      const n = +m[1];
      if (n <= 1 || !lastDone) return true;
      return daysBetween(lastDone, day) >= n;
    }
    const days = Array.from(spec).filter(c => WEEKDAYS.includes(c));
    if (days.length) return days.includes(WEEKDAYS[weekdayMon0(day)]);
    return true;
  }

  // その日の終わりに、明日の状況を決める
  function nextStatus(cur, check, total, miss, prevStreak) {
    if (cur === "実験" || cur === "随時") return cur;
    const done = DONE.has(check), excused = EXCUSED.has(check);
    const streak = prevStreak + (done ? 1 : 0);
    const missed = !done && !excused;
    if (cur === "熟達") return missed ? "定着" : "熟達";
    if (cur === "定着") return missed ? "進行中" : (streak >= RULES.TO_MASTERED ? "熟達" : "定着");
    if (cur === "新規") {
      if (total >= RULES.PROMOTE_AT) return "進行中";
      if (miss >= RULES.DROP_NEW_AT) return "要再設定";
      return "新規";
    }
    if (cur === "進行中") {
      if (!missed && streak >= RULES.TO_SETTLED) return "定着";
      if (miss >= RULES.DROP_ACTIVE_AT) return "要再設定";
      return "進行中";
    }
    return cur;
  }

  function sortBy(arr, key) {
    return (arr || []).slice().sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0));
  }
  function genAt(gens, day) {
    let g = { gen: 1, from: null };
    for (const x of gens) if (x.from <= day) g = x;
    return g;
  }

  /*
    def   タスクの定義
    logFor(day)  その日の記録を返す関数。無ければ undefined
    until  ここまでたどる(この日を含む)

    返すもの
      days  行が立った日ごとの、その日の朝の状態
      next  until の日の終わりの状態(=翌朝の状態)
  */
  function replay(def, logFor, until) {
    const ini = def.initial || {};
    let st = {
      status: ini.status || "新規",
      total: +ini.total || 0, streak: +ini.streak || 0, best: +ini.best || 0, miss: +ini.miss || 0,
      lastDone: ini.lastDone || null, bank: +ini.bank || 0, prevBooking: ini.prevBooking || "",
      genTotal: ini.genTotal != null ? +ini.genTotal : (+ini.total || 0),
    };
    const gens = sortBy(def.generations, "from");
    const events = sortBy(def.events, "date");
    let gen = genAt(gens, def.created).gen || 1;
    const quota = +def.quota || 0;
    const imported = def.importedUntil || null;
    const days = [];
    if (!def.created || def.created > until) return { days, next: st, gen };

    let ei = 0;
    for (let day = def.created; day <= until; day = addDays(day, 1)) {
      const todays = [];
      while (ei < events.length && events[ei].date <= day) {
        if (events[ei].date === day) todays.push(events[ei]);
        ei++;
      }
      // 休止中から再開する出来事は、行が立つ前に効かせる
      if (!GENERATED.has(st.status)) {
        const revive = todays.find(e => e.status && GENERATED.has(e.status));
        if (revive) st.status = revive.status;
      }

      let rec = logFor(day);
      // 取り込んだ期間は、Notionに行があった日がそのまま行の立つ日
      const generated = (imported && day <= imported)
        ? !!rec
        : GENERATED.has(st.status) && isDue(def.interval, day, st.lastDone);
      if (!generated) continue;
      rec = rec || {};

      // 世代が上がった日から、世代内累計を数え直す
      const g = genAt(gens, day);
      if ((g.gen || 1) !== gen) {
        if ((g.gen || 1) > gen) st.genTotal = 0;
        gen = g.gen || 1;
      }

      // その日の行に手で入れた変更(状況・数字の直し)
      for (const e of todays) {
        if (e.status) st.status = e.status;
        if (e.set) Object.assign(st, e.set);
      }

      let check = rec.check;
      if (!check) {
        if (AUTO_DONE.has(st.status)) check = "完了";
        else if (st.status === "随時") check = "今日は該当しない";
        else if (quota > 0 && st.bank >= quota) check = "完了";
        else if (quota > 0 && st.bank > 0) check = "進行中";
        else check = "未着手";
      }

      days.push({
        date: day, status: st.status, check, gen, genTotal: st.genTotal,
        total: st.total, streak: st.streak, best: st.best, miss: st.miss, lastDone: st.lastDone,
        bank: quota > 0 ? st.bank : null, prevBooking: st.prevBooking, rec,
      });

      // その日の終わり
      const done = DONE.has(check), excused = EXCUSED.has(check);
      const total = st.total + (done ? 1 : 0);
      const streak = done ? st.streak + 1 : (excused ? st.streak : 0);
      const best = Math.max(st.best, streak);
      const miss = done ? 0 : (excused ? st.miss : st.miss + 1);
      const lastDone = done ? day : st.lastDone;
      st = {
        status: nextStatus(st.status, check, total, miss, st.streak),
        total, streak, best, miss, lastDone,
        genTotal: st.genTotal + (done ? 1 : 0),
        bank: quota > 0 ? Math.round((st.bank + (+rec.did || 0) - quota) * 100) / 100 : 0,
        prevBooking: rec.nextBooking || "",
      };
    }
    return { days, next: st, gen };
  }

  // 記録の束(月ごとのファイルを合わせたもの)から、logFor を作る
  function makeLogFor(logs, taskId) {
    return day => {
      const month = logs[day.slice(0, 7)];
      const d = month && month[day];
      return d ? d[taskId] : undefined;
    };
  }

  return { replay, makeLogFor, nextStatus, isDue, addDays, daysBetween, DONE, EXCUSED, AUTO_DONE, GENERATED, RULES };
});
