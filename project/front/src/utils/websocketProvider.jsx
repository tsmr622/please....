import React, { createContext, useContext, useEffect, useRef, useState } from "react";

const WebSocketContext = createContext();

export function WebSocketProvider({ children }) {
  const [messages, setMessages] = useState([]);
  const wsRef = useRef(null);
  // messages 초기화 함수
  const clearMessages = () => setMessages([]);

  useEffect(() => {
    // 크롬 스토리지에서 토큰 비동기 로드
    chrome.storage.local.get("token", (result) => {
      const token = result.token;
      if (!token) {
        console.warn("JWT 토큰이 없습니다. WebSocket 연결 실패.");
        return;
      }

      // 웹소켓 연결
      const ws = new WebSocket(`ws://localhost:8000/ws?token=${token}`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("웹소켓 연결됨");
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("[WebSocket] 데이터 수신:", data);
          setMessages(prev => [...prev, data]);
        } catch (e) {
          console.error("WebSocket 메시지 파싱 오류:", e);
        }
      };

      ws.onclose = () => {
        console.log("웹소켓 연결 종료");
      };

      ws.onerror = (err) => {
        console.error("웹소켓 에러:", err);
      };
    });

    // 언마운트 시 연결 해제
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  return (
    <WebSocketContext.Provider value={{ messages, clearMessages }}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error("useWebSocket은 WebSocketProvider 내부에서만 사용해야 합니다.");
  }
  return context;
}