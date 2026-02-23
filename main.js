import OBR from "https://unpkg.com/@owlbear-rodeo/sdk@2.3.0/dist/index.mjs";

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
const resultList = document.getElementById("resultList");
const resultMeta = document.getElementById("resultMeta");

function renderAttributeControls() {
  attributesRoot.innerHTML = "";
  ATTRIBUTE_DEFS.forEach((attribute) => {
    const row = document.createElement("div");
    row.className = "attribute-row";

    const name = document.createElement("div");
    name.className = `attribute-name ${attribute.key}`;
    name.textContent = attribute.label;

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

    const luckToggleLabel = document.createElement("label");
    luckToggleLabel.className = "luck-toggle";
    const luckToggle = document.createElement("input");
    luckToggle.type = "checkbox";
    luckToggle.checked = state.useLuck[attribute.key];
    luckToggle.addEventListener("change", () => {
      state.useLuck[attribute.key] = luckToggle.checked;
    });
    luckToggleLabel.append(luckToggle, " Usar sorte neste atributo");

    const right = document.createElement("div");
    right.append(luckToggleLabel);

    row.append(name, control, right);
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

    if (state.useLuck[attribute.key] && luckRemaining > 0 && dice.length > 0) {
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
  resultMeta.textContent = `${rollerName} rolou às ${when}. Sorte usada: ${luckUsed}/${luckPool}.`;

  results.forEach((result) => {
    const item = document.createElement("div");
    item.className = `result-item ${result.key}`;

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = `${result.label}:`;

    const diceRow = document.createElement("div");
    if (!result.dice.length) {
      diceRow.textContent = "Sem dados.";
    } else {
      result.dice.forEach((value) => {
        const die = document.createElement("span");
        die.className = `die ${classifyRoll(value)}`;
        die.textContent = value;
        diceRow.append(die);
      });
    }

    item.append(title, diceRow);
    resultList.append(item);
  });

  resultModal.classList.remove("hidden");
}

async function publishRoll() {
  const playerName = await OBR.player.getName();
  const rollData = rollAllAttributes();

  const payload = {
    ...rollData,
    rollerName: playerName,
    timestamp: Date.now()
  };

  await OBR.room.setMetadata({
    [METADATA_KEY]: payload
  });
}

closeModal.addEventListener("click", () => {
  resultModal.classList.add("hidden");
});

rollButton.addEventListener("click", async () => {
  await publishRoll();
});

async function init() {
  renderAttributeControls();

  OBR.room.onMetadataChange((metadata) => {
    const payload = metadata[METADATA_KEY];
    if (payload) {
      renderResults(payload);
    }
  });
}

OBR.onReady(init);
