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

    document
      .getElementById("input-opt-var-type")
      .addEventListener("input", calculerPartVariableOtt);
    document
      .getElementById("input-opt-var-coeff")
      .addEventListener("input", calculerPartVariableOtt);

    calculerPaie();
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

function calculerPartVariableOtt() {
  const type = document.getElementById("input-opt-var-type").value;
  const coeff =
    parseFloat(document.getElementById("input-opt-var-coeff").value) || 0;
  let resultat = 0;

  if (type === "opt1_l1_6")
    resultat =
      baseDonnees.rist.flexibilite_options_variables.opt1_l1_6 *
      Math.max(0, coeff - 4);
  else if (type === "opt1_cdg")
    resultat =
      baseDonnees.rist.flexibilite_options_variables.opt1_cdg *
      Math.max(0, coeff - 4);
  else if (type === "opt1_l7_11")
    resultat =
      baseDonnees.rist.flexibilite_options_variables.opt1_l7_11 *
      Math.max(0, coeff - 4);
  else if (type === "opt1_plus")
    resultat = baseDonnees.rist.flexibilite_options_variables.opt1_plus * coeff;
  else if (type === "opt2_2")
    resultat =
      baseDonnees.rist.flexibilite_options_variables.opt2_2 *
      Math.max(0, coeff - 1);

  if (type !== "none")
    document.getElementById("input-rist-orga").value = resultat.toFixed(2);

  calculerPaie();
}

function getProfilDepuisInterface() {
  return {
    grade:
      document.getElementById("input-grade")?.value || "ING.DIV. CONT.NAV.AE",
    echelon: document.getElementById("input-echelon")?.value || "",
    enfants: parseInt(document.getElementById("input-enfants")?.value) || 0,
    zone: document.getElementById("input-zone")?.value || "Zone 1",
    taux_pas:
      parseFloat(document.getElementById("input-pas")?.value) / 100 || 0,
    points_nbi: document.getElementById("input-nbi-checkbox")?.checked ? 55 : 0,

    evenements: {
      nuits: parseInt(document.getElementById("input-nuit-n")?.value) || 0,
      soirees: parseInt(document.getElementById("input-nuit-s2")?.value) || 0,
      jours_absence:
        parseInt(document.getElementById("input-absence")?.value) || 0,
      prime_performance:
        parseFloat(document.getElementById("input-perf")?.value) || 0,
      rist_orga:
        parseFloat(document.getElementById("input-rist-orga")?.value) || 0,
      fidelisation:
        parseFloat(document.getElementById("input-fidelisation")?.value) || 0,
      geographique:
        parseFloat(document.getElementById("input-geographique")?.value) || 0,
      // On additionne le champ manuel et les cases cochées
      pf_options:
        (parseFloat(document.getElementById("input-pf-manuel")?.value) || 0) +
        (document.getElementById("input-pf-opt1")?.checked
          ? parseFloat(document.getElementById("input-pf-opt1").value)
          : 0) +
        (document.getElementById("input-pf-opt2")?.checked
          ? parseFloat(document.getElementById("input-pf-opt2").value)
          : 0),
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
}

// Remet les valeurs à zéro quand on clique sur la petite croix
window.effacerValeurs = function (event, inputIds) {
  event.stopPropagation();
  inputIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      if (el.tagName === "SELECT") el.value = "none";
      else if (el.type === "checkbox")
        el.checked = false; // NOUVEAU : gère les cases à cocher
      else el.value = 0;
    }
  });
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

  const psc = baseDonnees.constantes.participation_psc;
  const nuit = arrondir(
    8.73 * profilAgent.evenements.nuits + 0.97 * profilAgent.evenements.soirees,
  );
  // Mise à jour de l'aperçu en direct dans le menu des nuits
  const previewNuits = document.getElementById("preview-nuits");
  if (previewNuits) previewNuits.textContent = formaterMontant(nuit);
  const joursAbs = profilAgent.evenements.jours_absence;

  // -- CALCUL DES ABSENCES --
  const absenceTraitement = arrondir((traitementBrut / 30) * joursAbs);
  const absenceNbi = arrondir((montantNbi / 30) * joursAbs);
  const absenceResidence = arrondir((indemniteResidence / 30) * joursAbs);

  const absRistFct = arrondir(
    (profilAgent.primes.rist_fonctions / 30) * joursAbs,
  );
  const absRistExp = arrondir(
    (profilAgent.primes.rist_exper_prof / 30) * joursAbs,
  );
  const absRistIsq = arrondir(
    (profilAgent.primes.rist_lic_isq / 30) * joursAbs,
  );
  const absRistCplt = arrondir(
    (profilAgent.primes.rist_cplt_lic_isq / 30) * joursAbs,
  );
  const absRistMaj = arrondir(
    (profilAgent.primes.rist_maj_isq / 30) * joursAbs,
  );
  const absIndCsg = arrondir(
    (profilAgent.primes.ind_compensatrice_csg / 30) * joursAbs,
  );

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
    profilAgent.evenements.geographique;
  +profilAgent.evenements.pf_options;

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
  const transfertPrimes = baseDonnees.constantes.transfert_primes_points;

  // -- 4. CSG / CRDS --
  const elementsSoumisCsg =
    baseSoumisePC + totalPrimesSoumises + psc + montantSFT;
  const deductionsBaseCsg = transfertPrimes + retenueIsq;
  const baseCsgCrdsExacte =
    (elementsSoumisCsg - deductionsBaseCsg) *
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
    } else if (code === "202558") {
      estCliquable = true;
      cibles = "panel-ott";
      titreModal = "Orga Temps Travail";
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
      ["input-absence"],
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

  if (profilAgent.primes.rist_maj_isq > 0) {
    ajouterLigne(
      "201962",
      "MAJORATION CPLT ISQ",
      profilAgent.primes.rist_maj_isq,
      null,
      null,
    );
    if (joursAbs > 0)
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
  if (profilAgent.evenements.rist_orga > 0)
    ajouterLigne(
      "202558",
      "RIST ORGA TEMPS TRAVAIL",
      profilAgent.evenements.rist_orga,
      null,
      null,
      ["input-rist-orga", "input-opt-var-type", "input-opt-var-coeff"],
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

  // -- LIGNE PF OPTIONS ET LIVE FEEDBACK --
  const previewPf = document.getElementById("preview-pf");
  if (previewPf)
    previewPf.textContent = formaterMontant(profilAgent.evenements.pf_options);

  if (profilAgent.evenements.pf_options > 0) {
    // La ligne cliquable avec sa petite croix rouge pour tout effacer d'un coup
    ajouterLigne(
      "202559",
      "RIST ORGA TEMPS TRAVAIL (PF)",
      profilAgent.evenements.pf_options,
      null,
      null,
      ["input-pf-manuel", "input-pf-opt1", "input-pf-opt2"],
    );
  }

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
  const impotSource = arrondir(netImposable * profilAgent.taux_pas);

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

  const netFinal = arrondir(netAPayerAvantImpot - impotSource);
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
  document.getElementById("ui-net-a-payer").textContent =
    formaterMontant(netFinal) + " €";
  document.getElementById("ui-net-imposable").textContent =
    formaterMontant(netImposable);
}

window.onload = initialiserApplication;
