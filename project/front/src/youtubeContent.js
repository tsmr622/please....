// project/front/src/youtubeContent.js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "SEEK_TO") {
    const video = document.querySelector('video');
    if (video) {
      video.currentTime = msg.seconds;
      video.play();
    }
  }
}); 