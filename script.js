import OBR from "https://esm.sh/@owlbear-rodeo/sdk";

const CHANNEL_ID = "fatesystem-dice-channel";

// Rola 1d20
function rollD20() {
    return Math.floor(Math.random() * 20) + 1;
}

// Formata o número com a cor baseada no valor final
function formatResult(value) {
    if (value <= 4) return `<span class="res-falha">${value}</span>`;
    if (value >= 5 && value <= 10) return `<span class="res-comum">${value}</span>`;
    if (value >= 11 && value <= 19) return `<span class="res-incomum">${value}</span>`;
    return `<span class="res-critico">${value}</span>`; // 20 ou mais
}

// Monta a interface do resultado dentro do popup
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

// Lógica do botão de rolar solta (funciona dentro e fora do Owlbear)
document.getElementById("btn-rolar").addEventListener("click", async () => {
    const currentCounts = window.counts; 
    const currentSorte = window.sorte;

    // Trava para não rolar vazio
    if (currentCounts.forca === 0 && currentCounts.magia === 0 && currentCounts.agilidade === 0) {
        alert("Adicione pelo menos 1 dado em algum atributo para rolar!");
        return; 
    }

    const results = { forca: [], magia: [], agilidade: [] };

    // Rola os dados e aplica a sorte
    for (let i = 0; i < currentCounts.forca; i++) results.forca.push(rollD20() + currentSorte);
    for (let i = 0; i < currentCounts.magia; i++) results.magia.push(rollD20() + currentSorte);
    for (let i = 0; i < currentCounts.agilidade; i++) results.agilidade.push(rollD20() + currentSorte);

    let playerName = "Você (Teste Local)";

    // Se estiver dentro do Owlbear, pega o nome real do jogador
    if (OBR.isAvailable) {
        playerName = await OBR.player.getName();
    }

    const payload = { playerName, results, sorteUsada: currentSorte };

    // Mostra o popup na sua própria tela
    displayResults(payload);

    // Só envia para a rede se estiver dentro do Owlbear
    if (OBR.isAvailable) {
        OBR.broadcast.sendMessage(CHANNEL_ID, payload);
    }
});

// Inicialização do Owlbear para escutar a rolagem dos OUTROS jogadores
if (OBR.isAvailable) {
    OBR.onReady(() => {
        OBR.broadcast.onMessage(CHANNEL_ID, (event) => {
            displayResults(event.data);
        });
    });
}
