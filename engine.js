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
//  12.  Visite guidée (Custom — zéro dépendance)
// =============================================================================

// =============================================================================
// 1. ÉTAT & CONFIGURATION GLOBALE
// =============================================================================

/** @type {Object} Base de données chargée depuis data.json */
let baseDonnees = {};

/** @type {boolean} Vrai si le mode comparaison de scénarios est actif */
let modeComparaison = false;

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
 * Flag : true tant que l'initialisation n'est pas terminée.
 * Empêche sauvegarderProfil() d'écraser le localStorage avec les valeurs
 * par défaut HTML avant que restaurerProfil() ait eu le temps de s'exécuter.
 */
let _initEnCours = true;

// =============================================================================
// 1c. TRACKING "CHAMPS À CONFIGURER" (onboarding par-champ)
// =============================================================================

/**
 * Clés de tous les champs qui doivent être explicitement configurés.
 * Un badge "À configurer" s'affiche sur chaque champ absent de _configures.
 */
const CHAMPS_REQUIS = new Set([
  "grade", "echelon", "enfants", "nbi", "zone_residence",
  "rist_fonctions", "rist_experience", "rist_isq_licence",
  "rist_isq_complement", "rist_isq_majoration",
  "ind_compensatrice_csg", "taux_pas",
]);

const CLE_CONFIGURES = "icna_configures_v1";
const CLE_PRIMES_MANUELLES = "icna_primes_manuelles_v1";

/**
 * Ensemble des champs déjà configurés par l'utilisateur.
 * Persisté séparément dans localStorage.
 */
let _configures = (() => {
  try {
    const saved = localStorage.getItem(CLE_CONFIGURES);
    if (saved) return new Set(JSON.parse(saved));
  } catch (_) {}
  return new Set();
})();

/** Marque un champ comme configuré, persiste, et notifie le watcher du tour.
 * FIX #10 — Performance : dispatch d'un CustomEvent "champ-configure" qui remplace
 * le polling setInterval(200ms) dans _tourActiverWatcher.
 */
function marquerConfigure(cle) {
  _configures.add(cle);
  try { localStorage.setItem(CLE_CONFIGURES, JSON.stringify([..._configures])); } catch (_) {}
  document.dispatchEvent(new CustomEvent("champ-configure", { detail: { cle } }));
}

/** Vrai si le champ n'a pas encore été configuré. */
const nonConfigure = (cle) => CHAMPS_REQUIS.has(cle) && !_configures.has(cle);
window.nonConfigure = nonConfigure;

/** Vrai si au moins un champ requis n'est pas encore configuré. */
const configurationIncomplete = () => [...CHAMPS_REQUIS].some(c => !_configures.has(c));

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
  // Primes mensuelles fixes
  { id: "input-attractivite", type: "select" },
  { id: "input-fidelisation", type: "select" },
  // PSC (cases à cocher cumulables)
  { id: "psc-15", type: "checkbox" },
  { id: "psc-7", type: "checkbox" },
  { id: "psc-5", type: "checkbox" },
];

/**
 * Lit tous les champs du profil permanent et les sauvegarde dans localStorage.
 * Appelée automatiquement à chaque recalcul.
 */
function sauvegarderProfil() {
  if (_initEnCours) return;
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
 * FIX #4 — Retourne l'objet profil brut (ou null) au lieu de true/false,
 * ce qui évite une seconde lecture de localStorage chez l'appelant.
 *
 * @returns {Object|null} Objet profil restauré, ou null si rien à restaurer
 */
function restaurerProfil() {
  let profil;
  try {
    const raw = localStorage.getItem(CLE_STOCKAGE);
    if (!raw) return null;
    profil = JSON.parse(raw);
  } catch (e) {
    console.warn("Restauration profil impossible :", e);
    return null;
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
  // _configures est déjà chargé depuis CLE_CONFIGURES au démarrage — on ne remar­que rien ici
  CONFIGS_RIST.forEach((cfg) => {
    const valeur = document.getElementById(cfg.inputId)?.value;
    document.querySelectorAll(`#${cfg.panelId} .rist-option`).forEach((div) => {
      div.classList.toggle("selected", div.dataset.value === valeur);
    });
  });

  return profil;
}

/**
 * Efface le profil sauvegardé et recharge la page.
 * Exposée sur `window` car appelable depuis un bouton HTML.
 */
window.effacerProfil = function () {
  localStorage.removeItem(CLE_STOCKAGE);
  localStorage.removeItem(CLE_CONFIGURES);
  localStorage.removeItem("icna_projection");
  localStorage.removeItem(CLE_PRIMES_MANUELLES);
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
  { titre: "✏️ Primes manuelles (saisie libre)", motsCles: ["manuel", "manuelle", "libre", "prime", "rappel", "exceptionnel", "autre", "divers"], cible: "panel-primes-manuelles" },
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
 * FIX #8 — Remplace TOUTES les virgules (regex /,/g) : String.replace(str,str) ne
 * remplaçait que la première occurrence, causant un NaN silencieux sur "1,5,0".
 * @param {string} id
 * @returns {number}
 */
function lireFloat(id) {
  const el = document.getElementById(id);
  if (!el) return 0;
  const v = el.value;
  if (v === "" || v === null) return 0;
  return parseFloat(String(v).replace(/,/g, ".")) || 0;
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

/**
 * Retarde l'exécution d'une fonction jusqu'à ce que `delai` ms se soient écoulées
 * sans nouvel appel. Utilisé sur les champs texte libres (PAS, CSG) pour éviter
 * de reconstruire le DOM du tableau à chaque keystroke.
 * FIX #9 — Performance : évite la reconstruction complète de ~35 <tr> à chaque touche.
 * @param {Function} fn
 * @param {number} [delai=150]
 * @returns {Function}
 */
function debounce(fn, delai = 150) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delai);
  };
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
    // FIX #1 — XSS : construction via API DOM, jamais via innerHTML avec entrée utilisateur
    const div = document.createElement("div");
    div.className = "resultat-vide";
    div.textContent = `Aucun élément trouvé pour "${requete}" 🕵️‍♂️`;
    conteneur.appendChild(div);
    return;
  }
  resultats.forEach((res) => {
    const btn = document.createElement("button");
    btn.className = "resultat-item";
    const spanTitre = document.createElement("span");
    spanTitre.textContent = res.titre;
    const spanArrow = document.createElement("span");
    spanArrow.style.cssText = "color:#aaa;font-size:12px;";
    spanArrow.textContent = "➔";
    btn.append(spanTitre, " ", spanArrow);
    btn.onclick = () => onSelect(res);
    conteneur.appendChild(btn);
  });
}

// =============================================================================
// 5. MENUS INTERACTIFS RIST / ISQ
// =============================================================================
// FIX #14 — RIST_INPUT_CLE_MAP et RIST_PANEL_CLE sont désormais dérivés de CONFIGS_RIST.
// Ajouter un menu RIST ne nécessite plus de modifier trois structures séparées.
// Note : CONFIGS_RIST est défini plus bas dans cette section ; les maps sont initialisées
// au moment du premier accès (après le chargement de CONFIGS_RIST).

// Ces deux constantes sont déclarées ici (avant creerMenuInteractif) mais remplies
// juste après CONFIGS_RIST via Object.fromEntries() — voir commentaire section CONFIGS_RIST.
// Pour permettre l'accès dans creerMenuInteractif (défini avant CONFIGS_RIST),
// on utilise des late-binding via des fonctions au lieu de constantes statiques.

/**
 * Map input ID → clé de configuration pour marquerConfigure().
 * FIX #14 — Dérivée automatiquement de CONFIGS_RIST (plus de synchronisation manuelle).
 * Initialisée après la déclaration de CONFIGS_RIST.
 * @type {Object.<string, string>}
 */
let RIST_INPUT_CLE_MAP = {};

/**
 * Map panel ID → clé de configuration pour le handler close de la modale.
 * FIX #14 — Dérivée automatiquement de CONFIGS_RIST.
 * Initialisée après la déclaration de CONFIGS_RIST.
 * @type {Object.<string, string>}
 */
let RIST_PANEL_CLE = {};

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
    // FIX #17 — Guard immédiat : le null check était APRÈS l'accès à .value (crash potentiel)
    const inputEl = getInput();
    if (!inputEl) return;
    inputEl.value = valeur;
    document.querySelectorAll(`#${panelId} .rist-option`).forEach((el) => el.classList.remove("selected"));
    document.querySelector(`#${panelId} .rist-option[data-value="${valeur}"]`)?.classList.add("selected");
    window[`resetHelper${nom}`]();
    inputEl.dataset.confirmed = "1";
    // Débloquer "Valider & Fermer" si il était bloqué (panels ISQ avec Aucune)
    const validateBtn = document.querySelector(`#${panelId} .validate-btn`);
    if (validateBtn) {
      validateBtn.disabled = false;
      validateBtn.removeAttribute("title");
    }
    // Marquer configuré immédiatement pour mise à jour en temps réel de la fiche.
    // Le tour ne réagit pas car _tourPauseParModal=true pendant la modale.
    if (RIST_INPUT_CLE_MAP[inputId]) marquerConfigure(RIST_INPUT_CLE_MAP[inputId]);
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
 * FIX #14 — Source unique de vérité : le champ `cle` permet de dériver automatiquement
 * RIST_INPUT_CLE_MAP et RIST_PANEL_CLE, éliminant la triple redondance.
 * @type {Array<{nom:string, cle:string, inputId:string, helperId:string, panelId:string, previewId:string, dataKey:string, placeholder:string}>}
 */
const CONFIGS_RIST = [
  {
    nom: "Rist",
    cle: "rist_fonctions",
    inputId: "input-fonction",
    helperId: "rist-helper-text",
    panelId: "panel-rist-fonctions",
    previewId: "preview-rist-fonctions",
    dataKey: "fonctions",
    placeholder: "Sélectionnez un niveau pour voir les fonctions...",
  },
  {
    nom: "Exp",
    cle: "rist_experience",
    inputId: "input-experience",
    helperId: "exp-helper-text",
    panelId: "panel-rist-experience",
    previewId: "preview-rist-experience",
    dataKey: "experience",
    placeholder: "Sélectionnez un niveau pour voir les grades correspondants...",
  },
  {
    nom: "IsqLicence",
    cle: "rist_isq_licence",
    inputId: "input-isq-licence",
    helperId: "isq-licence-helper-text",
    panelId: "panel-rist-isq-licence",
    previewId: "preview-rist-isq-licence",
    dataKey: "isq_licence",
    placeholder: "Sélectionnez un niveau pour voir l'affectation correspondante...",
  },
  {
    nom: "IsqComplement",
    cle: "rist_isq_complement",
    inputId: "input-isq-complement",
    helperId: "isq-complement-helper-text",
    panelId: "panel-rist-isq-complement",
    previewId: "preview-rist-isq-complement",
    dataKey: "isq_complement",
    placeholder: "Sélectionnez un niveau pour voir l'affectation correspondante...",
  },
  {
    nom: "IsqMajoration",
    cle: "rist_isq_majoration",
    inputId: "input-isq-majoration",
    helperId: "isq-majoration-helper-text",
    panelId: "panel-rist-isq-majoration",
    previewId: "preview-rist-isq-majoration",
    dataKey: "isq_majoration",
    placeholder: "Sélectionnez un niveau pour voir l'affectation correspondante...",
  },
];

// FIX #14 — Dérivation automatique des deux maps depuis CONFIGS_RIST (source unique)
RIST_INPUT_CLE_MAP = Object.fromEntries(CONFIGS_RIST.map(cfg => [cfg.inputId, cfg.cle]));
RIST_PANEL_CLE     = Object.fromEntries(CONFIGS_RIST.map(cfg => [cfg.panelId,  cfg.cle]));

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

  const inputEl        = document.getElementById(cfg.inputId);
  const valeurActuelle = inputEl?.value;
  const hasAucune      = Object.keys(section.montants).some(k => k === "Aucune" || k === "Aucun");
  const dejaConfirme   = inputEl?.dataset.confirmed === "1";
  // Ne montrer la sélection visuelle que si l'utilisateur a déjà fait un choix explicite
  const afficherSelection = !hasAucune || dejaConfirme;

  container.innerHTML = "";

  // FIX #7 — Feedback explicite si data.json est mal formé pour ce menu
  const entries = Object.entries(section.montants);
  if (entries.length === 0) {
    const msg = document.createElement("p");
    msg.className = "panel-hint";
    msg.style.color = "var(--color-danger)";
    msg.textContent = "Données indisponibles (data.json). Rechargez la page.";
    container.appendChild(msg);
    return;
  }

  entries.forEach(([niveau, montant]) => {
    const isSelected = afficherSelection && niveau === valeurActuelle;
    const div = document.createElement("div");
    div.className = "rist-option" + (isSelected ? " selected" : "");
    div.dataset.value = niveau;
    div.textContent = `${niveau} (${montant.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €)`;
    // FIX #12 — Accessibilité : option navigable au clavier et annoncée par les lecteurs d'écran
    div.setAttribute("role", "option");
    div.setAttribute("tabindex", "0");
    div.setAttribute("aria-selected", isSelected ? "true" : "false");
    div.addEventListener("mouseenter", () => window[`previewHelper${cfg.nom}`](niveau));
    div.addEventListener("click", () => window[`select${cfg.nom}`](niveau));
    div.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); window[`select${cfg.nom}`](niveau); }
    });
    container.appendChild(div);
  });

  // Panels ISQ : bloquer "Valider & Fermer" tant qu'aucun choix explicite n'a été fait
  const validateBtn = container.closest(".setting-panel")?.querySelector(".validate-btn");
  if (hasAucune && validateBtn) {
    if (dejaConfirme) {
      validateBtn.disabled = false;
      validateBtn.removeAttribute("title");
    } else {
      validateBtn.disabled = true;
      validateBtn.title = "Faites un choix explicite — même « Aucune » si ça ne s'applique pas.";
    }
  }
}

// =============================================================================
// 6. INTERFACE UTILISATEUR
// =============================================================================

/**
 * Trie les clés d'un objet d'échelons : numériques d'abord (1, 2, …), puis alphanumériques (HEA1…).
 * FIX #5 — Fonction partagée : évite l'incohérence entre le panneau principal et le comparateur.
 * @param {Object} echelonsObj - Objet dont les clés sont les noms d'échelon
 * @returns {string[]}
 */
function trierEchelons(echelonsObj) {
  return Object.keys(echelonsObj).sort((a, b) => {
    const [nA, nB] = [parseInt(a), parseInt(b)];
    const [isA, isB] = [!isNaN(nA), !isNaN(nB)];
    if (isA && isB) return nA - nB;
    if (isA) return -1;
    if (isB) return 1;
    return a.localeCompare(b);
  });
}

/**
 * Peuple le `<select>` des échelons selon le grade sélectionné.
 * Conserve l'échelon actif si celui-ci existe dans le nouveau grade.
 */
function mettreAJourEchelons() {
  const grade = document.getElementById("input-grade").value;
  const selectEchelon = document.getElementById("input-echelon");
  const echelonActuel = selectEchelon.value;

  selectEchelon.innerHTML = "";

  if (!grade) {
    // Grade non sélectionné — placeholder
    const opt = document.createElement("option");
    opt.value = "";
    opt.disabled = true;
    opt.selected = true;
    opt.textContent = "— Éch. —";
    selectEchelon.appendChild(opt);
    return;
  }

  const echelons = trierEchelons(baseDonnees.grilles_icna[grade] || {});

  // Placeholder en tête
  const ph = document.createElement("option");
  ph.value = ""; ph.disabled = true; ph.textContent = "— Éch. —";
  selectEchelon.appendChild(ph);

  echelons.forEach((ech) => {
    const opt = document.createElement("option");
    opt.value = ech;
    opt.textContent = ech;
    selectEchelon.appendChild(opt);
  });

  selectEchelon.value = echelons.includes(echelonActuel) ? echelonActuel : "";
}

/**
 * Ouvre la modale principale sur le panneau spécifié.
 * Si la visite guidée est active, elle est mise en pause et reprendra à la fermeture.
 *
 * @param {string|string[]} panelIds - ID du panneau cible, ou tableau d'IDs pour affichage multi-panneaux
 * @param {string}          titre    - Titre affiché dans l'en-tête de la modale
 */
function ouvrirModal(panelIds, titre) {
  // Pause de la visite guidée en cours + masquer l'UI tour pendant la modale
  if (window.isTourActive) {
    window._tourPauseParModal = true;
    const pop = document.getElementById("tour-popover");
    const sp  = document.getElementById("tour-spotlight");
    if (pop) pop.style.display = "none";
    if (sp)  sp.classList.add("tour-spotlight-invisible");
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
  // Mémoriser le panneau ouvert pour le gestionnaire de fermeture
  modal.dataset.panelOuvert = Array.isArray(panelIds) ? panelIds[0] : panelIds;

  // FIX #3 — Guard : showModal() lève DOMException si la dialog est déjà ouverte
  if (!modal.open) modal.showModal();

  // Auto-focus sur le champ principal si panel impôts ou CSG
  setTimeout(() => {
    if (panelIds === "panel-impots") document.getElementById("input-pas")?.focus();
    if (panelIds === "panel-csg")    document.getElementById("input-ind-csg")?.focus();
    document.querySelector(".setting-panel.active .rist-option.selected")?.scrollIntoView({ block: "center", behavior: "instant" });
  }, 50);
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
    // FIX #6 — La valeur de reset est la première option du select (toujours "0" dans cette appli).
    // L'ancienne détection via option[value="none"] était du dead code (aucune option "none" dans le HTML).
    if (el.tagName === "SELECT") el.value = el.options[0]?.value ?? "0";
    else if (el.type === "checkbox") el.checked = false;
    else el.value = "0";
  });
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

  // Lecture des primes manuelles depuis le panneau (deux sommes : imposable / non imposable)
  let manuelles_imposables = 0, manuelles_non_imposables = 0;
  document.querySelectorAll("#primes-manuelles-liste .prime-manuelle-row").forEach(row => {
    const montant   = parseFloat(row.querySelector(".pm-montant")?.value) || 0;
    const imposable = row.querySelector(".pm-imp-oui")?.checked !== false
                   && row.querySelector(".pm-imp-oui")?.checked === true;
    if (imposable) manuelles_imposables     += montant;
    else           manuelles_non_imposables += montant;
  });

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
      manuelles_imposables,
      manuelles_non_imposables,
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
    p.primes.inflation +
    p.primes.manuelles_imposables; // primes manuelles imposables seulement (CSG/CRDS/RAFP s'appliquent)

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
      (p.primes.attractivite > 0 ? p.primes.attractivite : 0) +
      // Primes manuelles : les deux types apparaissent dans le brut à payer
      (p.primes.manuelles_imposables     > 0 ? p.primes.manuelles_imposables     : 0) +
      (p.primes.manuelles_non_imposables > 0 ? p.primes.manuelles_non_imposables : 0),
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
  // Primes manuelles non imposables : exclues du net social et du net imposable (même traitement que FMD)
  const netSocial = arrondir(netAPayerAvantImpot - p.primes.forfait_mobilites - p.primes.psc - p.primes.manuelles_non_imposables + retenueIsq);
  const netImposableFinal = Math.max(0, netAPayerAvantImpot + csgNonDeductible + crds - p.primes.forfait_mobilites - p.primes.manuelles_non_imposables);
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
/**
 * Dessine la fiche de paie complète.
 * En mode comparaison (pB/mB fournis), affiche les lignes présentes dans A OU B :
 * — lignes A normales avec badge Δ si la valeur diffère
 * — lignes présentes dans B uniquement (ghost) en fond vert pâle
 *
 * @param {ProfilAgent}           p  - Profil A (affiché)
 * @param {MontantsCalcules}      m  - Résultat calculerMontants(p)
 * @param {ProfilAgent|null}      pB - Profil B (comparaison) ou null
 * @param {MontantsCalcules|null} mB - Résultat calculerMontants(pB) ou null
 */
function dessinerFiche(p, m, pB = null, mB = null) {
  const tbody = document.getElementById("lignes-paie");
  tbody.innerHTML = "";
  const enComparaison = pB !== null && mB !== null;

  const detailAbs = [m.joursGreve > 0 && `GREVE ${m.joursGreve}J`, m.joursCarence > 0 && `CAR ${m.joursCarence}J`, m.jours90 > 0 && `MAL 90% ${m.jours90}J`, m.jours50 > 0 && `MAL 50% ${m.jours50}J`]
    .filter(Boolean)
    .join(" // ");

  const tip = (base) => genererTooltipAbsence(base, m.joursGreve, m.joursCarence, m.jours90, m.jours50);

  // ── Helpers comparaison ───────────────────────────────────────────────────────
  /** Calcule le delta B-A, ou null si pas en mode comparaison */
  const deltaVal = (vA, vB) => enComparaison ? arrondir((vB ?? 0) - (vA ?? 0)) : null;
  /** Vrai si la ligne n'existe que dans B */
  const estGhost = (vA, vB) => enComparaison && !(vA > 0) && (vB > 0);
  /** Valeur à afficher : A si non nul, sinon B (ghost) */
  const affVal = (vA, vB) => (vA > 0) ? vA : (enComparaison && vB > 0 ? vB : vA);

  /**
   * Crée la paire de valeurs (A, B) pour une ligne comparative.
   * Factorise le pattern répété : `const A = p.x; const B = pB?.x ?? 0`
   * @param {number} vA  - Valeur scénario A
   * @param {number} [vB=0] - Valeur scénario B (optionnelle)
   * @returns {{ vA: number, vB: number, delta: number|null, isGhost: boolean, affiche: number }}
   */
  const paire = (vA, vB = 0) => ({
    vA,
    vB,
    delta:   deltaVal(vA, vB),
    isGhost: estGhost(vA, vB),
    affiche: affVal(vA, vB),
  });

  // ─────────────────────────────────────────────────────────────────────────────
  /**
   * Ajoute une ligne <tr> dans le tableau.
   * opts.delta / opts.deltaCol : badge Δ inline dans la colonne désignée (2/3/4)
   * opts.isGhost : fond vert pâle — ligne présente dans B uniquement
   */
  function ajouterLigne(code, libelle, aPayer, aDeduire, pourInfo, inputsAReset = null, tooltipMontant = null, customId = null, opts = {}) {
    const { delta = null, deltaCol = null, isGhost = false } = opts;
    const tr = document.createElement("tr");
    if (customId) tr.id = customId;
    else if (code) tr.id = `row-${code}`;

    const classes = [];
    const route = ROUTAGE_MODAL[code];
    if (route && !isGhost) {
      classes.push("clickable-row");
      tr.title = "Cliquez pour modifier";
      // FIX #11 — Accessibilité : rôle interactif + navigation clavier pour les lecteurs d'écran
      tr.setAttribute("role", "button");
      tr.setAttribute("tabindex", "0");
      tr.setAttribute("aria-label", `Modifier : ${libelle}`);
      tr.onclick = () => ouvrirModal(route.cible, route.titre);
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ouvrirModal(route.cible, route.titre); }
      });
    } else if (libelle.includes("TAUX PERSONNALISE") && !isGhost) {
      classes.push("clickable-row");
      tr.setAttribute("role", "button");
      tr.setAttribute("tabindex", "0");
      tr.setAttribute("aria-label", "Modifier : Prélèvement à la Source");
      tr.onclick = () => ouvrirModal("panel-impots", "Prélèvement à la Source");
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ouvrirModal("panel-impots", "Prélèvement à la Source"); }
      });
    }
    if (isGhost) classes.push("ligne-fantome-b");
    if (classes.length) tr.className = classes.join(" ");

    const isBold = code === "011100" || code === "011300";
    const hasValue = aPayer || aDeduire || pourInfo;
    const euroSymbol = hasValue ? `<span style="float:right;font-weight:normal;color:#555;">€</span>` : "";
    const croix = (inputsAReset && !isGhost)
      ? `<span class="delete-btn" title="Retirer cet élément" onclick="window.effacerValeurs(event, ${JSON.stringify(inputsAReset).replace(/"/g, "'")})">✖</span>`
      : "";

    const renderDeltaBadge = (col) => {
      // Pas de badge sur les lignes fantômes (le fond vert suffit) ni hors mode comparaison
      if (isGhost || !enComparaison || delta === null || Math.abs(delta) < 0.005 || deltaCol !== col) return "";
      const estDeduction = col === 3;
      const estPositif   = estDeduction ? delta < 0 : delta > 0;
      const signe        = delta > 0 ? "+" : "";
      return `<span class="delta-badge ${estPositif ? "delta-pos" : "delta-neg"}">${signe}${delta.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`;
    };

    const fmtCell = (val, col) => {
      const badge = renderDeltaBadge(col);
      if (!val) return badge;
      const txt = formaterMontant(val);
      const displayed = tooltipMontant
        ? `<span title="${tooltipMontant}" style="cursor:help;border-bottom:1px dotted var(--dgfip-medium);">${txt}</span>`
        : txt;
      return displayed + badge;
    };

    tr.innerHTML = `
      <td class="col-code">${code || ""}</td>
      <td class="col-libelle label${isBold ? " font-large" : ""}"><span>${libelle}</span>${croix} ${euroSymbol}</td>
      <td class="col-amount">${fmtCell(aPayer, 2)}</td>
      <td class="col-amount">${fmtCell(aDeduire, 3)}</td>
      <td class="col-amount">${fmtCell(pourInfo, 4)}</td>
    `;
    tbody.appendChild(tr);
  }

  /**
   * Ajoute une ligne RIST avec gestion du delta comparaison et des lignes d'absence.
   * Supporte les lignes fantômes (présentes dans B uniquement).
   */
  function ajouterLigneRist(code, libelle, montantA, absence, montantB = 0) {
    const montantAff = affVal(montantA, montantB);
    const delta      = deltaVal(montantA, montantB);
    const isGhost    = estGhost(montantA, montantB);
    // N'affiche rien si les deux scénarios sont à 0
    if (!montantAff && !isGhost) return;
    ajouterLigne(code, libelle, montantAff, null, null, null, null, null, { delta, deltaCol: 2, isGhost });
    if (m.joursAbs > 0 && !isGhost) {
      ajouterLigne(code, libelle, -absence, null, null, null, tip(montantA));
      ajouterLigne("", `&nbsp;&nbsp;&nbsp;&nbsp;${detailAbs}`, null, null, null);
    }
  }
  // ── Helper badge "À configurer" ───────────────────────────────────────────
  const badgeSiVierge = (cle, panelCible, titreCible) => {
    if (!nonConfigure(cle)) return null;
    // FIX #13 — Accessibilité : <button> est focusable et annoncé par les lecteurs d'écran ;
    // un <span onclick> ne l'est pas.
    return `<button type="button" class="badge-configurer"
      onclick="ouvrirModal('${panelCible}','${titreCible}')"
      aria-label="Configurer : ${titreCible}">⚙ À configurer</button>`;
  };

  function ajouterLigneAvecBadge(code, libelle, cle, valeur, colonne, panelCible, titreCible, opts = {}) {
    const badge = badgeSiVierge(cle, panelCible, titreCible);
    if (badge) {
      const tr = document.createElement("tr");
      if (code) tr.id = `row-${code}`;
      tr.innerHTML = `
        <td class="col-code">${code}</td>
        <td class="col-libelle label"><span>${libelle}</span></td>
        ${colonne === 2 ? `<td class="col-amount">${badge}</td><td class="col-amount"></td><td class="col-amount"></td>` : ""}
        ${colonne === 3 ? `<td class="col-amount"></td><td class="col-amount">${badge}</td><td class="col-amount"></td>` : ""}
      `;
      tbody.appendChild(tr);
    } else {
      const aPayer   = colonne === 2 ? valeur : null;
      const aDeduire = colonne === 3 ? valeur : null;
      if (valeur > 0) ajouterLigne(code, libelle, aPayer, aDeduire, null, null, null, null, opts);
    }
  }

  function ajouterLigneRistAvecBadge(code, libelle, cle, montantA, absence, panelCible, titreCible, montantB = 0) {
    const badge = badgeSiVierge(cle, panelCible, titreCible);
    if (badge && !enComparaison) {
      const tr = document.createElement("tr");
      tr.id = `row-${code}`;
      tr.innerHTML = `
        <td class="col-code">${code}</td>
        <td class="col-libelle label"><span>${libelle}</span></td>
        <td class="col-amount">${badge}</td>
        <td class="col-amount"></td>
        <td class="col-amount"></td>
      `;
      tbody.appendChild(tr);
    } else {
      ajouterLigneRist(code, libelle, montantA, absence, montantB);
    }
  }
  // ─────────────────────────────────────────────────────────────────────────────
  if (m.joursAbs > 0) {
    const totalAbsDed = m.absTraitement + m.absNbi + m.absResidence + m.absRistFct + m.absRistExp + m.absRistIsq + m.absRistCplt + m.absRistMaj + m.absIndCsg;
    const baseTotale  = m.traitementBrut + m.montantNbi + m.indemniteResidence + p.primes.rist_fonctions + p.primes.rist_exper_prof + p.primes.rist_lic_isq + p.primes.rist_cplt_lic_isq + p.primes.rist_maj_isq + p.primes.ind_compensatrice_csg;
    ajouterLigne("604958", `SERVICE NON FAIT / ABSENCE (${m.joursAbs} J)`, null, null, totalAbsDed, ["input-greve", "input-carence", "input-maladie-90", "input-maladie-50"], tip(baseTotale));
  }

  // ── Traitement brut & NBI ─────────────────────────────────────────────────────
  ajouterLigne("101000", "TRAITEMENT BRUT", m.traitementBrut || 0, null, null, null, null, null,
    { delta: deltaVal(m.traitementBrut, mB?.traitementBrut), deltaCol: 2 });

  const nbiA = m.montantNbi; const nbiB = mB?.montantNbi ?? 0;
  if (nbiA > 0 || estGhost(nbiA, nbiB)) {
    ajouterLigne("101070", "TRAITEMENT BRUT N.B.I.", affVal(nbiA, nbiB), null, null, null, null, null,
      { delta: deltaVal(nbiA, nbiB), deltaCol: 2, isGhost: estGhost(nbiA, nbiB) });
    if (m.joursAbs > 0 && nbiA > 0) {
      ajouterLigne("101070", "TRAITEMENT BRUT N.B.I.", -m.absNbi, null, null, null, tip(nbiA));
      ajouterLigne("", `&nbsp;&nbsp;&nbsp;&nbsp;${detailAbs}`, null, null, null);
    }
  }

  if (m.montantSFT > 0) ajouterLigne("200200", "SUPPLEMENT FAMILIAL DE TRAITEMENT", m.montantSFT, null, null);

  // ── Retenues PC ──────────────────────────────────────────────────────────────
  ajouterLigne("101050", "RETENUE PC", null, m.retenuePC, null, null, null, null,
    { delta: deltaVal(m.retenuePC, mB?.retenuePC), deltaCol: 3 });
  const pcNbiA = m.retenuePcNbi; const pcNbiB = mB?.retenuePcNbi ?? 0;
  if (pcNbiA > 0 || estGhost(pcNbiA, pcNbiB)) {
    ajouterLigne("101080", "RET P.C. SUR N.B.I.", null, affVal(pcNbiA, pcNbiB), null, null, null, null,
      { delta: deltaVal(pcNbiA, pcNbiB), deltaCol: 3, isGhost: estGhost(pcNbiA, pcNbiB) });
  }

  // ── Indemnité de résidence ────────────────────────────────────────────────────
  ajouterLigneRistAvecBadge("102000", "INDEMNITE DE RESIDENCE", "zone_residence", m.indemniteResidence, 0,
    "panel-residence", "Zone de Résidence", mB?.indemniteResidence ?? 0);

  // ── Éléments variables ────────────────────────────────────────────────────────
  if (m.nuit > 0) ajouterLigne("200176", "IND. TRAVAIL DE NUIT", m.nuit, null, null, ["input-nuit-n", "input-nuit-s2"]);

  const fmd = paire(p.primes.forfait_mobilites, pB?.primes.forfait_mobilites);
  if (fmd.affiche > 0 || fmd.isGhost)
    ajouterLigne("200041", "FORF. MOBILITES DURABLES", fmd.affiche, null, null, ["input-fmd"], null, null,
      { delta: fmd.delta, deltaCol: 2, isGhost: fmd.isGhost });

  const infl = paire(p.primes.inflation, pB?.primes.inflation);
  if (infl.affiche > 0 || infl.isGhost)
    ajouterLigne("201000", "INDEM. GARANTIE POUVOIR D'ACHAT", infl.affiche, null, null, ["input-inflation"], null, null,
      { delta: infl.delta, deltaCol: 2, isGhost: infl.isGhost });

  // ── RIST (5 composantes) ──────────────────────────────────────────────────────
  ajouterLigneRistAvecBadge("201958", "RIST PART FONCTIONS",      "rist_fonctions",       p.primes.rist_fonctions,        m.absRistFct,  "panel-rist-fonctions",      "Ristourne Part Fonctions",    pB?.primes.rist_fonctions    ?? 0);
  ajouterLigneRistAvecBadge("201959", "RIST PART EXPER. PROF.",   "rist_experience",      p.primes.rist_exper_prof,       m.absRistExp,  "panel-rist-experience",     "Ristourne Part Expérience",   pB?.primes.rist_exper_prof   ?? 0);
  ajouterLigneRistAvecBadge("201960", "RIST PART LIC-ISQ (ICNA)", "rist_isq_licence",     p.primes.rist_lic_isq,          m.absRistIsq,  "panel-rist-isq-licence",    "Ristourne Part LIC-ISQ",      pB?.primes.rist_lic_isq      ?? 0);
  ajouterLigneRistAvecBadge("201961", "RIST CPLT PART LIC-ISQ",   "rist_isq_complement",  p.primes.rist_cplt_lic_isq,     m.absRistCplt, "panel-rist-isq-complement", "Ristourne CPLT Part LIC-ISQ", pB?.primes.rist_cplt_lic_isq ?? 0);
  ajouterLigneRistAvecBadge("201962", "MAJORATION CPLT ISQ",      "rist_isq_majoration",  p.primes.rist_maj_isq,          m.absRistMaj,  "panel-rist-isq-majoration", "Majoration Complément ISQ",   pB?.primes.rist_maj_isq      ?? 0);
  ajouterLigneRistAvecBadge("202206", "IND. COMPENSATRICE CSG",   "ind_compensatrice_csg",p.primes.ind_compensatrice_csg, m.absIndCsg,   "panel-csg",                 "Indemnité Compensatrice CSG", pB?.primes.ind_compensatrice_csg ?? 0);

  // ── PSC ───────────────────────────────────────────────────────────────────────
  const psc = paire(m.psc, mB?.psc);
  if (psc.affiche > 0 || psc.isGhost)
    ajouterLigne("202354", "PARTICIPATION A LA PSC", psc.affiche, null, null, ["psc-15", "psc-7", "psc-5"], null, null,
      { delta: psc.delta, deltaCol: 2, isGhost: psc.isGhost });

  if (p.evenements.prime_performance > 0) ajouterLigne("202485", "PR. PARTAGE PERFORMANCE", p.evenements.prime_performance, null, null, ["input-perf"]);

  // ── OTT ───────────────────────────────────────────────────────────────────────
  const ottPv = paire(p.evenements.ott_pv_globale, pB?.evenements.ott_pv_globale);
  if (ottPv.affiche > 0 || ottPv.isGhost)
    ajouterLigne("202558", "RIST ORGA TEMPS TRAVAIL (PV)", ottPv.affiche, null, null, ["pv-globale"], null, null,
      { delta: ottPv.delta, deltaCol: 2, isGhost: ottPv.isGhost });

  const ottPf = paire(p.evenements.ott_pf, pB?.evenements.ott_pf);
  if (ottPf.affiche > 0 || ottPf.isGhost)
    ajouterLigne("202559", "RIST ORGA TEMPS TRAVAIL (PF)", ottPf.affiche, null, null,
      ["pf-manuel","pf-opt1-l16","pf-opt1-cdg","pf-opt1-l711","pf-opt1-l911","pf-opt1-plus-n1","pf-opt1-plus-n2","pf-opt2-1","pf-opt2-2","pf-opt2-bis","pf-opt4","pf-opt1-enac","pf-opt1-plus-enac"], null, null,
      { delta: ottPf.delta, deltaCol: 2, isGhost: ottPf.isGhost });

  const pv32 = paire(p.evenements.ott_pv_opt32, pB?.evenements.ott_pv_opt32);
  if (pv32.affiche > 0 || pv32.isGhost)
    ajouterLigne("202560", "RIST ORGA TEMPS TRAVAIL (PV OPT 3-1 / 3-2)", pv32.affiche, null, null, ["pv-opt32"], null, null,
      { delta: pv32.delta, deltaCol: 2, isGhost: pv32.isGhost });

  // ── Fidélisation & Attractivité ───────────────────────────────────────────────
  const fid = paire(p.primes.fidelisation, pB?.primes.fidelisation);
  if (fid.affiche > 0 || fid.isGhost)
    ajouterLigne("203001", "PRIME DE FIDELISATION TERR.", fid.affiche, null, null, ["input-fidelisation"], null, null,
      { delta: fid.delta, deltaCol: 2, isGhost: fid.isGhost });

  const attr = paire(p.primes.attractivite, pB?.primes.attractivite);
  if (attr.affiche > 0 || attr.isGhost)
    ajouterLigne("203002", "ATTRACTIVITE GEOGRAPHIQUE", attr.affiche, null, null, ["input-attractivite"], null, null,
      { delta: attr.delta, deltaCol: 2, isGhost: attr.isGhost });

  // Previews des totaux OTT dans le panneau de configuration
  majPreview("preview-ott-pf", p.evenements.ott_pf);
  majPreview("preview-ott-pv", p.evenements.ott_pv_globale + p.evenements.ott_pv_opt32);

  // ── Primes manuelles (insérées juste avant la CSG) ──────────────────────────
  _getPrimesManuelles().forEach(({ libelle, montant, imposable }, i) => {
    if (montant <= 0) return;
    const rowId   = `row-pm-${i}`;
    const tooltip = imposable ? null : "Non imposable (exclu du net imposable et du PAS)";
    ajouterLigne("", libelle.toUpperCase(), montant, null, null, null, tooltip, rowId);
    const tr = document.getElementById(rowId);
    if (tr) {
      // ── Croix ✖ — injectée directement dans la cellule libellé (FIX Bug 3)
      // effacerValeurs() ne fonctionne pas ici (pas d'input ID fixe) →
      // on utilise supprimerPrimeManuelle(i) dédié aux lignes dynamiques.
      const cellLib = tr.querySelector(".col-libelle");
      if (cellLib) {
        const croix = document.createElement("span");
        croix.className = "delete-btn";
        croix.title     = "Retirer cette prime";
        croix.textContent = "✖";
        croix.addEventListener("click", e => { e.stopPropagation(); window.supprimerPrimeManuelle(i); });
        cellLib.appendChild(croix);
      }
      // ── Ligne cliquable pour ouvrir le panneau de gestion
      tr.classList.add("clickable-row");
      tr.title = "Cliquez pour modifier les primes manuelles";
      tr.setAttribute("role", "button");
      tr.setAttribute("tabindex", "0");
      tr.setAttribute("aria-label", "Modifier les primes manuelles");
      tr.onclick = () => ouvrirModal("panel-primes-manuelles", "✏️ Primes manuelles");
      tr.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ouvrirModal("panel-primes-manuelles", "✏️ Primes manuelles"); }
      });
    }
  });

  // ── Cotisations ───────────────────────────────────────────────────────────────
  ajouterLigne("401201", "C.S.G. NON DEDUCTIBLE",     null, m.csgNonDeductible, null, null, null, null, { delta: deltaVal(m.csgNonDeductible, mB?.csgNonDeductible), deltaCol: 3 });
  ajouterLigne("401301", "C.S.G. DEDUCTIBLE",         null, m.csgDeductible,    null, null, null, null, { delta: deltaVal(m.csgDeductible,    mB?.csgDeductible),    deltaCol: 3 });
  ajouterLigne("401501", "C.R.D.S.",                  null, m.crds,             null, null, null, null, { delta: deltaVal(m.crds,             mB?.crds),             deltaCol: 3 });
  ajouterLigne("403301", "COTIS PATRON. ALLOC FAMIL", null, null, m.charges.patAllocFam);
  ajouterLigne("403397", "COT PAT AF MAJORATION",     null, null, m.charges.patAfMajor);
  ajouterLigne("403501", "COT PAT FNAL DEPLAFONNEE",  null, null, m.charges.patFnal);
  ajouterLigne("403801", "CONT SOLIDARITE AUTONOMIE", null, null, m.charges.patCsa);
  ajouterLigne("404001", "COT PAT MALADIE DEPLAFON",  null, null, m.charges.patMaladie);
  ajouterLigne("411050", "CONTRIB.PC",                null, null, m.charges.patPensions);
  ajouterLigne("411058", "CONTRIBUTION ATI",          null, null, m.charges.patAti);
  ajouterLigne("501080", "COT SAL RAFP",              null, m.cotisationRafp,   null, null, null, null, { delta: deltaVal(m.cotisationRafp, mB?.cotisationRafp), deltaCol: 3 });
  ajouterLigne("501180", "COT PAT RAFP",              null, null, m.charges.patRafp);
  ajouterLigne("554500", "COT PAT VST MOBILITE",      null, null, m.charges.patMobilite);

  if (m.joursAbs > 0) {
    ajouterLigne("604958", "PREC. CARENCE REM. PR.",    null, m.absTraitement, null, null, tip(m.traitementBrut));
    ajouterLigne("604959", "PREC. CARENCE IND. RESID.", null, m.absResidence,  null, null, tip(m.indemniteResidence));
  }

  const gradeEchelonPrets = !nonConfigure("grade") && !nonConfigure("echelon");

  if (gradeEchelonPrets) {
    ajouterLigne("604970", "TRANSFERT PRIMES / POINTS", null, m.transfertPrimes, null, null, null, null, { delta: deltaVal(m.transfertPrimes, mB?.transfertPrimes), deltaCol: 3 });
    ajouterLigne("751095", "24,6% ISQ",                 null, m.retenueIsq,      null, null, null, null, { delta: deltaVal(m.retenueIsq,      mB?.retenueIsq),      deltaCol: 3 });

    // ── Nets ──────────────────────────────────────────────────────────────────────
    ajouterLigne("", "", null, null, null);
    ajouterLigne("011100", "NET A PAYER AVANT IMPOT SUR LE REVENU", null, null, m.netAPayerAvantImpot, null, null, null,
      { delta: deltaVal(m.netAPayerAvantImpot, mB?.netAPayerAvantImpot), deltaCol: 4 });
    ajouterLigne("011300", "MONTANT NET SOCIAL", null, null, m.netSocial);
  }
  ajouterLigne("558000", "IMPOT SUR LE REVENU PRELEVE A LA SOURCE", null, m.impotSource, null, null, null, null,
    { delta: deltaVal(m.impotSource, mB?.impotSource), deltaCol: 3 });
  if (nonConfigure("taux_pas")) {
    const tr = document.createElement("tr");
    tr.id = "row-taux-impot";
    tr.innerHTML = `
      <td class="col-code"></td>
      <td class="col-libelle label" colspan="4">
        <span class="badge-configurer" onclick="ouvrirModal('panel-impots','Prélèvement à la Source')">⚙ Taux PAS à configurer</span>
      </td>
    `;
    tbody.appendChild(tr);
  } else {
    ajouterLigne("", `(TAUX PERSONNALISE ${formaterMontant(p.taux_pas * 100)}%)`, null, null, null, null, null, "row-taux-impot");
  }

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
  const pending = configurationIncomplete();
  const showEl  = (id, show) => { const el = document.getElementById(id); if (el) el.style.display = show ? "" : "none"; };
  showEl("footer-config-pending", pending);
  showEl("footer-real-1", !pending);
  showEl("footer-real-2", !pending);
  showEl("footer-real-3", !pending);

  if (!pending) {
    document.getElementById("ui-total-a-payer").textContent      = formaterMontant(m.totalAPayer);
    document.getElementById("ui-total-a-deduire").textContent    = formaterMontant(m.totalADeduire);
    document.getElementById("ui-cout-employeur").textContent     = formaterMontant(m.coutTotalEmployeur);
    document.getElementById("ui-charges-patronales").textContent = formaterMontant(m.totalPatronal);
    document.getElementById("ui-net-a-payer").textContent        = (m.netFinal === 0 ? "0,00" : formaterMontant(m.netFinal)) + " €";
    document.getElementById("ui-net-imposable").textContent      = m.netImposableFinal === 0 ? "0,00" : formaterMontant(m.netImposableFinal);
  }

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

    // Si la visite guidée est active, rafraîchir le positionnement du spotlight/popover
    if (window.isTourActive && !window._tourPauseParModal) {
      setTimeout(() => {
        if (!window.isTourActive || window._tourPauseParModal) return;
        const step = _tourSteps?.[window._tourEtapeIndex];
        if (!step) return;

        if (step.isRist) {
          // RIST : repositionner uniquement sur l'élément déjà actif
          if (_ristElActif) {
            _tourSpotlightSur(_ristElActif);
            _tourPositionnerPopover(_ristElActif);
          }
        } else {
          const el = step.element ? document.querySelector(step.element) : null;
          _tourSpotlightSur(el);
          _tourPositionnerPopover(el);
        }
      }, 50);
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
  const profilA = getProfilDepuisInterface();
  const mA      = calculerMontants(profilA);
  majPreview("preview-nuits",              mA.nuit);
  majPreview("preview-rist-fonctions",     profilA.primes.rist_fonctions);
  majPreview("preview-rist-experience",    profilA.primes.rist_exper_prof);
  majPreview("preview-rist-isq-licence",   profilA.primes.rist_lic_isq);
  majPreview("preview-rist-isq-complement",profilA.primes.rist_cplt_lic_isq);
  majPreview("preview-rist-isq-majoration",profilA.primes.rist_maj_isq);

  const profilB = modeComparaison ? getProfilComparaisonDepuisPanneau() : null;
  const mB      = profilB ? calculerMontants(profilB) : null;

  dessinerFiche(profilA, mA, profilB, mB);
  majDeltaNet(mA, mB);

  // Vue mobile — liste condensée (Option D)
  // dessinerFicheMobile est appelée dans tous les cas (is-mobile vérifié en CSS)
  // pour que ui-net-a-payer soit à jour pour la barre sticky
  if (document.body.classList.contains("is-mobile")) {
    dessinerFicheMobile(profilA, mA);
  }

  // Indice — affiché seulement quand grade+échelon configurés
  const elIndice = document.getElementById("ui-indice");
  if (elIndice) {
    elIndice.textContent = (!nonConfigure("grade") && !nonConfigure("echelon") && mA.indice)
      ? String(mA.indice).padStart(4, "0")
      : "—";
  }

  // Badges "À configurer" sur les champs de l'info-table
  const champInfoTable = {
    "grade":          "input-grade",
    "echelon":        "input-echelon",
    "enfants":        "input-enfants",
    "nbi":            "nbi-cell",
    "zone_residence": "zone-radios-wrap",
  };
  Object.entries(champInfoTable).forEach(([cle, elId]) => {
    const el = document.getElementById(elId);
    if (el) el.classList.toggle("champ-non-configure", nonConfigure(cle));
  });

  // Boutons flottants + add-row + Ctrl+K — désactivés si config incomplète
  const pending = configurationIncomplete();
  ["btn-comparer-flottant", "btn-projection-flottant", "btn-visite-avance-flottant"].forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled = pending;
    btn.title = pending ? "Complétez votre profil pour accéder à cette fonctionnalité" : "";
    btn.classList.toggle("btn-flottant-disabled", pending);
  });

  // Add-row : griser si pending
  const addRow = document.querySelector(".add-row");
  if (addRow) {
    addRow.classList.toggle("add-row-disabled", pending);
    addRow.style.pointerEvents = pending ? "none" : "";
    addRow.style.opacity       = pending ? "0.35" : "";
    addRow.title               = pending ? "Complétez votre profil pour ajouter des éléments variables" : "";
  }
  // Ctrl+K — flag lu dans le handler keydown
  window._spotlightBloque = pending;

  sauvegarderProfil();

  // Mobile — recalcule la hauteur du wrapper + met à jour la barre NET
  if (document.body.classList.contains("is-mobile")) {
    _majHauteurWrapper(); // async via rAF, met à jour #fiche-scaler-wrap
  }
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
    // Ne pas intercepter si le focus est sur n'importe quel champ éditable
    const actif = document.activeElement;
    const estEditable = actif && (
      actif.tagName === "INPUT" ||
      actif.tagName === "TEXTAREA" ||
      actif.isContentEditable
    );
    if (estEditable) return;
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

    // Initialisation du panneau comparateur de scénarios
    initialiserComparateur();

    // Restauration du profil sauvegardé (après peuplement des listes)
    // FIX #4 — restaurerProfil() retourne l'objet profil : pas besoin de relire localStorage
    const profilSauve = restaurerProfil();
    // Restauration des primes manuelles (clé localStorage séparée — liste dynamique)
    _restaurerPrimesManuelles();
    if (profilSauve) {
      // Le grade restauré peut avoir changé → reconstruire les échelons
      mettreAJourEchelons();
      // Réappliquer l'échelon sauvegardé (mettreAJourEchelons() remet sur le premier)
      const echelonSauve = profilSauve["input-echelon"];
      if (echelonSauve) document.getElementById("input-echelon").value = echelonSauve;
    }

    // Changement de grade → marquer + échelons + recalcul
    document.getElementById("input-grade").addEventListener("input", () => {
      marquerConfigure("grade");
      mettreAJourEchelons();
      calculerPaie();
    });

    // Échelon — marquer sur `input` (avant calculerPaie global) + rappel calculerPaie
    document.getElementById("input-echelon").addEventListener("input", () => {
      if (document.getElementById("input-echelon").value) {
        marquerConfigure("echelon");
        calculerPaie();
      }
    });

    // Enfants — change uniquement (après sélection réelle d'une valeur)
    document.getElementById("input-enfants").addEventListener("change", () => {
      if (document.getElementById("input-enfants").value !== "") {
        marquerConfigure("enfants");
        calculerPaie();
      }
    });

    // NBI — auto-débadge à la coche, la croix est gérée via marquerConfigure('nbi') dans le HTML
    document.getElementById("input-nbi-checkbox").addEventListener("input", () => {
      marquerConfigure("nbi");
      calculerPaie();
    });

    // Zone de résidence — marquer dès qu'un radio est cliqué
    document.querySelectorAll("input[name='ir-zone']").forEach((radio) => {
      radio.addEventListener("change", () => { marquerConfigure("zone_residence"); calculerPaie(); });
    });

    // ── Validation et restrictions de saisie ─────────────────────────────────

    // Table des bornes par champ number
    const BORNES = {
      "input-nuit-n":      { min: 0, max: 30,   entier: true  },
      "input-nuit-s2":     { min: 0, max: 30,   entier: true  },
      "input-greve":       { min: 0, max: 31,   entier: true  },
      "input-carence":     { min: 0, max: 3,    entier: true  },
      "input-maladie-90":  { min: 0, max: 31,   entier: true  },
      "input-maladie-50":  { min: 0, max: 31,   entier: true  },
      "input-perf":        { min: 0, max: null, entier: false },
      "pv-globale":        { min: 0, max: null, entier: false },
      "pv-opt32":          { min: 0, max: null, entier: false },
      "cmp-pv-globale":    { min: 0, max: null, entier: false },
      "cmp-pv-opt32":      { min: 0, max: null, entier: false },
      // projection
      "proj-nuits":        { min: 0, max: 30,  entier: true  },
      "proj-soirees":      { min: 0, max: 30,  entier: true  },
      "proj-ottPv":        { min: 0, max: null, entier: false },
      "proj-ottPv32":      { min: 0, max: null, entier: false },
      "proj-ppp":          { min: 0, max: null, entier: false },
      "proj-fmd":          { min: 0, max: 300,  entier: false },
      "pf-manuel":         { min: 0, max: null, entier: false },
      "input-inflation":   { min: 0, max: null, entier: false },
    };

    document.querySelectorAll('.magic-modal input[type="number"]').forEach((champ) => {
      const borne = BORNES[champ.id] || { min: 0, max: null, entier: false };
      const rappelCalcul = champ.id.startsWith("proj-")
        ? () => window.calculerEtAfficherProjection?.()
        : calculerPaie;
      champ.addEventListener("input", function () {
        if (this.value === "") return;
        let val = parseFloat(this.value);
        if (isNaN(val)) { this.value = "0"; return; }
        if (borne.entier) val = Math.floor(val);
        if (val < borne.min) val = borne.min;
        if (borne.max !== null && val > borne.max) val = borne.max;
        this.value = val;
        rappelCalcul();
      });
      champ.addEventListener("blur", function () {
        if (this.value === "") {
          this.value = borne.entier ? "0" : "0.00";
          rappelCalcul();
        }
      });
      champ.addEventListener("keydown", function (e) {
        const ok = ["Backspace","Delete","Tab","Escape","Enter","ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End","."];
        if (ok.includes(e.key)) return;
        if (e.ctrlKey || e.metaKey) return;
        if (!/^\d$/.test(e.key)) e.preventDefault();
      });
    });

    // Tous les champs du formulaire principal déclenchent un recalcul
    // (exclure input-pas, input-ind-csg et tous les type=number qui ont leur propre listener BORNES)
    document.querySelectorAll(".magic-modal select, .magic-modal input, .info-table select, .info-table input")
      .forEach((input) => {
        if (input.id === "input-pas" || input.id === "input-ind-csg") return;
        if (input.type === "number") return; // géré par BORNES qui appelle calculerPaie après correction
        input.addEventListener("input", calculerPaie);
      });

    // Taux PAS et Ind. CSG — type=text, listener unique backspace-safe
    // FIX #9 — debounce(150ms) : ces champs texte déclenchaient calculerPaie() à chaque touche,
    // ce qui reconstruisait les ~35 <tr> inutilement pendant la frappe.
    const creerListenerChampLibre = (id, cle, maxVal) => {
      const el = document.getElementById(id);
      if (!el) return;
      // Bloquer les lettres à la frappe
      el.addEventListener("keydown", function (e) {
        const ok = ["Backspace","Delete","Tab","Escape","Enter","ArrowLeft","ArrowRight","Home","End"];
        if (ok.includes(e.key)) return;
        if (e.ctrlKey || e.metaKey) return;
        if (!/[\d.,]/.test(e.key)) e.preventDefault();
      });
      el.addEventListener("input", debounce(function () {
        const v = this.value.replace(/,/g, ".");
        const n = parseFloat(v);
        if (maxVal !== null && !isNaN(n) && n > maxVal) this.value = String(maxVal);
        if (!isNaN(n) && v !== "") marquerConfigure(cle);
        calculerPaie();
      }, 150));
    };
    creerListenerChampLibre("input-pas",     "taux_pas",             100);
    creerListenerChampLibre("input-ind-csg", "ind_compensatrice_csg", null);

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

    // Fermeture de la modale → marquer le champ RIST configuré si c'était un panneau RIST,
    // puis reprendre le tour.
    // FIX #14 — Utilise RIST_PANEL_CLE module-level dérivée de CONFIGS_RIST (plus de doublon)
    modal.addEventListener("close", () => {
      const cle = RIST_PANEL_CLE[modal.dataset.panelOuvert];
      if (cle) {
        // BUGFIX — Ne marquer configuré que si l'utilisateur a EXPLICITEMENT cliqué une option.
        // dataset.confirmed = "1" est posé par select${nom}() uniquement au clic sur une option.
        // Sans cette garde, fermer via Échap ou clic extérieur marquait le champ comme configuré
        // et faisait avancer le tour à tort vers la ligne RIST suivante.
        const cfg     = CONFIGS_RIST.find(c => c.panelId === modal.dataset.panelOuvert);
        const inputEl = cfg ? document.getElementById(cfg.inputId) : null;
        if (!inputEl || inputEl.dataset.confirmed === "1") marquerConfigure(cle);
      }

      if (!window._tourPauseParModal) return;
      window._tourPauseParModal = false;
      setTimeout(() => window._tourReprendreApresModal?.(), 150);
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
        if (window._spotlightBloque) return; // config incomplète
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
    _initEnCours = false; // à partir d'ici sauvegarderProfil() est autorisée
    calculerPaie();
    CONFIGS_RIST.forEach((cfg) => window[`resetHelper${cfg.nom}`]());

    // FIX A — Créer les overlays mobiles ICI, après calculerPaie().
    // Avant : appelé sur window.load → trop tard, dessinerFicheMobile()
    // avait déjà tourné via DOMContentLoaded et les panneaux n'existaient pas.
    // Maintenant : garantie que les panneaux sont prêts dès le premier tap.
    _creerOverlaysMobile();
  } catch (erreur) {
    console.error("Erreur d'initialisation :", erreur);
  }
}

// =============================================================================
// RESPONSIVE — PHASE 1
// Scale dynamique de la fiche + bottom-bar mobile
// =============================================================================

/**
 * Calcule et applique le scale CSS de la fiche A4 pour l'adapter à la largeur
 * de l'écran. Utilise la custom property --fiche-scale sur :root.
 * Appelée au chargement et à chaque resize.
 *
 * La fiche fait 210mm = 793px (+ 20px padding body = 793px de contenu utile).
 * Sur desktop (> 820px) : pas de scale, la fiche est affichée nativement.
 * Sur mobile (≤ 820px)  : scale = (largeur viewport - 0px marge) / 793px
 *
 * On ne descend jamais en dessous de 0.30 (illisible) ni au-dessus de 1.0.
 */
function _appliquerScaleFiche() {
  const FICHE_LARGEUR_PX = 793; // 210mm à 96dpi
  const BREAKPOINT       = 820;
  const BARRES_BAS_PX    = 108; // bottom-bar 56px + NET bar 44px + marge 8px
  const vw = window.innerWidth;

  if (vw > BREAKPOINT) {
    document.documentElement.style.removeProperty("--fiche-scale");
    document.documentElement.style.removeProperty("--fiche-wrap-height");
    document.body.classList.remove("is-mobile");
    const wrap = document.getElementById("fiche-scaler-wrap");
    if (wrap) wrap.style.height = "";
    return;
  }

  // Scale proportionnel, plancher à 0.30
  const scale = Math.max(0.30, Math.min(1.0, vw / FICHE_LARGEUR_PX));
  document.documentElement.style.setProperty("--fiche-scale", scale.toFixed(4));
  document.body.classList.add("is-mobile");

  // Calcule et applique la hauteur du wrapper après repaint
  _majHauteurWrapper(scale, BARRES_BAS_PX);
}

/**
 * Met à jour la hauteur du wrapper #fiche-scaler-wrap.
 * Hauteur = fiche.offsetHeight × scale + barres_bas.
 * Appelée depuis _appliquerScaleFiche() ET depuis calculerPaie() sur mobile.
 */
function _majHauteurWrapper(scale, barresBas) {
  // Récupère scale depuis CSS si non fourni (appel depuis calculerPaie)
  if (scale === undefined) {
    const s = getComputedStyle(document.documentElement)
      .getPropertyValue("--fiche-scale").trim();
    scale = parseFloat(s) || 0.47;
  }
  if (barresBas === undefined) barresBas = 108;

  requestAnimationFrame(() => {
    const fiche = document.querySelector(".page-a4");
    const wrap  = document.getElementById("fiche-scaler-wrap");
    if (!fiche || !wrap) return;
    const h = fiche.offsetHeight; // non affecté par transform
    const wrapH = Math.round(h * scale) + barresBas;
    wrap.style.height = wrapH + "px";
    document.documentElement.style.setProperty("--fiche-wrap-height", wrapH + "px");
  });
}

/**
 * Crée la bottom-bar mobile et l'insère dans le <body>.
 * Elle est masquée par CSS sur desktop (@media > 820px).
 * Chaque bouton reproduit l'action de son homologue flottant desktop.
 */
function _creerBottomBarMobile() {
  if (document.getElementById("mobile-bottom-bar")) return; // idempotent

  const bar = document.createElement("div");
  bar.id = "mobile-bottom-bar";
  bar.className = "mobile-bottom-bar";
  bar.setAttribute("role", "navigation");
  bar.setAttribute("aria-label", "Navigation principale");

  const btns = [
    { icon: "📅", label: "Annuel",   action: () => window.ouvrirProjectionAnnuelle?.() },
    { icon: "⚖",  label: "Comparer", action: () => window.activerComparaison?.() },
    { icon: "➕",  label: "Ajouter",  action: () => ouvrirModal("panel-menu-ajout", "Que voulez-vous ajouter ?") },
    { icon: "💡",  label: "Aide",     action: () => { /* Tour désactivé mobile — affiche une info */ _mobileInfoTour(); } },
  ];

  btns.forEach(({ icon, label, action }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mobile-bottom-bar-btn";
    btn.setAttribute("aria-label", label);

    const spanIcon  = document.createElement("span");
    spanIcon.className = "mbb-icon";
    spanIcon.textContent = icon;

    const spanLabel = document.createElement("span");
    spanLabel.className = "mbb-label";
    spanLabel.textContent = label;

    btn.append(spanIcon, spanLabel);
    btn.addEventListener("click", action);
    bar.appendChild(btn);
  });

  document.body.appendChild(bar);
}

/** Message informatif quand l'utilisateur tape "Aide" sur mobile. */
function _mobileInfoTour() {
  const modal = document.getElementById("magic-modal");
  if (!modal) return;
  // Réutilise la modale existante avec un panneau temporaire
  document.getElementById("modal-title").textContent = "💡 Aide";
  document.querySelectorAll(".setting-panel").forEach(p => p.classList.remove("active"));
  const tmp = document.getElementById("_mobile-aide-panel") || (() => {
    const d = document.createElement("div");
    d.id = "_mobile-aide-panel";
    d.className = "setting-panel";
    d.innerHTML = `
      <p class="panel-hint">Le simulateur est optimisé pour desktop.<br>
      Sur mobile, la fiche est affichée en lecture et les panneaux de configuration
      sont accessibles via le bouton <strong>➕ Ajouter</strong> ci-dessous.</p>
      <p class="panel-hint">Pour une expérience complète, ouvrez ce simulateur
      sur un ordinateur ou une tablette en mode paysage.</p>
      <button type="button" class="validate-btn"
        onclick="document.getElementById('magic-modal').close()">Fermer</button>
    `;
    document.querySelector(".modal-body").appendChild(d);
    return d;
  })();
  tmp.classList.add("active");
  modal.dataset.panelOuvert = "_mobile-aide-panel";
  if (!modal.open) modal.showModal();
}

// =============================================================================
// RESPONSIVE — BARRE STICKY NET À PAYER
// =============================================================================

/**
 * Crée la barre mobile sticky "NET À PAYER" épinglée entre la fiche et
 * la bottom-bar. Affiche net-après-impôt et net-imposable en permanence.
 * Invisible sur desktop (CSS), créée une seule fois (idempotent).
 */
function _creerBarreNetMobile() {
  if (document.getElementById("mobile-net-bar")) return;

  const bar = document.createElement("div");
  bar.id        = "mobile-net-bar";
  bar.className = "mobile-net-bar";
  bar.setAttribute("aria-live", "polite");
  bar.setAttribute("aria-label", "Net à payer");

  // Colonne principale : NET À PAYER
  const colNet = document.createElement("div");
  colNet.className = "mnb-col mnb-col-main";

  const lblNet = document.createElement("span");
  lblNet.className = "mnb-label";
  lblNet.textContent = "NET À PAYER";

  const valNet = document.createElement("span");
  valNet.id        = "mnb-net-val";
  valNet.className = "mnb-value";
  valNet.textContent = "—";

  colNet.append(lblNet, valNet);

  // Séparateur vertical
  const sep = document.createElement("div");
  sep.className = "mnb-sep";

  // Colonne secondaire : IMPOSABLE
  const colImp = document.createElement("div");
  colImp.className = "mnb-col";

  const lblImp = document.createElement("span");
  lblImp.className = "mnb-label";
  lblImp.textContent = "IMPOSABLE";

  const valImp = document.createElement("span");
  valImp.id        = "mnb-imp-val";
  valImp.className = "mnb-value mnb-value-sec";
  valImp.textContent = "—";

  colImp.append(lblImp, valImp);
  bar.append(colNet, sep, colImp);
  document.body.appendChild(bar);
}

/**
 * Met à jour les valeurs affichées dans la barre mobile NET.
 * Lit directement les spans déjà mis à jour par dessinerFiche.
 */
function _majBarreNetMobile() {
  const barNet = document.getElementById("mnb-net-val");
  const barImp = document.getElementById("mnb-imp-val");
  if (!barNet || !barImp) return;

  const srcNet = document.getElementById("ui-net-a-payer");
  const srcImp = document.getElementById("ui-net-imposable");

  barNet.textContent = srcNet?.textContent || "—";
  barImp.textContent = srcImp?.textContent
    ? srcImp.textContent + " €"
    : "—";
}

// ── Initialisation responsive ────────────────────────────────────────────────
_appliquerScaleFiche();
_creerBottomBarMobile();
// FIX 1 — _creerBarreNetMobile() supprimée : la ligne NET en vert dans la
// liste mobile suffit. La barre sticky était redondante et prenait de l'espace.

// Recalcule le scale à chaque resize et changement d'orientation
window.addEventListener("resize", _appliquerScaleFiche);
window.addEventListener("orientationchange", () => {
  // Léger délai : orientationchange se déclenche avant que innerWidth soit à jour
  setTimeout(_appliquerScaleFiche, 120);
});

// =============================================================================
// RESPONSIVE — PHASE 2
// Overlays tactiles sur les selects de la fiche (grade, échelon, enfants, NBI)
// Comparateur : bouton bottom-bar + indicateur actif
// =============================================================================

/**
 * Crée un panneau de configuration mobile pour les champs de l'en-tête
 * (grade, échelon, enfants, NBI) — des <select> transparents à 9px illisibles
 * sur mobile. Sur mobile (.is-mobile), un overlay transparent couvre la cellule
 * du tableau et ouvre une modale dédiée au tap.
 *
 * Architecture :
 *  - Les <select> originaux restent dans le DOM et continuent de piloter le moteur
 *  - Un <div class="mobile-cell-overlay"> est posé en absolute over chaque cellule
 *  - Il est invisible sur desktop (display:none) et capte les taps sur mobile
 *  - La modale affiche un <select> natif 16px dans un panneau, et recopie la
 *    valeur choisie dans le <select> original via dispatchEvent("input")
 */
function _creerOverlaysMobile() {
  if (!document.body.classList.contains("is-mobile")) return;
  if (document.getElementById("panel-grade-mobile")) return; // idempotent

  // ── Création des 4 panneaux dans la modal-body ────────────────────────────
  const modalBody = document.querySelector(".modal-body");
  if (!modalBody) return;

  // Helper : crée un panneau simple avec un select miroir
  function _creerPanneauSelectMobile(id, titre, sourceId, labelText) {
    if (document.getElementById(id)) return;
    const panel = document.createElement("div");
    panel.id = id;
    panel.className = "setting-panel";

    const hint = document.createElement("p");
    hint.className = "panel-hint";
    hint.textContent = labelText;

    const lbl = document.createElement("label");
    lbl.textContent = titre;

    // Clone du select original (options copiées à l'ouverture)
    const sel = document.createElement("select");
    sel.id = id + "-select";
    sel.className = "panel-select";
    sel.style.fontSize = "16px";

    const validateBtn = document.createElement("button");
    validateBtn.type = "button";
    validateBtn.className = "validate-btn";
    validateBtn.textContent = "Valider & Fermer ↵";
    validateBtn.addEventListener("click", () => {
      // Recopie la valeur dans le select original + déclenche son listener
      const src = document.getElementById(sourceId);
      if (src) {
        src.value = sel.value;
        src.dispatchEvent(new Event("input", { bubbles: true }));
        src.dispatchEvent(new Event("change", { bubbles: true }));
      }
      document.getElementById("magic-modal").close();
    });

    panel.append(hint, lbl, sel, validateBtn);
    modalBody.appendChild(panel);
  }

  // Panels séparés gardés pour compatibilité (enfants)
  _creerPanneauSelectMobile("panel-enfants-mobile", "Enfants à charge", "input-enfants", "Nombre d'enfants à charge :");

  // Panneau "Traitement brut" : grade + échelon + NBI dans un seul panneau
  if (!document.getElementById("panel-traitement-mobile")) {
    const panel = document.createElement("div");
    panel.id = "panel-traitement-mobile";
    panel.className = "setting-panel";

    // Grade
    const lblGrade = document.createElement("label");
    lblGrade.textContent = "Grade";
    const selGrade = document.createElement("select");
    selGrade.id = "panel-traitement-grade-select";
    selGrade.style.fontSize = "16px";
    // Options copiées à l'ouverture via _ouvrirPanneauMobile

    // Échelon
    const lblEch = document.createElement("label");
    lblEch.textContent = "Échelon";
    lblEch.style.marginTop = "16px";
    const selEch = document.createElement("select");
    selEch.id = "panel-traitement-echelon-select";
    selEch.style.fontSize = "16px";

    // NBI
    const lblNbi = document.createElement("label");
    lblNbi.textContent = "NBI (Nouvelle Bonification Indiciaire)";
    lblNbi.style.marginTop = "16px";
    const nbiWrap = document.createElement("div");
    nbiWrap.className = "ir-tabs";
    nbiWrap.style.marginTop = "8px";
    nbiWrap.innerHTML = `
      <input type="radio" id="trait-nbi-oui" name="trait-nbi" value="oui">
      <label for="trait-nbi-oui"><strong>Oui</strong><br><small>J'ai la NBI</small></label>
      <input type="radio" id="trait-nbi-non" name="trait-nbi" value="non">
      <label for="trait-nbi-non"><strong>Non</strong><br><small>Je n'ai pas la NBI</small></label>
    `;

    // Valider
    const btnVal = document.createElement("button");
    btnVal.type = "button";
    btnVal.className = "validate-btn";
    btnVal.textContent = "Valider & Fermer ↵";
    btnVal.addEventListener("click", () => {
      // Appliquer grade
      const srcGrade = document.getElementById("input-grade");
      if (srcGrade && selGrade.value) {
        srcGrade.value = selGrade.value;
        srcGrade.dispatchEvent(new Event("input", { bubbles: true }));
        marquerConfigure("grade");
      }
      // Appliquer échelon (après grade car mettreAJourEchelons est déclenché par grade)
      setTimeout(() => {
        const srcEch = document.getElementById("input-echelon");
        if (srcEch && selEch.value) {
          srcEch.value = selEch.value;
          srcEch.dispatchEvent(new Event("input", { bubbles: true }));
          marquerConfigure("echelon");
        }
      }, 50);
      // Appliquer NBI
      const choixNbi = document.querySelector('input[name="trait-nbi"]:checked')?.value;
      const cb = document.getElementById("input-nbi-checkbox");
      if (cb && choixNbi) {
        cb.checked = choixNbi === "oui";
        cb.dispatchEvent(new Event("input", { bubbles: true }));
        marquerConfigure("nbi");
      }
      calculerPaie();
      document.getElementById("magic-modal").close();
    });

    // Mise à jour des échelons quand le grade change dans le panneau
    selGrade.addEventListener("change", () => {
      const srcGrade = document.getElementById("input-grade");
      if (srcGrade) {
        const tmpVal = srcGrade.value;
        srcGrade.value = selGrade.value;
        mettreAJourEchelons();
        // Copier les nouvelles options dans selEch
        const srcEch = document.getElementById("input-echelon");
        selEch.innerHTML = "";
        Array.from(srcEch.options).forEach(opt => {
          const o = new Option(opt.text, opt.value, opt.defaultSelected, opt.selected);
          o.disabled = opt.disabled;
          selEch.appendChild(o);
        });
        srcGrade.value = tmpVal; // restore — pas encore validé
      }
    });

    panel.append(lblGrade, selGrade, lblEch, selEch, lblNbi, nbiWrap, btnVal);
    modalBody.appendChild(panel);
  }

  // ── Overlays transparents sur les cellules de l'info-table ───────────────
  // Chaque overlay est un <button> positionné en absolute qui couvre toute
  // la cellule TD. Il est rendu accessible (aria-label) et ouvre la modale.
  const overlayDefs = [
    { cellSelector: "#input-grade",          panelId: "panel-grade-mobile",   titre: "Grade",            ariaLabel: "Modifier le grade" },
    { cellSelector: "#input-echelon",        panelId: "panel-echelon-mobile", titre: "Échelon",          ariaLabel: "Modifier l'échelon" },
    { cellSelector: "#input-enfants",        panelId: "panel-enfants-mobile", titre: "Enfants à charge", ariaLabel: "Modifier le nombre d'enfants" },
    { cellSelector: "#input-nbi-checkbox",   panelId: "panel-nbi-mobile",     titre: "NBI",              ariaLabel: "Configurer la NBI" },
  ];

  overlayDefs.forEach(({ cellSelector, panelId, titre, ariaLabel }) => {
    const el = document.querySelector(cellSelector);
    if (!el) return;
    const td = el.closest("td");
    if (!td) return;

    // La TD doit être en position relative pour que l'overlay s'y positionne
    td.style.position = "relative";

    const overlay = document.createElement("button");
    overlay.type = "button";
    overlay.className = "mobile-cell-overlay";
    overlay.setAttribute("aria-label", ariaLabel);
    overlay.addEventListener("click", (e) => {
      e.stopPropagation();
      _ouvrirPanneauMobile(panelId, titre, cellSelector);
    });
    td.appendChild(overlay);
  });
}

/**
 * Ouvre un panneau mobile en synchronisant d'abord le select miroir
 * avec les options actuelles du select original.
 */
function _ouvrirPanneauMobile(panelId, titre, sourceId) {
  // Panneau traitement unifié (grade + échelon + NBI)
  if (panelId === "panel-traitement-mobile") {
    // Sync grade
    const srcGrade = document.getElementById("input-grade");
    const selGrade = document.getElementById("panel-traitement-grade-select");
    if (selGrade && srcGrade) {
      selGrade.innerHTML = "";
      Array.from(srcGrade.options).forEach(opt => {
        const o = new Option(opt.text, opt.value, opt.defaultSelected, opt.selected);
        o.disabled = opt.disabled;
        selGrade.appendChild(o);
      });
      selGrade.value = srcGrade.value;
    }
    // Sync échelon
    const srcEch = document.getElementById("input-echelon");
    const selEch = document.getElementById("panel-traitement-echelon-select");
    if (selEch && srcEch) {
      selEch.innerHTML = "";
      Array.from(srcEch.options).forEach(opt => {
        const o = new Option(opt.text, opt.value, opt.defaultSelected, opt.selected);
        o.disabled = opt.disabled;
        selEch.appendChild(o);
      });
      selEch.value = srcEch.value;
    }
    // Sync NBI
    const cb = document.getElementById("input-nbi-checkbox");
    const rOui = document.getElementById("trait-nbi-oui");
    const rNon = document.getElementById("trait-nbi-non");
    if (cb && rOui && rNon) {
      rOui.checked =  cb.checked;
      rNon.checked = !cb.checked;
    }
    ouvrirModal(panelId, titre);
    return;
  }

  // Panneaux simples (select miroir)
  const mirrorSel = document.getElementById(panelId + "-select");
  const srcEl     = document.getElementById(sourceId.replace(/^#/, ""));
  if (mirrorSel && srcEl && srcEl.tagName === "SELECT") {
    mirrorSel.innerHTML = "";
    Array.from(srcEl.options).forEach(opt => {
      const o = new Option(opt.text, opt.value, opt.defaultSelected, opt.selected);
      o.disabled = opt.disabled;
      mirrorSel.appendChild(o);
    });
    mirrorSel.value = srcEl.value;
  }
  ouvrirModal(panelId, titre);
}

// ── Initialisation Phase 2 ────────────────────────────────────────────────────
// FIX A — _creerOverlaysMobile() est maintenant appelée dans initialiserApplication()
// plus besoin du window.load listener.

// Re-créer les overlays si on passe en mode mobile via resize
window.addEventListener("resize", () => {
  if (document.body.classList.contains("is-mobile")) {
    _creerOverlaysMobile();
  }
});

// Mise à jour du bouton "Comparer" dans la bottom-bar selon l'état du mode
function _majBottomBarComparer() {
  const bar = document.getElementById("mobile-bottom-bar");
  if (!bar) return;
  const btnComparer = bar.querySelectorAll(".mobile-bottom-bar-btn")[1]; // index 1 = Comparer
  if (!btnComparer) return;
  const actif = modeComparaison;
  btnComparer.classList.toggle("active", actif);
  btnComparer.querySelector(".mbb-label").textContent = actif ? "Comparer ✓" : "Comparer";
}

// Patch activerComparaison / desactiverComparaison pour mettre à jour la bottom-bar
const _origActiver     = window.activerComparaison;
const _origDesactiver  = window.desactiverComparaison;
window.activerComparaison = function () {
  _origActiver?.();
  _majBottomBarComparer();
};
window.desactiverComparaison = function () {
  _origDesactiver?.();
  _majBottomBarComparer();
};

// FIX #15 — DOMContentLoaded : ne bloque pas sur le chargement des images/fonts, et ne risque
// pas d'écraser un autre handler onload assigné ailleurs (window.onload = ... est exclusif).
document.addEventListener("DOMContentLoaded", initialiserApplication);

// =============================================================================
// 11b. PRIMES MANUELLES — Saisie libre
// =============================================================================

/**
 * Compteur auto-incrémentant pour générer des IDs de radios uniques par ligne.
 * Ne jamais le réinitialiser : garantit l'unicité même après suppressions.
 */
let _pmRowCounter = 0;

/**
 * Construit une ligne de prime manuelle via l'API DOM (jamais innerHTML sur données user).
 * @param {string}  [libelle=""]  - Libellé pré-rempli
 * @param {number|string} [montant=""] - Montant pré-rempli
 * @param {boolean} [imposable=true]  - Toggle imposable/non imposable
 * @returns {HTMLDivElement}
 */
function _creerLignePrimeManuelle(libelle = "", montant = "", imposable = true) {
  const id  = _pmRowCounter++;
  const row = document.createElement("div");
  row.className = "prime-manuelle-row";

  // Libellé
  const inputLib = document.createElement("input");
  inputLib.type        = "text";
  inputLib.className   = "pm-libelle";
  inputLib.placeholder = "Libellé (ex: Rappel RIST 2024)";
  if (libelle) inputLib.value = libelle;
  inputLib.addEventListener("input", () => { _sauvegarderPrimesManuelles(); calculerPaie(); });

  // Montant
  const inputVal = document.createElement("input");
  inputVal.type        = "number";
  inputVal.className   = "pm-montant";
  inputVal.placeholder = "0.00";
  inputVal.step        = "1";
  inputVal.min         = "0";
  if (montant !== "") inputVal.value = montant;
  inputVal.addEventListener("focus",  () => inputVal.select());
  inputVal.addEventListener("input",  () => { _sauvegarderPrimesManuelles(); calculerPaie(); });

  // Toggle Imposable / Non imposable
  const toggle = document.createElement("div");
  toggle.className = "pm-toggle";

  const rOuiId  = `pm-imp-oui-${id}`;
  const rNonId  = `pm-imp-non-${id}`;
  const rName   = `pm-imposable-${id}`;

  const rOui  = document.createElement("input");
  rOui.type   = "radio"; rOui.name = rName;
  rOui.id     = rOuiId;  rOui.className = "pm-imp-oui";
  rOui.value  = "1";     rOui.checked = imposable;

  const lOui  = document.createElement("label");
  lOui.htmlFor    = rOuiId;
  lOui.textContent = "Imposable";

  const rNon  = document.createElement("input");
  rNon.type   = "radio"; rNon.name = rName;
  rNon.id     = rNonId;  rNon.className = "pm-imp-non";
  rNon.value  = "0";     rNon.checked = !imposable;

  const lNon  = document.createElement("label");
  lNon.htmlFor    = rNonId;
  lNon.textContent = "Non imposable";

  rOui.addEventListener("change", () => { _sauvegarderPrimesManuelles(); calculerPaie(); });
  rNon.addEventListener("change", () => { _sauvegarderPrimesManuelles(); calculerPaie(); });

  toggle.append(rOui, lOui, rNon, lNon);

  // Bouton suppression
  const btnSuppr  = document.createElement("button");
  btnSuppr.type   = "button";
  btnSuppr.className   = "pm-suppr";
  btnSuppr.title  = "Supprimer cette prime";
  btnSuppr.textContent = "✖";
  btnSuppr.addEventListener("click", () => { row.remove(); _sauvegarderPrimesManuelles(); calculerPaie(); });

  row.append(inputLib, inputVal, toggle, btnSuppr);
  return row;
}

/**
 * Lit les lignes du DOM et retourne le tableau des primes manuelles.
 * @returns {{libelle:string, montant:number, imposable:boolean}[]}
 */
function _getPrimesManuelles() {
  const result = [];
  document.querySelectorAll("#primes-manuelles-liste .prime-manuelle-row").forEach(row => {
    const libelle   = row.querySelector(".pm-libelle")?.value?.trim() || "Prime manuelle";
    const montant   = parseFloat(row.querySelector(".pm-montant")?.value) || 0;
    const imposable = row.querySelector(".pm-imp-oui")?.checked === true;
    result.push({ libelle, montant, imposable });
  });
  return result;
}

/**
 * Persiste les primes manuelles dans localStorage.
 * Appelée automatiquement à chaque modification d'une ligne.
 */
function _sauvegarderPrimesManuelles() {
  try {
    localStorage.setItem(CLE_PRIMES_MANUELLES, JSON.stringify(_getPrimesManuelles()));
  } catch (_) {}
}

/**
 * Restaure les primes manuelles depuis localStorage.
 * Appelée dans initialiserApplication().
 */
function _restaurerPrimesManuelles() {
  try {
    const raw = localStorage.getItem(CLE_PRIMES_MANUELLES);
    if (!raw) return;
    const data = JSON.parse(raw);
    const container = document.getElementById("primes-manuelles-liste");
    if (!container) return;
    container.innerHTML = "";
    data.forEach(({ libelle, montant, imposable }) => {
      container.appendChild(_creerLignePrimeManuelle(libelle, montant, imposable));
    });
  } catch (e) {
    console.warn("Restauration primes manuelles impossible :", e);
  }
}

/**
 * Ajoute une nouvelle ligne vide dans le panneau.
 * Exposée sur window : appelée via onclick dans le HTML.
 */
window.ajouterPrimeManuelle = function () {
  const container = document.getElementById("primes-manuelles-liste");
  if (!container) return;
  const row = _creerLignePrimeManuelle();
  container.appendChild(row);
  row.querySelector(".pm-libelle")?.focus();
};

/**
 * Supprime la i-ème prime manuelle depuis la fiche de paie (bouton ✖ de la ligne).
 * Exposée sur window : appelée via onclick inline dans dessinerFiche.
 * @param {number} index - Position de la ligne dans #primes-manuelles-liste
 */
window.supprimerPrimeManuelle = function (index) {
  const rows = document.querySelectorAll("#primes-manuelles-liste .prime-manuelle-row");
  if (rows[index]) {
    rows[index].remove();
    _sauvegarderPrimesManuelles();
    calculerPaie();
  }
};

// =============================================================================
// 11c. VUE MOBILE — Liste condensée (Option D)
// =============================================================================

/**
 * Dessine la vue mobile de la fiche de paie dans #fiche-mobile.
 * Liste de lignes : libellé à gauche, montant coloré à droite.
 * Sections séparées par des titres. Lignes cliquables → même modales que desktop.
 * Appelée depuis calculerPaie() uniquement quand is-mobile.
 *
 * @param {ProfilAgent}      p - Profil agent
 * @param {MontantsCalcules} m - Résultats calculerMontants(p)
 */
function dessinerFicheMobile(p, m) {
  const root = document.getElementById("fiche-mobile");
  if (!root) return;
  root.innerHTML = "";

  const fmt = (v) => v > 0
    ? v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"
    : "";

  // ── Helpers DOM ──────────────────────────────────────────────────────────

  // FIX 8 — Sections ouvertes par défaut (les plus importantes)
  const SECTIONS_OUVERTES = new Set(["Base", "Primes & RIST", "Résultat"]);

  /**
   * Crée un titre de section pliable.
   * - Clic : toggle plie/déplie les .mf-row suivants jusqu'au prochain titre
   * - Sections dans SECTIONS_OUVERTES : ouvertes au départ
   * - Autres : fermées au départ
   */
  function section(titre) {
    const ouvert = SECTIONS_OUVERTES.has(titre);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mf-section-title" + (ouvert ? "" : " mf-section-collapsed");
    btn.setAttribute("aria-expanded", ouvert ? "true" : "false");
    // Flèche + titre
    const arrow = document.createElement("span");
    arrow.className = "mf-section-arrow";
    arrow.textContent = ouvert ? "▼" : "▶";
    const txt = document.createElement("span");
    txt.textContent = titre;
    btn.append(arrow, txt);
    btn.addEventListener("click", () => {
      const collapsed = btn.classList.toggle("mf-section-collapsed");
      btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      arrow.textContent = collapsed ? "▶" : "▼";
      // Cache/montre tous les .mf-row suivants jusqu'au prochain titre de section
      let el = btn.nextElementSibling;
      while (el && !el.classList.contains("mf-section-title")) {
        el.style.display = collapsed ? "none" : "";
        el = el.nextElementSibling;
      }
    });
    root.appendChild(btn);

    // Si section fermée par défaut, on masquera les lignes ajoutées ensuite
    // via un requestAnimationFrame (les lignes n'existent pas encore au moment du clic)
    if (!ouvert) {
      requestAnimationFrame(() => {
        let el = btn.nextElementSibling;
        while (el && !el.classList.contains("mf-section-title")) {
          el.style.display = "none";
          el = el.nextElementSibling;
        }
      });
    }
  }

  /**
   * Crée une ligne de la liste.
   * @param {string}   libelle
   * @param {number|null} credit   - montant colonne "à payer" (vert)
   * @param {number|null} deduction - montant colonne "à déduire" (rouge)
   * @param {object}   [opts]
   * @param {string}   [opts.panel]  - panelId à ouvrir au tap
   * @param {string}   [opts.titre]  - titre de la modale
   * @param {string}   [opts.cle]    - clé onboarding (affiche badge si non configuré)
   * @param {string}   [opts.sub]    - sous-texte sous le libellé
   * @param {boolean}  [opts.total]  - style ligne totaux
   * @param {boolean}  [opts.totalNet] - style ligne NET final
   * @param {boolean}  [opts.absence] - style ligne absence
   * @param {Function} [opts.onDelete] - callback bouton ✖
   */
  function ligne(libelle, credit, deduction, opts = {}) {
    const { panel, titre, cle, sub, total, totalNet, absence, onDelete } = opts;

    // Si clé onboarding non configurée → ligne badge orange
    if (cle && nonConfigure(cle)) {
      const row = document.createElement("div");
      row.className = "mf-row mf-clickable mf-pending";
      const PANNEAUX_MOBILE_BADGE = ["panel-grade-mobile","panel-echelon-mobile","panel-enfants-mobile","panel-nbi-mobile"];
      row.addEventListener("click", () => {
        if (PANNEAUX_MOBILE_BADGE.includes(panel)) {
          const srcMap = { "panel-grade-mobile": "#input-grade", "panel-echelon-mobile": "#input-echelon",
                           "panel-enfants-mobile": "#input-enfants", "panel-nbi-mobile": "#input-nbi-checkbox" };
          _ouvrirPanneauMobile(panel, titre, srcMap[panel] || "");
        } else { ouvrirModal(panel, titre); }
      });

      const lbl = document.createElement("span");
      lbl.className = "mf-label";
      lbl.textContent = libelle;

      const badge = document.createElement("button");
      badge.type = "button";
      badge.className = "mf-badge";
      badge.textContent = "⚙ Configurer";
      badge.addEventListener("click", e => { e.stopPropagation(); ouvrirModal(panel, titre); });

      row.append(lbl, badge);
      root.appendChild(row);
      return;
    }

    const montant = credit ?? deduction ?? 0;
    if (montant === 0 && !total && !totalNet) return; // n'affiche pas les lignes à 0

    const row = document.createElement("div");
    const classes = ["mf-row"];
    if (panel) classes.push("mf-clickable");
    if (total) classes.push("mf-total");
    if (totalNet) classes.push("mf-total", "mf-total-net");
    if (absence) classes.push("mf-absence");
    row.className = classes.join(" ");

    if (panel) {
      // FIX 2/3/4 — Pour les panneaux mobiles (grade/échelon/NBI/enfants),
      // appeler _ouvrirPanneauMobile() qui synchronise les options du select miroir.
      // Pour tous les autres panneaux → ouvrirModal() standard.
      const PANNEAUX_MOBILE = ["panel-grade-mobile","panel-echelon-mobile","panel-enfants-mobile","panel-nbi-mobile"];
      const actionOuvrir = () => {
        if (PANNEAUX_MOBILE.includes(panel)) {
          const sourceMap = {
            "panel-grade-mobile":   "#input-grade",
            "panel-echelon-mobile": "#input-echelon",
            "panel-enfants-mobile": "#input-enfants",
            "panel-nbi-mobile":     "#input-nbi-checkbox",
          };
          _ouvrirPanneauMobile(panel, titre, sourceMap[panel] || "");
        } else {
          ouvrirModal(panel, titre);
        }
      };
      row.addEventListener("click", actionOuvrir);
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");
      row.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); actionOuvrir(); }
      });
    }

    const lbl = document.createElement("span");
    lbl.className = "mf-label";
    // Si la ligne a un panel, la flèche › est ajoutée via CSS ::after
    // On retire l'attribut pour les lignes non-cliquables
    if (!panel) lbl.style.cssText = "";

    const lblText = document.createTextNode(libelle);
    lbl.appendChild(lblText);

    if (sub) {
      const s = document.createElement("span");
      s.className = "mf-label-sub";
      s.textContent = sub;
      lbl.appendChild(s);
    }

    const amt = document.createElement("span");
    amt.className = "mf-amount " + (credit ? "mf-credit" : deduction ? "mf-deduction" : "mf-info");

    if (credit)    amt.textContent = "+" + fmt(credit);
    else if (deduction) amt.textContent = "−" + fmt(deduction);
    else           amt.textContent = fmt(montant);

    // Bouton ✖ pour supprimer (primes manuelles)
    if (onDelete) {
      const del = document.createElement("button");
      del.type = "button";
      del.style.cssText = "background:none;border:none;color:#c0392b;font-size:14px;padding:0 0 0 8px;cursor:pointer;flex-shrink:0;";
      del.textContent = "✖";
      del.addEventListener("click", e => { e.stopPropagation(); onDelete(); });
      row.append(lbl, del, amt);
    } else {
      row.append(lbl, amt);
    }

    root.appendChild(row);
  }

  // ── En-tête grade / échelon / indice ─────────────────────────────────────
  const header = document.createElement("div");
  header.className = "mf-header";

  const hLeft = document.createElement("div");
  hLeft.className = "mf-header-grade";
  const gradeTxt = p.grade || "— Grade non configuré —";
  const echelonTxt = p.echelon ? `Échelon ${p.echelon}` : "Échelon non configuré";
  hLeft.textContent = gradeTxt;
  const hSub = document.createElement("div");
  hSub.className = "mf-header-sub";
  hSub.textContent = echelonTxt + (p.enfants > 0 ? ` · ${p.enfants} enfant${p.enfants > 1 ? "s" : ""}` : "");
  hLeft.appendChild(hSub);

  const hRight = document.createElement("div");
  if (m.indice) {
    const iv = document.createElement("div");
    iv.className = "mf-header-indice";
    iv.textContent = String(m.indice).padStart(4, "0");
    const il = document.createElement("div");
    il.className = "mf-header-indice-lbl";
    il.textContent = "INDICE";
    hRight.append(iv, il);
  }

  header.append(hLeft, hRight);
  root.appendChild(header);

  // ── Config incomplète ─────────────────────────────────────────────────────
  const pending = configurationIncomplete();
  if (pending) {
    const msg = document.createElement("div");
    msg.className = "mf-config-pending";
    msg.innerHTML = `<span class="mf-config-pending-icon">⚙</span>
      <span>Complétez votre profil pour afficher les totaux. Appuyez sur les lignes orangées pour configurer.</span>`;
    root.appendChild(msg);
  }

  // ── BASE ──────────────────────────────────────────────────────────────────
  section("Base");

  // Traitement brut — tap ouvre panneau traitement (grade + échelon + NBI)
  const pendingTraitement = nonConfigure("grade") || nonConfigure("echelon") || nonConfigure("nbi");
  const subTraitement = [
    p.echelon ? "Éch. " + p.echelon : null,
    m.montantNbi > 0 ? "NBI activée" : (!nonConfigure("nbi") ? "NBI non activée" : null),
  ].filter(Boolean).join(" · ") || null;
  {
    const row = document.createElement("div");
    row.className = "mf-row mf-clickable" + (pendingTraitement ? " mf-pending" : "");
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    const action = () => _ouvrirPanneauMobile("panel-traitement-mobile", "Traitement", "");
    row.addEventListener("click", action);
    row.addEventListener("keydown", e => { if (e.key==="Enter"||e.key===" ") { e.preventDefault(); action(); }});
    const lbl = document.createElement("span");
    lbl.className = "mf-label";
    lbl.textContent = "Traitement brut";
    if (subTraitement) {
      const sub = document.createElement("span");
      sub.className = "mf-label-sub";
      sub.textContent = subTraitement;
      lbl.appendChild(sub);
    }
    if (pendingTraitement) {
      const badge = document.createElement("button");
      badge.type = "button";
      badge.className = "mf-badge";
      badge.textContent = "⚙ Configurer";
      badge.addEventListener("click", e => { e.stopPropagation(); action(); });
      row.append(lbl, badge);
    } else {
      const amt = document.createElement("span");
      amt.className = "mf-amount mf-credit";
      amt.textContent = "+" + fmt(m.traitementBrut + (m.montantNbi || 0));
      row.append(lbl, amt);
    }
    root.appendChild(row);
  }

  ligne("Indemnité de résidence",   m.indemniteResidence, null,
    { cle: "zone_residence", panel: "panel-residence", titre: "Zone de Résidence" });

  if (m.montantSFT > 0)
    ligne("Supplément familial (SFT)", m.montantSFT, null,
      { panel: "panel-enfants-mobile", titre: "Enfants à charge" });

  // ── Retenues de base ──────────────────────────────────────────────────────
  section("Retenues de base");

  ligne("Retenue PC",               null, m.retenuePC);
  if (m.retenuePcNbi > 0)
    ligne("Retenue PC sur NBI",     null, m.retenuePcNbi);
  if (m.transfertPrimes > 0)
    ligne("Transfert primes/points",null, m.transfertPrimes);

  // ── Absences ──────────────────────────────────────────────────────────────
  if (m.joursAbs > 0) {
    section("Absences");
    const totalAbs = m.absTraitement + m.absNbi + m.absResidence +
                     m.absRistFct + m.absRistExp + m.absRistIsq +
                     m.absRistCplt + m.absRistMaj + m.absIndCsg;
    ligne(`Retenue absence (${m.joursAbs} j)`, null, totalAbs,
      { panel: "panel-absences", titre: "Absences & Carence", absence: true });
  }

  // ── Primes & RIST ─────────────────────────────────────────────────────────
  section("Primes & RIST");

  // Nuits
  if (m.nuit > 0)
    ligne("Ind. travail de nuit",   m.nuit, null,
      { panel: "panel-nuits", titre: "Travail de Nuit & Soirées" });

  // FMD
  if (p.primes.forfait_mobilites > 0)
    ligne("Forfait mobilités",      p.primes.forfait_mobilites, null,
      { panel: "panel-fmd", titre: "Forfait Mobilités" });

  // Inflation
  if (p.primes.inflation > 0)
    ligne("Indemnité pouvoir d'achat", p.primes.inflation, null,
      { panel: "panel-inflation", titre: "Indemnité Inflation" });

  // PSC
  if (p.primes.psc > 0)
    ligne("Participation PSC",      p.primes.psc, null,
      { panel: "panel-psc", titre: "Participation PSC" });

  // PPP
  if (p.evenements.prime_performance > 0)
    ligne("Prime partage performance", p.evenements.prime_performance, null,
      { panel: "panel-primes", titre: "Prime Partage Performance" });

  // OTT
  if (p.evenements.ott_pf > 0)
    ligne("OTT Part Fixe",         p.evenements.ott_pf, null,
      { panel: "panel-ott", titre: "Protocole (OTT)" });
  if (p.evenements.ott_pv_globale > 0)
    ligne("OTT Part Variable",     p.evenements.ott_pv_globale, null,
      { panel: "panel-ott", titre: "Protocole (OTT)" });
  if (p.evenements.ott_pv_opt32 > 0)
    ligne("OTT PV Opt 3-1/3-2",   p.evenements.ott_pv_opt32, null,
      { panel: "panel-ott", titre: "Protocole (OTT)" });

  // Attractivité / Fidélisation
  if (p.primes.attractivite > 0)
    ligne("Attractivité géo.",     p.primes.attractivite, null,
      { panel: "panel-attractivite", titre: "Attractivité Géographique" });
  if (p.primes.fidelisation > 0)
    ligne("Prime fidélisation",    p.primes.fidelisation, null,
      { panel: "panel-fidelisation", titre: "Prime Fidélisation" });

  // RIST (avec badge si non configuré)
  ligne("RIST Part Fonctions",     p.primes.rist_fonctions - m.absRistFct, null,
    { cle: "rist_fonctions", panel: "panel-rist-fonctions", titre: "Ristourne Part Fonctions" });
  ligne("RIST Part Expérience",    p.primes.rist_exper_prof - m.absRistExp, null,
    { cle: "rist_experience", panel: "panel-rist-experience", titre: "Ristourne Part Expérience" });
  ligne("RIST Part LIC-ISQ",       p.primes.rist_lic_isq - m.absRistIsq, null,
    { cle: "rist_isq_licence", panel: "panel-rist-isq-licence", titre: "Ristourne Part LIC-ISQ" });
  ligne("RIST CPLT LIC-ISQ",       p.primes.rist_cplt_lic_isq - m.absRistCplt, null,
    { cle: "rist_isq_complement", panel: "panel-rist-isq-complement", titre: "Ristourne CPLT LIC-ISQ" });
  ligne("Majoration ISQ",          p.primes.rist_maj_isq - m.absRistMaj, null,
    { cle: "rist_isq_majoration", panel: "panel-rist-isq-majoration", titre: "Majoration ISQ" });

  // Ind. compensatrice CSG
  ligne("Ind. compensatrice CSG",  p.primes.ind_compensatrice_csg - m.absIndCsg, null,
    { cle: "ind_compensatrice_csg", panel: "panel-csg", titre: "Indemnité Compensatrice CSG" });

  // Primes manuelles
  _getPrimesManuelles().forEach(({ libelle, montant, imposable }, i) => {
    if (montant <= 0) return;
    ligne(libelle, montant, null, {
      panel: "panel-primes-manuelles",
      titre: "Primes manuelles",
      sub: imposable ? null : "Non imposable",
      onDelete: () => window.supprimerPrimeManuelle(i),
    });
  });

  // ── Cotisations salariales ────────────────────────────────────────────────
  section("Cotisations salariales");

  ligne("CSG non déductible",      null, m.csgNonDeductible);
  ligne("CSG déductible",          null, m.csgDeductible);
  ligne("CRDS",                    null, m.crds);
  ligne("Cotisation RAFP",         null, m.cotisationRafp);
  if (m.retenueIsq > 0)
    ligne("24,6% ISQ",             null, m.retenueIsq);

  // ── Cotisations patronales ────────────────────────────────────────────────
  section("Cotisations patronales");

  ligne("Alloc. familiales",       null, m.charges.patAllocFam);
  ligne("FNAL",                    null, m.charges.patFnal);
  ligne("CSA",                     null, m.charges.patCsa);
  ligne("Maladie",                 null, m.charges.patMaladie);
  ligne("Pensions civiles",        null, m.charges.patPensions);
  ligne("ATI",                     null, m.charges.patAti);
  ligne("Versement mobilité",      null, m.charges.patMobilite);
  ligne("RAFP patronal",           null, m.charges.patRafp);

  // ── Impôt ─────────────────────────────────────────────────────────────────
  section("Impôt");

  if (nonConfigure("taux_pas")) {
    ligne("Prélèvement à la source", null, 0,
      { cle: "taux_pas", panel: "panel-impots", titre: "Prélèvement à la Source" });
  } else {
    const tauxPct = (p.taux_pas * 100).toLocaleString("fr-FR",
      { minimumFractionDigits: 1, maximumFractionDigits: 2 }) + " %";
    ligne("Prélèvement à la source", null, m.impotSource,
      { panel: "panel-impots", titre: "Prélèvement à la Source", sub: `Taux ${tauxPct}` });
  }

  // ── Nets ──────────────────────────────────────────────────────────────────
  if (!pending) {
    section("Résultat");

    ligne("Net avant impôt",       null, null,
      { total: true });
    // On construit manuellement cette ligne pour afficher dans "info"
    (() => {
      const row = document.createElement("div");
      row.className = "mf-row mf-total";
      const lbl = document.createElement("span");
      lbl.className = "mf-label";
      lbl.textContent = "Net avant impôt";
      const amt = document.createElement("span");
      amt.className = "mf-amount mf-info";
      amt.textContent = fmt(m.netAPayerAvantImpot);
      row.append(lbl, amt);
      // Remplacer la ligne vide créée ci-dessus
      const last = root.lastChild;
      if (last?.classList.contains("mf-total")) root.removeChild(last);
      root.appendChild(row);
    })();

    ligne("Net social",            null, null,
      { total: true });
    (() => {
      const row = document.createElement("div");
      row.className = "mf-row mf-total";
      const lbl = document.createElement("span");
      lbl.className = "mf-label";
      lbl.textContent = "Net social";
      const amt = document.createElement("span");
      amt.className = "mf-amount mf-info";
      amt.textContent = fmt(m.netSocial);
      row.append(lbl, amt);
      const last = root.lastChild;
      if (last?.classList.contains("mf-total")) root.removeChild(last);
      root.appendChild(row);
    })();

    ligne("Montant imposable",     null, null,
      { total: true });
    (() => {
      const row = document.createElement("div");
      row.className = "mf-row mf-total";
      const lbl = document.createElement("span");
      lbl.className = "mf-label";
      lbl.textContent = "Montant imposable";
      const amt = document.createElement("span");
      amt.className = "mf-amount mf-info";
      amt.textContent = fmt(m.netImposableFinal);
      row.append(lbl, amt);
      const last = root.lastChild;
      if (last?.classList.contains("mf-total")) root.removeChild(last);
      root.appendChild(row);
    })();

    // NET À PAYER — ligne vedette
    const rowNet = document.createElement("div");
    rowNet.className = "mf-row mf-total mf-total-net";
    const lblNet = document.createElement("span");
    lblNet.className = "mf-label";
    lblNet.textContent = "NET À PAYER";
    const amtNet = document.createElement("span");
    amtNet.className = "mf-amount";
    amtNet.textContent = (m.netFinal === 0 ? "0,00" :
      m.netFinal.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })) + " €";
    rowNet.append(lblNet, amtNet);
    root.appendChild(rowNet);
  }

  // ── Bouton ajouter élément variable ──────────────────────────────────────
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "mf-add-btn";
  addBtn.textContent = "+ Ajouter ou modifier un élément variable";
  addBtn.addEventListener("click", () => ouvrirModal("panel-menu-ajout", "Que voulez-vous ajouter ?"));
  root.appendChild(addBtn);

  // ── Mise à jour de la barre sticky NET ──────────────────────────────────
  // ui-net-a-payer et ui-net-imposable sont dans le tfoot de la fiche A4 (masquée).
  // On les met à jour manuellement pour que _majBarreNetMobile() fonctionne.
  const elNet = document.getElementById("ui-net-a-payer");
  const elImp = document.getElementById("ui-net-imposable");
  if (elNet) elNet.textContent = (m.netFinal === 0 ? "0,00" :
    m.netFinal.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })) + " €";
  if (elImp) elImp.textContent = m.netImposableFinal === 0 ? "0,00" :
    m.netImposableFinal.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// =============================================================================
// 12. PROJECTION ANNUELLE
// =============================================================================

/**
 * Calcule la projection annuelle en construisant un profil mensuel moyen
 * qui intègre récurrents + ponctuels/12, puis appelle calculerMontants()
 * une seule fois pour obtenir des cotisations correctes sur l'ensemble.
 *
 * @param {{nuitsAnnuelles, soireesAnnuelles, ottPv, ottPv32, ppp, fmd, libres[]}} saisis
 * @returns {{annuel, mensuelMoyen, moisRecurrent, detail}}
 */
function calculerAnnuel(saisis) {
  const profilBase = getProfilDepuisInterface();

  // ── Profil mois récurrent (sans ponctuels) ────────────────────────────────
  const profilRec = {
    ...profilBase,
    evenements: {
      nuits: 0, soirees: 0,
      jours_greve: 0, jours_carence: 0, jours_maladie_90: 0, jours_maladie_50: 0,
      prime_performance: 0,
      ott_pf: profilBase.evenements.ott_pf,
      ott_pv_globale: 0, ott_pv_opt32: 0,
    },
    primes: { ...profilBase.primes, forfait_mobilites: 0 },
  };
  const mRec = calculerMontants(profilRec);

  // ── Montant nuits annuel calculé depuis les compteurs ────────────────────
  const montantNuitsAnnuel = arrondir(
    (saisis.nuitsAnnuelles   || 0) * CALC.TAUX_NUIT  +
    (saisis.soireesAnnuelles || 0) * CALC.TAUX_SOIREE
  );

  // Total libres annuels
  const totalLibresAnnuel = arrondir(
    (saisis.libres || []).reduce((s, l) => s + (parseFloat(l.montant) || 0), 0)
  );

  // ── Profil mensuel moyen = récurrents + ponctuels÷12 ─────────────────────
  // On divise les ponctuels par 12 pour obtenir l'équivalent mensuel moyen,
  // puis on multiplie le résultat par 12 → cotisations correctement calculées
  const profilMoyen = {
    ...profilRec,
    evenements: {
      ...profilRec.evenements,
      nuits:            0,
      soirees:          0,
      ott_pv_globale:   arrondir((saisis.ottPv  || 0) / 12),
      ott_pv_opt32:     arrondir((saisis.ottPv32|| 0) / 12),
      prime_performance:arrondir(((saisis.ppp   || 0) + totalLibresAnnuel) / 12),
      // nuits intégrées via indemnité mensuelle moyenne
    },
    primes: {
      ...profilRec.primes,
      forfait_mobilites: arrondir((saisis.fmd || 0) / 12),
    },
  };

  // Les nuits sont un cas spécial — on les ajoute au profil moyen via les compteurs
  profilMoyen.evenements.nuits   = arrondir((saisis.nuitsAnnuelles   || 0) / 12);
  profilMoyen.evenements.soirees = arrondir((saisis.soireesAnnuelles || 0) / 12);

  const mMoyen = calculerMontants(profilMoyen);

  // ── Résultats ×12 ─────────────────────────────────────────────────────────
  const annuel = {
    brut:          arrondir(mMoyen.totalAPayer       * 12),
    netImposable:  arrondir(mMoyen.netImposableFinal * 12),
    netAvantImpot: arrondir(mMoyen.netAPayerAvantImpot * 12),
    pasVerse:      arrondir(mMoyen.impotSource       * 12),
    netApresImpot: arrondir(mMoyen.netFinal          * 12),
    coutEmployeur: arrondir(mMoyen.coutTotalEmployeur* 12),
  };

  const mensuelMoyen = {
    brut:          mMoyen.totalAPayer,
    netImposable:  mMoyen.netImposableFinal,
    netAvantImpot: mMoyen.netAPayerAvantImpot,
    pasVerse:      mMoyen.impotSource,
    netApresImpot: mMoyen.netFinal,
    coutEmployeur: mMoyen.coutTotalEmployeur,
  };

  // ── Détail des ponctuels (pour le tableau informatif) ────────────────────
  const detail = [];
  if (montantNuitsAnnuel > 0)        detail.push({ libelle: `Nuits (${saisis.nuitsAnnuelles || 0} N + ${saisis.soireesAnnuelles || 0} S2)`, montant: montantNuitsAnnuel });
  if (saisis.ottPv   > 0)            detail.push({ libelle: "OTT Part Variable globale",      montant: saisis.ottPv });
  if (saisis.ottPv32 > 0)            detail.push({ libelle: "OTT PV Opt 3-1/3-2",             montant: saisis.ottPv32 });
  if (saisis.ppp     > 0)            detail.push({ libelle: "Prime Partage Performance",       montant: saisis.ppp });
  if (saisis.fmd     > 0)            detail.push({ libelle: "Forfait Mobilités Durables",      montant: saisis.fmd });
  (saisis.libres || []).forEach(l => {
    if ((parseFloat(l.montant) || 0) > 0)
      detail.push({ libelle: l.libelle || "Prime exceptionnelle", montant: parseFloat(l.montant) });
  });

  return { annuel, mensuelMoyen, moisRecurrent: mRec, detail };
}

/**
 * Lit les saisies dans la modale et met à jour le tableau de résultats.
 */
window.calculerEtAfficherProjection = function () {
  const lire = (id) => parseFloat(document.getElementById(id)?.value) || 0;
  const libres = [];
  document.querySelectorAll(".proj-libre-row").forEach((row) => {
    libres.push({
      libelle: row.querySelector(".proj-libre-lib")?.value?.trim() || "",
      montant: parseFloat(row.querySelector(".proj-libre-val")?.value) || 0,
    });
  });

  const saisis = {
    nuitsAnnuelles:   lire("proj-nuits"),
    soireesAnnuelles: lire("proj-soirees"),
    ottPv:            lire("proj-ottPv"),
    ottPv32:          lire("proj-ottPv32"),
    ppp:              lire("proj-ppp"),
    fmd:              lire("proj-fmd"),
    libres,
  };

  // Sauvegarde automatique
  try { localStorage.setItem("icna_projection", JSON.stringify(saisis)); } catch (_) {}

  const { annuel, mensuelMoyen, detail } = calculerAnnuel(saisis);

  const fmt = (v) => v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  set("proj-res-brut",          fmt(annuel.brut));
  set("proj-res-imposable",     fmt(annuel.netImposable));
  set("proj-res-net-avant",     fmt(annuel.netAvantImpot));
  set("proj-res-pas",           fmt(annuel.pasVerse));
  set("proj-res-net-apres",     fmt(annuel.netApresImpot));
  set("proj-res-cout",          fmt(annuel.coutEmployeur));
  set("proj-moy-brut",          fmt(mensuelMoyen.brut));
  set("proj-moy-imposable",     fmt(mensuelMoyen.netImposable));
  set("proj-moy-net-avant",     fmt(mensuelMoyen.netAvantImpot));
  set("proj-moy-pas",           fmt(mensuelMoyen.pasVerse));
  set("proj-moy-net-apres",     fmt(mensuelMoyen.netApresImpot));
  set("proj-moy-cout",          fmt(mensuelMoyen.coutEmployeur));

  // Détail ponctuels
  // FIX XSS résiduel — d.libelle peut contenir une saisie utilisateur (libellés libres) :
  // construction via API DOM au lieu d'une interpolation innerHTML.
  const tbody = document.getElementById("proj-ponctuels-detail");
  if (tbody) {
    tbody.innerHTML = "";
    if (detail.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 2;
      td.style.cssText = "text-align:center;color:#999;font-style:italic;";
      td.textContent = "Aucun élément ponctuel saisi";
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      detail.forEach(d => {
        const tr  = document.createElement("tr");
        const td1 = document.createElement("td");
        const td2 = document.createElement("td");
        td1.textContent = d.libelle;
        td2.textContent = fmt(d.montant);
        tr.append(td1, td2);
        tbody.appendChild(tr);
      });
    }
  }
};

/**
 * Ouvre la modale projection et pré-remplit depuis le profil courant.
 */
window.ouvrirProjectionAnnuelle = function () {
  const p = getProfilDepuisInterface();

  // Restauration depuis localStorage, sinon valeurs par défaut
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem("icna_projection")); } catch (_) {}

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  set("proj-nuits",   saved?.nuitsAnnuelles   ?? (p.evenements.nuits   > 0 ? p.evenements.nuits   : 28));
  set("proj-soirees", saved?.soireesAnnuelles ?? (p.evenements.soirees > 0 ? p.evenements.soirees : 28));
  set("proj-ottPv",   saved?.ottPv            ?? p.evenements.ott_pv_globale);
  set("proj-ottPv32", saved?.ottPv32          ?? p.evenements.ott_pv_opt32);
  set("proj-ppp",     saved?.ppp              ?? p.evenements.prime_performance);
  set("proj-fmd",     saved?.fmd              ?? p.primes.forfait_mobilites);

  // Restauration des lignes libres
  const container = document.getElementById("proj-lignes-libres");
  if (container && saved?.libres?.length) {
    container.innerHTML = "";
    saved.libres.forEach(({ libelle, montant }) => {
      if (!montant) return;
      // FIX #2 — XSS : libellé utilisateur injecté via .value (sûr), jamais via attribut innerHTML
      container.appendChild(_creerLigneLibre(libelle, montant));
    });
  }

  ouvrirModal("panel-projection", "📅 Projection Annuelle");
  window.calculerEtAfficherProjection();
};

/**
 * Construit une ligne libre (div.proj-libre-row) via l'API DOM.
 * FIX #2 — XSS : libellé/montant passés via .value et .textContent, jamais via attribut innerHTML.
 * @param {string} [libelle=""] - Libellé pré-rempli
 * @param {number|string} [montant=""] - Montant pré-rempli
 * @returns {HTMLDivElement}
 */
function _creerLigneLibre(libelle = "", montant = "") {
  const row = document.createElement("div");
  row.className = "proj-libre-row";

  const inputLib = document.createElement("input");
  inputLib.type = "text";
  inputLib.className = "proj-libre-lib";
  inputLib.placeholder = "Libellé (ex: Rappel RIST)";
  if (libelle) inputLib.value = libelle;

  const inputVal = document.createElement("input");
  inputVal.type = "number";
  inputVal.className = "proj-libre-val";
  inputVal.placeholder = "0.00";
  inputVal.step = "10";
  if (montant) inputVal.value = montant;
  inputVal.addEventListener("focus", () => inputVal.select());
  inputVal.addEventListener("input", () => window.calculerEtAfficherProjection?.());

  const btnSuppr = document.createElement("button");
  btnSuppr.type = "button";
  btnSuppr.textContent = "✖";
  btnSuppr.addEventListener("click", () => {
    row.remove();
    window.calculerEtAfficherProjection?.();
  });

  row.append(inputLib, inputVal, btnSuppr);
  return row;
}

/**
 * Ajoute une ligne libre dans la section ponctuels.
 */
window.ajouterLigneLibre = function () {
  const container = document.getElementById("proj-lignes-libres");
  if (!container) return;
  container.appendChild(_creerLigneLibre());
};

// =============================================================================
// 13. COMPARATEUR DE SCÉNARIOS
// =============================================================================

/**
 * Construit le profil du scénario B depuis le panneau de comparaison.
 * Les champs conjoncturels (nuits, absences, PAS, enfants, CSG) sont hérités du profil A.
 *
 * @returns {ProfilAgent}
 */
function getProfilComparaisonDepuisPanneau() {
  const profilA = getProfilDepuisInterface();

  // OTT Part Fixe scénario B
  let pfTotal = parseFloat(document.getElementById("cmp-pf-manuel")?.value) || 0;
  document.querySelectorAll(".cmp-pf-checkbox").forEach((cb) => {
    if (cb.checked) pfTotal += parseFloat(cb.value);
  });

  // PSC scénario B
  let pscTotal = 0;
  document.querySelectorAll(".cmp-psc-checkbox").forEach((cb) => {
    if (cb.checked) pscTotal += parseFloat(cb.value);
  });

  const ristKey = document.getElementById("cmp-input-fonction")?.value;
  const expKey  = document.getElementById("cmp-input-experience")?.value;
  const licKey  = document.getElementById("cmp-input-isq-licence")?.value;
  const cpltKey = document.getElementById("cmp-input-isq-complement")?.value;
  const majKey  = document.getElementById("cmp-input-isq-majoration")?.value;

  return {
    grade:      document.getElementById("cmp-grade")?.value   || profilA.grade,
    echelon:    document.getElementById("cmp-echelon")?.value || profilA.echelon,
    zone:       document.querySelector('input[name="cmp-zone"]:checked')?.value || profilA.zone,
    taux_pas:   profilA.taux_pas,
    points_nbi: document.getElementById("cmp-nbi-checkbox")?.checked ? CALC.POINTS_NBI : 0,
    enfants:    parseInt(document.getElementById("cmp-enfants")?.value) || profilA.enfants,

    evenements: {
      ...profilA.evenements,
      ott_pf:         pfTotal,
      ott_pv_globale: parseFloat(document.getElementById("cmp-pv-globale")?.value) || 0,
      ott_pv_opt32:   parseFloat(document.getElementById("cmp-pv-opt32")?.value)   || 0,
    },

    primes: {
      ...profilA.primes,
      rist_fonctions:    baseDonnees.rist?.fonctions?.montants?.[ristKey]       || 0,
      rist_exper_prof:   baseDonnees.rist?.experience?.montants?.[expKey]       || 0,
      rist_lic_isq:      baseDonnees.rist?.isq_licence?.montants?.[licKey]      || 0,
      rist_cplt_lic_isq: baseDonnees.rist?.isq_complement?.montants?.[cpltKey]  || 0,
      rist_maj_isq:      baseDonnees.rist?.isq_majoration?.montants?.[majKey]   || 0,
      attractivite:      parseFloat(document.getElementById("cmp-attractivite")?.value) || 0,
      fidelisation:      parseFloat(document.getElementById("cmp-fidelisation")?.value) || 0,
      psc:               pscTotal,
    },
  };
}

/**
 * Affiche le NET À PAYER du scénario B sur une seconde ligne sous le montant A.
 * Si mB est null (hors mode comparaison), masque la ligne B.
 *
 * @param {MontantsCalcules}      mA
 * @param {MontantsCalcules|null} mB
 */
function majDeltaNet(mA, mB) {
  const elB = document.getElementById("delta-net-b");
  if (!elB) return;
  if (!mB) {
    elB.innerHTML = "";
    elB.className = "delta-net-b hidden";
    return;
  }
  const delta   = arrondir(mB.netFinal - mA.netFinal);
  if (delta === 0) {
    elB.innerHTML = "";
    elB.className = "delta-net-b hidden";
    return;
  }
  const signe   = delta >= 0 ? "+" : "";
  const couleur = delta >= 0 ? "delta-pos" : "delta-neg";
  elB.innerHTML = `${formaterMontant(mB.netFinal)} € <span class="delta-badge ${couleur}">${signe}${formaterMontant(delta)} €</span>`;
  elB.className = `delta-net-b ${couleur}`;
}

/**
 * Met à jour les échelons disponibles dans le select grade du panneau B.
 * FIX #5 — Utilise trierEchelons() partagé : ordre identique au panneau principal.
 */
function mettreAJourEchelonsB() {
  const grade  = document.getElementById("cmp-grade")?.value;
  const select = document.getElementById("cmp-echelon");
  if (!select || !baseDonnees.grilles_icna) return;
  const echelonsObj = baseDonnees.grilles_icna[grade] || {};
  const current     = select.value;
  select.innerHTML  = "";
  trierEchelons(echelonsObj).forEach((ech) => select.add(new Option(ech, ech)));
  if (current && echelonsObj[current]) select.value = current;
}

/**
 * Recalcule la fiche complète depuis le panneau comparateur.
 * Simple délégation à calculerPaie() qui gère désormais nativement le mode comparaison.
 */
function calculerPaieComparaison() {
  if (!modeComparaison) return;
  calculerPaie();
}

/**
 * Active le mode comparaison :
 * - Affiche le panneau B
 * - Initialise ses champs avec les valeurs du profil A courant
 * - Déclenche un premier calcul de delta
 */
window.activerComparaison = function () {
  modeComparaison = true;
  const panneau = document.getElementById("panneau-comparaison");
  if (panneau) panneau.classList.add("visible");

  const profilA = getProfilDepuisInterface();

  // Grade + échelon
  const cmpGrade = document.getElementById("cmp-grade");
  if (cmpGrade) {
    cmpGrade.value = profilA.grade;
    mettreAJourEchelonsB();
    document.getElementById("cmp-echelon").value = profilA.echelon;
  }

  // NBI
  const cmpNbi = document.getElementById("cmp-nbi-checkbox");
  if (cmpNbi) cmpNbi.checked = profilA.points_nbi > 0;

  // Enfants
  const cmpEnfants = document.getElementById("cmp-enfants");
  if (cmpEnfants) cmpEnfants.value = profilA.enfants;

  // Zone de résidence
  const radio = document.querySelector(`input[name="cmp-zone"][value="${profilA.zone}"]`);
  if (radio) radio.checked = true;

  // RIST / ISQ — recherche inverse montant → niveau
  const cle = (dataKey, montant) => {
    const montants = baseDonnees.rist?.[dataKey]?.montants || {};
    return Object.entries(montants).find(([, v]) => v === montant)?.[0] || "";
  };
  document.getElementById("cmp-input-fonction").value           = cle("fonctions",      profilA.primes.rist_fonctions);
  document.getElementById("cmp-input-experience").value         = cle("experience",     profilA.primes.rist_exper_prof);
  document.getElementById("cmp-input-isq-licence").value        = cle("isq_licence",    profilA.primes.rist_lic_isq);
  document.getElementById("cmp-input-isq-complement").value     = cle("isq_complement", profilA.primes.rist_cplt_lic_isq);
  document.getElementById("cmp-input-isq-majoration").value     = cle("isq_majoration", profilA.primes.rist_maj_isq);

  // Attractivité + Fidélisation
  document.getElementById("cmp-attractivite").value = profilA.primes.attractivite;
  document.getElementById("cmp-fidelisation").value = profilA.primes.fidelisation;

  // OTT Part Fixe — miroir des checkboxes principales
  ["pf-opt1-l16","pf-opt1-cdg","pf-opt1-l711","pf-opt1-l911","pf-opt1-plus-n1",
   "pf-opt1-plus-n2","pf-opt2-1","pf-opt2-2","pf-opt2-bis","pf-opt4",
   "pf-opt1-enac","pf-opt1-plus-enac"].forEach((id) => {
    const src = document.getElementById(id);
    const dst = document.getElementById("cmp-" + id);
    if (src && dst) dst.checked = src.checked;
  });
  const srcManuel = document.getElementById("pf-manuel");
  const dstManuel = document.getElementById("cmp-pf-manuel");
  if (srcManuel && dstManuel) dstManuel.value = srcManuel.value;

  // OTT Part Variable
  document.getElementById("cmp-pv-globale").value = document.getElementById("pv-globale")?.value || "0";
  document.getElementById("cmp-pv-opt32").value   = document.getElementById("pv-opt32")?.value   || "0";

  // PSC
  document.querySelectorAll(".psc-checkbox").forEach((src) => {
    const dst = document.getElementById("cmp-" + src.id);
    if (dst) dst.checked = src.checked;
  });

  calculerPaie(); // redessine la fiche + déclenche les deltas
};

/** Désactive le mode comparaison et redessine la fiche sans scénario B. */
window.desactiverComparaison = function () {
  modeComparaison = false;
  const panneau = document.getElementById("panneau-comparaison");
  if (panneau) panneau.classList.remove("visible");
  calculerPaie(); // redessine proprement sans pB/mB
};

/**
 * Initialise le panneau comparateur après le chargement de data.json :
 * peuple les selects grade, RIST, attractivité, fidélisation du panneau B.
 * Appelée une seule fois depuis initialiserApplication().
 */
function initialiserComparateur() {
  // Grade select B
  const cmpGrade = document.getElementById("cmp-grade");
  if (cmpGrade && baseDonnees.grilles_icna) {
    cmpGrade.innerHTML = "";
    Object.keys(baseDonnees.grilles_icna).forEach((g) => cmpGrade.add(new Option(g, g)));
    cmpGrade.addEventListener("change", () => { mettreAJourEchelonsB(); calculerPaieComparaison(); });
  }
  mettreAJourEchelonsB();

  // RIST / ISQ selects B
  [
    { id: "cmp-input-fonction",           dataKey: "fonctions"      },
    { id: "cmp-input-experience",         dataKey: "experience"     },
    { id: "cmp-input-isq-licence",        dataKey: "isq_licence"    },
    { id: "cmp-input-isq-complement",     dataKey: "isq_complement" },
    { id: "cmp-input-isq-majoration",     dataKey: "isq_majoration" },
  ].forEach(({ id, dataKey }) => {
    const select = document.getElementById(id);
    if (!select || !baseDonnees.rist?.[dataKey]) return;
    select.innerHTML = "";
    Object.entries(baseDonnees.rist[dataKey].montants).forEach(([niveau, montant]) => {
      select.add(new Option(`${niveau} — ${montant.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €`, niveau));
    });
  });

  // Attractivité + Fidélisation selects B
  ["attractivite", "fidelisation"].forEach((cle) => {
    const select = document.getElementById(`cmp-${cle}`);
    if (select && baseDonnees[cle]) {
      select.innerHTML = "";
      baseDonnees[cle].forEach((opt) => select.add(new Option(opt.label, opt.valeur)));
    }
  });

  // Tous les champs du panneau B déclenchent calculerPaieComparaison
  document.querySelectorAll("#panneau-comparaison select, #panneau-comparaison input:not([name='cmp-zone'])").forEach((el) => {
    el.addEventListener("input",  calculerPaieComparaison);
    el.addEventListener("change", calculerPaieComparaison);
  });
  // Radios zone séparément (pas interceptés par le sélecteur ci-dessus)
  document.querySelectorAll("input[name='cmp-zone']").forEach((radio) => {
    radio.addEventListener("change", calculerPaieComparaison);
  });
}

// =============================================================================
// 13. VISITE GUIDÉE CUSTOM — zéro driver.js
// =============================================================================
//
// Architecture :
//   - #tour-spotlight  : div fixe, déplacé par JS (box-shadow = fond sombre)
//   - #tour-popover    : div fixe, contenu mis à jour sans recréation DOM
//   - Watcher          : polling 200ms, comparaison état-courant vs état-à-l'entrée
//   - RIST             : sous-état interne, spotlight défile ligne par ligne
//

// ─── Données ─────────────────────────────────────────────────────────────────

const RIST_KEYS = [
  { cle: "rist_fonctions",      libelle: "RIST Part Fonctions",    rowId: "row-201958" },
  { cle: "rist_experience",     libelle: "RIST Part Expérience",   rowId: "row-201959" },
  { cle: "rist_isq_licence",    libelle: "RIST Part LIC-ISQ",      rowId: "row-201960" },
  { cle: "rist_isq_complement", libelle: "RIST CPLT LIC-ISQ",      rowId: "row-201961" },
  { cle: "rist_isq_majoration", libelle: "Majoration ISQ",         rowId: "row-201962" },
];

const LABELS_CHAMPS = {
  grade: "Grade", echelon: "Échelon", enfants: "Enfants à charge",
  nbi: "NBI", zone_residence: "Zone de résidence",
  rist_fonctions: "RIST Part Fonctions", rist_experience: "RIST Part Expérience",
  rist_isq_licence: "RIST Part LIC-ISQ", rist_isq_complement: "RIST CPLT LIC-ISQ",
  rist_isq_majoration: "Majoration ISQ",
  ind_compensatrice_csg: "Ind. Compensatrice CSG", taux_pas: "Taux PAS",
};

// ─── État global du tour ──────────────────────────────────────────────────────

window.isTourActive       = false;
window._tourEtapeIndex    = 0;
window._tourPauseParModal = false;
window._tourWatchInterval = null;  // conservé pour nettoyage compat, plus utilisé par setInterval
window._tourWatchHandler  = null;  // FIX #10 — handler CustomEvent "champ-configure"
window._tourReprendreApresModal = null;

// ─── Helpers DOM (encapsulation des sélecteurs — un seul endroit à changer si les IDs bougent) ──

const _elPopover   = () => document.getElementById("tour-popover");
const _elSpotlight = () => document.getElementById("tour-spotlight");
const _elHeader    = () => document.querySelector(".tour-pop-header");
const _elBody      = () => document.querySelector(".tour-pop-body");
const _elStep      = () => document.querySelector(".tour-pop-step");
const _elTitle     = () => document.querySelector(".tour-pop-title");
const _elNext      = () => document.querySelector(".tour-pop-next");
const _elPrev      = () => document.querySelector(".tour-pop-prev");

// ─── Positionnement ───────────────────────────────────────────────────────────

const TOUR_GAP   = 12; // px entre spotlight et popover
const TOUR_MARGE = 10; // px de marge screen edges

/**
 * Déplace le spotlight sur un élément DOM.
 * Utilise opacity (pas display) pour préserver les transitions CSS top/left/width/height.
 * display:none n'est utilisé que par _tourFermer (tour complètement inactif).
 */
function _tourSpotlightSur(el, padding = 6) {
  const sp = _elSpotlight();
  if (!sp) return;
  if (!el) {
    sp.classList.add("tour-spotlight-invisible");
    return;
  }
  const r = el.getBoundingClientRect();
  // Positionner D'ABORD (pendant l'invisibilité si applicable), puis révéler
  sp.style.top    = (r.top    - padding) + "px";
  sp.style.left   = (r.left   - padding) + "px";
  sp.style.width  = (r.width  + padding * 2) + "px";
  sp.style.height = (r.height + padding * 2) + "px";
  sp.classList.remove("tour-spotlight-invisible");
}

/**
 * Positionne le popover au-dessus de l'élément (ou en dessous si pas de place).
 * Si el est null → centré à l'écran.
 */
function _tourPositionnerPopover(el) {
  const pop = _elPopover();
  if (!pop) return;
  const PW = pop.offsetWidth  || 320;
  const PH = pop.offsetHeight || 200;
  const VW = window.innerWidth;
  const VH = window.innerHeight;

  if (!el) {
    // Centré
    pop.style.left = Math.round((VW - PW) / 2) + "px";
    pop.style.top  = Math.round((VH - PH) / 2) + "px";
    return;
  }

  const r = el.getBoundingClientRect();

  // Position horizontale : aligner sur la gauche de l'élément, recadrer si débordement
  let left = r.left;
  if (left + PW > VW - TOUR_MARGE) left = VW - PW - TOUR_MARGE;
  if (left < TOUR_MARGE) left = TOUR_MARGE;

  // Position verticale : préférer au-dessus
  let top = r.top - PH - TOUR_GAP;
  if (top < TOUR_MARGE) {
    // Pas de place au-dessus → en dessous
    top = r.bottom + TOUR_GAP;
  }
  if (top + PH > VH - TOUR_MARGE) top = VH - PH - TOUR_MARGE;

  pop.style.left = Math.round(left) + "px";
  pop.style.top  = Math.round(top)  + "px";
}

// ─── Mise à jour du contenu du popover ───────────────────────────────────────

/**
 * Met à jour le contenu du popover avec un fade sur le popover entier (80ms).
 * Header + body + boutons sont mis à jour d'un seul coup pendant le fade-out,
 * évitant tout flash "ancien contenu / nouveau titre".
 */
function _tourMajContenu(step, index, total, opts = {}) {
  const pop     = _elPopover();
  const body    = _elBody();
  const header  = _elHeader();
  const elStep  = _elStep();
  const elTitle = _elTitle();
  const btnNext = _elNext();
  const btnPrev = _elPrev();

  // Fade out du popover entier
  pop?.classList.add("tour-popover-fading");

  setTimeout(() => {
    // ── Mise à jour complète pendant l'invisibilité ──

    // Header
    if (elStep)  elStep.textContent  = `${index + 1}/${total}`;
    if (elTitle) elTitle.textContent = step.title;

    // Coche : afficher si le champ est déjà configuré (retour arrière)
    const dejaFait = step.watchFn ? step.watchFn() : false;
    if (dejaFait) header?.classList.add("tour-valide");
    else          header?.classList.remove("tour-valide");

    // Précédent masqué à l'étape 0
    if (btnPrev) btnPrev.style.visibility = (index === 0) ? "hidden" : "";

    // Bouton Suivant
    if (btnNext) {
      const bloque = step.blockedBy ? step.blockedBy() : false;
      btnNext.disabled    = bloque;
      btnNext.textContent = (index === total - 1) ? "Terminer ✓" : "Suivant ➔";
      btnNext.classList.remove("tour-next-ready");
    }

    // Corps
    if (body) {
      body.innerHTML = step.description + (step.hint ? `<em class="tour-hint">${step.hint}</em>` : "");
    }

    // Callbacks post-render (checklist RIST etc.)
    // Important : doit être appelé AVANT le repositionnement final
    // car _ristDemarrer() (dans onRender) peut changer la cible du spotlight
    if (opts.postRender) opts.postRender();

    // Repositionner le popover avec le nouveau contenu
    // Pour l'étape RIST, utiliser _ristElActif (mis à jour par _ristDemarrer)
    let elPos;
    if (step.isRist) {
      elPos = _ristElActif || document.getElementById("row-201958");
    } else {
      elPos = step.element ? document.querySelector(step.element) : null;
    }
    _tourPositionnerPopover(elPos);

    // Fade in
    pop?.classList.remove("tour-popover-fading");
  }, 80);
}

// ─── Watcher ─────────────────────────────────────────────────────────────────

/**
 * Active le watcher pour l'étape courante.
 * FIX #10 — Remplace le polling setInterval(200ms) par un listener sur l'événement
 * "champ-configure" émis par marquerConfigure(). Réactif instantanément, zéro overhead en idle.
 * Enregistre l'état du champ AU MOMENT DE L'APPEL (synchrone).
 * Déclenche uniquement si l'état passe false → true par rapport à cet instant.
 */
function _tourActiverWatcher(step) {
  // Nettoyer le listener précédent s'il existe encore
  if (window._tourWatchHandler) {
    document.removeEventListener("champ-configure", window._tourWatchHandler);
    window._tourWatchHandler = null;
  }
  clearInterval(window._tourWatchInterval); // compat : on ne set plus d'interval mais on nettoie par sécurité
  if (!step.watchFn) return;

  const etatInitial = step.watchFn(); // État au moment de l'entrée dans l'étape

  const handler = () => {
    if (!window.isTourActive || window._tourPauseParModal) return;
    if (!etatInitial && step.watchFn()) {
      // Transition false → true : valider visuellement, débloquer Suivant
      document.removeEventListener("champ-configure", handler);
      window._tourWatchHandler = null;
      _tourSignalerValidation();
    }
  };
  window._tourWatchHandler = handler;
  document.addEventListener("champ-configure", handler);
}

/** Affiche la coche ✓ dans le header et débloque le bouton Suivant. */
function _tourSignalerValidation() {
  const header  = _elHeader();
  const btnNext = _elNext();
  header?.classList.add("tour-valide");
  if (btnNext) {
    btnNext.disabled = false;
    btnNext.classList.add("tour-next-ready");
    // Retirer la classe pulse après l'animation
    setTimeout(() => btnNext.classList.remove("tour-next-ready"), 600);
  }
}

// ─── Verrouillage de la page pendant le tour ─────────────────────────────────

let _tourToastTimer = null;

/** Affiche un message toast pendant `duree` ms. */
function _tourAfficherToast(msg, duree = 1800) {
  const t = document.getElementById("tour-toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("tour-toast-visible");
  clearTimeout(_tourToastTimer);
  _tourToastTimer = setTimeout(() => t.classList.remove("tour-toast-visible"), duree);
}

/**
 * Logique partagée de la garde — retourne true si l'événement doit être bloqué.
 * Utilisée en capture pour click ET mousedown (les <select> natifs s'ouvrent sur mousedown).
 */
function _tourDoitBloquer(e) {
  if (!window.isTourActive || window._tourPauseParModal) return false;

  const pop   = document.getElementById("tour-popover");
  const sp    = document.getElementById("tour-spotlight");
  const modal = document.getElementById("magic-modal");

  if (pop   && pop.contains(e.target))   return false;
  if (modal && modal.contains(e.target)) return false;

  if (sp && sp.style.display !== "none" && !sp.classList.contains("tour-spotlight-invisible")) {
    const r = sp.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right &&
        e.clientY >= r.top  && e.clientY <= r.bottom) {
      return false; // dans la zone illuminée → autorisé
    }
  }

  return true; // hors zone → bloquer
}

function _tourGuardeClic(e) {
  if (!_tourDoitBloquer(e)) return;
  e.stopPropagation();
  e.preventDefault();
  const step = _tourSteps?.[window._tourEtapeIndex];
  const msg  = step?.blockedBy?.() === false || !step?.blockedBy
    ? "Cliquez sur « Suivant » pour continuer ➔"
    : "Terminez cette étape avant de continuer.";
  _tourAfficherToast(msg);
}

function _tourGardeMousedown(e) {
  if (!_tourDoitBloquer(e)) return;
  e.stopPropagation();
  e.preventDefault();
  // Pas de toast sur mousedown pour éviter le doublon avec le click qui suit
}

// ─── Moteur principal ─────────────────────────────────────────────────────────

let _tourSteps   = [];
let _tourTotal   = 0;
let _tourPhase   = "phase1"; // "phase1" | "phase2"

/**
 * Affiche l'étape `index` du tour.
 * Gère spotlight + positionnement + contenu + watcher.
 */
function _tourAfficherEtape(index) {
  if (index < 0 || index >= _tourSteps.length) return;
  window._tourEtapeIndex = index;
  const step = _tourSteps[index];

  const pop = _elPopover();
  if (!pop || pop.style.display === "none") return;

  // Élément DOM cible
  const el = step.element ? document.querySelector(step.element) : null;

  // Déplacer le spotlight
  if (!step.isRist) {
    _tourSpotlightSur(el);
  } else {
    // RIST : cacher le spotlight immédiatement pour éviter qu'il reste
    // sur la position précédente pendant le fade. _ristDemarrer() le
    // RIST : rendre le spotlight invisible (pas display:none) pour que la transition
    // top/left puisse jouer quand _ristDemarrer() le repositionne et le révèle.
    _ristElActif = null;
    const sp = _elSpotlight();
    if (sp) sp.classList.add("tour-spotlight-invisible");
  }

  // NE PAS positionner le popover ici — il sera repositionné à l'intérieur du fade
  // (pendant l'invisibilité) dans _tourMajContenu, évitant tout flash avec ancien contenu

  // Mettre à jour le contenu (fade-out → reposition → nouveau contenu → fade-in)
  _tourMajContenu(step, index, _tourTotal, {
    postRender: () => {
      if (step.onRender) step.onRender();
    },
  });

  // Activer le watcher
  _tourActiverWatcher(step);

  // Callback étape
  step.onEnter?.();
}

/** Lance le tour phase 1 ou reprend à l'étape donnée. */
function _tourDemarrer(steps, startIndex = 0, phase = "phase1") {
  _tourSteps = steps;
  _tourTotal = steps.length;
  _tourPhase = phase;
  window.isTourActive    = true;
  window._tourPauseParModal = false;
  window._tourReprendreApresModal = null;

  // Activer le verrouillage de la page (click + mousedown pour bloquer les <select> natifs)
  document.addEventListener("click",     _tourGuardeClic,      true);
  document.addEventListener("mousedown", _tourGardeMousedown,  true);

  const pop = _elPopover();
  const sp  = _elSpotlight();

  // Popover hors-écran avant affichage pour éviter flash à position précédente
  if (pop) {
    pop.style.left    = "-9999px";
    pop.style.top     = "-9999px";
    pop.style.display = "";
  }
  // Spotlight visible mais transparent — la transition opacity jouera à la première étape
  if (sp) {
    sp.style.display = "";
    sp.classList.add("tour-spotlight-invisible");
  }

  _tourAfficherEtape(startIndex);
}

/** Ferme le tour proprement. */
function _tourFermer(pulserBadges = true) {
  // FIX #10 — Nettoyer le listener CustomEvent (remplace clearInterval)
  if (window._tourWatchHandler) {
    document.removeEventListener("champ-configure", window._tourWatchHandler);
    window._tourWatchHandler = null;
  }
  clearInterval(window._tourWatchInterval); // compat : garde le nettoyage pour sécurité
  window.isTourActive    = false;
  window._tourPauseParModal = false;
  window._tourReprendreApresModal = null;

  // Désactiver le verrouillage de la page
  document.removeEventListener("click",     _tourGuardeClic,     true);
  document.removeEventListener("mousedown", _tourGardeMousedown, true);
  clearTimeout(_tourToastTimer);
  const t = document.getElementById("tour-toast");
  if (t) t.classList.remove("tour-toast-visible");

  const pop = _elPopover();
  const sp  = _elSpotlight();
  if (pop) pop.style.display = "none";
  if (sp) {
    sp.style.display = "none";
    sp.classList.remove("tour-spotlight-invisible");
  }

  document.getElementById("btn-reset-profil")?.classList.remove("tour-highlight-reset");
  document.querySelectorAll(".tour-ligne-pulsante").forEach(el => el.classList.remove("tour-ligne-pulsante"));

  if (pulserBadges) {
    setTimeout(() => {
      document.querySelectorAll(".badge-configurer").forEach(b => {
        b.classList.add("tour-post-attention");
        setTimeout(() => b.classList.remove("tour-post-attention"), 4000);
      });
    }, 300);
  }
}
// Exposer pour les onclick HTML inline
window._tourFermer = _tourFermer;

// ─── Boutons du popover ───────────────────────────────────────────────────────

window._tourNext = function () {
  // Le nettoyage du handler CustomEvent est fait dans _tourActiverWatcher() appelé par _tourAfficherEtape.
  // clearInterval conservé par compat (no-op, window._tourWatchInterval est toujours null).
  clearInterval(window._tourWatchInterval);
  const btnNext = _elNext();
  if (btnNext?.disabled) return;
  const next = window._tourEtapeIndex + 1;
  if (next >= _tourTotal) {
    // Fin du tour — fermeture propre dans les deux phases
    // La phase 2 a sa propre étape de conclusion dans steps[], pas besoin de cas spécial
    _tourFermer(_tourPhase === "phase1");
    return;
  }
  _tourAfficherEtape(next);
};

window._tourPrev = function () {
  clearInterval(window._tourWatchInterval); // compat no-op
  const prev = window._tourEtapeIndex - 1;
  if (prev < 0) return;
  _tourAfficherEtape(prev);
};

window._tourSkip = function () {
  const body = _elBody();
  if (body?.querySelector(".tour-confirm-quit")) {
    body.querySelector(".tour-confirm-quit").remove();
    _tourFermer();
    return;
  }
  const div = document.createElement("div");
  div.className = "tour-confirm-quit";
  div.innerHTML = `Quitter le tutoriel ?&nbsp;
    <button class="btn-oui" onclick="_tourFermer()">Oui</button>&nbsp;
    <button class="btn-non" onclick="this.closest('.tour-confirm-quit').remove()">Non</button>`;
  if (body) body.appendChild(div);
};

// ─── Gestion modale (reprise après fermeture) ─────────────────────────────────

/**
 * Appelé par le handler close de #magic-modal.
 * Pour chaque étape "modale" : détermine si on avance ou on reste.
 * Initialisé à null ; écrasé par _tourInstallerRepriseApresModal() à chaque étape modale.
 */
function _tourInstallerRepriseApresModal(index, steps) {
  const RIST_CLES = RIST_KEYS.map(r => r.cle);

  window._tourReprendreApresModal = () => {
    if (!window.isTourActive) return;
    window._tourPauseParModal = false;
    const step = steps[index];

    // Étape RIST (6) : logique spéciale avec spotlight mobile
    if (step.isRist) {
      _tourRistApresModal();
      return;
    }

    // Autres étapes avec modale : vérifier si configuré → avancer
    const estFait = step.watchFn ? step.watchFn() : true;
    if (estFait) {
      _elHeader()?.classList.add("tour-valide");
      const btnNext = _elNext();
      if (btnNext) {
        btnNext.disabled = false;
        btnNext.classList.add("tour-next-ready");
        setTimeout(() => btnNext.classList.remove("tour-next-ready"), 600);
      }
    }
    // Réafficher popover et spotlight sur le même élément
    const pop = _elPopover();
    const sp  = _elSpotlight();
    if (pop) pop.style.display = "";
    if (sp)  sp.classList.remove("tour-spotlight-invisible");
    const el = step.element ? document.querySelector(step.element) : null;
    _tourSpotlightSur(el);
    _tourPositionnerPopover(el);
  };
}

// ─── Étape RIST : logique spotlight mobile ────────────────────────────────────

let _ristIndexActif = 0; // index dans RIST_KEYS de la ligne actuellement spotlightée
let _ristElActif    = null; // nœud DOM actuellement spotlighté — seuls _ristDemarrer et _tourRistApresModal peuvent le changer

/**
 * Retourne la prochaine ligne RIST non configurée (ou null si toutes faites).
 * Une ligne "Aucune" dont la row est absente du DOM est considérée comme configurée
 * (montant 0 → ligne masquée → pas besoin de la pointer).
 */
function _ristProchaineLigne() {
  return RIST_KEYS.find(r => {
    if (!nonConfigure(r.cle)) return false;          // déjà configurée
    const el = document.getElementById(r.rowId);
    if (!el) return false;                            // ligne absente du DOM (montant 0) → skip
    return true;
  }) || null;
}

/** Met à jour la checklist RIST dans le corps du popover (DOM direct, pas de fade). */
function _ristMajChecklist(indexActif) {
  const body = _elBody();
  if (!body) return;
  let liste = body.querySelector(".tour-rist-checklist");
  if (!liste) return; // sera créée au postRender

  const html = RIST_KEYS.map((r, i) => {
    const fait  = !nonConfigure(r.cle);
    const actif = i === indexActif;
    return `<div class="tour-rist-item${fait ? " done" : ""}${actif && !fait ? " actif" : ""}">
      <span class="tour-rist-check">${fait ? "✓" : ""}</span>
      <span>${r.libelle}</span>
    </div>`;
  }).join("");
  if (liste.innerHTML !== html) liste.innerHTML = html;
}

/**
 * Logique commune : trouve la prochaine ligne RIST à configurer,
 * déplace le spotlight dessus et met à jour la checklist.
 * Appelée à l'entrée de l'étape (onRender) ET à la reprise après chaque modale RIST.
 */
function _ristSuivreProgression() {
  const prochaine = _ristProchaineLigne();
  if (!prochaine) {
    // Toutes configurées : spotlight sur le groupe entier
    _ristSpotlightGroupe();
    _ristMajChecklist(-1);
    _tourSignalerValidation();
    return;
  }
  const idx = RIST_KEYS.indexOf(prochaine);
  _ristIndexActif = idx;
  _ristElActif    = document.getElementById(prochaine.rowId);
  _tourSpotlightSur(_ristElActif);
  _tourPositionnerPopover(_ristElActif);
  _ristMajChecklist(idx);
}

/** Pointage initial de la première ligne RIST. Appelé dans onRender de l'étape 6. */
function _ristDemarrer() {
  _ristSuivreProgression();
}

/** Appelé après fermeture d'une modale RIST. */
function _tourRistApresModal() {
  const pop = _elPopover();
  if (pop) pop.style.display = "";
  _ristSuivreProgression();
}
function _ristSpotlightGroupe() {
  // Collecter uniquement les lignes RIST effectivement rendues dans le DOM
  const lignesPresentes = RIST_KEYS
    .map(r => document.getElementById(r.rowId))
    .filter(el => el !== null);

  if (lignesPresentes.length === 0) return;

  const premiere = lignesPresentes[0];
  const derniere = lignesPresentes[lignesPresentes.length - 1];
  const rTop    = premiere.getBoundingClientRect();
  const rBot    = derniere.getBoundingClientRect();
  const padding = 4;
  const sp = _elSpotlight();
  if (sp) {
    sp.style.top    = (rTop.top    - padding) + "px";
    sp.style.left   = (rTop.left   - padding) + "px";
    sp.style.width  = (rTop.width  + padding * 2) + "px";
    sp.style.height = (rBot.bottom - rTop.top + padding * 2) + "px";
    sp.classList.remove("tour-spotlight-invisible");
  }
  // Mémoriser comme élément actif pour le rafraîchissement
  _ristElActif = premiere;
  _tourPositionnerPopover(premiere);
}

// =============================================================================
// PHASE 1 — Démarrage (9 étapes)
// =============================================================================

window.lancerVisiteGuidee = function (startIndex = 0) {

  const HINT = "Remplissez ce champ pour débloquer la suite.";

  // Définition des étapes
  // - element    : sélecteur CSS de la cible (null = centré)
  // - title      : titre dans le header
  // - description: HTML dans le body
  // - hint       : texte italique sous la description (optionnel)
  // - blockedBy  : fonction → true si Suivant doit rester disabled
  // - watchFn    : fonction → true quand le champ est configuré (auto-débloque)
  //                IMPORTANT : retourne la valeur à l'instant T, évaluée en synchrone
  // - isRist     : flag étape spéciale RIST
  // - onEnter    : callback à l'entrée dans l'étape
  // - onRender   : callback après mise à jour du DOM du body

  const steps = [

    // 0 — Introduction
    {
      element: null,
      title: "Simulateur de paie ICNA",
      description:
        `<span style="color:#aaa;font-size:11px;display:block;margin-bottom:10px">9 étapes · ~3 min</span>` +
        `Ce simulateur reproduit fidèlement votre <strong>fiche de paie mensuelle</strong> ` +
        `et calcule en temps réel votre <strong>net à payer</strong> ` +
        `selon votre grade, vos primes RIST &amp; ISQ et votre taux PAS.<br><br>` +
        `Les encadrés <strong style="color:#fd7e14">⚙ À configurer</strong> indiquent ce qui reste à renseigner.`,
      blockedBy: null,
      watchFn:   null,
    },

    // 1 — Grade
    {
      element: "#input-grade",
      title: "Votre grade",
      description: `Sélectionnez votre <strong>grade</strong>. Il détermine votre indice et votre traitement brut.`,
      hint: HINT,
      blockedBy: () => nonConfigure("grade"),
      watchFn:   () => !nonConfigure("grade"),
    },

    // 2 — Échelon
    {
      element: "#input-echelon",
      title: "Votre échelon",
      description: `Choisissez votre <strong>échelon</strong> dans ce grade. L'indice correspondant s'affiche dans le tableau.`,
      hint: HINT,
      blockedBy: () => nonConfigure("echelon"),
      watchFn:   () => !nonConfigure("echelon"),
    },

    // 3 — Enfants
    {
      element: "#input-enfants",
      title: "Enfants à charge",
      description: `Indiquez votre <strong>nombre d'enfants à charge</strong> (Supplément Familial de Traitement).`,
      hint: HINT,
      blockedBy: () => nonConfigure("enfants"),
      watchFn:   () => !nonConfigure("enfants"),
    },

    // 4 — NBI
    {
      element: "#nbi-cell",
      title: "NBI",
      description:
        `Bénéficiez-vous de la <strong>Nouvelle Bonification Indiciaire</strong> ?<br>` +
        `Cochez si oui — cliquez <strong>✕</strong> si vous ne l'avez pas.`,
      hint: HINT,
      blockedBy: () => nonConfigure("nbi"),
      watchFn:   () => !nonConfigure("nbi"),
    },

    // 5 — Zone de résidence
    {
      element: "#row-102000",
      title: "Zone de résidence",
      description:
        `<strong>Cliquez sur cette ligne</strong> pour ouvrir le panneau.<br>` +
        `Zone 1 = 3 %, Zone 2 = 1 %, Zone 3 = 0 % du traitement brut.`,
      hint: HINT,
      blockedBy: () => nonConfigure("zone_residence"),
      watchFn:   () => !nonConfigure("zone_residence"),
      onEnter: () => {
        _tourInstallerRepriseApresModal(5, steps);
      },
    },

    // 6 — RIST & ISQ
    {
      element: "#row-201958", // sera mis à jour dynamiquement par _ristDemarrer
      title: "Ristournes & ISQ",
      description:
        `<strong>Cliquez sur chaque ligne</strong> pour configurer votre niveau.<br>` +
        `Le tutoriel vous guide ligne par ligne.<br>` +
        `<div class="tour-rist-checklist"></div>`,
      blockedBy: () => !RIST_KEYS.every(r => {
        if (!nonConfigure(r.cle)) return true;       // configurée → OK
        if (!document.getElementById(r.rowId)) return true; // absente du DOM → skip
        return false;                                 // présente et non configurée → bloque
      }),
      watchFn:   null, // géré par reprise post-modale
      isRist:    true,
      onEnter: () => {
        _tourInstallerRepriseApresModal(6, steps);
      },
      onRender: () => {
        _ristDemarrer();
      },
    },

    // 7 — Ind. CSG
    {
      element: "#row-202206",
      title: "Indemnité Compensatrice CSG",
      description:
        `Montant <strong>propre à chaque agent</strong>.<br>` +
        `Repérez la ligne <em>« Ind. Comp. CSG »</em> sur votre dernière fiche de paie et saisissez ce montant.`,
      hint: HINT,
      blockedBy: () => nonConfigure("ind_compensatrice_csg"),
      watchFn:   () => !nonConfigure("ind_compensatrice_csg"),
      onEnter: () => {
        _tourInstallerRepriseApresModal(7, steps);
      },
    },

    // 8 — Taux PAS
    {
      element: "#row-taux-impot",
      title: "Taux PAS",
      description:
        `Votre <strong>taux personnalisé</strong> de Prélèvement à la Source.<br>` +
        `Visible sur <em>impots.gouv.fr</em> dans votre espace personnel.`,
      hint: HINT,
      blockedBy: () => nonConfigure("taux_pas"),
      watchFn:   () => !nonConfigure("taux_pas"),
      onEnter: () => {
        // Fallback si la ligne taux n'existe pas encore
        const el = document.getElementById("row-taux-impot");
        if (!el) steps[8].element = ".pay-table-foot";
        _tourInstallerRepriseApresModal(8, steps);
      },
    },

    // 9 — Totaux
    {
      element: ".pay-table-foot",
      title: "Vos totaux",
      description:
        `<strong>Net à Payer</strong>, Net imposable et Coût employeur ` +
        `se recalculent instantanément à chaque modification.<br><br>` +
        `Votre profil est configuré — vous pouvez maintenant simuler librement.`,
      blockedBy: null,
      watchFn:   null,
    },
  ];

  _tourDemarrer(steps, startIndex, "phase1");
};

// =============================================================================
// PHASE 2 — Fonctions avancées
// =============================================================================

window.lancerVisiteAvancee = function (startIndex = 0) {
  const steps = [
    {
      element: ".add-row",
      title: "Éléments variables",
      description:
        `Cliquez ici pour ajouter :<br>` +
        `• <strong>OTT Part Fixe</strong> (1, 1+, 2, 3, 4)<br>` +
        `• <strong>OTT Part Variable</strong><br>` +
        `• <strong>Prime Partage Performance (PPP)</strong><br>` +
        `• <strong>Forfait Mobilité Durable (FMD)</strong><br>` +
        `• <strong>Protection Sociale Complémentaire (PSC)</strong><br>` +
        `• <strong>Absence</strong> (grève, maladie)<br>` +
        `• <strong>Nuits et S2</strong>`,
    },
    {
      element: null,
      title: "Recherche rapide — Ctrl+K",
      description:
        `Pressez <strong>Ctrl+K</strong> à tout moment pour accéder directement ` +
        `au bon panneau de configuration.<br><br>` +
        `<button class="tour-demo-btn" id="tour-demo-spotlight-btn" onclick="window._tourLancerDemoSpotlight()">▶ Lancer la démo</button>`,
    },
    {
      element: "#lignes-paie",
      title: "Fiche interactive",
      description:
        `Les lignes surlignées en vert sont <strong>cliquables</strong> — ` +
        `un clic ouvre directement le panneau correspondant.`,
      onEnter: () => {
        document.querySelectorAll("#lignes-paie tr.clickable-row").forEach(el => el.classList.add("tour-ligne-pulsante"));
      },
    },
    {
      element: "#btn-comparer-flottant",
      title: "Comparateur",
      description:
        `Comparez deux situations côte à côte. ` +
        `Les <strong>deltas</strong> s'affichent ligne par ligne.`,
      onEnter: () => {
        document.querySelectorAll(".tour-ligne-pulsante").forEach(el => el.classList.remove("tour-ligne-pulsante"));
      },
    },
    {
      element: "#btn-projection-flottant",
      title: "Projection annuelle",
      description:
        `Calculez votre <strong>revenu annuel</strong> avec nuits, OTT, PPP, FMD. ` +
        `Tout est sauvegardé automatiquement.`,
    },
    {
      element: "#btn-reset-profil",
      title: "Réinitialiser",
      description: `Ce bouton <strong>↺</strong> efface tout : profil, badges et données de projection.`,
      onEnter: () => document.getElementById("btn-reset-profil")?.classList.add("tour-highlight-reset"),
    },
    // Conclusion — étape finale sans spotlight
    {
      element: null,
      title: "✅ Vous êtes prêt !",
      description:
        `Vous maîtrisez maintenant tout le simulateur.<br><br>` +
        `• <strong>Ctrl+K</strong> — recherche rapide<br>` +
        `• <strong>⚖ Comparer</strong> — scénarios côte à côte<br>` +
        `• <strong>📅 Annuel</strong> — projection sur l'année<br><br>` +
        `<strong>Bonne simulation !</strong>`,
      onEnter: () => {
        // Retirer le highlight reset si on arrive ici depuis l'étape précédente
        document.getElementById("btn-reset-profil")?.classList.remove("tour-highlight-reset");
      },
    },
  ];

  _tourDemarrer(steps, startIndex, "phase2");
};

// ── Démo Ctrl+K ───────────────────────────────────────────────────────────────

window._tourLancerDemoSpotlight = function () {
  const btn       = document.getElementById("tour-demo-spotlight-btn");
  const spotModal = document.getElementById("spotlight-modal");
  const spotInput = document.getElementById("spotlight-input");
  const spotRes   = document.getElementById("spotlight-results");
  if (!spotModal || !spotInput || !btn) return;
  btn.disabled    = true;
  btn.textContent = "Démonstration en cours…";
  const sequence = [
    () => { spotModal.showModal(); spotInput.value = ""; spotRes && (spotRes.innerHTML = ""); spotInput.focus(); },
    ...["r","i","s","t"].map(l => () => { spotInput.value += l; spotInput.dispatchEvent(new Event("input",{bubbles:true})); }),
    null, null, null,
    ...Array(4).fill(() => { spotInput.value = spotInput.value.slice(0,-1); spotInput.dispatchEvent(new Event("input",{bubbles:true})); }),
    ...["n","u","i","t"].map(l => () => { spotInput.value += l; spotInput.dispatchEvent(new Event("input",{bubbles:true})); }),
    null, null, null,
    () => { spotInput.value = ""; spotRes && (spotRes.innerHTML = ""); },
    () => { if (spotModal.open) spotModal.close(); },
    () => { if (btn) { btn.disabled = false; btn.textContent = "▶ Relancer la démo"; } },
  ];
  let i = 0;
  const run = () => {
    if (i >= sequence.length) return;
    if (!window.isTourActive) { if (spotModal.open) spotModal.close(); return; }
    const fn = sequence[i++];
    if (fn) fn();
    setTimeout(run, fn ? 190 : 480);
  };
  setTimeout(run, 300);
};
