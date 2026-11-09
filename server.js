const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

const PORT = process.env.PORT || 4000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    const publicPath = path.join(__dirname, 'public', 'index.html');
    const localPath = path.join(__dirname, 'index.html');

    if (fs.existsSync(publicPath)) {
        res.sendFile(publicPath);
    } else if (fs.existsSync(localPath)) {
        res.sendFile(localPath);
    } else {
        res.send("<h2>Error: index.html not found.</h2>");
    }
});

// Unlimited groups & unlimited members per group
const groups = {};

function broadcastGroupList() {
    const groupSummaries = Object.keys(groups).map(id => ({
        id,
        name: groups[id].name,
        creator: groups[id].createdBy,
        currentMembers: groups[id].members.length
    }));
    io.emit('group-list-updated', groupSummaries);
}

function removeUserFromCurrentRoom(socket) {
    const roomId = socket.activeRoomId;
    if (!roomId || !groups[roomId]) return;

    groups[roomId].members = groups[roomId].members.filter(u => u.id !== socket.id);
    socket.to(roomId).emit('peer-left', {
        peerId: socket.id,
        totalMembers: groups[roomId].members.length
    });
    socket.leave(roomId);
    socket.activeRoomId = null;

    if (groups[roomId].members.length === 0) {
        delete groups[roomId];
    }
    broadcastGroupList();
}

io.on('connection', (socket) => {
    // Send active groups on connection
    const groupSummaries = Object.keys(groups).map(id => ({
        id,
        name: groups[id].name,
        creator: groups[id].createdBy,
        currentMembers: groups[id].members.length
    }));
    socket.emit('group-list-updated', groupSummaries);

    // 1. Create a Group (with custom ID or auto-generated ID, Unlimited Members)
    socket.on('create-group', ({ groupName, customGroupId, creatorName }) => {
        const cleanName = (groupName || 'Team_Group').trim();
        let roomId = (customGroupId || '').trim().toUpperCase().replace(/\s+/g, '_');

        if (!roomId) {
            roomId = 'GP' + Math.floor(1000 + Math.random() * 9000);
        }

        if (!groups[roomId]) {
            groups[roomId] = {
                name: cleanName,
                createdBy: creatorName || 'Leader',
                members: []
            };
        }

        socket.emit('group-created', { roomId, groupName: groups[roomId].name });
        broadcastGroupList();
    });

    // 2. Join Group by ID (Unlimited Members)
    socket.on('join-room', ({ roomId, userName }) => {
        removeUserFromCurrentRoom(socket);

        const normalizedId = (roomId || '').trim().toUpperCase().replace(/\s+/g, '_');
        if (!normalizedId) return;

        // If group doesn't exist yet, create it automatically with that ID
        if (!groups[normalizedId]) {
            groups[normalizedId] = {
                name: `Group ${normalizedId}`,
                createdBy: userName || 'Member',
                members: []
            };
        }

        const room = groups[normalizedId];
        const existingMembers = [...room.members];

        // Prevent duplicate entry for same socket
        if (!room.members.find(m => m.id === socket.id)) {
            room.members.push({ id: socket.id, name: userName, muted: false });
        }

        socket.join(normalizedId);
        socket.activeRoomId = normalizedId;
        socket.userName = userName;

        // Send room info and existing members to the joining user
        socket.emit('room-joined', {
            roomId: normalizedId,
            groupName: room.name,
            existingMembers,
            totalMembers: room.members.length
        });

        // Notify existing members in the group so they initiate WebRTC Offers
        socket.to(normalizedId).emit('peer-joined', {
            peerId: socket.id,
            userName: userName,
            totalMembers: room.members.length
        });

        broadcastGroupList();
    });

    // 3. WebRTC Audio Signaling
    socket.on('webrtc-offer', ({ to, offer }) => {
        io.to(to).emit('webrtc-offer', {
            from: socket.id,
            userName: socket.userName || 'Teammate',
            offer
        });
    });

    socket.on('webrtc-answer', ({ to, answer }) => {
        io.to(to).emit('webrtc-answer', {
            from: socket.id,
            answer
        });
    });

    socket.on('webrtc-ice-candidate', ({ to, candidate }) => {
        io.to(to).emit('webrtc-ice-candidate', {
            from: socket.id,
            candidate
        });
    });

    // 4. Mute Status & Leave
    socket.on('mute-status', ({ isMuted }) => {
        const roomId = socket.activeRoomId;
        if (roomId && groups[roomId]) {
            const member = groups[roomId].members.find(m => m.id === socket.id);
            if (member) member.muted = isMuted;
            socket.to(roomId).emit('peer-mute-status', {
                peerId: socket.id,
                isMuted
            });
        }
    });

    socket.on('leave-room', () => {
        removeUserFromCurrentRoom(socket);
    });

    socket.on('disconnect', () => {
        removeUserFromCurrentRoom(socket);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(` Unlimited Team Voice Server (Create & Join by Group ID)`);
    console.log(` Local URL: http://localhost:${PORT}`);
    console.log(`=======================================================`);
});
