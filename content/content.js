/**
 * content.js - 獨立便利貼、自由拖曳、單張便利貼點擊✕收合到底部、底部點擊單獨展開、
 * 工具列三段式排列循環 (預設下方橫排雙列按鈕 -> 螢幕右方直排單欄按鈕 -> 螢幕左方直排單欄按鈕 -> 下方橫排)、
 * 支援滑鼠按住拖曳滑動 (橫向/直向)、開啟自動同步
 */

(function () {
  if (window.__gcalStickyInjected) return;
  window.__gcalStickyInjected = true;

  let hostEl = null;
  let shadowRoot = null;
  let calendarData = [];
  let isEnabled = true;
  let noteSize = 'normal'; // 'normal' 或 'compact'

  // 工具列停靠方向：'bottom' (預設橫排下方) | 'right' (右方直排) | 'left' (左方直排)
  let dockPosition = 'bottom';

  // 儲存每張便利貼的狀態：{ x, y, collapsed, zIndex }
  let notesState = {}; 
  // 底部工具列是否收合至左下角
  let isToolbarDockedToLeft = false;

  const WEEK_DAYS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

  const STICKY_THEMES = [
    { bg: '#fff9db', border: '#fcc419', tag: '#f59f00', text: '#212529', headerBg: '#fff3bf', miniBg: '#fef08a' },
    { bg: '#e7f5ff', border: '#74c0fc', tag: '#1c7ed6', text: '#1864ab', headerBg: '#d0ebff', miniBg: '#bae6fd' },
    { bg: '#ebfbee', border: '#8ce99a', tag: '#2f9e44', text: '#2b8a3e', headerBg: '#d3f9d8', miniBg: '#bbf7d0' },
    { bg: '#fff0f6', border: '#faa2c1', tag: '#d6336c', text: '#a61e4d', headerBg: '#ffdeeb', miniBg: '#fbcfe8' },
    { bg: '#f3f0ff', border: '#b197fc', tag: '#7950f2', text: '#5f3dc4', headerBg: '#e5dbff', miniBg: '#e9d5ff' },
    { bg: '#fff4e6', border: '#ffc078', tag: '#f76707', text: '#d9480f', headerBg: '#ffe8cc', miniBg: '#fed7aa' },
  ];

  function isExtensionValid() {
    try {
      return typeof chrome !== 'undefined' && chrome.runtime && !!chrome.runtime.id;
    } catch (e) {
      return false;
    }
  }

  init();

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startSetup);
    } else {
      startSetup();
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        loadDataFromStorage();
      }
    });

    window.addEventListener('focus', () => {
      loadDataFromStorage();
    });

    window.addEventListener('pageshow', () => {
      loadDataFromStorage();
    });
  }

  async function startSetup() {
    createDOM();
    setupMessageListeners();

    if (!isExtensionValid()) return;

    try {
      const config = await chrome.storage.local.get([
        'gasUrl',
        'selectedDays',
        'isEnabled',
        'noteSize',
        'dockPosition',
        'isToolbarDockedToLeft',
        'cachedCalendarData',
        'savedNotesState',
        'lastSyncTime'
      ]);

      isEnabled = config.isEnabled !== undefined ? config.isEnabled : true;
      noteSize = config.noteSize || 'normal';
      dockPosition = config.dockPosition || 'bottom';
      isToolbarDockedToLeft = config.isToolbarDockedToLeft || false;
      calendarData = deduplicateCalendarData(config.cachedCalendarData || []);
      notesState = config.savedNotesState || {};

      if (!isEnabled) {
        hideHost();
        return;
      }

      if (calendarData.length > 0) {
        renderAll();
      }

      if (config.gasUrl && config.gasUrl.trim()) {
        const lastSync = config.lastSyncTime ? new Date(config.lastSyncTime).getTime() : 0;
        const now = Date.now();
        if (now - lastSync > 5 * 60 * 1000 || calendarData.length === 0) {
          refreshData(false);
        }
      } else if (calendarData.length === 0) {
        renderSetupHint();
      }
    } catch (err) {}
  }

  function createDOM() {
    if (document.getElementById('gcal-sticky-host')) {
      hostEl = document.getElementById('gcal-sticky-host');
      shadowRoot = hostEl.shadowRoot;
      return;
    }

    hostEl = document.createElement('div');
    hostEl.id = 'gcal-sticky-host';
    (document.body || document.documentElement).appendChild(hostEl);

    shadowRoot = hostEl.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = getStyles();
    shadowRoot.appendChild(style);

    const appRoot = document.createElement('div');
    appRoot.id = 'gcal-app-root';
    shadowRoot.appendChild(appRoot);
  }

  function setupMessageListeners() {
    if (!isExtensionValid()) return;

    try {
      chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'toggleStickyVisibility') {
          isEnabled = message.isEnabled;
          if (isEnabled) {
            showHost();
            renderAll();
          } else {
            hideHost();
          }
        } else if (message.action === 'refreshStickyData') {
          loadDataFromStorage();
        }
      });

      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
          if (changes.cachedCalendarData) {
            calendarData = deduplicateCalendarData(changes.cachedCalendarData.newValue || []);
            renderAll();
          }
          if (changes.noteSize) {
            noteSize = changes.noteSize.newValue || 'normal';
            renderAll();
          }
          if (changes.dockPosition) {
            dockPosition = changes.dockPosition.newValue || 'bottom';
            renderAll();
          }
          if (changes.isToolbarDockedToLeft !== undefined) {
            isToolbarDockedToLeft = changes.isToolbarDockedToLeft.newValue;
            renderAll();
          }
          if (changes.isEnabled !== undefined) {
            isEnabled = changes.isEnabled.newValue;
            if (isEnabled) {
              showHost();
              renderAll();
            } else {
              hideHost();
            }
          }
        }
      });
    } catch (e) {}
  }

  async function loadDataFromStorage() {
    if (!isExtensionValid()) return;

    try {
      const config = await chrome.storage.local.get([
        'cachedCalendarData',
        'gasUrl',
        'isEnabled',
        'noteSize',
        'dockPosition',
        'isToolbarDockedToLeft',
        'savedNotesState'
      ]);

      isEnabled = config.isEnabled !== undefined ? config.isEnabled : true;
      noteSize = config.noteSize || 'normal';
      dockPosition = config.dockPosition || 'bottom';
      isToolbarDockedToLeft = config.isToolbarDockedToLeft || false;
      calendarData = deduplicateCalendarData(config.cachedCalendarData || []);
      notesState = config.savedNotesState || {};

      if (!isEnabled) {
        hideHost();
        return;
      }
      showHost();

      if (calendarData.length > 0) {
        renderAll();
      } else if (config.gasUrl) {
        refreshData(true);
      }
    } catch (err) {}
  }

  function deduplicateCalendarData(dataList) {
    if (!Array.isArray(dataList)) return [];
    return dataList.map(day => {
      if (!day || !day.events || !Array.isArray(day.events)) return day;
      const seen = new Set();
      const uniqueEvents = [];

      day.events.forEach(evt => {
        const uniqueKey = evt.id || `${evt.title}_${evt.startIso}_${evt.isAllDay}`;
        if (!seen.has(uniqueKey)) {
          seen.add(uniqueKey);
          uniqueEvents.push(evt);
        }
      });

      return {
        ...day,
        events: uniqueEvents
      };
    });
  }

  function showHost() {
    if (hostEl) hostEl.style.display = 'block';
  }

  function hideHost() {
    if (hostEl) hostEl.style.display = 'none';
  }

  async function refreshData(showToastHint = true) {
    if (!isExtensionValid()) return;

    try {
      const config = await chrome.storage.local.get(['gasUrl', 'selectedDays', 'calendarScope']);
      if (!config.gasUrl) return;

      if (showToastHint) {
        showToast('正在同步 Google 行事曆...', 2000);
      }

      chrome.runtime.sendMessage({
        action: 'fetchCalendarData',
        gasUrl: config.gasUrl,
        days: config.selectedDays || 7,
        scope: config.calendarScope || 'primary'
      }, (res) => {
        if (chrome.runtime.lastError) return;
        if (res && res.success) {
          if (showToastHint) {
            showToast('行事曆同步完成！', 2000);
          }
        } else if (showToastHint) {
          showToast('同步失敗：' + ((res && res.error) || '請檢查 GAS 網址'), 3000);
        }
      });
    } catch (err) {}
  }

  function saveStateDebounced() {
    if (!isExtensionValid()) return;
    try {
      chrome.storage.local.set({ 
        savedNotesState: notesState,
        noteSize: noteSize,
        dockPosition: dockPosition,
        isToolbarDockedToLeft: isToolbarDockedToLeft
      });
    } catch (e) {}
  }

  function renderAll() {
    if (!shadowRoot) return;
    const root = shadowRoot.querySelector('#gcal-app-root');
    if (!root) return;

    root.innerHTML = '';

    const now = new Date();
    const todayKey = formatDateKey(now);

    let displayDays = calendarData.filter(day => {
      const isToday = day.dateString === todayKey;
      const hasEvents = day.events && day.events.length > 0;
      return hasEvents || isToday;
    });

    if (displayDays.length === 0 && calendarData.length > 0) {
      displayDays = [calendarData[0]];
    }

    const isCompact = noteSize === 'compact';
    const cardWidth = isCompact ? 130 : 220;

    displayDays.forEach((dayItem, index) => {
      const dateKey = dayItem.dateString;
      if (!notesState[dateKey]) {
        const isLeft = index % 2 === 0;
        const row = Math.floor(index / 2);
        const defaultX = isLeft ? 20 : (window.innerWidth - cardWidth - 25);
        const defaultY = 20 + row * (isCompact ? 160 : 220);

        notesState[dateKey] = {
          x: Math.max(10, Math.min(defaultX, window.innerWidth - cardWidth - 20)),
          y: Math.max(10, Math.min(defaultY, window.innerHeight - 180)),
          collapsed: false,
          zIndex: 100 + index
        };
      }
    });

    // 1. 展開在畫面上的便利貼
    let expandedCount = 0;
    displayDays.forEach((dayItem, index) => {
      const dateKey = dayItem.dateString;
      const state = notesState[dateKey];
      const theme = STICKY_THEMES[index % STICKY_THEMES.length];
      const isToday = dateKey === todayKey;
      const isTomorrow = isNextDay(now, dateKey);
      const dayOfWeekText = WEEK_DAYS[dayItem.dayOfWeek] || '';

      if (!state.collapsed) {
        expandedCount++;
        const noteEl = createNoteElement(dayItem, state, theme, isToday, isTomorrow, dayOfWeekText, isCompact);
        root.appendChild(noteEl);
        bindDragAndDrop(noteEl, dateKey);
      }
    });

    // 2. 懸浮工具列 (支援 dockPosition: bottom / right / left)
    const bottomDock = createBottomDock(displayDays, expandedCount, todayKey);
    root.appendChild(bottomDock);

    // 3. Toast
    const toast = document.createElement('div');
    toast.id = 'gcal-toast';
    toast.className = 'gcal-toast';
    root.appendChild(toast);
  }

  function createNoteElement(dayItem, state, theme, isToday, isTomorrow, dayOfWeekText, isCompact) {
    const noteEl = document.createElement('div');
    noteEl.className = `gcal-single-note ${isToday ? 'is-today' : ''} ${isCompact ? 'size-compact' : ''}`;
    noteEl.id = `note-${dayItem.dateString}`;
    noteEl.style.setProperty('--note-bg', theme.bg);
    noteEl.style.setProperty('--note-border', theme.border);
    noteEl.style.setProperty('--note-header-bg', theme.headerBg);
    noteEl.style.setProperty('--note-text', theme.text);
    noteEl.style.left = `${Math.max(10, state.x)}px`;
    noteEl.style.top = `${Math.max(10, state.y)}px`;
    noteEl.style.zIndex = state.zIndex || 100;

    let tagHtml = '';
    if (isToday) {
      tagHtml = `<span class="note-tag today-tag">今天</span>`;
    } else if (isTomorrow) {
      tagHtml = `<span class="note-tag tmr-tag">明天</span>`;
    }

    const dayUrl = `https://calendar.google.com/calendar/r/day/${dayItem.year}/${dayItem.month}/${dayItem.day}`;

    let eventsHtml = '';
    if (dayItem.events && dayItem.events.length > 0) {
      eventsHtml = dayItem.events.map(evt => {
        let timeBadge = '';
        if (evt.isAllDay) {
          timeBadge = `<span class="evt-badge all-day">全天</span>`;
        } else if (evt.startTime) {
          timeBadge = `<span class="evt-badge">${evt.startTime}</span>`;
        }

        let locHtml = evt.location ? `<div class="evt-loc" title="${escapeHtml(evt.location)}">📍 ${escapeHtml(evt.location)}</div>` : '';

        return `
          <div class="evt-item" data-url="${dayUrl}" title="點擊在 Google 日曆開啟">
            <div class="evt-title-row">
              ${timeBadge}
              <span class="evt-name">${escapeHtml(evt.title)}</span>
            </div>
            ${locHtml}
          </div>
        `;
      }).join('');
    } else {
      eventsHtml = `
        <div class="empty-day-state">
          <span class="empty-icon">☕</span>
          <span class="empty-txt">${isCompact ? '無行程' : '今日無行程安排'}</span>
        </div>
      `;
    }

    noteEl.innerHTML = `
      <div class="note-pin" title="拖曳此處移動"></div>
      
      <div class="note-header-bar">
        <div class="note-drag-handle">
          <span class="note-date-text">${dayItem.month}/${dayItem.day}</span>
          <span class="note-week-text">${dayOfWeekText}</span>
          ${tagHtml}
        </div>
        <div class="note-header-actions">
          <button class="note-btn btn-open-cal" data-url="${dayUrl}" title="在 Google 日曆中開啟此日">🔗</button>
          <button class="note-btn btn-close-note" title="收合此便利貼至底部">✕</button>
        </div>
      </div>

      <div class="note-body-content">
        ${eventsHtml}
      </div>
    `;

    const btnOpenCal = noteEl.querySelector('.btn-open-cal');
    btnOpenCal.onclick = (e) => {
      e.stopPropagation();
      window.open(btnOpenCal.getAttribute('data-url'), '_blank');
    };

    const btnClose = noteEl.querySelector('.btn-close-note');
    btnClose.onclick = (e) => {
      e.stopPropagation();
      state.collapsed = true;
      saveStateDebounced();
      renderAll();
      showToast(`已收合 ${dayItem.month}月${dayItem.day}日 便利貼至收合列`, 1500);
    };

    noteEl.querySelectorAll('.evt-item').forEach(item => {
      item.onclick = (e) => {
        e.stopPropagation();
        const url = item.getAttribute('data-url');
        if (url) window.open(url, '_blank');
      };
    });

    noteEl.addEventListener('mousedown', () => {
      bringToFront(noteEl, dayItem.dateString);
    });

    return noteEl;
  }

  /**
   * 建立懸浮工具列 (支援 dock-pos-bottom 雙列按鈕 vs dock-pos-right/left 單欄極窄按鈕)
   */
  function createBottomDock(displayDays, expandedCount, todayKey) {
    if (isToolbarDockedToLeft) {
      return renderLeftCornerLauncher(displayDays.length, expandedCount);
    }

    const dock = document.createElement('div');
    dock.className = `gcal-combined-bottom-dock dock-pos-${dockPosition}`;

    const isCompact = noteSize === 'compact';

    // 按鈕文字與切換提示
    let toggleDockLabel = '📐 靠右直排';
    let toggleDockTitle = '點擊切換為：直排在螢幕右方';
    if (dockPosition === 'bottom') {
      toggleDockLabel = '📐 靠右直排';
      toggleDockTitle = '點擊切換為：直排在螢幕右方';
    } else if (dockPosition === 'right') {
      toggleDockLabel = '📐 靠左直排';
      toggleDockTitle = '點擊切換為：直排在螢幕左方';
    } else if (dockPosition === 'left') {
      toggleDockLabel = '📐 靠底橫排';
      toggleDockTitle = '點擊切換為：橫排在螢幕下方';
    }

    let miniNotesHtml = '';
    displayDays.forEach((dayItem, index) => {
      const dateKey = dayItem.dateString;
      const state = notesState[dateKey] || {};
      const isCardCollapsed = state.collapsed;
      const theme = STICKY_THEMES[index % STICKY_THEMES.length];
      const isToday = dateKey === todayKey;
      const dayOfWeekText = WEEK_DAYS[dayItem.dayOfWeek] || '';
      const eventCount = dayItem.events ? dayItem.events.length : 0;

      let tooltipContent = `${dayItem.month}月${dayItem.day}日 (${dayOfWeekText}) - 共 ${eventCount} 件行程\n`;
      if (eventCount > 0) {
        dayItem.events.forEach(e => {
          tooltipContent += `• ${e.isAllDay ? '[全天]' : e.startTime} ${e.title}\n`;
        });
      } else {
        tooltipContent += '• 無行程安排';
      }
      tooltipContent += isCardCollapsed ? '\n(點擊展開至畫面)' : '\n(目前已在畫面展開)';

      miniNotesHtml += `
        <div class="mini-date-sticky ${isToday ? 'is-today' : ''} ${isCardCollapsed ? 'is-docked' : 'is-expanded-on-screen'}" 
             data-date="${dayItem.dateString}" 
             style="--mini-bg: ${theme.bg}; --mini-border: ${theme.border}; --mini-text: ${theme.text};"
             title="${escapeHtml(tooltipContent)}">
          <div class="mini-sticky-pin"></div>
          <div class="mini-date-top">
            <span class="mini-date-num">${dayItem.month}/${dayItem.day}</span>
            <span class="mini-week">${dayOfWeekText}</span>
            ${isToday ? '<span class="mini-today-dot">今</span>' : ''}
          </div>
          <div class="mini-date-count">
            ${isCardCollapsed ? (eventCount > 0 ? `📌 ${eventCount} 件` : '☕ 0 件') : '⬆ 已展開'}
          </div>
        </div>
      `;
    });

    dock.innerHTML = `
      <div class="dock-inner-container">
        <!-- 標題與縮小按鈕 -->
        <div class="dock-left-header">
          <button class="btn-dock-minimize-left" id="btnDockMinimize" title="收合工具列到畫面左下角">◀</button>
          <div class="dock-brand">
            <span class="dock-badge-icon">📅</span>
            <span class="dock-title-text">行事曆</span>
          </div>
        </div>

        <!-- 按鈕區：靠下時為二欄/雙列，靠左右直排時為單欄 -->
        <div class="dock-btn-grid">
          <button class="dock-tool-btn" id="btnToggleSize" title="切換便利貼大小">
            ${isCompact ? '🔍 放大(100%)' : '🔍 縮小(50%)'}
          </button>
          <button class="dock-tool-btn btn-highlight-toggle" id="btnToggleDockPos" title="${toggleDockTitle}">
            ${toggleDockLabel}
          </button>
          <button class="dock-tool-btn" id="btnCollapseAllNotes" title="將所有便利貼全部收合">
            📁 全部收合
          </button>
          <button class="dock-tool-btn" id="btnExpandAllNotes" title="展開所有便利貼回畫面上">
            📂 全部展開
          </button>
          <button class="dock-tool-btn" id="btnDockSync" title="同步最新行事曆">
            🔄 同步
          </button>
          <button class="dock-tool-btn dock-btn-cal" id="btnDockCal" title="開啟 Google 日曆">
            🔗 日曆
          </button>
        </div>

        <!-- 小型日期便利貼滑動軌道區 -->
        <div class="mini-sticky-track-container" id="miniStickyTrackContainer">
          <div class="mini-sticky-track" id="miniStickyTrack">
            ${miniNotesHtml}
          </div>
        </div>
      </div>
    `;

    // 1. 左下角收合
    dock.querySelector('#btnDockMinimize').onclick = () => {
      isToolbarDockedToLeft = true;
      saveStateDebounced();
      renderAll();
      showToast('工具列已收合至畫面左下角', 1200);
    };

    // 2. 尺寸切換
    dock.querySelector('#btnToggleSize').onclick = () => {
      noteSize = (noteSize === 'compact') ? 'normal' : 'compact';
      saveStateDebounced();
      renderAll();
      showToast(`已切換為 ${noteSize === 'compact' ? '精簡迷你 (50%)' : '標準大小 (100%)'}`, 1500);
    };

    // 3. 切換工具列排列方向 (下方橫排 -> 右方直排 -> 左方直排 -> 下方橫排)
    dock.querySelector('#btnToggleDockPos').onclick = () => {
      if (dockPosition === 'bottom') {
        dockPosition = 'right';
        showToast('工具列已切換為：螢幕右方直排', 1500);
      } else if (dockPosition === 'right') {
        dockPosition = 'left';
        showToast('工具列已切換為：螢幕左方直排', 1500);
      } else {
        dockPosition = 'bottom';
        showToast('工具列已切換為：螢幕下方橫排', 1500);
      }
      saveStateDebounced();
      renderAll();
    };

    // 4. 全部收合
    dock.querySelector('#btnCollapseAllNotes').onclick = () => {
      displayDays.forEach(d => {
        if (notesState[d.dateString]) {
          notesState[d.dateString].collapsed = true;
        }
      });
      saveStateDebounced();
      renderAll();
      showToast('已將所有便利貼收合！', 1500);
    };

    // 5. 全部展開
    dock.querySelector('#btnExpandAllNotes').onclick = () => {
      displayDays.forEach(d => {
        if (notesState[d.dateString]) {
          notesState[d.dateString].collapsed = false;
        }
      });
      saveStateDebounced();
      renderAll();
      showToast('已全部展開便利貼！', 1500);
    };

    // 6. 同步與開啟日曆
    dock.querySelector('#btnDockSync').onclick = () => refreshData(true);
    dock.querySelector('#btnDockCal').onclick = () => {
      window.open('https://calendar.google.com/calendar/r', '_blank');
    };

    const track = dock.querySelector('#miniStickyTrack');
    setupDragToScroll(track, dockPosition);

    return dock;
  }

  function setupDragToScroll(track, pos) {
    if (!track) return;

    const isVertical = pos === 'right' || pos === 'left';
    let isDown = false;
    let startPos = 0;
    let initialScroll = 0;
    let hasDragged = false;

    track.addEventListener('mousedown', (e) => {
      isDown = true;
      hasDragged = false;
      track.classList.add('is-dragging-track');

      if (isVertical) {
        startPos = e.pageY - track.offsetTop;
        initialScroll = track.scrollTop;
      } else {
        startPos = e.pageX - track.offsetLeft;
        initialScroll = track.scrollLeft;
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDown) return;
      e.preventDefault();

      if (isVertical) {
        const currentPos = e.pageY - track.offsetTop;
        const walk = (currentPos - startPos) * 1.3;
        if (Math.abs(walk) > 4) hasDragged = true;
        track.scrollTop = initialScroll - walk;
      } else {
        const currentPos = e.pageX - track.offsetLeft;
        const walk = (currentPos - startPos) * 1.3;
        if (Math.abs(walk) > 4) hasDragged = true;
        track.scrollLeft = initialScroll - walk;
      }
    });

    window.addEventListener('mouseup', () => {
      if (!isDown) return;
      isDown = false;
      track.classList.remove('is-dragging-track');
      setTimeout(() => {
        hasDragged = false;
      }, 50);
    });

    track.addEventListener('wheel', (e) => {
      if (isVertical) {
        if (e.deltaY !== 0) {
          e.preventDefault();
          track.scrollTop += e.deltaY * 0.8;
        }
      } else {
        if (e.deltaY !== 0) {
          e.preventDefault();
          track.scrollLeft += e.deltaY * 0.8;
        }
      }
    }, { passive: false });

    track.querySelectorAll('.mini-date-sticky').forEach(el => {
      el.addEventListener('click', (e) => {
        if (hasDragged) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        const targetDate = el.getAttribute('data-date');
        const state = notesState[targetDate];
        if (!state) return;

        state.collapsed = !state.collapsed;
        saveStateDebounced();
        renderAll();

        if (!state.collapsed) {
          setTimeout(() => {
            const targetCard = shadowRoot.querySelector(`#note-${targetDate}`);
            if (targetCard) {
              bringToFront(targetCard, targetDate);
              targetCard.style.transform = 'scale(1.08)';
              setTimeout(() => {
                targetCard.style.transform = '';
              }, 300);
            }
          }, 100);
          showToast(`已展開 ${targetDate} 便利貼`, 1200);
        } else {
          showToast(`已收合 ${targetDate} 便利貼`, 1200);
        }
      });
    });
  }

  function renderLeftCornerLauncher(totalCount, expandedCount) {
    const launcher = document.createElement('div');
    launcher.className = 'gcal-left-corner-launcher';
    launcher.title = '點擊展開行事曆工具列';

    launcher.innerHTML = `
      <div class="launcher-btn">
        <span class="launcher-icon">📅</span>
        <span class="launcher-text">行事曆便利貼</span>
        <span class="launcher-badge">${expandedCount}/${totalCount} 展開</span>
        <span class="launcher-arrow">▶</span>
      </div>
    `;

    launcher.onclick = () => {
      isToolbarDockedToLeft = false;
      saveStateDebounced();
      renderAll();
      showToast('已展開工具列', 1200);
    };

    return launcher;
  }

  function bindDragAndDrop(noteEl, dateKey) {
    const handle = noteEl.querySelector('.note-header-bar');
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('.note-btn')) return;

      isDragging = true;
      noteEl.classList.add('is-dragging');
      bringToFront(noteEl, dateKey);

      startX = e.clientX;
      startY = e.clientY;
      initialLeft = noteEl.offsetLeft;
      initialTop = noteEl.offsetTop;

      const onMouseMove = (moveEvent) => {
        if (!isDragging) return;
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;

        let newLeft = initialLeft + dx;
        let newTop = initialTop + dy;

        newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - 40));
        newTop = Math.max(0, Math.min(newTop, window.innerHeight - 40));

        noteEl.style.left = `${newLeft}px`;
        noteEl.style.top = `${newTop}px`;
      };

      const onMouseUp = () => {
        if (!isDragging) return;
        isDragging = false;
        noteEl.classList.remove('is-dragging');

        if (notesState[dateKey]) {
          notesState[dateKey].x = noteEl.offsetLeft;
          notesState[dateKey].y = noteEl.offsetTop;
          saveStateDebounced();
        }

        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  }

  function bringToFront(el, dateKey) {
    let maxZ = 100;
    Object.values(notesState).forEach(s => {
      if (s.zIndex && s.zIndex > maxZ) maxZ = s.zIndex;
    });
    const newZ = maxZ + 1;
    el.style.zIndex = newZ;
    if (notesState[dateKey]) {
      notesState[dateKey].zIndex = newZ;
    }
  }

  function renderSetupHint() {
    if (!shadowRoot) return;
    const root = shadowRoot.querySelector('#gcal-app-root');
    if (!root) return;

    root.innerHTML = `
      <div class="gcal-combined-bottom-dock dock-pos-${dockPosition}">
        <div class="dock-left-header">
          <span class="dock-badge-icon">📅</span>
          <span class="dock-title-text">行事曆便利貼：請先點擊擴充工具圖示設定 GAS 網址</span>
        </div>
      </div>
    `;
  }

  function showToast(msg, duration = 2000) {
    if (!shadowRoot) return;
    const toast = shadowRoot.querySelector('#gcal-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, duration);
  }

  function formatDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function isNextDay(today, dateStr) {
    const tmr = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    return formatDateKey(tmr) === dateStr;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getStyles() {
    return `
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
        user-select: none;
      }

      #gcal-app-root {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        pointer-events: none;
        z-index: 2147483647;
      }

      /* 展開狀態的便利貼卡片 */
      .gcal-single-note {
        position: fixed;
        width: 220px;
        background-color: var(--note-bg, #fff9db);
        border: 1px solid var(--note-border, #fcc419);
        border-radius: 10px;
        box-shadow: 0 8px 24px -4px rgba(0, 0, 0, 0.15), 0 2px 6px rgba(0, 0, 0, 0.08);
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transition: box-shadow 0.2s ease, transform 0.1s ease;
      }

      .gcal-single-note:hover {
        box-shadow: 0 14px 28px -4px rgba(0, 0, 0, 0.22), 0 4px 10px rgba(0, 0, 0, 0.12);
      }

      .gcal-single-note.is-dragging {
        opacity: 0.92;
        transform: scale(1.03);
        box-shadow: 0 20px 35px rgba(0, 0, 0, 0.25);
        cursor: grabbing !important;
      }

      .gcal-single-note.is-today {
        border-width: 2px;
        border-color: #ef4444;
      }

      .note-pin {
        position: absolute;
        top: 2px;
        left: 50%;
        transform: translateX(-50%);
        width: 28px;
        height: 4px;
        background: rgba(0, 0, 0, 0.15);
        border-radius: 2px;
        pointer-events: none;
      }

      .note-header-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 10px;
        background: var(--note-header-bg, #fff3bf);
        border-bottom: 1px dashed rgba(0, 0, 0, 0.15);
        cursor: grab;
      }

      .note-drag-handle {
        display: flex;
        align-items: center;
        gap: 5px;
        flex-wrap: wrap;
      }

      .note-date-text {
        font-size: 13px;
        font-weight: 700;
        color: #1e293b;
      }

      .note-week-text {
        font-size: 11px;
        font-weight: 600;
        color: #64748b;
      }

      .note-tag {
        font-size: 10px;
        font-weight: 700;
        padding: 1px 4px;
        border-radius: 3px;
      }

      .today-tag {
        background: #ef4444;
        color: #ffffff;
      }

      .tmr-tag {
        background: #f97316;
        color: #ffffff;
      }

      .note-header-actions {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .note-btn {
        background: transparent;
        border: none;
        color: #475569;
        font-size: 12px;
        font-weight: 700;
        width: 22px;
        height: 22px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: background 0.15s, color 0.15s;
      }

      .note-btn:hover {
        background: rgba(0, 0, 0, 0.1);
        color: #0f172a;
      }

      .note-btn.btn-close-note:hover {
        background: #fee2e2;
        color: #ef4444;
      }

      .note-body-content {
        padding: 8px 10px;
        max-height: 260px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .note-body-content::-webkit-scrollbar {
        width: 4px;
      }

      .note-body-content::-webkit-scrollbar-thumb {
        background: rgba(0, 0, 0, 0.15);
        border-radius: 4px;
      }

      .evt-item {
        background: rgba(255, 255, 255, 0.82);
        padding: 6px 8px;
        border-radius: 6px;
        border: 1px solid rgba(0, 0, 0, 0.05);
        cursor: pointer;
        transition: background 0.15s, transform 0.1s;
      }

      .evt-item:hover {
        background: rgba(255, 255, 255, 0.98);
        border-color: rgba(0, 0, 0, 0.18);
        transform: translateY(-1px);
      }

      .evt-title-row {
        display: flex;
        align-items: flex-start;
        gap: 5px;
      }

      .evt-badge {
        font-size: 10px;
        font-weight: 700;
        background: #0284c7;
        color: #ffffff;
        padding: 1px 4px;
        border-radius: 3px;
        white-space: nowrap;
        flex-shrink: 0;
        margin-top: 1px;
      }

      .evt-badge.all-day {
        background: #64748b;
      }

      .evt-name {
        font-size: 12px;
        font-weight: 600;
        color: #1e293b;
        line-height: 1.35;
        word-break: break-word;
      }

      .evt-loc {
        font-size: 10px;
        color: #64748b;
        margin-top: 3px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .empty-day-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 18px 0;
        color: #94a3b8;
        gap: 3px;
      }

      .empty-icon {
        font-size: 18px;
        opacity: 0.7;
      }

      .empty-txt {
        font-size: 11px;
        font-weight: 500;
      }

      /* 精簡尺寸 */
      .gcal-single-note.size-compact {
        width: 132px;
        border-radius: 7px;
      }

      .gcal-single-note.size-compact .note-pin {
        width: 16px;
        height: 3px;
      }

      .gcal-single-note.size-compact .note-header-bar {
        padding: 5px 6px;
      }

      .gcal-single-note.size-compact .note-date-text {
        font-size: 11px;
      }

      .gcal-single-note.size-compact .note-week-text {
        font-size: 9px;
      }

      .gcal-single-note.size-compact .note-tag {
        font-size: 8px;
        padding: 0 2px;
      }

      .gcal-single-note.size-compact .note-btn {
        width: 16px;
        height: 16px;
        font-size: 10px;
      }

      .gcal-single-note.size-compact .note-body-content {
        padding: 5px 6px;
        max-height: 170px;
        gap: 4px;
      }

      .gcal-single-note.size-compact .evt-item {
        padding: 4px 5px;
        border-radius: 4px;
      }

      .gcal-single-note.size-compact .evt-badge {
        font-size: 8px;
        padding: 0 2px;
      }

      .gcal-single-note.size-compact .evt-name {
        font-size: 10px;
        line-height: 1.25;
      }

      .gcal-single-note.size-compact .evt-loc {
        font-size: 8px;
        margin-top: 2px;
      }

      .gcal-single-note.size-compact .empty-day-state {
        padding: 8px 0;
      }

      .gcal-single-note.size-compact .empty-icon {
        font-size: 14px;
      }

      .gcal-single-note.size-compact .empty-txt {
        font-size: 9px;
      }

      /* ========================================================
         通用懸浮工具列容器
         ======================================================== */
      .gcal-combined-bottom-dock {
        position: fixed;
        background: rgba(15, 23, 42, 0.94);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        box-shadow: 0 16px 36px -6px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.08);
        pointer-events: auto;
        z-index: 2147483647;
        transition: all 0.28s cubic-bezier(0.16, 1, 0.3, 1);
      }

      /* ========================================================
         1. 下方橫排模式 (dock-pos-bottom)：按鈕為二欄雙列
         ======================================================== */
      .gcal-combined-bottom-dock.dock-pos-bottom {
        bottom: 10px;
        left: 50%;
        transform: translateX(-50%);
        max-width: 96vw;
        border-radius: 14px;
        padding: 6px 10px;
      }

      .gcal-combined-bottom-dock.dock-pos-bottom .dock-inner-container {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .gcal-combined-bottom-dock.dock-pos-bottom .dock-left-header {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        padding-right: 8px;
        border-right: 1px solid rgba(255, 255, 255, 0.18);
        flex-shrink: 0;
      }

      /* 下方橫排：按鈕維持 3 欄 x 2 列 雙列式 */
      .gcal-combined-bottom-dock.dock-pos-bottom .dock-btn-grid {
        display: grid;
        grid-template-columns: repeat(3, auto);
        grid-template-rows: repeat(2, auto);
        gap: 3px 4px;
        padding-right: 10px;
        border-right: 1px solid rgba(255, 255, 255, 0.18);
        flex-shrink: 0;
      }

      .gcal-combined-bottom-dock.dock-pos-bottom .mini-sticky-track-container {
        overflow: hidden;
        max-width: 62vw;
      }

      .gcal-combined-bottom-dock.dock-pos-bottom .mini-sticky-track {
        display: flex;
        align-items: center;
        gap: 6px;
        overflow-x: auto;
        padding: 2px 2px;
      }

      .gcal-combined-bottom-dock.dock-pos-bottom .mini-date-sticky {
        flex: 0 0 84px;
        width: 84px;
        height: 44px;
      }

      /* ========================================================
         2. 螢幕右方/左方直排模式 (dock-pos-right & dock-pos-left)
         按鈕改為「單欄排列 (1 Column)」，極窄精巧 (寬度約 100px)
         ======================================================== */
      .gcal-combined-bottom-dock.dock-pos-right {
        top: 50%;
        right: 10px;
        transform: translateY(-50%);
        max-height: 90vh;
        width: 104px;
        border-radius: 12px;
        padding: 6px 5px;
      }

      .gcal-combined-bottom-dock.dock-pos-left {
        top: 50%;
        left: 10px;
        transform: translateY(-50%);
        max-height: 90vh;
        width: 104px;
        border-radius: 12px;
        padding: 6px 5px;
      }

      .gcal-combined-bottom-dock.dock-pos-right .dock-inner-container,
      .gcal-combined-bottom-dock.dock-pos-left .dock-inner-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 5px;
        height: 100%;
        width: 100%;
      }

      .gcal-combined-bottom-dock.dock-pos-right .dock-left-header,
      .gcal-combined-bottom-dock.dock-pos-left .dock-left-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        padding: 0 2px 4px 2px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.18);
      }

      /* 直排模式：按鈕改為「單欄排列 (1 Column)」 */
      .gcal-combined-bottom-dock.dock-pos-right .dock-btn-grid,
      .gcal-combined-bottom-dock.dock-pos-left .dock-btn-grid {
        display: flex;
        flex-direction: column;
        gap: 2.5px;
        width: 100%;
        padding-bottom: 5px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.18);
      }

      .gcal-combined-bottom-dock.dock-pos-right .dock-tool-btn,
      .gcal-combined-bottom-dock.dock-pos-left .dock-tool-btn {
        width: 100%;
        height: 20px;
        font-size: 9.5px;
        padding: 1px 3px;
        text-align: center;
      }

      .gcal-combined-bottom-dock.dock-pos-right .mini-sticky-track-container,
      .gcal-combined-bottom-dock.dock-pos-left .mini-sticky-track-container {
        overflow: hidden;
        width: 100%;
        max-height: 46vh;
      }

      .gcal-combined-bottom-dock.dock-pos-right .mini-sticky-track,
      .gcal-combined-bottom-dock.dock-pos-left .mini-sticky-track {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 1px;
        max-height: 45vh;
      }

      .gcal-combined-bottom-dock.dock-pos-right .mini-date-sticky,
      .gcal-combined-bottom-dock.dock-pos-left .mini-date-sticky {
        width: 100%;
        height: 40px;
        flex: 0 0 40px;
        padding: 2px 4px;
      }

      /* 控制元件共通樣式 */
      .btn-dock-minimize-left {
        background: rgba(255, 255, 255, 0.15);
        border: 1px solid rgba(255, 255, 255, 0.25);
        color: #ffffff;
        font-size: 9px;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .btn-dock-minimize-left:hover {
        background: rgba(255, 255, 255, 0.35);
        transform: scale(1.15);
      }

      .dock-brand {
        display: flex;
        align-items: center;
        gap: 3px;
      }

      .dock-badge-icon {
        font-size: 12px;
      }

      .dock-title-text {
        font-size: 10px;
        font-weight: 700;
        color: #ffffff;
        white-space: nowrap;
      }

      .dock-tool-btn {
        background: rgba(255, 255, 255, 0.12);
        border: 1px solid rgba(255, 255, 255, 0.18);
        color: #ffffff;
        font-size: 10px;
        font-weight: 600;
        padding: 2px 5px;
        height: 22px;
        border-radius: 4px;
        cursor: pointer;
        transition: background 0.15s, transform 0.1s;
        white-space: nowrap;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .dock-tool-btn:hover {
        background: rgba(255, 255, 255, 0.25);
      }

      .dock-tool-btn:active {
        transform: scale(0.96);
      }

      .dock-tool-btn.btn-highlight-toggle {
        background: #0284c7;
        border-color: #38bdf8;
      }

      .dock-tool-btn.btn-highlight-toggle:hover {
        background: #0369a1;
      }

      .dock-tool-btn.dock-btn-cal {
        background: #2563eb;
        border-color: #3b82f6;
      }

      .dock-tool-btn.dock-btn-cal:hover {
        background: #1d4ed8;
      }

      /* 軌道手勢 */
      .mini-sticky-track {
        cursor: grab;
        user-select: none;
        -webkit-user-select: none;
      }

      .mini-sticky-track.is-dragging-track {
        cursor: grabbing !important;
        scroll-behavior: auto !important;
      }

      .mini-sticky-track::-webkit-scrollbar {
        width: 4px;
        height: 4px;
      }

      .mini-sticky-track::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.25);
        border-radius: 4px;
      }

      /* 小型日期卡片 */
      .mini-date-sticky {
        background-color: var(--mini-bg, #fff9db);
        border: 1px solid var(--mini-border, #fcc419);
        border-radius: 6px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        cursor: pointer;
        position: relative;
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.15);
        transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.2s ease;
      }

      .mini-date-sticky:hover {
        transform: translateY(-2px) scale(1.04);
        box-shadow: 0 5px 12px rgba(0, 0, 0, 0.25);
        z-index: 5;
      }

      .mini-date-sticky.is-docked {
        opacity: 1;
      }

      .mini-date-sticky.is-expanded-on-screen {
        opacity: 0.6;
        border-style: dashed;
      }

      .mini-date-sticky.is-today {
        border: 2px solid #ef4444;
      }

      .mini-sticky-pin {
        position: absolute;
        top: -3px;
        left: 50%;
        transform: translateX(-50%);
        width: 14px;
        height: 3px;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 2px;
      }

      .mini-date-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 10px;
        font-weight: 700;
        color: var(--mini-text, #1e293b);
        line-height: 1.1;
      }

      .mini-date-num {
        font-size: 10px;
      }

      .mini-week {
        font-size: 9px;
        opacity: 0.8;
      }

      .mini-today-dot {
        background: #ef4444;
        color: #ffffff;
        font-size: 8px;
        font-weight: 800;
        padding: 0 2px;
        border-radius: 2px;
      }

      .mini-date-count {
        font-size: 9px;
        font-weight: 600;
        color: #475569;
        text-align: center;
        background: rgba(255, 255, 255, 0.65);
        border-radius: 3px;
        padding: 1px 0;
        white-space: nowrap;
        overflow: hidden;
      }

      /* 左下角微型啟動鈕 */
      .gcal-left-corner-launcher {
        position: fixed;
        bottom: 12px;
        left: 12px;
        pointer-events: auto;
        z-index: 2147483647;
        animation: slideInLeftCorner 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        cursor: pointer;
      }

      @keyframes slideInLeftCorner {
        from {
          opacity: 0;
          transform: translateX(-20px) scale(0.9);
        }
        to {
          opacity: 1;
          transform: translateX(0) scale(1);
        }
      }

      .launcher-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        background: rgba(15, 23, 42, 0.94);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: #ffffff;
        padding: 5px 10px;
        border-radius: 20px;
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
        transition: transform 0.2s ease, background 0.2s ease;
      }

      .launcher-btn:hover {
        transform: scale(1.06);
        background: rgba(30, 41, 59, 0.98);
        border-color: rgba(255, 255, 255, 0.4);
      }

      .launcher-icon {
        font-size: 13px;
      }

      .launcher-text {
        font-size: 10px;
        font-weight: 700;
        white-space: nowrap;
      }

      .launcher-badge {
        font-size: 9px;
        font-weight: 800;
        background: #2563eb;
        color: #ffffff;
        padding: 1px 5px;
        border-radius: 10px;
      }

      .launcher-arrow {
        font-size: 9px;
        color: #94a3b8;
      }

      .gcal-toast {
        position: fixed;
        top: 20px;
        right: 20px;
        background: #0f172a;
        color: #ffffff;
        padding: 8px 14px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 500;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
        opacity: 0;
        transform: translateY(-10px);
        transition: all 0.25s ease;
        pointer-events: none;
        z-index: 2147483647;
      }

      .gcal-toast.show {
        opacity: 1;
        transform: translateY(0);
      }
    `;
  }
})();
