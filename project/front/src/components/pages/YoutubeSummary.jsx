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
      .filter((line, index, self) => line.length > 0 && self.indexOf(line) === index); // 중복 제거
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

function mmssToSeconds(timeStr) {
  const [min, sec] = timeStr.split(':').map(Number);
  return min * 60 + sec;
}

// 2. 유튜브 플레이어로 이동시키는 함수 (background로 메시지 전달)
function SeekTo(seconds) {
  chrome.runtime.sendMessage({ type: "SEEK_TO", seconds });
}

// 3. 타임라인 한 줄 렌더링 (시간 클릭 가능)
function TimelineItem({ timelineText, Onseek }) {
  const match = timelineText.match(/\[([0-9]{1,3}:[0-9]{2})\]/);
  const timeStr = match ? match[1] : null;

  return (
    <div>
      {timeStr ? (
        <span
          style={{ color: 'blue', cursor: "pointer", fontWeight: "bold" }}
          onClick={() => Onseek(mmssToSeconds(timeStr))}
        >
          [{timeStr}]
        </span>
      ) : null}
      {timelineText.replace(/\[([0-9]{1,3}:[0-9]{2})\]/, '')}
    </div>
  );
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

  // TIMELINE 카드 중복 제거
  const filteredCards = [];
  const seenTimelineKeys = new Set();

  for (const card of cards) {
    if (card.type === "TIMELINE") {
      // lines가 없는 경우도 대비
      const key = (card.lines || []).join('|');
      if (seenTimelineKeys.has(key)) continue;
      seenTimelineKeys.add(key);
      filteredCards.push(card);
    } else {
      filteredCards.push(card);
    }
  }

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

        {filteredCards.length === 0 && !loading && !error && (
          <Card>
            <p>궁금해.. 이 영상이 궁금해..</p>
          </Card>
        )}

        {filteredCards.map((card, i) => {
        const cardClass = `card-${card.type.toLowerCase()}`; // e.g., card-comment, card-summary, card-timeline

        return (
          <Card key={i} className={cardClass}>
            {card.type === "COMMENT" && <div>{card.value}</div>}
            {card.type === "SUMMARY" && <div>{card.value}</div>}
            {card.type === "TIMELINE" && (
              <div>
                {card.lines.map((line, idx) => {
                  const time = line.slice(1, 6);
                  const text = line.slice(7).trim();

                  return (
                    <div key={idx} className="timeline-entry" style={{ marginBottom: '20px' }}>
                      <span
                       className="timeline_time"
                       style={{ color: '#00CE93', cursor: "pointer", fontWeight: "bold" }}
                       onClick={() => SeekTo(mmssToSeconds(time))}
                      >
                        [{time}]
                      </span>
                      <span className="timeline_text">{text}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        );
      })}

      <Button onClick={handleSummarize} className="summarize-button-left" disabled={loading}>
        {loading ? '요약 중...' : '요약 시작'}
      </Button>
    </div>
  </div>
);
}