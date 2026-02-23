import OBR from "https://esm.sh/@owlbear-rodeo/sdk";

const CHANNEL_ID = "fatesystem-dice-channel";

function rollD20() {
    return Math.floor(Math.random() * 20) + 1;
}

function formatResult(value) {
    if (value <= 4) return `<span class="res-falha">${value}</span>`;
    if (value >= 5 && value <= 10) return `<span class="res-comum">${value}</span>`;
    if (value >= 11 && value <= 19) return `<span class="res-incomum">${value}</span>`;
    return `<span class="res-critico">${value}</span>`;
}

function displayResults(data) {
    const popup = document.getElementById("result-popup");
    const content = document.getElementById("popup-content");
    document.getElementById("popup-title").innerText = `Rolagem de ${data.playerName}`;

    let html = "";
    if (data.results.forca.length > 0) {
        html += `<p><span class="attr-forca">Força:</span> ${data.results.forca.map(formatResult).join(", ")}</p>`;
    }
    if (data.results.magia.length > 0) {
        html += `<p><span class="attr-magia">Magia:</span> ${data.results.magia.map(formatResult).join(", ")}</p>`;
    }
    if (data.results.agilidade.length > 0) {
        html += `<p><span class="attr-agilidade">Agilidade:</span> ${data.results.agilidade.map(formatResult).join(", ")}</p>`;
    }

    if (data.sorteUsada > 0) {
        html += `<p style="font-size: 12px; color: #aaa;">(+${data.sorteUsada} de Sorte adicionada em cada dado)</p>`;
    }

    content.innerHTML = html;
    popup.style.display = "block";
}

document.getElementById("btn-rolar").addEventListener("click", async () => {
    // Agora o sistema puxa os números DIRETAMENTE dos textos que você vê na tela
    const forca = parseInt(document.getElementById("count-forca").innerText) || 0;
    const magia = parseInt(document.getElementById("count-magia").innerText) || 0;
    const agilidade = parseInt(document.getElementById("count-agilidade").innerText) || 0;
    const sorte = parseInt(document.getElementById("count-sorte").innerText) || 0;

    if (forca === 0 && magia === 0 && agilidade === 0) {
        alert("Adicione pelo menos 1 dado em algum atributo para rolar!");
        return; 
    }

    const results = { forca: [], magia: [], agilidade: [] };

    // Rola os dados e aplica a sorte imediatamente
    for (let i = 0; i < forca; i++) results.forca.push(rollD20() + sorte);
    for (let i = 0; i < magia; i++) results.magia.push(rollD20() + sorte);
    for (let i = 0; i < agilidade; i++) results.agilidade.push(rollD20() + sorte);

    let playerName = "Você";
    if (OBR.isAvailable) {
        playerName = await OBR.player.getName();
    }

    const payload = { playerName, results, sorteUsada: sorte };

    // Mostra na sua tela
    displayResults(payload);

    // Envia para a rede do Owlbear (para os outros jogadores verem)
    if (OBR.isAvailable) {
        OBR.broadcast.sendMessage(CHANNEL_ID, payload);
    }
});

if (OBR.isAvailable) {
    OBR.onReady(() => {
        // Fica ouvindo rolagens de outras pessoas
        OBR.broadcast.onMessage(CHANNEL_ID, (event) => {
            displayResults(event.data);
        });
    });
}
