//=============================================================================
// Fate_TBSBattle.js — FateSystem Turn-Based Strategy Battle Plugin
// For RPG Maker MZ
//=============================================================================
/*:
 * @target MZ
 * @plugindesc [v2.0] FateSystem — Turn-Based Strategy (TBS) Battle System
 * @author FateSystem
 *
 * @help
 * Fate_TBSBattle.js — Tactical grid combat for FateSystem multiplayer.
 *
 * Trigger a TBS battle by placing an event with the note: <FOE:TBS>
 * When the player touches that event, a grid battle is started.
 *
 * -----------------------------------------------------------------------
 * MULTIPLAYER (Socket.IO)
 * -----------------------------------------------------------------------
 * Party members on the same map receive a "Deseja ir junto?" prompt.
 * The battle waits up to 10 seconds for responses before starting.
 *
 * -----------------------------------------------------------------------
 * RENDERING
 * -----------------------------------------------------------------------
 * - Grid tiles  : PIXI.Graphics objects added to the tilemap container.
 * - Combatants  : Sprite_Character instances (standard RPG Maker sprites).
 * - HUD panel   : HTML overlay (#tbs-battle-hud).
 *
 * -----------------------------------------------------------------------
 * MOVEMENT
 * -----------------------------------------------------------------------
 * Strictly 4-directional (2=down, 4=left, 6=right, 8=up).
 * Animated frame-by-frame using moveStraight() + isMoving().
 *
 * @param tileSize
 * @text Tile Size (px)
 * @type number
 * @default 48
 *
 * @param maxPa
 * @text PA por turno
 * @type number
 * @default 3
 *
 * @param partyWaitMs
 * @text Espera por party (ms)
 * @type number
 * @default 10000
 */

var FateTBS = FateTBS || {};

// ==========================================================================
// CONSTANTS / PARAMETERS
// ==========================================================================
FateTBS.TILE_SIZE     = 48;
FateTBS.MAX_PA        = 3;
FateTBS.PARTY_WAIT_MS = 10000; // ms to wait for party members before starting
FateTBS.STEP_POLL_MS  = 50;    // interval (ms) for movement step polling

// Tile highlight colours (PIXI hex)
FateTBS.COR_MOVER    = 0x1a6e3a; // green — moveable tile
FateTBS.COR_ATACAR   = 0x7a1a1a; // red — attackable tile
FateTBS.COR_SELECION = 0xffd700; // yellow — selected tile

// ==========================================================================
// STATE
// ==========================================================================
FateTBS._ativo           = false;   // battle in progress
FateTBS._combatentes     = [];      // array of combatant objects
FateTBS._indTurno        = 0;       // index in _combatentes for current turn
FateTBS._acaoAtual       = null;    // 'mover' | 'atacar' | null
FateTBS._gradeContainer  = null;    // PIXI.Container for grid highlight tiles
FateTBS._spriteContainer = null;    // PIXI.Container for Sprite_Character objects
FateTBS._tilesDestaque   = [];      // currently highlighted PIXI.Graphics
FateTBS._batalhaId       = null;    // unique battle id (for multiplayer sync)
FateTBS._hudEstado       = {};      // saved display states of hidden HUDs

// ==========================================================================
// UTILITY
// ==========================================================================

/**
 * Generates a simple unique ID.
 * @returns {string}
 */
FateTBS._uid = function() {
    return 'tbs_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
};

/**
 * Writes a line to the in-battle log panel.
 * @param {string} msg
 */
FateTBS._log = function(msg) {
    var el = document.getElementById('tbs-hud-log');
    if (!el) return;
    var line = document.createElement('div');
    line.textContent = msg;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
};

/**
 * Returns the PIXI tilemap container from the current scene.
 * @returns {PIXI.Container|null}
 */
FateTBS._getTilemap = function() {
    try {
        return SceneManager._scene._spriteset._tilemap;
    } catch (e) {
        return null;
    }
};

// ==========================================================================
// HUD MANAGEMENT — hide/restore non-battle UI
// ==========================================================================

FateTBS.esconderHUDs = function() {
    var ids = ['party-hud-container', 'chat-toggle-btn', 'dice-toggle-btn', 'dice-panel', 'mestre-panel'];
    ids.forEach(function(id) {
        var el = document.getElementById(id);
        if (el) {
            FateTBS._hudEstado[id] = el.style.display;
            el.style.display = 'none';
        }
    });
    var hud = document.getElementById('tbs-battle-hud');
    if (hud) hud.style.display = 'block';
};

FateTBS.restaurarHUDs = function() {
    Object.keys(FateTBS._hudEstado).forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = FateTBS._hudEstado[id] || '';
    });
    FateTBS._hudEstado = {};
    var hud = document.getElementById('tbs-battle-hud');
    if (hud) hud.style.display = 'none';
};

// ==========================================================================
// GRID RENDERING — PIXI.Graphics inside the tilemap
// ==========================================================================

/**
 * Initialises (or resets) the PIXI container used for grid highlight tiles.
 */
FateTBS.iniciarGrade = function() {
    var tilemap = FateTBS._getTilemap();
    if (!tilemap) return;

    // Remove old containers if they exist
    if (FateTBS._gradeContainer && FateTBS._gradeContainer.parent) {
        FateTBS._gradeContainer.parent.removeChild(FateTBS._gradeContainer);
    }
    if (FateTBS._spriteContainer && FateTBS._spriteContainer.parent) {
        FateTBS._spriteContainer.parent.removeChild(FateTBS._spriteContainer);
    }

    // Grid highlight tiles (below sprites)
    var gradeContainer = new PIXI.Container();
    gradeContainer.zIndex = 50;
    tilemap.addChild(gradeContainer);
    FateTBS._gradeContainer = gradeContainer;

    // Sprite_Character container (above grid tiles)
    var spriteContainer = new PIXI.Container();
    spriteContainer.zIndex = 55;
    tilemap.addChild(spriteContainer);
    FateTBS._spriteContainer = spriteContainer;
};

/**
 * Clears all highlighted tiles from the grid container.
 */
FateTBS.limparDestaque = function() {
    if (!FateTBS._gradeContainer) return;
    FateTBS._tilesDestaque.forEach(function(g) {
        if (g.parent) g.parent.removeChild(g);
        g.destroy();
    });
    FateTBS._tilesDestaque = [];
};

/**
 * Highlights a list of grid tiles with the given colour.
 * @param {{x:number,y:number}[]} tiles — map tile coordinates
 * @param {number} cor — PIXI hex colour
 * @param {number} [alpha=0.4]
 */
FateTBS.destacarTiles = function(tiles, cor, alpha) {
    if (!FateTBS._gradeContainer) FateTBS.iniciarGrade();
    if (!FateTBS._gradeContainer) return;
    alpha = alpha !== undefined ? alpha : 0.4;
    tiles.forEach(function(tile) {
        var g = new PIXI.Graphics();
        g.beginFill(cor, alpha);
        g.drawRect(0, 0, FateTBS.TILE_SIZE - 2, FateTBS.TILE_SIZE - 2);
        g.endFill();
        // Border
        g.lineStyle(1, cor, 0.8);
        g.drawRect(0, 0, FateTBS.TILE_SIZE - 2, FateTBS.TILE_SIZE - 2);
        g.x = tile.x * FateTBS.TILE_SIZE + 1;
        g.y = tile.y * FateTBS.TILE_SIZE + 1;
        FateTBS._gradeContainer.addChild(g);
        FateTBS._tilesDestaque.push(g);
    });
};

// ==========================================================================
// COMBATANT DATA STRUCTURE
// ==========================================================================

/**
 * Creates and returns a combatant object.
 *
 * @param {object} cfg
 * @param {string}          cfg.id
 * @param {boolean}         cfg.isPlayer
 * @param {boolean}         cfg.isLocal
 * @param {Game_Character}  cfg.gameChar
 * @param {number}          cfg.x          — grid tile X
 * @param {number}          cfg.y          — grid tile Y
 * @param {number}          [cfg.hp]
 * @param {number}          [cfg.mhp]
 * @param {number}          [cfg.atk]
 * @param {number}          [cfg.def]
 * @param {number}          [cfg.mov]
 * @param {number}          [cfg.alc]
 * @returns {object}
 */
FateTBS.criarCombatente = function(cfg) {
    var sprite = null;

    if (cfg.gameChar && FateTBS._spriteContainer) {
        sprite = new Sprite_Character(cfg.gameChar);
        // Place sprite above grid tiles (zIndex 50) but below UI
        sprite.z = 4;
        FateTBS._spriteContainer.addChild(sprite);
    }

    return {
        id:           cfg.id,
        isPlayer:     !!cfg.isPlayer,
        isLocal:      !!cfg.isLocal,
        gameChar:     cfg.gameChar || null,
        sprite:       sprite,
        x:            cfg.x || 0,
        y:            cfg.y || 0,
        hp:           cfg.hp  !== undefined ? cfg.hp  : 100,
        mhp:          cfg.mhp !== undefined ? cfg.mhp : 100,
        atk:          cfg.atk !== undefined ? cfg.atk : 1,
        def:          cfg.def !== undefined ? cfg.def : 1,
        mov:          cfg.mov !== undefined ? cfg.mov : 3,
        alc:          cfg.alc !== undefined ? cfg.alc : 1,
        pa:           FateTBS.MAX_PA,
        maxPa:        FateTBS.MAX_PA,
        isMoving:     false,
        _moveInterval: null   // stored so it can be cancelled early
    };
};

// ==========================================================================
// ENEMY LOADING — from map event with <FOE:TBS> note
// ==========================================================================

/**
 * Creates an enemy combatant from a map event.
 *
 * @param {number} eventoId — the map event id
 * @param {number} gridX    — starting grid tile X
 * @param {number} gridY    — starting grid tile Y
 * @returns {object|null}
 */
FateTBS.carregarInimigo = function(eventoId, gridX, gridY) {
    var evento = $gameMap.event(eventoId);
    if (!evento) return null;

    var page = null;
    try {
        page = evento.event().pages[0];
    } catch (e) {
        return null;
    }

    // Use actual RPG Maker character image from the event page
    var charName  = page.image.characterName  || '';
    var charIndex = page.image.characterIndex || 0;

    // Build a Game_Character-like object using Game_Event so we get the
    // full walk-cycle animation via Sprite_Character.
    var gameChar = new Game_Character();
    gameChar.setImage(charName, charIndex);
    // Place it at the event's current map position
    gameChar.locate(gridX, gridY);

    // Read stat notes from the event (e.g. <hp:80> <atk:3>)
    var noteMeta = FateTBS._parseEventMeta(evento);

    var combatente = FateTBS.criarCombatente({
        id:       'Inimigo_' + eventoId,
        isPlayer: false,
        isLocal:  false,
        gameChar: gameChar,
        x:        gridX,
        y:        gridY,
        hp:  noteMeta.hp  || 60,
        mhp: noteMeta.hp  || 60,
        atk: noteMeta.atk || 2,
        def: noteMeta.def || 1,
        mov: noteMeta.mov || 2,
        alc: noteMeta.alc || 1
    });

    return combatente;
};

/**
 * Parses simple <key:value> tags from a map event's note.
 * @param {Game_Event} evento
 * @returns {object}
 */
FateTBS._parseEventMeta = function(evento) {
    var meta = {};
    try {
        var note = evento.event().note || '';
        var re = /<(\w+):(\d+)>/g;
        var m;
        while ((m = re.exec(note)) !== null) {
            meta[m[1].toLowerCase()] = parseInt(m[2], 10);
        }
    } catch (e) {}
    return meta;
};

// ==========================================================================
// LOCAL PLAYER LOADING
// ==========================================================================

/**
 * Creates the local player combatant using their actor sprite.
 *
 * @param {number} gridX
 * @param {number} gridY
 * @returns {object|null}
 */
FateTBS.carregarJogadorLocal = function(gridX, gridY) {
    var nome = (window.jogadorAtual) || 'Jogador';

    // Try to get sprite info from game actor or FateNetwork
    var charName  = '';
    var charIndex = 0;
    try {
        charName  = $gameActors.actor(1).characterName();
        charIndex = $gameActors.actor(1).characterIndex();
    } catch (e) {}
    if (!charName && window.FateNetwork && window.FateNetwork[nome]) {
        charName  = window.FateNetwork[nome].characterName  || '';
        charIndex = window.FateNetwork[nome].characterIndex || 0;
    }

    // Use the actual $gamePlayer as the Game_Character so walk animation is driven
    // by the existing player object on the map.
    var gameChar = $gamePlayer;

    var combatente = FateTBS.criarCombatente({
        id:       nome,
        isPlayer: true,
        isLocal:  true,
        gameChar: gameChar,
        x:        gridX,
        y:        gridY,
        hp:  100, mhp: 100,
        atk: 2, def: 1, mov: 3, alc: 1
    });

    return combatente;
};

// ==========================================================================
// ANIMATED 4-DIRECTIONAL MOVEMENT
// ==========================================================================

/**
 * Moves a combatant step-by-step along a Manhattan path to (destX, destY).
 * Uses moveStraight() so the walk animation plays naturally.
 *
 * Directions: 2=down, 4=left, 6=right, 8=up
 *
 * @param {object}   combatente
 * @param {number}   destX
 * @param {number}   destY
 * @param {Function} [callback]
 */
FateTBS.moverCombatente = function(combatente, destX, destY, callback) {
    if (!combatente || !combatente.gameChar) {
        if (callback) callback();
        return;
    }

    // Cancel any in-progress movement for this combatant
    if (combatente._moveInterval !== null) {
        clearInterval(combatente._moveInterval);
        combatente._moveInterval = null;
    }

    // Build Manhattan path — no diagonal
    var path = [];
    var cx = combatente.x;
    var cy = combatente.y;
    while (cx !== destX) {
        if (cx < destX) { path.push(6); cx++; }
        else            { path.push(4); cx--; }
    }
    while (cy !== destY) {
        if (cy < destY) { path.push(2); cy++; }
        else            { path.push(8); cy--; }
    }

    if (path.length === 0) {
        if (callback) callback();
        return;
    }

    combatente.isMoving = true;
    var step = 0;

    var interval = setInterval(function() {
        if (combatente.gameChar.isMoving()) return; // wait for current step to finish

        if (step >= path.length) {
            clearInterval(interval);
            combatente._moveInterval = null;
            combatente.isMoving = false;
            combatente.x = destX;
            combatente.y = destY;
            if (callback) callback();
            return;
        }

        combatente.gameChar.moveStraight(path[step]);
        step++;
    }, FateTBS.STEP_POLL_MS);

    // Store so it can be cancelled externally (e.g. battle ends early)
    combatente._moveInterval = interval;
};

// ==========================================================================
// PARTY CO-OP INVITE SYSTEM
// ==========================================================================

/**
 * Sends a TBS battle invite to all online party members on the same map.
 * Waits up to PARTY_WAIT_MS for responses, then starts the battle.
 *
 * @param {Function} onProntos — called when ready (with array of accepted names)
 */
FateTBS.convidarParty = function(onProntos) {
    var party  = window.minhaParty || [];
    var online = window.FateNetwork || {};
    var minha  = window.jogadorAtual || '';
    var sala   = window.salaAtual    || '';

    // Party members other than self who are currently online
    var alvos = party.filter(function(nome) {
        return nome !== minha && online[nome];
    });

    if (alvos.length === 0 || !window.socket) {
        onProntos([]);
        return;
    }

    var aceitos  = [];
    var timer    = null;
    var ouvindo  = true;

    // Listen for acceptances
    window.socket.on('aceitarConviteCombate', function _ouvir(dados) {
        if (!ouvindo) return;
        if (dados.batalhaId !== FateTBS._batalhaId) return;
        if (!aceitos.includes(dados.de)) aceitos.push(dados.de);
        if (aceitos.length >= alvos.length) {
            ouvindo = false;
            clearTimeout(timer);
            window.socket.off('aceitarConviteCombate', _ouvir);
            onProntos(aceitos);
        }
    });

    // Send invites
    window.socket.emit('combatePartyConvite', {
        batalhaId: FateTBS._batalhaId,
        de:        minha,
        sala:      sala,
        para:      alvos
    });

    // Timeout: start without late members; always remove the listener
    timer = setTimeout(function() {
        ouvindo = false;
        window.socket.off('aceitarConviteCombate', _ouvir);
        onProntos(aceitos);
    }, FateTBS.PARTY_WAIT_MS);
};

// ==========================================================================
// BATTLE START
// ==========================================================================

/**
 * Starts a TBS battle triggered by a map event.
 *
 * @param {number} eventoId — the event that has <FOE:TBS> in its note
 */
FateTBS.iniciarBatalha = function(eventoId) {
    if (FateTBS._ativo) return;

    FateTBS._batalhaId = FateTBS._uid();
    FateTBS._combatentes = [];
    FateTBS._indTurno    = 0;
    FateTBS._acaoAtual   = null;

    // Block player movement during battle
    if ($gamePlayer) $gamePlayer._isInTBS = true;

    FateTBS.esconderHUDs();
    FateTBS.iniciarGrade();

    // Determine starting positions (event tile + adjacent)
    var eventoTile = null;
    try {
        var ev = $gameMap.event(eventoId);
        eventoTile = { x: ev.x, y: ev.y };
    } catch (e) {
        eventoTile = { x: 5, y: 5 };
    }

    var jogadorX = eventoTile.x - 1;
    var jogadorY = eventoTile.y;
    var inimigoX = eventoTile.x;
    var inimigoY = eventoTile.y;

    // Local player combatant
    var jogador = FateTBS.carregarJogadorLocal(jogadorX, jogadorY);
    if (jogador) FateTBS._combatentes.push(jogador);

    // Enemy combatant from the map event
    var inimigo = FateTBS.carregarInimigo(eventoId, inimigoX, inimigoY);
    if (inimigo) FateTBS._combatentes.push(inimigo);

    FateTBS._ativo = true;

    // Invite party members; then begin after wait
    FateTBS.convidarParty(function(aceitos) {
        aceitos.forEach(function(nome) {
            // Additional party member combatants are placed adjacent to the player
            var x = jogadorX;
            var y = jogadorY + FateTBS._combatentes.filter(function(c) { return c.isPlayer; }).length;
            var membro = FateTBS.criarCombatente({
                id: nome, isPlayer: true, isLocal: false,
                gameChar: null, x: x, y: y,
                hp: 100, mhp: 100, atk: 2, def: 1, mov: 3, alc: 1
            });
            FateTBS._combatentes.push(membro);
        });
        FateTBS._comecarTurno();
    });
};

// ==========================================================================
// TURN MANAGEMENT
// ==========================================================================

FateTBS._comecarTurno = function() {
    FateTBS.limparDestaque();
    FateTBS._acaoAtual = null;

    var atual = FateTBS._combatentes[FateTBS._indTurno];
    if (!atual) { FateTBS.encerrarBatalha(); return; }

    // Restore PA
    atual.pa = atual.maxPa;

    FateTBS._atualizarHUDBatalha();
    FateTBS._log('Turno de ' + atual.id);

    // Highlight moveable tiles for the active combatant
    if (atual.isLocal) {
        FateTBS._destacarMovimento(atual);
    } else if (!atual.isPlayer) {
        // Simple AI: enemy moves toward the nearest player then attacks
        setTimeout(function() { FateTBS._iaInimigo(atual); }, 600);
    }
    // Remote players act via tbsAcaoJogador socket event (handled below)
};

FateTBS.passarTurno = function() {
    FateTBS._indTurno = (FateTBS._indTurno + 1) % FateTBS._combatentes.length;
    FateTBS._comecarTurno();

    if (window.socket && FateTBS._batalhaId) {
        window.socket.emit('tbsAcaoJogador', {
            batalhaId: FateTBS._batalhaId,
            acao: 'passarTurno',
            dados: { turno: FateTBS._indTurno },
            sala:  window.salaAtual
        });
    }
};

FateTBS.selecionarAcao = function(acao) {
    FateTBS._acaoAtual = acao;
    var atual = FateTBS._combatentes[FateTBS._indTurno];
    if (!atual) return;

    FateTBS.limparDestaque();
    if (acao === 'mover') {
        FateTBS._destacarMovimento(atual);
    } else if (acao === 'atacar') {
        FateTBS._destacarAtaque(atual);
    }
};

// ==========================================================================
// TILE SELECTION (click on grid)
// ==========================================================================

/**
 * Called when the player clicks a tile on the battle grid.
 * @param {number} tx
 * @param {number} ty
 */
FateTBS.selecionarTile = function(tx, ty) {
    var atual = FateTBS._combatentes[FateTBS._indTurno];
    if (!atual || !atual.isLocal) return;

    if (FateTBS._acaoAtual === 'mover' && atual.pa > 0) {
        // Check tile is within movement range
        var dist = Math.abs(tx - atual.x) + Math.abs(ty - atual.y);
        if (dist <= atual.mov) {
            atual.pa--;
            FateTBS.moverCombatente(atual, tx, ty, function() {
                FateTBS._atualizarHUDBatalha();
                FateTBS._destacarMovimento(atual);
                FateTBS._sincronizarEstado();
            });
        }
    } else if (FateTBS._acaoAtual === 'atacar' && atual.pa > 0) {
        // Find enemy on this tile
        var alvo = FateTBS._combatentes.find(function(c) {
            return c.x === tx && c.y === ty && c.id !== atual.id && !c.isPlayer;
        });
        if (alvo) {
            atual.pa--;
            FateTBS._executarAtaque(atual, alvo);
        }
    }
};

// ==========================================================================
// COMBAT
// ==========================================================================

FateTBS._executarAtaque = function(atacante, alvo) {
    var dano = Math.max(1, atacante.atk - alvo.def);
    alvo.hp  = Math.max(0, alvo.hp - dano);
    FateTBS._log(atacante.id + ' atacou ' + alvo.id + ' por ' + dano + ' dano! (HP: ' + alvo.hp + ')');
    FateTBS._atualizarHUDBatalha();

    if (alvo.hp <= 0) {
        FateTBS._removerCombatente(alvo);
    }

    FateTBS._sincronizarEstado();
};

FateTBS._removerCombatente = function(combatente) {
    FateTBS._log(combatente.id + ' foi derrotado!');

    // Cancel any pending movement
    if (combatente._moveInterval !== null) {
        clearInterval(combatente._moveInterval);
        combatente._moveInterval = null;
    }

    // Destroy sprite only for non-local combatants
    // (local player uses $gamePlayer which is managed by RPG Maker itself)
    if (!combatente.isLocal && combatente.sprite && combatente.sprite.parent) {
        combatente.sprite.parent.removeChild(combatente.sprite);
        combatente.sprite.destroy();
    }

    FateTBS._combatentes = FateTBS._combatentes.filter(function(c) {
        return c.id !== combatente.id;
    });

    // Check win/lose condition
    var temInimigo = FateTBS._combatentes.some(function(c) { return !c.isPlayer; });
    var temJogador = FateTBS._combatentes.some(function(c) { return c.isPlayer; });

    if (!temInimigo) {
        FateTBS._log('Vitória!');
        FateTBS.encerrarBatalha();
    } else if (!temJogador) {
        FateTBS._log('Derrota...');
        FateTBS.encerrarBatalha();
    } else {
        // Re-index turn if needed
        if (FateTBS._indTurno >= FateTBS._combatentes.length) {
            FateTBS._indTurno = 0;
        }
    }
};

// ==========================================================================
// BASIC ENEMY AI
// ==========================================================================

FateTBS._iaInimigo = function(inimigo) {
    // Find nearest player
    var alvoProximo = null;
    var menorDist   = Infinity;
    FateTBS._combatentes.forEach(function(c) {
        if (!c.isPlayer) return;
        var d = Math.abs(c.x - inimigo.x) + Math.abs(c.y - inimigo.y);
        if (d < menorDist) { menorDist = d; alvoProximo = c; }
    });

    if (!alvoProximo) { FateTBS.passarTurno(); return; }

    var dist = Math.abs(alvoProximo.x - inimigo.x) + Math.abs(alvoProximo.y - inimigo.y);

    if (dist <= inimigo.alc && inimigo.pa > 0) {
        // Attack
        inimigo.pa--;
        FateTBS._executarAtaque(inimigo, alvoProximo);
        setTimeout(function() { FateTBS.passarTurno(); }, 800);
    } else if (inimigo.pa > 0) {
        // Move one step toward the nearest player — strictly 4-directional.
        // Prefer the axis with the greater distance to avoid getting stuck
        // when one axis delta is already 0.
        var dx = alvoProximo.x - inimigo.x;
        var dy = alvoProximo.y - inimigo.y;
        var tx, ty;
        if (Math.abs(dx) >= Math.abs(dy)) {
            // Move horizontally
            tx = inimigo.x + (dx > 0 ? 1 : -1);
            ty = inimigo.y;
        } else {
            // Move vertically
            tx = inimigo.x;
            ty = inimigo.y + (dy > 0 ? 1 : -1);
        }

        inimigo.pa--;
        FateTBS.moverCombatente(inimigo, tx, ty, function() {
            setTimeout(function() { FateTBS._iaInimigo(inimigo); }, 200);
        });
    } else {
        FateTBS.passarTurno();
    }
};

// ==========================================================================
// MOVEMENT / ATTACK RANGE HIGHLIGHTS
// ==========================================================================

FateTBS._destacarMovimento = function(combatente) {
    var tiles = FateTBS._tilesNoRaio(combatente.x, combatente.y, combatente.mov);
    FateTBS.destacarTiles(tiles, FateTBS.COR_MOVER);
};

FateTBS._destacarAtaque = function(combatente) {
    var tiles = FateTBS._tilesNoRaio(combatente.x, combatente.y, combatente.alc);
    FateTBS.destacarTiles(tiles, FateTBS.COR_ATACAR);
};

/**
 * Returns all tiles within Manhattan distance `r` from (cx, cy).
 */
FateTBS._tilesNoRaio = function(cx, cy, r) {
    var tiles = [];
    for (var dx = -r; dx <= r; dx++) {
        for (var dy = -r; dy <= r; dy++) {
            if (Math.abs(dx) + Math.abs(dy) <= r && (dx !== 0 || dy !== 0)) {
                tiles.push({ x: cx + dx, y: cy + dy });
            }
        }
    }
    return tiles;
};

// ==========================================================================
// HUD UPDATE
// ==========================================================================

FateTBS._atualizarHUDBatalha = function() {
    var el = document.getElementById('tbs-hud-combatentes');
    if (!el) return;
    var html = '';
    FateTBS._combatentes.forEach(function(c, i) {
        var ativo = (i === FateTBS._indTurno) ? 'outline:2px solid #ffd700;' : '';
        var cor   = c.isPlayer ? '#1a6e3a' : '#7a1a1a';
        html += '<div style="background:rgba(0,0,0,0.6);border:1px solid #555;border-radius:4px;padding:6px 10px;min-width:100px;' + ativo + '">'
             + '<div style="font-weight:bold;color:' + cor + ';">' + c.id + '</div>'
             + '<div>HP: ' + c.hp + '/' + c.mhp + '</div>'
             + '<div>PA: ' + c.pa  + '/' + c.maxPa + '</div>'
             + '</div>';
    });
    el.innerHTML = html;
};

// ==========================================================================
// MULTIPLAYER SYNC
// ==========================================================================

FateTBS._sincronizarEstado = function() {
    if (!window.socket || !FateTBS._batalhaId) return;
    var estado = FateTBS._combatentes.map(function(c) {
        return { id: c.id, x: c.x, y: c.y, hp: c.hp, pa: c.pa };
    });
    window.socket.emit('tbsBatalhaSync', {
        batalhaId: FateTBS._batalhaId,
        estado:    estado,
        turno:     FateTBS._indTurno,
        sala:      window.salaAtual
    });
};

// Listen for remote battle actions
(function() {
    function _listenTBS() {
        if (!window.socket) { setTimeout(_listenTBS, 500); return; }

        window.socket.on('tbsBatalhaSync', function(dados) {
            if (!FateTBS._ativo || dados.batalhaId !== FateTBS._batalhaId) return;
            // Apply remote state
            (dados.estado || []).forEach(function(remoto) {
                var local = FateTBS._combatentes.find(function(c) { return c.id === remoto.id; });
                if (local) {
                    local.hp = remoto.hp;
                    local.pa = remoto.pa;
                    if (local.x !== remoto.x || local.y !== remoto.y) {
                        FateTBS.moverCombatente(local, remoto.x, remoto.y);
                    }
                }
            });
            FateTBS._indTurno = dados.turno;
            FateTBS._atualizarHUDBatalha();
        });

        window.socket.on('tbsAcaoJogador', function(dados) {
            if (!FateTBS._ativo || dados.batalhaId !== FateTBS._batalhaId) return;
            if (dados.acao === 'passarTurno') {
                FateTBS._indTurno = dados.dados.turno;
                FateTBS._comecarTurno();
            }
        });
    }
    _listenTBS();
})();

// ==========================================================================
// BATTLE END
// ==========================================================================

FateTBS.encerrarBatalha = function() {
    if (!FateTBS._ativo) return;
    FateTBS._ativo = false;

    // Destroy all combatant sprites added by this plugin:
    //   - local player: skip (sprite/gameChar owned by RPG Maker's $gamePlayer)
    //   - remote player with no sprite: no-op
    //   - enemy / remote with sprite: destroy
    FateTBS._combatentes.forEach(function(c) {
        // Cancel any pending movement animation
        if (c._moveInterval !== null) {
            clearInterval(c._moveInterval);
            c._moveInterval = null;
        }
        if (!c.isLocal && c.sprite && c.sprite.parent) {
            c.sprite.parent.removeChild(c.sprite);
            c.sprite.destroy();
        }
    });
    FateTBS._combatentes = [];

    // Remove grid highlight container
    FateTBS.limparDestaque();
    if (FateTBS._gradeContainer && FateTBS._gradeContainer.parent) {
        FateTBS._gradeContainer.parent.removeChild(FateTBS._gradeContainer);
    }
    FateTBS._gradeContainer = null;

    // Remove sprite container
    if (FateTBS._spriteContainer && FateTBS._spriteContainer.parent) {
        FateTBS._spriteContainer.parent.removeChild(FateTBS._spriteContainer);
    }
    FateTBS._spriteContainer = null;

    // Re-enable player movement
    if ($gamePlayer) $gamePlayer._isInTBS = false;

    FateTBS.restaurarHUDs();

    // Notify server
    if (window.socket && FateTBS._batalhaId) {
        window.socket.emit('tbsBatalhaSync', {
            batalhaId:  FateTBS._batalhaId,
            encerrado:  true,
            sala:       window.salaAtual
        });
    }

    FateTBS._batalhaId = null;
};

// ==========================================================================
// PLAYER MOVEMENT LOCK during TBS
// ==========================================================================

(function() {
    var _podeAndar = Game_Player.prototype.canMove;
    Game_Player.prototype.canMove = function() {
        if (this._isInTBS) return false;
        return _podeAndar.call(this);
    };
})();

// ==========================================================================
// EVENT TRIGGER — touch <FOE:TBS> event
// ==========================================================================

(function() {
    var _onTrigger = Game_Player.prototype.checkEventTriggerHere;
    Game_Player.prototype.checkEventTriggerHere = function(triggers) {
        _onTrigger.call(this, triggers);
        if (FateTBS._ativo) return;

        var events = $gameMap.eventsXy(this.x, this.y);
        events.forEach(function(ev) {
            var note = '';
            try { note = ev.event().note || ''; } catch (e) {}
            if (note.includes('<FOE:TBS>')) {
                FateTBS.iniciarBatalha(ev.eventId());
            }
        });
    };

    var _onFront = Game_Player.prototype.checkEventTriggerThere;
    Game_Player.prototype.checkEventTriggerThere = function(triggers) {
        _onFront.call(this, triggers);
        if (FateTBS._ativo) return;

        var d      = this.direction();
        var x2     = $gameMap.roundXWithDirection(this.x, d);
        var y2     = $gameMap.roundYWithDirection(this.y, d);
        var events = $gameMap.eventsXy(x2, y2);
        events.forEach(function(ev) {
            var note = '';
            try { note = ev.event().note || ''; } catch (e) {}
            if (note.includes('<FOE:TBS>')) {
                FateTBS.iniciarBatalha(ev.eventId());
            }
        });
    };
})();

// ==========================================================================
// GRID CLICK HANDLER — routes canvas clicks to selecionarTile
// ==========================================================================

(function() {
    /**
     * Convert a canvas pixel position to a map tile coordinate.
     * Prefers RPG Maker's built-in canvasToMapX/Y which correctly accounts
     * for display offset, tile size, and any zoom the engine applies.
     * Falls back to a manual calculation for compatibility.
     */
    function _screenToTile(sx, sy) {
        if (typeof $gameMap !== 'undefined' &&
            typeof $gameMap.canvasToMapX === 'function') {
            return {
                x: $gameMap.canvasToMapX(sx),
                y: $gameMap.canvasToMapY(sy)
            };
        }
        // Fallback: manual calculation using display offset
        var tileW = (typeof $gameMap !== 'undefined' && $gameMap.tileWidth)
            ? $gameMap.tileWidth()
            : FateTBS.TILE_SIZE;
        var tileH = (typeof $gameMap !== 'undefined' && $gameMap.tileHeight)
            ? $gameMap.tileHeight()
            : FateTBS.TILE_SIZE;
        return {
            x: Math.floor((sx + $gameMap.displayX() * tileW) / tileW),
            y: Math.floor((sy + $gameMap.displayY() * tileH) / tileH)
        };
    }

    function _attachClickHandler(canvas) {
        canvas.addEventListener('click', function(ev) {
            if (!FateTBS._ativo) return;
            var rect = canvas.getBoundingClientRect();
            var sx   = ev.clientX - rect.left;
            var sy   = ev.clientY - rect.top;
            var tile = _screenToTile(sx, sy);
            FateTBS.selecionarTile(tile.x, tile.y);
        });
    }

    var _canvas = document.querySelector('canvas');
    if (_canvas) {
        _attachClickHandler(_canvas);
    } else {
        // RPG Maker creates the canvas after document load; retry then
        window.addEventListener('load', function() {
            var c = document.querySelector('canvas');
            if (c) _attachClickHandler(c);
        });
    }
})();
