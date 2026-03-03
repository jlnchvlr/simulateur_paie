let baseDonnees = {};
window.isTourActive = false;
window.tourSavedStep = undefined;

// =========================================
// MOTEUR DE RECHERCHE GLOBAL (Le Cerveau)
// =========================================
const indexRecherche = [
  {
    titre: "🌙 Nuits & Soirées",
    motsCles: ["nuit", "soirée", "soiree", "majoration", "horaire"],
    cible: "panel-nuits",
  },
  {
    titre: "📍 Attractivité Géographique",
    motsCles: [
      "attractivite",
      "majo",
      "geo",
      "201987",
      "201986",
      "nord",
      "cdg",
    ],
    cible: "panel-attractivite",
  },
  {
    titre: "⏳ Prime de Fidélisation",
    motsCles: ["fidelisation", "pft", "palier", "engagement", "duree"],
    cible: "panel-fidelisation",
  },
  {
    titre: "🤒 Jours d'absence (Grève, Maladie)",
    motsCles: [
      "grève",
      "greve",
      "maladie",
      "carence",
      "absence",
      "arrêt",
      "arret",
      "snf",
      "1/30",
      "jour",
    ],
    cible: "panel-absences",
  },
  {
    titre: "🚲 Forfait Mobilités Durables",
    motsCles: [
      "vélo",
      "velo",
      "fmd",
      "mobilité",
      "mobilite",
      "covoiturage",
      "voiture",
      "transport",
    ],
    cible: "panel-fmd",
  },
  {
    titre: "📊 Protocole (OTT)",
    motsCles: [
      "ott",
      "protocole",
      "part fixe",
      "part variable",
      "pf",
      "pv",
      "option",
      "enac",
      "cdg",
      "liste",
    ],
    cible: "panel-ott",
  },
  {
    titre: "💰 Autres Primes (Perf, Fidélisation)",
    motsCles: [
      "prime",
      "ppp",
      "performance",
      "fidélisation",
      "fidelisation",
      "attractivité",
      "géographique",
      "geo",
    ],
    cible: "panel-primes",
  },
  {
    titre: "🛡️ Participation PSC (Mutuelle)",
    motsCles: [
      "psc",
      "mutuelle",
      "santé",
      "sante",
      "prévoyance",
      "prevoyance",
      "alan",
      "mgas",
      "aide",
    ],
    cible: "panel-psc",
  },
  {
    titre: "Impôt sur le Revenu (PAS)",
    motsCles: [
      "impôt",
      "impot",
      "pas",
      "source",
      "taux",
      "prélèvement",
      "prelevement",
      "personnalisé",
    ],
    cible: "panel-impots",
  },
  {
    titre: "Indemnité Compensatrice CSG",
    motsCles: ["csg", "indemnité", "indemnite", "compensatrice"],
    cible: "panel-csg",
  },
  {
    titre: "Zone de Résidence (IR)",
    motsCles: ["ir", "résidence", "residence", "zone", "indemnité"],
    cible: "panel-residence",
  },
  {
    titre: "RIST - Part Fonctions",
    motsCles: ["rist", "fonctions", "part", "prime", "niveau"],
    cible: "panel-rist-fonctions",
  },
  {
    titre: "RIST - Part Expérience",
    motsCles: ["rist", "expérience", "experience", "exp"],
    cible: "panel-rist-experience",
  },
  {
    titre: "Licence ISQ",
    motsCles: ["isq", "licence", "icna"],
    cible: "panel-rist-isq-licence",
  },
  {
    titre: "Complément ISQ",
    motsCles: ["isq", "complément", "complement", "cplt"],
    cible: "panel-rist-isq-complement",
  },
  {
    titre: "Majoration ISQ",
    motsCles: ["majoration", "isq"],
    cible: "panel-rist-isq-majoration",
  },
];

function normaliserTexte(texte) {
  return texte
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

window.rechercherElement = function (requete) {
  if (!requete || requete.trim() === "") return [];
  const requeteNormalisee = normaliserTexte(requete.trim());
  return indexRecherche.filter((item) => {
    if (normaliserTexte(item.titre).includes(requeteNormalisee)) return true;
    return item.motsCles.some((mot) =>
      normaliserTexte(mot).includes(requeteNormalisee),
    );
  });
};

// =========================================
// INITIALISATION ET LOGIQUE PRINCIPALE
// =========================================
async function initialiserApplication() {
  try {
    const reponse = await fetch("data.json");
    if (!reponse.ok) throw new Error("Fichier introuvable.");
    baseDonnees = await reponse.json();

    mettreAJourEchelons();

    // Remplissage des Selects Attractivité et Fidélisation
    if (baseDonnees.attractivite) {
      const selectAttr = document.getElementById("input-attractivite");
      if (selectAttr) {
        baseDonnees.attractivite.forEach((opt) => {
          selectAttr.add(new Option(opt.label, opt.valeur));
        });
      }
    }

    if (baseDonnees.fidelisation) {
      const selectFid = document.getElementById("input-fidelisation");
      if (selectFid) {
        baseDonnees.fidelisation.forEach((opt) => {
          selectFid.add(new Option(opt.label, opt.valeur));
        });
      }
    }

    document.getElementById("input-grade").addEventListener("input", () => {
      mettreAJourEchelons();
      calculerPaie();
    });

    const inputs = document.querySelectorAll(
      ".magic-modal select, .magic-modal input, .info-table select, .info-table input",
    );
    inputs.forEach((input) => input.addEventListener("input", calculerPaie));

    const modal = document.getElementById("magic-modal");

    modal.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        // Si le focus est sur un résultat de recherche, on clique dessus !
        if (
          document.activeElement &&
          document.activeElement.classList.contains("resultat-item")
        ) {
          document.activeElement.click();
        } else {
          modal.close(); // Comportement normal sinon
        }
      }
    });

    modal.addEventListener("close", () => {
      if (window.tourSavedStep !== undefined) {
        setTimeout(() => {
          const etapeSuivante = window.tourSavedStep + 1;
          if (etapeSuivante <= 5) {
            window.lancerVisiteGuidee(etapeSuivante);
          } else {
            window.isTourActive = false;
          }
          window.tourSavedStep = undefined;
        }, 150);
      }
    });

    // --- NOUVEAU : FULL KEYBOARD MODE (Menu Ajout) ---
    modal.addEventListener("keydown", (e) => {
      const champRecherche = document.getElementById("recherche-ajout");
      // Si on est en mode recherche, qu'on n'est pas dans l'input, et qu'on tape un truc
      if (
        modal.classList.contains("search-mode") &&
        document.activeElement !== champRecherche
      ) {
        if (e.key === "Backspace") {
          e.preventDefault(); // Empêche le comportement par défaut
          champRecherche.focus();
          champRecherche.value = champRecherche.value.slice(0, -1); // Efface la dernière lettre
          champRecherche.dispatchEvent(new Event("input")); // Met à jour la liste
        } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          // Si on tape une lettre normale, on refocus direct l'input
          champRecherche.focus();
        }
      }
    });

    // ---------------------------------------------------------
    // --- SÉCURITÉ ET LOGIQUE DES CHAMPS NUMÉRIQUES ---
    // ---------------------------------------------------------
    const champsNumeriques = document.querySelectorAll(
      '.magic-modal input[type="number"]',
    );

    champsNumeriques.forEach((champ) => {
      champ.addEventListener("input", function () {
        if (this.value === "") return;

        let valeur = parseFloat(this.value);
        let valeurCorrigee = false;

        if (valeur < 0) {
          this.value = "0";
          valeurCorrigee = true;
        }

        if (this.id === "input-pas" && valeur > 100) {
          this.value = "100";
          valeurCorrigee = true;
        }

        if (
          (this.id === "input-nuit-n" || this.id === "input-nuit-s2") &&
          valeur > 30
        ) {
          this.value = "30";
          valeurCorrigee = true;
        }

        if (valeurCorrigee) {
          calculerPaie();
        }
      });

      champ.addEventListener("blur", function () {
        if (this.value === "") {
          if (this.step && this.step.includes(".")) {
            this.value = "0.00";
          } else {
            this.value = "0";
          }
          calculerPaie();
        }
      });
    });

    // ---------------------------------------------------------
    // --- LOGIQUE DE LA BARRE DE RECHERCHE (MENU AJOUT) ---
    // ---------------------------------------------------------
    const champRecherche = document.getElementById("recherche-ajout");
    const conteneurResultats = document.getElementById("resultats-recherche");
    const conteneurBoutonsDefaut = document.getElementById(
      "boutons-ajout-defaut",
    );

    if (champRecherche) {
      champRecherche.addEventListener("input", (e) => {
        const requete = e.target.value;

        if (requete.trim() === "") {
          conteneurResultats.style.display = "none";
          conteneurBoutonsDefaut.style.display = "grid";
          return;
        }

        const resultats = window.rechercherElement(requete);

        conteneurBoutonsDefaut.style.display = "none";
        conteneurResultats.style.display = "flex";
        conteneurResultats.innerHTML = "";

        if (resultats.length === 0) {
          conteneurResultats.innerHTML = `<div class="resultat-vide">Aucun élément trouvé pour "${requete}" 🕵️‍♂️</div>`;
        } else {
          resultats.forEach((res) => {
            const btn = document.createElement("button"); // Utilisation de BUTTON pour l'accessibilité
            btn.className = "resultat-item";
            btn.innerHTML = `<span>${res.titre}</span> <span style="color: #aaa; font-size: 12px;">➔</span>`;
            btn.onclick = () => {
              ouvrirModal(res.cible, res.titre);
            };
            conteneurResultats.appendChild(btn);
          });
        }
      });
    }

    // ---------------------------------------------------------
    // --- LOGIQUE DU SPOTLIGHT (Ctrl + K) ---
    // ---------------------------------------------------------
    const spotlightModal = document.getElementById("spotlight-modal");
    const spotlightInput = document.getElementById("spotlight-input");
    const spotlightResults = document.getElementById("spotlight-results");

    if (spotlightModal && spotlightInput) {
      document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "k") {
          e.preventDefault();
          if (!spotlightModal.open) {
            spotlightModal.showModal();
            spotlightInput.value = "";
            spotlightResults.innerHTML = "";
            spotlightInput.focus();
          } else {
            spotlightModal.close();
          }
        }
      });

      spotlightModal.addEventListener("click", (e) => {
        const rect = spotlightModal.getBoundingClientRect();
        const inDialog =
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom;
        if (!inDialog) {
          spotlightModal.close();
        }
      });

      spotlightInput.addEventListener("input", (e) => {
        const requete = e.target.value;
        spotlightResults.innerHTML = "";

        if (requete.trim() === "") return;

        const resultats = window.rechercherElement(requete);

        if (resultats.length === 0) {
          spotlightResults.innerHTML = `<div class="resultat-vide">Aucun élément trouvé pour "${requete}" 🕵️‍♂️</div>`;
        } else {
          resultats.forEach((res) => {
            const btn = document.createElement("button"); // Utilisation de BUTTON pour l'accessibilité
            btn.className = "resultat-item";
            btn.innerHTML = `<span>${res.titre}</span> <span style="color: #aaa; font-size: 12px;">➔</span>`;
            btn.onclick = () => {
              spotlightModal.close();
              ouvrirModal(res.cible, res.titre);
            };
            spotlightResults.appendChild(btn);
          });
        }
      });

      // --- NOUVEAU : FULL KEYBOARD MODE (Spotlight) ---
      spotlightModal.addEventListener("keydown", (e) => {
        if (document.activeElement !== spotlightInput) {
          if (e.key === "Backspace") {
            e.preventDefault();
            spotlightInput.focus();
            spotlightInput.value = spotlightInput.value.slice(0, -1);
            spotlightInput.dispatchEvent(new Event("input"));
          } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
            spotlightInput.focus();
          }
        }
      });
    }

    // --- NOUVEAU : DÉTECTION SOURIS VS CLAVIER (Pour éviter les doubles sélections) ---
    document.addEventListener("keydown", (e) => {
      if (e.key === "Tab" || e.key.startsWith("Arrow")) {
        document.body.classList.add("navigation-clavier");
      }
    });
    document.addEventListener("mousemove", () => {
      document.body.classList.remove("navigation-clavier");
    });

    calculerPaie();
    resetHelperRist();
    resetHelperExp();
    resetHelperIsqLicence();
    resetHelperIsqComplement();
    resetHelperIsqMajoration();
  } catch (erreur) {
    console.error("Erreur:", erreur);
  }
}

function mettreAJourEchelons() {
  const grade = document.getElementById("input-grade").value;
  const selectEchelon = document.getElementById("input-echelon");
  const echelonActuel = selectEchelon.value;
  selectEchelon.innerHTML = "";

  const echelons = Object.keys(baseDonnees.grilles_icna[grade] || {});

  echelons.sort((a, b) => {
    const numA = parseInt(a),
      numB = parseInt(b);
    const isNumA = !isNaN(numA),
      isNumB = !isNaN(numB);
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

  selectEchelon.value = echelons.includes(echelonActuel)
    ? echelonActuel
    : echelons[0] || "";
}

function creerMenuInteractif(
  nomGlobal,
  inputId,
  helperId,
  panelId,
  dictDetails,
) {
  window[`previewHelper${nomGlobal}`] = (nv) => {
    const el = document.getElementById(helperId);
    if (el) el.innerHTML = `<strong>Aperçu :</strong> ${dictDetails[nv] || ""}`;
  };
  window[`resetHelper${nomGlobal}`] = () => {
    const nv = document.getElementById(inputId).value;
    const el = document.getElementById(helperId);
    if (el)
      el.innerHTML = `<strong>Sélectionné :</strong> ${dictDetails[nv] || ""}`;
  };
  window[`select${nomGlobal}`] = (nv) => {
    document.getElementById(inputId).value = nv;
    document
      .querySelectorAll(`#${panelId} .rist-option`)
      .forEach((e) => e.classList.remove("selected"));
    document
      .querySelector(`#${panelId} .rist-option[data-value="${nv}"]`)
      ?.classList.add("selected");
    window[`resetHelper${nomGlobal}`]();
    calculerPaie();
  };
}

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

creerMenuInteractif(
  "Rist",
  "input-fonction",
  "rist-helper-text",
  "panel-rist-fonctions",
  ristDetails,
);
creerMenuInteractif(
  "Exp",
  "input-experience",
  "exp-helper-text",
  "panel-rist-experience",
  expDetails,
);
creerMenuInteractif(
  "IsqLicence",
  "input-isq-licence",
  "isq-licence-helper-text",
  "panel-rist-isq-licence",
  isqLicenceDetails,
);
creerMenuInteractif(
  "IsqComplement",
  "input-isq-complement",
  "isq-complement-helper-text",
  "panel-rist-isq-complement",
  isqComplementDetails,
);
creerMenuInteractif(
  "IsqMajoration",
  "input-isq-majoration",
  "isq-majoration-helper-text",
  "panel-rist-isq-majoration",
  isqMajorationDetails,
);

function getProfilDepuisInterface() {
  let pfTotal = parseFloat(document.getElementById("pf-manuel")?.value) || 0;
  document.querySelectorAll(".pf-checkbox").forEach((cb) => {
    if (cb.checked) pfTotal += parseFloat(cb.value);
  });

  let pscTotal = 0;
  document.querySelectorAll(".psc-checkbox").forEach((cb) => {
    if (cb.checked) pscTotal += parseFloat(cb.value);
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
      attractivite:
        parseFloat(document.getElementById("input-attractivite")?.value) || 0,
      fidelisation:
        parseFloat(document.getElementById("input-fidelisation")?.value) || 0,
      ind_compensatrice_csg:
        parseFloat(document.getElementById("input-ind-csg")?.value) || 0,
      psc: pscTotal,
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
  if (window.isTourActive && window.tourObj) {
    const state = window.tourObj.getState();
    window.tourSavedStep = state ? state.activeIndex : 0;
    window.tourObj.destroy();
  }

  const modal = document.getElementById("magic-modal");

  // --- GESTION DU MODE DE LA MODALE ---
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

  document.getElementById("modal-title").textContent = titre;
  document
    .querySelectorAll(".setting-panel")
    .forEach((p) => p.classList.remove("active"));

  if (Array.isArray(panelIds)) {
    panelIds.forEach((id) =>
      document.getElementById(id).classList.add("active"),
    );
  } else {
    document.getElementById(panelIds).classList.add("active");
  }

  modal.showModal();

  setTimeout(() => {
    const activePanel = document.querySelector(".setting-panel.active");
    if (activePanel) {
      const selectedOption = activePanel.querySelector(".rist-option.selected");
      if (selectedOption)
        selectedOption.scrollIntoView({ block: "center", behavior: "instant" });
    }
  }, 15);
}

window.effacerValeurs = function (event, inputIds) {
  event.stopPropagation();
  inputIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      if (el.tagName === "SELECT") {
        if (el.querySelector('option[value="none"]')) el.value = "none";
        else el.value = "0";
      } else if (el.type === "checkbox") {
        el.checked = false;
      } else {
        el.value = "0";
      }
    }
  });
  calculerPaie();
};

window.limiterAbsences = function (el) {
  if (parseInt(el.value) < 0) el.value = "0";
  const greve = parseInt(document.getElementById("input-greve").value) || 0;
  const carence = parseInt(document.getElementById("input-carence").value) || 0;
  const m90 = parseInt(document.getElementById("input-maladie-90").value) || 0;
  const m50 = parseInt(document.getElementById("input-maladie-50").value) || 0;

  const total = greve + carence + m90 + m50;
  if (total > 30) el.value = (parseInt(el.value) || 0) - (total - 30);
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
  const previewNuits = document.getElementById("preview-nuits");
  if (previewNuits) previewNuits.textContent = formaterMontant(nuit);

  const joursGreve = profilAgent.evenements.jours_greve;
  const joursCarence = profilAgent.evenements.jours_carence;
  const jours90 = profilAgent.evenements.jours_maladie_90;
  const jours50 = profilAgent.evenements.jours_maladie_50;
  const joursAbs = joursGreve + joursCarence + jours90 + jours50;
  const joursRetenus =
    joursGreve + joursCarence + jours90 * 0.1 + jours50 * 0.5;

  const psc = profilAgent.primes.psc;

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

  function genererTooltipAbsence(montantDeBase) {
    let details = [];
    const parJour = montantDeBase / 30;
    if (joursGreve > 0)
      details.push(
        `Grève (${joursGreve}J) : -${formaterMontant(arrondir(parJour * joursGreve))} €`,
      );
    if (joursCarence > 0)
      details.push(
        `Carence (${joursCarence}J) : -${formaterMontant(arrondir(parJour * joursCarence))} €`,
      );
    if (jours90 > 0)
      details.push(
        `Maladie 90% (${jours90}J) : -${formaterMontant(arrondir(parJour * jours90 * 0.1))} €`,
      );
    if (jours50 > 0)
      details.push(
        `Maladie 50% (${jours50}J) : -${formaterMontant(arrondir(parJour * jours50 * 0.5))} €`,
      );
    return details.join("\n");
  }

  let detailsLigneTexte = [];
  if (joursGreve > 0) detailsLigneTexte.push(`GREVE ${joursGreve}J`);
  if (joursCarence > 0) detailsLigneTexte.push(`CAR ${joursCarence}J`);
  if (jours90 > 0) detailsLigneTexte.push(`MAL 90% ${jours90}J`);
  if (jours50 > 0) detailsLigneTexte.push(`MAL 50% ${jours50}J`);
  const ligneDetailAbsence = detailsLigneTexte.join(" // ");

  const majPreview = (id, montant) => {
    const el = document.getElementById(id);
    if (el) el.textContent = formaterMontant(montant);
  };
  majPreview("preview-rist-fonctions", profilAgent.primes.rist_fonctions);
  majPreview("preview-rist-experience", profilAgent.primes.rist_exper_prof);
  majPreview("preview-rist-isq-licence", profilAgent.primes.rist_lic_isq);
  majPreview(
    "preview-rist-isq-complement",
    profilAgent.primes.rist_cplt_lic_isq,
  );
  majPreview("preview-rist-isq-majoration", profilAgent.primes.rist_maj_isq);

  const baseTraitementReel = traitementBrut - absenceTraitement;
  const baseNbiReelle = montantNbi - absenceNbi;
  const baseResidenceReelle = indemniteResidence - absenceResidence;
  const baseSoumisePC = baseTraitementReel + baseNbiReelle;

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
    profilAgent.evenements.fidelisation +
    profilAgent.evenements.geographique +
    profilAgent.evenements.ott_pf +
    profilAgent.evenements.ott_pv_globale +
    profilAgent.evenements.ott_pv_opt32;
  +profilAgent.primes.attractivite + profilAgent.primes.fidelisation;

  // 📍 ATTRACTIVITÉ
  if (profilAgent.primes.attractivite > 0) {
    ajouterLigne(
      "203002",
      "ATTRACTIVITE GEOGRAPHIQUE",
      profilAgent.primes.attractivite,
      null,
      null,
      ["input-attractivite"],
    );
  }

  // ⏳ FIDÉLISATION
  if (profilAgent.primes.fidelisation > 0) {
    ajouterLigne(
      "203001",
      "PRIME DE FIDELISATION TERR.",
      profilAgent.primes.fidelisation,
      null,
      null,
      ["input-fidelisation"],
    );
  }

  let montantSFT = 0;
  if (profilAgent.enfants === 1) montantSFT = 2.29;
  else if (profilAgent.enfants >= 2) {
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
  montantSFT = Math.max(
    0,
    montantSFT - arrondir((montantSFT / 30) * joursRetenus),
  );

  const retenuePC = arrondir(
    baseTraitementReel * baseDonnees.constantes.taux_retenue_pc,
  );
  const retenuePcNbi = arrondir(
    baseNbiReelle * baseDonnees.constantes.taux_retenue_pc,
  );

  const baseRafp = Math.min(
    totalPrimesSoumises,
    baseSoumisePC * baseDonnees.constantes.plafond_rafp,
  );
  const cotisationRafp = arrondir(baseRafp * baseDonnees.constantes.taux_rafp);

  const ristIsqReel = profilAgent.primes.rist_lic_isq - absRistIsq;
  const retenueIsq = arrondir(
    ristIsqReel * baseDonnees.constantes.taux_retenue_isq,
  );

  const transfertPrimesBase = baseDonnees.constantes.transfert_primes_points;
  const transfertPrimes = Math.max(
    0,
    transfertPrimesBase - arrondir((transfertPrimesBase / 30) * joursRetenus),
  );

  const elementsSoumisCsg =
    baseSoumisePC + totalPrimesSoumises + psc + montantSFT;
  const deductionsBaseCsg = transfertPrimes + retenueIsq;
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

  const routageModal = {
    102000: { cible: "panel-residence", titre: "Zone de Résidence" },
    201958: {
      cible: "panel-rist-fonctions",
      titre: "Ristourne Part Fonctions",
    },
    201959: {
      cible: "panel-rist-experience",
      titre: "Ristourne Part Expérience",
    },
    201960: {
      cible: "panel-rist-isq-licence",
      titre: "Ristourne Part LIC-ISQ",
    },
    201961: {
      cible: "panel-rist-isq-complement",
      titre: "Ristourne CPLT Part LIC-ISQ",
    },
    201962: {
      cible: "panel-rist-isq-majoration",
      titre: "Majoration Complément ISQ",
    },
    200176: { cible: "panel-nuits", titre: "Travail de Nuit & Soirées" },
    200041: { cible: "panel-fmd", titre: "Forfait Mobilités" },
    202485: { cible: "panel-primes", titre: "Primes Exceptionnelles" },
    203001: { cible: "panel-fidelisation", titre: "Prime de Fidélisation" },
    203002: { cible: "panel-attractivite", titre: "Attractivité Géographique" },
    604958: { cible: "panel-absences", titre: "Absences et Carence" },
    604959: { cible: "panel-absences", titre: "Absences et Carence" },
    558000: { cible: "panel-impots", titre: "Prélèvement à la Source" },
    202206: { cible: "panel-csg", titre: "Indemnité Compensatrice CSG" },
    202354: { cible: "panel-psc", titre: "Participation à la PSC" },
    202558: {
      cible: "panel-ott",
      titre: "Organisation du Travail (Protocole)",
    },
    202559: {
      cible: "panel-ott",
      titre: "Organisation du Travail (Protocole)",
    },
    202560: {
      cible: "panel-ott",
      titre: "Organisation du Travail (Protocole)",
    },
  };

  function ajouterLigne(
    code,
    libelle,
    aPayer,
    aDeduire,
    pourInfo,
    inputsAReset = null,
    tooltipMontant = null,
    customId = null,
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

    if (customId) {
      tr.id = customId;
    } else if (code) {
      tr.id = `row-${code}`;
    }

    if (routageModal[code]) {
      tr.className = "clickable-row";
      tr.title = "Cliquez pour modifier";
      tr.onclick = () =>
        ouvrirModal(routageModal[code].cible, routageModal[code].titre);
    } else if (libelle.includes("TAUX PERSONNALISE")) {
      tr.className = "clickable-row";
      tr.onclick = () => ouvrirModal("panel-impots", "Prélèvement à la Source");
    }

    let croixEffacer = "";
    if (inputsAReset) {
      const idsStr = JSON.stringify(inputsAReset).replace(/"/g, "'");
      croixEffacer = `<span class="delete-btn" title="Retirer cet élément" onclick="window.effacerValeurs(event, ${idsStr})">✖</span>`;
    }

    const formatMontantCellule = (valeur) => {
      if (valeur === null || valeur === undefined || valeur === 0) return "";
      const texteFormate = formaterMontant(valeur);
      if (tooltipMontant) {
        return `<span title="${tooltipMontant}" style="cursor: help; border-bottom: 1px dotted var(--dgfip-medium);">${texteFormate}</span>`;
      }
      return texteFormate;
    };

    tr.innerHTML = `
        <td class="col-code">${code || ""}</td>
        <td class="col-libelle label${extraClass}"><span>${libelle}</span>${croixEffacer} ${euroSymbole}</td>
        <td class="col-amount">${formatMontantCellule(aPayer)}</td>
        <td class="col-amount">${formatMontantCellule(aDeduire)}</td>
        <td class="col-amount">${formatMontantCellule(pourInfo)}</td>
    `;
    tbody.appendChild(tr);
  }

  // --- DESSIN DES LIGNES ---
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
    const baseTotaleDeduction =
      traitementBrut +
      montantNbi +
      indemniteResidence +
      profilAgent.primes.rist_fonctions +
      profilAgent.primes.rist_exper_prof +
      profilAgent.primes.rist_lic_isq +
      profilAgent.primes.rist_cplt_lic_isq +
      profilAgent.primes.rist_maj_isq +
      profilAgent.primes.ind_compensatrice_csg;
    ajouterLigne(
      "604958",
      `SERVICE NON FAIT / ABSENCE (${joursAbs} J)`,
      null,
      null,
      totalAbsenceDeduction,
      ["input-greve", "input-carence", "input-maladie-90", "input-maladie-50"],
      genererTooltipAbsence(baseTotaleDeduction),
    );
  }

  ajouterLigne("101000", "TRAITEMENT BRUT", traitementBrut, null, null);

  if (montantNbi > 0) {
    ajouterLigne("101070", "TRAITEMENT BRUT N.B.I.", montantNbi, null, null);
    if (joursAbs > 0) {
      ajouterLigne(
        "101070",
        "TRAITEMENT BRUT N.B.I.",
        -absenceNbi,
        null,
        null,
        null,
        genererTooltipAbsence(montantNbi),
      );
      ajouterLigne(
        "",
        `&nbsp;&nbsp;&nbsp;&nbsp;${ligneDetailAbsence}`,
        null,
        null,
        null,
      );
    }
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

  if (nuit > 0)
    ajouterLigne("200176", "IND. TRAVAIL DE NUIT", nuit, null, null, [
      "input-nuit-n",
      "input-nuit-s2",
    ]);
  if (profilAgent.primes.forfait_mobilites > 0)
    ajouterLigne(
      "200041",
      "FORF. MOBILITES DURABLES",
      profilAgent.primes.forfait_mobilites,
      null,
      null,
      ["input-fmd"],
    );

  ajouterLigne(
    "201958",
    "RIST PART FONCTIONS",
    profilAgent.primes.rist_fonctions,
    null,
    null,
  );
  if (joursAbs > 0) {
    ajouterLigne(
      "201958",
      "RIST PART FONCTIONS",
      -absRistFct,
      null,
      null,
      null,
      genererTooltipAbsence(profilAgent.primes.rist_fonctions),
    );
    ajouterLigne(
      "",
      `&nbsp;&nbsp;&nbsp;&nbsp;${ligneDetailAbsence}`,
      null,
      null,
      null,
    );
  }

  ajouterLigne(
    "201959",
    "RIST PART EXPER. PROF.",
    profilAgent.primes.rist_exper_prof,
    null,
    null,
  );
  if (joursAbs > 0) {
    ajouterLigne(
      "201959",
      "RIST PART EXPER. PROF.",
      -absRistExp,
      null,
      null,
      null,
      genererTooltipAbsence(profilAgent.primes.rist_exper_prof),
    );
    ajouterLigne(
      "",
      `&nbsp;&nbsp;&nbsp;&nbsp;${ligneDetailAbsence}`,
      null,
      null,
      null,
    );
  }

  ajouterLigne(
    "201960",
    "RIST PART LIC-ISQ (ICNA)",
    profilAgent.primes.rist_lic_isq,
    null,
    null,
  );
  if (joursAbs > 0) {
    ajouterLigne(
      "201960",
      "RIST PART LIC-ISQ (ICNA)",
      -absRistIsq,
      null,
      null,
      null,
      genererTooltipAbsence(profilAgent.primes.rist_lic_isq),
    );
    ajouterLigne(
      "",
      `&nbsp;&nbsp;&nbsp;&nbsp;${ligneDetailAbsence}`,
      null,
      null,
      null,
    );
  }

  ajouterLigne(
    "201961",
    "RIST CPLT PART LIC-ISQ",
    profilAgent.primes.rist_cplt_lic_isq,
    null,
    null,
  );
  if (joursAbs > 0) {
    ajouterLigne(
      "201961",
      "RIST CPLT PART LIC-ISQ",
      -absRistCplt,
      null,
      null,
      null,
      genererTooltipAbsence(profilAgent.primes.rist_cplt_lic_isq),
    );
    ajouterLigne(
      "",
      `&nbsp;&nbsp;&nbsp;&nbsp;${ligneDetailAbsence}`,
      null,
      null,
      null,
    );
  }

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
      "MAJORATION CPLT ISQ",
      -absRistMaj,
      null,
      null,
      null,
      genererTooltipAbsence(profilAgent.primes.rist_maj_isq),
    );
    ajouterLigne(
      "",
      `&nbsp;&nbsp;&nbsp;&nbsp;${ligneDetailAbsence}`,
      null,
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
  if (joursAbs > 0) {
    ajouterLigne(
      "202206",
      "IND. COMPENSATRICE CSG",
      -absIndCsg,
      null,
      null,
      null,
      genererTooltipAbsence(profilAgent.primes.ind_compensatrice_csg),
    );
    ajouterLigne(
      "",
      `&nbsp;&nbsp;&nbsp;&nbsp;${ligneDetailAbsence}`,
      null,
      null,
      null,
    );
  }

  if (psc > 0) {
    ajouterLigne("202354", "PARTICIPATION A LA PSC", psc, null, null, [
      "psc-15",
      "psc-7",
      "psc-5",
    ]);
  }

  if (profilAgent.evenements.prime_performance > 0)
    ajouterLigne(
      "202485",
      "PR. PARTAGE PERFORMANCE",
      profilAgent.evenements.prime_performance,
      null,
      null,
      ["input-perf"],
    );
  if (profilAgent.evenements.ott_pv_globale > 0)
    ajouterLigne(
      "202558",
      "RIST ORGA TEMPS TRAVAIL (PV)",
      profilAgent.evenements.ott_pv_globale,
      null,
      null,
      ["pv-globale"],
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
        "pf-opt1-plus-n1",
        "pf-opt1-plus-n2",
        "pf-opt2-1",
        "pf-opt2-2",
        "pf-opt2-bis",
        "pf-opt4",
        "pf-opt1-enac",
        "pf-opt1-plus-enac",
      ],
    );
  }
  if (profilAgent.evenements.ott_pv_opt32 > 0)
    ajouterLigne(
      "202560",
      "RIST ORGA TEMPS TRAVAIL (PV OPT 3-1 / 3-2)",
      profilAgent.evenements.ott_pv_opt32,
      null,
      null,
      ["pv-opt32"],
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

  majPreview("preview-ott-pf", profilAgent.evenements.ott_pf);
  majPreview(
    "preview-ott-pv",
    profilAgent.evenements.ott_pv_globale + profilAgent.evenements.ott_pv_opt32,
  );

  // Charges
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
      `PREC. CARENCE REM. PR.`,
      null,
      absenceTraitement,
      null,
      null,
      genererTooltipAbsence(traitementBrut),
    );
    ajouterLigne(
      "604959",
      `PREC. CARENCE IND. RESID.`,
      null,
      absenceResidence,
      null,
      null,
      genererTooltipAbsence(indemniteResidence),
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
  let netImposableFinal = Math.max(0, netImposable);
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
    null,
    null,
    "row-taux-impot",
  );

  const trAjout = document.createElement("tr");
  trAjout.className = "add-row";
  trAjout.innerHTML = `<td colspan="5"> + AJOUTER OU MODIFIER UN ÉLÉMENT VARIABLE (Options protocolaires, Absences, Indemnité de Nuit...) </td>`;
  trAjout.onclick = () =>
    ouvrirModal("panel-menu-ajout", "Que voulez-vous ajouter ?");
  tbody.appendChild(trAjout);

  const trRessort = document.createElement("tr");
  trRessort.style.backgroundColor = "white";
  trRessort.id = "ressort-magique";
  trRessort.innerHTML = `
        <td style="border-right: 1px solid var(--dgfip-light); height: 100%;"></td>
        <td style="border-right: 1px solid var(--dgfip-light);"></td>
        <td style="border-right: 1px solid var(--dgfip-light);"></td>
        <td style="border-right: 1px solid var(--dgfip-light);"></td>
        <td></td>
  `;
  tbody.appendChild(trRessort);

  const netFinal = Math.max(0, arrondir(netAPayerAvantImpot - impotSource));
  const coutTotalEmployeur = arrondir(
    totalAPayer + totalPatronal - transfertPrimes,
  );

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
  document.getElementById("ui-net-a-payer").textContent =
    (netFinal === 0 ? "0,00" : formaterMontant(netFinal)) + " €";

  const netImposableAffichage = Math.max(0, netImposable);
  document.getElementById("ui-net-imposable").textContent =
    netImposableAffichage === 0
      ? "0,00"
      : formaterMontant(netImposableAffichage);

  requestAnimationFrame(() => {
    document.querySelectorAll(".ligne-fantome").forEach((el) => el.remove());

    const ressort = document.getElementById("ressort-magique");
    if (ressort) {
      const espaceVide = ressort.getBoundingClientRect().height;
      const hauteurLigne = 18;

      if (espaceVide > hauteurLigne) {
        const nbLignes = Math.floor(espaceVide / hauteurLigne);
        for (let i = 0; i < nbLignes; i++) {
          const tr = document.createElement("tr");
          tr.className = "ligne-fantome";
          tr.innerHTML = `
                  <td style="border-right: 1px solid var(--dgfip-light);">&nbsp;</td>
                  <td style="border-right: 1px solid var(--dgfip-light);">&nbsp;</td>
                  <td style="border-right: 1px solid var(--dgfip-light);">&nbsp;</td>
                  <td style="border-right: 1px solid var(--dgfip-light);">&nbsp;</td>
                  <td>&nbsp;</td>
              `;
          tbody.insertBefore(tr, ressort);
        }
      }
    }

    if (window.isTourActive && window.tourObj) {
      const state = window.tourObj.getState();
      const currentStep = state ? state.activeIndex : 0;
      window.tourObj.destroy();

      setTimeout(() => {
        window.lancerVisiteGuidee(currentStep);
      }, 50);
    }
  });
}

window.onload = initialiserApplication;

// =========================================
// VISITE GUIDÉE (Driver.js)
// =========================================
window.lancerVisiteGuidee = function (startStep = 0) {
  window.isTourActive = true;
  const driver = window.driver.js.driver;

  window.tourObj = driver({
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
          description:
            "Bienvenue ! Commencez par définir votre grade, votre échelon, vos enfants à charge et la NBI pour initialiser votre base de traitement.",
          side: "bottom",
          align: "start",
        },
      },
      {
        element: "#row-201958",
        popover: {
          title: "2. Une paie sur-mesure",
          description:
            "Le tableau est interactif ! Cliquez sur n'importe quelle ligne de prime (comme la RIST ou l'ISQ) pour ajuster les valeurs selon votre centre.",
          side: "bottom",
          align: "start",
        },
      },
      {
        element: "#row-202206",
        popover: {
          title: "3. N'oubliez pas la CSG !",
          description:
            "Attention : l'Indemnité Compensatrice CSG est propre à chaque agent. Pensez bien à cliquer sur cette ligne pour saisir votre montant exact (indiqué sur votre vraie fiche).",
          side: "top",
          align: "start",
        },
      },
      {
        element: "#row-taux-impot",
        popover: {
          title: "4. Prélèvement à la Source",
          description:
            "Il est essentiel de bien régler votre taux d'imposition personnalisé pour avoir un Net à Payer réaliste. Cliquez ici pour le modifier.",
          side: "top",
          align: "start",
        },
      },
      {
        element: ".add-row",
        popover: {
          title: "5. Les éléments variables",
          description:
            "C'est ici que vous pourrez ajouter les options protocolaires, vos forfaits mobilités, nuits travaillées ou vos jours d'absence.",
          side: "top",
          align: "center",
        },
      },
      {
        element: ".pay-table-foot",
        popover: {
          title: "6. Le Verdict",
          description:
            "Vos charges, votre Net Social et votre Net à Payer se mettront à jour instantanément à chaque modification. Bonne simulation !",
          side: "top",
          align: "end",
        },
      },
    ],
  });

  window.tourObj.drive(startStep);
};
