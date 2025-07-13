import { useState, useEffect } from "react";
import LoginPage from './components/pages/LoginPage';
import DefaultPage from './components/pages/DefaultPage';
import DocumentSummary from './components/pages/DocumentSummary';
import YoutubeSummary from './components/pages/YoutubeSummary';
import Recommendation from './components/pages/Recommendation';
import SensitivePage from './components/pages/SensitivePage';
import LoadingSpinner from './components/ui/LoadingSpinner';
import { PAGE_MODES } from './utils/constants';
import { WebSocketProvider } from "./utils/websocketProvider";
import "./App.css";
import Header from './components/ui/Header';

export default function App() {
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [pageMode, setPageMode] = useState(PAGE_MODES.DEFAULT);
    const getInitialTheme = () => {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) return savedTheme;
        // 브라우저/OS 다크모드 감지
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    };
    const [theme, setTheme] = useState(getInitialTheme);

    // theme 상태가 변경될 때마다 data-theme 속성 설정
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    }, [theme]);

    // theme 토글 함수
    const toggleTheme = () => {
        setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
    };

    // 로그인 상태 확인
    useEffect(() => {
        // 최초 마운트 시 토큰 확인
        chrome.storage.local.get(['token'], (result) => {
            setIsLoggedIn(!!result.token);
            setIsLoading(false)
        });
    
        // storage 변경 감지
        function handleStorageChange(changes, area) {
            if (area === "local" && changes.token) {
                setIsLoggedIn(!!changes.token.newValue);
            }
        }
        chrome.storage.onChanged.addListener(handleStorageChange);
    
        // cleanup
        return () => {
            chrome.storage.onChanged.removeListener(handleStorageChange);
        };
    }, []);


    // 페이지 모드 감지 함수
    const detectPageMode = async () => {
        try {
            // 로그인 상태 확인
            const result = await new Promise((resolve) => {
                chrome.storage.local.get(['token'], resolve);
            });

            if (!result.token) {
                // 로그인되지 않은 경우 기본 페이지로 설정
                setPageMode(PAGE_MODES.DEFAULT);
                return;
            }

            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const currentTab = tabs[0];
            if (!currentTab?.url) return;

            const url = currentTab.url;
            
            // 민감 정보 페이지 감지
            if (url.includes('login') || url.includes('signup') || url.includes('signin') || 
                url.includes('auth') || url.includes('password') || url.includes('account')) {
                setPageMode(PAGE_MODES.SENSITIVE);
                return;
            }

            // 크롬 내부 페이지 감지
            if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || 
                url.startsWith('about:') || url.startsWith('moz-extension://')) {
                setPageMode(PAGE_MODES.DEFAULT);
                return;
            }

            // 특정 사이트 감지 (구글, 네이버 등)
            if (url === 'https://www.google.com' || url === 'https://www.naver.com' ||
                url === 'https://www.youtube.com') {
                setPageMode(PAGE_MODES.DEFAULT);
                return;
            }

            // 문서 타입 감지 (PDF, DOC 등)
            if (url.includes('.pdf') || url.includes('.doc') || url.includes('.docx')) {
                setPageMode(PAGE_MODES.DOCUMENT);
                return;
            }

            // 유튜브 페이지 감지
            if (url.includes('youtube.com/watch') || url.includes('youtube.com/shorts')) {
                setPageMode(PAGE_MODES.YOUTUBE);
                chrome.runtime.sendMessage({ type: "YOUTUBE_DETECTED", url: url});
                return;
            }

            // 기본적으로 추천 모드
            setPageMode(PAGE_MODES.RECOMMENDATION);
        } catch (error) {
            console.error('페이지 모드 감지 실패:', error);
            setPageMode(PAGE_MODES.DEFAULT);
        }
    };

    useEffect(() => {
        // 초기 페이지 모드 감지
        detectPageMode();

        // 탭 업데이트 이벤트 리스너
        const handleTabUpdated = (tabId, changeInfo, tab) => {
            if (changeInfo.url) {
                // URL이 변경되면 페이지 모드 재감지
                setTimeout(detectPageMode, 100); // 약간의 지연을 두어 DOM 업데이트 완료 후 감지
            }
        };

        // 탭 활성화 이벤트 리스너
        const handleTabActivated = (activeInfo) => {
            // 탭이 변경되면 페이지 모드 재감지
            setTimeout(detectPageMode, 100);
        };

        // 이벤트 리스너 등록
        chrome.tabs.onUpdated.addListener(handleTabUpdated);
        chrome.tabs.onActivated.addListener(handleTabActivated);

        // 사이드패널 포커스 이벤트 리스너 (사이드패널이 열릴 때마다 감지)
        const handleSidePanelFocus = () => {
            detectPageMode();
        };

        // 사이드패널 포커스 이벤트 등록
        window.addEventListener('focus', handleSidePanelFocus);

        // 클린업 함수
        return () => {
            chrome.tabs.onUpdated.removeListener(handleTabUpdated);
            chrome.tabs.onActivated.removeListener(handleTabActivated);
            window.removeEventListener('focus', handleSidePanelFocus);
        };
    }, []);

    // 페이지 모드별 컴포넌트 렌더링
    const renderPage = () => {
        switch (pageMode) {
            case PAGE_MODES.DEFAULT:
                return <DefaultPage />;
            case PAGE_MODES.DOCUMENT:
                return <DocumentSummary />;
            case PAGE_MODES.YOUTUBE:
                return <YoutubeSummary />;
            case PAGE_MODES.RECOMMENDATION:
                return <Recommendation />;
            case PAGE_MODES.SENSITIVE:
                return <SensitivePage />;
            default:
                return <DefaultPage />;
        }
    };

    // 로딩
    if (isLoading) {
        return <LoadingSpinner />;
    }

    // 로그인 상태에 따라 분기
    if (!isLoggedIn) {
        return <LoginPage theme={theme} setTheme={setTheme}/>;
    }

    return (
        <>
            <WebSocketProvider>
                <Header theme={theme} toggleTheme={toggleTheme} />
                <div className="app">
                    {renderPage()}
                </div>
            </WebSocketProvider>
        </>
    );
}
