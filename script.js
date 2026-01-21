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

// Переменные для звонков
let pc = null;
let localStream = null;
let remoteStream = null;
let callDocId = null;
const servers = { iceServers: [{ urls: ['stun:stun1.l.google.com:19302'] }] };

// --- Глобальные функции для HTML ---
window.toggleMenu = () => { document.getElementById('main-drawer').classList.toggle('open'); document.querySelector('.drawer-overlay').classList.toggle('active'); };
window.openSettings = () => { window.toggleMenu(); document.getElementById('settings-modal').classList.add('active'); };
window.closeSettings = () => { document.getElementById('settings-modal').classList.remove('active'); };
window.changeFontSize = (val) => { document.documentElement.style.setProperty('--font-size', val+'px'); document.getElementById('font-val').innerText=val; };

// --- АВТОРИЗАЦИЯ ---
window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', { 'size': 'normal' });

window.sendSms = async () => {
    const p = document.getElementById('phone-number').value;
    const b = document.getElementById('btn-login');
    b.disabled = true; b.innerText = "Ждите...";
    try {
        window.confirmationResult = await signInWithPhoneNumber(auth, p, window.recaptchaVerifier);
        document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
        document.getElementById('screen-code').classList.add('active');
    } catch(e) { alert("Ошибка: "+e.message); b.disabled=false; b.innerText="Войти"; }
};

window.verifyCode = async () => {
    try {
        const r = await window.confirmationResult.confirm(document.getElementById('verification-code').value);
        checkUser(r.user);
    } catch(e) { alert("Неверный код"); }
};

async function checkUser(user) {
    const s = await getDoc(doc(db,"users",user.uid));
    if(s.exists()) startApp(user, s.data());
    else {
        document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
        document.getElementById('screen-nickname').classList.add('active');
    }
}

window.saveProfile = async () => {
    const n = document.getElementById('username-input').value;
    const u = auth.currentUser;
    await setDoc(doc(db,"users",u.uid), {uid:u.uid, phoneNumber:u.phoneNumber, username:n, photoURL:""});
    startApp(u, {username:n});
};

onAuthStateChanged(auth, u => {
    if(u) checkUser(u);
    else {
        document.getElementById('loader').style.display='none';
        document.getElementById('app-container').style.display='none';
        document.getElementById('auth-screens').style.display='flex';
        document.getElementById('screen-phone').classList.add('active');
        const b = document.getElementById('btn-login'); if(b){b.disabled=false; b.innerText="Войти";}
    }
});

function startApp(user, data) {
    currentUser = user;
    document.getElementById('auth-screens').style.display='none';
    document.getElementById('loader').style.display='none';
    document.getElementById('app-container').style.display='flex';
    if(data) updateDrawer(data);
    else getDoc(doc(db,"users",user.uid)).then(s=>updateDrawer(s.data()));
    loadChats();
    trackMyStatus();
}

function updateDrawer(data) {
    document.getElementById('drawer-name').innerText = data.username || "Я";
    document.getElementById('drawer-phone').innerText = currentUser.phoneNumber;
    const el = document.getElementById('drawer-avatar');
    if(data.photoURL && data.photoURL !== "undefined") {
        el.style.backgroundImage = `url(${data.photoURL})`;
        el.innerText = "";
    } else {
        el.style.backgroundImage = "";
        el.innerText = "📷";
    }
}

// --- ЧАТЫ ---
function loadChats() {
    if(chatsUnsubscribe) chatsUnsubscribe();
    // Очищаем список перед загрузкой, чтобы не было дублей при перезапуске
    document.getElementById('chats-list').innerHTML = ""; 

    const q = query(collection(db,"chats"), where("participants","array-contains",currentUser.uid));
    
    chatsUnsubscribe = onSnapshot(q, (snapshot) => {
        const list = document.getElementById('chats-list');
        snapshot.docChanges().forEach(async (change) => {
            if (change.type === "added" || change.type === "modified") {
                const data = change.doc.data();
                const cid = change.doc.id;
                
                // Ищем друга
                const fid = data.participants.find(id => id !== currentUser.uid);
                let fName = "Без имени";
                let fPhoto = "";

                if (fid) {
                    const fSnap = await getDoc(doc(db,"users",fid));
                    if (fSnap.exists()) {
                        fName = fSnap.data().username || "Без имени";
                        fPhoto = fSnap.data().photoURL;
                    }
                }

                // Проверка на "undefined"
                if (fPhoto === "undefined") fPhoto = "";

                // Рисуем
                let div = document.getElementById(`chat-${cid}`);
                const isActive = currentChatId === cid ? 'active' : '';
                const style = fPhoto ? `background-image:url(${fPhoto})` : '';
                const txt = fPhoto ? '' : fName[0];

                const html = `
                    <div class="avatar-small" style="${style}">${txt}</div>
                    <div class="chat-info">
                        <div class="chat-name">${fName}</div>
                        <div class="last-msg">${data.lastMessage || "..."}</div>
                    </div>`;

                if(div) {
                    div.className = `chat-item ${isActive}`;
                    div.innerHTML = html;
                } else {
                    div = document.createElement('div');
                    div.id = `chat-${cid}`;
                    div.className = `chat-item ${isActive}`;
                    div.onclick = () => openChat(cid, fName, fid, fPhoto);
                    div.innerHTML = html;
                    list.appendChild(div);
                }
                listenCalls(cid);
            }
        });
    });
}

// --- ОТКРЫТИЕ ЧАТА ---
window.openChat = (cid, name, fid, photo) => {
    currentChatId = cid;
    document.body.classList.add('chat-open');
    document.querySelectorAll('.chat-item').forEach(e=>e.classList.remove('active'));
    const item = document.getElementById(`chat-${cid}`);
    if(item) item.classList.add('active');

    document.getElementById('chat-header-name').innerText = name;
    const ha = document.getElementById('header-avatar');
    if(photo && photo !== "undefined") {
        ha.style.backgroundImage = `url(${photo})`;
        ha.innerText = "";
    } else {
        ha.style.backgroundImage = "";
        ha.innerText = name[0];
    }

    trackFriend(cid, fid);

    if(messagesUnsubscribe) messagesUnsubscribe();
    const q = query(collection(db,"chats",cid,"messages"), orderBy("timestamp","asc"));
    messagesUnsubscribe = onSnapshot(q, (snap) => {
        const area = document.getElementById('messages-area');
        if(snap.empty) area.innerHTML = '<div class="empty-placeholder">Нет сообщений</div>';
        else {
            const pl = area.querySelector('.empty-placeholder');
            if(pl) pl.remove();
        }
        
        snap.docChanges().forEach(ch => {
            if(ch.type==="added") {
                const m = ch.doc.data();
                const div = document.createElement('div');
                div.className = `message ${m.senderId===currentUser.uid?'my':'other'}`;
                const t = m.timestamp ? new Date(m.timestamp.toDate()).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '';
                let content = m.text;
                if(m.type==='image') content = `<img src="${m.imageUrl}" class="msg-img" onclick="window.open('${m.imageUrl}')">`;
                div.innerHTML = `${content}<div class="msg-time">${t}</div>`;
                area.appendChild(div);
            }
        });
        area.scrollTop = area.scrollHeight;
    });
};

// --- СООБЩЕНИЯ И ФОТО ---
window.sendMessage = async () => {
    const inp = document.getElementById('msg-input');
    const txt = inp.value.trim();
    if(!txt || !currentChatId) return;
    inp.value = "";
    await addDoc(collection(db,"chats",currentChatId,"messages"), {text:txt, senderId:currentUser.uid, timestamp:serverTimestamp()});
    await updateDoc(doc(db,"chats",currentChatId), {lastMessage:txt, lastMessageTime:serverTimestamp()});
};
window.handleEnter = (e) => { if(e.key==='Enter') window.sendMessage(); };
window.closeChat = () => { document.body.classList.remove('chat-open'); currentChatId=null; };

async function uploadToImgBB(file) {
    const fd = new FormData(); fd.append("image", file);
    const r = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {method:"POST", body:fd});
    const j = await r.json(); return j.data.url;
}

window.sendImage = async (inp) => {
    if(!currentChatId || !inp.files[0]) return;
    const url = await uploadToImgBB(inp.files[0]);
    await addDoc(collection(db,"chats",currentChatId,"messages"), {imageUrl:url, type:'image', senderId:currentUser.uid, timestamp:serverTimestamp()});
    await updateDoc(doc(db,"chats",currentChatId), {lastMessage:"📷 Фото", lastMessageTime:serverTimestamp()});
};

window.uploadAvatar = async (inp) => {
    if(!inp.files[0]) return;
    const url = await uploadToImgBB(inp.files[0]);
    await updateDoc(doc(db,"users",currentUser.uid), {photoURL:url});
    updateDrawer({username:document.getElementById('drawer-name').innerText, photoURL:url});
};

// --- СТАТУСЫ ---
window.handleTyping = () => {
    if(!currentChatId) return;
    const r = doc(db,"chats",currentChatId);
    updateDoc(r, {[`typing.${currentUser.uid}`]:true});
    if(typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => updateDoc(r, {[`typing.${currentUser.uid}`]:false}), 2000);
};
function trackMyStatus() {
    const up = () => currentUser && updateDoc(doc(db,"users",currentUser.uid),{lastSeen:serverTimestamp()});
    up(); setInterval(up, 60000);
}
function trackFriend(cid, fid) {
    onSnapshot(doc(db,"chats",cid), s => {
        const d = s.data();
        const el = document.getElementById('chat-header-status');
        if(d?.typing && d.typing[fid]) el.innerText="печатает...";
        else getDoc(doc(db,"users",fid)).then(us=>{
            const u = us.data();
            if(u?.lastSeen) {
                const diff = (Date.now()-u.lastSeen.toDate())/60000;
                el.innerText = diff<5 ? "в сети" : "был(а) недавно";
            }
        });
    });
}
window.addContactPrompt = async () => {
    const p = prompt("Телефон (+7...):"); if(!p) return;
    const s = await getDocs(query(collection(db,"users"), where("phoneNumber","==",p)));
    if(s.empty) return alert("Не найден");
    const f = s.docs[0].data();
    const ids = [currentUser.uid, f.uid].sort();
    await setDoc(doc(db,"chats",ids.join("_")), {participants:ids, lastMessage:"", createdAt:serverTimestamp()}, {merge:true});
};

// --- ЗВОНКИ ---
window.startCall = async () => {
    if(!currentChatId) return;
    document.getElementById('call-modal').classList.add('active');
    document.getElementById('btn-answer').style.display='none';
    document.getElementById('call-status').innerText="Звоним...";
    
    localStream = await navigator.mediaDevices.getUserMedia({video:true, audio:true});
    document.getElementById('localVideo').srcObject = localStream;
    remoteStream = new MediaStream();
    document.getElementById('remoteVideo').srcObject = remoteStream;

    pc = new RTCPeerConnection(servers);
    localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
    pc.ontrack = e => e.streams[0].getTracks().forEach(t=>remoteStream.addTrack(t));

    const callRef = doc(collection(db,"chats",currentChatId,"calls"));
    callDocId = callRef.id;
    const offerCands = collection(callRef,'offerCandidates');
    const ansCands = collection(callRef,'answerCandidates');

    pc.onicecandidate = e => e.candidate && addDoc(offerCands, e.candidate.toJSON());
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await setDoc(callRef, {offer:{sdp:offer.sdp, type:offer.type, callerId:currentUser.uid}});

    onSnapshot(callRef, s => {
        const d = s.data();
        if(!pc.currentRemoteDescription && d?.answer) {
            pc.setRemoteDescription(new RTCSessionDescription(d.answer));
            document.getElementById('call-status').innerText="В разговоре";
        }
    });
    onSnapshot(ansCands, s => s.docChanges().forEach(c=>{ if(c.type==='added') pc.addIceCandidate(new RTCIceCandidate(c.doc.data())); }));
};

function listenCalls(cid) {
    onSnapshot(query(collection(db,"chats",cid,"calls")), s => {
        s.docChanges().forEach(c => {
            if(c.type==='added') {
                const d = c.doc.data();
                if(d.offer && d.offer.callerId!==currentUser.uid && !d.answer) {
                    callDocId = c.doc.id;
                    currentChatId = cid;
                    document.getElementById('call-modal').classList.add('active');
                    document.getElementById('btn-answer').style.display='flex';
                    document.getElementById('call-status').innerText="Входящий...";
                }
            }
        });
    });
}

window.answerCall = async () => {
    document.getElementById('btn-answer').style.display='none';
    document.getElementById('call-status').innerText="Соединение...";
    
    const callRef = doc(db,"chats",currentChatId,"calls",callDocId);
    const offerCands = collection(callRef,'offerCandidates');
    const ansCands = collection(callRef,'answerCandidates');

    pc = new RTCPeerConnection(servers);
    localStream = await navigator.mediaDevices.getUserMedia({video:true, audio:true});
    document.getElementById('localVideo').srcObject = localStream;
    remoteStream = new MediaStream();
    document.getElementById('remoteVideo').srcObject = remoteStream;

    localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
    pc.ontrack = e => e.streams[0].getTracks().forEach(t=>remoteStream.addTrack(t));
    pc.onicecandidate = e => e.candidate && addDoc(ansCands, e.candidate.toJSON());

    const d = (await getDoc(callRef)).data();
    await pc.setRemoteDescription(new RTCSessionDescription(d.offer));
    const ans = await pc.createAnswer();
    await pc.setLocalDescription(ans);
    await updateDoc(callRef, {answer:{type:ans.type, sdp:ans.sdp}});

    onSnapshot(offerCands, s => s.docChanges().forEach(c=>{ if(c.type==='added') pc.addIceCandidate(new RTCIceCandidate(c.doc.data())); }));
};

window.hangUp = async () => {
    if(localStream) localStream.getTracks().forEach(t=>t.stop());
    if(pc) pc.close();
    pc=null; localStream=null;
    document.getElementById('call-modal').classList.remove('active');
};
