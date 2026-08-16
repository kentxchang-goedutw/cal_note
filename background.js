/**
 * background.js - 處理日曆資料擷取、新增行程、快取、全域分頁廣播與啟動自動同步
 */

// 1. 瀏覽器啟動時自動同步
chrome.runtime.onStartup.addListener(() => {
  autoSyncIfConfigured();
  setupAutoSyncAlarm();
});

// 2. 擴充套件安裝或更新時自動同步
chrome.runtime.onInstalled.addListener(() => {
  autoSyncIfConfigured();
  setupAutoSyncAlarm();
});

// 3. 定期鬧鐘觸發自動背景同步 (每 30 分鐘)
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'auto_sync_gcal_sticky') {
    autoSyncIfConfigured();
  }
});

function setupAutoSyncAlarm() {
  chrome.alarms.get('auto_sync_gcal_sticky', (existingAlarm) => {
    if (!existingAlarm) {
      chrome.alarms.create('auto_sync_gcal_sticky', {
        periodInMinutes: 30
      });
    }
  });
}

/**
 * 檢查若有儲存 GAS 網址，立即自動載入並進行背景同步
 */
async function autoSyncIfConfigured() {
  try {
    const config = await chrome.storage.local.get(['gasUrl', 'selectedDays', 'calendarScope']);
    if (config.gasUrl && config.gasUrl.trim()) {
      const days = config.selectedDays || 7;
      const scope = config.calendarScope || 'primary';
      await fetchFromGAS(config.gasUrl, days, scope);
      broadcastRefresh();
    }
  } catch (err) {
    // 背景同步若暫時斷網則靜默略過
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 1. 取得行程
  if (message.action === 'fetchCalendarData') {
    fetchFromGAS(message.gasUrl, message.days, message.scope)
      .then(data => {
        broadcastRefresh();
        sendResponse({ success: true, data });
      })
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // 2. 新增行程至 Google 日曆
  if (message.action === 'createCalendarEvent') {
    createEventViaGAS(message.gasUrl, message.eventData)
      .then(res => sendResponse({ success: true, result: res }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // 3. 廣播分頁重新整理
  if (message.action === 'refreshCurrentTab') {
    broadcastRefresh();
    sendResponse({ success: true });
  }

  // 4. 自動觸發背景同步
  if (message.action === 'triggerAutoSync') {
    autoSyncIfConfigured()
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

function broadcastRefresh() {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { action: 'refreshStickyData' }).catch(() => {});
      }
    });
  });
}

/**
 * 向 Google Apps Script 抓取日曆資料 (支援 scope 範圍過濾)
 */
async function fetchFromGAS(gasUrl, days, scope) {
  if (!gasUrl || !gasUrl.trim()) {
    throw new Error('未設定 Google Apps Script (GAS) 網址');
  }

  const url = new URL(gasUrl.trim());
  url.searchParams.set('action', 'getEvents');
  url.searchParams.set('days', days || 7);
  url.searchParams.set('scope', scope || 'primary');
  url.searchParams.set('_t', Date.now().toString());

  const response = await fetch(url.toString(), {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`連線失敗 (HTTP ${response.status})`);
  }

  const result = await response.json();
  if (result.status !== 'success') {
    throw new Error(result.message || '無法取得行事曆資料');
  }

  // 存入 local 快取
  await chrome.storage.local.set({
    cachedCalendarData: result.data,
    lastSyncTime: new Date().toISOString(),
    lastSyncUser: result.userEmail || ''
  });

  return result;
}

/**
 * 透過 Google Apps Script 新增行程
 */
async function createEventViaGAS(gasUrl, eventData) {
  if (!gasUrl || !gasUrl.trim()) {
    throw new Error('未設定 Google Apps Script (GAS) 網址');
  }

  const url = new URL(gasUrl.trim());
  url.searchParams.set('action', 'createEvent');
  url.searchParams.set('title', eventData.title || '新行程');
  url.searchParams.set('start', eventData.start);
  if (eventData.end) url.searchParams.set('end', eventData.end);
  url.searchParams.set('isAllDay', eventData.isAllDay ? 'true' : 'false');
  if (eventData.location) url.searchParams.set('location', eventData.location);
  if (eventData.description) url.searchParams.set('description', eventData.description);
  url.searchParams.set('_t', Date.now().toString());

  const response = await fetch(url.toString(), {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`新增行程失敗 (HTTP ${response.status})`);
  }

  const result = await response.json();
  if (result.status !== 'success') {
    throw new Error(result.message || '新增行程失敗');
  }

  return result;
}
