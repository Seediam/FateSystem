'use strict';

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Serve static files (index.html, style.css, script.js, etc.)
app.use(express.static(path.join(__dirname)));

// -----------------------------------------------------------------------
// In-memory state
// playersOnline : { socketId -> playerName }
// salaJogadores : { salaName -> [playerName] }
// -----------------------------------------------------------------------
const playersOnline  = {};
const salaJogadores  = {};

// -----------------------------------------------------------------------
// Helper: find socket id by player name
// -----------------------------------------------------------------------
function socketIdByName(nome) {
    return Object.keys(playersOnline).find(k => playersOnline[k] === nome) || null;
}

// -----------------------------------------------------------------------
// Helper: safely broadcast to a sala (room) except the sender
// -----------------------------------------------------------------------
function broadcastSala(socket, sala, evento, dados) {
    if (sala) {
        socket.to(sala).emit(evento, dados);
    } else {
        socket.broadcast.emit(evento, dados);
    }
}

// -----------------------------------------------------------------------
// Connection handler
// -----------------------------------------------------------------------
io.on('connection', (socket) => {
    console.log('[FateSystem] Conectado:', socket.id);

    // ------------------------------------------------------------------
    // Player enters: { nome, sala }
    // ------------------------------------------------------------------
    socket.on('entrarSala', (dados) => {
        const { nome, sala } = dados || {};
        if (!nome || !sala) return;

        playersOnline[socket.id] = nome;
        socket.join(sala);

        if (!salaJogadores[sala]) salaJogadores[sala] = [];
        if (!salaJogadores[sala].includes(nome)) {
            salaJogadores[sala].push(nome);
        }

        // Notify everyone in the room
        io.to(sala).emit('jogadoresNaSala', { sala, jogadores: salaJogadores[sala] });
        console.log(`[FateSystem] ${nome} entrou em "${sala}"`);
    });

    // ------------------------------------------------------------------
    // Player movement relay: { nome, x, y, dir, sala }
    // ------------------------------------------------------------------
    socket.on('moverJogador', (dados) => {
        const sala = dados && dados.sala;
        broadcastSala(socket, sala, 'moverJogador', dados);
    });

    // ------------------------------------------------------------------
    // Dice animation started: { nome, tipo, qtd, sala }
    // ------------------------------------------------------------------
    socket.on('updateDiceAnimation', (dados) => {
        const sala = dados && dados.sala;
        broadcastSala(socket, sala, 'updateDiceAnimation', dados);
    });

    // ------------------------------------------------------------------
    // Dice result: { nome, tipo, resultados, sala }
    // ------------------------------------------------------------------
    socket.on('updateDiceResult', (dados) => {
        const sala = dados && dados.sala;
        broadcastSala(socket, sala, 'updateDiceResult', dados);
    });

    // ------------------------------------------------------------------
    // TBS — Party battle invite
    // Payload: { batalhaId, de, sala, para: [playerName, ...] }
    // Relays the invite to each listed party member individually.
    // Only relays if the sender is a known, authenticated player.
    // ------------------------------------------------------------------
    socket.on('combatePartyConvite', (dados) => {
        if (!dados || !Array.isArray(dados.para)) return;
        // Validate that the sender is the player associated with this socket
        const senderName = playersOnline[socket.id];
        if (!senderName) return; // unknown/unauthenticated sender
        // Ensure "de" matches the registered player name so clients cannot
        // impersonate another player.
        if (dados.de && dados.de !== senderName) return;

        dados.para.forEach((nome) => {
            const tgt = socketIdByName(nome);
            if (tgt) {
                io.to(tgt).emit('combatePartyConvite', dados);
            }
        });
    });

    // ------------------------------------------------------------------
    // TBS — Party member accepts battle invite
    // Payload: { batalhaId, de, servidor }
    // ------------------------------------------------------------------
    socket.on('aceitarConviteCombate', (dados) => {
        socket.broadcast.emit('aceitarConviteCombate', dados);
    });

    // ------------------------------------------------------------------
    // TBS — Battle state synchronisation (turn order, HP, grid positions)
    // Payload: { batalhaId, estado, sala }
    // ------------------------------------------------------------------
    socket.on('tbsBatalhaSync', (dados) => {
        const sala = dados && dados.sala;
        broadcastSala(socket, sala, 'tbsBatalhaSync', dados);
    });

    // ------------------------------------------------------------------
    // TBS — Player action broadcast (move, attack, pass)
    // Payload: { batalhaId, acao, dados, sala }
    // ------------------------------------------------------------------
    socket.on('tbsAcaoJogador', (dados) => {
        const sala = dados && dados.sala;
        broadcastSala(socket, sala, 'tbsAcaoJogador', dados);
    });

    // ------------------------------------------------------------------
    // Chat message: { nome, msg, sala }
    // ------------------------------------------------------------------
    socket.on('chatMensagem', (dados) => {
        const sala = dados && dados.sala;
        broadcastSala(socket, sala, 'chatMensagem', dados);
    });

    // ------------------------------------------------------------------
    // Disconnection cleanup
    // ------------------------------------------------------------------
    socket.on('disconnect', () => {
        const nome = playersOnline[socket.id];
        delete playersOnline[socket.id];

        // Remove from all salas they were in
        Object.keys(salaJogadores).forEach((sala) => {
            const idx = salaJogadores[sala].indexOf(nome);
            if (idx !== -1) {
                salaJogadores[sala].splice(idx, 1);
                io.to(sala).emit('jogadoresNaSala', { sala, jogadores: salaJogadores[sala] });
            }
        });

        console.log(`[FateSystem] Desconectado: ${nome || socket.id}`);
    });
});

// -----------------------------------------------------------------------
// Start
// -----------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[FateSystem] Servidor rodando na porta ${PORT}`);
});
