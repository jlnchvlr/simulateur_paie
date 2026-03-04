// =============================================================================
// SIMULATEUR DE PAIE ICNA
// Moteur de calcul principal
//
// Architecture :
//   1.  État & configuration globale
//   2.  Index de recherche
//   3.  Utilitaires génériques
//   4.  Moteur de recherche
//   5.  Menus interactifs RIST / ISQ (dictionnaires + factory)
//   6.  Interface utilisateur (modales, échelons, absences)
//   7.  Extraction du profil depuis le formulaire
//   8.  Calcul de la paie (pur, sans DOM)
//   9.  Rendu de la fiche de paie (DOM)
//  10.  Point d'entrée du calcul
//  11.  Initialisation de l'application
//  12.  Visite guidée (Driver.js)
// =============================================================================

// =============================================================================
// 1. ÉTAT & CONFIGURATION GLOBALE
// =============================================================================

/** @type {Object} Base de données chargée depuis data.json */
let baseDonnees = {};

/** @type {boolean} Vrai si la visite guidée est en cours d'exécution */
window.isTourActive = false;

/** @type {number|undefined} Étape de la visite sauvegardée lors de l'ouverture d'une modale */
window.tourSavedStep = undefined;

/**
 * Constantes de calcul "figées" par textes réglementaires.
 * Séparées de data.json car elles ne sont pas configurables par l'utilisateur.
 * @constant {Object}
 */
const CALC = {
  // Indemnités horaires de travail de nuit (décret n°2002-828)
  TAUX_NUIT: 8.73, // €/nuit travaillée (code 200176)
  TAUX_SOIREE: 0.97, // €/soirée travaillée S2 (code 200176)

  // Nouvelle Bonification Indiciaire
  POINTS_NBI: 55, // Points d'indice accordés si NBI cochée

  // Supplément Familial de Traitement (SFT) — barème fonctionnaire public
  SFT_1_ENF_FIXE: 2.29, // Montant fixe pour 1 enfant (€)
  SFT_2_BASE: 10.67, // Part fixe pour 2 enfants (€)
  SFT_2_TAUX: 0.03, // Part proportionnelle au traitement pour 2 enfants
  SFT_3_BASE: 15.24, // Part fixe pour 3 enfants (€)
  SFT_3_TAUX: 0.08, // Part proportionnelle au traitement pour 3 enfants
  SFT_SUP_BASE: 4.57, // Part fixe par enfant supplémentaire (€)
  SFT_SUP_TAUX: 0.06, // Part proportionnelle par enfant supplémentaire
  SFT_IND_PLANCHER: 449, // Indice plancher pour le traitement de référence SFT
  SFT_IND_PLAFOND: 717, // Indice plafond pour le traitement de référence SFT
};

// =============================================================================
// 1b. PERSISTANCE DU PROFIL (localStorage)
// =============================================================================

const CLE_STOCKAGE = "icna_profil_v1";

/**
 * Liste des champs du profil permanent à persister.
 * Les événements mensuels (nuits, absences, OTT...) sont exclus volontairement :
 * ils sont ressaisis chaque mois.
 */
const CHAMPS_PROFIL = [
  // Identité / grille
  { id: "input-grade", type: "select" },
  { id: "input-echelon", type: "select" },
  { id: "input-enfants", type: "select" },
  { id: "input-nbi-checkbox", type: "checkbox" },
  // Taux et indemnités fixes
  { id: "input-pas", type: "value" },
  { id: "input-ind-csg", type: "value" },
  // Zone de résidence (radio)
  { id: "ir-zone", type: "radio", name: "ir-zone" },
  // Sélections RIST / ISQ (inputs hidden)
  { id: "input-fonction", type: "value" },
  { id: "input-experience", type: "value" },
  { id: "input-isq-licence", type: "value" },
  { id: "input-isq-complement", type: "value" },
  { id: "input-isq-majoration", type: "value" },
  // Primes mensuelles récurrentes
  { id: "input-attractivite", type: "select" },
  { id: "input-fidelisation", type: "select" },
  { id: "input-inflation", type: "value" },
  // PSC (cases à cocher cumulables)
  { id: "psc-15", type: "checkbox" },
  { id: "psc-7", type: "checkbox" },
  { id: "psc-5", type: "checkbox" },
  // OTT Part Fixe (configuration du centre — stable d'un mois à l'autre)
  { id: "pf-opt1-l16", type: "checkbox" },
  { id: "pf-opt1-cdg", type: "checkbox" },
  { id: "pf-opt1-l711", type: "checkbox" },
  { id: "pf-opt1-l911", type: "checkbox" },
  { id: "pf-opt1-plus-n1", type: "checkbox" },
  { id: "pf-opt1-plus-n2", type: "checkbox" },
  { id: "pf-opt2-1", type: "checkbox" },
  { id: "pf-opt2-2", type: "checkbox" },
  { id: "pf-opt2-bis", type: "checkbox" },
  { id: "pf-opt4", type: "checkbox" },
  { id: "pf-opt1-enac", type: "checkbox" },
  { id: "pf-opt1-plus-enac", type: "checkbox" },
  { id: "pf-manuel", type: "value" },
];

/**
 * Lit tous les champs du profil permanent et les sauvegarde dans localStorage.
 * Appelée automatiquement à chaque recalcul.
 */
function sauvegarderProfil() {
  const profil = {};
  CHAMPS_PROFIL.forEach(({ id, type, name }) => {
    if (type === "radio") {
      const checked = document.querySelector(`input[name="${name}"]:checked`);
      if (checked) profil[id] = checked.value;
    } else {
      const el = document.getElementById(id);
      if (!el) return;
      profil[id] = type === "checkbox" ? el.checked : el.value;
    }
  });
  try {
    localStorage.setItem(CLE_STOCKAGE, JSON.stringify(profil));
  } catch (e) {
    console.warn("Sauvegarde profil impossible :", e);
  }
}

/**
 * Restaure les champs du formulaire depuis le profil sauvegardé.
 * Doit être appelée APRÈS le peuplement des selects dynamiques (attractivité,
 * fidélisation, RIST) pour que les options existent avant d'être sélectionnées.
 *
 * @returns {boolean} true si un profil a été restauré, false sinon
 */
function restaurerProfil() {
  let profil;
  try {
    const raw = localStorage.getItem(CLE_STOCKAGE);
    if (!raw) return false;
    profil = JSON.parse(raw);
  } catch (e) {
    console.warn("Restauration profil impossible :", e);
    return false;
  }

  CHAMPS_PROFIL.forEach(({ id, type, name }) => {
    if (type === "radio") {
      const valeur = profil[id];
      if (valeur) {
        const radio = document.querySelector(`input[name="${name}"][value="${valeur}"]`);
        if (radio) radio.checked = true;
      }
    } else {
      const el = document.getElementById(id);
      if (!el || profil[id] === undefined) return;
      if (type === "checkbox") {
        el.checked = profil[id];
      } else {
        el.value = profil[id];
      }
    }
  });

  // Resynchroniser les classes "selected" sur les listes RIST/ISQ
  CONFIGS_RIST.forEach((cfg) => {
    const valeur = document.getElementById(cfg.inputId)?.value;
    document.querySelectorAll(`#${cfg.panelId} .rist-option`).forEach((div) => {
      div.classList.toggle("selected", div.dataset.value === valeur);
    });
  });

  return true;
}

/**
 * Efface le profil sauvegardé et recharge la page.
 * Exposée sur `window` car appelable depuis un bouton HTML.
 */
window.effacerProfil = function () {
  localStorage.removeItem(CLE_STOCKAGE);
  location.reload();
};

// =============================================================================
// 2. INDEX DE RECHERCHE
// =============================================================================

/**
 * @typedef {Object} EntreeIndex
 * @property {string}   titre    - Libellé affiché dans les résultats
 * @property {string[]} motsCles - Mots-clés associés (recherche inclusive)
 * @property {string}   cible    - ID du panneau à activer dans la modale
 */

/** @type {EntreeIndex[]} */
const INDEX_RECHERCHE = [
  { titre: "🌙 Nuits & Soirées", motsCles: ["nuit", "soirée", "soiree", "majoration", "horaire"], cible: "panel-nuits" },
  { titre: "📍 Attractivité Géographique", motsCles: ["attractivite", "majo", "geo", "201987", "201986", "nord", "cdg"], cible: "panel-attractivite" },
  { titre: "⏳ Prime de Fidélisation", motsCles: ["fidelisation", "pft", "palier", "engagement", "duree"], cible: "panel-fidelisation" },
  { titre: "🤒 Jours d'absence (Grève, Maladie)", motsCles: ["grève", "greve", "maladie", "carence", "absence", "arrêt", "arret", "snf", "1/30", "jour"], cible: "panel-absences" },
  { titre: "🚲 Forfait Mobilités Durables", motsCles: ["vélo", "velo", "fmd", "mobilité", "mobilite", "covoiturage", "voiture", "transport"], cible: "panel-fmd" },
  { titre: "📊 Protocole (OTT)", motsCles: ["ott", "protocole", "part fixe", "part variable", "pf", "pv", "option", "enac", "cdg", "liste"], cible: "panel-ott" },
  { titre: "🛡️ Participation PSC (Mutuelle)", motsCles: ["psc", "mutuelle", "santé", "sante", "prévoyance", "prevoyance", "alan", "mgas", "aide"], cible: "panel-psc" },
  { titre: "💰 Partage Performance (PPP)", motsCles: ["prime", "ppp", "performance", "partage", "exceptionnelle"], cible: "panel-primes" },
  { titre: "📈 Indemnité Inflation", motsCles: ["inflation", "pouvoir", "achat", "gpa", "indemnité"], cible: "panel-inflation" },
  { titre: "Impôt sur le Revenu (PAS)", motsCles: ["impôt", "impot", "pas", "source", "taux", "prélèvement", "prelevement", "personnalisé"], cible: "panel-impots" },
  { titre: "Indemnité Compensatrice CSG", motsCles: ["csg", "indemnité", "indemnite", "compensatrice"], cible: "panel-csg" },
  { titre: "Zone de Résidence (IR)", motsCles: ["ir", "résidence", "residence", "zone", "indemnité"], cible: "panel-residence" },
  { titre: "RIST - Part Fonctions", motsCles: ["rist", "fonctions", "part", "prime", "niveau"], cible: "panel-rist-fonctions" },
  { titre: "RIST - Part Expérience", motsCles: ["rist", "expérience", "experience", "exp"], cible: "panel-rist-experience" },
  { titre: "Licence ISQ", motsCles: ["isq", "licence", "icna"], cible: "panel-rist-isq-licence" },
  { titre: "Complément ISQ", motsCles: ["isq", "complément", "complement", "cplt"], cible: "panel-rist-isq-complement" },
  { titre: "Majoration ISQ", motsCles: ["majoration", "isq"], cible: "panel-rist-isq-majoration" },
];

// =============================================================================
// 3. UTILITAIRES GÉNÉRIQUES
// =============================================================================

/**
 * Normalise un texte pour la recherche : passage en minuscules et suppression des diacritiques.
 * @param {string} texte
 * @returns {string}
 */
function normaliserTexte(texte) {
  return texte
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Formate un montant en euros au format français (ex. : "1 234,56").
 * Retourne une chaîne vide pour les valeurs absentes, nulles ou NaN.
 * @param {number|null|undefined} montant
 * @returns {string}
 */
function formaterMontant(montant) {
  if (montant === null || montant === undefined || montant === 0 || isNaN(montant)) return "";
  return montant.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Arrondit à 2 décimales (règle du demi supérieur).
 * @param {number} valeur
 * @returns {number}
 */
function arrondir(valeur) {
  return Math.round(valeur * 100) / 100;
}

/**
 * Lit la valeur d'un champ DOM en `float`. Retourne 0 si l'élément est absent ou vide.
 * @param {string} id
 * @returns {number}
 */
function lireFloat(id) {
  return parseFloat(document.getElementById(id)?.value) || 0;
}

/**
 * Lit la valeur d'un champ DOM en `int`. Retourne 0 si l'élément est absent ou vide.
 * @param {string} id
 * @returns {number}
 */
function lireInt(id) {
  return parseInt(document.getElementById(id)?.value) || 0;
}

/**
 * Injecte un montant formaté dans un élément d'aperçu ("preview").
 * Sans effet si l'élément est introuvable.
 * @param {string} id
 * @param {number} montant
 */
function majPreview(id, montant) {
  const el = document.getElementById(id);
  if (el) el.textContent = formaterMontant(montant);
}

// =============================================================================
// 4. MOTEUR DE RECHERCHE
// =============================================================================

/**
 * Recherche dans l'index les entrées dont le titre ou les mots-clés contiennent la requête.
 * La comparaison ignore la casse et les accents.
 * Exposée sur `window` car appelée depuis le spotlight (Ctrl+K).
 *
 * @param {string} requete - Texte saisi par l'utilisateur
 * @returns {EntreeIndex[]}
 */
window.rechercherElement = function (requete) {
  if (!requete || requete.trim() === "") return [];
  const q = normaliserTexte(requete.trim());
  return INDEX_RECHERCHE.filter((item) => normaliserTexte(item.titre).includes(q) || item.motsCles.some((mot) => normaliserTexte(mot).includes(q)));
};

/**
 * Génère et injecte les boutons de résultats dans un conteneur DOM.
 * Factorisé pour être partagé entre le menu d'ajout et le spotlight (Ctrl+K).
 *
 * @param {HTMLElement}              conteneur - Élément cible pour l'injection
 * @param {EntreeIndex[]}            resultats - Entrées à afficher
 * @param {string}                   requete   - Texte saisi (pour le message "aucun résultat")
 * @param {function(EntreeIndex):void} onSelect - Callback déclenché au clic sur un résultat
 */
function afficherResultatsRecherche(conteneur, resultats, requete, onSelect) {
  conteneur.innerHTML = "";
  if (resultats.length === 0) {
    conteneur.innerHTML = `<div class="resultat-vide">Aucun élément trouvé pour "${requete}" 🕵️‍♂️</div>`;
    return;
  }
  resultats.forEach((res) => {
    const btn = document.createElement("button");
    btn.className = "resultat-item";
    btn.innerHTML = `<span>${res.titre}</span> <span style="color:#aaa;font-size:12px;">➔</span>`;
    btn.onclick = () => onSelect(res);
    conteneur.appendChild(btn);
  });
}

// =============================================================================
// 5. MENUS INTERACTIFS RIST / ISQ
// =============================================================================
/**
 * Factory : crée et enregistre sur `window` les 3 fonctions nécessaires à un menu interactif.
 * Ces fonctions DOIVENT être sur `window` car appelées via `onclick="..."` dans le HTML.
 *
 * Fonctions générées :
 * - `window.previewHelper{nom}(valeur)` → aperçu au survol d'une option
 * - `window.resetHelper{nom}()`         → affiche la valeur actuellement sélectionnée
 * - `window.select{nom}(valeur)`        → sélectionne une valeur, met à jour l'input et recalcule
 *
 * @param {string}                  nom      - Suffixe identifiant le menu (ex. "Rist", "IsqLicence")
 * @param {string}                  inputId  - ID de l'`<input>` ou `<select>` portant la valeur sélectionnée
 * @param {string}                  helperId - ID de l'élément affichant la description contextuelle
 * @param {string}                  panelId  - ID du panneau contenant les `.rist-option`
 * @param {Object.<string, string>} details  - Dictionnaire valeur → description textuelle
 */
function creerMenuInteractif(nom, inputId, helperId, panelId, details) {
  const getInput = () => document.getElementById(inputId);
  const getHelper = () => document.getElementById(helperId);
  const setHelper = (html) => {
    const el = getHelper();
    if (el) el.innerHTML = html;
  };

  window[`previewHelper${nom}`] = (valeur) => setHelper(`<strong>Aperçu :</strong> ${details[valeur] || ""}`);

  window[`resetHelper${nom}`] = () => setHelper(`<strong>Sélectionné :</strong> ${details[getInput()?.value] || ""}`);

  window[`select${nom}`] = (valeur) => {
    getInput().value = valeur;
    document.querySelectorAll(`#${panelId} .rist-option`).forEach((el) => el.classList.remove("selected"));
    document.querySelector(`#${panelId} .rist-option[data-value="${valeur}"]`)?.classList.add("selected");
    window[`resetHelper${nom}`]();
    calculerPaie();
  };
}
/**
 * Descriptions contextuelles de chaque niveau de la part Fonctions RIST.
 * Affichées dans le panneau de sélection au survol et à la sélection.
 * @type {Object.<string, string>}
 */
/**
 * Configuration des 5 menus RIST / ISQ.
 * Source unique de vérité : toute modification ici suffit pour ajouter ou supprimer un menu.
 * @type {Array<{nom:string, inputId:string, helperId:string, panelId:string, previewId:string, dataKey:string, placeholder:string}>}
 */
const CONFIGS_RIST = [
  {
    nom: "Rist",
    inputId: "input-fonction",
    helperId: "rist-helper-text",
    panelId: "panel-rist-fonctions",
    previewId: "preview-rist-fonctions",
    dataKey: "fonctions",
    placeholder: "Sélectionnez un niveau pour voir les fonctions...",
  },
  {
    nom: "Exp",
    inputId: "input-experience",
    helperId: "exp-helper-text",
    panelId: "panel-rist-experience",
    previewId: "preview-rist-experience",
    dataKey: "experience",
    placeholder: "Sélectionnez un niveau pour voir les grades correspondants...",
  },
  {
    nom: "IsqLicence",
    inputId: "input-isq-licence",
    helperId: "isq-licence-helper-text",
    panelId: "panel-rist-isq-licence",
    previewId: "preview-rist-isq-licence",
    dataKey: "isq_licence",
    placeholder: "Sélectionnez un niveau pour voir l'affectation correspondante...",
  },
  {
    nom: "IsqComplement",
    inputId: "input-isq-complement",
    helperId: "isq-complement-helper-text",
    panelId: "panel-rist-isq-complement",
    previewId: "preview-rist-isq-complement",
    dataKey: "isq_complement",
    placeholder: "Sélectionnez un niveau pour voir l'affectation correspondante...",
  },
  {
    nom: "IsqMajoration",
    inputId: "input-isq-majoration",
    helperId: "isq-majoration-helper-text",
    panelId: "panel-rist-isq-majoration",
    previewId: "preview-rist-isq-majoration",
    dataKey: "isq_majoration",
    placeholder: "Sélectionnez un niveau pour voir l'affectation correspondante...",
  },
];

/**
 * Génère dynamiquement les options d'un menu RIST/ISQ depuis `baseDonnees`.
 * Remplace les `<div class="rist-option">` codés en dur dans le HTML.
 * Doit être appelée après le chargement de `data.json`.
 *
 * @param {typeof CONFIGS_RIST[0]} cfg - Configuration du menu à générer
 */
function genererListeRist(cfg) {
  const container = document.querySelector(`#${cfg.panelId} .rist-list-container`);
  const section = baseDonnees.rist?.[cfg.dataKey];
  if (!container || !section) return;

  const valeurActuelle = document.getElementById(cfg.inputId)?.value;
  container.innerHTML = "";

  Object.entries(section.montants).forEach(([niveau, montant]) => {
    const div = document.createElement("div");
    div.className = "rist-option" + (niveau === valeurActuelle ? " selected" : "");
    div.dataset.value = niveau;
    div.textContent = `${niveau} (${montant.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €)`;
    div.addEventListener("mouseenter", () => window[`previewHelper${cfg.nom}`](niveau));
    div.addEventListener("click", () => window[`select${cfg.nom}`](niveau));
    container.appendChild(div);
  });
}

// =============================================================================
// 6. INTERFACE UTILISATEUR
// =============================================================================

/**
 * Peuple le `<select>` des échelons selon le grade sélectionné.
 * Trie les échelons numériques avant les échelons alphanumériques (HEA1, HEA2...).
 * Conserve l'échelon actif si celui-ci existe dans le nouveau grade.
 */
function mettreAJourEchelons() {
  const grade = document.getElementById("input-grade").value;
  const selectEchelon = document.getElementById("input-echelon");
  const echelonActuel = selectEchelon.value;

  const echelons = Object.keys(baseDonnees.grilles_icna[grade] || {}).sort((a, b) => {
    const [nA, nB] = [parseInt(a), parseInt(b)];
    const [isA, isB] = [!isNaN(nA), !isNaN(nB)];
    if (isA && isB) return nA - nB;
    if (isA) return -1;
    if (isB) return 1;
    return a.localeCompare(b);
  });

  selectEchelon.innerHTML = "";
  echelons.forEach((ech) => {
    const opt = document.createElement("option");
    opt.value = ech;
    opt.textContent = ech;
    selectEchelon.appendChild(opt);
  });

  selectEchelon.value = echelons.includes(echelonActuel) ? echelonActuel : echelons[0] || "";
}

/**
 * Ouvre la modale principale sur le panneau spécifié.
 * Si la visite guidée est active, elle est mise en pause et reprendra à la fermeture.
 *
 * @param {string|string[]} panelIds - ID du panneau cible, ou tableau d'IDs pour affichage multi-panneaux
 * @param {string}          titre    - Titre affiché dans l'en-tête de la modale
 */
function ouvrirModal(panelIds, titre) {
  // Pause de la visite guidée en cours
  if (window.isTourActive && window.tourObj) {
    window.tourSavedStep = window.tourObj.getState()?.activeIndex ?? 0;
    window.tourObj.destroy();
  }

  const modal = document.getElementById("magic-modal");

  // Mode "menu d'ajout" (recherche) vs. mode panneau standard
  if (panelIds === "panel-menu-ajout") {
    modal.classList.add("search-mode");
    const champRecherche = document.getElementById("recherche-ajout");
    if (champRecherche) {
      champRecherche.value = "";
      document.getElementById("resultats-recherche").style.display = "none";
      document.getElementById("boutons-ajout-defaut").style.display = "grid";
      setTimeout(() => champRecherche.focus(), 50);
    }
  } else {
    modal.classList.remove("search-mode");
  }

  // Activation du panneau cible
  document.getElementById("modal-title").textContent = titre;
  document.querySelectorAll(".setting-panel").forEach((p) => p.classList.remove("active"));
  (Array.isArray(panelIds) ? panelIds : [panelIds]).forEach((id) => document.getElementById(id)?.classList.add("active"));

  modal.showModal();

  // Scroll automatique sur la sélection active
  setTimeout(() => {
    document.querySelector(".setting-panel.active .rist-option.selected")?.scrollIntoView({ block: "center", behavior: "instant" });
  }, 15);
}

/**
 * Réinitialise les champs spécifiés et relance le calcul.
 * Exposée sur `window` : appelée via `onclick` dans les boutons ✖ du HTML.
 *
 * @param {Event}    event    - Événement clic (propagation stoppée)
 * @param {string[]} inputIds - IDs des champs à remettre à zéro
 */
window.effacerValeurs = function (event, inputIds) {
  event.stopPropagation();
  inputIds.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === "SELECT") el.value = el.querySelector('option[value="none"]') ? "none" : "0";
    else if (el.type === "checkbox") el.checked = false;
    else el.value = "0";
  });
  calculerPaie();
};

/**
 * Valide un champ d'absence et s'assure que le total (grève + carence + maladie) ≤ 30 jours.
 * Exposée sur `window` : appelée via `oninput` dans le HTML.
 *
 * @param {HTMLInputElement} el - Champ d'absence modifié
 */
window.limiterAbsences = function (el) {
  if (parseInt(el.value) < 0) el.value = "0";
  const total = lireInt("input-greve") + lireInt("input-carence") + lireInt("input-maladie-90") + lireInt("input-maladie-50");
  if (total > 30) el.value = Math.max(0, (parseInt(el.value) || 0) - (total - 30));
  calculerPaie();
};

// =============================================================================
// 7. EXTRACTION DU PROFIL DEPUIS LE FORMULAIRE
// =============================================================================

/**
 * @typedef {Object} ProfilAgent
 * @property {string} grade
 * @property {string} echelon
 * @property {string} zone           - "Zone 1" | "Zone 2" | "Zone 3"
 * @property {number} taux_pas       - Taux PAS en décimal (ex. 0.08 pour 8 %)
 * @property {number} points_nbi     - 55 si NBI cochée, 0 sinon
 * @property {number} enfants        - Nombre d'enfants à charge (pour le SFT)
 * @property {Object} evenements     - Éléments variables du mois (nuits, absences, OTT...)
 * @property {Object} primes         - Primes et indemnités mensuelles fixes
 */

/**
 * Lit l'intégralité du formulaire et retourne le profil structuré de l'agent.
 * C'est le seul point de contact entre le DOM du formulaire et le moteur de calcul.
 *
 * @returns {ProfilAgent}
 */
function getProfilDepuisInterface() {
  // Part Fixe OTT : saisie manuelle + cumul des cases cochées
  let pfTotal = lireFloat("pf-manuel");
  document.querySelectorAll(".pf-checkbox").forEach((cb) => {
    if (cb.checked) pfTotal += parseFloat(cb.value);
  });

  // Participation PSC : cumul des cases cochées
  let pscTotal = 0;
  document.querySelectorAll(".psc-checkbox").forEach((cb) => {
    if (cb.checked) pscTotal += parseFloat(cb.value);
  });

  // Lecture des montants RIST depuis data.json via les valeurs des selects
  const ristKey = document.getElementById("input-fonction")?.value;
  const expKey = document.getElementById("input-experience")?.value;
  const licKey = document.getElementById("input-isq-licence")?.value;
  const cpltKey = document.getElementById("input-isq-complement")?.value;
  const majKey = document.getElementById("input-isq-majoration")?.value;

  return {
    grade: document.getElementById("input-grade")?.value || "ING.DIV. CONT.NAV.AE",
    echelon: document.getElementById("input-echelon")?.value || "",
    zone: document.querySelector('input[name="ir-zone"]:checked')?.value || "Zone 1",
    taux_pas: lireFloat("input-pas") / 100,
    points_nbi: document.getElementById("input-nbi-checkbox")?.checked ? CALC.POINTS_NBI : 0,
    enfants: lireInt("input-enfants"),

    evenements: {
      nuits: lireInt("input-nuit-n"),
      soirees: lireInt("input-nuit-s2"),
      jours_greve: lireInt("input-greve"),
      jours_carence: lireInt("input-carence"),
      jours_maladie_90: lireInt("input-maladie-90"),
      jours_maladie_50: lireInt("input-maladie-50"),
      prime_performance: lireFloat("input-perf"),
      ott_pf: pfTotal,
      ott_pv_globale: lireFloat("pv-globale"),
      ott_pv_opt32: lireFloat("pv-opt32"),
    },

    primes: {
      forfait_mobilites: lireFloat("input-fmd"),
      rist_fonctions: baseDonnees.rist?.fonctions?.montants?.[ristKey] || 0,
      rist_exper_prof: baseDonnees.rist?.experience?.montants?.[expKey] || 0,
      rist_lic_isq: baseDonnees.rist?.isq_licence?.montants?.[licKey] || 0,
      rist_cplt_lic_isq: baseDonnees.rist?.isq_complement?.montants?.[cpltKey] || 0,
      rist_maj_isq: baseDonnees.rist?.isq_majoration?.montants?.[majKey] || 0,
      attractivite: lireFloat("input-attractivite"),
      fidelisation: lireFloat("input-fidelisation"),
      inflation: lireFloat("input-inflation"),
      ind_compensatrice_csg: lireFloat("input-ind-csg"),
      psc: pscTotal,
    },
  };
}

// =============================================================================
// 8. CALCUL DE LA PAIE (pur — zéro accès au DOM)
// =============================================================================

/**
 * Calcule le Supplément Familial de Traitement selon le barème fonctionnaire.
 * Le traitement de référence est borné entre SFT_IND_PLANCHER et SFT_IND_PLAFOND (en valeur €).
 *
 * @param {number} nbEnfants      - Nombre d'enfants à charge
 * @param {number} traitementBrut - Traitement brut mensuel (€)
 * @param {number} valeurPoint    - Valeur du point d'indice mensuel (€)
 * @returns {number} Montant SFT brut avant déduction pour absence
 */
function calculerSFT(nbEnfants, traitementBrut, valeurPoint) {
  if (nbEnfants < 1) return 0;
  const plancher = CALC.SFT_IND_PLANCHER * valeurPoint;
  const plafond = CALC.SFT_IND_PLAFOND * valeurPoint;
  const ref = Math.min(Math.max(traitementBrut, plancher), plafond);

  if (nbEnfants === 1) return CALC.SFT_1_ENF_FIXE;
  if (nbEnfants === 2) return arrondir(CALC.SFT_2_BASE + ref * CALC.SFT_2_TAUX);
  if (nbEnfants === 3) return arrondir(CALC.SFT_3_BASE + ref * CALC.SFT_3_TAUX);
  // 4 enfants et plus : part de base 3 enfants + part par enfant supplémentaire
  return arrondir(CALC.SFT_3_BASE + ref * CALC.SFT_3_TAUX + (nbEnfants - 3) * (CALC.SFT_SUP_BASE + ref * CALC.SFT_SUP_TAUX));
}

/**
 * Génère le texte de tooltip détaillant la déduction d'absence sur un élément de paie.
 * Chaque type d'absence y est listé avec son impact financier.
 *
 * @param {number} montantDeBase  - Montant mensuel complet de l'élément (avant toute absence)
 * @param {number} joursGreve     - Jours de grève (retenue 100%)
 * @param {number} joursCarence   - Jours de carence (retenue 100%)
 * @param {number} jours90        - Jours de maladie à 90% (retenue effective : 10%)
 * @param {number} jours50        - Jours de maladie à 50% (retenue effective : 50%)
 * @returns {string} Chaîne multi-lignes pour l'attribut `title` HTML
 */
function genererTooltipAbsence(montantDeBase, joursGreve, joursCarence, jours90, jours50) {
  const parJour = montantDeBase / 30;
  return [
    joursGreve > 0 && `Grève (${joursGreve}J) : -${formaterMontant(arrondir(parJour * joursGreve))} €`,
    joursCarence > 0 && `Carence (${joursCarence}J) : -${formaterMontant(arrondir(parJour * joursCarence))} €`,
    jours90 > 0 && `Maladie 90% (${jours90}J) : -${formaterMontant(arrondir(parJour * jours90 * 0.1))} €`,
    jours50 > 0 && `Maladie 50% (${jours50}J) : -${formaterMontant(arrondir(parJour * jours50 * 0.5))} €`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * @typedef {Object} MontantsCalcules
 * Résultat complet du calcul de paie, prêt à être injecté dans le DOM.
 */

/**
 * Calcule l'ensemble des montants de la fiche de paie à partir du profil agent.
 * Cette fonction est pure : elle ne touche pas au DOM.
 *
 * @param {ProfilAgent} p - Profil complet de l'agent
 * @returns {MontantsCalcules}
 */
function calculerMontants(p) {
  const cst = baseDonnees.constantes;
  const pat = baseDonnees.taux_patronaux;

  // ── Base indiciaire ──────────────────────────────────────────────────────────
  const indice = baseDonnees.grilles_icna[p.grade]?.[p.echelon]?.indice || 0;
  const traitementBrut = arrondir(indice * cst.valeur_point_mensuel);
  const montantNbi = arrondir(p.points_nbi * cst.valeur_point_mensuel);
  const indemniteResidence = Math.floor((traitementBrut + montantNbi) * baseDonnees.zones_residence[p.zone] * 100) / 100;

  // ── Indemnité de nuit (S1 = nuit, S2 = soirée) ──────────────────────────────
  const nuit = arrondir(CALC.TAUX_NUIT * p.evenements.nuits + CALC.TAUX_SOIREE * p.evenements.soirees);

  // ── Absences ─────────────────────────────────────────────────────────────────
  const { jours_greve: joursGreve, jours_carence: joursCarence, jours_maladie_90: jours90, jours_maladie_50: jours50 } = p.evenements;

  const joursAbs = joursGreve + joursCarence + jours90 + jours50;
  // Grève/carence : retenue 100% | Maladie 90% : retenue 10% | Maladie 50% : retenue 50%
  const joursRetenus = joursGreve + joursCarence + jours90 * 0.1 + jours50 * 0.5;

  /** @param {number} base - Calcule la retenue d'absence sur la règle du 1/30e */
  const abs = (base) => arrondir((base / 30) * joursRetenus);

  const absTraitement = abs(traitementBrut);
  const absNbi = abs(montantNbi);
  const absResidence = abs(indemniteResidence);
  const absRistFct = abs(p.primes.rist_fonctions);
  const absRistExp = abs(p.primes.rist_exper_prof);
  const absRistIsq = abs(p.primes.rist_lic_isq);
  const absRistCplt = abs(p.primes.rist_cplt_lic_isq);
  const absRistMaj = abs(p.primes.rist_maj_isq);
  const absIndCsg = abs(p.primes.ind_compensatrice_csg);

  // ── Bases nettes après absences ──────────────────────────────────────────────
  const baseTraitementReel = traitementBrut - absTraitement;
  const baseNbiReelle = montantNbi - absNbi;
  const baseResidenceReelle = indemniteResidence - absResidence;
  const baseSoumisePC = baseTraitementReel + baseNbiReelle;

  // ── Total des primes soumises à cotisations ───────────────────────────────────
  // BUG CORRIGÉ : l'inflation était une instruction orpheline (+inflation;) → non comptabilisée
  const totalPrimesSoumises =
    baseResidenceReelle +
    nuit +
    (p.primes.rist_fonctions - absRistFct) +
    (p.primes.rist_exper_prof - absRistExp) +
    (p.primes.rist_lic_isq - absRistIsq) +
    (p.primes.rist_cplt_lic_isq - absRistCplt) +
    (p.primes.rist_maj_isq - absRistMaj) +
    (p.primes.ind_compensatrice_csg - absIndCsg) +
    p.evenements.prime_performance +
    p.evenements.ott_pf +
    p.evenements.ott_pv_globale +
    p.evenements.ott_pv_opt32 +
    p.primes.attractivite +
    p.primes.fidelisation +
    p.primes.inflation;

  // ── SFT ──────────────────────────────────────────────────────────────────────
  const sftBrut = calculerSFT(p.enfants, traitementBrut, cst.valeur_point_mensuel);
  const montantSFT = Math.max(0, sftBrut - abs(sftBrut));

  // ── Cotisations salariales ───────────────────────────────────────────────────
  const retenuePC = arrondir(baseTraitementReel * cst.taux_retenue_pc);
  const retenuePcNbi = arrondir(baseNbiReelle * cst.taux_retenue_pc);

  const baseRafp = Math.min(totalPrimesSoumises, baseSoumisePC * cst.plafond_rafp);
  const cotisationRafp = arrondir(baseRafp * cst.taux_rafp);

  const ristIsqReel = p.primes.rist_lic_isq - absRistIsq;
  const retenueIsq = arrondir(ristIsqReel * cst.taux_retenue_isq);

  const transfertPrimesBase = cst.transfert_primes_points;
  const transfertPrimes = Math.max(0, transfertPrimesBase - abs(transfertPrimesBase));

  // ── CSG / CRDS ───────────────────────────────────────────────────────────────
  const baseCsgCrds = Math.max(0, (baseSoumisePC + totalPrimesSoumises + p.primes.psc + montantSFT - transfertPrimes - retenueIsq) * cst.assiette_csg_crds);
  const csgDeductible = arrondir(baseCsgCrds * cst.taux_csg_deductible);
  const csgNonDeductible = arrondir(baseCsgCrds * cst.taux_csg_non_deductible);
  const crds = arrondir(baseCsgCrds * cst.taux_crds);

  // ── Charges patronales ───────────────────────────────────────────────────────
  const charges = {
    patAllocFam: arrondir(baseSoumisePC * pat.alloc_familiale),
    patAfMajor: arrondir(baseSoumisePC * pat.af_majoration),
    patFnal: arrondir(baseSoumisePC * pat.fnal),
    patCsa: arrondir(baseSoumisePC * pat.csa),
    patMaladie: arrondir(baseSoumisePC * pat.maladie),
    patPensions: arrondir(baseSoumisePC * pat.pensions_civiles),
    patAti: arrondir(baseSoumisePC * pat.ati),
    patMobilite: arrondir(baseSoumisePC * pat.versement_mobilite),
    patRafp: cotisationRafp, // RAFP patronal = RAFP salarial (taux identique)
  };
  const totalPatronal = Object.values(charges).reduce((s, v) => s + v, 0);

  // ── Totaux des colonnes & nets ───────────────────────────────────────────────
  const totalAPayer = arrondir(
    traitementBrut +
      (montantNbi > 0 ? montantNbi - absNbi : 0) +
      indemniteResidence +
      montantSFT +
      (nuit > 0 ? nuit : 0) +
      (p.primes.forfait_mobilites > 0 ? p.primes.forfait_mobilites : 0) +
      (p.primes.inflation > 0 ? p.primes.inflation : 0) +
      (p.primes.rist_fonctions > 0 ? p.primes.rist_fonctions - absRistFct : 0) +
      (p.primes.rist_exper_prof > 0 ? p.primes.rist_exper_prof - absRistExp : 0) +
      (p.primes.rist_lic_isq > 0 ? p.primes.rist_lic_isq - absRistIsq : 0) +
      (p.primes.rist_cplt_lic_isq > 0 ? p.primes.rist_cplt_lic_isq - absRistCplt : 0) +
      (p.primes.rist_maj_isq > 0 ? p.primes.rist_maj_isq - absRistMaj : 0) +
      (p.primes.ind_compensatrice_csg > 0 ? p.primes.ind_compensatrice_csg - absIndCsg : 0) +
      (p.primes.psc > 0 ? p.primes.psc : 0) +
      (p.evenements.prime_performance > 0 ? p.evenements.prime_performance : 0) +
      (p.evenements.ott_pv_globale > 0 ? p.evenements.ott_pv_globale : 0) +
      (p.evenements.ott_pf > 0 ? p.evenements.ott_pf : 0) +
      (p.evenements.ott_pv_opt32 > 0 ? p.evenements.ott_pv_opt32 : 0) +
      (p.primes.fidelisation > 0 ? p.primes.fidelisation : 0) +
      (p.primes.attractivite > 0 ? p.primes.attractivite : 0),
  );

  const totalADeduire = arrondir(
    retenuePC +
      (montantNbi > 0 ? retenuePcNbi : 0) +
      csgNonDeductible +
      csgDeductible +
      crds +
      cotisationRafp +
      (joursAbs > 0 ? absTraitement : 0) +
      (joursAbs > 0 ? absResidence : 0) +
      transfertPrimes +
      retenueIsq,
  );

  const netAPayerAvantImpot = arrondir(totalAPayer - totalADeduire);
  const netSocial = arrondir(netAPayerAvantImpot - p.primes.forfait_mobilites - p.primes.psc + retenueIsq);
  const netImposableFinal = Math.max(0, netAPayerAvantImpot + csgNonDeductible + crds - p.primes.forfait_mobilites);
  const impotSource = arrondir(netImposableFinal * p.taux_pas);
  const netFinal = Math.max(0, arrondir(netAPayerAvantImpot - impotSource));
  const coutTotalEmployeur = arrondir(totalAPayer + totalPatronal - transfertPrimes);

  return {
    // --- champs existants ---
    indice,
    traitementBrut,
    montantNbi,
    indemniteResidence,
    nuit,
    joursGreve,
    joursCarence,
    jours90,
    jours50,
    joursAbs,
    joursRetenus,
    absTraitement,
    absNbi,
    absResidence,
    absRistFct,
    absRistExp,
    absRistIsq,
    absRistCplt,
    absRistMaj,
    absIndCsg,
    baseTraitementReel,
    baseNbiReelle,
    baseSoumisePC,
    totalPrimesSoumises,
    montantSFT,
    retenuePC,
    retenuePcNbi,
    cotisationRafp,
    retenueIsq,
    transfertPrimes,
    csgDeductible,
    csgNonDeductible,
    crds,
    charges,
    totalPatronal,
    psc: p.primes.psc,
    // --- champs ajoutés à l'étape 5 ---
    totalAPayer,
    totalADeduire,
    netAPayerAvantImpot,
    netSocial,
    netImposableFinal,
    impotSource,
    netFinal,
    coutTotalEmployeur,
  };
}

// =============================================================================
// 9. RENDU DE LA FICHE DE PAIE
// =============================================================================

/**
 * Table de routage : code de ligne → panneau à ouvrir au clic.
 * Permet de rendre les lignes de la fiche interactives sans duplication de logique.
 * @type {Object.<string, {cible: string, titre: string}>}
 */
const ROUTAGE_MODAL = {
  102000: { cible: "panel-residence", titre: "Zone de Résidence" },
  201958: { cible: "panel-rist-fonctions", titre: "Ristourne Part Fonctions" },
  201959: { cible: "panel-rist-experience", titre: "Ristourne Part Expérience" },
  201960: { cible: "panel-rist-isq-licence", titre: "Ristourne Part LIC-ISQ" },
  201961: { cible: "panel-rist-isq-complement", titre: "Ristourne CPLT Part LIC-ISQ" },
  201962: { cible: "panel-rist-isq-majoration", titre: "Majoration Complément ISQ" },
  200176: { cible: "panel-nuits", titre: "Travail de Nuit & Soirées" },
  200041: { cible: "panel-fmd", titre: "Forfait Mobilités" },
  202485: { cible: "panel-primes", titre: "Prime Partage Performance" },
  201000: { cible: "panel-inflation", titre: "Indemnité Pouvoir d'Achat" },
  203001: { cible: "panel-fidelisation", titre: "Prime de Fidélisation" },
  203002: { cible: "panel-attractivite", titre: "Attractivité Géographique" },
  604958: { cible: "panel-absences", titre: "Absences et Carence" },
  604959: { cible: "panel-absences", titre: "Absences et Carence" },
  558000: { cible: "panel-impots", titre: "Prélèvement à la Source" },
  202206: { cible: "panel-csg", titre: "Indemnité Compensatrice CSG" },
  202354: { cible: "panel-psc", titre: "Participation à la PSC" },
  202558: { cible: "panel-ott", titre: "Organisation du Travail (Protocole)" },
  202559: { cible: "panel-ott", titre: "Organisation du Travail (Protocole)" },
  202560: { cible: "panel-ott", titre: "Organisation du Travail (Protocole)" },
};

/**
 * Reconstruit et affiche la fiche de paie complète dans le tableau DOM.
 * Met également à jour les totaux dans le pied de page.
 *
 * @param {ProfilAgent}      p - Profil de l'agent
 * @param {MontantsCalcules} m - Résultat de `calculerMontants(p)`
 */
function dessinerFiche(p, m) {
  const tbody = document.getElementById("lignes-paie");
  tbody.innerHTML = "";

  // Label de détail des absences (ex. "GREVE 2J // MAL 90% 3J")
  const detailAbs = [m.joursGreve > 0 && `GREVE ${m.joursGreve}J`, m.joursCarence > 0 && `CAR ${m.joursCarence}J`, m.jours90 > 0 && `MAL 90% ${m.jours90}J`, m.jours50 > 0 && `MAL 50% ${m.jours50}J`]
    .filter(Boolean)
    .join(" // ");

  /** Raccourci : génère le tooltip d'absence pour un montant de base donné */
  const tip = (base) => genererTooltipAbsence(base, m.joursGreve, m.joursCarence, m.jours90, m.jours50);

  // ─────────────────────────────────────────────────────────────────────────────
  /**
   * Ajoute une ligne `<tr>` dans le tableau de la fiche de paie.
   * Si un routage est défini pour le code, la ligne devient cliquable.
   *
   * @param {string}      code             - Code comptable (ex. "101000"). Vide pour les lignes de détail.
   * @param {string}      libelle          - Libellé de la ligne
   * @param {number|null} aPayer           - Montant créditeur (colonne "À payer")
   * @param {number|null} aDeduire         - Montant débiteur (colonne "À déduire")
   * @param {number|null} pourInfo         - Montant indicatif (colonne "Pour info")
   * @param {string[]}    [inputsAReset]   - IDs à remettre à zéro (affiche ✖)
   * @param {string}      [tooltipMontant] - Texte tooltip affiché sur le montant
   * @param {string}      [customId]       - ID `<tr>` personnalisé (outrepasse `row-{code}`)
   */
  function ajouterLigne(code, libelle, aPayer, aDeduire, pourInfo, inputsAReset = null, tooltipMontant = null, customId = null) {
    const tr = document.createElement("tr");
    if (customId) tr.id = customId;
    else if (code) tr.id = `row-${code}`;

    const route = ROUTAGE_MODAL[code];
    if (route) {
      tr.className = "clickable-row";
      tr.title = "Cliquez pour modifier";
      tr.onclick = () => ouvrirModal(route.cible, route.titre);
    } else if (libelle.includes("TAUX PERSONNALISE")) {
      tr.className = "clickable-row";
      tr.onclick = () => ouvrirModal("panel-impots", "Prélèvement à la Source");
    }

    const isBold = code === "011100" || code === "011300";
    const euroSymbol = aPayer || aDeduire || pourInfo ? `<span style="float:right;font-weight:normal;color:#555;">€</span>` : "";
    const croix = inputsAReset ? `<span class="delete-btn" title="Retirer cet élément" onclick="window.effacerValeurs(event, ${JSON.stringify(inputsAReset).replace(/"/g, "'")})">✖</span>` : "";
    const fmtCell = (val) => {
      if (!val) return "";
      const txt = formaterMontant(val);
      return tooltipMontant ? `<span title="${tooltipMontant}" style="cursor:help;border-bottom:1px dotted var(--dgfip-medium);">${txt}</span>` : txt;
    };

    tr.innerHTML = `
      <td class="col-code">${code || ""}</td>
      <td class="col-libelle label${isBold ? " font-large" : ""}"><span>${libelle}</span>${croix} ${euroSymbol}</td>
      <td class="col-amount">${fmtCell(aPayer)}</td>
      <td class="col-amount">${fmtCell(aDeduire)}</td>
      <td class="col-amount">${fmtCell(pourInfo)}</td>
    `;
    tbody.appendChild(tr);
  }

  /**
   * Ajoute une ligne de prime RIST et, si des absences existent,
   * les deux lignes de détail associées (retenue calculée + description).
   *
   * @param {string} code     - Code comptable de la prime
   * @param {string} libelle  - Libellé
   * @param {number} montant  - Montant mensuel brut de la prime
   * @param {number} absence  - Retenue d'absence précalculée
   */
  function ajouterLigneRist(code, libelle, montant, absence) {
    ajouterLigne(code, libelle, montant, null, null);
    if (m.joursAbs > 0) {
      ajouterLigne(code, libelle, -absence, null, null, null, tip(montant));
      ajouterLigne("", `&nbsp;&nbsp;&nbsp;&nbsp;${detailAbs}`, null, null, null);
    }
  }
  // ─────────────────────────────────────────────────────────────────────────────

  // ── Synthèse des absences (en tête, avant le traitement brut) ────────────────
  if (m.joursAbs > 0) {
    const totalAbsDed = m.absTraitement + m.absNbi + m.absResidence + m.absRistFct + m.absRistExp + m.absRistIsq + m.absRistCplt + m.absRistMaj + m.absIndCsg;
    const baseTotale =
      m.traitementBrut +
      m.montantNbi +
      m.indemniteResidence +
      p.primes.rist_fonctions +
      p.primes.rist_exper_prof +
      p.primes.rist_lic_isq +
      p.primes.rist_cplt_lic_isq +
      p.primes.rist_maj_isq +
      p.primes.ind_compensatrice_csg;

    ajouterLigne("604958", `SERVICE NON FAIT / ABSENCE (${m.joursAbs} J)`, null, null, totalAbsDed, ["input-greve", "input-carence", "input-maladie-90", "input-maladie-50"], tip(baseTotale));
  }

  // ── Traitement brut & NBI ─────────────────────────────────────────────────────
  ajouterLigne("101000", "TRAITEMENT BRUT", m.traitementBrut, null, null);

  if (m.montantNbi > 0) {
    ajouterLigne("101070", "TRAITEMENT BRUT N.B.I.", m.montantNbi, null, null);
    if (m.joursAbs > 0) {
      ajouterLigne("101070", "TRAITEMENT BRUT N.B.I.", -m.absNbi, null, null, null, tip(m.montantNbi));
      ajouterLigne("", `&nbsp;&nbsp;&nbsp;&nbsp;${detailAbs}`, null, null, null);
    }
  }

  if (m.montantSFT > 0) ajouterLigne("200200", "SUPPLEMENT FAMILIAL DE TRAITEMENT", m.montantSFT, null, null);

  // ── Retenues PC ──────────────────────────────────────────────────────────────
  ajouterLigne("101050", "RETENUE PC", null, m.retenuePC, null);
  if (m.montantNbi > 0) ajouterLigne("101080", "RET P.C. SUR N.B.I.", null, m.retenuePcNbi, null);

  // ── Indemnité de résidence ───────────────────────────────────────────────────
  ajouterLigne("102000", "INDEMNITE DE RESIDENCE", m.indemniteResidence, null, null);

  // ── Éléments variables (affichés uniquement si non nuls) ─────────────────────
  if (m.nuit > 0) ajouterLigne("200176", "IND. TRAVAIL DE NUIT", m.nuit, null, null, ["input-nuit-n", "input-nuit-s2"]);

  if (p.primes.forfait_mobilites > 0) ajouterLigne("200041", "FORF. MOBILITES DURABLES", p.primes.forfait_mobilites, null, null, ["input-fmd"]);

  if (p.primes.inflation > 0) ajouterLigne("201000", "INDEM. GARANTIE POUVOIR D'ACHAT", p.primes.inflation, null, null, ["input-inflation"]);

  // ── RIST (5 composantes, chacune avec déduction absence intégrée) ─────────────
  ajouterLigneRist("201958", "RIST PART FONCTIONS", p.primes.rist_fonctions, m.absRistFct);
  ajouterLigneRist("201959", "RIST PART EXPER. PROF.", p.primes.rist_exper_prof, m.absRistExp);
  ajouterLigneRist("201960", "RIST PART LIC-ISQ (ICNA)", p.primes.rist_lic_isq, m.absRistIsq);
  ajouterLigneRist("201961", "RIST CPLT PART LIC-ISQ", p.primes.rist_cplt_lic_isq, m.absRistCplt);
  ajouterLigneRist("201962", "MAJORATION CPLT ISQ", p.primes.rist_maj_isq, m.absRistMaj);
  ajouterLigneRist("202206", "IND. COMPENSATRICE CSG", p.primes.ind_compensatrice_csg, m.absIndCsg);

  // ── PSC, PPP, OTT, Fidélisation, Attractivité ─────────────────────────────────
  if (m.psc > 0) ajouterLigne("202354", "PARTICIPATION A LA PSC", m.psc, null, null, ["psc-15", "psc-7", "psc-5"]);

  if (p.evenements.prime_performance > 0) ajouterLigne("202485", "PR. PARTAGE PERFORMANCE", p.evenements.prime_performance, null, null, ["input-perf"]);

  if (p.evenements.ott_pv_globale > 0) ajouterLigne("202558", "RIST ORGA TEMPS TRAVAIL (PV)", p.evenements.ott_pv_globale, null, null, ["pv-globale"]);

  if (p.evenements.ott_pf > 0)
    ajouterLigne("202559", "RIST ORGA TEMPS TRAVAIL (PF)", p.evenements.ott_pf, null, null, [
      "pf-manuel",
      "pf-opt1-l16",
      "pf-opt1-cdg",
      "pf-opt1-l711",
      "pf-opt1-l911",
      "pf-opt1-plus-n1",
      "pf-opt1-plus-n2",
      "pf-opt2-1",
      "pf-opt2-2",
      "pf-opt2-bis",
      "pf-opt4",
      "pf-opt1-enac",
      "pf-opt1-plus-enac",
    ]);

  if (p.evenements.ott_pv_opt32 > 0) ajouterLigne("202560", "RIST ORGA TEMPS TRAVAIL (PV OPT 3-1 / 3-2)", p.evenements.ott_pv_opt32, null, null, ["pv-opt32"]);

  if (p.primes.fidelisation > 0) ajouterLigne("203001", "PRIME DE FIDELISATION TERR.", p.primes.fidelisation, null, null, ["input-fidelisation"]);

  if (p.primes.attractivite > 0) ajouterLigne("203002", "ATTRACTIVITE GEOGRAPHIQUE", p.primes.attractivite, null, null, ["input-attractivite"]);

  // Previews des totaux OTT dans le panneau de configuration
  majPreview("preview-ott-pf", p.evenements.ott_pf);
  majPreview("preview-ott-pv", p.evenements.ott_pv_globale + p.evenements.ott_pv_opt32);

  // ── Cotisations (CSG/CRDS + charges patronales) ───────────────────────────────
  ajouterLigne("401201", "C.S.G. NON DEDUCTIBLE", null, m.csgNonDeductible, null);
  ajouterLigne("401301", "C.S.G. DEDUCTIBLE", null, m.csgDeductible, null);
  ajouterLigne("401501", "C.R.D.S.", null, m.crds, null);
  ajouterLigne("403301", "COTIS PATRON. ALLOC FAMIL", null, null, m.charges.patAllocFam);
  ajouterLigne("403397", "COT PAT AF MAJORATION", null, null, m.charges.patAfMajor);
  ajouterLigne("403501", "COT PAT FNAL DEPLAFONNEE", null, null, m.charges.patFnal);
  ajouterLigne("403801", "CONT SOLIDARITE AUTONOMIE", null, null, m.charges.patCsa);
  ajouterLigne("404001", "COT PAT MALADIE DEPLAFON", null, null, m.charges.patMaladie);
  ajouterLigne("411050", "CONTRIB.PC", null, null, m.charges.patPensions);
  ajouterLigne("411058", "CONTRIBUTION ATI", null, null, m.charges.patAti);
  ajouterLigne("501080", "COT SAL RAFP", null, m.cotisationRafp, null);
  ajouterLigne("501180", "COT PAT RAFP", null, null, m.charges.patRafp);
  ajouterLigne("554500", "COT PAT VST MOBILITE", null, null, m.charges.patMobilite);

  if (m.joursAbs > 0) {
    ajouterLigne("604958", "PREC. CARENCE REM. PR.", null, m.absTraitement, null, null, tip(m.traitementBrut));
    ajouterLigne("604959", "PREC. CARENCE IND. RESID.", null, m.absResidence, null, null, tip(m.indemniteResidence));
  }

  ajouterLigne("604970", "TRANSFERT PRIMES / POINTS", null, m.transfertPrimes, null);
  ajouterLigne("751095", "24,6% ISQ", null, m.retenueIsq, null);

  // ── Nets ─────────────────────────────────────────────────────────────────────
  ajouterLigne("", "", null, null, null);
  ajouterLigne("011100", "NET A PAYER AVANT IMPOT SUR LE REVENU", null, null, m.netAPayerAvantImpot);
  ajouterLigne("011300", "MONTANT NET SOCIAL", null, null, m.netSocial);
  ajouterLigne("558000", "IMPOT SUR LE REVENU PRELEVE A LA SOURCE", null, m.impotSource, null);
  ajouterLigne("", `(TAUX PERSONNALISE ${formaterMontant(p.taux_pas * 100)}%)`, null, null, null, null, null, "row-taux-impot");

  // ── Ligne d'ajout d'éléments variables ──────────────────────────────────────
  const trAjout = document.createElement("tr");
  trAjout.className = "add-row";
  trAjout.innerHTML = `<td colspan="5"> + AJOUTER OU MODIFIER UN ÉLÉMENT VARIABLE (Options protocolaires, Absences, Indemnité de Nuit...) </td>`;
  trAjout.onclick = () => ouvrirModal("panel-menu-ajout", "Que voulez-vous ajouter ?");
  tbody.appendChild(trAjout);

  // ── Ressort magique (lignes fantômes pour combler l'espace vide du tableau) ──
  const trRessort = document.createElement("tr");
  trRessort.id = "ressort-magique";
  trRessort.style.backgroundColor = "white";
  trRessort.innerHTML = `
    <td style="border-right:1px solid var(--dgfip-light);height:100%;"></td>
    <td style="border-right:1px solid var(--dgfip-light);"></td>
    <td style="border-right:1px solid var(--dgfip-light);"></td>
    <td style="border-right:1px solid var(--dgfip-light);"></td>
    <td></td>
  `;
  tbody.appendChild(trRessort);

  // ── Totaux dans le pied de page ───────────────────────────────────────────────

  document.getElementById("ui-total-a-payer").textContent = formaterMontant(m.totalAPayer);
  document.getElementById("ui-total-a-deduire").textContent = formaterMontant(m.totalADeduire);
  document.getElementById("ui-cout-employeur").textContent = formaterMontant(m.coutTotalEmployeur);
  document.getElementById("ui-net-a-payer").textContent = (m.netFinal === 0 ? "0,00" : formaterMontant(m.netFinal)) + " €";
  document.getElementById("ui-net-imposable").textContent = m.netImposableFinal === 0 ? "0,00" : formaterMontant(m.netImposableFinal);

  // ── Injection des lignes fantômes après repaint (requestAnimationFrame) ───────
  requestAnimationFrame(() => {
    document.querySelectorAll(".ligne-fantome").forEach((el) => el.remove());
    const ressort = document.getElementById("ressort-magique");
    if (ressort) {
      const hauteurDisponible = ressort.getBoundingClientRect().height;
      const hauteurLigne = 18;
      if (hauteurDisponible > hauteurLigne) {
        const nbLignes = Math.floor(hauteurDisponible / hauteurLigne);
        for (let i = 0; i < nbLignes; i++) {
          const tr = document.createElement("tr");
          tr.className = "ligne-fantome";
          tr.innerHTML = `
            <td style="border-right:1px solid var(--dgfip-light);">&nbsp;</td>
            <td style="border-right:1px solid var(--dgfip-light);">&nbsp;</td>
            <td style="border-right:1px solid var(--dgfip-light);">&nbsp;</td>
            <td style="border-right:1px solid var(--dgfip-light);">&nbsp;</td>
            <td>&nbsp;</td>
          `;
          tbody.insertBefore(tr, ressort);
        }
      }
    }

    // Si la visite guidée est active, on la relance sur la même étape après le repaint du DOM
    if (window.isTourActive && window.tourObj) {
      const etape = window.tourObj.getState()?.activeIndex ?? 0;
      window.tourObj.destroy();
      setTimeout(() => window.lancerVisiteGuidee(etape), 50);
    }
  });
}

// =============================================================================
// 10. POINT D'ENTRÉE DU CALCUL
// =============================================================================

/**
 * Orchestre le cycle complet : lecture profil → calcul → mise à jour previews → rendu fiche.
 * Appelée à chaque modification d'un champ du formulaire.
 */
function calculerPaie() {
  const profilAgent = getProfilDepuisInterface();
  const m = calculerMontants(profilAgent);
  majPreview("preview-nuits", m.nuit);
  majPreview("preview-rist-fonctions", profilAgent.primes.rist_fonctions);
  majPreview("preview-rist-experience", profilAgent.primes.rist_exper_prof);
  majPreview("preview-rist-isq-licence", profilAgent.primes.rist_lic_isq);
  majPreview("preview-rist-isq-complement", profilAgent.primes.rist_cplt_lic_isq);
  majPreview("preview-rist-isq-majoration", profilAgent.primes.rist_maj_isq);
  dessinerFiche(profilAgent, m);
  sauvegarderProfil(); // ← ajouter
}

// =============================================================================
// 11. INITIALISATION DE L'APPLICATION
// =============================================================================

/**
 * Attache le comportement "full keyboard mode" à une modale de recherche :
 * toute frappe hors de l'input est redirigée vers lui automatiquement.
 *
 * @param {HTMLDialogElement} modal
 * @param {HTMLInputElement}  input
 */
function attacherNavigationClavier(modal, input) {
  modal.addEventListener("keydown", (e) => {
    if (document.activeElement === input) return;
    if (e.key === "Backspace") {
      e.preventDefault();
      input.focus();
      input.value = input.value.slice(0, -1);
      input.dispatchEvent(new Event("input"));
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      input.focus();
    }
  });
}

/**
 * Point d'entrée unique de l'application, déclenché au chargement de la page.
 *
 * Séquence d'initialisation :
 * 1. Chargement asynchrone de `data.json`
 * 2. Peuplement des `<select>` dynamiques (attractivité, fidélisation)
 * 3. Attachement de tous les écouteurs d'événements (inputs, keyboard, modales)
 * 4. Premier calcul et affichage de la fiche
 */
async function initialiserApplication() {
  try {
    const reponse = await fetch("data.json");
    if (!reponse.ok) throw new Error("Impossible de charger data.json.");
    baseDonnees = await reponse.json();

    // Affichage de la version du barème dans la console (debug) et dans le DOM si l'élément existe
    const meta = baseDonnees.meta;
    if (meta) {
      console.info(`📋 Barème chargé : v${meta.version} — valable depuis ${meta.valable_depuis}`);
      const elVersion = document.getElementById("ui-version-bareme");
      if (elVersion) {
        const [annee, mois] = meta.version.split("-");
        elVersion.textContent = `Barème ${mois}-${annee}`;
      }
    }

    mettreAJourEchelons();

    // Peuplement des selects depuis data.json (attractivité & fidélisation)
    ["attractivite", "fidelisation"].forEach((cle) => {
      const select = document.getElementById(`input-${cle}`);
      if (select && baseDonnees[cle]) {
        baseDonnees[cle].forEach((opt) => select.add(new Option(opt.label, opt.valeur)));
      }
    });

    // Génération dynamique des listes RIST / ISQ + enregistrement des menus interactifs
    CONFIGS_RIST.forEach((cfg) => {
      genererListeRist(cfg);
      creerMenuInteractif(cfg.nom, cfg.inputId, cfg.helperId, cfg.panelId, baseDonnees.rist[cfg.dataKey].descriptions);
    });

    // Restauration du profil sauvegardé (après peuplement des listes)
    const profilRestauré = restaurerProfil();
    if (profilRestauré) {
      // Le grade restauré peut avoir changé → reconstruire les échelons
      mettreAJourEchelons();
      // Réappliquer l'échelon sauvegardé (mettreAJourEchelons() remet sur le premier)
      const echelonSauve = JSON.parse(localStorage.getItem(CLE_STOCKAGE))?.["input-echelon"];
      if (echelonSauve) document.getElementById("input-echelon").value = echelonSauve;
    }

    // Changement de grade → échelons + recalcul
    document.getElementById("input-grade").addEventListener("input", () => {
      mettreAJourEchelons();
      calculerPaie();
    });

    // Tous les champs du formulaire principal déclenchent un recalcul
    document.querySelectorAll(".magic-modal select, .magic-modal input, .info-table select, .info-table input").forEach((input) => input.addEventListener("input", calculerPaie));

    // Validation des champs numériques (bornes min/max spécifiques par champ)
    document.querySelectorAll('.magic-modal input[type="number"]').forEach((champ) => {
      champ.addEventListener("input", function () {
        if (this.value === "") return;
        const val = parseFloat(this.value);
        let corrige = false;
        if (val < 0) {
          this.value = "0";
          corrige = true;
        }
        if (this.id === "input-pas" && val > 100) {
          this.value = "100";
          corrige = true;
        }
        if ((this.id === "input-nuit-n" || this.id === "input-nuit-s2") && val > 30) {
          this.value = "30";
          corrige = true;
        }
        if (corrige) calculerPaie();
      });

      champ.addEventListener("blur", function () {
        if (this.value === "") {
          this.value = this.step?.includes(".") ? "0.00" : "0";
          calculerPaie();
        }
      });
    });

    // ── Modale principale ─────────────────────────────────────────────────────
    const modal = document.getElementById("magic-modal");

    // Entrée sur un résultat de recherche → clic ; sinon → fermeture
    modal.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (document.activeElement?.classList.contains("resultat-item")) {
        document.activeElement.click();
      } else {
        modal.close();
      }
    });

    // Fermeture de la modale → reprise de la visite guidée à l'étape suivante
    modal.addEventListener("close", () => {
      if (window.tourSavedStep === undefined) return;
      setTimeout(() => {
        const etape = window.tourSavedStep + 1;
        if (etape <= 5) window.lancerVisiteGuidee(etape);
        else window.isTourActive = false;
        window.tourSavedStep = undefined;
      }, 150);
    });

    // Navigation clavier full-keyboard pour le menu d'ajout
    const champRecherche = document.getElementById("recherche-ajout");
    if (champRecherche) attacherNavigationClavier(modal, champRecherche);

    // ── Barre de recherche du menu d'ajout ───────────────────────────────────
    const conteneurResultats = document.getElementById("resultats-recherche");
    const conteneurDefaut = document.getElementById("boutons-ajout-defaut");

    if (champRecherche) {
      champRecherche.addEventListener("input", (e) => {
        const requete = e.target.value.trim();
        if (!requete) {
          conteneurResultats.style.display = "none";
          conteneurDefaut.style.display = "grid";
          return;
        }
        conteneurDefaut.style.display = "none";
        conteneurResultats.style.display = "flex";
        afficherResultatsRecherche(conteneurResultats, window.rechercherElement(requete), requete, (res) => ouvrirModal(res.cible, res.titre));
      });
    }

    // ── Spotlight (Ctrl + K) ─────────────────────────────────────────────────
    const spotlightModal = document.getElementById("spotlight-modal");
    const spotlightInput = document.getElementById("spotlight-input");
    const spotlightResults = document.getElementById("spotlight-results");

    if (spotlightModal && spotlightInput) {
      document.addEventListener("keydown", (e) => {
        if (!(e.ctrlKey || e.metaKey) || e.key !== "k") return;
        e.preventDefault();
        if (spotlightModal.open) {
          spotlightModal.close();
        } else {
          spotlightModal.showModal();
          spotlightInput.value = "";
          spotlightResults.innerHTML = "";
          spotlightInput.focus();
        }
      });

      // Fermeture au clic en dehors de la boîte de dialogue
      spotlightModal.addEventListener("click", (e) => {
        const r = spotlightModal.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
          spotlightModal.close();
        }
      });

      // Recherche dans le spotlight — même moteur que le menu d'ajout
      spotlightInput.addEventListener("input", (e) => {
        const requete = e.target.value.trim();
        if (!requete) {
          spotlightResults.innerHTML = "";
          return;
        }
        afficherResultatsRecherche(spotlightResults, window.rechercherElement(requete), requete, (res) => {
          spotlightModal.close();
          ouvrirModal(res.cible, res.titre);
        });
      });

      attacherNavigationClavier(spotlightModal, spotlightInput);
    }

    // ── Détection souris vs. clavier (gestion des styles de focus) ───────────
    document.addEventListener("keydown", (e) => {
      if (e.key === "Tab" || e.key.startsWith("Arrow")) document.body.classList.add("navigation-clavier");
    });
    document.addEventListener("mousemove", () => document.body.classList.remove("navigation-clavier"));

    // Premier affichage
    calculerPaie();
    CONFIGS_RIST.forEach((cfg) => window[`resetHelper${cfg.nom}`]());
  } catch (erreur) {
    console.error("Erreur d'initialisation :", erreur);
  }
}

window.onload = initialiserApplication;

// =============================================================================
// 12. VISITE GUIDÉE (Driver.js)
// =============================================================================

/**
 * Démarre ou reprend la visite guidée interactive (propulsée par Driver.js).
 * Gère la reprise automatique après une pause causée par l'ouverture d'une modale.
 * Exposée sur `window` car appelée depuis le bouton flottant du HTML.
 *
 * @param {number} [startStep=0] - Index de l'étape de départ (0-indexé)
 */
window.lancerVisiteGuidee = function (startStep = 0) {
  window.isTourActive = true;

  window.tourObj = window.driver.js.driver({
    showProgress: true,
    nextBtnText: "Suivant ➔",
    prevBtnText: "⬅ Précédent",
    doneBtnText: "Terminer",
    allowClose: true,
    onDestroyed: () => {
      window.isTourActive = false;
      window.tourObj = null;
    },
    steps: [
      {
        element: ".info-table",
        popover: {
          title: "1. Votre Profil",
          side: "bottom",
          align: "start",
          description: "Bienvenue ! Commencez par définir votre grade, votre échelon, vos enfants à charge et la NBI pour initialiser votre base de traitement.",
        },
      },
      {
        element: "#row-201958",
        popover: {
          title: "2. Une paie sur-mesure",
          side: "bottom",
          align: "start",
          description: "Le tableau est interactif ! Cliquez sur n'importe quelle ligne de prime (comme la RIST ou l'ISQ) pour ajuster les valeurs selon votre centre.",
        },
      },
      {
        element: "#row-202206",
        popover: {
          title: "3. N'oubliez pas la CSG !",
          side: "top",
          align: "start",
          description: "Attention : l'Indemnité Compensatrice CSG est propre à chaque agent. Pensez bien à cliquer sur cette ligne pour saisir votre montant exact (indiqué sur votre vraie fiche).",
        },
      },
      {
        element: "#row-taux-impot",
        popover: {
          title: "4. Prélèvement à la Source",
          side: "top",
          align: "start",
          description: "Il est essentiel de bien régler votre taux d'imposition personnalisé pour avoir un Net à Payer réaliste. Cliquez ici pour le modifier.",
        },
      },
      {
        element: ".add-row",
        popover: {
          title: "5. Les éléments variables",
          side: "top",
          align: "center",
          description: "C'est ici que vous pourrez ajouter les options protocolaires, vos forfaits mobilités, nuits travaillées ou vos jours d'absence.",
        },
      },
      {
        element: ".pay-table-foot",
        popover: {
          title: "6. Le Verdict",
          side: "top",
          align: "end",
          description: "Vos charges, votre Net Social et votre Net à Payer se mettront à jour instantanément à chaque modification. Bonne simulation !",
        },
      },
    ],
  });

  window.tourObj.drive(startStep);
};
