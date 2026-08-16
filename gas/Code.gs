/**
 * 網頁行事曆便利貼 - Google Apps Script (GAS) 後端程式
 * 修復：移除 Session.getEffectiveUser 權限報錯問題，確保 Web App 免授權衝突穩定運行
 */

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  try {
    const params = (e && e.parameter) || {};
    const action = params.action || 'getEvents';

    // 1. 新增行程至 Google 日曆
    if (action === 'createEvent') {
      let title = params.title || '新行程';
      let startStr = params.start;
      let endStr = params.end;
      let isAllDay = params.isAllDay === 'true' || params.isAllDay === true;
      let location = params.location || '';
      let description = params.description || '';

      if (e && e.postData && e.postData.contents) {
        try {
          const body = JSON.parse(e.postData.contents);
          if (body.title) title = body.title;
          if (body.start) startStr = body.start;
          if (body.end) endStr = body.end;
          if (body.isAllDay !== undefined) isAllDay = body.isAllDay;
          if (body.location) location = body.location;
          if (body.description) description = body.description;
        } catch (jsonErr) {}
      }

      if (!startStr) {
        throw new Error('未提供開始時間 (start)');
      }

      const defaultCal = CalendarApp.getDefaultCalendar();
      let createdEvent = null;

      if (isAllDay) {
        const startDate = new Date(startStr);
        createdEvent = defaultCal.createAllDayEvent(title, startDate, {
          location: location,
          description: description
        });
      } else {
        const startTime = new Date(startStr);
        const endTime = endStr ? new Date(endStr) : new Date(startTime.getTime() + 60 * 60 * 1000);
        createdEvent = defaultCal.createEvent(title, startTime, endTime, {
          location: location,
          description: description
        });
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        message: '行程已成功加入 Google 日曆！',
        eventId: createdEvent.getId()
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 2. 取得行程清單
    const days = parseInt(params.days || '7', 10);
    const maxDays = Math.min(Math.max(days, 1), 90);
    const scope = params.scope || 'primary'; // 'primary': 僅個人主要日曆 (預設), 'owned': 個人擁有, 'all': 全部包含共用
    
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + maxDays, 23, 59, 59);

    const defaultCal = CalendarApp.getDefaultCalendar();
    
    // 安全取得使用者 Email 或日曆名稱 (不觸發 Session.getEffectiveUser 權限錯誤)
    let userEmail = '';
    try {
      if (defaultCal) {
        userEmail = defaultCal.getName() || defaultCal.getId();
      }
    } catch (e) {
      userEmail = '已連結';
    }

    // 依據 scope 挑選要讀取的日曆
    const targetCals = [];
    const calIdSet = new Set();

    if (defaultCal) {
      targetCals.push(defaultCal);
      calIdSet.add(defaultCal.getId());
    }

    if (scope !== 'primary') {
      try {
        const allCals = CalendarApp.getAllCalendars();
        allCals.forEach(cal => {
          if (!calIdSet.has(cal.getId())) {
            if (scope === 'all') {
              targetCals.push(cal);
              calIdSet.add(cal.getId());
            } else if (scope === 'owned') {
              if (cal.isMyPrimaryCalendar() || cal.isOwnedByMe()) {
                targetCals.push(cal);
                calIdSet.add(cal.getId());
              }
            }
          }
        });
      } catch (calListErr) {
        // 略過無法取得清單的錯誤
      }
    }

    const eventMap = {};

    // 初始化每天的結構
    for (let i = 0; i < maxDays; i++) {
      const d = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
      const dateKey = formatDateKey(d);
      eventMap[dateKey] = {
        dateString: dateKey,
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        day: d.getDate(),
        dayOfWeek: d.getDay(),
        events: []
      };
    }

    // 抓取日曆行程
    targetCals.forEach(cal => {
      try {
        const events = cal.getEvents(startDate, endDate);
        events.forEach(evt => {
          const isAllDay = evt.isAllDayEvent();
          const evtStart = evt.getStartTime();
          let evtEnd = evt.getEndTime();
          
          const eventItem = {
            id: evt.getId(),
            title: evt.getTitle() || '(無標題)',
            isAllDay: isAllDay,
            startTime: isAllDay ? null : formatTime(evtStart),
            endTime: isAllDay ? null : formatTime(evtEnd),
            startIso: evtStart.toISOString(),
            endIso: evtEnd.toISOString(),
            location: evt.getLocation() || '',
            description: evt.getDescription() || '',
            calendarName: cal.getName()
          };

          // 修正全天事件結束時間
          let effectiveEnd = new Date(evtEnd.getTime());
          if (isAllDay || (effectiveEnd.getHours() === 0 && effectiveEnd.getMinutes() === 0 && effectiveEnd.getSeconds() === 0 && effectiveEnd.getTime() > evtStart.getTime())) {
            effectiveEnd = new Date(effectiveEnd.getTime() - 1000);
          }

          const cur = new Date(Math.max(evtStart.getTime(), startDate.getTime()));
          const endLimit = new Date(Math.min(effectiveEnd.getTime(), endDate.getTime()));
          
          while (cur <= endLimit) {
            const key = formatDateKey(cur);
            if (eventMap[key]) {
              const isDuplicate = eventMap[key].events.some(e => {
                if (e.id === eventItem.id) return true;
                if (e.title === eventItem.title && e.startIso === eventItem.startIso && e.isAllDay === eventItem.isAllDay) {
                  return true;
                }
                return false;
              });

              if (!isDuplicate) {
                eventMap[key].events.push(eventItem);
              }
            }
            cur.setDate(cur.getDate() + 1);
            cur.setHours(0, 0, 0, 0);
          }
        });
      } catch (calErr) {
        // 略過無法讀取的個別日曆
      }
    });

    const resultDays = Object.keys(eventMap).sort().map(key => {
      const dayData = eventMap[key];
      dayData.events.sort((a, b) => {
        if (a.isAllDay && !b.isAllDay) return -1;
        if (!a.isAllDay && b.isAllDay) return 1;
        return new Date(a.startIso).getTime() - new Date(b.startIso).getTime();
      });
      return dayData;
    });

    const responseData = {
      status: 'success',
      userEmail: userEmail,
      scope: scope,
      calendarsUsed: targetCals.map(c => c.getName()),
      updatedAt: new Date().toISOString(),
      daysCount: maxDays,
      data: resultDays
    };

    return ContentService.createTextOutput(JSON.stringify(responseData))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    const errorResponse = {
      status: 'error',
      message: error.toString()
    };
    return ContentService.createTextOutput(JSON.stringify(errorResponse))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function formatDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatTime(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * 測試與強制觸發授權函式：
 * 若在 Chromebook 或瀏覽器中出現「The script does not have permission」錯誤，
 * 請在 GAS 編輯器上方選取此函式「testAuth」，點擊「執行」▶️，即可跳出 Google 授權視窗完成授權！
 */
function testAuth() {
  const cal = CalendarApp.getDefaultCalendar();
  Logger.log('成功連接 Google 日曆: ' + cal.getName());
}
