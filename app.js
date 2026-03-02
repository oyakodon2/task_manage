const MINUTES_STORAGE_KEY = 'weekly_meeting_minutes_v3';
const TASK_STORAGE_KEY = 'major_tasks_v3';
const OWNER_STORAGE_KEY = 'owner_master_v2';

const bodyEl = document.getElementById('minutesBody');
const taskBodyEl = document.getElementById('taskBody');
const formEl = document.getElementById('entryForm');
const taskFormEl = document.getElementById('taskForm');
const ownerFormEl = document.getElementById('ownerForm');
const searchInput = document.getElementById('searchInput');
const exportBtn = document.getElementById('exportBtn');
const ownerPanelToggleBtn = document.getElementById('ownerPanelToggleBtn');
const ownerManagerCard = document.getElementById('ownerManagerCard');
const taskOwnerTabsEl = document.getElementById('taskOwnerTabs');
const minutesOwnerTabsEl = document.getElementById('minutesOwnerTabs');
const taskOwnerHiddenEl = document.getElementById('taskOwnerHidden');
const minutesOwnerHiddenEl = document.getElementById('minutesOwnerHidden');
const ownerListEl = document.getElementById('ownerList');
const syncStatusEl = document.getElementById('syncStatus');

const STATUS_META = {
  todo: { label: 'To Do', className: 'todo' },
  doing: { label: '作業中', className: 'doing' },
  blocked: { label: '立ち往生案件', className: 'blocked' },
  done: { label: '完了', className: 'done' },
};

const APP_CONFIG = window.APP_CONFIG || {};
const hasSupabaseConfig = Boolean(APP_CONFIG.supabaseUrl && APP_CONFIG.supabaseAnonKey);
const hasSupabaseSdk = Boolean(window.supabase && window.supabase.createClient);
const supabaseClient = hasSupabaseConfig && hasSupabaseSdk
  ? window.supabase.createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey)
  : null;

const saveLocal = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const loadLocal = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
};

let owners = [];
let tasks = [];
let minutes = [];
let selectedTaskOwner = '';
let selectedMinutesOwner = '';

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const toLabel = (isoDate) => {
  if (!isoDate) return '-';
  const [y, m, d] = isoDate.split('-');
  return `${y}年${Number(m)}月${Number(d)}日`;
};

const getQuery = () => searchInput.value.trim().toLowerCase();

const getFilteredMinutes = () => {
  const q = getQuery();
  if (!q) return [...minutes];
  return minutes.filter((e) => `${e.owner} ${e.this_week} ${e.next_week} ${e.date}`.toLowerCase().includes(q));
};

const getFilteredTasks = () => {
  const q = getQuery();
  if (!q) return [...tasks];
  return tasks.filter((t) => `${t.title} ${t.owner} ${t.note} ${t.due}`.toLowerCase().includes(q));
};

const groupMinutesByDate = (records) => {
  const map = new Map();
  records
    .sort((a, b) => {
      if (a.date === b.date) return new Date(a.created_at) - new Date(b.created_at);
      return a.date < b.date ? 1 : -1;
    })
    .forEach((record) => {
      if (!map.has(record.date)) map.set(record.date, []);
      map.get(record.date).push(record);
    });
  return [...map.entries()];
};

const groupTasksByStatus = (records) => {
  const order = ['todo', 'doing', 'blocked', 'done'];
  const grouped = new Map(order.map((s) => [s, []]));
  records
    .sort((a, b) => {
      const d1 = a.due || '9999-99-99';
      const d2 = b.due || '9999-99-99';
      if (d1 === d2) return new Date(a.created_at) - new Date(b.created_at);
      return d1 < d2 ? -1 : 1;
    })
    .forEach((task) => {
      const key = grouped.has(task.status) ? task.status : 'todo';
      grouped.get(key).push(task);
    });

  return order.map((key) => [key, grouped.get(key)]);
};

const buildOwnerTabs = (targetEl, selectedName, onClick) => {
  targetEl.innerHTML = '';
  if (owners.length === 0) {
    targetEl.innerHTML = '<span>先にオーナーを登録してください</span>';
    return;
  }

  owners.forEach((name) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `owner-tab${name === selectedName ? ' active' : ''}`;
    button.textContent = name;
    button.addEventListener('click', () => onClick(name));
    targetEl.appendChild(button);
  });
};

const renderOwnerTabs = () => {
  if (!owners.includes(selectedTaskOwner)) selectedTaskOwner = owners[0] || '';
  if (!owners.includes(selectedMinutesOwner)) selectedMinutesOwner = owners[0] || '';

  taskOwnerHiddenEl.value = selectedTaskOwner;
  minutesOwnerHiddenEl.value = selectedMinutesOwner;

  buildOwnerTabs(taskOwnerTabsEl, selectedTaskOwner, (name) => {
    selectedTaskOwner = name;
    renderOwnerTabs();
  });
  buildOwnerTabs(minutesOwnerTabsEl, selectedMinutesOwner, (name) => {
    selectedMinutesOwner = name;
    renderOwnerTabs();
  });
};

const renderOwnerList = () => {
  ownerListEl.innerHTML = '';
  if (owners.length === 0) {
    ownerListEl.innerHTML = '<span>登録済みオーナーがいません</span>';
    return;
  }

  owners.forEach((name) => {
    const item = document.createElement('span');
    item.className = 'owner-item';
    item.innerHTML = `<span>${escapeHtml(name)}</span>`;

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'owner-delete';
    del.textContent = '削除';
    del.addEventListener('click', async () => {
      const usedTasks = tasks.filter((t) => t.owner === name).length;
      const usedMinutes = minutes.filter((m) => m.owner === name).length;
      if (usedTasks > 0 || usedMinutes > 0) {
        alert(`${name} は使用中のため削除できません。\n主要タスク: ${usedTasks}件 / 議事録: ${usedMinutes}件`);
        return;
      }

      if (supabaseClient) {
        const { error } = await supabaseClient.from('owners').delete().eq('name', name);
        if (error) return alert(`削除失敗: ${error.message}`);
      } else {
        owners = owners.filter((o) => o !== name);
        saveLocal(OWNER_STORAGE_KEY, owners);
        renderAll();
      }
    });

    item.appendChild(del);
    ownerListEl.appendChild(item);
  });
};

const renderTasks = () => {
  taskBodyEl.innerHTML = '';
  const grouped = groupTasksByStatus(getFilteredTasks());
  const hasAny = grouped.some(([, rows]) => rows.length > 0);

  if (!hasAny) {
    taskBodyEl.innerHTML = '<tr class="empty-row"><td colspan="6">主要タスクがありません</td></tr>';
    return;
  }

  grouped.forEach(([status, rows]) => {
    if (rows.length === 0) return;
    const meta = STATUS_META[status] || STATUS_META.todo;

    const g = document.createElement('tr');
    g.className = 'task-group-row';
    g.innerHTML = `<td colspan="6"><span class="group-tag ${meta.className}">${meta.label}</span></td>`;
    taskBodyEl.appendChild(g);

    rows.forEach((task) => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${escapeHtml(task.title)}</td>
        <td>${escapeHtml(task.owner)}</td>
        <td><span class="status-badge ${meta.className}">${meta.label}</span></td>
        <td>${escapeHtml(toLabel(task.due))}</td>
        <td>${escapeHtml(task.note || '-')}</td>
      `;
      const actionTd = document.createElement('td');
      const del = document.createElement('button');
      del.className = 'action-btn';
      del.textContent = '削除';
      del.addEventListener('click', async () => {
        if (supabaseClient) {
          const { error } = await supabaseClient.from('tasks').delete().eq('id', task.id);
          if (error) alert(`削除失敗: ${error.message}`);
        } else {
          tasks = tasks.filter((t) => t.id !== task.id);
          saveLocal(TASK_STORAGE_KEY, tasks);
          renderAll();
        }
      });
      actionTd.appendChild(del);
      row.appendChild(actionTd);
      taskBodyEl.appendChild(row);
    });
  });
};

const renderMinutes = () => {
  bodyEl.innerHTML = '';
  const grouped = groupMinutesByDate(getFilteredMinutes());
  if (grouped.length === 0) {
    bodyEl.innerHTML = '<tr class="empty-row"><td colspan="5">議事録データがありません</td></tr>';
    return;
  }

  grouped.forEach(([date, rows]) => {
    rows.forEach((row, idx) => {
      const tr = document.createElement('tr');
      if (idx === 0) {
        tr.classList.add('date-group-start');
        const tdDate = document.createElement('td');
        tdDate.className = 'date-cell';
        tdDate.rowSpan = rows.length;
        tdDate.textContent = toLabel(date);
        tr.appendChild(tdDate);
      }

      tr.innerHTML += `<td>${escapeHtml(row.owner)}</td><td>${escapeHtml(row.this_week || '-')}</td><td>${escapeHtml(row.next_week || '-')}</td>`;
      const actionTd = document.createElement('td');
      const del = document.createElement('button');
      del.className = 'action-btn';
      del.textContent = '削除';
      del.addEventListener('click', async () => {
        if (supabaseClient) {
          const { error } = await supabaseClient.from('minutes').delete().eq('id', row.id);
          if (error) alert(`削除失敗: ${error.message}`);
        } else {
          minutes = minutes.filter((m) => m.id !== row.id);
          saveLocal(MINUTES_STORAGE_KEY, minutes);
          renderAll();
        }
      });
      actionTd.appendChild(del);
      tr.appendChild(actionTd);
      bodyEl.appendChild(tr);
    });
  });
};

const renderAll = () => {
  renderOwnerTabs();
  renderOwnerList();
  renderTasks();
  renderMinutes();
};

const loadFromSupabase = async () => {
  const [ownersRes, tasksRes, minutesRes] = await Promise.all([
    supabaseClient.from('owners').select('*').order('created_at', { ascending: true }),
    supabaseClient.from('tasks').select('*').order('created_at', { ascending: true }),
    supabaseClient.from('minutes').select('*').order('created_at', { ascending: true }),
  ]);

  if (ownersRes.error || tasksRes.error || minutesRes.error) {
    const e = ownersRes.error || tasksRes.error || minutesRes.error;
    throw new Error(e.message);
  }

  owners = (ownersRes.data || []).map((r) => r.name);
  tasks = tasksRes.data || [];
  minutes = minutesRes.data || [];
  renderAll();
};

const subscribeRealtime = () => {
  const reload = () => loadFromSupabase().catch((e) => console.error(e));
  supabaseClient
    .channel('shared-minutes-channel')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'owners' }, reload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, reload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'minutes' }, reload)
    .subscribe();
};

const initialize = async () => {
  if (hasSupabaseConfig && !hasSupabaseSdk) {
    syncStatusEl.textContent = '同期エラー: Supabase SDKの読込失敗';
    owners = loadLocal(OWNER_STORAGE_KEY, ['田中', '佐藤', '鈴木', '山本']);
    tasks = loadLocal(TASK_STORAGE_KEY, []);
    minutes = loadLocal(MINUTES_STORAGE_KEY, []);
    renderAll();
    return;
  }

  if (supabaseClient) {
    syncStatusEl.textContent = '同期: Supabase接続中...';
    try {
      await loadFromSupabase();
      subscribeRealtime();
      syncStatusEl.textContent = '同期: リアルタイム共有 ON';
    } catch (e) {
      syncStatusEl.textContent = `同期エラー: ${e.message}`;
      console.error(e);
    }
  } else {
    owners = loadLocal(OWNER_STORAGE_KEY, ['田中', '佐藤', '鈴木', '山本']);
    tasks = loadLocal(TASK_STORAGE_KEY, []);
    minutes = loadLocal(MINUTES_STORAGE_KEY, []);
    if (tasks.length === 0) {
      tasks = [
        { id: crypto.randomUUID(), title: '役員情報CSVの差分取り込みフロー作成', owner: '鈴木', status: 'doing', due: '2026-03-07', note: '金曜レビューまでに叩き台作成', created_at: new Date().toISOString() },
      ];
      saveLocal(TASK_STORAGE_KEY, tasks);
    }
    if (minutes.length === 0) {
      minutes = [
        { id: crypto.randomUUID(), date: '2026-03-01', owner: '田中', this_week: '売上速報の差分確認を実施。', next_week: '来週までに注記案を作成。', created_at: new Date().toISOString() },
      ];
      saveLocal(MINUTES_STORAGE_KEY, minutes);
    }
    saveLocal(OWNER_STORAGE_KEY, owners);
    syncStatusEl.textContent = '同期: ローカル保存モード';
    renderAll();
  }
};

ownerFormEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  const nameInput = document.getElementById('ownerNameInput');
  const newName = nameInput.value.trim();
  if (!newName) return;

  if (supabaseClient) {
    const { error } = await supabaseClient.from('owners').insert({ name: newName });
    if (error) return alert(`登録失敗: ${error.message}`);
  } else {
    if (!owners.includes(newName)) owners.push(newName);
    saveLocal(OWNER_STORAGE_KEY, owners);
    renderAll();
  }

  selectedTaskOwner = newName;
  selectedMinutesOwner = newName;
  nameInput.value = '';
});

taskFormEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = document.getElementById('taskTitleInput').value.trim();
  const owner = taskOwnerHiddenEl.value;
  const status = document.getElementById('taskStatusInput').value;
  const due = document.getElementById('taskDueInput').value || null;
  const note = document.getElementById('taskNoteInput').value.trim();
  if (!title || !owner) return;

  const payload = { title, owner, status, due, note: note || null };

  if (supabaseClient) {
    const { error } = await supabaseClient.from('tasks').insert(payload);
    if (error) return alert(`追加失敗: ${error.message}`);
  } else {
    tasks.push({ id: crypto.randomUUID(), ...payload, created_at: new Date().toISOString() });
    saveLocal(TASK_STORAGE_KEY, tasks);
    renderAll();
  }

  taskFormEl.reset();
});

formEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  const date = document.getElementById('dateInput').value;
  const owner = minutesOwnerHiddenEl.value;
  const thisWeek = document.getElementById('thisWeekInput').value.trim();
  const nextWeek = document.getElementById('nextWeekInput').value.trim();
  if (!date || !owner || (!thisWeek && !nextWeek)) return;

  const payload = { date, owner, this_week: thisWeek || null, next_week: nextWeek || null };

  if (supabaseClient) {
    const { error } = await supabaseClient.from('minutes').insert(payload);
    if (error) return alert(`追加失敗: ${error.message}`);
  } else {
    minutes.push({ id: crypto.randomUUID(), ...payload, created_at: new Date().toISOString() });
    saveLocal(MINUTES_STORAGE_KEY, minutes);
    renderAll();
  }

  formEl.reset();
});

if (ownerPanelToggleBtn && ownerManagerCard) {
  ownerPanelToggleBtn.addEventListener('click', () => {
    const collapsed = ownerManagerCard.classList.toggle('collapsed');
    ownerManagerCard.setAttribute('aria-hidden', String(collapsed));
    ownerPanelToggleBtn.textContent = collapsed ? 'オーナー管理' : 'オーナー管理を閉じる';
  });
}

searchInput.addEventListener('input', renderAll);

exportBtn.addEventListener('click', () => {
  const payload = {
    exportedAt: new Date().toISOString(),
    mode: supabaseClient ? 'supabase' : 'local',
    owners,
    majorTasks: tasks,
    meetingMinutes: minutes,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'team_management_export.json';
  a.click();
  URL.revokeObjectURL(url);
});

initialize().catch((e) => {
  console.error(e);
  syncStatusEl.textContent = `同期エラー: ${e.message}`;
});
