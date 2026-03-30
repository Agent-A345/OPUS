/* ============================================================
   OPUS — Task Intelligence | script.js
   ============================================================ */

'use strict';

/* ── STATE ────────────────────────────────────────────────── */
let tasks = [];
let currentFilter = 'all';
let currentSort = 'created-desc';
let focusMode = false;
let searchQuery = '';
let dragSrcIndex = null;
let notifTimers = {};
let rafId = null;
let editPriority = 'medium';
const STORAGE_KEY = 'opus_tasks_v2';

/* ── UTILS ────────────────────────────────────────────────── */
const uid = () => `t_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
const $ = id => document.getElementById(id);
const qs = (sel, ctx = document) => ctx.querySelector(sel);
const now = () => Date.now();

function formatDeadline(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate()+1);
  const dDay = new Date(d); dDay.setHours(0,0,0,0);
  const timeStr = d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  if (dDay.getTime() === today.getTime()) return `Today, ${timeStr}`;
  if (dDay.getTime() === tomorrow.getTime()) return `Tomorrow, ${timeStr}`;
  return d.toLocaleDateString([],{month:'short',day:'numeric'}) + `, ${timeStr}`;
}

function getCountdown(iso) {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - now();
  if (diff < 0) return { label: 'OVERDUE', cls: 'countdown-overdue' };
  const m = Math.floor(diff/60000);
  const h = Math.floor(m/60);
  const d = Math.floor(h/24);
  if (d > 0) {
    const cls = d <= 1 ? 'countdown-soon' : 'countdown-ok';
    return { label: `${d}d ${h%24}h`, cls };
  }
  if (h > 0) {
    const cls = h <= 1 ? 'countdown-soon' : 'countdown-ok';
    return { label: `${h}h ${m%60}m`, cls };
  }
  return { label: `${m}m`, cls: 'countdown-soon' };
}

function isOverdue(task) {
  return task.deadline && new Date(task.deadline).getTime() < now() && !task.completed;
}

function isDueToday(task) {
  if (!task.deadline) return false;
  const d = new Date(task.deadline);
  const t = new Date();
  return d.getFullYear()===t.getFullYear() && d.getMonth()===t.getMonth() && d.getDate()===t.getDate();
}

/* ── STORAGE ──────────────────────────────────────────────── */
function saveToStorage() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks)); } catch(_) {}
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) tasks = JSON.parse(raw);
  } catch(_) { tasks = []; }
}

/* ── CRUD ─────────────────────────────────────────────────── */
function addTask(obj) {
  const task = {
    id: uid(),
    title: obj.title.trim(),
    description: (obj.description||'').trim(),
    priority: obj.priority || 'medium',
    deadline: obj.deadline || null,
    completed: false,
    created: now(),
    recurring: obj.recurring || 'none',
    order: tasks.length
  };
  tasks.unshift(task);
  saveToStorage();
  scheduleNotification(task);
  renderAll();
  toast('Task added', 'success');
  return task;
}

function deleteTask(id) {
  tasks = tasks.filter(t => t.id !== id);
  clearTimeout(notifTimers[id]);
  delete notifTimers[id];
  saveToStorage();
  renderAll();
  toast('Task deleted', 'info');
}

function toggleComplete(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  task.completed = !task.completed;
  // Handle recurring
  if (task.completed && task.recurring !== 'none') {
    const next = { ...task };
    next.id = uid();
    next.completed = false;
    next.created = now();
    const base = new Date(task.deadline || now());
    if (task.recurring === 'daily') base.setDate(base.getDate()+1);
    if (task.recurring === 'weekly') base.setDate(base.getDate()+7);
    next.deadline = task.deadline ? base.toISOString() : null;
    next.order = tasks.length;
    tasks.push(next);
    scheduleNotification(next);
    toast(`Recurring task reset for ${task.recurring === 'daily' ? 'tomorrow' : 'next week'}`, 'info');
  }
  saveToStorage();
  renderAll();
}

function updateTask(id, updates) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  Object.assign(task, updates);
  clearTimeout(notifTimers[id]);
  scheduleNotification(task);
  saveToStorage();
  renderAll();
  toast('Task updated', 'success');
}

/* ── FILTER / SORT ────────────────────────────────────────── */
function filterTasks(taskArr) {
  let arr = [...taskArr];
  // Filter
  switch(currentFilter) {
    case 'pending':   arr = arr.filter(t => !t.completed); break;
    case 'completed': arr = arr.filter(t => t.completed); break;
    case 'high':      arr = arr.filter(t => t.priority === 'high'); break;
    case 'overdue':   arr = arr.filter(t => isOverdue(t)); break;
  }
  // Search
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    arr = arr.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q)
    );
  }
  // Focus
  if (focusMode) arr = arr.filter(t => t.priority === 'high');
  return arr;
}

function sortTasks(arr) {
  const pOrder = { high: 0, medium: 1, low: 2 };
  return [...arr].sort((a, b) => {
    switch(currentSort) {
      case 'created-desc': return b.created - a.created;
      case 'created-asc':  return a.created - b.created;
      case 'deadline-asc': {
        if (!a.deadline && !b.deadline) return 0;
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return new Date(a.deadline)-new Date(b.deadline);
      }
      case 'deadline-desc': {
        if (!a.deadline && !b.deadline) return 0;
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return new Date(b.deadline)-new Date(a.deadline);
      }
      case 'priority-high': return pOrder[a.priority]-pOrder[b.priority];
      case 'priority-low':  return pOrder[b.priority]-pOrder[a.priority];
      default: return a.order - b.order;
    }
  });
}

/* ── RENDER ───────────────────────────────────────────────── */
function renderTasks() {
  const list = $('task-list');
  const empty = $('empty-state');
  const visible = sortTasks(filterTasks(tasks));

  list.innerHTML = '';

  if (visible.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  visible.forEach((task, idx) => {
    list.appendChild(createTaskCard(task, idx));
  });

  initDragDrop();
}

function createTaskCard(task, idx) {
  const card = document.createElement('div');
  card.className = `task-card priority-${task.priority}${task.completed?' completed':''}${isOverdue(task)?' overdue':''}`;
  card.dataset.id = task.id;
  card.draggable = true;

  const countdown = task.deadline ? getCountdown(task.deadline) : null;
  const deadlineLabel = task.deadline ? formatDeadline(task.deadline) : '';

  card.innerHTML = `
    <div class="drag-handle"><i class="fa-solid fa-grip-vertical"></i></div>
    <button class="task-check" onclick="toggleComplete('${task.id}')" title="Toggle complete">
      ${task.completed ? '<i class="fa-solid fa-check"></i>' : ''}
    </button>
    <div class="task-body">
      <div class="task-top">
        <span class="task-title">${escapeHtml(task.title)}</span>
        <span class="task-priority-badge badge-${task.priority}">${task.priority}</span>
        ${task.recurring !== 'none' ? `<span class="task-recurring-badge"><i class="fa-solid fa-rotate"></i>${task.recurring}</span>` : ''}
      </div>
      ${task.description ? `<div class="task-desc">${escapeHtml(task.description)}</div>` : ''}
      ${deadlineLabel ? `
      <div class="task-meta">
        <span class="task-deadline">
          <i class="fa-regular fa-clock"></i>
          ${deadlineLabel}
        </span>
        ${countdown ? `<span class="task-countdown ${countdown.cls}" data-id="${task.id}">${countdown.label}</span>` : ''}
      </div>` : ''}
    </div>
    <div class="task-actions">
      <button class="task-act-btn edit-btn" onclick="openEdit('${task.id}')" title="Edit"><i class="fa-solid fa-pen"></i></button>
      <button class="task-act-btn delete-btn" onclick="deleteTask('${task.id}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
    </div>
  `;
  return card;
}

function escapeHtml(str) {
  return str
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

/* ── LIVE COUNTDOWNS (rAF) ────────────────────────────────── */
function startCountdownLoop() {
  cancelAnimationFrame(rafId);
  let lastTick = 0;
  function loop(ts) {
    if (ts - lastTick > 10000) { // update every 10s
      lastTick = ts;
      document.querySelectorAll('.task-countdown[data-id]').forEach(el => {
        const task = tasks.find(t => t.id === el.dataset.id);
        if (!task || !task.deadline) return;
        const cd = getCountdown(task.deadline);
        if (cd) {
          el.textContent = cd.label;
          el.className = `task-countdown ${cd.cls}`;
        }
      });
      updateDashboard();
      updateSmartBanner();
    }
    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);
}

/* ── DASHBOARD ────────────────────────────────────────────── */
function updateDashboard() {
  const total = tasks.length;
  const completed = tasks.filter(t => t.completed).length;
  const pending = tasks.filter(t => !t.completed).length;
  const today = tasks.filter(t => isDueToday(t) && !t.completed).length;
  const overdue = tasks.filter(t => isOverdue(t)).length;
  const pct = total ? Math.round((completed/total)*100) : 0;

  $('stat-total').textContent = total;
  $('stat-pending').textContent = pending;
  $('stat-today').textContent = today;
  $('stat-overdue').textContent = overdue;
  $('completion-pct').textContent = `${pct}%`;
  $('progress-fill').style.width = `${pct}%`;

  $('pb-high').textContent = tasks.filter(t=>t.priority==='high'&&!t.completed).length;
  $('pb-med').textContent  = tasks.filter(t=>t.priority==='medium'&&!t.completed).length;
  $('pb-low').textContent  = tasks.filter(t=>t.priority==='low'&&!t.completed).length;
}

/* ── SMART BANNER ─────────────────────────────────────────── */
function updateSmartBanner() {
  const banner = $('smart-banner');
  const chips = [];
  const overdue = tasks.filter(t => isOverdue(t));
  const highPending = tasks.filter(t => t.priority==='high' && !t.completed);
  const dueToday = tasks.filter(t => isDueToday(t) && !t.completed);
  const total = tasks.length;
  const completed = tasks.filter(t=>t.completed).length;

  if (overdue.length > 0) {
    chips.push(`<span class="smart-chip warn"><i class="fa-solid fa-triangle-exclamation"></i>${overdue.length} overdue task${overdue.length>1?'s':''}</span>`);
  }
  if (highPending.length > 0) {
    chips.push(`<span class="smart-chip med"><i class="fa-solid fa-flag"></i>${highPending.length} high-priority pending</span>`);
  }
  if (dueToday.length > 0) {
    chips.push(`<span class="smart-chip med"><i class="fa-solid fa-calendar-day"></i>${dueToday.length} due today</span>`);
  }
  if (total > 0 && completed === total) {
    chips.push(`<span class="smart-chip ok"><i class="fa-solid fa-party-horn"></i>All tasks complete! 🎉</span>`);
  }
  banner.innerHTML = chips.join('');
}

function renderAll() {
  renderTasks();
  updateDashboard();
  updateSmartBanner();
}

/* ── DRAG & DROP ──────────────────────────────────────────── */
function initDragDrop() {
  const cards = document.querySelectorAll('.task-card');
  cards.forEach(card => {
    card.addEventListener('dragstart', e => {
      dragSrcIndex = [...card.parentNode.children].indexOf(card);
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging', 'drag-over'));
    card.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('.task-card').forEach(c => c.classList.remove('drag-over'));
      card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', e => {
      e.preventDefault();
      card.classList.remove('drag-over');
      const list = $('task-list');
      const destIndex = [...list.children].indexOf(card);
      if (dragSrcIndex === null || dragSrcIndex === destIndex) return;

      // Reorder visible tasks
      const visible = sortTasks(filterTasks(tasks));
      const srcTask = visible[dragSrcIndex];
      const destTask = visible[destIndex];
      if (!srcTask || !destTask) return;

      // Reorder in main array
      const srcI = tasks.findIndex(t => t.id === srcTask.id);
      const dstI = tasks.findIndex(t => t.id === destTask.id);
      const [moved] = tasks.splice(srcI, 1);
      tasks.splice(dstI, 0, moved);
      tasks.forEach((t, i) => t.order = i);

      saveToStorage();
      renderAll();
      dragSrcIndex = null;
    });
  });
}

/* ── NOTIFICATIONS ────────────────────────────────────────── */
function scheduleNotification(task) {
  if (!task.deadline || task.completed) return;
  const fireAt = new Date(task.deadline).getTime() - 60*60*1000; // 1hr before
  const delay = fireAt - now();
  if (delay <= 0) return;
  clearTimeout(notifTimers[task.id]);
  notifTimers[task.id] = setTimeout(() => {
    if (Notification.permission === 'granted') {
      new Notification('⏰ OPUS Reminder', {
        body: `"${task.title}" is due in 1 hour!`,
        icon: ''
      });
    }
  }, delay);
}

function scheduleAllNotifications() {
  tasks.forEach(scheduleNotification);
}

function checkNotifPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    $('notif-banner').classList.remove('hidden');
  }
}

/* ── EDIT MODAL ───────────────────────────────────────────── */
function openEdit(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  $('edit-id').value = id;
  $('edit-title').value = task.title;
  $('edit-desc').value = task.description;
  $('edit-deadline').value = task.deadline ? toLocalDateTimeValue(task.deadline) : '';
  $('edit-recurring').value = task.recurring;
  editPriority = task.priority;
  document.querySelectorAll('#edit-priority-selector .pri-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.val === editPriority);
  });
  $('edit-modal').classList.remove('hidden');
  $('edit-title').focus();
}

function closeEdit() {
  $('edit-modal').classList.add('hidden');
}

function toLocalDateTimeValue(iso) {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ── TOAST ────────────────────────────────────────────────── */
function toast(msg, type = 'info') {
  const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="fa-solid ${icons[type]}"></i>${msg}`;
  $('toast-container').appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 320);
  }, 2500);
}

/* ── ADD FORM STATE ───────────────────────────────────────── */
let addPriority = 'medium';

function getAddFormData() {
  const title = $('task-title').value.trim();
  const desc = $('task-desc').value.trim();
  const deadline = $('task-deadline').value
    ? new Date($('task-deadline').value).toISOString()
    : null;
  const recurring = $('task-recurring').value;
  return { title, description: desc, priority: addPriority, deadline, recurring };
}

function clearAddForm() {
  $('task-title').value = '';
  $('task-desc').value = '';
  $('task-deadline').value = '';
  $('task-recurring').value = 'none';
  addPriority = 'medium';
  document.querySelectorAll('#priority-selector .pri-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.val === 'medium');
  });
}

/* ── KEYBOARD SHORTCUTS ──────────────────────────────────── */
document.addEventListener('keydown', e => {
  // ⌘K / Ctrl+K — focus search
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    $('search-input').focus();
    return;
  }
  // Escape — clear search or close modal
  if (e.key === 'Escape') {
    if (!$('edit-modal').classList.contains('hidden')) { closeEdit(); return; }
    $('search-input').value = '';
    searchQuery = '';
    renderAll();
    return;
  }
  // F — toggle focus mode (when not in input)
  if (e.key === 'f' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA' && document.activeElement.tagName !== 'SELECT') {
    toggleFocusMode();
    return;
  }
  // Enter in search — do nothing extra (search updates live)
});

/* ── INIT ─────────────────────────────────────────────────── */
function init() {
  loadFromStorage();
  renderAll();
  scheduleAllNotifications();
  checkNotifPermission();
  startCountdownLoop();

  // Loader dismiss
  setTimeout(() => {
    $('loader').classList.add('hidden');
  }, 1300);

  /* ── Theme toggle */
  $('theme-toggle').addEventListener('click', () => {
    const html = document.documentElement;
    html.dataset.theme = html.dataset.theme === 'dark' ? 'light' : 'dark';
  });

  /* ── Focus mode toggle */
  $('focus-toggle').addEventListener('click', toggleFocusMode);

  function toggleFocusMode() {
    focusMode = !focusMode;
    $('focus-toggle').classList.toggle('active', focusMode);
    document.querySelector('.task-area').classList.toggle('focus-mode-on', focusMode);
    renderAll();
  }

  /* ── Search */
  $('search-input').addEventListener('input', e => {
    searchQuery = e.target.value.trim();
    renderAll();
  });

  /* ── Sort */
  $('sort-select').addEventListener('change', e => {
    currentSort = e.target.value;
    renderAll();
  });

  /* ── Filter buttons */
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderAll();
    });
  });

  /* ── Add form toggle */
  $('add-toggle').addEventListener('click', () => {
    const form = $('add-form');
    form.classList.toggle('open');
    if (form.classList.contains('open')) {
      $('task-title').focus();
    }
  });

  /* ── Priority selector (add form) */
  document.querySelectorAll('#priority-selector .pri-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      addPriority = btn.dataset.val;
      document.querySelectorAll('#priority-selector .pri-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  /* ── Submit task */
  $('submit-task').addEventListener('click', submitTask);
  $('task-title').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitTask(); }
  });

  function submitTask() {
    const data = getAddFormData();
    if (!data.title) {
      toast('Task title is required', 'error');
      $('task-title').focus();
      return;
    }
    addTask(data);
    clearAddForm();
    $('task-title').focus();
  }

  /* ── Notification banner */
  $('enable-notif').addEventListener('click', () => {
    Notification.requestPermission().then(perm => {
      $('notif-banner').classList.add('hidden');
      if (perm === 'granted') {
        scheduleAllNotifications();
        toast('Notifications enabled', 'success');
      }
    });
  });
  $('dismiss-notif').addEventListener('click', () => {
    $('notif-banner').classList.add('hidden');
  });

  /* ── Edit modal priority selector */
  document.querySelectorAll('#edit-priority-selector .pri-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      editPriority = btn.dataset.val;
      document.querySelectorAll('#edit-priority-selector .pri-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  /* ── Save edit */
  $('save-edit').addEventListener('click', () => {
    const id = $('edit-id').value;
    const title = $('edit-title').value.trim();
    if (!title) { toast('Title is required', 'error'); return; }
    const deadline = $('edit-deadline').value
      ? new Date($('edit-deadline').value).toISOString()
      : null;
    updateTask(id, {
      title,
      description: $('edit-desc').value.trim(),
      priority: editPriority,
      deadline,
      recurring: $('edit-recurring').value
    });
    closeEdit();
  });

  /* ── Cancel / close modal */
  $('cancel-edit').addEventListener('click', closeEdit);
  $('close-modal').addEventListener('click', closeEdit);
  $('edit-modal').addEventListener('click', e => {
    if (e.target === $('edit-modal')) closeEdit();
  });

  /* ── Edit modal keyboard */
  $('edit-modal').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      $('save-edit').click();
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
