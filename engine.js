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
const CLE_RAPPELS = "icna_rappels_v1";

// Derniers résultats de calcul — utilisés par l'auto-calc des rappels
let _dernierProfil    = null;
let _derniersMontants = null;

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
  // OTT Part Fixe — cases à cocher + saisie manuelle
  { id: "pf-opt1-l16",       type: "checkbox" },
  { id: "pf-opt1-cdg",       type: "checkbox" },
  { id: "pf-opt1-l711",      type: "checkbox" },
  { id: "pf-opt1-l911",      type: "checkbox" },
  { id: "pf-opt1-plus-n1",   type: "checkbox" },
  { id: "pf-opt1-plus-n2",   type: "checkbox" },
  { id: "pf-opt2-1",         type: "checkbox" },
  { id: "pf-opt2-2",         type: "checkbox" },
  { id: "pf-opt2-bis",       type: "checkbox" },
  { id: "pf-opt4",           type: "checkbox" },
  { id: "pf-opt1-enac",      type: "checkbox" },
  { id: "pf-opt1-plus-enac", type: "checkbox" },
  { id: "pf-manuel",         type: "value" },
  // OTT Part Variable
  { id: "pv-globale",        type: "value" },
  { id: "pv-opt32",          type: "value" },
  // Éléments variables mensuels
  { id: "input-nuit-n",      type: "value" },
  { id: "input-nuit-s2",     type: "value" },
  { id: "input-fmd",         type: "value" },
  { id: "input-inflation",   type: "value" },
  { id: "input-perf",        type: "value" },
  // Mutuelle ALAN
  { id: "alan-forfait",        type: "value" },
  { id: "alan-solidaire",      type: "value" },
  { id: "alan-action-sociale", type: "value" },
  { id: "alan-aide-retraites", type: "value" },
  { id: "alan-employeur",      type: "value" },
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
  { titre: "🩺 Prévoyance MGAS", motsCles: ["prévoyance", "prevoyance", "mgas", "partenaire", "psc", "mutuelle", "202354", "202510"], cible: "panel-mgas-alan" },
  { titre: "🏥 Mutuelle ALAN", motsCles: ["alan", "mutuelle", "santé", "sante", "complémentaire", "complementaire", "cotisation", "option", "202483", "720376"], cible: "panel-mgas-alan" },
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
  { titre: "✏️ Primes manuelles (saisie libre)", motsCles: ["manuel", "manuelle", "libre", "prime", "exceptionnel", "autre", "divers"], cible: "panel-primes-manuelles" },
  { titre: "📋 Rappels (rétroactifs)", motsCles: ["rappel", "rétroactif", "retroactif", "arriéré", "arrie re", "régularisation", "regularisation", "antérieur", "anterieur", "trop-perçu", "correctif"], cible: "panel-rappels" },
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

function activerOngletMgasAlan(onglet) {
  document.querySelectorAll(".mgas-alan-section").forEach(s => s.classList.remove("active"));
  const section = document.getElementById(`mgas-alan-tab-${onglet}`);
  if (section) section.classList.add("active");
  const radio = document.querySelector(`input[name="tab-mgas-alan"][value="${onglet}"]`);
  if (radio) radio.checked = true;
}

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
    const imposable = !(row.querySelector(".pm-imp-non-cb")?.checked === true);
    if (imposable) manuelles_imposables     += montant;
    else           manuelles_non_imposables += montant;
  });

  // Lecture des rappels depuis le panneau (sommes algébriques : positif = payer, négatif = déduire)
  // Les rappels PSC/prévoyance sont imposables (CSG) mais doivent aussi être déduits du net social.
  const PSC_PREVOYANCE_RAPPEL_CODES = new Set(["202354", "202483", "202510"]);
  let rappels_imposables = 0, rappels_non_imposables = 0, rappels_psc_prevoyance = 0;
  document.querySelectorAll("#rappels-liste .rappel-row-ui").forEach(row => {
    const montant = parseFloat(row.querySelector(".rp-montant")?.value) || 0;
    const nonImp  = row.querySelector(".rp-non-imp")?.checked === true;
    const code    = row.querySelector(".rp-code")?.value || "";
    if (!nonImp) {
      rappels_imposables += montant;
      if (PSC_PREVOYANCE_RAPPEL_CODES.has(code)) rappels_psc_prevoyance += montant;
    } else {
      rappels_non_imposables += montant;
    }
  });

  return {
    grade: document.getElementById("input-grade")?.value || "",
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
      psc_options:      document.getElementById("psc-5")?.checked ? 5 : 0,
      prevoyance_mgas:  document.getElementById("psc-7")?.checked ? 7 : 0,
      manuelles_imposables,
      manuelles_non_imposables,
      rappels_imposables,
      rappels_non_imposables,
      rappels_psc_prevoyance,
    },
    alan: {
      forfait:        lireFloat("alan-forfait"),
      solidaire:      lireFloat("alan-solidaire"),
      action_sociale: lireFloat("alan-action-sociale"),
      aide_retraites: lireFloat("alan-aide-retraites"),
      employeur:      lireFloat("alan-employeur"),
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
    p.primes.manuelles_imposables + // primes manuelles imposables seulement (CSG/CRDS/RAFP s'appliquent)
    (p.primes.rappels_imposables || 0); // rappels imposables (algébrique : négatif = trop-perçu)

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
  // Les cotisations PSC/prévoyance ne sont pas des frais pro → pas d'abattement 1,75 %
  // Elles s'ajoutent directement à la base, comme l'avantage ALAN
  const pscSansAbat = p.primes.psc + p.primes.psc_options + p.primes.prevoyance_mgas + (p.primes.rappels_psc_prevoyance || 0);
  const totalPrimesSoumisesHorsPSC = totalPrimesSoumises - (p.primes.rappels_psc_prevoyance || 0);
  const baseCsgCrdsRaw = (baseSoumisePC + totalPrimesSoumisesHorsPSC + montantSFT - transfertPrimes - retenueIsq) * cst.assiette_csg_crds + pscSansAbat + (p.alan?.employeur || 0);
  const baseCsgCrds = Math.max(0, arrondir(baseCsgCrdsRaw));
  // Diagnostic CSG – F12 → Console pour comparer à la vraie fiche
  console.group("[CSG debug] Assiette CSG/CRDS");
  console.log("  baseSoumisePC       =", baseSoumisePC.toFixed(2));
  console.log("  baseResidenceReelle =", baseResidenceReelle.toFixed(2));
  console.log("  nuit                =", nuit.toFixed(2));
  console.log("  rist_fonctions      =", (p.primes.rist_fonctions - absRistFct).toFixed(2));
  console.log("  rist_exper_prof     =", (p.primes.rist_exper_prof - absRistExp).toFixed(2));
  console.log("  rist_lic_isq        =", (p.primes.rist_lic_isq - absRistIsq).toFixed(2));
  console.log("  rist_cplt_lic_isq   =", (p.primes.rist_cplt_lic_isq - absRistCplt).toFixed(2));
  console.log("  rist_maj_isq        =", (p.primes.rist_maj_isq - absRistMaj).toFixed(2));
  console.log("  ind_csg             =", (p.primes.ind_compensatrice_csg - absIndCsg).toFixed(2));
  console.log("  ott_pv_globale      =", p.evenements.ott_pv_globale.toFixed(2));
  console.log("  ott_pf              =", p.evenements.ott_pf.toFixed(2));
  console.log("  prime_performance   =", p.evenements.prime_performance.toFixed(2));
  console.log("  attractivite        =", p.primes.attractivite.toFixed(2));
  console.log("  fidelisation        =", p.primes.fidelisation.toFixed(2));
  console.log("  inflation           =", p.primes.inflation.toFixed(2));
  console.log("  manuelles_imp       =", p.primes.manuelles_imposables.toFixed(2));
  console.log("  rappels_imposables  =", (p.primes.rappels_imposables || 0).toFixed(2));
  console.log("  totalPrimesSoumises =", totalPrimesSoumises.toFixed(2));
  console.log("  psc                 =", p.primes.psc.toFixed(2));
  console.log("  psc_options         =", p.primes.psc_options.toFixed(2));
  console.log("  prevoyance_mgas     =", p.primes.prevoyance_mgas.toFixed(2));
  console.log("  montantSFT          =", montantSFT.toFixed(2));
  console.log("  - transfertPrimes   =", transfertPrimes.toFixed(2));
  console.log("  - retenueIsq        =", retenueIsq.toFixed(2));
  const _sumAvantAbat = baseSoumisePC + totalPrimesSoumisesHorsPSC + montantSFT - transfertPrimes - retenueIsq;
  console.log("  SOMME avant abat.   =", _sumAvantAbat.toFixed(5), "(PSC/prév. hors abattement)");
  console.log("  × 0.9825            =", (_sumAvantAbat * 0.9825).toFixed(5));
  console.log("  + PSC sans abat.    =", pscSansAbat.toFixed(2));
  console.log("  + alan employeur    =", (p.alan?.employeur || 0).toFixed(2));
  console.log("  baseCsgCrdsRaw      =", baseCsgCrdsRaw.toFixed(5));
  console.log("  baseCsgCrds (arr.)  =", baseCsgCrds.toFixed(2));
  console.log("  → CSG ND (2.4%)    =", arrondir(baseCsgCrds * 0.024));
  console.log("  → CSG D  (6.8%)    =", arrondir(baseCsgCrds * 0.068));
  console.log("  → CRDS   (0.5%)    =", arrondir(baseCsgCrds * 0.005));
  console.groupEnd();
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
      (p.primes.psc_options     > 0 ? p.primes.psc_options     : 0) +
      (p.primes.prevoyance_mgas > 0 ? p.primes.prevoyance_mgas : 0) +
      (p.evenements.prime_performance > 0 ? p.evenements.prime_performance : 0) +
      (p.evenements.ott_pv_globale > 0 ? p.evenements.ott_pv_globale : 0) +
      (p.evenements.ott_pf > 0 ? p.evenements.ott_pf : 0) +
      (p.evenements.ott_pv_opt32 > 0 ? p.evenements.ott_pv_opt32 : 0) +
      (p.primes.fidelisation > 0 ? p.primes.fidelisation : 0) +
      (p.primes.attractivite > 0 ? p.primes.attractivite : 0) +
      // Primes manuelles : les deux types apparaissent dans le brut à payer
      (p.primes.manuelles_imposables     > 0 ? p.primes.manuelles_imposables     : 0) +
      (p.primes.manuelles_non_imposables > 0 ? p.primes.manuelles_non_imposables : 0) +
      // Rappels positifs (payer) — les négatifs vont dans À Déduire
      (Math.max(0, p.primes.rappels_imposables     || 0)) +
      (Math.max(0, p.primes.rappels_non_imposables || 0)),
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
      retenueIsq +
      (p.alan?.forfait        || 0) +
      (p.alan?.solidaire      || 0) +
      (p.alan?.action_sociale || 0) +
      (p.alan?.aide_retraites || 0) +
      // Rappels négatifs (trop-perçu) → colonne À Déduire
      Math.abs(Math.min(0, p.primes.rappels_imposables     || 0)) +
      Math.abs(Math.min(0, p.primes.rappels_non_imposables || 0)),
  );

  const netAPayerAvantImpot = arrondir(totalAPayer - totalADeduire);
  // Primes manuelles non imposables : exclues du net social et du net imposable (même traitement que FMD)
  const netSocial = arrondir(netAPayerAvantImpot - p.primes.forfait_mobilites - p.primes.psc - p.primes.psc_options - p.primes.prevoyance_mgas - p.primes.manuelles_non_imposables - (p.primes.rappels_non_imposables || 0) - (p.primes.rappels_psc_prevoyance || 0) + retenueIsq);
  const netImposableFinal = Math.max(0, netAPayerAvantImpot + csgNonDeductible + crds + (p.alan?.action_sociale || 0) + (p.alan?.aide_retraites || 0) + (p.alan?.employeur || 0) - p.primes.forfait_mobilites - p.primes.manuelles_non_imposables - (p.primes.rappels_non_imposables || 0));
  const impotSource = arrondir(netImposableFinal * p.taux_pas);
  const netFinal = Math.max(0, arrondir(netAPayerAvantImpot - impotSource));
  const coutTotalEmployeur = arrondir(totalAPayer + totalPatronal + (p.alan?.employeur || 0) - transfertPrimes);

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
    pscOptions:     p.primes.psc_options    || 0,
    prevoyanceMgas: p.primes.prevoyance_mgas || 0,
    alanForfait:       p.alan?.forfait        || 0,
    alanSolidaire:     p.alan?.solidaire      || 0,
    alanActionSociale: p.alan?.action_sociale || 0,
    alanAideRetraites: p.alan?.aide_retraites || 0,
    alanEmployeur:     p.alan?.employeur      || 0,
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
  201958: { cible: "panel-rist-fonctions", titre: "RIST Part Fonctions" },
  201959: { cible: "panel-rist-experience", titre: "RIST Part Expérience" },
  201960: { cible: "panel-rist-isq-licence", titre: "RIST Part LIC-ISQ" },
  201961: { cible: "panel-rist-isq-complement", titre: "RIST CPLT LIC-ISQ" },
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
  202354: { cible: "panel-mgas-alan", titre: "Prévoyance / ALAN", onglet: "prevoyance" },
  202483: { cible: "panel-mgas-alan", titre: "Prévoyance / ALAN", onglet: "alan" },
  202510: { cible: "panel-mgas-alan", titre: "Prévoyance / ALAN", onglet: "prevoyance" },
  720376: { cible: "panel-mgas-alan", titre: "Prévoyance / ALAN", onglet: "alan" },
  720377: { cible: "panel-mgas-alan", titre: "Prévoyance / ALAN", onglet: "alan" },
  720378: { cible: "panel-mgas-alan", titre: "Prévoyance / ALAN", onglet: "alan" },
  720379: { cible: "panel-mgas-alan", titre: "Prévoyance / ALAN", onglet: "alan" },
  720380: { cible: "panel-mgas-alan", titre: "Prévoyance / ALAN", onglet: "alan" },
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
  // PERF — DocumentFragment : 12 appends hors DOM → 1 seul reflow
  const tbodyFrag = document.createDocumentFragment();
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
      tr.onclick = () => { if (route.onglet) activerOngletMgasAlan(route.onglet); ouvrirModal(route.cible, route.titre); };
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (route.onglet) activerOngletMgasAlan(route.onglet); ouvrirModal(route.cible, route.titre); }
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
    tbodyFrag.appendChild(tr);
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
      tbodyFrag.appendChild(tr);
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
      tbodyFrag.appendChild(tr);
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
  ajouterLigneRistAvecBadge("201958", "RIST PART FONCTIONS",      "rist_fonctions",       p.primes.rist_fonctions,        m.absRistFct,  "panel-rist-fonctions",      "RIST Part Fonctions",    pB?.primes.rist_fonctions    ?? 0);
  ajouterLigneRistAvecBadge("201959", "RIST PART EXPER. PROF.",   "rist_experience",      p.primes.rist_exper_prof,       m.absRistExp,  "panel-rist-experience",     "RIST Part Expérience",   pB?.primes.rist_exper_prof   ?? 0);
  ajouterLigneRistAvecBadge("201960", "RIST PART LIC-ISQ (ICNA)", "rist_isq_licence",     p.primes.rist_lic_isq,          m.absRistIsq,  "panel-rist-isq-licence",    "RIST Part LIC-ISQ",      pB?.primes.rist_lic_isq      ?? 0);
  ajouterLigneRistAvecBadge("201961", "RIST CPLT PART LIC-ISQ",   "rist_isq_complement",  p.primes.rist_cplt_lic_isq,     m.absRistCplt, "panel-rist-isq-complement", "RIST CPLT LIC-ISQ", pB?.primes.rist_cplt_lic_isq ?? 0);
  ajouterLigneRistAvecBadge("201962", "MAJORATION CPLT ISQ",      "rist_isq_majoration",  p.primes.rist_maj_isq,          m.absRistMaj,  "panel-rist-isq-majoration", "Majoration Complément ISQ",   pB?.primes.rist_maj_isq      ?? 0);
  ajouterLigneRistAvecBadge("202206", "IND. COMPENSATRICE CSG",   "ind_compensatrice_csg",p.primes.ind_compensatrice_csg, m.absIndCsg,   "panel-csg",                 "Indemnité Compensatrice CSG", pB?.primes.ind_compensatrice_csg ?? 0);

  // ── PSC ───────────────────────────────────────────────────────────────────────
  const psc = paire(m.psc, mB?.psc);
  if (psc.affiche > 0 || psc.isGhost)
    ajouterLigne("202354", "PARTICIPATION A LA PSC", psc.affiche, null, null, ["psc-15"], null, null,
      { delta: psc.delta, deltaCol: 2, isGhost: psc.isGhost });

  const pscOptions = paire(m.pscOptions, mB?.pscOptions);
  if (pscOptions.affiche > 0 || pscOptions.isGhost)
    ajouterLigne("202483", "PARTICIPATION PSC OPTIONS", pscOptions.affiche, null, null, ["psc-5"], null, null,
      { delta: pscOptions.delta, deltaCol: 2, isGhost: pscOptions.isGhost });

  const prevoyance = paire(m.prevoyanceMgas, mB?.prevoyanceMgas);
  if (prevoyance.affiche > 0 || prevoyance.isGhost)
    ajouterLigne("202510", "PARTICIPATION PREVOYANCE", prevoyance.affiche, null, null, ["psc-7"], null, null,
      { delta: prevoyance.delta, deltaCol: 2, isGhost: prevoyance.isGhost });

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

    // ── ALAN (720376–720380) ───────────────────────────────────────────────────
    const alanForfait  = paire(m.alanForfait,       mB?.alanForfait);
    const alanSol      = paire(m.alanSolidaire,     mB?.alanSolidaire);
    const alanAction   = paire(m.alanActionSociale, mB?.alanActionSociale);
    const alanAide     = paire(m.alanAideRetraites, mB?.alanAideRetraites);
    const alanEmp      = paire(m.alanEmployeur,     mB?.alanEmployeur);
    const alanInputs   = ["alan-forfait","alan-solidaire","alan-action-sociale","alan-aide-retraites","alan-employeur"];
    if (alanForfait.affiche > 0 || alanForfait.isGhost)
      ajouterLigne("720376", "ALAN PART FORFAIT.", null, alanForfait.affiche || null, null, alanInputs, null, null,
        { delta: alanForfait.delta, deltaCol: 3, isGhost: alanForfait.isGhost });
    if (alanSol.affiche > 0 || alanSol.isGhost)
      ajouterLigne("720377", "ALAN PART SOLIDAIRE", null, alanSol.affiche || null, null, alanInputs, null, null,
        { delta: alanSol.delta, deltaCol: 3, isGhost: alanSol.isGhost });
    if (alanAction.affiche > 0 || alanAction.isGhost)
      ajouterLigne("720378", "ALAN ACTION SOCIALE", null, alanAction.affiche || null, null, alanInputs, null, null,
        { delta: alanAction.delta, deltaCol: 3, isGhost: alanAction.isGhost });
    if (alanAide.affiche > 0 || alanAide.isGhost)
      ajouterLigne("720379", "ALAN AIDE RETRAITES", null, alanAide.affiche || null, null, alanInputs, null, null,
        { delta: alanAide.delta, deltaCol: 3, isGhost: alanAide.isGhost });
    if (alanEmp.affiche > 0 || alanEmp.isGhost)
      ajouterLigne("720380", "ALAN PART EMPLOYEUR", null, null, alanEmp.affiche || null, alanInputs, null, null,
        { delta: alanEmp.delta, deltaCol: 4, isGhost: alanEmp.isGhost });

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
    tbodyFrag.appendChild(tr);
  } else {
    ajouterLigne("", `(TAUX PERSONNALISE ${formaterMontant(p.taux_pas * 100)}%)`, null, null, null, null, null, "row-taux-impot");
  }

  // ── Ligne d'ajout d'éléments variables ──────────────────────────────────────
  const trAjout = document.createElement("tr");
  trAjout.className = "add-row";
  trAjout.innerHTML = `<td colspan="5"> + AJOUTER OU MODIFIER UN ÉLÉMENT VARIABLE (Options protocolaires, Absences, Indemnité de Nuit...) </td>`;
  trAjout.onclick = () => ouvrirModal("panel-menu-ajout", "Que voulez-vous ajouter ?");
  tbodyFrag.appendChild(trAjout);

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
  tbodyFrag.appendChild(trRessort);

  // PERF — flush unique : toutes les lignes injectées en 1 seul reflow
  tbody.appendChild(tbodyFrag);

  // ── Rappels (injectés après le flush pour accéder au DOM) ────────────────────
  (function injecterRappelsDansFiche() {
    // Réinitialise les marqueurs orphelins du rendu précédent
    document.querySelectorAll("#rappels-liste .rappel-row-ui.rp-orphan").forEach(div => {
      div.classList.remove("rp-orphan");
      div.querySelector(".rp-orphan-msg")?.remove();
    });

    const tousRappels = _getRappels();
    if (!tousRappels.length) return;

    // Regroupe par codeParent pour insérer tous les rappels d'un même code ensemble
    const parCode = {};
    tousRappels.forEach(r => {
      const key = r.codeParent || "__autre__";
      (parCode[key] = parCode[key] || []).push(r);
    });

    // Cherche la dernière ligne du tbody ayant un id précis (gère les doublons d'id comme les RIST avec absences)
    function derniereLigneParId(id) {
      const rows = Array.from(tbody.children);
      const matches = rows.filter(tr => tr.id === id);
      return matches[matches.length - 1] || null;
    }

    Object.entries(parCode).forEach(([cle, rappels]) => {
      // Noeud d'ancrage : la dernière ligne du code parent, ou avant .add-row pour "autre"
      let ancre = null;
      if (cle !== "__autre__") {
        ancre = derniereLigneParId(`row-${cle}`);
      }

      // Si la ligne de base est absente, marquer les rappels orphelins dans le panel
      if (!ancre && cle !== "__autre__") {
        rappels.forEach(r => {
          const panelRow = document.querySelector(`#rappels-liste .rappel-row-ui[data-rappel-id="${r.id}"]`);
          if (!panelRow) return;
          panelRow.classList.add("rp-orphan");
          if (!panelRow.querySelector(".rp-orphan-msg")) {
            const msg = document.createElement("p");
            msg.className = "rp-orphan-msg";
            const ligneInfo = LIGNES_RAPPELLABLES.find(l => l.code === r.codeParent);
            const libelle   = ligneInfo?.libelle || r.libelleParent || r.codeParent;
            msg.textContent = `⚠️ La ligne "${libelle}" n'est pas dans votre fiche. Activez-la d'abord.`;
            panelRow.appendChild(msg);
          }
        });
        return; // ne rien insérer dans la fiche pour ce groupe
      }

      // Crée les TR de rappel et les insère dans le bon ordre
      rappels.forEach(r => {
        if (!r.montant) return;
        const montantAbs = Math.abs(r.montant);
        const estDeduire = r.montant < 0;

        const typeLabel  = r.type === "courante" ? "AN. COUR." : "AN. ANT.";
        let libelleFiche;
        if (r.codeParent === "" && r.libelleParent) {
          libelleFiche = r.libelleParent.toUpperCase();
        } else {
          libelleFiche = r.periode
            ? `RAPPEL ${typeLabel} - ${r.periode.toUpperCase()}`
            : `RAPPEL ${typeLabel}`;
        }

        const tr = document.createElement("tr");
        tr.id = `row-rappel-${r.id}`;
        tr.className = "clickable-row rappel-row";
        tr.title = "Cliquez pour modifier les rappels";
        tr.setAttribute("role", "button");
        tr.setAttribute("tabindex", "0");
        tr.setAttribute("aria-label", `Modifier : ${libelleFiche}`);

        const tooltip = !r.imposable ? "Non imposable (exclu du net imposable et du PAS)" : null;

        const tdCode = document.createElement("td");
        tdCode.className = "col-code";
        tdCode.textContent = r.codeParent || "";

        const tdLib = document.createElement("td");
        tdLib.className = "col-libelle label rappel-libelle";
        const spanLib = document.createElement("span");
        spanLib.textContent = libelleFiche;
        if (tooltip) spanLib.title = tooltip;
        const croix = document.createElement("span");
        croix.className = "delete-btn";
        croix.title = "Retirer ce rappel";
        croix.textContent = "✖";
        croix.addEventListener("click", e => { e.stopPropagation(); window.supprimerRappelDeFiche(r.id); });
        tdLib.append(spanLib, croix);

        const tdPayer   = document.createElement("td");
        tdPayer.className = "col-amount";
        if (!estDeduire) tdPayer.textContent = formaterMontant(montantAbs);

        const tdDeduire = document.createElement("td");
        tdDeduire.className = "col-amount";
        if (estDeduire) tdDeduire.textContent = formaterMontant(montantAbs);

        const tdInfo = document.createElement("td");
        tdInfo.className = "col-amount";

        tr.append(tdCode, tdLib, tdPayer, tdDeduire, tdInfo);

        tr.onclick = () => ouvrirModal("panel-rappels", "📋 Rappels");
        tr.addEventListener("keydown", e => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ouvrirModal("panel-rappels", "📋 Rappels"); }
        });

        if (ancre) {
          ancre.insertAdjacentElement("afterend", tr);
          ancre = tr; // le prochain rappel du même code suit ce tr
        } else {
          // Fallback : avant la ligne "+ AJOUTER"
          const addRow = tbody.querySelector(".add-row");
          if (addRow) tbody.insertBefore(tr, addRow);
          else tbody.appendChild(tr);
          ancre = tr;
        }
      });
    });
  })();

  // ── Totaux dans le pied de page ───────────────────────────────────────────────
  const pending = configurationIncomplete();
  const showEl  = (id, show) => { const el = document.getElementById(id); if (el) el.style.display = show ? "" : "none"; };
  showEl("footer-config-pending", pending);
  showEl("footer-real-1", !pending);
  showEl("footer-real-2", !pending);
  showEl("footer-real-3", !pending);

  if (!pending) {
    document.getElementById("ui-total-a-payer").textContent      = formaterMontant(m.totalAPayer);
    document.getElementById("ui-total-a-deduire").textContent    = formaterMontant(arrondir(m.totalADeduire + m.impotSource));
    document.getElementById("ui-cout-employeur").textContent     = formaterMontant(m.coutTotalEmployeur);
    document.getElementById("ui-charges-patronales").textContent = formaterMontant(arrondir(m.totalPatronal + m.alanEmployeur));
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
  // Stocker pour l'auto-calc des rappels (sans redéclencher calculerPaie)
  _dernierProfil    = profilA;
  _derniersMontants = mA;

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
  // Rafraîchir les montants auto-calculés des rappels (sans boucle infinie)
  _rafraichirAutoCalcRappels();

  // Vue mobile — liste condensée (Option D)
  // dessinerFicheMobile est appelée dans tous les cas (is-mobile vérifié en CSS)
  // pour que ui-net-a-payer soit à jour pour la barre sticky
  if (document.body.classList.contains("is-mobile")) {
    dessinerFicheMobile(profilA, mA, profilB, mB);
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
    // Restauration des primes manuelles et rappels (clés localStorage séparées — listes dynamiques)
    _restaurerPrimesManuelles();
    _restaurerRappels();
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

    // Onglets MGAS / ALAN — switching et initialisation
    document.querySelectorAll("input[name='tab-mgas-alan']").forEach(radio => {
      radio.addEventListener("change", () => activerOngletMgasAlan(radio.value));
    });
    activerOngletMgasAlan("prevoyance");

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

  const _SVG = {
    annuel:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="22" height="22"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><circle cx="8" cy="15" r="1" fill="currentColor"/><circle cx="12" cy="15" r="1" fill="currentColor"/><circle cx="16" cy="15" r="1" fill="currentColor"/></svg>',
    comparer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="22" height="22"><rect x="2" y="6" width="8" height="12" rx="1"/><rect x="14" y="6" width="8" height="12" rx="1"/><line x1="12" y1="4" x2="12" y2="20"/><polyline points="9.5 9 12 6 14.5 9"/><polyline points="9.5 15 12 18 14.5 15"/></svg>',
    ajouter:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="22" height="22"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>',
    reset:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="22" height="22"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><polyline points="3 3 3 8 8 8"/></svg>',
  };
  const btns = [
    { icon: _SVG.annuel,   label: "Annuel",   action: () => _mbbAction("annuel") },
    { icon: _SVG.comparer, label: "Comparer", action: () => _mbbAction("comparer") },
    { icon: _SVG.ajouter,  label: "Ajouter",  action: () => _mbbAction("ajouter") },
    { icon: _SVG.reset,    label: "Reset",    action: () => _mobileConfirmReset() },
  ];

  btns.forEach(({ icon, label, action }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mobile-bottom-bar-btn";
    btn.setAttribute("aria-label", label);

    const spanIcon  = document.createElement("span");
    spanIcon.className = "mbb-icon";
    if (typeof icon === "string" && icon.trim().startsWith("<svg")) spanIcon.innerHTML = icon;
    else spanIcon.textContent = icon;

    const spanLabel = document.createElement("span");
    spanLabel.className = "mbb-label";
    spanLabel.textContent = label;

    btn.append(spanIcon, spanLabel);
    btn.addEventListener("click", action);
    bar.appendChild(btn);
  });

  document.body.appendChild(bar);
}

/**
 * Action de la bottom-bar — bloque si configuration incomplète
 * sauf pour Reset qui est toujours disponible.
 */
function _mbbAction(action) {
  if (configurationIncomplete() && action !== "reset") {
    // Afficher un message d'invite plutôt que bloquer silencieusement
    const modal = document.getElementById("magic-modal");
    if (!modal) return;
    document.getElementById("modal-title").textContent = "⚙ Configuration requise";
    document.querySelectorAll(".setting-panel").forEach(p => p.classList.remove("active"));
    const tmp = document.getElementById("_mobile-config-required") || (() => {
      const d = document.createElement("div");
      d.id = "_mobile-config-required";
      d.className = "setting-panel";
      d.innerHTML = `
        <p class="panel-hint" style="margin-bottom:16px;">
          Complétez d'abord votre profil de base avant d'accéder à cette fonctionnalité :<br><br>
          <strong>• Grade &amp; Échelon</strong> → tap sur "Traitement brut"<br>
          <strong>• Zone de résidence</strong> → tap sur "Indemnité de résidence"<br>
          <strong>• RIST</strong> → tap sur chaque ligne RIST dans la liste
        </p>
        <button type="button" class="validate-btn"
          onclick="document.getElementById('magic-modal').close()">Fermer</button>
      `;
      document.querySelector(".modal-body").appendChild(d);
      return d;
    })();
    tmp.classList.add("active");
    modal.dataset.panelOuvert = "_mobile-config-required";
    if (!modal.open) modal.showModal();
    return;
  }
  if (action === "annuel")   window.ouvrirProjectionAnnuelle?.();
  if (action === "comparer") _ouvrirComparateurMobile();
  if (action === "ajouter")  ouvrirModal("panel-menu-ajout", "Que voulez-vous ajouter ?");
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

/** Confirmation reset depuis la bottom-bar mobile */
function _mobileConfirmReset() {
  const modal = document.getElementById("magic-modal");
  if (!modal) return;
  document.getElementById("modal-title").textContent = "↺ Réinitialiser";
  document.querySelectorAll(".setting-panel").forEach(p => p.classList.remove("active"));
  const tmp = document.getElementById("_mobile-reset-panel") || (() => {
    const d = document.createElement("div");
    d.id = "_mobile-reset-panel";
    d.className = "setting-panel";
    d.innerHTML = `
      <p class="panel-hint" style="margin-bottom:16px;">
        ⚠️ Cette action va <strong>effacer toutes vos données</strong> sauvegardées
        (grade, échelon, RIST, PAS, primes manuelles, projection…) et recharger la page.
      </p>
      <button type="button" class="validate-btn" style="background:#c0392b;"
        onclick="window.effacerProfil()">✕ Tout réinitialiser</button>
      <button type="button" class="validate-btn" style="margin-top:8px;background:#555;"
        onclick="document.getElementById('magic-modal').close()">Annuler</button>
    `;
    document.querySelector(".modal-body").appendChild(d);
    return d;
  })();
  tmp.classList.add("active");
  modal.dataset.panelOuvert = "_mobile-reset-panel";
  if (!modal.open) modal.showModal();
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

    // Enfants à charge
    const lblEnfants = document.createElement("label");
    lblEnfants.textContent = "Enfants à charge";
    lblEnfants.style.marginTop = "16px";
    const selEnfants = document.createElement("select");
    selEnfants.id = "panel-traitement-enfants-select";
    selEnfants.style.fontSize = "16px";
    [["", "— Sélectionner —"],["0","0"],["1","1"],["2","2"],["3","3"],["4","4"],["5","5"]].forEach(([v, t]) => {
      const o = new Option(t, v); if (!v) o.disabled = true; selEnfants.appendChild(o);
    });

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
        marquerConfigure("grade");
        // mettreAJourEchelons() synchrone — les options input-echelon sont à jour immédiatement
        mettreAJourEchelons();
      }

      // Appliquer échelon synchronement (après mettreAJourEchelons)
      const srcEch = document.getElementById("input-echelon");
      if (srcEch && selEch.value) {
        srcEch.value = selEch.value;
        marquerConfigure("echelon");
      }

      // Appliquer enfants à charge — toujours marqué (défaut 0 si rien sélectionné)
      const srcEnfants = document.getElementById("input-enfants");
      if (srcEnfants) {
        srcEnfants.value = selEnfants.value !== "" ? selEnfants.value : "0";
        srcEnfants.dispatchEvent(new Event("change", { bubbles: true }));
        marquerConfigure("enfants");
      }

      // Appliquer NBI — FIX 2A : toujours marquée, défaut = Non si aucun radio coché
      const cb = document.getElementById("input-nbi-checkbox");
      const choixNbi = document.querySelector('input[name="trait-nbi"]:checked')?.value ?? "non";
      if (cb) {
        cb.checked = choixNbi === "oui";
        cb.dispatchEvent(new Event("input", { bubbles: true }));
      }
      marquerConfigure("nbi"); // FIX 2A — marqué systématiquement, pas conditionnel

      // Un seul calculerPaie() synchrone avec toutes les valeurs appliquées
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

    panel.append(lblGrade, selGrade, lblEch, selEch, lblEnfants, selEnfants, lblNbi, nbiWrap, btnVal);
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
    // Sync enfants
    const srcEnfantsSrc = document.getElementById("input-enfants");
    const selEnfantsSync = document.getElementById("panel-traitement-enfants-select");
    if (srcEnfantsSrc && selEnfantsSync) selEnfantsSync.value = srcEnfantsSrc.value;
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
  const btnComparer = bar.querySelectorAll(".mobile-bottom-bar-btn")[1];
  if (!btnComparer) return;
  const actif = modeComparaison;
  btnComparer.classList.toggle("active", actif);
  const icon  = btnComparer.querySelector(".mbb-icon");
  const label = btnComparer.querySelector(".mbb-label");
  if (actif) {
    if (icon)  icon.textContent  = "⚖";
    if (label) label.textContent = "Scén. B ✓";
    // Clic quand actif : réouvre la modale pour reconfigurer
    btnComparer.onclick = () => _ouvrirComparateurMobile();
  } else {
    if (icon)  icon.textContent  = "⚖";
    if (label) label.textContent = "Comparer";
    btnComparer.onclick = () => _ouvrirComparateurMobile();
  }
}

/**
 * Plan B — Comparateur mobile.
 *
 * Au lieu de cloner le panneau (ce qui crée des IDs dupliqués),
 * on DÉPLACE le vrai #panneau-comparaison dans la modale.
 * getProfilComparaisonDepuisPanneau() lit toujours les vrais IDs → ça marche.
 * À la fermeture, on remet le panneau dans document.body.
 *
 * Le recalcul est live : chaque changement → calculerPaie() → delta Δ NET mis à jour
 * dans #cmp-mobile-delta sans fermer la modale.
 */
function _ouvrirComparateurMobile() {
  if (!document.body.classList.contains("is-mobile")) {
    window.activerComparaison?.();
    return;
  }

  const modalBody = document.querySelector(".modal-body");
  const panneau   = document.getElementById("panneau-comparaison");
  if (!modalBody || !panneau) return;

  // Activer le mode comparaison (initialise les champs B)
  if (!modeComparaison) {
    window.activerComparaison?.();
  }

  // ── Créer le panel-cmp-mobile wrapper (une seule fois) ──────────────────
  let panel = document.getElementById("panel-cmp-mobile");
  if (!panel) {
    panel = document.createElement("div");
    panel.id        = "panel-cmp-mobile";
    panel.className = "setting-panel";

    // ── Barre delta Δ NET — mise à jour live ────────────────────────────
    const deltaBar = document.createElement("div");
    deltaBar.id        = "cmp-mobile-delta";
    deltaBar.className = "cmp-mobile-delta-bar";
    deltaBar.textContent = "Modifiez les paramètres — le Δ NET s'affiche ici.";
    panel.appendChild(deltaBar);

    // ── Le vrai corps du comparateur sera déplacé ici ──────────────────
    // (placeholder, panneau.cmp-body sera appendé dynamiquement)

    // ── Bouton principal : Fermer et voir les deltas ─────────────────────
    const btnFermer = document.createElement("button");
    btnFermer.type      = "button";
    btnFermer.className = "validate-btn";
    btnFermer.id        = "cmp-mobile-btn-fermer";
    btnFermer.textContent = "✓ Fermer — voir les deltas";
    btnFermer.addEventListener("click", () => {
      document.getElementById("magic-modal").close();
    });
    panel.appendChild(btnFermer);

    // ── Bouton secondaire discret : Quitter le mode ──────────────────────
    const btnQuitter = document.createElement("button");
    btnQuitter.type      = "button";
    btnQuitter.className = "cmp-mobile-btn-quitter";
    btnQuitter.id        = "cmp-mobile-btn-quitter";
    btnQuitter.textContent = "Quitter la comparaison";
    btnQuitter.addEventListener("click", () => {
      window.desactiverComparaison?.();
      document.getElementById("magic-modal").close();
    });
    panel.appendChild(btnQuitter);

    modalBody.appendChild(panel);
  }

  // ── Déplacer le VRAI panneau (cmp-body) dans panel-cmp-mobile ──────────
  // On insère entre deltaBar et btnFermer
  const cmpBody   = panneau.querySelector(".cmp-body");
  const btnFermer = document.getElementById("cmp-mobile-btn-fermer");
  if (cmpBody && btnFermer) {
    panel.insertBefore(cmpBody, btnFermer);
    // Mémoriser où remettre le panneau à la fermeture
    panel.dataset.cmpBodyMoved = "1";
  }

  // ── Recalcul live à chaque changement ───────────────────────────────────
  if (!panel._liveListenerAttached) {
    panel.addEventListener("change", _majDeltaMobile);
    panel.addEventListener("input",  _majDeltaMobile);
    panel._liveListenerAttached = true;
  }

  // ── Restaurer cmp-body dans panneau-comparaison à la fermeture ──────────
  const modal = document.getElementById("magic-modal");
  const _onClose = () => {
    const moved = panel.querySelector(".cmp-body");
    if (moved) panneau.appendChild(moved);
    modal.removeEventListener("close", _onClose);
  };
  modal.addEventListener("close", _onClose);

  _majDeltaMobile(); // afficher le delta courant à l'ouverture
  ouvrirModal("panel-cmp-mobile", "⚖ Scénario B");
}

/**
 * Met à jour le badge Δ NET dans la modale comparateur mobile.
 * Appelée à chaque changement de champ ET à l'ouverture.
 */
function _majDeltaMobile() {
  if (!modeComparaison) return;
  const bar = document.getElementById("cmp-mobile-delta");
  if (!bar) return;

  // Recalculer le profil B depuis les vrais champs (pas de clone !)
  try {
    const pA = getProfilDepuisInterface();
    const pB = getProfilComparaisonDepuisPanneau();
    const mA = calculerMontants(pA);
    const mB = calculerMontants(pB);
    const delta = mB.netFinal - mA.netFinal; // B - A : positif = B meilleur
    const fmt = v => v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    if (Math.abs(delta) < 0.01) {
      bar.textContent  = "Δ NET : aucune différence";
      bar.className    = "cmp-mobile-delta-bar cmp-delta-neutral";
    } else {
      const signe = delta > 0 ? "+" : "";
      bar.innerHTML = `Scén. A <strong>${fmt(mA.netFinal)} €</strong> &nbsp;·&nbsp; Scén. B <strong>${fmt(mB.netFinal)} €</strong><br>
        <span class="cmp-delta-pill ${delta > 0 ? "cmp-delta-pos" : "cmp-delta-neg"}">${signe}${fmt(delta)} €</span>`;
      bar.className = "cmp-mobile-delta-bar";
    }

    // PERF — recalcul complet différé (debounce 250ms)
    // _majDeltaMobile a déjà calculé mA+mB — on évite de les recalculer immédiatement
    // Le recalcul complet met à jour les deltas dans la liste mobile
    clearTimeout(_majDeltaMobile._timer);
    _majDeltaMobile._timer = setTimeout(calculerPaie, 250);
  } catch (e) {
    bar.textContent = "Δ NET : —";
  }
}

// Patch activerComparaison : déplacé après la définition de la vraie fonction
// (voir fin de section 13 Comparateur)

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

  // Toggle : checkbox unique "Non imposable"
  // Non cochée = imposable (défaut), cochée = non imposable
  const toggle = document.createElement("div");
  toggle.className = "pm-toggle-cb";

  const cbNonImpId = `pm-nonimposable-${id}`;
  const cbNonImp = document.createElement("input");
  cbNonImp.type      = "checkbox";
  cbNonImp.id        = cbNonImpId;
  cbNonImp.className = "pm-imp-non-cb";
  cbNonImp.checked   = !imposable; // cochée = non imposable
  cbNonImp.addEventListener("change", () => { _sauvegarderPrimesManuelles(); calculerPaie(); });

  const lblCb = document.createElement("label");
  lblCb.htmlFor     = cbNonImpId;
  lblCb.textContent = "Non imposable";
  lblCb.className   = "pm-nonimposable-label";

  toggle.append(cbNonImp, lblCb);

  // Bouton suppression
  const btnSuppr  = document.createElement("button");
  btnSuppr.type   = "button";
  btnSuppr.className   = "pm-suppr";
  btnSuppr.title  = "Supprimer cette prime";
  btnSuppr.textContent = "✖";
  btnSuppr.addEventListener("click", () => { row.remove(); _sauvegarderPrimesManuelles(); calculerPaie(); });

  // Wrapper dédié pour la ligne 2 (montant + toggle + suppr)
  // → flex container propre, sans les complications de flex-wrap
  const row2 = document.createElement("div");
  row2.className = "pm-row2";
  row2.append(inputVal, toggle, btnSuppr);
  row.append(inputLib, row2);
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
    const imposable = !(row.querySelector(".pm-imp-non-cb")?.checked === true);
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
// 11c. RAPPELS — Saisie structurée par ligne parente
// =============================================================================

/** Lignes de la fiche qui peuvent faire l'objet d'un rappel rétroactif. */
const LIGNES_RAPPELLABLES = [
  // ── Éléments fixes ─────────────────────────────────────────────────────────
  { code: "101000", libelle: "TRAITEMENT BRUT",                imposable: true  },
  { code: "101070", libelle: "TRAITEMENT BRUT N.B.I.",         imposable: true  },
  { code: "102000", libelle: "INDEMNITE DE RESIDENCE",         imposable: true  },
  { code: "200200", libelle: "SUPPL. FAMILIAL DE TRAITEMENT",  imposable: true  },
  // ── RIST / ISQ ──────────────────────────────────────────────────────────────
  { code: "201958", libelle: "RIST PART FONCTIONS",            imposable: true  },
  { code: "201959", libelle: "RIST PART EXPERIENCE PROF.",     imposable: true  },
  { code: "201960", libelle: "RIST ISQ-LICENCE",               imposable: true  },
  { code: "201961", libelle: "RIST ISQ-COMPLEMENT LIC.",       imposable: true  },
  { code: "201962", libelle: "RIST ISQ-MAJORATION",            imposable: true  },
  { code: "202206", libelle: "IND. COMPENSATRICE CSG",         imposable: true  },
  // ── Éléments variables ───────────────────────────────────────────────────────
  { code: "201000", libelle: "INDEM. POUVOIR D'ACHAT",         imposable: true  },
  { code: "202485", libelle: "PRIME PARTAGE PERFORMANCE",      imposable: true  },
  { code: "202559", libelle: "OTT PART FIXE",                  imposable: true  },
  { code: "202558", libelle: "OTT PART VARIABLE GLOBAL",       imposable: true  },
  { code: "202560", libelle: "OTT PART VARIABLE OPT 3",        imposable: true  },
  { code: "203001", libelle: "PRIME DE FIDELISATION",          imposable: true  },
  // ── Mutuelle / Prévoyance ──────────────────────────────────────────────────
  { code: "202354", libelle: "PARTICIPATION PSC",              imposable: false },
  { code: "202483", libelle: "PSC OPTIONS",                    imposable: false },
  { code: "202510", libelle: "PRÉVOYANCE MGAS",                imposable: false },
  // ── ALAN ──────────────────────────────────────────────────────────────────
  { code: "720376", libelle: "ALAN PART FORFAIT",              imposable: false },
  { code: "720377", libelle: "ALAN PART SOLIDAIRE",            imposable: false },
  { code: "720378", libelle: "ALAN ACTION SOCIALE",            imposable: false },
  { code: "720379", libelle: "ALAN AIDE RETRAITES",            imposable: false },
  { code: "720380", libelle: "ALAN PART EMPLOYEUR",            imposable: false },
  // ── Autre ─────────────────────────────────────────────────────────────────
  { code: "",       libelle: "AUTRE (saisie libre)",           imposable: true  },
];

/**
 * Accesseurs du montant mensuel de référence par code de ligne.
 * Permet le calcul automatique : (montant_actuel - montant_précédent) × nb_mois.
 * @type {Object.<string, function(ProfilAgent, MontantsCalcules): number>}
 */
const MONTANT_MENSUEL_MAP = {
  "101000": (p, m) => m.traitementBrut,
  "101070": (p, m) => m.montantNbi,
  "102000": (p, m) => m.indemniteResidence,
  "200200": (p, m) => m.montantSFT,
  "201000": (p, m) => p.primes.inflation,
  "201958": (p, m) => p.primes.rist_fonctions,
  "201959": (p, m) => p.primes.rist_exper_prof,
  "201960": (p, m) => p.primes.rist_lic_isq,
  "201961": (p, m) => p.primes.rist_cplt_lic_isq,
  "201962": (p, m) => p.primes.rist_maj_isq,
  "202206": (p, m) => p.primes.ind_compensatrice_csg,
  "202354": (p, m) => m.psc,
  "202483": (p, m) => m.pscOptions,
  "202510": (p, m) => m.prevoyanceMgas,
  "202558": (p, m) => p.evenements.ott_pv_globale,
  "202559": (p, m) => p.evenements.ott_pf,
  "202560": (p, m) => p.evenements.ott_pv_opt32,
  "203001": (p, m) => p.primes.fidelisation,
  "720376": (p, m) => p.alan?.forfait        || 0,
  "720377": (p, m) => p.alan?.solidaire      || 0,
  "720378": (p, m) => p.alan?.action_sociale || 0,
  "720379": (p, m) => p.alan?.aide_retraites || 0,
  "720380": (p, m) => p.alan?.employeur      || 0,
};

/**
 * Lit les lignes de rappel depuis le DOM et retourne un tableau d'objets.
 * @returns {{id, codeParent, libelleParent, periode, type, montant, imposable, autoCalc, nbMois, montantMensuelPrecedent}[]}
 */
function _getRappels() {
  const result = [];
  document.querySelectorAll("#rappels-liste .rappel-row-ui").forEach(row => {
    const id       = row.dataset.rappelId || "";
    const code     = row.querySelector(".rp-code")?.value || "";
    const periode  = row.querySelector(".rp-periode")?.value?.trim() || "";
    const type     = row.querySelector(".rp-type")?.value || "courante";
    const montant  = parseFloat(row.querySelector(".rp-montant")?.value) || 0;
    const nonImp   = row.querySelector(".rp-non-imp")?.checked === true;
    const autoCalc = row.querySelector(".rp-auto-cb")?.checked === true;
    const nbMois   = parseFloat(row.querySelector(".rp-nb-mois")?.value) || 0;
    const montantMensuelPrecedent = parseFloat(row.querySelector(".rp-montant-prec")?.value) || 0;
    const libelleCustom = row.querySelector(".rp-libelle-custom")?.value?.trim() || "";
    const ligneInfo     = LIGNES_RAPPELLABLES.find(l => l.code === code);
    const libelleParent = code === "" ? libelleCustom : (ligneInfo?.libelle || code);
    result.push({ id, codeParent: code, libelleParent, periode, type, montant, imposable: !nonImp, autoCalc, nbMois, montantMensuelPrecedent });
  });
  return result;
}

function _sauvegarderRappels() {
  try {
    localStorage.setItem(CLE_RAPPELS, JSON.stringify(_getRappels()));
  } catch (_) {}
}

function _restaurerRappels() {
  try {
    const raw = localStorage.getItem(CLE_RAPPELS);
    if (!raw) return;
    const data = JSON.parse(raw);
    const container = document.getElementById("rappels-liste");
    if (!container) return;
    container.innerHTML = "";
    data.forEach(r => {
      container.appendChild(_creerLigneRappel(
        r.id, r.codeParent, r.libelleParent, r.periode, r.type,
        r.montant, r.imposable,
        r.autoCalc || false, r.nbMois || 0, r.montantMensuelPrecedent || 0
      ));
    });
  } catch (e) {
    console.warn("Restauration rappels impossible :", e);
  }
}

let _rpCounter = 0;

/**
 * Met à jour le montant d'un rappel en mode auto-calc.
 * Appelée sans déclencher calculerPaie() pour éviter les boucles.
 */
function _updateAutoCalcRappel(row) {
  const cbAuto = row.querySelector(".rp-auto-cb");
  if (!cbAuto?.checked) return;
  const code   = row.querySelector(".rp-code")?.value;
  const nbMois = parseFloat(row.querySelector(".rp-nb-mois")?.value) || 0;
  const montPrec = parseFloat(row.querySelector(".rp-montant-prec")?.value) || 0;
  const accessor = MONTANT_MENSUEL_MAP[code];
  if (!accessor || !_dernierProfil || !_derniersMontants) return;
  const montantActuel = accessor(_dernierProfil, _derniersMontants);
  const total = arrondir((montantActuel - montPrec) * nbMois);
  const inputMontant = row.querySelector(".rp-montant");
  if (inputMontant) {
    inputMontant.value    = total !== 0 ? total : "";
    inputMontant.readOnly = true;
  }
  const preview = row.querySelector(".rp-auto-preview");
  if (preview) {
    preview.textContent = nbMois > 0
      ? `${formaterMontant(montantActuel)} €/mois × ${nbMois} = ${formaterMontant(total)} €`
      : "Entrez le nombre de mois";
  }
}

/**
 * Rafraîchit tous les rappels en mode auto-calc après un recalcul de la fiche.
 * N'appelle PAS calculerPaie() pour éviter la boucle infinie.
 */
function _rafraichirAutoCalcRappels() {
  let changed = false;
  document.querySelectorAll("#rappels-liste .rappel-row-ui").forEach(row => {
    const avant = row.querySelector(".rp-montant")?.value;
    _updateAutoCalcRappel(row);
    if (row.querySelector(".rp-montant")?.value !== avant) changed = true;
  });
  if (changed) _sauvegarderRappels(); // persiste sans recalculer
}

/**
 * Construit une ligne de rappel via l'API DOM (layout vertical 3 rows).
 */
function _creerLigneRappel(
  id        = `r_${Date.now()}_${_rpCounter++}`,
  code      = "",
  libelle   = "",
  periode   = "",
  type      = "courante",
  montant   = "",
  imposable = true,
  autoCalc  = false,
  nbMois    = 0,
  montantMensuelPrecedent = 0
) {
  const row = document.createElement("div");
  row.className = "rappel-row-ui";
  row.dataset.rappelId = id;

  // ── Row 1 : sélecteur de ligne + bouton suppr ──────────────────────────────
  const row1 = document.createElement("div");
  row1.className = "rp-row1";

  const selCode = document.createElement("select");
  selCode.className = "rp-code";
  LIGNES_RAPPELLABLES.forEach(l => {
    const opt = new Option(l.code ? `${l.code} – ${l.libelle}` : l.libelle, l.code);
    if (l.code === code) opt.selected = true;
    selCode.appendChild(opt);
  });

  const selType = document.createElement("select");
  selType.className = "rp-type";
  [["courante", "An. cour."], ["anterieure", "An. ant."]].forEach(([val, label]) => {
    const opt = new Option(label, val);
    if (val === type) opt.selected = true;
    selType.appendChild(opt);
  });
  selType.addEventListener("change", () => { _sauvegarderRappels(); calculerPaie(); });

  const btnSuppr = document.createElement("button");
  btnSuppr.type        = "button";
  btnSuppr.className   = "pm-suppr rp-suppr";
  btnSuppr.title       = "Supprimer ce rappel";
  btnSuppr.textContent = "✖";
  btnSuppr.addEventListener("click", () => { row.remove(); _sauvegarderRappels(); calculerPaie(); });

  row1.append(selCode, selType, btnSuppr);

  // Champ libellé custom (visible uniquement si "AUTRE")
  const inputLibelle = document.createElement("input");
  inputLibelle.type        = "text";
  inputLibelle.className   = "rp-libelle-custom";
  inputLibelle.placeholder = "Libellé libre (ex: Rappel IFM 2024)";
  inputLibelle.value       = libelle;
  inputLibelle.style.display = code === "" ? "" : "none";
  inputLibelle.addEventListener("input", () => { _sauvegarderRappels(); calculerPaie(); });

  // ── Période : ligne full-width autonome ────────────────────────────────────
  const inputPeriode = document.createElement("input");
  inputPeriode.type        = "text";
  inputPeriode.className   = "rp-periode";
  inputPeriode.placeholder = "Période (ex: JAN. À MAR. 2025)";
  inputPeriode.value       = periode;
  inputPeriode.addEventListener("input", () => { _sauvegarderRappels(); calculerPaie(); });

  // ── Row 3 : montant + auto-calc ───────────────────────────────────────────
  const row3 = document.createElement("div");
  row3.className = "rp-row3";

  const inputMontant = document.createElement("input");
  inputMontant.type        = "number";
  inputMontant.className   = "rp-montant";
  inputMontant.placeholder = "0.00";
  inputMontant.step        = "1";
  inputMontant.readOnly    = autoCalc;
  if (montant !== "") inputMontant.value = montant;
  inputMontant.addEventListener("focus", () => { if (!inputMontant.readOnly) inputMontant.select(); });
  inputMontant.addEventListener("input", () => { _sauvegarderRappels(); calculerPaie(); });

  // ── Bloc auto-calc ────────────────────────────────────────────────────────
  const cbAutoId = `rp-auto-${id}`;
  const cbAuto   = document.createElement("input");
  cbAuto.type      = "checkbox";
  cbAuto.id        = cbAutoId;
  cbAuto.className = "rp-auto-cb pm-imp-non-cb";
  cbAuto.checked   = autoCalc;
  // Désactiver si pas de mapping pour ce code
  const hasMapping = code !== "" && !!MONTANT_MENSUEL_MAP[code];
  if (!hasMapping) { cbAuto.disabled = true; cbAuto.title = "Auto-calcul non disponible pour cette ligne"; }

  const lblAuto = document.createElement("label");
  lblAuto.htmlFor   = cbAutoId;
  lblAuto.textContent = "Auto";
  lblAuto.className = "pm-nonimposable-label";
  lblAuto.title     = "Calcul automatique : montant mensuel × nb de mois";

  const autoToggleDiv = document.createElement("div");
  autoToggleDiv.className = "pm-toggle-cb rp-auto-toggle";
  autoToggleDiv.append(cbAuto, lblAuto);

  // Champs visibles uniquement en mode auto
  const autoFields = document.createElement("div");
  autoFields.className = "rp-auto-fields" + (autoCalc ? " visible" : "");

  const inputNbMois = document.createElement("input");
  inputNbMois.type        = "number";
  inputNbMois.className   = "rp-nb-mois";
  inputNbMois.placeholder = "Mois";
  inputNbMois.min         = "1";
  inputNbMois.step        = "1";
  if (nbMois > 0) inputNbMois.value = nbMois;

  const spanX = document.createElement("span");
  spanX.className   = "rp-auto-sep";
  spanX.textContent = "−";
  spanX.title       = "Montant mensuel précédent (0 si c'est entièrement nouveau)";

  const inputMontPrec = document.createElement("input");
  inputMontPrec.type        = "number";
  inputMontPrec.className   = "rp-montant-prec";
  inputMontPrec.placeholder = "Mt/mois préc.";
  inputMontPrec.min         = "0";
  inputMontPrec.step        = "1";
  if (montantMensuelPrecedent > 0) inputMontPrec.value = montantMensuelPrecedent;

  const spanPreview = document.createElement("span");
  spanPreview.className = "rp-auto-preview";

  autoFields.append(inputNbMois, spanX, inputMontPrec, spanPreview);

  // ── Événements auto-calc ──────────────────────────────────────────────────
  const triggerAutoCalc = () => {
    _updateAutoCalcRappel(row);
    _sauvegarderRappels();
    calculerPaie();
  };
  inputNbMois.addEventListener("input",  triggerAutoCalc);
  inputMontPrec.addEventListener("input", triggerAutoCalc);

  cbAuto.addEventListener("change", () => {
    const on = cbAuto.checked;
    autoFields.classList.toggle("visible", on);
    inputMontant.readOnly = on;
    if (on) {
      _updateAutoCalcRappel(row);
    } else {
      inputMontant.readOnly = false;
      inputMontant.value    = "";
    }
    _sauvegarderRappels();
    calculerPaie();
  });

  row3.append(inputMontant, autoToggleDiv, autoFields);

  // ── Row 4 : non-imposable ─────────────────────────────────────────────────
  const row4 = document.createElement("div");
  row4.className = "rp-row4";

  const cbId     = `rp-nonim-${id}`;
  const cbNonImp = document.createElement("input");
  cbNonImp.type      = "checkbox";
  cbNonImp.id        = cbId;
  cbNonImp.className = "rp-non-imp pm-imp-non-cb";
  cbNonImp.checked   = !imposable;
  cbNonImp.addEventListener("change", () => { _sauvegarderRappels(); calculerPaie(); });

  const lblCb = document.createElement("label");
  lblCb.htmlFor     = cbId;
  lblCb.textContent = "Non imposable";
  lblCb.className   = "pm-nonimposable-label";

  const toggleDiv = document.createElement("div");
  toggleDiv.className = "pm-toggle-cb";
  toggleDiv.append(cbNonImp, lblCb);

  row4.append(toggleDiv);

  // ── Changement de code : mise à jour imposable + disponibilité auto-calc ───
  selCode.addEventListener("change", () => {
    const newCode  = selCode.value;
    const estAutre = newCode === "";
    inputLibelle.style.display = estAutre ? "" : "none";
    const info = LIGNES_RAPPELLABLES.find(l => l.code === newCode);
    if (info) cbNonImp.checked = !info.imposable;
    const canAuto = newCode !== "" && !!MONTANT_MENSUEL_MAP[newCode];
    cbAuto.disabled = !canAuto;
    if (!canAuto && cbAuto.checked) {
      cbAuto.checked = false;
      autoFields.classList.remove("visible");
      inputMontant.readOnly = false;
    }
    _sauvegarderRappels();
    calculerPaie();
  });

  row.append(row1, inputLibelle, inputPeriode, row3, row4);
  return row;
}

window.ajouterRappel = function () {
  const container = document.getElementById("rappels-liste");
  if (!container) return;
  const row = _creerLigneRappel();
  container.appendChild(row);
  row.querySelector(".rp-montant")?.focus();
};

/**
 * Supprime un rappel par son ID depuis la fiche de paie (bouton ✖ de la ligne).
 * @param {string} id - Identifiant du rappel (data-rappel-id)
 */
window.supprimerRappelDeFiche = function (id) {
  const row = document.querySelector(`#rappels-liste .rappel-row-ui[data-rappel-id="${CSS.escape(id)}"]`);
  if (row) {
    row.remove();
    _sauvegarderRappels();
    calculerPaie();
  }
};

// =============================================================================
// 11d. VUE MOBILE — Liste condensée (Option D)
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
function dessinerFicheMobile(p, m, pB = null, mB = null) {
  const root = document.getElementById("fiche-mobile");
  if (!root) return;
  // PERF — DocumentFragment : tous les appends se font hors DOM visible
  // → 1 seul reflow à la fin au lieu de ~35
  root.innerHTML = "";
  const frag = document.createDocumentFragment();

  const fmt = (v) => v > 0
    ? v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"
    : "";

  // ── Helpers DOM ──────────────────────────────────────────────────────────

  // FIX 8 — Sections ouvertes par défaut (les plus importantes)
  const SECTIONS_OUVERTES = new Set(["Base", "Primes & RIST", "Impôt", "Résultat"]);

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
    frag.appendChild(btn);

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
   * @param {number|null} [opts.delta] - delta comparaison (B-A pour crédits, A-B pour déductions)
   *                                     positif = vert, négatif = rouge
   */
  function ligne(libelle, credit, deduction, opts = {}) {
    const { panel, titre, cle, sub, total, totalNet, absence, onDelete, delta } = opts;

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
      frag.appendChild(row);
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

    // .mf-label-title porte le ::after "›" — séparé du sous-texte
    // pour que la flèche reste sur le titre, pas sous le taux/sous-titre
    const lblTitle = document.createElement("span");
    lblTitle.className = panel ? "mf-label-title" : "mf-label-title mf-label-title--plain";
    lblTitle.textContent = libelle;
    lbl.appendChild(lblTitle);

    if (sub) {
      const s = document.createElement("span");
      s.className = "mf-label-sub";
      s.textContent = sub;
      lbl.appendChild(s);
    }

    // Wrapper pour montant + badge delta
    const amtWrap = document.createElement("span");
    amtWrap.style.cssText = "display:flex;flex-direction:column;align-items:flex-end;gap:1px;flex-shrink:0;";

    const amt = document.createElement("span");
    amt.className = "mf-amount " + (credit ? "mf-credit" : deduction ? "mf-deduction" : "mf-info");

    if (credit)    amt.textContent = "+" + fmt(credit);
    else if (deduction) amt.textContent = "−" + fmt(deduction);
    else           amt.textContent = fmt(montant);
    amtWrap.appendChild(amt);

    // Badge delta comparaison — affiché uniquement en mode comparaison
    if (delta != null && mB && modeComparaison && Math.abs(delta) >= 0.01) {
      const db = document.createElement("span");
      const signe = delta > 0 ? "+" : "";
      db.className = "mf-delta-badge " + (delta > 0 ? "mf-delta-pos" : "mf-delta-neg");
      db.textContent = signe + delta.toLocaleString("fr-FR",
        { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
      amtWrap.appendChild(db);
    }

    // Bouton ✖ pour supprimer (primes manuelles)
    if (onDelete) {
      const del = document.createElement("button");
      del.type = "button";
      del.style.cssText = "background:none;border:none;color:#c0392b;font-size:14px;padding:0 0 0 8px;cursor:pointer;flex-shrink:0;";
      del.textContent = "✖";
      del.addEventListener("click", e => { e.stopPropagation(); onDelete(); });
      row.append(lbl, del, amtWrap);
    } else {
      row.append(lbl, amtWrap);
    }

    frag.appendChild(row);
  }

  // ── En-tête grade / échelon / indice ─────────────────────────────────────
  const header = document.createElement("div");
  header.className = "mf-header";

  const hLeft = document.createElement("div");
  hLeft.className = "mf-header-grade";
  const gradeTxt = (!p.grade || nonConfigure("grade")) ? "— Grade non configuré —" : p.grade;
  hLeft.textContent = gradeTxt;
  const echelonTxt = p.echelon ? `Échelon ${p.echelon}` : "Échelon non configuré";
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
  frag.appendChild(header);

  // ── Config incomplète ─────────────────────────────────────────────────────
  const pending = configurationIncomplete();
  if (pending) {
    const msg = document.createElement("div");
    msg.className = "mf-config-pending";
    msg.innerHTML = `<span class="mf-config-pending-icon">⚙</span>
      <span>Complétez votre profil pour afficher les totaux. Appuyez sur les lignes orangées pour configurer.</span>`;
    frag.appendChild(msg);
  }

  // ── BASE ──────────────────────────────────────────────────────────────────
  section("Base");

  // Traitement brut — tap ouvre panneau traitement (grade + échelon + NBI)
  const pendingTraitement = nonConfigure("grade") || nonConfigure("echelon") || nonConfigure("nbi");
  {
    const row = document.createElement("div");
    row.className = "mf-row mf-clickable" + (pendingTraitement ? " mf-pending" : "");
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    const action = () => _ouvrirPanneauMobile("panel-traitement-mobile", "Traitement", "");
    row.addEventListener("click", action);
    row.addEventListener("keydown", e => { if (e.key==="Enter"||e.key===" ") { e.preventDefault(); action(); }});
    const _deltaTrait = mB ? (mB.traitementBrut - m.traitementBrut) : null; // NBI séparée
    const lbl = document.createElement("span");
    lbl.className = "mf-label";
    lbl.textContent = "Traitement brut";

    if (pendingTraitement) {
      const badge = document.createElement("button");
      badge.type = "button";
      badge.className = "mf-badge";
      badge.textContent = "⚙ Configurer";
      badge.addEventListener("click", e => { e.stopPropagation(); action(); });
      row.append(lbl, badge);
    } else {
      const amtW = document.createElement("span");
      amtW.style.cssText = "display:flex;flex-direction:column;align-items:flex-end;gap:1px;flex-shrink:0;";
      const amt = document.createElement("span");
      amt.className = "mf-amount mf-credit";
      amt.textContent = "+" + fmt(m.traitementBrut);  // NBI sur ligne séparée
      amtW.appendChild(amt);
      if (_deltaTrait != null && mB && modeComparaison && Math.abs(_deltaTrait) >= 0.01) {
        const db = document.createElement("span");
        db.className = "mf-delta-badge " + (_deltaTrait > 0 ? "mf-delta-pos" : "mf-delta-neg");
        db.textContent = (_deltaTrait > 0 ? "+" : "") + _deltaTrait.toLocaleString("fr-FR",
          { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
        amtW.appendChild(db);
      }
      row.append(lbl, amtW);
    }
    frag.appendChild(row);
  }

  // NBI — affichée uniquement si activée (montantNbi > 0)
  if (m.montantNbi > 0) {
    ligne("NBI",  m.montantNbi, null,
      { panel: "panel-traitement-mobile", titre: "Traitement",
        sub: "Nouvelle Bonification Indiciaire",
        delta: mB ? (mB.montantNbi - m.montantNbi) : null });
  }

  ligne("Indemnité de résidence",   m.indemniteResidence, null,
    { cle: "zone_residence", panel: "panel-residence", titre: "Zone de Résidence",
      delta: mB ? (mB.indemniteResidence - m.indemniteResidence) : null });

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

  // ── Primes & RIST — ordre identique au desktop ───────────────────────────
  section("Primes & RIST");

  // 1. Nuits
  if (m.nuit > 0)
    ligne("Ind. travail de nuit",   m.nuit, null,
      { panel: "panel-nuits", titre: "Travail de Nuit & Soirées",
        onDelete: () => window.effacerValeurs({preventDefault:()=>{},stopPropagation:()=>{}}, ["input-nuit-n","input-nuit-s2"]) });

  // 2. FMD
  if (p.primes.forfait_mobilites > 0)
    ligne("Forfait mobilités",      p.primes.forfait_mobilites, null,
      { panel: "panel-fmd", titre: "Forfait Mobilités",
        onDelete: () => window.effacerValeurs({preventDefault:()=>{},stopPropagation:()=>{}}, ["input-fmd"]) });

  // 3. Inflation
  if (p.primes.inflation > 0)
    ligne("Indemnité pouvoir d'achat", p.primes.inflation, null,
      { panel: "panel-inflation", titre: "Indemnité Inflation",
        onDelete: () => window.effacerValeurs({preventDefault:()=>{},stopPropagation:()=>{}}, ["input-inflation"]) });

  // 4-8. RIST × 5 (avec badge si non configuré)
  ligne("RIST Part Fonctions",     p.primes.rist_fonctions - m.absRistFct, null,
    { cle: "rist_fonctions", panel: "panel-rist-fonctions", titre: "RIST Part Fonctions",
      delta: mB ? ((pB.primes.rist_fonctions - mB.absRistFct) - (p.primes.rist_fonctions - m.absRistFct)) : null });
  ligne("RIST Part Expérience",    p.primes.rist_exper_prof - m.absRistExp, null,
    { cle: "rist_experience", panel: "panel-rist-experience", titre: "RIST Part Expérience",
      delta: mB ? ((pB.primes.rist_exper_prof - mB.absRistExp) - (p.primes.rist_exper_prof - m.absRistExp)) : null });
  ligne("RIST Part LIC-ISQ",       p.primes.rist_lic_isq - m.absRistIsq, null,
    { cle: "rist_isq_licence", panel: "panel-rist-isq-licence", titre: "RIST Part LIC-ISQ",
      delta: mB ? ((pB.primes.rist_lic_isq - mB.absRistIsq) - (p.primes.rist_lic_isq - m.absRistIsq)) : null });
  ligne("RIST CPLT LIC-ISQ",       p.primes.rist_cplt_lic_isq - m.absRistCplt, null,
    { cle: "rist_isq_complement", panel: "panel-rist-isq-complement", titre: "RIST CPLT LIC-ISQ",
      delta: mB ? ((pB.primes.rist_cplt_lic_isq - mB.absRistCplt) - (p.primes.rist_cplt_lic_isq - m.absRistCplt)) : null });
  ligne("Majoration ISQ",          p.primes.rist_maj_isq - m.absRistMaj, null,
    { cle: "rist_isq_majoration", panel: "panel-rist-isq-majoration", titre: "Majoration ISQ",
      delta: mB ? ((pB.primes.rist_maj_isq - mB.absRistMaj) - (p.primes.rist_maj_isq - m.absRistMaj)) : null });

  // 9. Ind. compensatrice CSG
  ligne("Ind. compensatrice CSG",  p.primes.ind_compensatrice_csg - m.absIndCsg, null,
    { cle: "ind_compensatrice_csg", panel: "panel-csg", titre: "Indemnité Compensatrice CSG" });

  // 10. PSC
  if (p.primes.psc > 0)
    ligne("Participation PSC",      p.primes.psc, null,
      { panel: "panel-psc", titre: "Participation PSC",
        onDelete: () => window.effacerValeurs({preventDefault:()=>{},stopPropagation:()=>{}}, ["psc-15"]) });

  // 10b. ALAN
  const alanTotalSal = (p.alan?.forfait||0) + (p.alan?.solidaire||0) + (p.alan?.action_sociale||0) + (p.alan?.aide_retraites||0);
  if (alanTotalSal > 0 || (p.alan?.employeur||0) > 0)
    ligne("Mutuelle ALAN", null, alanTotalSal || null,
      { panel: "panel-alan", titre: "Mutuelle ALAN",
        onDelete: () => window.effacerValeurs({preventDefault:()=>{},stopPropagation:()=>{}}, ["alan-forfait","alan-solidaire","alan-action-sociale","alan-aide-retraites","alan-employeur"]) });

  // 11. PPP
  if (p.evenements.prime_performance > 0)
    ligne("Prime partage performance", p.evenements.prime_performance, null,
      { panel: "panel-primes", titre: "Prime Partage Performance",
        onDelete: () => window.effacerValeurs({preventDefault:()=>{},stopPropagation:()=>{}}, ["input-perf"]) });

  // 12-14. OTT : PV globale, PF, PV opt 3-1/3-2 (ordre desktop)
  if (p.evenements.ott_pv_globale > 0)
    ligne("OTT Part Variable",     p.evenements.ott_pv_globale, null,
      { panel: "panel-ott", titre: "Protocole (OTT)",
        onDelete: () => window.effacerValeurs({preventDefault:()=>{},stopPropagation:()=>{}}, ["pv-globale"]) });
  if (p.evenements.ott_pf > 0)
    ligne("OTT Part Fixe",         p.evenements.ott_pf, null,
      { panel: "panel-ott", titre: "Protocole (OTT)",
        onDelete: () => window.effacerValeurs({preventDefault:()=>{},stopPropagation:()=>{}}, ["pf-manuel","pf-opt1-l16","pf-opt1-cdg","pf-opt1-l711","pf-opt1-l911","pf-opt1-plus-n1","pf-opt1-plus-n2","pf-opt2-1","pf-opt2-2","pf-opt2-bis","pf-opt4","pf-opt1-enac","pf-opt1-plus-enac"]) });
  if (p.evenements.ott_pv_opt32 > 0)
    ligne("OTT PV Opt 3-1/3-2",   p.evenements.ott_pv_opt32, null,
      { panel: "panel-ott", titre: "Protocole (OTT)",
        onDelete: () => window.effacerValeurs({preventDefault:()=>{},stopPropagation:()=>{}}, ["pv-opt32"]) });

  // 15. Fidélisation (avant Attractivité — ordre desktop)
  if (p.primes.fidelisation > 0)
    ligne("Prime fidélisation",    p.primes.fidelisation, null,
      { panel: "panel-fidelisation", titre: "Prime Fidélisation",
        onDelete: () => window.effacerValeurs({preventDefault:()=>{},stopPropagation:()=>{}}, ["input-fidelisation"]) });

  // 16. Attractivité
  if (p.primes.attractivite > 0)
    ligne("Attractivité géo.",     p.primes.attractivite, null,
      { panel: "panel-attractivite", titre: "Attractivité Géographique",
        onDelete: () => window.effacerValeurs({preventDefault:()=>{},stopPropagation:()=>{}}, ["input-attractivite"]) });

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

  ligne("CSG non déductible",      null, m.csgNonDeductible,
    { delta: mB ? (m.csgNonDeductible - mB.csgNonDeductible) : null });
  ligne("CSG déductible",          null, m.csgDeductible,
    { delta: mB ? (m.csgDeductible - mB.csgDeductible) : null });
  ligne("CRDS",                    null, m.crds,
    { delta: mB ? (m.crds - mB.crds) : null });
  ligne("Cotisation RAFP",         null, m.cotisationRafp,
    { delta: mB ? (m.cotisationRafp - mB.cotisationRafp) : null });
  if (m.retenueIsq > 0)
    ligne("24,6% ISQ",             null, m.retenueIsq,
      { delta: mB ? (m.retenueIsq - mB.retenueIsq) : null });

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
      { panel: "panel-impots", titre: "Prélèvement à la Source", sub: `Taux ${tauxPct}`,
        delta: mB ? (m.impotSource - mB.impotSource) : null });
  }

  // ── Nets ──────────────────────────────────────────────────────────────────
  if (!pending) {
    section("Résultat");

    // Formateur dédié aux lignes de total : inclut TOUJOURS le € même pour 0
    const fmtT = (v) => v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
    // Helper : ligne de total réutilisable
    const ligneTotal = (libelle, valeur, deltaVal = null) => {
      const row = document.createElement("div");
      row.className = "mf-row mf-total";
      const lbl = document.createElement("span"); lbl.className = "mf-label"; lbl.textContent = libelle;
      const wrap = document.createElement("span");
      wrap.style.cssText = "display:flex;flex-direction:column;align-items:flex-end;gap:1px;flex-shrink:0;min-width:0;";
      const amt = document.createElement("span"); amt.className = "mf-amount mf-info"; amt.textContent = fmtT(valeur);
      wrap.appendChild(amt);
      if (deltaVal != null && mB && modeComparaison && Math.abs(deltaVal) >= 0.01) {
        const db = document.createElement("span");
        db.className = "mf-delta-badge " + (deltaVal > 0 ? "mf-delta-pos" : "mf-delta-neg");
        db.textContent = (deltaVal > 0 ? "+" : "") + deltaVal.toLocaleString("fr-FR",
          { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
        wrap.appendChild(db);
      }
      row.append(lbl, wrap); frag.appendChild(row);
    };

    // ── Lignes TOUJOURS visibles (hors pliable) ─────────────────────────────
    // Net avant impôt — toujours visible
    ligneTotal("Net avant impôt", m.netAPayerAvantImpot,
      mB ? (mB.netAPayerAvantImpot - m.netAPayerAvantImpot) : null);

    // ── Sous-section pliable : détail des totaux ──────────────────────────
    // Bouton toggle "Détail ▶"
    const btnDetailTotaux = document.createElement("button");
    btnDetailTotaux.type = "button";
    btnDetailTotaux.className = "mf-detail-toggle";
    btnDetailTotaux.innerHTML = '<span class="mf-detail-arrow">▶</span> Détail des totaux';
    let detailOuvert = false;
    frag.appendChild(btnDetailTotaux);

    // Conteneur des lignes de détail (caché par défaut)
    const detailWrap = document.createElement("div");
    detailWrap.className = "mf-detail-wrap";
    detailWrap.style.display = "none";
    frag.appendChild(detailWrap);

    // Remplir le conteneur avec les lignes de détail
    const ligneDetailTotal = (libelle, valeur, deltaVal = null) => {
      const row = document.createElement("div");
      row.className = "mf-row mf-total";
      const lbl = document.createElement("span"); lbl.className = "mf-label"; lbl.textContent = libelle;
      const wrap = document.createElement("span");
      wrap.style.cssText = "display:flex;flex-direction:column;align-items:flex-end;gap:1px;flex-shrink:0;min-width:0;";
      const amt = document.createElement("span"); amt.className = "mf-amount mf-info";
      amt.textContent = fmtT(valeur);
      wrap.appendChild(amt);
      if (deltaVal != null && mB && modeComparaison && Math.abs(deltaVal) >= 0.01) {
        const db = document.createElement("span");
        db.className = "mf-delta-badge " + (deltaVal > 0 ? "mf-delta-pos" : "mf-delta-neg");
        db.textContent = (deltaVal > 0 ? "+" : "") + deltaVal.toLocaleString("fr-FR",
          { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
        wrap.appendChild(db);
      }
      row.append(lbl, wrap); detailWrap.appendChild(row);
    };

    ligneDetailTotal("Brut total", m.totalAPayer, mB ? (mB.totalAPayer - m.totalAPayer) : null);
    ligneDetailTotal("Net social", m.netSocial, mB ? (mB.netSocial - m.netSocial) : null);
    ligneDetailTotal("Montant imposable", m.netImposableFinal, mB ? (mB.netImposableFinal - m.netImposableFinal) : null);
    ligneDetailTotal("Charges patronales", m.totalPatronal, mB ? (m.totalPatronal - mB.totalPatronal) : null);
    ligneDetailTotal("Coût total employeur", m.coutTotalEmployeur, mB ? (m.coutTotalEmployeur - mB.coutTotalEmployeur) : null);

    btnDetailTotaux.addEventListener("click", () => {
      detailOuvert = !detailOuvert;
      detailWrap.style.display = detailOuvert ? "" : "none";
      const arrow = btnDetailTotaux.querySelector(".mf-detail-arrow");
      if (arrow) arrow.textContent = detailOuvert ? "▼" : "▶";
    });

    // NET À PAYER — ligne vedette (avec delta si mode comparaison)
    const rowNet = document.createElement("div");
    rowNet.className = "mf-row mf-total mf-total-net";
    const lblNet = document.createElement("span");
    lblNet.className = "mf-label";
    lblNet.textContent = "NET À PAYER";
    const amtNetWrap = document.createElement("span");
    amtNetWrap.style.cssText = "display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0;min-width:0;";
    const amtNet = document.createElement("span");
    amtNet.className = "mf-amount";
    amtNet.textContent = m.netFinal.toLocaleString("fr-FR",
      { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
    amtNetWrap.appendChild(amtNet);
    // Delta mode comparaison
    if (mB && modeComparaison) {
      const delta = mB.netFinal - m.netFinal; // B - A : positif = B meilleur
      if (delta !== 0) {
        const deltaBadge = document.createElement("span");
        const signe = delta > 0 ? "+" : "";
        deltaBadge.className = "mf-delta-badge " + (delta > 0 ? "mf-delta-pos" : "mf-delta-neg");
        deltaBadge.textContent = signe + delta.toLocaleString("fr-FR",
          { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
        amtNetWrap.appendChild(deltaBadge);
      }
    }
    rowNet.append(lblNet, amtNetWrap);
    frag.appendChild(rowNet);
  }

  // Bouton "Ajouter" supprimé — fonction disponible via le bouton ➕ de la bottom-bar

  // PERF — flush : on injecte le fragment en 1 seul reflow
  root.appendChild(frag);

  // ── Mise à jour de la barre sticky NET ──────────────────────────────────
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
  // FIX libellé non sauvegardé : déclenche le recalcul (et donc la sauvegarde) au changement
  inputLib.addEventListener("input", () => window.calculerEtAfficherProjection?.());

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
    alan: {
      forfait:        lireFloat("cmp-alan-forfait"),
      solidaire:      lireFloat("cmp-alan-solidaire"),
      action_sociale: lireFloat("cmp-alan-action-sociale"),
      aide_retraites: lireFloat("cmp-alan-aide-retraites"),
      employeur:      lireFloat("cmp-alan-employeur"),
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

// Patch post-définition — met à jour la bottom-bar mobile après activation/désactivation
// FIX comparateur mobile : _origActiver était capturé avant la définition (undefined)
{
  const _origActiver    = window.activerComparaison;
  const _origDesactiver = window.desactiverComparaison;
  window.activerComparaison = function () {
    _origActiver?.();
    if (typeof _majBottomBarComparer === "function") _majBottomBarComparer();
  };
  window.desactiverComparaison = function () {
    _origDesactiver?.();
    if (typeof _majBottomBarComparer === "function") _majBottomBarComparer();
  };
}

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
      title: "RIST & ISQ",
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
