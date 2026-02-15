const socket = io();
const videoGrid = document.getElementById("video-grid");
const roomId = new URLSearchParams(window.location.search).get("room");
const username = localStorage.getItem("username");

document.getElementById("room-display").innerText = "Room: " + roomId;

let localStream;
let peers = {};
let participantCount = 0;
let userNames = {};
let localMuteStates = {};
let localCameraStates = {};
let focusedId = null;   // focus state
let callSeconds = 0;
let callTimerInterval = null;

const configuration = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject"
        }
    ]
};

async function init() {

    localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
    });

    addVideoStream(localStream, "local", username);
    updateParticipantCount();
    renderParticipants();

    socket.emit("join-room", roomId, username);

    document.getElementById("chat-message")
        .addEventListener("keydown", function (event) {
            if (event.key === "Enter") {
                event.preventDefault();
                sendMessage();
            }
        });

        document.getElementById("messages").style.scrollBehavior = "smooth";

    socket.on("user-connected", (userId, remoteName) => {

    userNames[userId] = remoteName;

    // ✅ Only ONE side creates offer
    if (socket.id < userId) {
        connectToNewUser(userId);
    }

    renderParticipants();
});
socket.on("existing-users", (users) => {

    users.forEach(user => {

        // ✅ save username FIRST
        userNames[user.id] = user.username;

        // ✅ only one side creates offer
        if (socket.id < user.id) {
            connectToNewUser(user.id);
        }

    });

    renderParticipants();
});

    socket.on("offer", async (offer, userId, remoteName) => {

        userNames[userId] = remoteName;

        let peer = peers[userId];

if (!peer) {
    peer = createPeerConnection(userId);
}

        await peer.setRemoteDescription(new RTCSessionDescription(offer));

        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);

        socket.emit("answer", answer, userId);
    });

    socket.on("answer", async (answer, userId) => {
        if (peers[userId]) {
            await peers[userId].setRemoteDescription(
                new RTCSessionDescription(answer)
            );
        }
    });

    socket.on("ice-candidate", (candidate, userId) => {
        if (peers[userId]) {
            peers[userId].addIceCandidate(
                new RTCIceCandidate(candidate)
            );
        }
    });

    socket.on("chat-message", (message, sender) => {
        addMessage(sender, message);
    });

    socket.on("participant-count", (count) => {
    participantCount = count;
    updateParticipantCount();
});

socket.on("call-started", (startTime) => {

    // stop old timer if running
    if (callTimerInterval) {
        clearInterval(callTimerInterval);
    }

    const durationEl = document.getElementById("call-duration");

    callTimerInterval = setInterval(() => {

        const elapsedSeconds =
            Math.floor((Date.now() - startTime) / 1000);

        const minutes = Math.floor(elapsedSeconds / 60);
        const seconds = elapsedSeconds % 60;

        durationEl.innerText =
            `${String(minutes).padStart(2,'0')}:` +
            `${String(seconds).padStart(2,'0')}`;

    }, 1000);
});

    socket.on("mute-status", (userId, isMuted) => {
        localMuteStates[userId] = isMuted;

        const icon = document.getElementById("mute-" + userId);
        if (icon) icon.style.display = isMuted ? "block" : "none";
        renderParticipants();
    });

    socket.on("camera-status", (userId, isOn) => {

        localCameraStates[userId] = isOn;

        const container = document.getElementById("container-" + userId);
        if (!container) return;

        const video = document.getElementById(userId);
        let avatar = document.getElementById("avatar-" + userId);

        if (!isOn) {

            if (!avatar) {
                avatar = document.createElement("div");
                avatar.classList.add("avatar");
                avatar.id = "avatar-" + userId;
                avatar.innerText =
                    (userNames[userId]?.charAt(0).toUpperCase()) || "?";
                container.appendChild(avatar);
            }

            if (video) video.style.display = "none";

        } else {

            if (video) video.style.display = "block";
            if (avatar) avatar.remove();
        }

        renderParticipants();
    });

    socket.on("user-disconnected", (userId) => {

        if (peers[userId]) {
            peers[userId].close();
            delete peers[userId];
        }

        const container = document.getElementById("container-" + userId);
        if (container) container.remove();

        delete userNames[userId];
        delete localMuteStates[userId];
        delete localCameraStates[userId];

        if (focusedId === userId) {
            removeFocusMode();
        }
        renderParticipants();
    });

    document.getElementById("mainVideo")
.addEventListener("leavepictureinpicture", () => {

    document.querySelector(".video-area").style.opacity = "1";
    document.querySelector(".chat-panel").style.opacity = "1";
    document.querySelector(".top-bar").style.opacity = "1";
    document.querySelector(".controls").style.opacity = "1";

});
}

function createPeerConnection(userId) {

    const peer = new RTCPeerConnection(configuration);

    localStream.getTracks().forEach(track => {
        peer.addTrack(track, localStream);
    });

    peer.ontrack = (event) => {

    const remoteStream = event.streams[0];
    const remoteName = userNames[userId] || "Participant";

    if (!document.getElementById("container-" + userId)) {
        addVideoStream(remoteStream, userId, remoteName);
    }
};

    peer.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit("ice-candidate", event.candidate, userId);
        }
    };

    peers[userId] = peer;
    return peer;
}

async function connectToNewUser(userId) {

    const peer = createPeerConnection(userId);

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    socket.emit("offer", offer, userId);
}

function addVideoStream(stream, id, name) {

    if (document.getElementById("container-" + id)) return;

    const container = document.createElement("div");
    container.classList.add("video-container");
    container.id = "container-" + id;

    container.addEventListener("click", () => toggleFocus(id));

    const video = document.createElement("video");
video.srcObject = stream;
video.autoplay = true;
video.playsInline = true;
video.setAttribute("playsinline", "");
video.controls = false;
video.id = id;

/* IMPORTANT FIX */
if (id === "local") {
    video.muted = true;   // prevent echo
} else {
    video.muted = false;  // allow remote audio
}

video.onloadedmetadata = () => {
    video.play().catch(err => {
        console.log("Video play blocked:", err);
    });
};

if (id === "local") {
    video.classList.add("local-video");
}

/* FIX ECHO FOR LOCAL USER */


    const label = document.createElement("div");
    label.classList.add("video-label");
    label.innerText = id === "local" ? `You (${username})` : name;

    const muteIcon = document.createElement("div");
    muteIcon.classList.add("mute-icon");
    muteIcon.innerHTML = '<i class="fa-solid fa-microphone-slash"></i>';
    muteIcon.id = "mute-" + id;
    muteIcon.style.display = localMuteStates[id] ? "block" : "none";

    container.appendChild(video);
    container.appendChild(label);
    container.appendChild(muteIcon);

    videoGrid.appendChild(container);

    /* ===== UI ONLY: set first video as main video ===== */

const mainVideo = document.getElementById("mainVideo");

if (mainVideo && !mainVideo.srcObject) {
    mainVideo.srcObject = stream;

    // ✅ SET MAIN VIDEO NAME
    const mainLabel = document.getElementById("mainVideoLabel");
    if (mainLabel) {
        mainLabel.innerText =
            id === "local"
                ? `You (${username})`
                : name;
    }

    if (id === "local") {
        mainVideo.classList.add("local-video");
    } else {
        mainVideo.classList.remove("local-video");
    }
}
    // 🔥 VERY IMPORTANT FIX
    // Apply stored camera state AFTER video is added

    if (localCameraStates[id] === false) {

        video.style.display = "none";

        const avatar = document.createElement("div");
        avatar.classList.add("avatar");
        avatar.id = "avatar-" + id;
        avatar.innerText =
            id === "local"
                ? username.charAt(0).toUpperCase()
                : (userNames[id]?.charAt(0).toUpperCase() || "?");

        container.appendChild(avatar);
    }
}

/* ================= FOCUS MODE ================= */

function toggleFocus(id) {

    /* ===== UI ONLY: change main video ===== */

const mainVideo = document.getElementById("mainVideo");
const clickedVideo = document.getElementById(id);

if (mainVideo && clickedVideo && clickedVideo.srcObject) {

    mainVideo.srcObject = clickedVideo.srcObject;

    // ✅ UPDATE MAIN VIDEO LABEL
const mainLabel = document.getElementById("mainVideoLabel");

if (mainLabel) {
    mainLabel.innerText =
        id === "local"
            ? `You (${username})`
            : (userNames[id] || "Participant");
}
    // ✅ mirror only when local video is main
    if (id === "local") {
        mainVideo.classList.add("local-video");
    } else {
        mainVideo.classList.remove("local-video");
    }
}
    if (focusedId === id) {
        removeFocusMode();
        return;
    }

    focusedId = id;
    videoGrid.classList.add("focus-mode");

    const allContainers = Array.from(document.querySelectorAll(".video-container"));

    const focusedContainer = document.getElementById("container-" + id);
    if (!focusedContainer) return;

    focusedContainer.classList.add("focused");

    // Move focused video to top
    videoGrid.prepend(focusedContainer);

    // Create bottom row
    let bottomRow = document.querySelector(".bottom-row");
    if (!bottomRow) {
        bottomRow = document.createElement("div");
        bottomRow.classList.add("bottom-row");
        videoGrid.appendChild(bottomRow);
    }

    bottomRow.innerHTML = "";

    allContainers.forEach(container => {
        if (container.id !== "container-" + id) {
            container.classList.remove("focused");
            bottomRow.appendChild(container);
        }
    });
}

function removeFocusMode() {

    focusedId = null;
    videoGrid.classList.remove("focus-mode");

    const bottomRow = document.querySelector(".bottom-row");

    if (bottomRow) {
        const children = Array.from(bottomRow.children);
        children.forEach(child => videoGrid.appendChild(child));
        bottomRow.remove();
    }

    document.querySelectorAll(".video-container").forEach(c => {
        c.classList.remove("focused");
    });
}

/* ================= CHAT ================= */

function sendMessage() {
    const input = document.getElementById("chat-message");
    if (input.value.trim() !== "") {
        socket.emit("chat-message", input.value);
        input.value = "";
    }
}

function addMessage(sender, message) {

    const messages = document.getElementById("messages");

    const bubble = document.createElement("div");

    const isMe = sender === username;

    bubble.classList.add("chat-bubble");
    bubble.classList.add(isMe ? "me" : "other");

    // message wrapper
    if (isMe) {
        bubble.innerHTML = `
            <div class="chat-text">${message}</div>
        `;
    } else {
        bubble.innerHTML = `
            <div class="chat-name">${sender}</div>
            <div class="chat-text">${message}</div>
        `;
    }

    messages.appendChild(bubble);
    bubble.style.opacity = "0";
bubble.style.transform = "translateY(6px)";

setTimeout(() => {
    bubble.style.transition = "all 0.2s ease";
    bubble.style.opacity = "1";
    bubble.style.transform = "translateY(0)";
}, 10);
    messages.scrollTop = messages.scrollHeight;
}
/* ================= MEDIA CONTROLS ================= */

function toggleMute() {

    const audioTrack = localStream.getAudioTracks()[0];
    audioTrack.enabled = !audioTrack.enabled;

    const isMuted = !audioTrack.enabled;
    localMuteStates["local"] = isMuted;

    const icon = document.getElementById("mute-local");
    if (icon) icon.style.display = isMuted ? "block" : "none";

    socket.emit("mute-status", isMuted);

    renderParticipants();
}

function toggleVideo() {

    const videoTrack = localStream.getVideoTracks()[0];
    videoTrack.enabled = !videoTrack.enabled;

    const isOn = videoTrack.enabled;

    localCameraStates["local"] = isOn;

    const container = document.getElementById("container-local");
    const video = document.getElementById("local");
    let avatar = document.getElementById("avatar-local");

    if (!isOn) {

        // 🔥 Hide video
        if (video) video.style.display = "none";

        // 🔥 Show avatar if not exists
        if (!avatar) {
            avatar = document.createElement("div");
            avatar.classList.add("avatar");
            avatar.id = "avatar-local";
            avatar.innerText = username.charAt(0).toUpperCase();
            container.appendChild(avatar);
        }

    } else {

        // 🔥 Show video again
        if (video) video.style.display = "block";

        // 🔥 Remove avatar
        if (avatar) avatar.remove();
    }

    // 🔥 Inform others
    socket.emit("camera-status", isOn);

    renderParticipants();
}


function toggleChat() {
    const chat = document.getElementById("chat-panel");
    chat.classList.toggle("hidden");
}

function updateParticipantCount() {
    const counter = document.getElementById("participant-count");
    if (counter) {
        counter.innerText = "Participants: " + participantCount;
    }
}

function endCall() {

    const confirmEnd = confirm("Are you sure you want to leave the meeting?");
    if (!confirmEnd) return;

    localStream.getTracks().forEach(track => track.stop());
    Object.values(peers).forEach(peer => peer.close());

    clearInterval(callTimerInterval);
    window.location.href = "/";
}
init();

/* ================= FULLSCREEN ================= */


function toggleFullscreen() {

    const mainVideoBox = document.querySelector(".main-video");
    const videoStrip = document.querySelector(".video-strip");
    const controls = document.querySelector(".controls");
    const header = document.querySelector(".top-bar");

    if (!document.fullscreenElement) {

        mainVideoBox.requestFullscreen();

        // hide UI
        videoStrip.style.display = "none";
        controls.style.display = "none";
        header.style.display = "none";

    } else {

        document.exitFullscreen();

        // show UI again
        videoStrip.style.display = "flex";
        controls.style.display = "flex";
        header.style.display = "flex";
    }
}

async function togglePiP() {

    const video = document.getElementById("mainVideo");
    const videoArea = document.querySelector(".video-area");
    const chatPanel = document.querySelector(".chat-panel");
    const header = document.querySelector(".top-bar");
    const controls = document.querySelector(".controls");

    try {

        // EXIT PiP
        if (document.pictureInPictureElement) {

            await document.exitPictureInPicture();

            videoArea.style.opacity = "1";
            chatPanel.style.opacity = "1";
            header.style.opacity = "1";
            controls.style.opacity = "1";
        }

        // ENTER PiP
        else {

            // IMPORTANT
            if (document.fullscreenElement) {
                await document.exitFullscreen();
            }

            await video.requestPictureInPicture();

            videoArea.style.opacity = "1";
            chatPanel.style.opacity = "1";
            header.style.opacity = "1";
            controls.style.opacity = "1";
        }

    } catch (err) {
        console.log("PiP error:", err);
    }
}

function renderParticipants() {

    const list = document.getElementById("participants-list");
    if (!list) return;

    list.innerHTML = "";

    // LOCAL USER
    addParticipantItem(
        "local",
        `You (${username})`
    );

    // REMOTE USERS
    Object.keys(userNames).forEach(id => {
        addParticipantItem(id, userNames[id]);
    });
}

function addParticipantItem(id, name) {

    const list = document.getElementById("participants-list");

    const div = document.createElement("div");
    div.className = "participant-item";

    const muteIcon = localMuteStates[id]
        ? '<i class="fa-solid fa-microphone-slash"></i>'
        : '<i class="fa-solid fa-microphone"></i>';

    const camIcon = localCameraStates[id] === false
        ? '<i class="fa-solid fa-video-slash"></i>'
        : '<i class="fa-solid fa-video"></i>';

    div.innerHTML = `
        <span class="participant-name">${name}</span>
        <span class="participant-icons">
            ${muteIcon} ${camIcon}
        </span>
    `;

    list.appendChild(div);
}

function startCallTimer() {

    const durationEl = document.getElementById("call-duration");

    callTimerInterval = setInterval(() => {

        callSeconds++;

        const minutes = Math.floor(callSeconds / 60);
        const seconds = callSeconds % 60;

        durationEl.innerText =
            `${String(minutes).padStart(2,'0')}:` +
            `${String(seconds).padStart(2,'0')}`;

    }, 1000);
}