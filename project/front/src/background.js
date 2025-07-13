import { collect } from './utils/browserCollector.js';
import { youtubeCollector } from './utils/youtubeCollector.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// src/background.js  Manifest v3, Chrome 116+
const API = import.meta.env.VITE_API_BASE + "/collect/browser";


// 전역 단일 디바운스 타이머 및 상태
let debounceTimer = null;
// url 이벤트 윈도우 관리
let lastSentUrl = null;
let lastSentTime = 0;
// 자동 수집 트리거 관리: handleAutoCollect
function handleAutoCollect(tabId, triggerType) {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    chrome.tabs.get(tabId, (tab) => {
      const url = tab.url;
      const now = Date.now();
      // 5초 이내 동일 url에 대한 연속 요청 무시
      if (url === lastSentUrl && now - lastSentTime < 5000) {
        debounceTimer = null;
        return;
      }
      lastSentUrl = url;
      lastSentTime = now;
      collect(tabId).then((data) => {
        if (data) {
          // Recommend 페이지에 웹소켓 메시지 초기화 트리거
          chrome.runtime.sendMessage({ type: "RESET_WEBSOCKET_MESSAGE" });
          sendToBackend(data, triggerType);
        }
      });
      debounceTimer = null;
    });
  }, 1500);
}


// 자동 트리거: 탭 로드 완료 (url, complete)
chrome.tabs.onUpdated.addListener((id, info, tab) => {
  try {
    if (info.url) setTimeout(() => handleAutoCollect(id, 'url'), 500);
    if (info.status === "complete") handleAutoCollect(id, 'complete');
  } catch (e) {
    console.error("[onUpdated] Unexpected error", e);
  }
});

// 자동 트리거: 탭 전환 (tab)
chrome.tabs.onActivated.addListener(({ tabId }) => {
  try {
    handleAutoCollect(tabId, 'tab');
  } catch (e) {
    console.error("[onActivated] Unexpected error", e);
  }
});

// 백엔드 전송 함수
async function sendToBackend(data, triggerType) {
  if (!data) return;
  const API = import.meta.env.VITE_API_BASE + "/collect/browser";
  // JWT 읽기
  chrome.storage.local.get(['token'], async (result) => {
    const token = result.token;
    try {
      await fetch(API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : undefined
        },
        body: JSON.stringify({ ...data, trigger_type: triggerType })
      });
      console.log(`[sendToBackend] Data sent (trigger: ${triggerType})`);
    } catch (e) {
      console.error("[sendToBackend] Failed", e);
    }
  });
}


chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
// DOM 준비: content_script에서 CONTENT_READY 메시지
  if (msg.type === "CONTENT_READY" && sender.tab && sender.tab.id) {
    handleAutoCollect(sender.tab.id, 'content_ready');
  }
// 버튼 클릭 메시지 수집 요청 시 처리
  if (msg.type === "COLLECT_BY_BUTTON") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tabId = tabs[0]?.id;
      if (!tabId) return sendResponse({ error: "No active tab" });
      
      const data = await collect(tabId);
      if (data) {
        sendToBackend(data, 'button');
        sendResponse(data);
      } else {
        sendResponse({ error: "Collection failed" });
      }
    });
    return true; // async 응답
  }

  if (msg.type === "YOUTUBE_DETECTED") {
    console.log("[YOUTUBE_DETECTED"); {
      // 로그인 상태 확인
      chrome.storage.local.get(['token'], (result) => {
        const token = result.token;
        if (!token) {
          console.log("로그인 필요해!!!");
          sendResponse({ statue: "login_required", error: "Login required"});
          return;
        }

        // async 함수 정의, 실행
        (async () => {
          try {
            const youtubeUrl = msg.url;
            const response = await fetch("http://localhost:8000/collect/youtube", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
              },
              body: JSON.stringify({ youtube_url: youtubeUrl }),
            });

            const result = await response.json();
            console.log("추출된 URL:", result);
            sendResponse({ status: "success", result: result});
          } catch (error) {
            console.error("URL 전송 중 오류:", error);
            sendResponse({ status: "error", error: error.message });
          }
        })();
      });
      return true;
    }
  }




});
