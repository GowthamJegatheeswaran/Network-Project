const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*"
    },
    transports: ["websocket", "polling"]
});

app.use(express.static("public"));

let roomStartTimes = {};
let users = {};
let muteStates = {};
let cameraStates = {};   // 🔥 NEW

io.on("connection", (socket) => {

    socket.on("join-room", (roomId, username) => {

        socket.join(roomId);

        // ===== SEND PARTICIPANT COUNT =====


        users[socket.id] = {
            roomId,
            username: username || "Guest"
        };

        // SEND EXISTING USERS TO NEW USER
const room = io.sockets.adapter.rooms.get(roomId);

const existingUsers = room
    ? Array.from(room)
        .filter(id => id !== socket.id)
        .map(id => ({
            id: id,
            username: users[id].username
        }))
    : [];

socket.emit("existing-users", existingUsers);

        // Default states
        muteStates[socket.id] = false;
        cameraStates[socket.id] = true;  // default camera ON

        console.log(`${username} joined room ${roomId}`);

        // Notify others
        socket.to(roomId).emit("user-connected", socket.id, username);

        const roomData = io.sockets.adapter.rooms.get(roomId);
const count = roomData ? roomData.size : 1;

io.to(roomId).emit("participant-count", count);

// ===== START CALL TIMER WHEN 2 USERS JOIN =====
if (count === 2 && !roomStartTimes[roomId]) {

    roomStartTimes[roomId] = Date.now();

    io.to(roomId).emit(
        "call-started",
        roomStartTimes[roomId]
    );
}

// ✅ ADD THIS PART HERE
// If timer already running and this is NOT the 2nd user,
// send existing timer to new user
if (roomStartTimes[roomId]) {
    socket.emit(
        "call-started",
        roomStartTimes[roomId]
    );
}
        
// 🔥 SEND EXISTING MUTE STATES
        Object.keys(muteStates).forEach((id) => {
            if (id !== socket.id) {
                io.to(socket.id).emit("mute-status", id, muteStates[id]);
            }
        });

        // 🔥 SEND EXISTING CAMERA STATES
        Object.keys(cameraStates).forEach((id) => {
            if (id !== socket.id) {
                io.to(socket.id).emit("camera-status", id, cameraStates[id]);
            }
        });

        // ================= SIGNALING =================

        socket.on("offer", (offer, targetId) => {
            const user = users[socket.id];
            if (!user) return;

            io.to(targetId).emit(
                "offer",
                offer,
                socket.id,
                user.username
            );
        });

        socket.on("answer", (answer, targetId) => {
            io.to(targetId).emit("answer", answer, socket.id);
        });

        socket.on("ice-candidate", (candidate, targetId) => {
            io.to(targetId).emit("ice-candidate", candidate, socket.id);
        });

        // ================= CHAT =================

        socket.on("chat-message", (message) => {
            const user = users[socket.id];
            if (!user) return;

            io.to(user.roomId).emit(
                "chat-message",
                message,
                user.username
            );
        });

        // ================= PRIVATE CHAT =================

socket.on("private-message", (data) => {

    const user = users[socket.id];
    if (!user) return;

    const { message, targetId } = data;

    // send only to selected user
    io.to(targetId).emit(
        "private-message",
        message,
        user.username,
        socket.id
    );
});

        // ================= MUTE =================

        socket.on("mute-status", (isMuted) => {

            const user = users[socket.id];
            if (!user) return;

            muteStates[socket.id] = isMuted;

            socket.to(user.roomId).emit(
                "mute-status",
                socket.id,
                isMuted
            );
        });

        // ================= CAMERA =================

        socket.on("camera-status", (isOn) => {

            const user = users[socket.id];
            if (!user) return;

            cameraStates[socket.id] = isOn;

            socket.to(user.roomId).emit(
                "camera-status",
                socket.id,
                isOn
            );
        });

        // ================= SCREEN SHARE =================

socket.on("screen-share-status", (isSharing) => {

    const user = users[socket.id];
    if (!user) return;

    // send to everyone else in room
    socket.to(user.roomId).emit(
        "screen-share-status",
        socket.id,
        isSharing
    );
});
        // ================= DISCONNECT =================

        socket.on("disconnect", () => {

            const user = users[socket.id];
            if (!user) return;

            socket.to(user.roomId).emit("user-disconnected", socket.id);

            delete users[socket.id];
            delete muteStates[socket.id];
            delete cameraStates[socket.id];

           const roomData = io.sockets.adapter.rooms.get(user.roomId);
const count = roomData ? roomData.size : 0;
io.to(user.roomId).emit("participant-count", count);
// reset timer when room empty
if (count === 0) {
    delete roomStartTimes[user.roomId];
}       
});
    });
});

const PORT = process.env.PORT || 3000;
 
server.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});
 
