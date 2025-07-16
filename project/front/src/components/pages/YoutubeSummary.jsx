import { useState, useEffect, useCallback } from "react";
import logo from "/icons/le_penseur.png";
import Card from '../ui/Card';
import Button from '../ui/Button';
import './YoutubeSummary.css';
import '../ui/CustomScrollbar.css';
import { useWebSocket } from "../../utils/websocketProvider";

const CARD_REGEX = /__(COMMENT|SUMMARY|TIMELINE)\|\|\|/g;

function splitStreamCards(streamText) {
  let cards = [];
  let match;
  let lastIndex = 0;
  let lastType = null;

  while ((match = CARD_REGEX.exec(streamText)) !== null) {
    if (lastType) {
      const content = streamText.slice(lastIndex, match.index);
      cards.push({ type: lastType, content });
    }
    lastType = match[1];
    lastIndex = CARD_REGEX.lastIndex;
  }
  if (lastType && lastIndex < streamText.length) {
    const content = streamText.slice(lastIndex);
    cards.push({ type: lastType, content });
  }
  return cards;
}

function parseCard(card) {
  if (card.type === "TIMELINE") {
    const lines = card.content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    return {
      type: "TIMELINE",
      lines,
    };
  }

  return {
    type: card.type,
    value: card.content.trim(),
  };
}

export default function YoutubeSummary() {
  const { messages, clearMessages } = useWebSocket();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // 요약 요청 핸들러
  const handleSummarize = useCallback(async () => {
    clearMessages();
    setError("");
    setLoading(true);
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const currentTab = tabs[0];
      if (!currentTab?.url) {
        setError('현재 탭의 URL을 가져올 수 없습니다.');
        setLoading(false);
        return;
      }
      const youtubeUrl = currentTab.url;
      if (!youtubeUrl.includes('youtube.com/watch') && !youtubeUrl.includes('youtube.com/shorts')) {
        setError('YouTube 페이지가 아닙니다.');
        setLoading(false);
        return;
      }
      const token = await new Promise((resolve) => {
        chrome.storage.local.get(['token'], (result) => resolve(result.token));
      });
      if (!token) {
        setError('로그인이 필요합니다.');
        setLoading(false);
        return;
      }
      const response = await fetch('http://localhost:8000/collect/youtube', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ youtube_url: youtubeUrl })
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      setLoading(false);
    } catch (error) {
      setError(error.message);
      setLoading(false);
    }
  }, [clearMessages]);

  // 메시지 합치기 및 카드 파싱
  const fullText = messages.map(msg => msg.content).join("");
  const rawCards = splitStreamCards(fullText);
  const cards = rawCards.map(parseCard);

  return (
    <div className="youtube-summary-page custom-scrollbar">
      <div className="logo-section">
        <img src={logo} className="logo" alt="logo" style={{ width: '150px', height: '150px' }} />
      </div>
      <div className="result-section">
        {error && (
          <Card>
            <p style={{ color: 'red' }}>{error}</p>
          </Card>
        )}
        {cards.length === 0 && !loading && !error && (
          <Card>
            <p>아직 요약 결과가 없습니다.</p>
          </Card>
        )}
        {cards.map((card, i) => (
          <Card key={i} className={`card-${card.type.toLowerCase()}`}>
            {card.type === "COMMENT" && <div>{card.value}</div>}
            {card.type === "SUMMARY" && <div>{card.value}</div>}
            {card.type === "TIMELINE" && (
              <div>
                {card.lines.map((line, idx) => {
                    const time = line.slice(0, 7);
                    const text = line.slice(7).trim();

                    return (
                        <div key={idx} className="timeline-entry" style={{ marginBottom: '20px' }}>{line}
                            <span className="timeline_time">{time}</span>
                            <span className="timeline_text">{text}</span>
                        </div>
                        );
                })}
              </div>
            )}
          </Card>
        ))}
        <Button onClick={handleSummarize} className="summarize-button-left" disabled={loading}>
          {loading ? '요약 중...' : '요약 시작'}
        </Button>
      </div>
    </div>
  );
}