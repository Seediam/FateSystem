import OBR from "https://esm.sh/@owlbear-rodeo/sdk";

const CHANNEL_ID = "fatesystem-dice-channel";

function rollD20() {
    return Math.floor(Math.random() * 20) + 1;
}

function formatResult(value, sorte) {
    let cor = value <= 4 ? "res-falha" : value <= 10 ? "res-comum" : value <= 19 ? "res-incomum" : "res-critico";
    let sorteHtml = sorte > 0 ? `<sup class="sorte-mod">${sorte}</sup>` : "";
    return `<span class="${cor}">${value}</span>${sorteHtml}`;
}

// 1. Função para adicionar a linha no painel de Histórico
function addToHistory(data) {
    const historico = document.getElementById("historico");
    let parts = [];
    
    if (data.results.forca.length > 0) parts.push(`🔴 ${data.results.forca.map(v => formatResult(v, data.sorteUsada)).join(", ")}`);
    if (data.results.magia.length > 0) parts.push(`🔵 ${data.results.magia.map(v => formatResult(v, data.sorteUsada)).join(", ")}`);
    if (data.results.agilidade.length > 0) parts.push(`🟣 ${data.results.agilidade.map(v => formatResult(v, data.sorteUsada)).join(", ")}`);

    const entry = document.createElement("div");
    entry.className = "historico-item";
    entry.innerHTML = `<strong>(${data.playerName})</strong> = ${parts.join(" | ")}`;
    
    // Coloca a rolagem mais recente sempre no topo
    historico.prepend(entry);
}

// 2. Função para explodir o Modal no centro da tela
function showCenterPopup(data) {
    if (OBR.isAvailable) {
        const payloadStr = encodeURIComponent(JSON.stringify(data));
        OBR.modal.open({
            id: "resultado-modal",
            url: `/FateSystem/resultado.html?data=${payloadStr}`,
            height: 250,
            width: 450
        });
    }
}

document.getElementById("btn-rolar").addEventListener("click", async () => {
    const forca = parseInt(document.getElementById("count-forca").innerText) || 0;
    const magia = parseInt(document.getElementById("count-magia").innerText) || 0;
    const agilidade = parseInt(document.getElementById("count-agilidade").innerText) || 0;
    const sorte = parseInt(document.getElementById("count-sorte").innerText) || 0;

    if (forca === 0 && magia === 0 && agilidade === 0) return alert("Adicione 1 dado para rolar!");

    const results = { forca: [], magia: [], agilidade: [] };

    for (let i = 0; i < forca; i++) results.forca.push(rollD20() + sorte);
    for (let i = 0; i < magia; i++) results.magia.push(rollD20() + sorte);
    for (let i = 0; i < agilidade; i++) results.agilidade.push(rollD20() + sorte);

    let playerName = "Você";
    try { if (OBR.isAvailable && OBR.isReady) playerName = await OBR.player.getName(); } catch (e) {}

    const payload = { playerName, results, sorteUsada: sorte };

    // Atualiza sua própria tela
    addToHistory(payload);
    showCenterPopup(payload);

    // Manda pros outros jogadores
    try {
        if (OBR.isAvailable && OBR.isReady) OBR.broadcast.sendMessage(CHANNEL_ID, payload);
    } catch (e) {}
});

// Fica escutando as rolagens dos outros
if (OBR.isAvailable) {
    OBR.onReady(() => {
        OBR.broadcast.onMessage(CHANNEL_ID, (event) => {
            addToHistory(event.data);
            showCenterPopup(event.data);
        });
    });
}
