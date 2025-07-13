import { useState, useEffect } from 'react';
import Card from '../ui/Card';
import LoadingSpinner from '../ui/LoadingSpinner';
import { useWebSocket } from '../../utils/websocketProvider';
import './YoutubeSummary.css';
import '../ui/CustomScrollbar.css';

export default function YoutubeSummary() {
  const [isLoading, setIsLoading] = useState(false);
  const [summary, setSummary] = useState('');
  const [error, setError] = useState('');
  const { messages } = useWebSocket();

  useEffect(() => {
    // WebSocket 메시지 처리
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.content) {
        setSummary(prev => prev + lastMessage.content);
      }
      if (lastMessage.is_final) {
        setIsLoading(false);
      }
    }
  }, [messages]);

  const handleSummarize = async () => {
    try {
      setIsLoading(true);
      setSummary('');
      setError('');

      // 현재 탭의 YouTube URL 가져오기
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const currentTab = tabs[0];
      
      if (!currentTab?.url) {
        setError('현재 탭의 URL을 가져올 수 없습니다.');
        return;
      }

      const youtubeUrl = currentTab.url;
      
      // YouTube URL인지 확인
      if (!youtubeUrl.includes('youtube.com/watch') && !youtubeUrl.includes('youtube.com/shorts')) {
        setError('YouTube 페이지가 아닙니다.');
        return;
      }

      // 백엔드로 요청 전송
      const token = await new Promise((resolve) => {
        chrome.storage.local.get(['token'], (result) => resolve(result.token));
      });

      if (!token) {
        setError('로그인이 필요합니다.');
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

      // WebSocket을 통해 실시간 응답을 받을 예정
      console.log('YouTube 요약 요청 전송 완료');

    } catch (error) {
      console.error('YouTube 요약 중 오류:', error);
      setError(error.message);
      setIsLoading(false);
    }
  };

  return (
    <div className="youtube-summary-page custom-scrollbar">
      <Card>
        <h2>YouTube 요약</h2>
        <p>현재 YouTube 동영상의 내용을 요약해드립니다.</p>
        
        <button 
          onClick={handleSummarize}
          disabled={isLoading}
          className="summarize-button"
        >
          {isLoading ? '요약 중...' : '요약 시작'}
        </button>

        {isLoading && (
          <div className="loading-container">
            <LoadingSpinner />
            <p>YouTube 동영상을 분석하고 요약을 생성하고 있습니다...</p>
          </div>
        )}

        {error && (
          <div className="error-message">
            <p>오류: {error}</p>
          </div>
        )}

        {summary && (
          <div className="summary-container">
            <h3>요약 결과</h3>
            <div className="summary-content">
              {summary.split('\n').map((line, index) => (
                <p key={index}>{line}</p>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
} 