import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, onSnapshot, orderBy, doc, setDoc, getDoc, getDocs, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyD27Zv06c7GXi5iwcXFxEkhwH1SuXoElas",
    authDomain: "kotogram-1b6c8.firebaseapp.com",
    databaseURL: "https://kotogram-1b6c8-default-rtdb.firebaseio.com",
    projectId: "kotogram-1b6c8",
    storageBucket: "kotogram-1b6c8.firebasestorage.app",
    messagingSenderId: "815772269065",
    appId: "1:815772269065:web:a130f535f10445c48596d8"
};
const IMGBB_API_KEY = "706ffb03d5653cdf91990abac2ce7a29";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
auth.useDeviceLanguage();

let currentUser = null;
let currentChatId = null;
let chatsUnsubscribe = null;
let messagesUnsubscribe = null;
let typingTimeout = null;

// --- WEBRTC (ЗВОНКИ) ---
let pc = null;
let localStream = null;
let remoteStream = null;
let callDocId = null;
const servers = { iceServers: [{ urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }] };

// ==========================================
// 1. АВТОРИЗАЦИЯ И МЕНЮ
// ==========================================

window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', { 'size': 'normal' });

window.sendSms = async () => {
    const phone = document.getElementById('phone-number').value;
    const btn = document.getElementById('btn-login');
    btn.disabled = true; btn.innerText = "Отправка...";
    try {
        window.confirmationResult = await signInWithPhoneNumber(auth, phone, window.recaptchaVerifier);
        document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
        document.getElementById('screen-code').classList.add('active');
    } catch (e) {
        alert("Ошибка: " + e.message);
        btn.disabled = false; btn.innerText = "Войти";
    }
};

window.verifyCode = async () => {
    try {
        const res = await window.confirmationResult.confirm(document.getElementById('verification-code').value);
        checkUser(res.user);
    } catch (e) { alert("Неверный код"); }
};

async function checkUser(user) {
    const s = await getDoc(doc(db, "users", user.uid));
    if(s.exists()) startApp(user, s.data());
    else {
        document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
        document.getElementById('screen-nickname').classList.add('active');
    }
}

window.saveProfile = async () => {
    const name = document.getElementById('username-input').value;
    const u = auth.currentUser;
    await setDoc(doc(db, "users", u.uid), { uid: u.uid, phoneNumber: u.phoneNumber, username: name, photoURL: "" });
    startApp(u, { username: name });
};

onAuthStateChanged(auth, u => {
    if(u) checkUser(u);
    else {
        document.getElementById('loader').style.display = 'none';
        document.getElementById('app-container').style.display = 'none';
        document.getElementById('auth-screens').style.display = 'flex';
        document.getElementById('screen-phone').classList.add('active');
        const btn = document.getElementById('btn-login');
        if(btn) { btn.disabled = false; btn.innerText="Войти"; }
    }
});

// ==========================================
// 2. ЗАПУСК ПРИЛОЖЕНИЯ
// ==========================================

function startApp(user, data) {
    currentUser = user;
    document.getElementById('auth-screens').style.display = 'none';
    document.getElementById('loader').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';

    // Обновляем меню
    if(data) updateDrawerInfo(data);
    else getDoc(doc(db, "users", user.uid)).then(s=>updateDrawerInfo(s.data()));

    loadChats();
    trackStatus();
}

function updateDrawerInfo(data) {
    document.getElementById('drawer-name').innerText = data.username || "Я";
    document.getElementById('drawer-phone').innerText = currentUser.phoneNumber;
    const avatarEl = document.getElementById('drawer-avatar');
    if(data.photoURL) {
        avatarEl.style.backgroundImage = `url(${data.photoURL})`;
        avatarEl.innerText = "";
    }
}

// ==========================================
// 3. ЧАТЫ (ИСПРАВЛЕНО: ТЕПЕРЬ РЕАЛЬНЫЕ ИМЕНА)
// ==========================================

function loadChats() {
    if(chatsUnsubscribe) chatsUnsubscribe();
    
    // Запрос: где я участник
    const q = query(collection(db, "chats"), where("participants", "array-contains", currentUser.uid));
    
    chatsUnsubscribe = onSnapshot(q, (snapshot) => {
        const list = document.getElementById('chats-list');
        
        snapshot.docChanges().forEach(async (change) => {
            if (change.type === "added" || change.type === "modified") {
                const data = change.doc.data();
                const chatId = change.doc.id;
                
                // 1. Ищем ID друга
                const friendId = data.participants.find(id => id !== currentUser.uid);
                
                // 2. Получаем данные друга из базы
                let friendName = "Загрузка...";
                let friendPhoto = "";
                
                if (friendId) {
                    const friendSnap = await getDoc(doc(db, "users", friendId));
                    if (friendSnap.exists()) {
                        friendName = friendSnap.data().username;
                        friendPhoto = friendSnap.data().photoURL;
                    }
                }

                // 3. Рисуем элемент
                let div = document.getElementById(`chat-${chatId}`);
                const isActive = currentChatId === chatId ? 'active' : '';
                
                const avatarStyle = friendPhoto ? `background-image: url(${friendPhoto})` : '';
                const avatarText = friendPhoto ? '' : friendName[0];

                const html = `
                    <div class="avatar-small" style="${avatarStyle}">${avatarText}</div>
                    <div class="chat-info">
                        <div class="chat-name">${friendName}</div>
                        <div class="last-msg">${data.lastMessage || "Нет сообщений"}</div>
                    </div>
                `;

                if (div) {
                    div.className = `chat-item ${isActive}`;
                    div.innerHTML = html;
                } else {
                    div = document.createElement('div');
                    div.id = `chat-${chatId}`;
                    div.className = `chat-item ${isActive}`;
                    div.onclick = () => openChat(chatId, friendName, friendId, friendPhoto);
                    div.innerHTML = html;
                    list.appendChild(div);
                }
                
                // Подключаем прослушку звонков для этого чата
                listenForIncomingCalls(chatId);
            }
        });
    });
}

// Открытие чата
window.openChat = (chatId, name, friendId, photo) => {
    currentChatId = chatId;
    document.body.classList.add('chat-open'); // Мобильный вид
    
    // Подсветка
    document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
    const item = document.getElementById(`chat-${chatId}`);
    if (item) item.classList.add('active');

    // Хедер
    document.getElementById('chat-header-name').innerText = name;
    const hAvatar = document.getElementById('header-avatar');
    if (photo) {
        hAvatar.style.backgroundImage = `url(${photo})`;
        hAvatar.innerText = "";
    } else {
        hAvatar.style.backgroundImage = "";
        hAvatar.innerText = name[0];
    }

    // Статусы (онлайн/печатает)
    trackFriendStatus(chatId, friendId);

    // Сообщения
    if (messagesUnsubscribe) messagesUnsubscribe();
    const q = query(collection(db, "chats", chatId, "messages"), orderBy("timestamp", "asc"));
    
    messagesUnsubscribe = onSnapshot(q, (snapshot) => {
        const area = document.getElementById('messages-area');
        if (snapshot.empty) area.innerHTML = '<div class="empty-placeholder">Нет сообщений</div>';
        else {
            const ph = area.querySelector('.empty-placeholder');
            if(ph) ph.remove();
        }

        snapshot.docChanges().forEach(change => {
            if (change.type === "added") {
                const msg = change.doc.data();
                const div = document.createElement('div');
                div.className = `message ${msg.senderId === currentUser.uid ? 'my' : 'other'}`;
                
                const t = msg.timestamp ? new Date(msg.timestamp.toDate()).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '...';
                let content = msg.text;
                if(msg.type === 'image') content = `<img src="${msg.imageUrl}" class="msg-img" onclick="window.open('${msg.imageUrl}')">`;
                
                div.innerHTML = `${content}<div class="msg-time">${t}</div>`;
                area.appendChild(div);
            }
        });
        area.scrollTop = area.scrollHeight;
    });
};

// ==========================================
// 4. ФУНКЦИИ (Сообщения, Картинки, UI)
// ==========================================

window.sendMessage = async () => {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text || !currentChatId) return;
    input.value = "";
    await addDoc(collection(db, "chats", currentChatId, "messages"), { text: text, senderId: currentUser.uid, timestamp: serverTimestamp() });
    await updateDoc(doc(db, "chats", currentChatId), { lastMessage: text, lastMessageTime: serverTimestamp() });
};

window.handleEnter = (e) => { if (e.key === 'Enter') window.sendMessage(); };
window.closeChat = () => { document.body.classList.remove('chat-open'); currentChatId = null; };

// Картинки
async function uploadToImgBB(file) {
    const fd = new FormData(); fd.append("image", file);
    const r = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {method:"POST", body:fd});
    const j = await r.json();
    return j.data.url;
}
window.sendImage = async (inp) => {
    if(!currentChatId || !inp.files[0]) return;
    const url = await uploadToImgBB(inp.files[0]);
    await addDoc(collection(db, "chats", currentChatId, "messages"), { imageUrl: url, type: 'image', senderId: currentUser.uid, timestamp: serverTimestamp() });
    await updateDoc(doc(db, "chats", currentChatId), { lastMessage: "📷 Фото", lastMessageTime: serverTimestamp() });
};
window.uploadAvatar = async (inp) => {
    if(!inp.files[0]) return;
    const url = await uploadToImgBB(inp.files[0]);
    await updateDoc(doc(db, "users", currentUser.uid), { photoURL: url });
    updateDrawerInfo({ username: document.getElementById('drawer-name').innerText, photoURL: url });
};

// Тайпинг и Статусы
window.handleTyping = () => {
    if (!currentChatId) return;
    const ref = doc(db, "chats", currentChatId);
    updateDoc(ref, { [`typing.${currentUser.uid}`]: true });
    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => { updateDoc(ref, { [`typing.${currentUser.uid}`]: false }); }, 2000);
};

function trackStatus() {
    if (currentUser) updateDoc(doc(db, "users", currentUser.uid), { lastSeen: serverTimestamp() });
    setInterval(() => { if (currentUser) updateDoc(doc(db, "users", currentUser.uid), { lastSeen: serverTimestamp() }); }, 60000);
}

function trackFriendStatus(chatId, friendId) {
    onSnapshot(doc(db, "chats", chatId), (snap) => {
        const data = snap.data();
        const el = document.getElementById('chat-header-status');
        if (data?.typing && data.typing[friendId]) { el.innerText = "печатает..."; return; }
        getDoc(doc(db, "users", friendId)).then(uSnap => {
            const u = uSnap.data();
            if (u?.lastSeen) {
                const diff = (Date.now() - u.lastSeen.toDate()) / 60000;
                el.innerText = diff < 5 ? "в сети" : "был(а) недавно";
            }
        });
    });
}

// UI Меню
window.toggleMenu = () => { document.getElementById('main-drawer').classList.toggle('open'); document.querySelector('.drawer-overlay').classList.toggle('active'); };
window.openSettings = () => { window.toggleMenu(); document.getElementById('settings-modal').classList.add('active'); };
window.closeSettings = () => { document.getElementById('settings-modal').classList.remove('active'); };
window.changeFontSize = (val) => { document.documentElement.style.setProperty('--font-size', val + 'px'); localStorage.setItem('kotogram-font', val); document.getElementById('font-val').innerText = val; };

window.addContactPrompt = async () => {
    const p = prompt("Введите телефон (+7...):");
    if(!p) return;
    const s = await getDocs(query(collection(db, "users"), where("phoneNumber", "==", p)));
    if(s.empty) return alert("Пользователь не найден");
    const f = s.docs[0].data();
    const ids = [currentUser.uid, f.uid].sort();
    await setDoc(doc(db, "chats", ids.join("_")), { participants: ids, lastMessage: "", createdAt: serverTimestamp() }, { merge: true });
};

// ==========================================
// 5. ЗВОНКИ (WebRTC)
// ==========================================

window.startCall = async () => {
    if (!currentChatId) return;
    document.getElementById('call-modal').classList.add('active');
    document.getElementById('btn-answer').style.display = 'none';
    document.getElementById('call-status').innerText = "Звоним...";

    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById('localVideo').srcObject = localStream;
    remoteStream = new MediaStream();
    document.getElementById('remoteVideo').srcObject = remoteStream;

    pc = new RTCPeerConnection(servers);
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    pc.ontrack = event => event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));

    const callDocRef = doc(collection(db, "chats", currentChatId, "calls"));
    callDocId = callDocRef.id;
    const offerCandidates = collection(callDocRef, 'offerCandidates');
    const answerCandidates = collection(callDocRef, 'answerCandidates');

    pc.onicecandidate = event => { if(event.candidate) addDoc(offerCandidates, event.candidate.toJSON()); };

    const offerDescription = await pc.createOffer();
    await pc.setLocalDescription(offerDescription);
    await setDoc(callDocRef, { offer: { sdp: offerDescription.sdp, type: offerDescription.type, callerId: currentUser.uid } });

    onSnapshot(callDocRef, (snapshot) => {
        const data = snapshot.data();
        if (!pc.currentRemoteDescription && data?.answer) {
            pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            document.getElementById('call-status').innerText = "Соединение...";
        }
    });

    onSnapshot(answerCandidates, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
        });
    });
};

function listenForIncomingCalls(chatId) {
    onSnapshot(query(collection(db, "chats", chatId, "calls")), (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
                const data = change.doc.data();
                if (data.offer && data.offer.callerId !== currentUser.uid && !data.answer) {
                    showIncomingCall(change.doc.id, chatId);
                }
            }
        });
    });
}

function showIncomingCall(callId, chatId) {
    callDocId = callId;
    currentChatId = chatId;
    document.getElementById('call-modal').classList.add('active');
    document.getElementById('btn-answer').style.display = 'flex';
    document.getElementById('call-status').innerText = "Входящий звонок...";
}

window.answerCall = async () => {
    document.getElementById('btn-answer').style.display = 'none';
    document.getElementById('call-status').innerText = "Соединение...";
    
    const callDocRef = doc(db, "chats", currentChatId, "calls", callDocId);
    const answerCandidates = collection(callDocRef, 'answerCandidates');
    const offerCandidates = collection(callDocRef, 'offerCandidates');

    pc = new RTCPeerConnection(servers);
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById('localVideo').srcObject = localStream;
    remoteStream = new MediaStream();
    document.getElementById('remoteVideo').srcObject = remoteStream;

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    pc.ontrack = event => event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));

    pc.onicecandidate = event => { if(event.candidate) addDoc(answerCandidates, event.candidate.toJSON()); };

    const callData = (await getDoc(callDocRef)).data();
    await pc.setRemoteDescription(new RTCSessionDescription(callData.offer));
    const answerDescription = await pc.createAnswer();
    await pc.setLocalDescription(answerDescription);

    await updateDoc(callDocRef, { answer: { type: answerDescription.type, sdp: answerDescription.sdp } });

    onSnapshot(offerCandidates, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
        });
    });
};

window.hangUp = async () => {
    if(localStream) localStream.getTracks().forEach(t => t.stop());
    if(pc) pc.close();
    pc = null; localStream = null; remoteStream = null;
    document.getElementById('call-modal').classList.remove('active');
};
