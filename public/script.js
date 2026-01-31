// Backend API URL
// Empty string to use relative path (works for both localhost and Vercel if served from same origin)
const API_URL = '/api/check';

// Utility to get query params
function getQueryParam(param) {
    const urlParams = new URLSearchParams(window.location.search);
    let value = urlParams.get(param);
    
    // Fallback: Check hash if not found in search
    if (!value && window.location.hash.includes('?')) {
        const hashParams = new URLSearchParams(window.location.hash.split('?')[1]);
        value = hashParams.get(param);
    }
    return value ? value.trim() : null;
}

// Function to check game condition via Backend API
async function checkGameCondition() {
    const code = getQueryParam('random_code');

    if (!code) {
        // Show Access Error Popup
        const popup = document.getElementById('popup-access-error');
        if (popup) popup.style.display = 'flex';
        return false;
    }

    try {
        const response = await fetch(`${API_URL}?code=${encodeURIComponent(code)}&t=${Date.now()}`);
        if (!response.ok) throw new Error("API check failed");

        const data = await response.json();
        if (data.valid) {
            if (data.status === 'INVITED') {
                return true; // Allowed to play
            } else if (data.status === 'PLAYER') {
                // Change Start Button to Review Prize Button - NO, User wants "Start" button to trigger notice first.
                // We keep button as is ( Start Icon ) so they can click it.
                // Only AFTER they click and see popup -> "Understood" -> Then show "Out of Turns" and maybe "Review"?

                // But we DO need to store the prize.
                // Store prize ID for startProgram to handle
                // currentUserPrize = data.prize_id || data.prize; // CHANGE: Don't set this yet.
                pendingPlayerPrize = data.prize_id || data.prize;

                // Return special status to handle later
                return 'PLAYER_NOTICE_PENDING';
            } else if (data.status === 'EXPIRED') {
                // Show Expired Popup
                const expiredPopup = document.getElementById('popup-expired');
                if (expiredPopup) {
                    expiredPopup.style.display = 'flex';
                }
                return false;
            } else if (data.status === 'OPENNING') { // Handle OPENNING status
                // Allow user to continue even if on a different browser/device
                return true;
            } else {
                alert(`Trạng thái không hợp lệ: ${data.status}`);
                return false;
            }
        } else {
            // Invalid code -> Show Invalid Code Message
            isInvalidCode = true;
            
            // Use result-popup to show specific error message
            const popup = document.getElementById('result-popup');
            const resultImage = document.getElementById('result-image');
            const noteElement = document.getElementById('result-note');
            
            if (popup && noteElement) {
                if (resultImage) resultImage.style.display = 'none'; // Hide gift image
                noteElement.innerHTML = "Mã tham dự không hợp lệ hoặc không tồn tại.<br>Vui lòng kiểm tra lại.";
                
                // Hide other buttons
                const btnFpoint = document.getElementById('btn-fpoint');
                const btnContact = document.getElementById('btn-contact');
                if (btnFpoint) btnFpoint.style.display = 'none';
                if (btnContact) btnContact.style.display = 'none';
                
                popup.style.display = 'flex';
            } else {
                // Fallback to generic error
                const popupError = document.getElementById('popup-access-error');
                if (popupError) popupError.style.display = 'flex';
            }
            return false;
        }
    } catch (error) {
        console.error("Lỗi kết nối đến server:", error);
        // alert("Có lỗi xảy ra khi kiểm tra điều kiện chơi. Vui lòng thử lại sau.");
        return false;
    }
}

// Map prize name to ID/Config
function getPrizeConfigByName(prizeName) {
    if (!prizeName) return null;
    const cleanName = prizeName.trim().toLowerCase();

    for (const [id, config] of Object.entries(prizes)) {
        if (config.name.trim().toLowerCase() === cleanName) {
            return config;
        }
    }
    return null;
}

// Helper to find prize by ID (preferred) or Name
function getPrizeConfig(key) {
    if (!key) return null;
    const cleanKey = String(key).trim().toLowerCase();

    for (const config of Object.values(prizes)) {
        if (!config.id) continue;
        const id = config.id.toLowerCase();

        // Match exact, underscore swapped, no dash, or just suffix number
        if (
            cleanKey === id ||
            cleanKey === id.replace('-', '_') ||
            cleanKey === id.replace('-', '') ||
            cleanKey === id.split('-')[1] // Matches "2" against "prize-2"
        ) {
            return config;
        }
    }

    // Legacy Name fallback
    for (const config of Object.values(prizes)) {
        if (config.name && config.name.trim().toLowerCase() === cleanKey) {
            return config;
        }
    }

    return null;
}

function showReviewPopup(prizeKey) {
    console.log("Review prize key:", prizeKey);
    console.log("Available prizes:", prizes);

    if (!prizeKey) {
        alert("Bạn chưa có phần quà nào được ghi nhận.");
        return;
    }

    // Use the robust helper
    const prizeConfig = getPrizeConfig(prizeKey);

    if (prizeConfig) {
        console.log("Prize Config Found:", prizeConfig);
        const popup = document.getElementById('result-popup');
        const resultImage = document.getElementById('result-image');
        const noteElement = document.getElementById('result-note');
        const btnFpoint = document.getElementById('btn-fpoint');
        const btnContact = document.getElementById('btn-contact');

        console.log("DOM Elements:", { popup, resultImage, noteElement, btnFpoint, btnContact });

        if (popup && resultImage) {
            console.log("Setting popup content...");
            resultImage.src = prizeConfig.src;
            if (noteElement) noteElement.innerText = prizeConfig.note;

            if (btnFpoint) btnFpoint.style.display = 'none';
            if (btnContact) btnContact.style.display = 'none';

            if (prizeConfig.type === 'fpoint' && btnFpoint) {
                btnFpoint.style.display = 'flex';
            } else if (prizeConfig.type === 'computer' && btnContact) {
                btnContact.style.display = 'flex';
            }
            popup.style.display = 'flex';
            console.log("Popup display set to flex");
        } else {
            console.error("Critical: Popup or Result Image element missing in DOM");
        }
    } else {
        // Fallback or Handle "Lì xì rỗng" or unknown prize
        const keyStr = String(prizeKey);
        if (keyStr.includes("rỗng")) {
            alert("Lì xì rỗng, chúc bạn may mắn lần sau!");
        } else {
            // Debug alert to help user report issue
            alert("Không tìm thấy thông tin quà cho ID: " + keyStr + ". Vui lòng chụp màn hình gửi admin.");
            console.warn("Unknown prize ID:", keyStr);
        }
    }
}

// Flag to prevent multiple interactions
let isProcessing = false;
let currentUserPrize = null; // Store prize if player has already played
let pendingPlayerPrize = null; // Store prize temporarily for PLAYER status flow
let isOutOfStock = false; // Flag for Out of Stock state
let isInvalidCode = false; // Flag for Invalid Code state

function showReviewPopup(prizeId) {
    const prizeData = getPrizeConfig(prizeId);
    if (!prizeData) return;

    const popup = document.getElementById('result-popup');
    const resultImage = document.getElementById('result-image');
    const noteElement = document.getElementById('result-note');
    const btnFpoint = document.getElementById('btn-fpoint');
    const btnContact = document.getElementById('btn-contact');

    // Reset buttons
    if (btnFpoint) btnFpoint.style.display = 'none';
    if (btnContact) btnContact.style.display = 'none';

    if (popup && resultImage) {
        resultImage.src = prizeData.src;
        resultImage.style.display = 'block';

        if (noteElement) noteElement.innerText = prizeData.note || '';

        // Show relevant button
        if (prizeData.type === 'fpoint' && btnFpoint) {
            btnFpoint.style.display = 'flex';
        } else if (prizeData.type === 'computer' && btnContact) {
            btnContact.style.display = 'flex';
        }

        popup.style.display = 'flex';
    }
}

async function startProgram() {
    if (isProcessing) return;

    // Check Out of Stock first
    if (isOutOfStock) {
        showOpeningPopup(); // Use existing "Hết lượt" popup
        return;
    }

    // Check if we are in "Review Mode"
    if (currentUserPrize) {
        showReviewPopup(currentUserPrize);
        return;
    }

    console.log("User clicked Start");
    const code = getQueryParam('random_code');

    if (!code) {
        // Show Access Error Popup
        const popup = document.getElementById('popup-access-error');
        if (popup) popup.style.display = 'flex';
        return;
    }

    // Check Invalid Code
    if (isInvalidCode) {
         const popup = document.getElementById('result-popup');
         if (popup) popup.style.display = 'flex';
         return;
    }

    // Then check out of stock
    if (isOutOfStock) {
        showOpeningPopup();
        return;
    }

    const btnStart = document.querySelector('.btn-primary');
    if (btnStart) {
        btnStart.style.opacity = '0.7';
        btnStart.style.pointerEvents = 'none'; // Disable clicks
    }

    isProcessing = true;
    let canPlay = null;

    try {
        // --- STRICT START BLOCKING ---
        // Check if we already own this session
        const sessionKey = 'started_' + code;
        const isOwner = localStorage.getItem(sessionKey);
        
        // Always try to start on server (Idempotent)
        // If !isOwner, we are starting fresh or new tab
        // If isOwner, we are just continuing
        
        // Attempt to mark as OPENNING
        // If code is invalid, this will likely fail or return error
        const result = await updateGameStatus(null, null, 'OPENNING');

        if (result === 'OUT_OF_STOCK') {
            isOutOfStock = true;
            showOpeningPopup();
            isProcessing = false;
            if (btnStart) {
                btnStart.style.opacity = '1';
                btnStart.style.pointerEvents = 'auto';
            }
            return;
        }

        if (!result || !result.success) {
            console.error("Failed to start game session", result);
            
            // Handle PLAYER conflict (Already played)
            if (result && result.currentStatus === 'PLAYER') {
                 // User already played.
                 // Update local state
                 currentUserPrize = result.prize_id || result.prize;
                 // Reset processing
                 isProcessing = false;
                 if (btnStart) {
                     btnStart.style.opacity = '1';
                     btnStart.style.pointerEvents = 'auto';
                     // Switch to Review Button style if needed?
                     const btnImg = btnStart.querySelector('img');
                     if (btnImg) {
                        btnImg.src = 'assets/btn-review.png';
                        btnImg.alt = 'Xem lại quà';
                     }
                 }
                 showReviewPopup(currentUserPrize);
                 return;
            }

            // If it failed, maybe code is invalid or network error
             if (btnStart) {
                btnStart.style.opacity = '1';
                btnStart.style.pointerEvents = 'auto';
            }
            isProcessing = false;
            
            // Show error if we can deduce it
            if (isInvalidCode) {
                 const popup = document.getElementById('result-popup');
                 if (popup) popup.style.display = 'flex';
            } else {
                 // Add detailed error if available
                 const errorMsg = (result && result.error) ? result.error : "Không thể bắt đầu game. Vui lòng thử lại sau.";
                 alert(errorMsg);
            }
            return;
        }

        // Success: Mark ownership
        localStorage.setItem(sessionKey, 'true');
        
        // Hide Home, Show Game
        document.getElementById('home-page').style.display = 'none';
        document.getElementById('game-page').style.display = 'block';

        // Trigger confetti
        confetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 }
        });

    } catch (e) {
        console.error("Start program error:", e);
        alert("Đã có lỗi xảy ra. Vui lòng tải lại trang.");
        if (btnStart) {
            btnStart.style.opacity = '1';
            btnStart.style.pointerEvents = 'auto';
        }
    } finally {
        isProcessing = false;
    }
}

function showGifts() {
    if (isProcessing) return;
    console.log("User clicked Gifts");
    const popup = document.getElementById('popup-gift');
    if (popup) {
        popup.style.display = 'flex';
    }
}

function showRules() {
    if (isProcessing) return;
    console.log("User clicked Rules");
    const popup = document.getElementById('popup-rules');
    if (popup) {
        popup.style.display = 'flex';
    }
}

// Popup Logic
window.addEventListener('DOMContentLoaded', () => {
    // strict check for random_code
    const code = getQueryParam('random_code');
    if (!code) {
        // Show Access Error Popup instead of blocking body
        const popup = document.getElementById('popup-access-error');
        if (popup) popup.style.display = 'flex';
        // We let the UI render behind it (Home page)
        return;
    }

    setTimeout(() => {
        // Remove automatic welcome-popup check.
        // The user says "Khi click vào button Bắt đầu ngay... mới hiển thị popup..."
        // So we should NOT show it automatically after 2s if the user wants this flow.
        // OR the user meant "If status is PLAYER, don't show notice... wait for click".
        // But for normal users (INVITED), do we show it?

        // Let's assume we keep the welcome popup for regular flow maybe?
        // But the user's request seems specific to the PLAYER flow interaction.
        // "Khi trạng thái là PLAYER thì sẽ không hiển thị popup-notice luôn" -> "popup-notice" here likely refers to the "Lưu ý" popup (id='welcome-popup' uses 'popup-notice.png').

        // So: If PLAYER, don't auto show. If INVITED, auto show?
        // Let's check condition first.

        checkGameCondition().then(status => {
            // If status is true (INVITED), show welcome popup?
            if (status === true) {
                const popup = document.getElementById('welcome-popup');
                if (popup) popup.style.display = 'flex';
            } else if (status === 'OPENNING') {
                showOpeningPopup();
            }
            // If status is 'PLAYER_NOTICE_PENDING', do NOT show popup yet.
        });

    }, 2000);
});

const prizes = {
    2: { id: 'prize-2', type: 'computer', name: 'Máy tính Casio FX580', src: 'assets/prize-2.png', note: 'CSKH Fahasa sẽ sớm liên hệ hướng dẫn bạn nhận giải' },
    3: { id: 'prize-3', type: 'fpoint', name: '5.000 F-point', src: 'assets/prize-3.png', note: '5K F-Point đã được thêm vào ví của bạn' },
    4: { id: 'prize-4', type: 'fpoint', name: '200.000 F-point', src: 'assets/prize-4.png', note: '200K F-Point đã được thêm vào ví của bạn' },
    // Use 'prize-5' ID to ensure unique lookup, even if user said 'prize-4' for 10k
    5: { id: 'prize-5', type: 'fpoint', name: '10.000 F-point', src: 'assets/prize-5.png', note: '10K F-Point đã được thêm vào ví của bạn' }
};


function showContactInfo() {
    const popup = document.getElementById('popup-contact');
    if (popup) {
        popup.style.display = 'flex';
    }
}

// API Update Function
// API Update Function
// Update Game Status (Modified for Server-Side Logic)
async function updateGameStatus(prizeName, prizeId, statusParam) {
    const code = getQueryParam('random_code');
    if (!code) return null;

    // Build Payload
    const payload = { code: code };
    if (statusParam) payload.status = statusParam;
    // We only send prizeName/prizeId if it's NOT a PLAYER claim request
    // Ensure we don't accidentally send old client prize logic
    if (statusParam !== 'PLAYER') {
        if (prizeName) payload.prize = prizeName;
        if (prizeId) payload.prize_id = prizeId;
    }

    try {
        const response = await fetch(`${API_URL.replace('/api/check', '/api/update')}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.status === 409) {
            console.warn("Cheat detected or status changed externally.");
            try {
                const data = await response.json();
                return { success: false, ...data };
            } catch (e) {
                return null;
            }
        }

        if (response.status === 422) {
            console.warn("All prizes are out of stock!");
            return 'OUT_OF_STOCK';
        }

        if (!response.ok) {
            throw new Error("Server error");
        }

        const data = await response.json();
        console.log("Updated status via server:", data);
        return data; // Return full data (including prize info if PLAYER)
    } catch (error) {
        console.error("Failed to update status:", error);
        return { success: false, error: error.message }; // Return object instead of null for better debugging
    }
}

// Game Logic
function selectEnvelope(id) {
    if (isProcessing) return;
    console.log("Selected Envelope ID: " + id);

    // Find the specific element that was clicked
    const envelopes = document.querySelectorAll('.envelope-item');
    const targetEnvelope = envelopes[id - 1];

    if (targetEnvelope) {
        isProcessing = true; // Block other interactions

        // Show result
        showResult(id);

        setTimeout(() => {
            isProcessing = false;
        }, 300);
    } else {
        showResult(id);
    }
}

async function showResult(envelopeId) {
    // Reset buttons and note
    const btnFpoint = document.getElementById('btn-fpoint');
    const btnContact = document.getElementById('btn-contact');
    const noteElement = document.getElementById('result-note');

    if (btnFpoint) btnFpoint.style.display = 'none';
    if (btnContact) btnContact.style.display = 'none';
    if (noteElement) noteElement.innerText = '';

    // CALL SERVER TO GET PRIZE (Lottery Happens Here)
    const result = await updateGameStatus(null, null, 'PLAYER');

    if (result === 'OUT_OF_STOCK') {
        isOutOfStock = true;

        // Show "Out of Stock" notification using result popup
        const popup = document.getElementById('result-popup');
        const resultImage = document.getElementById('result-image');
        const noteElement = document.getElementById('result-note');
        const btnFpoint = document.getElementById('btn-fpoint');
        const btnContact = document.getElementById('btn-contact');

        if (popup && resultImage) {
            // Hide Image for Text-Only notification
            resultImage.style.display = 'none';
            if (noteElement) noteElement.innerText = "Rất tiếc, các phần quà đã hết";

            // Hide buttons
            if (btnFpoint) btnFpoint.style.display = 'none';
            if (btnContact) btnContact.style.display = 'none';

            popup.style.display = 'flex';
        } else {
            alert("Rất tiếc, các phần quà đã hết");
        }

        // Wait 2 seconds then go Home
        setTimeout(() => {
            if (popup) popup.style.display = 'none'; // Close popup
            goHome();
        }, 2000);
        return;
    }

    if (result && result.success && result.prize_id) {
        // Check if this is an existing prize (Concurrent tab access)
        if (result.is_existing) {
            showOpeningPopup();
            return;
        }

        // Success! We have a prize from server.
        const prizeId = result.prize_id;
        const prizeData = getPrizeConfig(prizeId); // Reuse existing helper to find config

        // Store prize ID locally
        currentUserPrize = prizeId;

        if (prizeData) {
            const popup = document.getElementById('result-popup');
            const resultImage = document.getElementById('result-image');

            if (popup && resultImage) {
                resultImage.src = prizeData.src;
                resultImage.style.display = 'block'; // Ensure image is visible

                // Set note text
                if (noteElement && prizeData.note) {
                    noteElement.innerText = prizeData.note;
                }

                // Show relevant button
                if (prizeData.type === 'fpoint' && btnFpoint) {
                    btnFpoint.style.display = 'flex';
                } else if (prizeData.type === 'computer' && btnContact) {
                    btnContact.style.display = 'flex';
                }

                popup.style.display = 'flex';

                // Trigger Fireworks ONLY IF NOT EXISTING
                if (!result.is_existing) {
                    triggerFireworks();
                }
            }
        } else {
            // Can't find config for this prize ID?
            alert("Chúc mừng bạn trúng: " + (result.prize || "Quà bí ẩn") + ". (Lỗi hiển thị: Không tìm thấy hình ảnh)");
        }
    } else {
        // Failed (Cheat, Error, or Out of Stock)
        // If it was strict blocking, showOpeningPopup or just alert
        showOpeningPopup();
    }
}

function triggerFireworks() {
    var duration = 3 * 1000;
    var animationEnd = Date.now() + duration;
    var defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999 };

    function randomInRange(min, max) {
        return Math.random() * (max - min) + min;
    }

    var interval = setInterval(function () {
        var timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
            return clearInterval(interval);
        }

        var particleCount = 50 * (timeLeft / duration);
        // since particles fall down, start a bit higher than random
        confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } }));
        confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } }));
    }, 250);
}

function closeResultPopup() {
    const popup = document.getElementById('result-popup');
    if (popup) {
        popup.style.display = 'none';
    }
}

function goHome() {
    closeResultPopup();
    const homePage = document.getElementById('home-page');
    const gamePage = document.getElementById('game-page');

    if (homePage && gamePage) {
        gamePage.style.display = 'none';
        homePage.style.display = 'block';
    }

    // If we have a prize, update the home screen button to "Review Mode"
    if (currentUserPrize) {
        const btnStart = document.querySelector('.btn-primary');
        if (btnStart) {
            const btnImg = btnStart.querySelector('img');
            if (btnImg) {
                btnImg.src = 'assets/btn-review.png';
                btnImg.alt = 'Xem lại quà';
            }
            // Logic is already handled by startProgram checking currentUserPrize
            // Just need to ensure visuals are updated
            btnStart.style.opacity = '1';
            btnStart.style.pointerEvents = 'auto';
        }
    }
}
function closePopup() {
    const popups = document.querySelectorAll('.popup-overlay');
    popups.forEach(popup => {
        // Don't close result-popup if we are just closing a child popup? 
        // Actually, let's just make a specific function for the new need.
        // Existing behavior for others is fine.
        popup.style.display = 'none';
    });
}

function closeSpecificPopup(id) {
    const popup = document.getElementById(id);
    if (popup) {
        popup.style.display = 'none';
    }
}

function showOpeningPopup() {
    const popup = document.getElementById('popup-opening');
    if (popup) {
        popup.style.display = 'flex';
    }
}
