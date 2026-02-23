const METADATA_KEY = "com.fatesystem.diceRoll";
const ATTRIBUTE_DEFS = [
  { key: "force", label: "Força" },
  { key: "magic", label: "Magia" },
  { key: "agility", label: "Agilidade" }
];

const state = {
  diceCount: { force: 1, magic: 1, agility: 1 },
  useLuck: { force: false, magic: false, agility: false }
};

const attributesRoot = document.getElementById("attributes");
const luckPoolInput = document.getElementById("luckPool");
const rollButton = document.getElementById("rollButton");
const resultModal = document.getElementById("resultModal");
const closeModal = document.getElementById("closeModal");
const closeModalFooter = document.getElementById("closeModalFooter");
const resultList = document.getElementById("resultList");
const resultMeta = document.getElementById("resultMeta");
const resultTotal = document.getElementById("resultTotal");

function renderAttributeControls() {
  attributesRoot.innerHTML = "";

  ATTRIBUTE_DEFS.forEach((attribute) => {
    const row = document.createElement("div");
    row.className = "attribute-row";

    const left = document.createElement("div");
    left.className = "attribute-left";

    const name = document.createElement("div");
    name.className = `attribute-name ${attribute.key}`;
    name.textContent = attribute.label;

    const luckToggleLabel = document.createElement("label");
    luckToggleLabel.className = "luck-toggle";
    const luckToggle = document.createElement("input");
    luckToggle.type = "checkbox";
    luckToggle.checked = state.useLuck[attribute.key];
    luckToggle.addEventListener("change", () => {
      state.useLuck[attribute.key] = luckToggle.checked;
    });
    luckToggleLabel.append(luckToggle, " Usar sorte");

    left.append(name, luckToggleLabel);

    const control = document.createElement("div");
    control.className = "dice-control";

    const minus = document.createElement("button");
    minus.textContent = "-";
    minus.addEventListener("click", () => updateDice(attribute.key, -1));

    const output = document.createElement("output");
    output.id = `count-${attribute.key}`;
    output.textContent = state.diceCount[attribute.key];

    const plus = document.createElement("button");
    plus.textContent = "+";
    plus.addEventListener("click", () => updateDice(attribute.key, +1));

    control.append(minus, output, plus);
    row.append(left, control);
    attributesRoot.append(row);
  });
}

function updateDice(attributeKey, delta) {
  const next = Math.max(0, state.diceCount[attributeKey] + delta);
  state.diceCount[attributeKey] = next;
  const output = document.getElementById(`count-${attributeKey}`);
  if (output) output.textContent = next;
}

function randomD20() {
  return Math.floor(Math.random() * 20) + 1;
}

function classifyRoll(value) {
  if (value <= 4) return "fail";
  if (value <= 11) return "common";
  if (value <= 19) return "uncommon";
  return "critical";
}

function rollAllAttributes() {
  const luckPool = Math.max(0, Number(luckPoolInput.value) || 0);
  let luckRemaining = luckPool;

  const results = ATTRIBUTE_DEFS.map((attribute) => {
    const dice = Array.from({ length: state.diceCount[attribute.key] }, () => randomD20());

    if (state.useLuck[attribute.key] && luckRemaining > 0 && dice.length) {
      const highestIndex = dice.reduce((bestIdx, value, idx, arr) =>
        value > arr[bestIdx] ? idx : bestIdx, 0
      );
      dice[highestIndex] = Math.min(20, dice[highestIndex] + 1);
      luckRemaining -= 1;
    }

    return { key: attribute.key, label: attribute.label, dice };
  });

  return { results, luckPool, luckUsed: luckPool - luckRemaining };
}

function renderResults(payload) {
  const { results, rollerName, timestamp, luckPool, luckUsed } = payload;
  resultList.innerHTML = "";

  const when = new Date(timestamp).toLocaleTimeString("pt-BR");
  resultMeta.textContent = `${rollerName} • ${when} • Sorte ${luckUsed}/${luckPool}`;

  let total = 0;

  results.forEach((result) => {
    const item = document.createElement("div");
    item.className = `result-item ${result.key}`;

    const row = document.createElement("div");
    row.className = "row";

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = `${result.label} (1d20)`;

    const diceValues = document.createElement("div");
    diceValues.className = "dice-values";

    if (!result.dice.length) {
      diceValues.textContent = "—";
    } else {
      result.dice.forEach((value, idx) => {
        total += value;
        const die = document.createElement("span");
        die.className = `die ${classifyRoll(value)}`;
        die.textContent = idx === 0 ? String(value) : `, ${value}`;
        diceValues.append(die);
      });
    }

    row.append(title, diceValues);
    item.append(row);
    resultList.append(item);
  });

  resultTotal.textContent = `Total Geral: ${total}`;
  resultModal.classList.remove("hidden");
}

function createLocalOBRMock() {
  const listeners = [];
  const roomMetadata = {};

  return {
    onReady(cb) { cb(); },
    player: {
      async getName() { return "Jogador Local"; }
    },
    room: {
      onMetadataChange(cb) { listeners.push(cb); },
      async setMetadata(next) {
        Object.assign(roomMetadata, next);
        listeners.forEach((cb) => cb(roomMetadata));
      }
    }
  };
}

async function loadOBR() {
  try {
    const mod = await import("https://unpkg.com/@owlbear-rodeo/sdk@2.3.0/dist/index.mjs");
    return mod.default;
  } catch (_error) {
    return createLocalOBRMock();
  }
}

async function start() {
  const OBR = await loadOBR();

  closeModal.addEventListener("click", () => resultModal.classList.add("hidden"));
  closeModalFooter.addEventListener("click", () => resultModal.classList.add("hidden"));

  rollButton.addEventListener("click", async () => {
    const playerName = await OBR.player.getName();
    const rollData = rollAllAttributes();

    const payload = {
      ...rollData,
      rollerName: playerName,
      timestamp: Date.now()
    };

    await OBR.room.setMetadata({ [METADATA_KEY]: payload });
  });

  renderAttributeControls();

  OBR.room.onMetadataChange((metadata) => {
    const payload = metadata[METADATA_KEY];
    if (payload) renderResults(payload);
  });
}

start();
