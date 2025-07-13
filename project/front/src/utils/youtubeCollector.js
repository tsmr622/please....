export async function youtubeCollector(youtubeUrl) {
    console.log('YouTube URL 수집 시작:', youtubeUrl);
    
    try {
        // 로그인 상태 확인
        const result = await new Promise((resolve) => {
            chrome.storage.local.get(['token'], resolve);
        });
        
        const token = result.token;
        if (!token) {
            throw new Error('로그인이 필요합니다.');
        }

        // 백엔드로 YouTube URL 전송
        const response = await fetch("http://localhost:8000/collect/youtube", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ youtube_url: youtubeUrl }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const responseData = await response.json();
        console.log('YouTube 요약 요청 성공:', responseData);
        return responseData;
        
    } catch (error) {
        console.error('YouTube 수집 중 오류:', error);
        throw error;
    }
}