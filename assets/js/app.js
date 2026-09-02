/* Bakery Khunkai — ระบบสูตรและต้นทุนขนม (ใช้ภายในองค์กร)
   Vanilla JS ล้วน ไม่มี dependency
   ข้อมูลจริงอยู่ที่ Cloudflare D1 ผ่าน /api/state (ทุกเครื่องเห็นข้อมูลเดียวกัน)
   localStorage ใช้เป็นแคชสำหรับเปิดหน้าได้ทันที + fallback ตอนออฟไลน์/รันแบบไม่มี Functions */

(function () {
  'use strict';

  var STORAGE_KEY = 'bakery-khunkai/v1';
  var API = '/api/state';
  var app = document.getElementById('app');
  var apiAvailable = null; // null = ยังไม่รู้, true/false = รู้แล้ว
  var saveTimer = null;
  var savePending = false;
  var dirty = false; // true = มีการแก้ไขที่ยังไม่ยืนยันว่าขึ้น D1 สำเร็จ (รอ retry อยู่)
  var RECONNECT_PING_MS = 12000; // ห่างกันเท่าไรตอนพยายามเชื่อมต่อ D1 ใหม่หลังหลุด
  var pendingSuccessMsg = null; // ข้อความ toast ที่ "รอ" แสดง จนกว่าจะรู้ผล PUT จริง (ไม่ใช่ตอนคลิกปุ่ม)
  var conflict = null; // ข้อมูลชุดล่าสุดจากเซิร์ฟเวอร์ ตอนเจอ version ชนกัน (409) — ไม่ null = มี conflict ค้างอยู่ ห้ามบันทึกซ้ำจนกว่าผู้ใช้จะเลือก
  var lastSyncAt = Date.now(); // เวลาที่ sync กับ D1 สำเร็จล่าสุด (GET หรือ PUT ที่ผ่าน) ใช้วัดว่า "ทิ้งหน้าไว้เฉย ๆ" นานแค่ไหน
  var IDLE_REFRESH_MS = 15 * 60 * 1000; // เกินนี้แล้วยังไม่เคย sync -> บังคับโหลดข้อมูลล่าสุดก่อนยอมให้บันทึกครั้งต่อไป

  /* หมวดหมู่วัตถุดิบ — รายการตายตัว เรียงตามลำดับที่กำหนด */
  var CATEGORIES = [
    { id: 'flour', label: 'แป้ง' },
    { id: 'sugar', label: 'น้ำตาล' },
    { id: 'dairy-fat', label: 'นม เนย น้ำมัน' },
    { id: 'chocolate', label: 'ช็อกโกแลต/ผงโกโก้' },
    { id: 'seasoning', label: 'เครื่องปรุง สารเสริม' },
    { id: 'packaging', label: 'แพ็คเกจ' },
    { id: 'other', label: 'อื่นๆ' }
  ];
  var CATEGORY_LABEL = {};
  CATEGORIES.forEach(function (c) { CATEGORY_LABEL[c.id] = c.label; });
  function catLabel(id) { return CATEGORY_LABEL[id] || CATEGORY_LABEL.other; }
  function catOf(ing) { return (ing && ing.category && CATEGORY_LABEL[ing.category]) ? ing.category : 'other'; }

  /* หมวดบัญชีรายวัน — รายรับ/รายจ่าย */
  var INCOME_CATS = [
    { id: 'sale-store', label: 'ขายหน้าร้าน' },
    { id: 'sale-online', label: 'ขายออนไลน์/เดลิเวอรี' },
    { id: 'other-income', label: 'รายรับอื่นๆ' }
  ];
  var EXPENSE_CATS = [
    { id: 'material', label: 'วัตถุดิบ' },
    { id: 'packaging-cost', label: 'บรรจุภัณฑ์' },
    { id: 'labor-cost', label: 'ค่าแรง' },
    { id: 'utility', label: 'ค่าเช่า/น้ำ/ไฟ' },
    { id: 'other-expense', label: 'รายจ่ายอื่นๆ' }
  ];
  var LEDGER_CAT_LABEL = {};
  INCOME_CATS.concat(EXPENSE_CATS).forEach(function (c) { LEDGER_CAT_LABEL[c.id] = c.label; });
  function ledgerCatLabel(id) { return LEDGER_CAT_LABEL[id] || '-'; }
  /** วันที่ "วันนี้" แบบ fix เป็นเวลาไทย (Asia/Bangkok, UTC+7 คงที่ ไม่มี DST) เสมอ
   *  ไม่ใช้ getFullYear()/getMonth()/getDate() ตรง ๆ เพราะค่านั้นอิงตาม timezone ของอุปกรณ์
   *  ถ้าเครื่องไหนตั้งเวลาเป็น UTC (พบได้บนแท็บเล็ต/เครื่อง POS ที่เพิ่ง reset) ช่วง 00:00–06:59 น.
   *  เวลาไทยจะยังนับเป็น "เมื่อวาน" ตาม UTC ทำให้รายการบัญชีถูกเก็บผิดวัน — ใช้ Intl.DateTimeFormat
   *  บังคับ timezone ตรง ๆ แทน จึงได้ผลลัพธ์เดียวกันทุกเครื่องไม่ว่าเครื่องนั้นจะตั้งเวลาไว้อย่างไร */
  function todayStr() {
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    var y = '0000', m = '01', d = '01';
    parts.forEach(function (p) {
      if (p.type === 'year') y = p.value;
      else if (p.type === 'month') m = p.value;
      else if (p.type === 'day') d = p.value;
    });
    return y + '-' + m + '-' + d;
  }
  function thDate(iso) {
    if (!iso) return '-';
    var d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  /* ============================================================ store */

  var state = {
    view: 'dashboard',
    recipeId: null,
    ingFilter: 'all',
    targetPieces: 100,
    data: null,
    ledgerFormError: '',
    ledgerDraftType: 'income',
    ledgerDate: null // ตั้งค่าเป็นวันนี้ตอนเริ่มระบบ
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function loadLocal() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var d = JSON.parse(raw);
        if (d && d.ingredients && d.recipes) return d;
      }
    } catch (e) { /* ข้อมูลเสีย -> ใช้ค่าตั้งต้น */ }
    return clone(window.SEED_DATA);
  }

  function cacheLocal() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data)); }
    catch (e) { /* เปิดจากไฟล์โดยตรงบางเบราว์เซอร์จะบันทึกไม่ได้ — ใช้งานต่อได้ */ }
  }

  /* ทำเครื่องหมาย "มีการแก้ไขที่ยังไม่ยืนยันว่าขึ้น D1 สำเร็จ" ไว้ใน localStorage (ไม่ใช่แค่ตัวแปรในหน่วยความจำ)
   * เพื่อให้รอดจากการปิดแท็บ/เครื่องรีสตาร์ท/เบราว์เซอร์ suspend แท็บพื้นหลังกลางคัน — ถ้าไม่มีตัวนี้ พอเปิดหน้าเว็บ
   * ใหม่วันถัดไป loadRemote() จะทับ state.data ด้วยข้อมูลจากเซิร์ฟเวอร์ทันทีโดยไม่รู้เลยว่ามีของค้างอยู่ในเครื่อง
   * ทำให้แก้ไขล่าสุดของเมื่อวาน "หายไป" แบบเงียบ ๆ (นี่คือสาเหตุจริงของปัญหา "เปิดมาพรุ่งนี้ข้อมูลหาย") */
  var STORAGE_PENDING_KEY = STORAGE_KEY + '-pending';
  var PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // เก่ากว่านี้ไม่น่าเชื่อถือแล้ว ปล่อยผ่านแทนที่จะพยายามกู้

  function markPendingLocal(isPending) {
    try {
      if (isPending) localStorage.setItem(STORAGE_PENDING_KEY, String(Date.now()));
      else localStorage.removeItem(STORAGE_PENDING_KEY);
    } catch (e) { /* localStorage ใช้ไม่ได้ก็ปล่อยผ่าน ไม่ใช่ปัญหาคอขวด */ }
  }

  function readPendingLocal() {
    try {
      var raw = localStorage.getItem(STORAGE_PENDING_KEY);
      if (!raw) return false;
      var at = Number(raw);
      if (!isFinite(at) || Date.now() - at > PENDING_MAX_AGE_MS) { markPendingLocal(false); return false; }
      return true;
    } catch (e) { return false; }
  }

  /** ดึงข้อมูลกลางจาก Cloudflare D1 — คืน null ถ้าเรียกไม่สำเร็จ (ให้ใช้ข้อมูลในเครื่องแทน) */
  function loadRemote() {
    return fetch(API, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('status ' + res.status);
        return res.json();
      })
      .then(function (d) {
        if (!d || !d.ingredients || !d.recipes) throw new Error('payload ไม่ถูกต้อง');
        apiAvailable = true;
        lastSyncAt = Date.now();
        return d;
      })
      .catch(function (e) {
        apiAvailable = false;
        console.warn('โหลดข้อมูลกลางไม่สำเร็จ ใช้ข้อมูลในเครื่องแทน:', e.message);
        return null;
      });
  }

  /** เรียกบันทึกแบบหน่วงเวลา (debounce) กันยิง API ถี่เกินไปตอนพิมพ์
   *  ใส่ msg ถ้าอยากให้ขึ้น toast "สำเร็จ" — แต่ toast จะขึ้นก็ต่อเมื่อ PUT ไปถึง D1 จริงและสำเร็จเท่านั้น
   *  ไม่ใช่ทันทีที่เรียกฟังก์ชันนี้ (เดิมพลาดตรงนี้ ทำให้ผู้ใช้เห็น "สำเร็จ" ทั้งที่ยังไม่ได้ยิง PUT เลยด้วยซ้ำ) */
  function save(msg) {
    if (msg) pendingSuccessMsg = msg;
    state.data.updatedAt = new Date().toISOString();
    cacheLocal();
    markPendingLocal(true);
    dirty = true;
    stamp();
    savePending = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveRemote, 600);
  }

  /** จุดเริ่มของการบันทึกจริง — ยิง PUT ขึ้น D1 เสมอไม่ว่า apiAvailable จะเป็นอะไรอยู่ก่อนหน้า
   *  (เดิมถ้าเคย fail ครั้งเดียวจะไม่ลองอีกเลยจนกว่าจะ reload หน้า — แก้แล้ว)
   *  แต่ถ้าทิ้งหน้าไว้เฉย ๆ เกิน 15 นาทีโดยไม่เคย sync เลย จะบังคับเช็คข้อมูลล่าสุดก่อน ไม่ยอมยิง PUT ทับตรง ๆ
   *  และถ้ามี conflict ค้างอยู่ (409 ไปแล้วรอบก่อน) จะไม่ยิงซ้ำจนกว่าผู้ใช้จะกดโหลดข้อมูลล่าสุด */
  function saveRemote() {
    if (conflict) return;
    // ไม่มี stateVersion เลย (เช่น save() หลุดมาก่อน loadRemote() ครั้งแรกจะเสร็จ) หรือทิ้งหน้าไว้เฉยเกิน 15 นาที
    // -> ต้องเช็คข้อมูลล่าสุดก่อนเสมอ ห้ามยิง PUT ทับตรง ๆ โดยไม่รู้ version ที่แท้จริง
    if (!state.data.stateVersion || Date.now() - lastSyncAt > IDLE_REFRESH_MS) { refreshBeforeStaleSave(); return; }
    doPutNow();
  }

  /** ทิ้งหน้าไว้นานเกิน 15 นาที -> เช็คก่อนว่า version ที่เราถืออยู่ยังตรงกับเซิร์ฟเวอร์ไหม
   *  ตรง -> ยิง PUT ต่อได้เลย, ไม่ตรง -> มีคนแก้ไปแล้วระหว่างที่เราไม่ได้ใช้งาน ต้องแจ้งเตือนแทนที่จะเขียนทับ */
  function refreshBeforeStaleSave() {
    fetch(API, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('status ' + res.status);
        return res.json();
      })
      .then(function (server) {
        apiAvailable = true;
        lastSyncAt = Date.now();
        if (server.stateVersion === state.data.stateVersion) {
          doPutNow(); // ไม่มีใครแก้ไขอะไรระหว่างที่เราไม่ได้ใช้งาน -> ปลอดภัย บันทึกต่อได้
        } else {
          savePending = false;
          conflict = server;
          stamp();
          showConflictAlert();
        }
      })
      .catch(function (e) {
        apiAvailable = false;
        savePending = false;
        console.warn('ตรวจสอบข้อมูลล่าสุดก่อนบันทึกไม่สำเร็จ:', e.message);
        stamp();
        showSaveError('เชื่อมต่อฐานข้อมูลกลางไม่สำเร็จตอนตรวจข้อมูลล่าสุด — ระบบจะลองใหม่ให้อัตโนมัติ');
      });
  }

  function doPutNow() {
    fetch(API, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(state.data)
    })
      .then(function (res) {
        if (res.status === 409) {
          return res.json().then(function (d) {
            var err = new Error('version ไม่ตรงกับเซิร์ฟเวอร์ (conflict)');
            err.conflict = true;
            err.serverData = d.current;
            throw err;
          });
        }
        if (!res.ok) throw new Error('status ' + res.status);
        return res.json();
      })
      .then(function (r) {
        apiAvailable = true;
        lastSyncAt = Date.now();
        state.data.updatedAt = r.updatedAt || state.data.updatedAt;
        state.data.stateVersion = r.stateVersion || state.data.stateVersion;
        dirty = false;
        markPendingLocal(false);
        cacheLocal(); // อัปเดต stateVersion/updatedAt ล่าสุดลง cache ด้วย ไม่ใช่แค่ในหน่วยความจำ
        savePending = false;
        stamp();
        hideSaveError();
        if (pendingSuccessMsg) { toast(pendingSuccessMsg); pendingSuccessMsg = null; }
      })
      .catch(function (e) {
        savePending = false;
        if (e && e.conflict) {
          apiAvailable = true; // เชื่อมต่อได้ปกติ แค่ข้อมูลชนกัน ไม่ใช่ปัญหาเน็ต
          lastSyncAt = Date.now();
          conflict = e.serverData;
          stamp();
          showConflictAlert();
          return;
        }
        apiAvailable = false;
        console.warn('บันทึกขึ้นฐานข้อมูลกลางไม่สำเร็จ:', e.message);
        stamp();
        // เก็บ pendingSuccessMsg ไว้ก่อน (ยังไม่เคลียร์) เผื่อ retry รอบหน้าสำเร็จ จะได้ยัง toast ให้เห็นว่าสำเร็จจริง
        showSaveError('บันทึกขึ้นฐานข้อมูลกลางไม่สำเร็จ — ข้อมูลยังอยู่ในเครื่องนี้ ระบบจะลองส่งใหม่ให้อัตโนมัติ');
      });
  }

  /** เช็คการเชื่อมต่อ D1 เป็นระยะ ๆ ขณะออฟไลน์ — พอกลับมาต่อได้ ยิงข้อมูลที่ค้างอยู่ (dirty) ขึ้นทันที
   *  ไม่ต้องรอผู้ใช้พิมพ์อะไรต่อ และไม่ต้องพึ่งการ reload หน้าเว็บ */
  function pingReconnect() {
    if (apiAvailable !== false) return; // ต่อได้อยู่แล้ว ไม่ต้อง ping ซ้ำ
    fetch(API, { method: 'GET', cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('status ' + res.status);
        apiAvailable = true;
        lastSyncAt = Date.now();
        stamp();
        if (dirty && !conflict) saveRemote(); // มีข้อมูลค้างจากตอนออฟไลน์ (และไม่ได้ติด conflict ค้างอยู่) -> ส่งทันที
      })
      .catch(function () { /* ยังต่อ D1 ไม่ได้ รอ ping รอบหน้า */ });
  }

  function stamp() {
    var el = document.getElementById('savedAt');
    if (!el) return;
    if (savePending) { el.textContent = 'กำลังบันทึก…'; return; }
    var t = state.data.updatedAt;
    var base = t ? 'บันทึกล่าสุด ' + new Date(t).toLocaleString('th-TH') : '';
    if (apiAvailable === false) base += ' · โหมดออฟไลน์ (บันทึกเฉพาะเครื่องนี้)';
    el.textContent = base;
  }

  function uid(prefix) {
    return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ============================================================ helpers */

  function money(n) {
    if (!isFinite(n)) n = 0;
    return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function num(n, d) {
    if (!isFinite(n)) n = 0;
    return n.toLocaleString('th-TH', { maximumFractionDigits: d === undefined ? 1 : d });
  }
  function pct(n) {
    if (!isFinite(n)) n = 0;
    return (n * 100).toLocaleString('th-TH', { maximumFractionDigits: 1 }) + '%';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.hidden = true; }, 2200);
  }

  /** แจ้งเตือน "บันทึกไม่สำเร็จ" แบบเด่นชัด (แถบแดงกลางจอด้านบน) — ต่างจาก toast ปกติที่ใช้แจ้งสำเร็จเฉย ๆ
   *  ใช้ role="alert" ให้ screen reader อ่านทันที และอยู่นานกว่า toast ทั่วไปเพราะเป็นเรื่องสำคัญกว่า */
  function showSaveError(msg) {
    var el = document.getElementById('saveAlert');
    if (!el) return;
    el.textContent = msg; // ตั้ง textContent ล้าง innerHTML เดิมไปในตัว (เผื่อก่อนหน้าเป็นแถบ conflict ที่มีปุ่มอยู่)
    el.hidden = false;
    clearTimeout(el._timer);
    el._timer = setTimeout(function () { el.hidden = true; }, 6000);
  }
  function hideSaveError() {
    var el = document.getElementById('saveAlert');
    if (!el) return;
    clearTimeout(el._timer);
    el.hidden = true;
  }
  /** แจ้งเตือน "มีคนอื่นบันทึกทับไปก่อนแล้ว" — ไม่ auto-hide เพราะต้องรอให้ผู้ใช้ตัดสินใจกดปุ่มเอง
   *  ปุ่มในนี้ไม่ได้อยู่ใต้ #app จึงต้องมี listener แยกต่างหาก (ผูกไว้ท้ายไฟล์) */
  function showConflictAlert() {
    var el = document.getElementById('saveAlert');
    if (!el) return;
    clearTimeout(el._timer);
    el.innerHTML = 'มีการเปลี่ยนแปลงข้อมูลจากเครื่องอื่นระหว่างที่คุณกำลังแก้ไข — ระบบไม่ได้บันทึกทับให้ เพื่อป้องกันข้อมูลหาย' +
      '<br><button type="button" class="btn sm" id="conflictReloadBtn" ' +
      'style="margin-top:8px;background:#fff;color:var(--bad);border-color:#fff">โหลดข้อมูลล่าสุด</button>';
    el.hidden = false;
  }

  /* ============================================================ calc */

  function ingById(id) {
    return state.data.ingredients.filter(function (i) { return i.id === id; })[0] || null;
  }
  function unitCost(ing) {
    if (!ing || !ing.pack) return 0;
    return ing.price / ing.pack;
  }
  function currentRecipe() {
    var list = state.data.recipes;
    if (!list.length) return null;
    var r = list.filter(function (x) { return x.id === state.recipeId; })[0];
    return r || list[0];
  }

  /** คำนวณต้นทุนของสูตร ที่ตัวคูณ mult (1 = สูตรฐาน) */
  function costOf(recipe, mult) {
    mult = mult || 1;
    var lines = recipe.items.map(function (it) {
      var ing = ingById(it.ingredientId);
      var uc = unitCost(ing);
      var qty = Math.round(it.qty * mult * 10) / 10;
      return {
        item: it,
        ing: ing,
        name: ing ? ing.name : '(ลบวัตถุดิบนี้ไปแล้ว)',
        unit: ing ? ing.unit : '-',
        unitCost: uc,
        qty: qty,
        cost: it.include ? qty * uc : 0
      };
    });
    var total = lines.reduce(function (s, l) { return s + l.cost; }, 0);
    var pieces = Math.round((recipe.basePieces || 0) * mult);
    return { lines: lines, total: total, pieces: pieces, perPiece: pieces ? total / pieces : 0 };
  }

  /** ต้นทุนเต็ม (วัตถุดิบ + บรรจุภัณฑ์ + ค่าแรง) ต่อ 1 สูตรฐาน */
  function fullCost(recipe) {
    var p = recipe.pricing || { packaging: 0, labor: 0, sellPrice: 0 };
    var c = costOf(recipe, 1);
    var total = c.total + (p.labor || 0) + (p.packaging || 0) * c.pieces;
    var perPiece = c.pieces ? total / c.pieces : 0;
    var sell = p.sellPrice || 0;
    return {
      material: c.total,
      pieces: c.pieces,
      total: total,
      perPiece: perPiece,
      sell: sell,
      profitPerPiece: sell - perPiece,
      margin: sell ? (sell - perPiece) / sell : 0,
      markup: perPiece ? (sell - perPiece) / perPiece : 0,
      revenue: sell * c.pieces,
      profitPerBatch: sell * c.pieces - total,
      breakEven: sell ? Math.ceil(total / sell) : 0
    };
  }

  /* ============================================================ views */

  var V = {};

  /* ---------------------------------------------------- ภาพรวม */
  V.dashboard = function () {
    var recipes = state.data.recipes;
    var rows = recipes.map(function (r) { return { r: r, f: fullCost(r) }; });
    var avgPerPiece = rows.length
      ? rows.reduce(function (s, x) { return s + x.f.perPiece; }, 0) / rows.length : 0;
    var totalProfit = rows.reduce(function (s, x) { return s + x.f.profitPerBatch; }, 0);

    return '' +
      head('ภาพรวม', 'สรุปต้นทุนและกำไรของทุกสูตรในระบบ') +
      '<div class="grid cols-4">' +
        stat('จำนวนสูตรขนม', num(recipes.length, 0) + ' <span class="sub">สูตร</span>', '', 'brand') +
        stat('วัตถุดิบในคลังราคา', num(state.data.ingredients.length, 0) + ' <span class="sub">รายการ</span>', '') +
        stat('ต้นทุนเฉลี่ยต่อชิ้น', money(avgPerPiece) + ' <span class="sub">บาท</span>', 'รวมค่าบรรจุภัณฑ์และค่าแรงแล้ว') +
        stat('กำไรรวมต่อ 1 รอบผลิต', money(totalProfit) + ' <span class="sub">บาท</span>', 'ถ้าขายหมดทุกสูตร', totalProfit >= 0 ? 'good' : '') +
      '</div>' +

      '<div class="card"><h2>สรุปรายสูตร <span class="hint">คลิกชื่อสูตรเพื่อเปิดรายละเอียด</span></h2>' +
      (rows.length ? '<div class="table-wrap"><table>' +
        '<thead><tr>' +
          '<th>สูตร</th><th>สูตรฐาน</th><th class="num">ได้ (ชิ้น)</th>' +
          '<th class="num">ค่าวัตถุดิบ</th><th class="num">ต้นทุนรวม/ชิ้น</th>' +
          '<th class="num">ราคาขาย/ชิ้น</th><th class="num">กำไร/ชิ้น</th>' +
          '<th class="num">%กำไร</th><th class="num">กำไร/รอบ</th>' +
        '</tr></thead><tbody>' +
        rows.map(function (x) {
          return '<tr>' +
            '<td><button class="btn ghost sm" data-act="open-recipe" data-id="' + x.r.id + '"><strong>' + esc(x.r.name) + '</strong></button></td>' +
            '<td class="muted">' + esc(x.r.baseLabel || '-') + '</td>' +
            '<td class="num">' + num(x.f.pieces, 0) + '</td>' +
            '<td class="num">' + money(x.f.material) + '</td>' +
            '<td class="num"><strong>' + money(x.f.perPiece) + '</strong></td>' +
            '<td class="num">' + money(x.f.sell) + '</td>' +
            '<td class="num ' + (x.f.profitPerPiece >= 0 ? 'good' : 'bad') + '">' + money(x.f.profitPerPiece) + '</td>' +
            '<td class="num">' + pct(x.f.margin) + '</td>' +
            '<td class="num ' + (x.f.profitPerBatch >= 0 ? 'good' : 'bad') + '">' + money(x.f.profitPerBatch) + '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table></div>'
        : '<p class="empty">ยังไม่มีสูตรในระบบ — ไปที่เมนู “สูตรขนม” แล้วกดเพิ่มสูตรใหม่</p>') +
      '</div>' +

      '<div class="card"><h2>วัตถุดิบที่แพงที่สุด (ต่อหน่วย)</h2><div class="table-wrap"><table>' +
        '<thead><tr><th>วัตถุดิบ</th><th class="num">ราคาที่ซื้อ</th><th class="num">ขนาดบรรจุ</th><th class="num">ต้นทุน/หน่วย</th></tr></thead><tbody>' +
        state.data.ingredients.slice().sort(function (a, b) { return unitCost(b) - unitCost(a); }).slice(0, 5)
          .map(function (i) {
            return '<tr><td>' + esc(i.name) + '</td><td class="num">' + money(i.price) + ' บาท</td>' +
              '<td class="num">' + num(i.pack, 0) + ' ' + esc(i.unit) + '</td>' +
              '<td class="num"><strong>' + num(unitCost(i), 4) + '</strong> บาท/' + esc(i.unit) + '</td></tr>';
          }).join('') +
      '</tbody></table></div></div>';
  };

  /* ---------------------------------------------------- สูตรขนม */
  V.recipes = function () {
    var r = currentRecipe();
    var html = head('สูตรขนม', 'แก้ไขปริมาณสูตรฐาน แล้วระบบคิดต้นทุนทุกขนาดรอบผลิตให้อัตโนมัติ',
      '<button class="btn primary" data-act="add-recipe">+ เพิ่มสูตรใหม่</button>');

    html += '<div class="card"><div class="pill-list">' +
      state.data.recipes.map(function (x) {
        return '<button class="pill' + (r && x.id === r.id ? ' is-active' : '') + '" data-act="open-recipe" data-id="' + x.id + '">' + esc(x.name) + '</button>';
      }).join('') +
      '</div></div>';

    if (!r) return html + '<p class="empty">ยังไม่มีสูตร กด “เพิ่มสูตรใหม่” เพื่อเริ่มต้น</p>';

    var c = costOf(r, 1);
    var mults = state.data.multipliers;

    /* ข้อมูลหัวสูตร */
    html += '<div class="card"><h2>ข้อมูลสูตร</h2><div class="grid cols-4">' +
      f('ชื่อสูตร', inp('text', 'r.name', r.name)) +
      f('หมวดหมู่', inp('text', 'r.category', r.category || '')) +
      f('ชื่อสูตรฐาน (เช่น ไข่ 6 ฟอง)', inp('text', 'r.baseLabel', r.baseLabel || '')) +
      f('จำนวนชิ้นที่ได้ต่อสูตรฐาน', inp('number', 'r.basePieces', r.basePieces, 'step="1" min="0"')) +
      '</div>' +
      '<div style="margin-top:12px">' + f('หมายเหตุ', inp('text', 'r.note', r.note || '')) + '</div>' +
      '<div class="actions" style="margin-top:14px">' +
        '<button class="btn danger" data-act="del-recipe" data-id="' + r.id + '">ลบสูตรนี้</button>' +
        '<button class="btn" data-act="dup-recipe" data-id="' + r.id + '">ทำสำเนาสูตร</button>' +
      '</div></div>';

    /* ตารางวัตถุดิบ */
    html += '<div class="card"><h2>วัตถุดิบในสูตรฐาน <span class="hint">ติ๊ก “คิดต้นทุน” ออก = ไม่นับเป็นต้นทุน (เช่น วัตถุดิบที่มีอยู่แล้ว)</span></h2>' +
      '<div class="table-wrap"><table><thead><tr>' +
        '<th style="min-width:170px">วัตถุดิบ</th><th class="num">ปริมาณ</th><th>หน่วย</th>' +
        '<th class="num">ต้นทุน/หน่วย</th><th style="text-align:center">คิดต้นทุน</th>' +
        '<th class="num">ต้นทุน (บาท)</th><th></th>' +
      '</tr></thead><tbody>' +
      c.lines.map(function (l, idx) {
        return '<tr' + (l.item.include ? '' : ' class="row-off"') + '>' +
          '<td>' + select('i.' + idx, l.item.ingredientId) + '</td>' +
          '<td class="num">' + inp('number', 'q.' + idx, l.item.qty, 'step="0.1" min="0" class="cell-num"') + '</td>' +
          '<td class="muted">' + esc(l.unit) + '</td>' +
          '<td class="num muted">' + num(l.unitCost, 4) + '</td>' +
          '<td style="text-align:center"><input type="checkbox" data-bind="c.' + idx + '"' + (l.item.include ? ' checked' : '') + '></td>' +
          '<td class="num"><strong>' + money(l.cost) + '</strong></td>' +
          '<td><button class="btn ghost sm" data-act="del-item" data-idx="' + idx + '" title="ลบแถว">✕</button></td>' +
        '</tr>';
      }).join('') +
      '</tbody><tfoot>' +
        '<tr><td colspan="5">รวมต้นทุนวัตถุดิบ / สูตรฐาน</td><td class="num">' + money(c.total) + '</td><td></td></tr>' +
        '<tr><td colspan="5">ต้นทุนวัตถุดิบต่อชิ้น (' + num(c.pieces, 0) + ' ชิ้น)</td><td class="num">' + money(c.perPiece) + '</td><td></td></tr>' +
      '</tfoot></table></div>' +
      '<div class="actions" style="margin-top:12px"><button class="btn" data-act="add-item">+ เพิ่มวัตถุดิบในสูตร</button></div>' +
      (r.note ? '<div class="note" style="margin-top:12px">' + esc(r.note) + '</div>' : '') +
      '</div>';

    /* ตารางสเกล */
    html += '<div class="card"><h2>ตารางปริมาณตามขนาดรอบผลิต ' +
      '<span class="hint">เหมือนตารางในสมุด — ×1 คือสูตรฐาน</span></h2>' +
      '<div class="table-wrap"><table><thead><tr><th>วัตถุดิบ</th>' +
      mults.map(function (m) {
        var eggs = c.lines.filter(function (l) { return /ไข่/.test(l.name); })[0];
        var sub = eggs ? '<br><span class="muted" style="font-weight:400">ไข่ ' + num(Math.round(eggs.item.qty * m), 0) + ' ฟอง</span>' : '';
        return '<th class="num' + (m === 1 ? ' col-hi' : '') + '">×' + num(m, 2) + sub + '</th>';
      }).join('') + '</tr></thead><tbody>' +
      c.lines.map(function (l, idx) {
        return '<tr' + (l.item.include ? '' : ' class="row-off"') + '><td>' + esc(l.name) + ' <span class="muted">(' + esc(l.unit) + ')</span></td>' +
          mults.map(function (m) {
            return '<td class="num' + (m === 1 ? ' col-hi' : '') + '">' + num(Math.round(l.item.qty * m * 10) / 10, 1) + '</td>';
          }).join('') + '</tr>';
      }).join('') +
      '</tbody><tfoot>' +
        '<tr><td>ต้นทุนวัตถุดิบ (บาท)</td>' + mults.map(function (m) {
          return '<td class="num' + (m === 1 ? ' col-hi' : '') + '">' + money(costOf(r, m).total) + '</td>';
        }).join('') + '</tr>' +
        '<tr><td>จำนวนชิ้นที่ได้</td>' + mults.map(function (m) {
          return '<td class="num' + (m === 1 ? ' col-hi' : '') + '">' + num(Math.round(r.basePieces * m), 0) + '</td>';
        }).join('') + '</tr>' +
        '<tr><td>ต้นทุนวัตถุดิบ/ชิ้น</td>' + mults.map(function (m) {
          return '<td class="num' + (m === 1 ? ' col-hi' : '') + '">' + money(costOf(r, m).perPiece) + '</td>';
        }).join('') + '</tr>' +
      '</tfoot></table></div>' +
      '<div class="actions" style="margin-top:12px">' +
        '<button class="btn" data-act="export-csv">ดาวน์โหลดตารางนี้ (CSV)</button>' +
        '<button class="btn" data-act="print">พิมพ์ / บันทึก PDF</button>' +
      '</div></div>';

    return html;
  };

  /* ---------------------------------------------------- คิดรอบผลิต */
  V.production = function () {
    var r = currentRecipe();
    var html = head('คิดรอบผลิต', 'ระบุจำนวนชิ้นที่ต้องการผลิต ระบบจะคำนวณวัตถุดิบที่ต้องเตรียมและต้นทุนให้');

    if (!r) return html + '<p class="empty">ยังไม่มีสูตรในระบบ</p>';

    html += '<div class="card"><div class="pill-list">' +
      state.data.recipes.map(function (x) {
        return '<button class="pill' + (x.id === r.id ? ' is-active' : '') + '" data-act="open-recipe" data-id="' + x.id + '">' + esc(x.name) + '</button>';
      }).join('') + '</div></div>';

    var target = Math.max(0, state.targetPieces || 0);
    var mult = r.basePieces ? target / r.basePieces : 0;
    var batches = Math.ceil(mult * 100) / 100;
    var c = costOf(r, mult);
    var f2 = fullCost(r);

    html += '<div class="card"><h2>ต้องการผลิตกี่ชิ้น</h2>' +
      '<div class="grid cols-3">' +
        f('จำนวนชิ้นที่ต้องการ', inp('number', 's.targetPieces', target, 'step="1" min="0"')) +
        f('เท่ากับกี่รอบสูตรฐาน', '<div class="big">×' + num(batches, 2) + '</div>') +
        f('สูตรฐาน 1 รอบได้', '<div class="big">' + num(r.basePieces, 0) + ' ชิ้น</div>') +
      '</div></div>' +

      '<div class="grid cols-3">' +
        stat('ต้นทุนวัตถุดิบทั้งหมด', money(c.total) + ' <span class="sub">บาท</span>', 'สำหรับ ' + num(target, 0) + ' ชิ้น', 'brand') +
        stat('ต้นทุนรวมต่อชิ้น', money(f2.perPiece) + ' <span class="sub">บาท</span>', 'รวมบรรจุภัณฑ์ + ค่าแรง') +
        stat('ยอดขายที่ควรได้', money(f2.sell * target) + ' <span class="sub">บาท</span>', 'ที่ราคา ' + money(f2.sell) + ' บาท/ชิ้น', 'good') +
      '</div>' +

      '<div class="card"><h2>รายการวัตถุดิบที่ต้องเตรียม</h2><div class="table-wrap"><table>' +
        '<thead><tr><th>วัตถุดิบ</th><th class="num">ปริมาณที่ต้องใช้</th><th>หน่วย</th><th class="num">ต้นทุน (บาท)</th></tr></thead><tbody>' +
        c.lines.map(function (l) {
          return '<tr' + (l.item.include ? '' : ' class="row-off"') + '><td>' + esc(l.name) + '</td>' +
            '<td class="num"><strong>' + num(l.qty, 1) + '</strong></td>' +
            '<td class="muted">' + esc(l.unit) + '</td>' +
            '<td class="num">' + money(l.cost) + '</td></tr>';
        }).join('') +
        '</tbody><tfoot><tr><td colspan="3">รวม</td><td class="num">' + money(c.total) + '</td></tr></tfoot>' +
      '</table></div>' +
      '<div class="actions" style="margin-top:12px">' +
        '<button class="btn" data-act="export-prod-csv">ดาวน์โหลดใบเตรียมของ (CSV)</button>' +
        '<button class="btn" data-act="print">พิมพ์</button>' +
      '</div></div>';

    return html;
  };

  /* ---------------------------------------------------- ตั้งราคาขาย */
  V.pricing = function () {
    var r = currentRecipe();
    var html = head('ตั้งราคาขาย', 'บวกค่าบรรจุภัณฑ์และค่าแรงเข้าไป เพื่อดูกำไรที่แท้จริง');
    if (!r) return html + '<p class="empty">ยังไม่มีสูตรในระบบ</p>';

    html += '<div class="card"><div class="pill-list">' +
      state.data.recipes.map(function (x) {
        return '<button class="pill' + (x.id === r.id ? ' is-active' : '') + '" data-act="open-recipe" data-id="' + x.id + '">' + esc(x.name) + '</button>';
      }).join('') + '</div></div>';

    var p = r.pricing || (r.pricing = { packaging: 0, labor: 0, sellPrice: 0 });
    var k = fullCost(r);

    html += '<div class="card"><h2>ต้นทุนที่ต้องบวกเพิ่ม (ต่อ 1 สูตรฐาน)</h2><div class="grid cols-3">' +
      f('ค่าบรรจุภัณฑ์ต่อชิ้น (บาท)', inp('number', 'p.packaging', p.packaging || 0, 'step="0.25" min="0"')) +
      f('ค่าแรง + ค่าแก๊ส/ไฟ ต่อรอบ (บาท)', inp('number', 'p.labor', p.labor || 0, 'step="1" min="0"')) +
      f('ราคาขายต่อชิ้น (บาท)', inp('number', 'p.sellPrice', p.sellPrice || 0, 'step="0.5" min="0"')) +
      '</div></div>';

    html += '<div class="grid cols-4">' +
      stat('ต้นทุนรวมต่อชิ้น', money(k.perPiece) + ' <span class="sub">บาท</span>', 'วัตถุดิบ ' + money(k.material / (k.pieces || 1)) + ' + อื่น ๆ') +
      stat('กำไรต่อชิ้น', money(k.profitPerPiece) + ' <span class="sub">บาท</span>', '', k.profitPerPiece >= 0 ? 'good' : '') +
      stat('% กำไรจากราคาขาย', pct(k.margin), 'ขนมอบทั่วไปควรได้ 50–65%') +
      stat('ต้องขายกี่ชิ้นถึงคุ้มทุน', num(k.breakEven, 0) + ' <span class="sub">ชิ้น</span>', 'จากทั้งหมด ' + num(k.pieces, 0) + ' ชิ้น') +
      '</div>';

    html += '<div class="grid cols-2">' +
      '<div class="card"><h2>สรุปต่อ 1 รอบผลิต</h2><div class="table-wrap"><table><tbody>' +
        kv('ค่าวัตถุดิบ', money(k.material) + ' บาท') +
        kv('ค่าบรรจุภัณฑ์ (' + num(k.pieces, 0) + ' ชิ้น)', money((p.packaging || 0) * k.pieces) + ' บาท') +
        kv('ค่าแรง / ค่าแก๊ส-ไฟ', money(p.labor || 0) + ' บาท') +
        kv('<strong>ต้นทุนรวม</strong>', '<strong>' + money(k.total) + ' บาท</strong>') +
        kv('รายได้ถ้าขายหมด', money(k.revenue) + ' บาท') +
        kv('<strong>กำไรต่อรอบ</strong>', '<strong class="' + (k.profitPerBatch >= 0 ? 'good' : 'bad') + '">' + money(k.profitPerBatch) + ' บาท</strong>') +
      '</tbody></table></div></div>' +

      '<div class="card"><h2>ราคาแนะนำ <span class="hint">คิดจากต้นทุนรวมต่อชิ้น</span></h2><div class="table-wrap"><table>' +
        '<thead><tr><th>บวกกำไรจากต้นทุน</th><th class="num">ราคาที่คำนวณได้</th><th class="num">ราคาแนะนำ</th><th class="num">กำไร/ชิ้น</th></tr></thead><tbody>' +
        [0.5, 0.8, 1.0, 1.5, 2.0].map(function (m) {
          var raw = k.perPiece * (1 + m);
          var sug = Math.ceil(raw);
          return '<tr><td>+' + num(m * 100, 0) + '%</td><td class="num muted">' + money(raw) + '</td>' +
            '<td class="num"><strong>' + num(sug, 0) + ' บาท</strong></td>' +
            '<td class="num good">' + money(sug - k.perPiece) + '</td></tr>';
        }).join('') +
      '</tbody></table></div>' +
      '<div class="note" style="margin-top:12px">ราคาแนะนำยังไม่รวมค่าธรรมเนียมแอปเดลิเวอรี (ปกติหัก 30–32%) — ถ้าขายผ่านแอปควรตั้งสูงกว่าหน้าร้าน</div>' +
      '</div></div>';

    return html;
  };

  /* ---------------------------------------------------- บัญชีรายวัน */

  /** คำนวณยอดคงเหลือสะสมทีละแถวตามหลักสมุดเงินสด (Cash Book):
   *  ยอดคงเหลือ[i] = ยอดคงเหลือ[i-1] + รายรับ - รายจ่าย, เริ่มจากยอดยกมา */
  function ledgerComputed() {
    var L = state.data.ledger || { openingBalance: 0, entries: [] };
    var sorted = (L.entries || []).slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.id < b.id ? -1 : 1; // id ขึ้นต้นด้วย timestamp base36 เรียงตามเวลาบันทึกได้
    });
    var bal = L.openingBalance || 0;
    var totalIncome = 0, totalExpense = 0;
    var rows = sorted.map(function (e) {
      if (e.type === 'income') { bal += e.amount; totalIncome += e.amount; }
      else { bal -= e.amount; totalExpense += e.amount; }
      return { id: e.id, date: e.date, desc: e.desc, type: e.type, category: e.category, amount: e.amount, balance: bal };
    });
    return {
      opening: L.openingBalance || 0,
      rows: rows,
      latestBalance: rows.length ? rows[rows.length - 1].balance : (L.openingBalance || 0),
      totalIncome: totalIncome,
      totalExpense: totalExpense,
      net: totalIncome - totalExpense
    };
  }

  function ledgerCategorySelect() {
    var list = state.ledgerDraftType === 'income' ? INCOME_CATS : EXPENSE_CATS;
    return '<select id="ldgCategory">' + list.map(function (c) {
      return '<option value="' + c.id + '">' + esc(c.label) + '</option>';
    }).join('') + '</select>';
  }

  V.ledger = function () {
    var all = ledgerComputed();
    var isAll = state.ledgerDate === 'all';
    var dateRows = isAll ? all.rows : all.rows.filter(function (r) { return r.date === state.ledgerDate; });

    // ยอดคงเหลือสะสม ณ สิ้นวันที่เลือก (ถ้าวันนั้นไม่มีรายการ ใช้ยอดล่าสุดของวันก่อนหน้า)
    var balanceAsOf = all.opening;
    all.rows.forEach(function (r) { if (isAll || r.date <= state.ledgerDate) balanceAsOf = r.balance; });
    var dayIncome = 0, dayExpense = 0;
    dateRows.forEach(function (r) { if (r.type === 'income') dayIncome += r.amount; else dayExpense += r.amount; });

    var html = head('บัญชีรายวัน', 'สมุดเงินสดประจำวัน — บันทึกรายรับ-รายจ่าย ระบบคำนวณยอดคงเหลือสะสมให้อัตโนมัติ');

    html += '<div class="grid cols-4">' +
      stat('ยอดคงเหลือสะสมล่าสุด', money(all.latestBalance) + ' <span class="sub">บาท</span>',
        'ยอดยกมา + รายรับ - รายจ่ายทั้งหมด', all.latestBalance >= 0 ? 'good' : '') +
      stat('รายรับสะสมทั้งหมด', money(all.totalIncome) + ' <span class="sub">บาท</span>', '') +
      stat('รายจ่ายสะสมทั้งหมด', money(all.totalExpense) + ' <span class="sub">บาท</span>', '') +
      stat('กำไร/ขาดทุนสะสม', money(all.net) + ' <span class="sub">บาท</span>', '', all.net >= 0 ? 'good' : 'bad') +
    '</div>';

    html += '<div class="card"><h2>บันทึกรายการใหม่</h2><div class="grid cols-4">' +
        f('วันที่', '<input type="date" id="ldgDate" value="' + esc(isAll ? todayStr() : state.ledgerDate) + '">') +
        f('รายการ', '<input type="text" id="ldgDesc" placeholder="เช่น ขายเค้กกล้วยหอม 10 กล่อง">') +
        f('จำนวนเงิน (บาท)', '<input type="number" id="ldgAmount" min="0" step="0.01" placeholder="0.00">') +
        f('หมวด', ledgerCategorySelect()) +
      '</div>' +
      '<div class="pill-list" style="margin-top:12px">' +
        '<button type="button" class="pill' + (state.ledgerDraftType === 'income' ? ' is-active' : '') + '" data-act="ldg-type" data-type="income">💰 รายรับ</button>' +
        '<button type="button" class="pill' + (state.ledgerDraftType === 'expense' ? ' is-active' : '') + '" data-act="ldg-type" data-type="expense">💸 รายจ่าย</button>' +
      '</div>' +
      (state.ledgerFormError ? '<div class="form-error" style="margin-top:12px">' + esc(state.ledgerFormError) + '</div>' : '') +
      '<div class="actions" style="margin-top:14px"><button class="btn primary" data-act="ldg-add">+ บันทึกรายการ</button></div>' +
    '</div>';

    html += '<div class="card"><h2>รายการ</h2>' +
      '<div class="grid cols-2" style="align-items:end;margin-bottom:14px">' +
        f('ดูรายการวันที่', '<input type="date" data-bind="lfd" data-fkey="lfd" value="' + esc(isAll ? '' : state.ledgerDate) + '">') +
        '<div class="actions">' +
          '<button class="btn' + (isAll ? ' primary' : '') + '" data-act="ldg-showall">ดูทั้งหมด</button>' +
          '<button class="btn' + (!isAll && state.ledgerDate === todayStr() ? ' primary' : '') + '" data-act="ldg-today">วันนี้</button>' +
        '</div>' +
      '</div>' +
      (!isAll ? '<div class="grid cols-3" style="margin-bottom:14px">' +
          stat('รายรับวันนี้', money(dayIncome) + ' <span class="sub">บาท</span>', '') +
          stat('รายจ่ายวันนี้', money(dayExpense) + ' <span class="sub">บาท</span>', '') +
          stat('คงเหลือสะสม ณ สิ้นวันนี้', money(balanceAsOf) + ' <span class="sub">บาท</span>', '', balanceAsOf >= 0 ? 'good' : 'bad') +
        '</div>' : '') +
      (dateRows.length
        ? '<div class="table-wrap"><table><thead><tr>' +
            '<th>วันที่</th><th>รายการ</th><th>หมวด</th><th class="num">รายรับ</th><th class="num">รายจ่าย</th><th class="num">คงเหลือสะสม</th><th></th>' +
          '</tr></thead><tbody>' +
          dateRows.map(function (r) {
            return '<tr>' +
              '<td>' + thDate(r.date) + '</td>' +
              '<td>' + esc(r.desc) + '</td>' +
              '<td class="muted">' + esc(ledgerCatLabel(r.category)) + '</td>' +
              '<td class="num good">' + (r.type === 'income' ? money(r.amount) : '<span class="muted">-</span>') + '</td>' +
              '<td class="num bad">' + (r.type === 'expense' ? money(r.amount) : '<span class="muted">-</span>') + '</td>' +
              '<td class="num"><strong>' + money(r.balance) + '</strong></td>' +
              '<td><button class="btn ghost sm" data-act="ldg-del" data-id="' + r.id + '">✕</button></td>' +
            '</tr>';
          }).join('') +
          '</tbody></table></div>'
        : '<p class="empty">ยังไม่มีรายการ' + (isAll ? '' : 'ในวันที่เลือก') + '</p>') +
      '<div class="actions" style="margin-top:14px">' +
        '<button class="btn" data-act="ldg-export">ดาวน์โหลดบัญชี (CSV)</button>' +
        '<button class="btn" data-act="print">พิมพ์</button>' +
      '</div>' +
    '</div>';

    html += '<div class="card"><h2>ยอดยกมา <span class="hint">ยอดคงเหลือก่อนเริ่มบันทึกในระบบนี้ (ถ้ามี)</span></h2>' +
      f('ยอดยกมา (บาท)', inp('number', 'lob', all.opening, 'step="0.01"')) +
    '</div>';

    return html;
  };

  /* ---------------------------------------------------- วัตถุดิบ */
  V.ingredients = function () {
    var list = state.data.ingredients;
    var html = head('คลังราคาวัตถุดิบ', 'แก้ราคาที่นี่ที่เดียว — ต้นทุนทุกสูตรอัปเดตตามทันที',
      '<button class="btn primary" data-act="add-ing">+ เพิ่มวัตถุดิบ</button>');

    // แถบหมวดหมู่ + จำนวนวัตถุดิบต่อหมวด
    var counts = { all: list.length };
    CATEGORIES.forEach(function (c) { counts[c.id] = 0; });
    list.forEach(function (i) { counts[catOf(i)]++; });

    html += '<div class="card"><div class="pill-list">' +
      '<button class="pill' + (state.ingFilter === 'all' ? ' is-active' : '') + '" data-act="filter-ing" data-cat="all">ทั้งหมด (' + counts.all + ')</button>' +
      CATEGORIES.map(function (c) {
        return '<button class="pill' + (state.ingFilter === c.id ? ' is-active' : '') + '" data-act="filter-ing" data-cat="' + c.id + '">' +
          esc(c.label) + ' (' + counts[c.id] + ')</button>';
      }).join('') +
      '</div></div>';

    var groups = state.ingFilter === 'all'
      ? CATEGORIES
      : CATEGORIES.filter(function (c) { return c.id === state.ingFilter; });

    groups.forEach(function (cat) {
      var rows = [];
      list.forEach(function (i, idx) { if (catOf(i) === cat.id) rows.push({ i: i, idx: idx }); });
      if (!rows.length) return;

      html += '<div class="card"><h2>' + esc(cat.label) + ' <span class="hint">' + rows.length + ' รายการ</span></h2>' +
        '<div class="table-wrap"><table><thead><tr>' +
        '<th style="min-width:150px">ชื่อวัตถุดิบ</th><th>หน่วยในสูตร</th>' +
        '<th class="num">ขนาดบรรจุ</th><th class="num">ราคาที่ซื้อ (บาท)</th>' +
        '<th class="num">ต้นทุน/หน่วย</th><th style="min-width:150px">หมวดหมู่</th>' +
        '<th style="min-width:180px">หมายเหตุ</th><th></th>' +
        '</tr></thead><tbody>' +
        rows.map(function (row) {
          var i = row.i, idx = row.idx;
          var used = state.data.recipes.filter(function (r) {
            return r.items.some(function (it) { return it.ingredientId === i.id; });
          }).length;
          return '<tr>' +
            '<td>' + inp('text', 'g.name.' + idx, i.name) + '</td>' +
            '<td>' + inp('text', 'g.unit.' + idx, i.unit, 'style="max-width:90px"') + '</td>' +
            '<td class="num">' + inp('number', 'g.pack.' + idx, i.pack, 'step="1" min="0" class="cell-num"') + '</td>' +
            '<td class="num">' + inp('number', 'g.price.' + idx, i.price, 'step="0.25" min="0" class="cell-num"') + '</td>' +
            '<td class="num"><strong>' + num(unitCost(i), 4) + '</strong><br><span class="muted" style="font-size:12px">บาท/' + esc(i.unit) + '</span></td>' +
            '<td>' + categorySelect('g.category.' + idx, catOf(i)) + '</td>' +
            '<td>' + inp('text', 'g.note.' + idx, i.note || '') + '</td>' +
            '<td>' + (used ? '<span class="chip">ใช้ใน ' + used + ' สูตร</span>' :
              '<button class="btn ghost sm" data-act="del-ing" data-idx="' + idx + '">✕</button>') + '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table></div></div>';
    });

    if (state.ingFilter !== 'all' && !list.some(function (i) { return catOf(i) === state.ingFilter; })) {
      html += '<p class="empty">ยังไม่มีวัตถุดิบในหมวดนี้</p>';
    }

    return html;
  };

  /* ---------------------------------------------------- ข้อมูล */
  V.data = function () {
    return head('ข้อมูลระบบ', 'สำรอง กู้คืน และรีเซ็ตข้อมูล') +
      '<div class="note">ข้อมูลถูกเก็บไว้ในเบราว์เซอร์ของเครื่องนี้เท่านั้น ถ้าจะย้ายไปเครื่องอื่นหรือให้เพื่อนร่วมงานใช้ ให้กด “ดาวน์โหลดไฟล์สำรอง” แล้วเอาไฟล์ไป “นำเข้า” ที่เครื่องปลายทาง</div>' +
      '<div class="card"><h2>สำรอง / กู้คืน</h2><div class="actions">' +
        '<button class="btn primary" data-act="export-json">ดาวน์โหลดไฟล์สำรอง (JSON)</button>' +
        '<button class="btn" data-act="import-json">นำเข้าไฟล์สำรอง</button>' +
        '<button class="btn" data-act="export-all-csv">ส่งออกวัตถุดิบ (CSV)</button>' +
        '<input type="file" id="importFile" accept="application/json,.json" hidden>' +
      '</div></div>' +
      '<div class="card"><h2>รีเซ็ต</h2>' +
        '<p class="muted" style="margin-top:0">คืนค่าทุกอย่างกลับเป็นข้อมูลตั้งต้นจากสมุดจดสูตร (สูตรเค้กกล้วยหอม + วัตถุดิบ 12 รายการ)</p>' +
        '<div class="actions"><button class="btn danger" data-act="reset">รีเซ็ตเป็นข้อมูลตั้งต้น</button></div>' +
      '</div>' +
      '<div class="card"><h2>ที่มาของข้อมูล</h2><ul class="muted" style="margin:0;padding-left:20px">' +
        '<li>ถอดจากสมุดจดสูตรเค้กกล้วยหอม (ตารางปริมาณ 9 ขนาดรอบผลิต + ราคาทุนต่อหน่วย)</li>' +
        '<li>ยอดรวมต้นทุนสูตรฐานในสมุด = 150.033 บาท · ระบบคำนวณได้ 150.04 บาท (ต่างจากการปัดเศษในสมุด)</li>' +
        '<li>“กล้วยหอมสุก” และ “กรดมะนาว” ถูกตั้งเป็นไม่คิดต้นทุน เพื่อให้ตรงกับยอดรวมในสมุด</li>' +
        '<li>จำนวน 25 ชิ้น/สูตรฐาน ประมาณจากบันทึก “6 บาทต่อชิ้น” ในสมุด</li>' +
      '</ul></div>';
  };

  /* ============================================================ ui helpers */

  function head(title, sub, right) {
    return '<div class="page-head"><div><h1>' + esc(title) + '</h1><p>' + esc(sub) + '</p></div>' +
      '<div class="actions no-print">' + (right || '') + '</div></div>';
  }
  function stat(label, value, sub, cls) {
    return '<div class="stat ' + (cls || '') + '"><div class="label">' + esc(label) + '</div>' +
      '<div class="value">' + value + '</div>' + (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</div>';
  }
  function f(label, control) {
    return '<div><label class="field">' + esc(label) + '</label>' + control + '</div>';
  }
  function inp(type, bind, value, extra) {
    return '<input type="' + type + '" data-bind="' + bind + '" data-fkey="' + bind + '" value="' +
      esc(value) + '" ' + (extra || '') + '>';
  }
  function select(bind, value) {
    var groups = {};
    state.data.ingredients.forEach(function (i) {
      var cat = catOf(i);
      (groups[cat] = groups[cat] || []).push(i);
    });
    var body = CATEGORIES.map(function (c) {
      var items = groups[c.id];
      if (!items || !items.length) return '';
      return '<optgroup label="' + esc(c.label) + '">' + items.map(function (i) {
        return '<option value="' + i.id + '"' + (i.id === value ? ' selected' : '') + '>' + esc(i.name) + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
    return '<select data-bind="' + bind + '" data-fkey="' + bind + '">' + body + '</select>';
  }
  function categorySelect(bind, value) {
    return '<select data-bind="' + bind + '" data-fkey="' + bind + '">' +
      CATEGORIES.map(function (c) {
        return '<option value="' + c.id + '"' + (c.id === value ? ' selected' : '') + '>' + esc(c.label) + '</option>';
      }).join('') + '</select>';
  }
  function kv(k, v) {
    return '<tr><td>' + k + '</td><td class="num">' + v + '</td></tr>';
  }

  /* ============================================================ render */

  function render() {
    var active = document.activeElement;
    var fkey = active && active.dataset ? active.dataset.fkey : null;
    var pos = null;
    try { pos = active ? active.selectionStart : null; } catch (e) { /* number input */ }

    app.innerHTML = (V[state.view] || V.dashboard)();

    Array.prototype.forEach.call(document.querySelectorAll('#nav .tab'), function (b) {
      b.classList.toggle('is-active', b.dataset.view === state.view);
    });

    if (fkey) {
      var el = app.querySelector('[data-fkey="' + fkey + '"]');
      if (el) {
        el.focus();
        try { if (pos != null) el.setSelectionRange(pos, pos); } catch (e) { /* ignore */ }
      }
    }
    stamp();
  }

  /* ============================================================ events */

  document.getElementById('nav').addEventListener('click', function (e) {
    var b = e.target.closest('.tab');
    if (!b) return;
    state.view = b.dataset.view;
    render();
  });

  /* ปุ่ม "โหลดข้อมูลล่าสุด" ในแถบแจ้งเตือน conflict — อยู่นอก #app จึงต้องผูก listener แยกต่างหาก */
  var saveAlertEl = document.getElementById('saveAlert');
  if (saveAlertEl) {
    saveAlertEl.addEventListener('click', function (e) {
      if (e.target.id !== 'conflictReloadBtn' || !conflict) return;
      if (!confirm('การโหลดข้อมูลล่าสุดจะทิ้งการแก้ไขที่ยังไม่ได้บันทึกในเครื่องนี้ทิ้งไป ต้องการดำเนินการต่อไหม?')) return;
      state.data = conflict;
      conflict = null;
      dirty = false;
      markPendingLocal(false); // ผู้ใช้เลือกทิ้งของที่ค้างไว้เองแล้ว ไม่งั้นบูตครั้งหน้าจะยังคิดว่ามีของค้างอยู่
      cacheLocal();
      hideSaveError();
      if (!state.data.recipes.some(function (r) { return r.id === state.recipeId; })) {
        state.recipeId = state.data.recipes.length ? state.data.recipes[0].id : null;
      }
      render();
      toast('โหลดข้อมูลล่าสุดแล้ว');
    });
  }

  /* ผูกค่าจาก input กลับเข้า model */
  app.addEventListener('input', function (e) {
    var el = e.target;
    var bind = el.dataset ? el.dataset.bind : null;
    if (!bind) return;

    var val = el.type === 'checkbox' ? el.checked
      : el.type === 'number' ? (parseFloat(el.value) || 0)
        : el.value;
    var part = bind.split('.');
    var r = currentRecipe();

    if (part[0] === 'r' && r) { r[part[1]] = val; }
    else if (part[0] === 'p' && r) { r.pricing[part[1]] = val; }
    else if (part[0] === 'q' && r) { r.items[+part[1]].qty = val; }
    else if (part[0] === 'c' && r) { r.items[+part[1]].include = val; }
    else if (part[0] === 'i' && r) { r.items[+part[1]].ingredientId = val; }
    else if (part[0] === 'g') { state.data.ingredients[+part[2]][part[1]] = val; }
    else if (part[0] === 's') { state.targetPieces = val; render(); return; }
    else if (part[0] === 'lfd') { state.ledgerDate = val || 'all'; render(); return; }
    else if (part[0] === 'lob') { state.data.ledger.openingBalance = val; }

    save();
    render();
  });

  app.addEventListener('change', function (e) {
    if (e.target.id === 'importFile' && e.target.files[0]) importFile(e.target.files[0]);
  });

  app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var act = b.dataset.act;
    var r = currentRecipe();

    if (act === 'open-recipe') {
      state.recipeId = b.dataset.id;
      if (state.view === 'dashboard') state.view = 'recipes';
      render();

    } else if (act === 'add-recipe') {
      var nr = {
        id: uid('rcp'), name: 'สูตรใหม่', category: '', baseLabel: '1 รอบ',
        basePieces: 10, note: '', items: [], pricing: { packaging: 0, labor: 0, sellPrice: 0 }
      };
      state.data.recipes.push(nr);
      state.recipeId = nr.id;
      state.view = 'recipes';
      save('เพิ่มสูตรใหม่แล้ว'); render();

    } else if (act === 'dup-recipe' && r) {
      var cp = clone(r);
      cp.id = uid('rcp');
      cp.name = r.name + ' (สำเนา)';
      state.data.recipes.push(cp);
      state.recipeId = cp.id;
      save('ทำสำเนาแล้ว'); render();

    } else if (act === 'del-recipe' && r) {
      if (!confirm('ลบสูตร “' + r.name + '” ?')) return;
      state.data.recipes = state.data.recipes.filter(function (x) { return x.id !== r.id; });
      state.recipeId = state.data.recipes.length ? state.data.recipes[0].id : null;
      save('ลบสูตรแล้ว'); render();

    } else if (act === 'add-item' && r) {
      if (!state.data.ingredients.length) return toast('ยังไม่มีวัตถุดิบในคลัง');
      r.items.push({ ingredientId: state.data.ingredients[0].id, qty: 0, include: true });
      save(); render();

    } else if (act === 'del-item' && r) {
      r.items.splice(+b.dataset.idx, 1);
      save(); render();

    } else if (act === 'add-ing') {
      var newCat = state.ingFilter !== 'all' ? state.ingFilter : 'other';
      state.data.ingredients.push({ id: uid('ing'), name: 'วัตถุดิบใหม่', unit: 'กรัม', pack: 1000, price: 0, note: '', category: newCat });
      save('เพิ่มวัตถุดิบแล้ว'); render();

    } else if (act === 'filter-ing') {
      state.ingFilter = b.dataset.cat;
      render();

    } else if (act === 'del-ing') {
      state.data.ingredients.splice(+b.dataset.idx, 1);
      save(); render();

    } else if (act === 'export-csv' && r) {
      exportScaleCsv(r);

    } else if (act === 'export-prod-csv' && r) {
      exportProdCsv(r);

    } else if (act === 'export-all-csv') {
      var rows = [['ชื่อวัตถุดิบ', 'หน่วย', 'ขนาดบรรจุ', 'ราคาที่ซื้อ', 'ต้นทุนต่อหน่วย', 'หมายเหตุ']];
      state.data.ingredients.forEach(function (i) {
        rows.push([i.name, i.unit, i.pack, i.price, unitCost(i).toFixed(4), i.note || '']);
      });
      download('วัตถุดิบ.csv', csv(rows), 'text/csv;charset=utf-8');

    } else if (act === 'export-json') {
      download('bakery-khunkai-backup.json', JSON.stringify(state.data, null, 2), 'application/json');

    } else if (act === 'import-json') {
      document.getElementById('importFile').click();

    } else if (act === 'reset') {
      if (!confirm('รีเซ็ตข้อมูลทั้งหมดกลับเป็นค่าตั้งต้น?')) return;
      var keepVersionReset = state.data.stateVersion; // รักษา stateVersion ปัจจุบันไว้ ไม่งั้นระบบกันเขียนทับจะปฏิเสธการบันทึกนี้
      state.data = clone(window.SEED_DATA);
      state.data.stateVersion = keepVersionReset;
      state.recipeId = null;
      save('รีเซ็ตเรียบร้อย'); render();

    } else if (act === 'print') {
      window.print();

    } else if (act === 'ldg-type') {
      state.ledgerDraftType = b.dataset.type;
      state.ledgerFormError = '';
      render();

    } else if (act === 'ldg-add') {
      var descEl = document.getElementById('ldgDesc');
      var amtEl = document.getElementById('ldgAmount');
      var dateEl = document.getElementById('ldgDate');
      var catEl = document.getElementById('ldgCategory');
      var desc = descEl ? descEl.value.trim() : '';
      var amount = amtEl ? parseFloat(amtEl.value) : NaN;
      var ldgDate = (dateEl && dateEl.value) ? dateEl.value : todayStr();
      var category = catEl ? catEl.value : '';

      if (!desc) { state.ledgerFormError = 'กรุณากรอกรายการ'; render(); return; }
      if (!isFinite(amount) || amount <= 0) { state.ledgerFormError = 'กรุณากรอกจำนวนเงินให้ถูกต้อง (มากกว่า 0)'; render(); return; }
      if (!category) { state.ledgerFormError = 'กรุณาเลือกหมวด'; render(); return; }

      state.data.ledger.entries.push({
        id: uid('ldg'), date: ldgDate, desc: desc,
        type: state.ledgerDraftType, category: category, amount: amount
      });
      state.ledgerFormError = '';
      state.ledgerDate = ldgDate;
      save('บันทึกรายการแล้ว'); render();

    } else if (act === 'ldg-del') {
      if (!confirm('ลบรายการนี้?')) return;
      state.data.ledger.entries = state.data.ledger.entries.filter(function (x) { return x.id !== b.dataset.id; });
      save(); render();

    } else if (act === 'ldg-showall') {
      state.ledgerDate = 'all';
      render();

    } else if (act === 'ldg-today') {
      state.ledgerDate = todayStr();
      render();

    } else if (act === 'ldg-export') {
      exportLedgerCsv();
    }
  });

  /* ============================================================ export */

  function csv(rows) {
    return '﻿' + rows.map(function (r) {
      return r.map(function (c) {
        c = String(c == null ? '' : c);
        return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
      }).join(',');
    }).join('\r\n');
  }

  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('ดาวน์โหลดแล้ว: ' + name);
  }

  function exportScaleCsv(r) {
    var mults = state.data.multipliers;
    var base = costOf(r, 1);
    var rows = [['สูตร: ' + r.name], ['วัตถุดิบ', 'หน่วย', 'ต้นทุน/หน่วย'].concat(mults.map(function (m) { return '×' + m; }))];
    base.lines.forEach(function (l) {
      rows.push([l.name, l.unit, l.unitCost.toFixed(4)].concat(mults.map(function (m) {
        return Math.round(l.item.qty * m * 10) / 10;
      })));
    });
    rows.push(['ต้นทุนวัตถุดิบ (บาท)', '', ''].concat(mults.map(function (m) { return costOf(r, m).total.toFixed(2); })));
    rows.push(['จำนวนชิ้น', '', ''].concat(mults.map(function (m) { return Math.round(r.basePieces * m); })));
    rows.push(['ต้นทุน/ชิ้น', '', ''].concat(mults.map(function (m) { return costOf(r, m).perPiece.toFixed(2); })));
    download('สูตร-' + r.name + '.csv', csv(rows), 'text/csv;charset=utf-8');
  }

  function exportProdCsv(r) {
    var target = state.targetPieces || 0;
    var mult = r.basePieces ? target / r.basePieces : 0;
    var c = costOf(r, mult);
    var rows = [['ใบเตรียมวัตถุดิบ — ' + r.name + ' จำนวน ' + target + ' ชิ้น'],
      ['วัตถุดิบ', 'ปริมาณ', 'หน่วย', 'ต้นทุน (บาท)']];
    c.lines.forEach(function (l) { rows.push([l.name, l.qty, l.unit, l.cost.toFixed(2)]); });
    rows.push(['รวม', '', '', c.total.toFixed(2)]);
    download('ใบเตรียมของ-' + r.name + '.csv', csv(rows), 'text/csv;charset=utf-8');
  }

  function exportLedgerCsv() {
    var all = ledgerComputed();
    var rows = [
      ['บัญชีรายวัน — Bakery By Khunkai'],
      ['ยอดยกมา (บาท)', all.opening.toFixed(2)],
      [],
      ['วันที่', 'รายการ', 'หมวด', 'รายรับ', 'รายจ่าย', 'คงเหลือสะสม']
    ];
    all.rows.forEach(function (r) {
      rows.push([
        r.date, r.desc, ledgerCatLabel(r.category),
        r.type === 'income' ? r.amount.toFixed(2) : '',
        r.type === 'expense' ? r.amount.toFixed(2) : '',
        r.balance.toFixed(2)
      ]);
    });
    rows.push(['รวม', '', '', all.totalIncome.toFixed(2), all.totalExpense.toFixed(2), all.latestBalance.toFixed(2)]);
    download('บัญชีรายวัน.csv', csv(rows), 'text/csv;charset=utf-8');
  }

  function importFile(file) {
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var d = JSON.parse(fr.result);
        if (!d.ingredients || !d.recipes) throw new Error('รูปแบบไฟล์ไม่ถูกต้อง');
        // ใช้ stateVersion ปัจจุบันที่ระบบรู้จักอยู่แล้ว ไม่ใช่ค่าที่ติดมากับไฟล์ backup (อาจเก่ากว่ามาก)
        // ไม่งั้นระบบกันเขียนทับจะปฏิเสธการบันทึกนี้ทันที
        var keepVersionImport = state.data.stateVersion;
        state.data = d;
        state.data.stateVersion = keepVersionImport;
        if (!d.multipliers) d.multipliers = clone(window.SEED_DATA.multipliers);
        if (!d.ledger || !Array.isArray(d.ledger.entries)) d.ledger = { openingBalance: 0, entries: [] };
        state.recipeId = null;
        save('นำเข้าข้อมูลเรียบร้อย'); render();
      } catch (err) {
        alert('นำเข้าไม่สำเร็จ: ' + err.message);
      }
    };
    fr.readAsText(file);
  }

  /* ============================================================ start */

  // 1) วาดหน้าจอทันทีด้วยข้อมูลที่แคชไว้ในเครื่อง (ให้เปิดเว็บได้ไวแม้เน็ตช้า)
  state.data = loadLocal();
  if (!state.data.ledger || !Array.isArray(state.data.ledger.entries)) {
    state.data.ledger = { openingBalance: 0, entries: [] };
  }
  if (state.data.recipes.length) state.recipeId = state.data.recipes[0].id;
  state.ledgerDate = todayStr();
  // มีการแก้ไขจากเซสชันก่อนหน้าที่ "ยังไม่ยืนยันว่าบันทึกขึ้น D1 สำเร็จ" ค้างอยู่ไหม (เช่น ปิดแท็บ/เครื่องรีสตาร์ท
  // /เบราว์เซอร์ suspend แท็บพื้นหลังระหว่างกำลังจะบันทึก) — ถ้ามี ต้องจัดการให้ครบก่อนค่อยยอมให้ทับด้วยข้อมูลเซิร์ฟเวอร์
  var hadPendingSave = readPendingLocal();
  if (hadPendingSave) dirty = true;
  render();

  // 2) แล้วค่อยซิงก์กับฐานข้อมูลกลาง (Cloudflare D1) เพื่อให้เห็นข้อมูลล่าสุดที่ทุกคนแก้ร่วมกัน
  loadRemote().then(function (remote) {
    if (!remote) { stamp(); return; }

    if (hadPendingSave && state.data.stateVersion) {
      // ห้ามทับ state.data ด้วยข้อมูลจากเซิร์ฟเวอร์เงียบ ๆ เด็ดขาด — ต้องเช็คก่อนว่าปลอดภัยจริงไหม
      if (remote.stateVersion === state.data.stateVersion) {
        // เซิร์ฟเวอร์ยังเป็น version เดิมตั้งแต่ตอนนั้น -> ไม่มีใครแตะต้องอะไรเลย ส่งของที่ค้างไว้ขึ้นได้ทันที
        lastSyncAt = Date.now();
        doPutNow();
      } else {
        // มีคนอื่นบันทึกไปแล้วระหว่างที่แท็บนี้ปิด/ไม่ได้ใช้งาน -> คงข้อมูลในเครื่อง (ที่ยังเห็นบนจอ) ไว้ก่อน
        // แล้วแจ้งเตือนให้ผู้ใช้เลือกเอง แทนที่จะทิ้งการแก้ไขของเขาไปเงียบ ๆ
        conflict = remote;
        apiAvailable = true;
        lastSyncAt = Date.now();
        stamp();
        showConflictAlert();
      }
      render();
      return;
    }

    state.data = remote;
    if (!state.data.ledger || !Array.isArray(state.data.ledger.entries)) {
      state.data.ledger = { openingBalance: 0, entries: [] };
    }
    cacheLocal();
    if (!state.data.recipes.some(function (r) { return r.id === state.recipeId; })) {
      state.recipeId = state.data.recipes.length ? state.data.recipes[0].id : null;
    }
    render();
  });

  // 3) เช็คว่า D1 กลับมาต่อได้หรือยังเป็นระยะ ๆ ตลอดเวลาที่เปิดหน้าเว็บทิ้งไว้
  setInterval(pingReconnect, RECONNECT_PING_MS);
})();
