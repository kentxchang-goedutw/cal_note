/**
 * popup.js - 處理設定持久化、日曆範圍過濾、便利貼尺寸設定、自動儲存 GAS 網址、行程快速新增與日曆即時同步
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Tab 切換
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      document.getElementById(targetId).classList.add('active');
    });
  });

  // 設定元素
  const enableStickyToggle = document.getElementById('enableStickyToggle');
  const sizeButtons = document.querySelectorAll('.btn-size');
  const calendarScopeSelect = document.getElementById('calendarScopeSelect');
  const gasUrlInput = document.getElementById('gasUrlInput');
  const autoSavedBadge = document.getElementById('autoSavedBadge');
  const dayButtons = document.querySelectorAll('.btn-day');
  const customDaysBox = document.getElementById('customDaysBox');
  const customDaysInput = document.getElementById('customDaysInput');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const saveAndSyncBtn = document.getElementById('saveAndSyncBtn');

  // 新增行程元素
  const addEventForm = document.getElementById('addEventForm');
  const eventTitle = document.getElementById('eventTitle');
  const isAllDayEvent = document.getElementById('isAllDayEvent');
  const timeRow = document.getElementById('timeRow');
  const eventStart = document.getElementById('eventStart');
  const eventEnd = document.getElementById('eventEnd');
  const allDayDateGroup = document.getElementById('allDayDateGroup');
  const allDayDate = document.getElementById('allDayDate');
  const eventLocation = document.getElementById('eventLocation');
  const eventDesc = document.getElementById('eventDesc');
  const submitAddEventBtn = document.getElementById('submitAddEventBtn');
  const addStatusMsg = document.getElementById('addStatusMsg');

  let selectedDays = 7;
  let currentNoteSize = 'normal';
  let currentScope = 'primary';

  // 1. 載入並恢復現有設定
  const config = await chrome.storage.local.get([
    'gasUrl',
    'selectedDays',
    'customDays',
    'isEnabled',
    'noteSize',
    'calendarScope',
    'lastSyncTime',
    'lastSyncUser'
  ]);

  if (config.gasUrl) {
    gasUrlInput.value = config.gasUrl;
    showAutoSaved();
  }

  if (config.isEnabled !== undefined) {
    enableStickyToggle.checked = config.isEnabled;
  } else {
    enableStickyToggle.checked = true;
  }

  if (config.noteSize) {
    currentNoteSize = config.noteSize;
    updateSizeButtonsUI(currentNoteSize);
  } else {
    updateSizeButtonsUI('normal');
  }

  if (config.calendarScope) {
    currentScope = config.calendarScope;
    calendarScopeSelect.value = currentScope;
  } else {
    calendarScopeSelect.value = 'primary';
  }

  if (config.customDays) {
    customDaysInput.value = config.customDays;
  }

  if (config.selectedDays) {
    selectedDays = config.selectedDays;
    updateDayButtonsUI(selectedDays);
  } else {
    updateDayButtonsUI(7);
  }

  if (config.lastSyncTime) {
    const d = new Date(config.lastSyncTime);
    const userHint = config.lastSyncUser ? ` (${config.lastSyncUser})` : '';
    updateStatus('success', `上次同步：${d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}${userHint}`);
  } else if (!config.gasUrl) {
    updateStatus('default', '尚未設定 GAS 網址');
  }

  // 2. 尺寸切換
  sizeButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      const sizeVal = btn.getAttribute('data-size');
      currentNoteSize = sizeVal;
      updateSizeButtonsUI(sizeVal);
      await chrome.storage.local.set({ noteSize: sizeVal });
      chrome.runtime.sendMessage({ action: 'refreshCurrentTab' });
    });
  });

  function updateSizeButtonsUI(size) {
    sizeButtons.forEach(btn => {
      if (btn.getAttribute('data-size') === size) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  // 3. 日曆讀取範圍切換
  calendarScopeSelect.addEventListener('change', async () => {
    currentScope = calendarScopeSelect.value;
    await chrome.storage.local.set({ calendarScope: currentScope });
    performSync();
  });

  // 4. 自動保存 GAS 網址
  let saveTimer = null;
  gasUrlInput.addEventListener('input', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const gasUrl = gasUrlInput.value.trim();
      await chrome.storage.local.set({ gasUrl });
      showAutoSaved();
    }, 400);
  });

  function showAutoSaved() {
    autoSavedBadge.classList.add('show');
    setTimeout(() => {
      autoSavedBadge.classList.remove('show');
    }, 2500);
  }

  // 5. 天數切換
  dayButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      dayButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const val = btn.getAttribute('data-days');
      if (val === 'custom') {
        customDaysBox.style.display = 'flex';
        selectedDays = parseInt(customDaysInput.value || '7', 10);
      } else {
        customDaysBox.style.display = 'none';
        selectedDays = parseInt(val, 10);
      }
      await chrome.storage.local.set({ selectedDays });
    });
  });

  customDaysInput.addEventListener('input', async () => {
    let val = parseInt(customDaysInput.value, 10);
    if (isNaN(val) || val < 1) val = 1;
    if (val > 90) val = 90;
    selectedDays = val;
    await chrome.storage.local.set({ selectedDays, customDays: val });
  });

  // 6. 開啟 / 關閉便利貼
  enableStickyToggle.addEventListener('change', async () => {
    const isEnabled = enableStickyToggle.checked;
    await chrome.storage.local.set({ isEnabled });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleStickyVisibility', isEnabled });
      }
    });
  });

  // 7. 立即同步按鈕
  saveAndSyncBtn.addEventListener('click', () => {
    performSync();
  });

  async function performSync() {
    const gasUrl = gasUrlInput.value.trim();
    if (!gasUrl) {
      updateStatus('error', '請先輸入 GAS 網址');
      gasUrlInput.focus();
      return;
    }

    currentScope = calendarScopeSelect.value;
    await chrome.storage.local.set({ 
      gasUrl, 
      selectedDays, 
      noteSize: currentNoteSize,
      calendarScope: currentScope
    });

    updateStatus('loading', '正在向 Google Apps Script 取得行事曆行程...');
    saveAndSyncBtn.disabled = true;

    chrome.runtime.sendMessage({
      action: 'fetchCalendarData',
      gasUrl: gasUrl,
      days: selectedDays,
      scope: currentScope
    }, (response) => {
      saveAndSyncBtn.disabled = false;
      if (response && response.success) {
        const userHint = response.data.userEmail ? ` (${response.data.userEmail})` : '';
        updateStatus('success', `同步成功！帳號：${response.data.userEmail || '已連結'}，共 ${response.data.daysCount} 天`);
        chrome.runtime.sendMessage({ action: 'refreshCurrentTab' });
      } else {
        const err = (response && response.error) || '同步失敗，請確認網址';
        updateStatus('error', err);
      }
    });
  }

  // 8. 新增行程表單
  initAddEventFormDefaults();

  isAllDayEvent.addEventListener('change', () => {
    if (isAllDayEvent.checked) {
      timeRow.style.display = 'none';
      allDayDateGroup.style.display = 'flex';
      eventStart.removeAttribute('required');
      allDayDate.setAttribute('required', 'true');
    } else {
      timeRow.style.display = 'flex';
      allDayDateGroup.style.display = 'none';
      eventStart.setAttribute('required', 'true');
      allDayDate.removeAttribute('required');
    }
  });

  addEventForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const gasUrl = gasUrlInput.value.trim();
    if (!gasUrl) {
      showAddStatus('error', '請先在「偏好設定」填入 GAS 網址');
      return;
    }

    const title = eventTitle.value.trim();
    if (!title) return;

    let startIso = '';
    let endIso = '';
    const isAllDay = isAllDayEvent.checked;

    if (isAllDay) {
      if (!allDayDate.value) {
        showAddStatus('error', '請選擇全天行程日期');
        return;
      }
      startIso = allDayDate.value;
    } else {
      if (!eventStart.value) {
        showAddStatus('error', '請選擇開始時間');
        return;
      }
      startIso = new Date(eventStart.value).toISOString();
      if (eventEnd.value) {
        endIso = new Date(eventEnd.value).toISOString();
      }
    }

    submitAddEventBtn.disabled = true;
    showAddStatus('loading', '正在加入至 Google 日曆...');

    const eventPayload = {
      title,
      start: startIso,
      end: endIso,
      isAllDay,
      location: eventLocation.value.trim(),
      description: eventDesc.value.trim()
    };

    chrome.runtime.sendMessage({
      action: 'createCalendarEvent',
      gasUrl,
      eventData: eventPayload
    }, async (res) => {
      submitAddEventBtn.disabled = false;
      if (res && res.success) {
        showAddStatus('success', '✓ 行程已成功加入！便利貼即將更新');
        eventTitle.value = '';
        eventLocation.value = '';
        eventDesc.value = '';
        initAddEventFormDefaults();
        performSync();
      } else {
        const err = (res && res.error) || '加入失敗，請檢查 GAS 部署權限';
        showAddStatus('error', err);
      }
    });
  });

  function initAddEventFormDefaults() {
    const now = new Date();
    now.setHours(now.getHours() + 1, 0, 0, 0);
    const startStr = formatDateTimeLocal(now);
    
    const end = new Date(now.getTime() + 60 * 60 * 1000);
    const endStr = formatDateTimeLocal(end);

    eventStart.value = startStr;
    eventEnd.value = endStr;

    const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    allDayDate.value = todayStr;
  }

  function formatDateTimeLocal(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d}T${hh}:${mm}`;
  }

  function showAddStatus(type, msg) {
    addStatusMsg.className = 'add-status-msg ' + type;
    addStatusMsg.textContent = msg;
  }

  function updateDayButtonsUI(days) {
    let matched = false;
    dayButtons.forEach(btn => {
      const val = btn.getAttribute('data-days');
      if (val === String(days)) {
        btn.classList.add('active');
        customDaysBox.style.display = 'none';
        matched = true;
      } else {
        btn.classList.remove('active');
      }
    });

    if (!matched) {
      document.querySelector('.btn-day[data-days="custom"]').classList.add('active');
      customDaysBox.style.display = 'flex';
      customDaysInput.value = days;
    }
  }

  function updateStatus(type, msg) {
    statusDot.className = 'status-dot';
    if (type === 'success') {
      statusDot.classList.add('success');
    } else if (type === 'loading') {
      statusDot.classList.add('loading');
    } else if (type === 'error') {
      statusDot.classList.add('error');
    }
    statusText.textContent = msg;
  }
});
