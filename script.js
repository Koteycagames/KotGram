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

// Звуки
const soundRing = new Audio('https://www.myinstants.com/media/sounds/discord-call.mp3'); soundRing.loop = true;
const soundJoin = new Audio('https://www.myinstants.com/media/sounds/discordjoin.mp3');
const soundLeave = new Audio('https://www.myinstants.com/media/sounds/discord-leave-noise.mp3');
function stopRing() { soundRing.pause(); soundRing.currentTime = 0; }

// WebRTC
let pc = null;
let localStream = null;
let remoteStream = null;
let callDocId = null;
const servers = { iceServers: [{ urls: 'stun:stun1.l.google.com:19302' }] };

// UI
window.toggleMenu = () => { document.getElementById('main-drawer').classList.toggle('open'); document.querySelector('.drawer-overlay').classList.toggle('active'); };
window.openSettings = () => { window.toggleMenu(); document.getElementById('settings-modal').classList.add('active'); };
window.closeSettings = () => { document.getElementById('settings-modal').classList.remove('active'); };
window.changeFontSize = (val) => { document.documentElement.style.setProperty('--font-size', val+'px'); document.getElementById('font-val').innerText=val; };

// АВТОРИЗАЦИЯ
window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {size:'normal'});
window.sendSms = async () => {
    try {
        const p = document.getElementById('phone-number').value;
        window.confirmationResult = await signInWithPhoneNumber(auth, p, window.recaptchaVerifier);
        document.querySelector('.screen.active').classList.remove('active');
        document.getElementById('screen-code').classList.add('active');
    } catch(e){ alert(e.message); }
};
window.verifyCode = async () => {
    try {
        const r = await window.confirmationResult.confirm(document.getElementById('verification-code').value);
        checkUser(r.user);
    } catch(e){ alert("Код неверный"); }
};
async function checkUser(u) {
    const s = await getDoc(doc(db,"users",u.uid));
    if(s.exists()) startApp(u, s.data());
    else { document.querySelector('.screen.active').classList.remove('active'); document.getElementById('screen-nickname').classList.add('active'); }
}
window.saveProfile = async () => {
    const n = document.getElementById('username-input').value;
    const u = auth.currentUser;
    await setDoc(doc(db,"users",u.uid), {uid:u.uid, phoneNumber:u.phoneNumber, username:n, photoURL:""});
    startApp(u, {username:n});
};

onAuthStateChanged(auth, u => {
    if(u) checkUser(u);
    else { document.getElementById('auth-container').classList.remove('hidden'); document.getElementById('app-layout').style.display='none'; }
});

function startApp(u, data) {
    currentUser = u;
    document.getElementById('auth-container').classList.add('hidden');
    document.getElementById('app-layout').style.display='flex';
    if(data) updateDrawer(data);
    loadChats();
    trackStatus();
}

function updateDrawer(data) {
    document.getElementById('drawer-name').innerText = data.username || "Я";
    const el = document.getElementById('drawer-avatar');
    if(data.photoURL) { el.style.backgroundImage = `url(${data.photoURL})`; el.innerText=""; }
}

// ЧАТЫ
function loadChats() {
    if(chatsUnsubscribe) chatsUnsubscribe();
    document.getElementById('chats-list').innerHTML = ""; 
    const q = query(collection(db,"chats"), where("participants","array-contains",currentUser.uid));
    
    chatsUnsubscribe = onSnapshot(q, (snapshot) => {
        const list = document.getElementById('chats-list');
        snapshot.docChanges().forEach(async (change) => {
            if(change.type === "added" || change.type === "modified") {
                const data = change.doc.data();
                const cid = change.doc.id;
                const fid = data.participants.find(id => id !== currentUser.uid);
                
                let fName = "...", fPhoto = "";
                if(fid) {
                    const f = await getDoc(doc(db,"users",fid));
                    if(f.exists()) { fName=f.data().username; fPhoto=f.data().photoURL; }
                }

                let div = document.getElementById(`c-${cid}`);
                const isActive = currentChatId===cid?'active':'';
                const avaStyle = fPhoto ? `background-image:url(${fPhoto})` : '';
                const avaText = fPhoto ? '' : fName[0];
                
                const html = `
                    <div class="avatar-small" style="${avaStyle}">${avaText}</div>
                    <div class="chat-info">
                        <div class="chat-name">${fName}</div>
                        <div class="last-msg">${data.lastMessage || ""}</div>
                    </div>`;

                if(div) { div.className=`chat-item ${isActive}`; div.innerHTML=html; }
                else {
                    div=document.createElement('div'); div.id=`c-${cid}`; div.className=`chat-item ${isActive}`;
                    div.onclick = () => openChat(cid, fName, fid, fPhoto);
                    div.innerHTML=html; list.appendChild(div);
                }
                listenCalls(cid);
            }
        });
    });
}

// ОТКРЫТИЕ ЧАТА
window.openChat = (cid, name, fid, photo) => {
    currentChatId = cid;
    document.getElementById('chat-area').classList.add('mobile-visible');
    
    document.querySelectorAll('.chat-item').forEach(e=>e.classList.remove('active'));
    document.getElementById(`c-${cid}`)?.classList.add('active');

    document.getElementById('chat-header-name').innerText = name;
    const ha = document.getElementById('header-avatar');
    if(photo) { ha.style.backgroundImage=`url(${photo})`; ha.innerText=""; }
    else { ha.style.backgroundImage=""; ha.innerText=name[0]; }

    trackFriend(cid, fid);

    if(messagesUnsubscribe) messagesUnsubscribe();
    messagesUnsubscribe = onSnapshot(query(collection(db,"chats",cid,"messages"), orderBy("timestamp","asc")), s => {
        const area = document.getElementById('messages-area');
        if(s.empty) area.innerHTML = '<div class="placeholder">Нет сообщений</div>';
        else if(area.querySelector('.placeholder')) area.innerHTML="";
        
        s.docChanges().forEach(c => {
            if(c.type==="added") {
                const m = c.doc.data();
                const div = document.createElement('div');
                div.className = `message ${m.senderId===currentUser.uid?'my':'other'}`;
                const t = m.timestamp ? new Date(m.timestamp.toDate()).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '';
                div.innerHTML = `${m.type==='image' ? `<img src="${m.imageUrl}" class="msg-img">` : m.text}<div class="msg-time">${t}</div>`;
                area.appendChild(div);
            }
        });
        area.scrollTop = area.scrollHeight;
    });
};

window.closeChat = () => {
    document.getElementById('chat-area').classList.remove('mobile-visible');
    currentChatId = null;
};

// СООБЩЕНИЯ
window.sendMessage = async () => {
    const i = document.getElementById('msg-input');
    if(!i.value || !currentChatId) return;
    const txt = i.value; i.value="";
    await addDoc(collection(db,"chats",currentChatId,"messages"),{text:txt, senderId:currentUser.uid, timestamp:serverTimestamp()});
    await updateDoc(doc(db,"chats",currentChatId),{lastMessage:txt, lastMessageTime:serverTimestamp()});
};
window.handleEnter = e => { if(e.key==='Enter') window.sendMessage(); };

async function upImg(f) {
    const d=new FormData(); d.append('image',f);
    const r=await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`,{method:'POST',body:d});
    return (await r.json()).data.url;
}
window.sendImage = async (i) => {
    if(!i.files[0]||!currentChatId)return;
    const u = await upImg(i.files[0]);
    await addDoc(collection(db,"chats",currentChatId,"messages"),{imageUrl:u, type:'image', senderId:currentUser.uid, timestamp:serverTimestamp()});
};
window.uploadAvatar = async (i) => {
    if(!i.files[0])return;
    const u = await upImg(i.files[0]);
    await updateDoc(doc(db,"users",currentUser.uid),{photoURL:u});
    updateDrawer({username:document.getElementById('drawer-name').innerText, photoURL:u});
};

// СТАТУСЫ
window.handleTyping = () => {
    if(!currentChatId) return;
    const r=doc(db,"chats",currentChatId);
    updateDoc(r,{[`typing.${currentUser.uid}`]:true});
    if(typingTimeout) clearTimeout(typingTimeout);
    typingTimeout=setTimeout(()=>updateDoc(r,{[`typing.${currentUser.uid}`]:false}),2000);
};
function trackStatus() { setInterval(()=>currentUser&&updateDoc(doc(db,"users",currentUser.uid),{lastSeen:serverTimestamp()}),60000); }
function trackFriend(cid, fid) {
    onSnapshot(doc(db,"chats",cid),s=>{
        const d=s.data(); const el=document.getElementById('chat-header-status');
        if(d?.typing && d.typing[fid]) el.innerText="печатает...";
        else getDoc(doc(db,"users",fid)).then(u=>{
            const ud=u.data();
            if(ud?.lastSeen) {
                const diff=(Date.now()-ud.lastSeen.toDate())/60000;
                el.innerText = diff<5 ? "в сети" : "был(а) недавно";
            }
        });
    });
}
window.addContactPrompt = async () => {
    const p=prompt("Телефон:"); if(!p)return;
    const s=await getDocs(query(collection(db,"users"),where("phoneNumber","==",p)));
    if(s.empty)return alert("Нет такого");
    const f=s.docs[0].data(); const ids=[currentUser.uid,f.uid].sort();
    await setDoc(doc(db,"chats",ids.join("_")),{participants:ids, lastMessage:""},{merge:true});
};

// ==========================================
// 6. ЗВОНКИ (АВТО-СБРОС)
// ==========================================

window.startCall = async () => {
    document.getElementById('call-modal').classList.add('active');
    document.getElementById('btn-answer').style.display='none';
    
    soundRing.play().catch(e => console.log("Автоплей"));

    localStream = await navigator.mediaDevices.getUserMedia({video:true,audio:true});
    document.getElementById('localVideo').srcObject = localStream;
    remoteStream=new MediaStream(); document.getElementById('remoteVideo').srcObject=remoteStream;
    pc=new RTCPeerConnection(servers);
    localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
    pc.ontrack=e=>e.streams[0].getTracks().forEach(t=>remoteStream.addTrack(t));
    const cr=doc(collection(db,"chats",currentChatId,"calls")); callDocId=cr.id;
    pc.onicecandidate=e=>e.candidate&&addDoc(collection(cr,'offerCandidates'),e.candidate.toJSON());
    const off=await pc.createOffer(); await pc.setLocalDescription(off);
    await setDoc(cr,{offer:{sdp:off.sdp,type:off.type,callerId:currentUser.uid}, status: 'calling'});
    
    // Слушаем изменение статуса звонка
    onSnapshot(cr, s => {
        const d = s.data();
        if(!d) return;
        
        // Если собеседник ответил
        if(!pc.currentRemoteDescription && d.answer) {
            pc.setRemoteDescription(new RTCSessionDescription(d.answer));
            document.getElementById('call-status').innerText="В разговоре";
            stopRing(); soundJoin.play();
        }

        // Если собеседник сбросил (статус ended)
        if (d.status === 'ended') {
            window.hangUp(false); // false = не писать в базу, просто закрыть
        }
    });
    onSnapshot(collection(cr,'answerCandidates'), s=>s.docChanges().forEach(c=>{ if(c.type==='added') pc.addIceCandidate(new RTCIceCandidate(c.doc.data())); }));
};

function listenCalls(cid) {
    onSnapshot(query(collection(db,"chats",cid,"calls")), s=>{
        s.docChanges().forEach(c=>{
            if(c.type==='added'){
                const d=c.doc.data();
                if(d.offer && d.offer.callerId!==currentUser.uid && d.status !== 'ended' && !d.answer) {
                    callDocId=c.doc.id; currentChatId=cid;
                    document.getElementById('call-modal').classList.add('active');
                    document.getElementById('btn-answer').style.display='flex';
                    document.getElementById('call-status').innerText="Входящий...";
                    soundRing.play();
                }
            }
        });
    });
}

window.answerCall = async () => {
    stopRing(); soundJoin.play();
    document.getElementById('btn-answer').style.display='none';
    const cr=doc(db,"chats",currentChatId,"calls",callDocId);
    
    // Тоже слушаем сброс
    onSnapshot(cr, s => {
        if (s.data()?.status === 'ended') window.hangUp(false);
    });

    pc=new RTCPeerConnection(servers);
    localStream=await navigator.mediaDevices.getUserMedia({video:true,audio:true});
    document.getElementById('localVideo').srcObject=localStream;
    remoteStream=new MediaStream(); document.getElementById('remoteVideo').srcObject=remoteStream;
    localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
    pc.ontrack=e=>e.streams[0].getTracks().forEach(t=>remoteStream.addTrack(t));
    pc.onicecandidate=e=>e.candidate&&addDoc(collection(cr,'answerCandidates'),e.candidate.toJSON());
    const d=(await getDoc(cr)).data(); await pc.setRemoteDescription(new RTCSessionDescription(d.offer));
    const ans=await pc.createAnswer(); await pc.setLocalDescription(ans);
    await updateDoc(cr,{answer:{type:ans.type,sdp:ans.sdp}, status:'connected'});
    onSnapshot(collection(cr,'offerCandidates'), s=>s.docChanges().forEach(c=>{ if(c.type==='added') pc.addIceCandidate(new RTCIceCandidate(c.doc.data())); }));
};

// notifyDb = true (по умолчанию) - значит я нажал кнопку и надо сказать базе
// notifyDb = false - значит база сама сказала мне закрыться
window.hangUp = async (notifyDb = true) => {
    stopRing(); soundLeave.play();

    if(localStream) localStream.getTracks().forEach(t=>t.stop());
    if(pc) pc.close(); pc=null; localStream=null;
    document.getElementById('call-modal').classList.remove('active');

    // Если я нажал кнопку сброса — пишу в базу, что звонок окончен
    if (notifyDb && callDocId && currentChatId) {
        try {
            await updateDoc(doc(db, "chats", currentChatId, "calls", callDocId), { status: 'ended' });
        } catch(e) { console.log("Звонок уже был удален"); }
    }
};
