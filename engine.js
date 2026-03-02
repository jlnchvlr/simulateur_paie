let baseDonnees = {};

async function initialiserApplication() {
  try {
    const reponse = await fetch("data.json");
    if (!reponse.ok) throw new Error("Fichier introuvable.");
    baseDonnees = await reponse.json();

    // On remplit les échelons au chargement
    mettreAJourEchelons();

    // Mise à jour des échelons ET de la paie si on change le grade
    document.getElementById("input-grade").addEventListener("input", () => {
      mettreAJourEchelons();
      calculerPaie();
    });

    // Le JS écoute maintenant tous les menus de la modale ET du tableau d'en-tête
    const inputs = document.querySelectorAll(
      ".magic-modal select, .magic-modal input, .info-table select, .info-table input",
    );
    inputs.forEach((input) => input.addEventListener("input", calculerPaie));

    // Écouter la touche "Entrée" pour valider et fermer instantanément
    document.getElementById("magic-modal").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault(); // Empêche les comportements bizarres
        document.getElementById("magic-modal").close();
      }
    });

    calculerPaie();
    mettreAJourHelperRist();
    resetHelperRist();
    resetHelperExp();
    resetHelperIsqLicence();
    resetHelperIsqComplement();
    resetHelperIsqMajoration();
  } catch (erreur) {
    console.error("Erreur:", erreur);
  }
}

// TRI INTELLIGENT DES ÉCHELONS (1 à 14 puis Lettres)
function mettreAJourEchelons() {
  const grade = document.getElementById("input-grade").value;
  const selectEchelon = document.getElementById("input-echelon");
  const echelonActuel = selectEchelon.value;
  selectEchelon.innerHTML = "";

  const echelons = Object.keys(baseDonnees.grilles_icna[grade] || {});

  // Algorithme de tri : d'abord les nombres purs, puis les textes
  echelons.sort((a, b) => {
    const numA = parseInt(a);
    const numB = parseInt(b);
    const isNumA = !isNaN(numA);
    const isNumB = !isNaN(numB);

    if (isNumA && isNumB) return numA - numB;
    if (isNumA && !isNumB) return -1;
    if (!isNumA && isNumB) return 1;
    return a.localeCompare(b);
  });

  echelons.forEach((ech) => {
    const option = document.createElement("option");
    option.value = ech;
    option.textContent = ech;
    selectEchelon.appendChild(option);
  });

  if (echelons.includes(echelonActuel)) {
    selectEchelon.value = echelonActuel;
  } else {
    selectEchelon.value = echelons[0] || "";
  }
}

function mettreAJourHelperRist() {
  const niveau = document.getElementById("input-fonction").value;
  const helperText = document.getElementById("rist-helper-text");

  const details = {
    "Niveau 1":
      "ICNA en formation sans mention, IESSA 1ère affectation, TSEEAC en qualification...",
    "Niveau 2":
      "ICNA formation 1 mention (sauf Cayenne appro/CR), IESSA stagiaires > 9 mois...",
    "Niveau 3": "ICNA formation 2 mentions, Contrôleurs Listes 9 à 11...",
    "Niveau 4":
      "PC examinateurs / évaluateurs / facilitateurs FH Listes 9 à 11...",
    "Niveau 5":
      "PC Liste 8, ICNA formation 3 mentions, Chefs CA Listes 9-11...",
    "Niveau 6":
      "Chefs de tour/quart Liste 8, PC exam/éval/FH Liste 8, PC Liste 7...",
    "Niveau 7":
      "Chefs de tour/quart Liste 7, Chefs CA Liste 8, PC exam/éval/FH Liste 7...",
    "Niveau 8": "PC Listes 5 et 6, Chefs CA Liste 7, Spécialistes...",
    "Niveau 9":
      "PC Listes 1 à 4, Chefs de quart Listes 5-6, PC exam/éval/FH Listes 5-6...",
    "Niveau 10":
      "Chefs d'équipe CRNA, Adjoints chefs de salle ATFCM (ACDS), Chefs de tour L5-6, PC exam/éval/FH Listes 1 à 4, Assistants subdivision...",
    "Niveau 11":
      "Chefs de salle CRNA, Chefs d'approche CDG, Chefs de tour L1-3, Chargés de projet, Chefs de subdivision...",
    "Niveau 12":
      "Chefs de programmes, Chefs de projet, Chefs d'organismes L7-8, Chefs de division...",
    "Niveau 13":
      "Chefs de division, Chefs de pôle, Chefs d'organismes L4-6, Adjoints chefs de département...",
    "Niveau 14":
      "Chefs SNA, Chefs de département (DSNA, ENAC...), Chefs de pôles majeurs DO/DTI...",
    "Niveau 15":
      "Chefs CRNA, Chefs Roissy / Orly, Directeurs DSAC/IR, Chef SIA, CESNAC...",
  };

  if (helperText) {
    helperText.textContent =
      "Exemples de postes : " + (details[niveau] || "Fonctions non définies.");
  }
}

// --- LOGIQUE RIST INTERACTIVE ---
const ristDetails = {
  "Niveau 1":
    "ICNA en formation sans mention, IESSA 1ère affectation, TSEEAC en qualif...",
  "Niveau 2": "ICNA formation 1 mention, IESSA stagiaires > 9 mois...",
  "Niveau 3":
    "ICNA formation 2 mentions, Agents bureaux d'information, Contrôleurs Listes 9 à 11...",
  "Niveau 4":
    "PC examinateurs / évaluateurs / facilitateurs FH Listes 9 à 11...",
  "Niveau 5": "PC Liste 8, ICNA formation 3 mentions, Chefs CA Listes 9-11...",
  "Niveau 6":
    "Chefs de tour/quart Liste 8, PC exam/éval/FH Liste 8, PC Liste 7...",
  "Niveau 7":
    "Chefs de tour/quart Liste 7, Chefs CA Liste 8, PC exam/éval/FH Liste 7...",
  "Niveau 8": "PC Listes 5 et 6, Chefs CA Liste 7, Spécialistes...",
  "Niveau 9":
    "PC Listes 1 à 4, Chefs de quart Listes 5-6, PC exam/éval/FH Listes 5-6...",
  "Niveau 10":
    "Chefs d'équipe CRNA, Adjoints chefs de salle ATFCM (ACDS), Chefs de tour L5-6, PC exam/éval/FH Listes 1 à 4, Assistants subdivision...",
  "Niveau 11":
    "Chefs de salle CRNA, Chefs d'approche CDG, Chefs de tour L1-3, Chargés de projet, Chefs de subdivision...",
  "Niveau 12":
    "Chefs de programmes, Chefs de projet, Chefs organismes L7-8, Chefs de division...",
  "Niveau 13":
    "Chefs de division, Chefs de pôle, Chefs organismes L4-6, Adjoints chefs département...",
  "Niveau 14":
    "Chefs SNA, Chefs département (DSNA, ENAC...), Chefs de pôles majeurs DO/DTI...",
  "Niveau 15":
    "Chefs CRNA, Chefs Roissy / Orly, Directeurs DSAC/IR, Chef SIA, CESNAC...",
};

// --- LOGIQUE RIST EXPÉRIENCE INTERACTIVE ---
const expDetails = {
  "Niveau 1": "Personnels stagiaires",
  "Niveau 2": "TSEEAC Normal",
  "Niveau 3":
    "TSEEAC Principal / TSEEAC Normal (1e qualif + 1 an) / IESSA Normal / ICNA Normal",
  "Niveau 4":
    "ICNA Divisionnaire / TSEEAC Exceptionnel / TSEEAC Principal (2e qualif + 1 an) / IEEAC Normal / IESSA Principal",
  "Niveau 5":
    "ICNA en Chef / IESSA Div ou Chef / IEEAC Principal ou HC / RTAC, CTAC, CSTAC",
};

// --- LOGIQUE ISQ LICENCE & COMPLÉMENT ---
const isqLicenceDetails = {
  Aucune: "Licence non détenue, perdue ou suspendue.",
  "Niveau 1": "Formation LFPG/LFPO/CRNA (détenteur LOC ou CR).",
  "Niveau 2": "Personnels d'un organisme classé en liste 11.",
  "Niveau 3": "Personnels d'un organisme classé en liste 10.",
  "Niveau 4": "PC d'un organisme classé en liste 7 ou 8.",
  "Niveau 5": "PC Listes 1 à 3 / ICNA stagiaires listes 1-3 (max 30 mois).",
  "Niveau 6": "PC d'un organisme classé en liste 4 à 6.",
  "Niveau 7": "PC d'un organisme classé en liste 9.",
  "Niveau 8": "ICNA titularisés sur CDG/ORY en formation LOC ou Approche.",
  "Niveau 9": "ICNA stagiaires affectés Listes 4 à 11 (max 30 mois).",
};

const isqComplementDetails = {
  Aucun: "Aucun complément, non éligible ou suspendu.",
  "Niveau 1": "PC d'un organisme classé en liste 8.",
  "Niveau 2": "PC d'un organisme classé en liste 7.",
  "Niveau 3": "PC d'un organisme classé en liste 5 ou 6.",
  "Niveau 4": "PC d'un organisme classé en liste 4.",
  "Niveau 5": "PC d'un organisme classé en liste 3.",
  "Niveau 6": "PC d'un organisme classé en liste 2.",
  "Niveau 7": "PC d'un organisme classé en liste 1.",
  "Niveau 8": "PC d'un organisme classé en listes 9 à 11.",
};

// --- LOGIQUE ISQ MAJORATION ---
const isqMajorationDetails = {
  Aucune: "Aucune majoration / Non éligible.",
  "Niveau 1": "Personnels d'un organisme classé en listes 9 à 11.",
  "Niveau 2": "Personnels d'un organisme classé en liste 8.",
  "Niveau 3": "Personnels d'un organisme classé en liste 7.",
  "Niveau 4": "Personnels d'un organisme classé en listes 5 et 6.",
  "Niveau 5": "Personnels d'un organisme classé en liste 4.",
  "Niveau 6": "Personnels d'un organisme classé en liste 3.",
  "Niveau 7": "Personnels d'un organisme classé en liste 2.",
  "Niveau 8": "Personnels d'un organisme classé en liste 1.",
};

window.previewHelperIsqMajoration = (nv) => {
  const el = document.getElementById("isq-majoration-helper-text");
  if (el)
    el.innerHTML = `<strong>Aperçu :</strong> ${isqMajorationDetails[nv] || ""}`;
};
window.resetHelperIsqMajoration = () => {
  const nv = document.getElementById("input-isq-majoration").value;
  const el = document.getElementById("isq-majoration-helper-text");
  if (el)
    el.innerHTML = `<strong>Sélectionné :</strong> ${isqMajorationDetails[nv] || ""}`;
};
window.selectIsqMajoration = (nv) => {
  document.getElementById("input-isq-majoration").value = nv;
  document
    .querySelectorAll("#panel-rist-isq-majoration .rist-option")
    .forEach((e) => e.classList.remove("selected"));
  document
    .querySelector(
      `#panel-rist-isq-majoration .rist-option[data-value="${nv}"]`,
    )
    ?.classList.add("selected");
  resetHelperIsqMajoration();
  calculerPaie();
};

// Fonctions ISQ Licence
window.previewHelperIsqLicence = (nv) => {
  const el = document.getElementById("isq-licence-helper-text");
  if (el)
    el.innerHTML = `<strong>Aperçu :</strong> ${isqLicenceDetails[nv] || ""}`;
};
window.resetHelperIsqLicence = () => {
  const nv = document.getElementById("input-isq-licence").value;
  const el = document.getElementById("isq-licence-helper-text");
  if (el)
    el.innerHTML = `<strong>Sélectionné :</strong> ${isqLicenceDetails[nv] || ""}`;
};
window.selectIsqLicence = (nv) => {
  document.getElementById("input-isq-licence").value = nv;
  document
    .querySelectorAll("#panel-rist-isq-licence .rist-option")
    .forEach((e) => e.classList.remove("selected"));
  document
    .querySelector(`#panel-rist-isq-licence .rist-option[data-value="${nv}"]`)
    ?.classList.add("selected");
  resetHelperIsqLicence();
  calculerPaie();
};

// Fonctions ISQ Complément
window.previewHelperIsqComplement = (nv) => {
  const el = document.getElementById("isq-complement-helper-text");
  if (el)
    el.innerHTML = `<strong>Aperçu :</strong> ${isqComplementDetails[nv] || ""}`;
};
window.resetHelperIsqComplement = () => {
  const nv = document.getElementById("input-isq-complement").value;
  const el = document.getElementById("isq-complement-helper-text");
  if (el)
    el.innerHTML = `<strong>Sélectionné :</strong> ${isqComplementDetails[nv] || ""}`;
};
window.selectIsqComplement = (nv) => {
  document.getElementById("input-isq-complement").value = nv;
  document
    .querySelectorAll("#panel-rist-isq-complement .rist-option")
    .forEach((e) => e.classList.remove("selected"));
  document
    .querySelector(
      `#panel-rist-isq-complement .rist-option[data-value="${nv}"]`,
    )
    ?.classList.add("selected");
  resetHelperIsqComplement();
  calculerPaie();
};

window.previewHelperExp = function (niveau) {
  const helperText = document.getElementById("exp-helper-text");
  if (helperText)
    helperText.innerHTML = `<strong>Aperçu :</strong> ${expDetails[niveau] || ""}`;
};

window.resetHelperExp = function () {
  const niveauActuel = document.getElementById("input-experience").value;
  const helperText = document.getElementById("exp-helper-text");
  if (helperText)
    helperText.innerHTML = `<strong>Sélectionné :</strong> ${expDetails[niveauActuel] || ""}`;
};

window.selectExp = function (niveau) {
  document.getElementById("input-experience").value = niveau;
  document
    .querySelectorAll("#panel-rist-experience .rist-option")
    .forEach((el) => el.classList.remove("selected"));
  const selectedEl = document.querySelector(
    `#panel-rist-experience .rist-option[data-value="${niveau}"]`,
  );
  if (selectedEl) selectedEl.classList.add("selected");
  resetHelperExp();
  calculerPaie();
};

window.previewHelperRist = function (niveau) {
  const helperText = document.getElementById("rist-helper-text");
  if (helperText) {
    helperText.innerHTML = `<strong>Aperçu :</strong> ${ristDetails[niveau] || ""}`;
  }
};

window.resetHelperRist = function () {
  const niveauActuel = document.getElementById("input-fonction").value;
  const helperText = document.getElementById("rist-helper-text");
  if (helperText) {
    helperText.innerHTML = `<strong>Sélectionné :</strong> ${ristDetails[niveauActuel] || ""}`;
  }
};

window.selectRist = function (niveau) {
  // 1. Mettre à jour le champ caché
  document.getElementById("input-fonction").value = niveau;

  // 2. Mettre à jour le design visuel de la liste (couleur bleue sur la ligne cliquée)
  document
    .querySelectorAll(".rist-option")
    .forEach((el) => el.classList.remove("selected"));
  const selectedEl = document.querySelector(
    `.rist-option[data-value="${niveau}"]`,
  );
  if (selectedEl) selectedEl.classList.add("selected");

  // 3. Forcer l'affichage "Sélectionné"
  resetHelperRist();

  // 4. Lancer le calcul de la paie en arrière-plan
  calculerPaie();
};

function getProfilDepuisInterface() {
  // On additionne les cases de la Part Fixe cochées + le champ manuel
  let pfTotal = parseFloat(document.getElementById("pf-manuel")?.value) || 0;
  document.querySelectorAll(".pf-checkbox").forEach((cb) => {
    if (cb.checked) pfTotal += parseFloat(cb.value);
  });
  return {
    grade:
      document.getElementById("input-grade")?.value || "ING.DIV. CONT.NAV.AE",
    echelon: document.getElementById("input-echelon")?.value || "",
    residence:
      parseFloat(
        document.querySelector('input[name="ir-taux"]:checked')?.value,
      ) || 0,
    zone:
      document.querySelector('input[name="ir-zone"]:checked')?.value ||
      "Zone 1",
    taux_pas:
      parseFloat(document.getElementById("input-pas")?.value) / 100 || 0,
    points_nbi: document.getElementById("input-nbi-checkbox")?.checked ? 55 : 0,

    evenements: {
      nuits: parseInt(document.getElementById("input-nuit-n")?.value) || 0,
      soirees: parseInt(document.getElementById("input-nuit-s2")?.value) || 0,
      jours_greve: parseInt(document.getElementById("input-greve")?.value) || 0,
      jours_carence:
        parseInt(document.getElementById("input-carence")?.value) || 0,
      jours_maladie_90:
        parseInt(document.getElementById("input-maladie-90")?.value) || 0,
      jours_maladie_50:
        parseInt(document.getElementById("input-maladie-50")?.value) || 0,
      prime_performance:
        parseFloat(document.getElementById("input-perf")?.value) || 0,
      fidelisation:
        parseFloat(document.getElementById("input-fidelisation")?.value) || 0,
      geographique:
        parseFloat(document.getElementById("input-geographique")?.value) || 0,
      ott_pf: pfTotal,
      ott_pv_globale:
        parseFloat(document.getElementById("pv-globale")?.value) || 0,
      ott_pv_opt32: parseFloat(document.getElementById("pv-opt32")?.value) || 0,
    },

    primes: {
      forfait_mobilites:
        parseFloat(document.getElementById("input-fmd")?.value) || 0,
      rist_fonctions:
        baseDonnees.rist?.fonctions[
          document.getElementById("input-fonction")?.value
        ] || 0,
      rist_exper_prof:
        baseDonnees.rist?.experience[
          document.getElementById("input-experience")?.value
        ] || 0,
      rist_lic_isq:
        baseDonnees.rist?.isq_licence[
          document.getElementById("input-isq-licence")?.value
        ] || 0,
      rist_cplt_lic_isq:
        baseDonnees.rist?.isq_complement[
          document.getElementById("input-isq-complement")?.value
        ] || 0,
      rist_maj_isq:
        baseDonnees.rist?.isq_majoration[
          document.getElementById("input-isq-majoration")?.value
        ] || 0,
      ind_compensatrice_csg:
        parseFloat(document.getElementById("input-ind-csg")?.value) || 0,
    },
  };
}

function formaterMontant(montant) {
  if (
    montant === null ||
    montant === undefined ||
    montant === 0 ||
    isNaN(montant)
  )
    return "";
  return montant.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function arrondir(valeur) {
  return Math.round(valeur * 100) / 100;
}

function ouvrirModal(panelIds, titre) {
  document.getElementById("modal-title").textContent = titre;
  // On cache tous les tiroirs
  document
    .querySelectorAll(".setting-panel")
    .forEach((p) => p.classList.remove("active"));

  // Si on lui donne un tableau de plusieurs tiroirs, il les affiche tous
  if (Array.isArray(panelIds)) {
    panelIds.forEach((id) =>
      document.getElementById(id).classList.add("active"),
    );
  } else {
    document.getElementById(panelIds).classList.add("active"); // Un seul tiroir
  }

  document.getElementById("magic-modal").showModal();

  // --- NOUVEAU : AUTO-SCROLL POUR LES 5 MENUS RIST ---
  const isRistFonctions = Array.isArray(panelIds)
    ? panelIds.includes("panel-rist-fonctions")
    : panelIds === "panel-rist-fonctions";
  const isRistExperience = Array.isArray(panelIds)
    ? panelIds.includes("panel-rist-experience")
    : panelIds === "panel-rist-experience";
  const isIsqLicence = Array.isArray(panelIds)
    ? panelIds.includes("panel-rist-isq-licence")
    : panelIds === "panel-rist-isq-licence";
  const isIsqComplement = Array.isArray(panelIds)
    ? panelIds.includes("panel-rist-isq-complement")
    : panelIds === "panel-rist-isq-complement";
  const isIsqMajoration = Array.isArray(panelIds)
    ? panelIds.includes("panel-rist-isq-majoration")
    : panelIds === "panel-rist-isq-majoration";

  if (
    isRistFonctions ||
    isRistExperience ||
    isIsqLicence ||
    isIsqComplement ||
    isIsqMajoration
  ) {
    setTimeout(() => {
      let selector = "";
      if (isRistFonctions) selector = "#panel-rist-fonctions .selected";
      else if (isRistExperience) selector = "#panel-rist-experience .selected";
      else if (isIsqLicence) selector = "#panel-rist-isq-licence .selected";
      else if (isIsqComplement)
        selector = "#panel-rist-isq-complement .selected";
      else if (isIsqMajoration)
        selector = "#panel-rist-isq-majoration .selected";

      const selectedOption = document.querySelector(selector);
      if (selectedOption)
        selectedOption.scrollIntoView({ block: "center", behavior: "instant" });
    }, 15);
  }
}

// Remet les valeurs à zéro quand on clique sur la petite croix
window.effacerValeurs = function (event, inputIds) {
  event.stopPropagation();
  inputIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      if (el.tagName === "SELECT") {
        if (el.querySelector('option[value="none"]')) el.value = "none";
        else el.value = "0";
      } else if (el.type === "checkbox") el.checked = false;
      // LA CORRECTION EST ICI : on envoie bien la chaîne de texte '0'
      else el.value = "0";
    }
  });
  calculerPaie();
};

// Empêche de saisir plus de 30 jours d'absence au total (Règle du trentième DGFIP)
window.limiterAbsences = function (el) {
  // Force la valeur à 0 si l'agent tape un nombre négatif
  if (parseInt(el.value) < 0) el.value = "0";

  const greve = parseInt(document.getElementById("input-greve").value) || 0;
  const carence = parseInt(document.getElementById("input-carence").value) || 0;
  const m90 = parseInt(document.getElementById("input-maladie-90").value) || 0;
  const m50 = parseInt(document.getElementById("input-maladie-50").value) || 0;

  const total = greve + carence + m90 + m50;

  // Si on dépasse 30, on annule mathématiquement la dernière frappe
  if (total > 30) {
    const surplus = total - 30;
    el.value = (parseInt(el.value) || 0) - surplus;
  }
  // On met à jour la paie instantanément
  calculerPaie();
};

function calculerPaie() {
  const profilAgent = getProfilDepuisInterface();
  let totalAPayer = 0;
  let totalADeduire = 0;

  const indice =
    baseDonnees.grilles_icna[profilAgent.grade][profilAgent.echelon]?.indice ||
    0;
  const traitementBrut = arrondir(
    indice * baseDonnees.constantes.valeur_point_mensuel,
  );
  const montantNbi = arrondir(
    profilAgent.points_nbi * baseDonnees.constantes.valeur_point_mensuel,
  );

  const indemniteResidence =
    Math.floor(
      (traitementBrut + montantNbi) *
        baseDonnees.zones_residence[profilAgent.zone] *
        100,
    ) / 100;

  const nuit = arrondir(
    8.73 * profilAgent.evenements.nuits + 0.97 * profilAgent.evenements.soirees,
  );
  // Mise à jour de l'aperçu en direct dans le menu des nuits
  const previewNuits = document.getElementById("preview-nuits");
  if (previewNuits) previewNuits.textContent = formaterMontant(nuit);
  const joursGreve = profilAgent.evenements.jours_greve;
  const joursCarence = profilAgent.evenements.jours_carence;
  const jours90 = profilAgent.evenements.jours_maladie_90;
  const jours50 = profilAgent.evenements.jours_maladie_50;

  // Pour l'affichage texte sur la fiche (ex: "ABSENCE 5 J")
  const joursAbs = joursGreve + joursCarence + jours90 + jours50;

  // Le "poids" mathématique de la retenue en trentièmes
  // (1 jour à 90% = retenue de 0.1 jour | 1 jour à 50% = retenue de 0.5 jour)
  const joursRetenus =
    joursGreve + joursCarence + jours90 * 0.1 + jours50 * 0.5;
  const psc = Math.max(
    0,
    baseDonnees.constantes.participation_psc -
      arrondir((baseDonnees.constantes.participation_psc / 30) * joursRetenus),
  );

  // -- CALCUL DES ABSENCES AVEC LE POIDS RÉEL --
  const absenceTraitement = arrondir((traitementBrut / 30) * joursRetenus);
  const absenceNbi = arrondir((montantNbi / 30) * joursRetenus);
  const absenceResidence = arrondir((indemniteResidence / 30) * joursRetenus);

  const absRistFct = arrondir(
    (profilAgent.primes.rist_fonctions / 30) * joursRetenus,
  );
  const absRistExp = arrondir(
    (profilAgent.primes.rist_exper_prof / 30) * joursRetenus,
  );
  const absRistIsq = arrondir(
    (profilAgent.primes.rist_lic_isq / 30) * joursRetenus,
  );
  const absRistCplt = arrondir(
    (profilAgent.primes.rist_cplt_lic_isq / 30) * joursRetenus,
  );
  const absRistMaj = arrondir(
    (profilAgent.primes.rist_maj_isq / 30) * joursRetenus,
  );
  const absIndCsg = arrondir(
    (profilAgent.primes.ind_compensatrice_csg / 30) * joursRetenus,
  );

  // -- LIVE FEEDBACK : RISTOURNE PART FONCTIONS --
  const previewRistFonctions = document.getElementById(
    "preview-rist-fonctions",
  );
  if (previewRistFonctions) {
    previewRistFonctions.textContent = formaterMontant(
      profilAgent.primes.rist_fonctions,
    );
    // -- LIVE FEEDBACK : RISTOURNE PART EXPÉRIENCE --
    const previewRistExp = document.getElementById("preview-rist-experience");
    if (previewRistExp)
      previewRistExp.textContent = formaterMontant(
        profilAgent.primes.rist_exper_prof,
      );
    // -- LIVE FEEDBACK : ISQ --
    const previewIsqLic = document.getElementById("preview-rist-isq-licence");
    if (previewIsqLic)
      previewIsqLic.textContent = formaterMontant(
        profilAgent.primes.rist_lic_isq,
      );

    const previewIsqCplt = document.getElementById(
      "preview-rist-isq-complement",
    );
    if (previewIsqCplt)
      previewIsqCplt.textContent = formaterMontant(
        profilAgent.primes.rist_cplt_lic_isq,
      );
    const previewIsqMaj = document.getElementById(
      "preview-rist-isq-majoration",
    );
    if (previewIsqMaj)
      previewIsqMaj.textContent = formaterMontant(
        profilAgent.primes.rist_maj_isq,
      );
  }

  // -- BASES RÉELLES --
  const baseTraitementReel = traitementBrut - absenceTraitement;
  const baseNbiReelle = montantNbi - absenceNbi;
  const baseResidenceReelle = indemniteResidence - absenceResidence;
  const baseSoumisePC = baseTraitementReel + baseNbiReelle;

  // -- LA LIGNE QUI AVAIT DISPARU : TOTAL DES PRIMES --
  const totalPrimesSoumises =
    baseResidenceReelle +
    nuit +
    (profilAgent.primes.rist_fonctions - absRistFct) +
    (profilAgent.primes.rist_exper_prof - absRistExp) +
    (profilAgent.primes.rist_lic_isq - absRistIsq) +
    (profilAgent.primes.rist_cplt_lic_isq - absRistCplt) +
    (profilAgent.primes.rist_maj_isq - absRistMaj) +
    (profilAgent.primes.ind_compensatrice_csg - absIndCsg) +
    profilAgent.evenements.prime_performance +
    profilAgent.evenements.rist_orga +
    profilAgent.evenements.fidelisation +
    profilAgent.evenements.ott_pf +
    profilAgent.evenements.ott_pv_globale +
    profilAgent.evenements.ott_pv_opt32;

  // -- 1. CALCUL DU SFT --
  let montantSFT = 0;
  if (profilAgent.enfants === 1) {
    montantSFT = 2.29;
  } else if (profilAgent.enfants >= 2) {
    const traitementPlancher =
      449 * baseDonnees.constantes.valeur_point_mensuel;
    const traitementPlafond = 717 * baseDonnees.constantes.valeur_point_mensuel;
    let traitementReference = traitementBrut;
    if (traitementReference < traitementPlancher)
      traitementReference = traitementPlancher;
    if (traitementReference > traitementPlafond)
      traitementReference = traitementPlafond;

    if (profilAgent.enfants === 2)
      montantSFT = 10.67 + traitementReference * 0.03;
    else if (profilAgent.enfants === 3)
      montantSFT = 15.24 + traitementReference * 0.08;
    else
      montantSFT =
        15.24 +
        traitementReference * 0.08 +
        (profilAgent.enfants - 3) * (4.57 + traitementReference * 0.06);
  }
  montantSFT = arrondir(montantSFT);
  // Le SFT est également réduit selon les jours d'absence
  montantSFT = Math.max(
    0,
    montantSFT - arrondir((montantSFT / 30) * joursRetenus),
  );
  // -- 2. SCISSION RETENUE PC --
  const retenuePC = arrondir(
    baseTraitementReel * baseDonnees.constantes.taux_retenue_pc,
  );
  const retenuePcNbi = arrondir(
    baseNbiReelle * baseDonnees.constantes.taux_retenue_pc,
  );

  // -- 3. RAFP ET ISQ --
  const baseRafp = Math.min(
    totalPrimesSoumises,
    baseSoumisePC * baseDonnees.constantes.plafond_rafp,
  );
  const cotisationRafp = arrondir(baseRafp * baseDonnees.constantes.taux_rafp);

  const ristIsqReel = profilAgent.primes.rist_lic_isq - absRistIsq;
  const retenueIsq = arrondir(
    ristIsqReel * baseDonnees.constantes.taux_retenue_isq,
  );
  // Le Transfert Primes/Points est soumis à la règle du trentième
  const transfertPrimesBase = baseDonnees.constantes.transfert_primes_points;
  const transfertPrimes = Math.max(
    0,
    transfertPrimesBase - arrondir((transfertPrimesBase / 30) * joursRetenus),
  );

  // -- 4. CSG / CRDS --
  const elementsSoumisCsg =
    baseSoumisePC + totalPrimesSoumises + psc + montantSFT;
  const deductionsBaseCsg = transfertPrimes + retenueIsq;
  // La base de la CSG ne peut pas être négative (on la bloque à 0 au minimum)
  const baseCsgCrdsExacte =
    Math.max(0, elementsSoumisCsg - deductionsBaseCsg) *
    baseDonnees.constantes.assiette_csg_crds;

  const csgDeductible = arrondir(
    baseCsgCrdsExacte * baseDonnees.constantes.taux_csg_deductible,
  );
  const csgNonDeductible = arrondir(
    baseCsgCrdsExacte * baseDonnees.constantes.taux_csg_non_deductible,
  );
  const crds = arrondir(baseCsgCrdsExacte * baseDonnees.constantes.taux_crds);

  // -- 5. CHARGES PATRONALES --
  const patAllocFam = arrondir(
    baseSoumisePC * baseDonnees.taux_patronaux.alloc_familiale,
  );
  const patAfMajor = arrondir(
    baseSoumisePC * baseDonnees.taux_patronaux.af_majoration,
  );
  const patFnal = arrondir(baseSoumisePC * baseDonnees.taux_patronaux.fnal);
  const patCsa = arrondir(baseSoumisePC * baseDonnees.taux_patronaux.csa);
  const patMaladie = arrondir(
    baseSoumisePC * baseDonnees.taux_patronaux.maladie,
  );
  const patPensions = arrondir(
    baseSoumisePC * baseDonnees.taux_patronaux.pensions_civiles,
  );
  const patAti = arrondir(baseSoumisePC * baseDonnees.taux_patronaux.ati);
  const patMobilite = arrondir(
    baseSoumisePC * baseDonnees.taux_patronaux.versement_mobilite,
  );
  const patRafp = cotisationRafp;
  const totalPatronal =
    patAllocFam +
    patAfMajor +
    patFnal +
    patCsa +
    patMaladie +
    patPensions +
    patAti +
    patMobilite +
    patRafp;
  document.getElementById("ui-indice").textContent = "0" + (indice || "000");

  const tbody = document.getElementById("lignes-paie");
  tbody.innerHTML = "";

  function ajouterLigne(
    code,
    libelle,
    aPayer,
    aDeduire,
    pourInfo,
    inputsAReset = null,
  ) {
    if (aPayer) totalAPayer += aPayer;
    if (aDeduire) totalADeduire += aDeduire;

    let extraClass =
      code === "011100" || code === "011300" ? " font-large" : "";
    let euroSymbole =
      aPayer || aDeduire || pourInfo
        ? `<span style="float: right; font-weight: normal; color: #555;">€</span>`
        : "";

    const tr = document.createElement("tr");

    let estCliquable = false;
    let cibles = null;
    let titreModal = "";

    if (code === "102000") {
      estCliquable = true;
      cibles = "panel-residence";
      titreModal = "Zone de Résidence";
    } else if (code === "201958") {
      estCliquable = true;
      cibles = "panel-rist-fonctions";
      titreModal = "Ristourne Part Fonctions";
    } else if (code === "201959") {
      estCliquable = true;
      cibles = "panel-rist-experience";
      titreModal = "Ristourne Part Expérience";
    } else if (code === "201960") {
      estCliquable = true;
      cibles = "panel-rist-isq-licence";
      titreModal = "Ristourne Part LIC-ISQ";
    } else if (code === "201961") {
      estCliquable = true;
      cibles = "panel-rist-isq-complement";
      titreModal = "Ristourne CPLT Part LIC-ISQ";
    } else if (code === "201962") {
      estCliquable = true;
      cibles = "panel-rist-isq-majoration";
      titreModal = "Majoration Complément ISQ";
    } else if (code && code.startsWith("2019")) {
      estCliquable = true;
      cibles = "panel-rist";
      titreModal = "Primes RIST & Qualifications ISQ";
    } else if (code === "200176") {
      estCliquable = true;
      cibles = "panel-nuits";
      titreModal = "Travail de Nuit & Soirées";
    } else if (
      ["200041", "202485", "202558", "203001", "203002"].includes(code)
    ) {
      estCliquable = true;
      cibles = "panel-primes";
      titreModal = "Primes Exceptionnelles";
    } else if (code === "604958" || code === "604959") {
      estCliquable = true;
      cibles = "panel-absences";
      titreModal = "Absences et Carence";
    } else if (code === "558000" || libelle.includes("TAUX PERSONNALISE")) {
      estCliquable = true;
      cibles = "panel-impots";
      titreModal = "Prélèvement à la Source";
    } else if (code === "202206") {
      estCliquable = true;
      cibles = "panel-csg";
      titreModal = "Indemnité Compensatrice CSG";
    } else if (code === "200041") {
      estCliquable = true;
      cibles = "panel-fmd";
      titreModal = "Forfait Mobilités";
    } else if (code === "202558" || code === "202559" || code === "202560") {
      estCliquable = true;
      cibles = "panel-ott";
      titreModal = "Organisation du Travail (Protocole)";
    } else if (["202485", "203001", "203002"].includes(code)) {
      estCliquable = true;
      cibles = "panel-primes";
      titreModal = "Primes Exceptionnelles";
    }

    if (estCliquable) {
      tr.className = "clickable-row";
      tr.title = "Cliquez pour modifier";
      tr.onclick = () => ouvrirModal(cibles, titreModal);
    }

    // --- LA CROIX MAGIQUE POUR EFFACER ---
    let croixEffacer = "";
    if (inputsAReset) {
      const idsStr = JSON.stringify(inputsAReset).replace(/"/g, "'");
      croixEffacer = `<span class="delete-btn" title="Retirer cet élément" onclick="window.effacerValeurs(event, ${idsStr})">✖</span>`;
    }

    tr.innerHTML = `
            <td class="col-code">${code}</td>
            <td class="col-libelle label${extraClass}">
                <span>${libelle}</span>${croixEffacer} ${euroSymbole}
            </td>
            <td class="col-amount">${formaterMontant(aPayer)}</td>
            <td class="col-amount">${formaterMontant(aDeduire)}</td>
            <td class="col-amount">${formaterMontant(pourInfo)}</td>
        `;
    tbody.appendChild(tr);
  }

  // -- LIGNE D'INFORMATION ABSENCE (Tout en haut) --
  if (joursAbs > 0) {
    const totalAbsenceDeduction =
      absenceTraitement +
      absenceNbi +
      absenceResidence +
      absRistFct +
      absRistExp +
      absRistIsq +
      absRistCplt +
      absRistMaj +
      absIndCsg;

    // LA CROIX EST MAINTENANT ICI (à la fin de la ligne)
    ajouterLigne(
      "604958",
      `SERVICE NON FAIT / ABSENCE (${joursAbs} J)`,
      null,
      null,
      totalAbsenceDeduction,
      ["input-greve", "input-carence", "input-maladie-90", "input-maladie-50"],
    );
  }

  ajouterLigne("101000", "TRAITEMENT BRUT", traitementBrut, null, null);

  if (montantNbi > 0) {
    ajouterLigne("101070", "TRAITEMENT BRUT N.B.I.", montantNbi, null, null);
    if (joursAbs > 0)
      ajouterLigne(
        "101070",
        `N.B.I. (ABS. ${joursAbs} J)`,
        -absenceNbi,
        null,
        null,
      );
  }

  if (montantSFT > 0)
    ajouterLigne(
      "200200",
      "SUPPLEMENT FAMILIAL DE TRAITEMENT",
      montantSFT,
      null,
      null,
    );

  ajouterLigne("101050", "RETENUE PC", null, retenuePC, null);
  if (montantNbi > 0)
    ajouterLigne("101080", "RET P.C. SUR N.B.I.", null, retenuePcNbi, null);

  ajouterLigne(
    "102000",
    "INDEMNITE DE RESIDENCE",
    indemniteResidence,
    null,
    null,
  );

  // -- LIGNE DES NUITS ET SOIRÉES --
  if (nuit > 0) {
    ajouterLigne("200176", "IND. TRAVAIL DE NUIT", nuit, null, null, [
      "input-nuit-n",
      "input-nuit-s2",
    ]);
  }

  if (profilAgent.primes.forfait_mobilites > 0) {
    ajouterLigne(
      "200041",
      "FORF. MOBILITES DURABLES",
      profilAgent.primes.forfait_mobilites,
      null,
      null,
      ["input-fmd"],
    );
  }

  ajouterLigne(
    "201958",
    "RIST PART FONCTIONS",
    profilAgent.primes.rist_fonctions,
    null,
    null,
  );
  if (joursAbs > 0)
    ajouterLigne(
      "201958",
      `RIST PART FONCTIONS (ABS. ${joursAbs} J)`,
      -absRistFct,
      null,
      null,
    );

  ajouterLigne(
    "201959",
    "RIST PART EXPER. PROF.",
    profilAgent.primes.rist_exper_prof,
    null,
    null,
  );
  if (joursAbs > 0)
    ajouterLigne(
      "201959",
      `RIST PART EXPER. PROF. (ABS. ${joursAbs} J)`,
      -absRistExp,
      null,
      null,
    );

  ajouterLigne(
    "201960",
    "RIST PART LIC-ISQ (ICNA)",
    profilAgent.primes.rist_lic_isq,
    null,
    null,
  );
  if (joursAbs > 0)
    ajouterLigne(
      "201960",
      `RIST PART LIC-ISQ (ABS. ${joursAbs} J)`,
      -absRistIsq,
      null,
      null,
    );

  ajouterLigne(
    "201961",
    "RIST CPLT PART LIC-ISQ",
    profilAgent.primes.rist_cplt_lic_isq,
    null,
    null,
  );
  if (joursAbs > 0)
    ajouterLigne(
      "201961",
      `RIST CPLT PART LIC-ISQ (ABS. ${joursAbs} J)`,
      -absRistCplt,
      null,
      null,
    );

  // On affiche toujours la ligne, même si le montant est à 0 (pour pouvoir cliquer dessus !)
  ajouterLigne(
    "201962",
    "MAJORATION CPLT ISQ",
    profilAgent.primes.rist_maj_isq,
    null,
    null,
  );
  if (joursAbs > 0) {
    ajouterLigne(
      "201962",
      `MAJORATION CPLT ISQ (ABS. ${joursAbs} J)`,
      -absRistMaj,
      null,
      null,
    );
  }

  ajouterLigne(
    "202206",
    "IND. COMPENSATRICE CSG",
    profilAgent.primes.ind_compensatrice_csg,
    null,
    null,
  );
  if (joursAbs > 0)
    ajouterLigne(
      "202206",
      `IND. COMPENSATRICE CSG (ABS. ${joursAbs} J)`,
      -absIndCsg,
      null,
      null,
    );

  ajouterLigne("202354", "PARTICIPATION A LA PSC", psc, null, null);

  if (profilAgent.evenements.prime_performance > 0)
    ajouterLigne(
      "202485",
      "PR. PARTAGE PERFORMANCE",
      profilAgent.evenements.prime_performance,
      null,
      null,
      ["input-perf"],
    );
  if (profilAgent.evenements.fidelisation > 0)
    ajouterLigne(
      "203001",
      "PRIME DE FIDELISATION TERR.",
      profilAgent.evenements.fidelisation,
      null,
      null,
      ["input-fidelisation"],
    );
  if (profilAgent.evenements.geographique > 0)
    ajouterLigne(
      "203002",
      "PRIME ATTRACTIVITE GEOGRAPHIQUE",
      profilAgent.evenements.geographique,
      null,
      null,
      ["input-geographique"],
    );

  if (profilAgent.evenements.ott_pf > 0) {
    ajouterLigne(
      "202559",
      "RIST ORGA TEMPS TRAVAIL (PF)",
      profilAgent.evenements.ott_pf,
      null,
      null,
      [
        "pf-manuel",
        "pf-opt1-l16",
        "pf-opt1-cdg",
        "pf-opt1-l711",
        "pf-opt1-l911",
        "pf-opt1-plus",
        "pf-opt2",
        "pf-opt4",
      ],
    );
  }
  if (profilAgent.evenements.ott_pv_globale > 0) {
    ajouterLigne(
      "202558",
      "RIST ORGA TEMPS TRAVAIL (PV)",
      profilAgent.evenements.ott_pv_globale,
      null,
      null,
      ["pv-globale"],
    );
  }
  if (profilAgent.evenements.ott_pv_opt32 > 0) {
    ajouterLigne(
      "202560",
      "RIST ORGA TEMPS TRAVAIL (PV OPT 3-2)",
      profilAgent.evenements.ott_pv_opt32,
      null,
      null,
      ["pv-opt32"],
    );
  }

  // Live feedback du tiroir OTT
  const previewOttPf = document.getElementById("preview-ott-pf");
  if (previewOttPf)
    previewOttPf.textContent = formaterMontant(profilAgent.evenements.ott_pf);
  const previewOttPv = document.getElementById("preview-ott-pv");
  if (previewOttPv)
    previewOttPv.textContent = formaterMontant(
      profilAgent.evenements.ott_pv_globale +
        profilAgent.evenements.ott_pv_opt32,
    );

  // -- LIGNE PF OPTIONS ET LIVE FEEDBACK --
  const previewPf = document.getElementById("preview-pf");
  if (previewPf)
    previewPf.textContent = formaterMontant(profilAgent.evenements.pf_options);

  ajouterLigne("401201", "C.S.G. NON DEDUCTIBLE", null, csgNonDeductible, null);
  ajouterLigne("401301", "C.S.G. DEDUCTIBLE", null, csgDeductible, null);
  ajouterLigne("401501", "C.R.D.S.", null, crds, null);

  ajouterLigne("403301", "COTIS PATRON. ALLOC FAMIL", null, null, patAllocFam);
  ajouterLigne("403397", "COT PAT AF MAJORATION", null, null, patAfMajor);
  ajouterLigne("403501", "COT PAT FNAL DEPLAFONNEE", null, null, patFnal);
  ajouterLigne("403801", "CONT SOLIDARITE AUTONOMIE", null, null, patCsa);
  ajouterLigne("404001", "COT PAT MALADIE DEPLAFON", null, null, patMaladie);
  ajouterLigne("411050", "CONTRIB.PC", null, null, patPensions);
  ajouterLigne("411058", "CONTRIBUTION ATI", null, null, patAti);

  ajouterLigne("501080", "COT SAL RAFP", null, cotisationRafp, null);
  ajouterLigne("501180", "COT PAT RAFP", null, null, patRafp);
  ajouterLigne("554500", "COT PAT VST MOBILITE", null, null, patMobilite);

  if (joursAbs > 0) {
    ajouterLigne(
      "604958",
      `PREC. CARENCE REM. PR. (${joursAbs} J)`,
      null,
      absenceTraitement,
      null,
    );
    ajouterLigne(
      "604959",
      `PREC. CARENCE IND. RESID. (${joursAbs} J)`,
      null,
      absenceResidence,
      null,
    );
  }

  ajouterLigne(
    "604970",
    "TRANSFERT PRIMES / POINTS",
    null,
    transfertPrimes,
    null,
  );
  ajouterLigne("751095", "24,6% ISQ", null, retenueIsq, null);

  const netAPayerAvantImpot = arrondir(totalAPayer - totalADeduire);
  ajouterLigne("", "", null, null, null);
  ajouterLigne(
    "011100",
    "NET A PAYER AVANT IMPOT SUR LE REVENU",
    null,
    null,
    netAPayerAvantImpot,
  );

  const netSocial = arrondir(
    netAPayerAvantImpot -
      profilAgent.primes.forfait_mobilites -
      psc +
      retenueIsq,
  );
  ajouterLigne("011300", "MONTANT NET SOCIAL", null, null, netSocial);

  const netImposable =
    netAPayerAvantImpot +
    csgNonDeductible +
    crds -
    profilAgent.primes.forfait_mobilites;
  // Le salaire net imposable ne peut pas être négatif
  let netImposableFinal = Math.max(0, netImposable); // (Remplace netImposable par le nom de ta variable si besoin)
  const impotSource = arrondir(netImposableFinal * profilAgent.taux_pas);

  ajouterLigne(
    "558000",
    `IMPOT SUR LE REVENU PRELEVE A LA SOURCE`,
    null,
    impotSource,
    null,
  );
  ajouterLigne(
    "",
    `(TAUX PERSONNALISE ${formaterMontant(profilAgent.taux_pas * 100)}%)`,
    null,
    null,
    null,
  );

  // BOUTON AJOUTER (Pour ce qui n'apparaît pas encore, ex: Nuits, Heures Sup)
  const trAjout = document.createElement("tr");
  trAjout.className = "add-row";
  trAjout.innerHTML = `<td colspan="5"> + AJOUTER OU MODIFIER UN ÉLÉMENT VARIABLE (Nuits, Absences, Mobilité...) </td>`;
  // Ouvre 3 tiroirs d'un coup pour offrir tous les choix !
  trAjout.onclick = () =>
    ouvrirModal("panel-menu-ajout", "Que voulez-vous ajouter ?");
  tbody.appendChild(trAjout);

  const trRessort = document.createElement("tr");
  trRessort.style.backgroundColor = "white";
  trRessort.innerHTML = `
        <td style="border-right: 1px solid var(--dgfip-light); height: 100%;"></td>
        <td style="border-right: 1px solid var(--dgfip-light);"></td>
        <td style="border-right: 1px solid var(--dgfip-light);"></td>
        <td style="border-right: 1px solid var(--dgfip-light);"></td>
        <td></td>
    `;
  tbody.appendChild(trRessort);

  // On empêche le net d'être négatif
  // On empêche le net d'être négatif
  const netFinal = Math.max(0, arrondir(netAPayerAvantImpot - impotSource));
  const coutTotalEmployeur = arrondir(
    totalAPayer + totalPatronal - transfertPrimes,
  );
  const baseSS = baseTraitementReel;

  document.getElementById("ui-total-a-payer").textContent = formaterMontant(
    arrondir(totalAPayer),
  );
  document.getElementById("ui-total-a-deduire").textContent = formaterMontant(
    arrondir(totalADeduire),
  );
  document.getElementById("ui-charges-patronales").textContent =
    formaterMontant(totalPatronal);
  document.getElementById("ui-cout-employeur").textContent =
    formaterMontant(coutTotalEmployeur);

  // On force l'affichage à "0,00" si le net est à zéro
  document.getElementById("ui-net-a-payer").textContent =
    (netFinal === 0 ? "0,00" : formaterMontant(netFinal)) + " €";

  // On utilise un nouveau nom (netImposableAffichage) pour éviter le conflit avec plus haut !
  const netImposableAffichage = Math.max(0, netImposable);
  document.getElementById("ui-net-imposable").textContent =
    netImposableAffichage === 0
      ? "0,00"
      : formaterMontant(netImposableAffichage);
}
window.onload = initialiserApplication;
