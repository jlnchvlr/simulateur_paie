let baseDonnees = {};

async function initialiserApplication() {
    try {
        const reponse = await fetch('data.json');
        if (!reponse.ok) throw new Error("Fichier introuvable.");
        baseDonnees = await reponse.json();

        const inputs = document.querySelectorAll('.sidebar select, .sidebar input');
        inputs.forEach(input => input.addEventListener('input', calculerPaie));

        calculerPaie();
    } catch (erreur) {
        console.error("Erreur:", erreur);
    }
}

function getProfilDepuisInterface() {
    const fonctionChoisie = document.getElementById('input-fonction').value;
    const experienceChoisie = document.getElementById('input-experience').value;
    const statutIsq = document.getElementById('input-isq').value;

    return {
        grade: document.getElementById('input-grade').value,
        echelon: document.getElementById('input-echelon').value,
        zone: document.getElementById('input-zone').value,
        taux_pas: parseFloat(document.getElementById('input-pas').value) / 100 || 0,
        
        evenements: {
            indemnites_nuit: parseFloat(document.getElementById('input-nuit').value) || 0,
            jours_absence: parseInt(document.getElementById('input-absence').value) || 0,
            prime_performance: parseFloat(document.getElementById('input-perf').value) || 0,
            rist_orga: parseFloat(document.getElementById('input-rist-orga').value) || 0
        },
        
        primes: {
            forfait_mobilites: parseFloat(document.getElementById('input-fmd').value) || 0,
            rist_fonctions: baseDonnees.rist.fonctions[fonctionChoisie] || 0,
            rist_exper_prof: baseDonnees.rist.experience[experienceChoisie] || 0,
            rist_lic_isq: baseDonnees.rist.isq[statutIsq].licence || 0,
            rist_cplt_lic_isq: baseDonnees.rist.isq[statutIsq].complement || 0,
            ind_compensatrice_csg: baseDonnees.rist.ind_csg
        }
    };
}

function formaterMontant(montant) {
    if (montant === null || montant === undefined || montant === 0 || isNaN(montant)) return "";
    return montant.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function arrondir(valeur) {
    return Math.round(valeur * 100) / 100;
}

function calculerPaie() {
    const profilAgent = getProfilDepuisInterface();
    let totalAPayer = 0;
    let totalADeduire = 0;

    const indice = baseDonnees.grilles_icna[profilAgent.grade][profilAgent.echelon]?.indice || 0;
    const traitementBrut = arrondir(indice * baseDonnees.constantes.valeur_point_mensuel);
    const indemniteResidence = Math.floor(traitementBrut * baseDonnees.zones_residence[profilAgent.zone] * 100) / 100;
    const psc = baseDonnees.constantes.participation_psc;
    const nuit = profilAgent.evenements.indemnites_nuit;
    const joursAbs = profilAgent.evenements.jours_absence;
    
    const absenceTraitement = arrondir((traitementBrut / 30) * joursAbs);
    const absenceResidence = arrondir((indemniteResidence / 30) * joursAbs);
    
    const absRistFct = arrondir((profilAgent.primes.rist_fonctions / 30) * joursAbs);
    const absRistExp = arrondir((profilAgent.primes.rist_exper_prof / 30) * joursAbs);
    const absRistIsq = arrondir((profilAgent.primes.rist_lic_isq / 30) * joursAbs);
    const absRistCplt = arrondir((profilAgent.primes.rist_cplt_lic_isq / 30) * joursAbs);
    const absIndCsg = arrondir((profilAgent.primes.ind_compensatrice_csg / 30) * joursAbs);

    const baseTraitementReel = traitementBrut - absenceTraitement;
    const baseResidenceReelle = indemniteResidence - absenceResidence;
    
    const totalPrimesSoumises = baseResidenceReelle + nuit
                                + (profilAgent.primes.rist_fonctions - absRistFct)
                                + (profilAgent.primes.rist_exper_prof - absRistExp)
                                + (profilAgent.primes.rist_lic_isq - absRistIsq)
                                + (profilAgent.primes.rist_cplt_lic_isq - absRistCplt)
                                + (profilAgent.primes.ind_compensatrice_csg - absIndCsg)
                                + profilAgent.evenements.prime_performance 
                                + profilAgent.evenements.rist_orga;

    const retenuePC = arrondir(baseTraitementReel * baseDonnees.constantes.taux_retenue_pc);
    const baseRafp = Math.min(totalPrimesSoumises, baseTraitementReel * baseDonnees.constantes.plafond_rafp);
    const cotisationRafp = arrondir(baseRafp * baseDonnees.constantes.taux_rafp);
    
    const ristIsqReel = profilAgent.primes.rist_lic_isq - absRistIsq;
    const retenueIsq = arrondir(ristIsqReel * baseDonnees.constantes.taux_retenue_isq);
    const transfertPrimes = baseDonnees.constantes.transfert_primes_points;

    const elementsSoumisCsg = baseTraitementReel + totalPrimesSoumises + psc;
    const deductionsBaseCsg = transfertPrimes + retenueIsq;
    const baseCsgCrdsExacte = (elementsSoumisCsg - deductionsBaseCsg) * baseDonnees.constantes.assiette_csg_crds;
    
    const csgDeductible = arrondir(baseCsgCrdsExacte * baseDonnees.constantes.taux_csg_deductible);
    const csgNonDeductible = arrondir(baseCsgCrdsExacte * baseDonnees.constantes.taux_csg_non_deductible);
    const crds = arrondir(baseCsgCrdsExacte * baseDonnees.constantes.taux_crds);

    const patAllocFam = arrondir(baseTraitementReel * baseDonnees.taux_patronaux.alloc_familiale);
    const patAfMajor = arrondir(baseTraitementReel * baseDonnees.taux_patronaux.af_majoration);
    const patFnal = arrondir(baseTraitementReel * baseDonnees.taux_patronaux.fnal);
    const patCsa = arrondir(baseTraitementReel * baseDonnees.taux_patronaux.csa);
    const patMaladie = arrondir(baseTraitementReel * baseDonnees.taux_patronaux.maladie);
    const patPensions = arrondir(baseTraitementReel * baseDonnees.taux_patronaux.pensions_civiles);
    const patAti = arrondir(baseTraitementReel * baseDonnees.taux_patronaux.ati);
    const patMobilite = arrondir(baseTraitementReel * baseDonnees.taux_patronaux.versement_mobilite);
    const patRafp = cotisationRafp; 
    const totalPatronal = patAllocFam + patAfMajor + patFnal + patCsa + patMaladie + patPensions + patAti + patMobilite + patRafp;

    document.getElementById('ui-grade').textContent = profilAgent.grade;
    document.getElementById('ui-echelon').textContent = profilAgent.echelon;
    document.getElementById('ui-indice').textContent = "0" + (indice || "000");

    const tbody = document.getElementById('lignes-paie');
    tbody.innerHTML = ''; 

    // Injection normale sans hacks bizarres
    function ajouterLigne(code, libelle, aPayer, aDeduire, pourInfo) {
        if (aPayer) totalAPayer += aPayer;
        if (aDeduire) totalADeduire += aDeduire;

        let extraClass = (code === "011100" || code === "011300") ? " font-large" : "";
        let euroSymbole = (aPayer || aDeduire || pourInfo) ? `<span style="float: right; font-weight: normal; color: #555;">€</span>` : "";

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="col-code">${code}</td>
            <td class="col-libelle label${extraClass}">
                <span>${libelle}</span> ${euroSymbole}
            </td>
            <td class="col-amount">${formaterMontant(aPayer)}</td>
            <td class="col-amount">${formaterMontant(aDeduire)}</td>
            <td class="col-amount">${formaterMontant(pourInfo)}</td>
        `;
        tbody.appendChild(tr);
    }

    ajouterLigne("101000", "TRAITEMENT BRUT", traitementBrut, null, null);
    ajouterLigne("101050", "RETENUE PC", null, retenuePC, null);
    ajouterLigne("102000", "INDEMNITE DE RESIDENCE", indemniteResidence, null, null);
    
    if (nuit > 0) ajouterLigne("200176", "IND. TRAVAIL DE NUIT", nuit, null, null);
    ajouterLigne("200041", "FORF. MOBILITES DURABLES", profilAgent.primes.forfait_mobilites, null, null);
    
    ajouterLigne("201958", "RIST PART FONCTIONS", profilAgent.primes.rist_fonctions, null, null);
    if (joursAbs > 0) ajouterLigne("201958", "RIST PART FONCTIONS (ABS)", -absRistFct, null, null);

    ajouterLigne("201959", "RIST PART EXPER. PROF.", profilAgent.primes.rist_exper_prof, null, null);
    if (joursAbs > 0) ajouterLigne("201959", "RIST PART EXPER. PROF. (ABS)", -absRistExp, null, null);

    ajouterLigne("201960", "RIST PART LIC-ISQ (ICNA)", profilAgent.primes.rist_lic_isq, null, null);
    if (joursAbs > 0) ajouterLigne("201960", "RIST PART LIC-ISQ (ABS)", -absRistIsq, null, null);

    ajouterLigne("201961", "RIST CPLT PART LIC-ISQ", profilAgent.primes.rist_cplt_lic_isq, null, null);
    if (joursAbs > 0) ajouterLigne("201961", "RIST CPLT PART LIC-ISQ (ABS)", -absRistCplt, null, null);

    ajouterLigne("202206", "IND. COMPENSATRICE CSG", profilAgent.primes.ind_compensatrice_csg, null, null);
    if (joursAbs > 0) ajouterLigne("202206", "IND. COMPENSATRICE CSG (ABS)", -absIndCsg, null, null);

    ajouterLigne("202354", "PARTICIPATION A LA PSC", psc, null, null);
    
    if (profilAgent.evenements.prime_performance > 0) {
        ajouterLigne("202485", "PR. PARTAGE PERFORMANCE", profilAgent.evenements.prime_performance, null, null);
    }
    if (profilAgent.evenements.rist_orga > 0) {
        ajouterLigne("202558", "RIST ORGA TEMPS TRAVAIL", profilAgent.evenements.rist_orga, null, null);
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
        ajouterLigne("604958", "PREC. CARENCE REM. PR.", null, absenceTraitement, null);
        ajouterLigne("604959", "PREC. CARENCE IND. RESID.", null, absenceResidence, null);
    }

    ajouterLigne("604970", "TRANSFERT PRIMES / POINTS", null, transfertPrimes, null);
    ajouterLigne("751095", "24,6% ISQ", null, retenueIsq, null);

    const netAPayerAvantImpot = arrondir(totalAPayer - totalADeduire);
    ajouterLigne("", "", null, null, null); 
    ajouterLigne("011100", "NET A PAYER AVANT IMPOT SUR LE REVENU", null, null, netAPayerAvantImpot);

    const netSocial = arrondir(netAPayerAvantImpot - profilAgent.primes.forfait_mobilites - psc + retenueIsq);
    ajouterLigne("011300", "MONTANT NET SOCIAL", null, null, netSocial);

    const netImposable = netAPayerAvantImpot + csgNonDeductible + crds - profilAgent.primes.forfait_mobilites;
    const impotSource = arrondir(netImposable * profilAgent.taux_pas);
    
    ajouterLigne("558000", `IMPOT SUR LE REVENU PRELEVE A LA SOURCE`, null, impotSource, null);
    ajouterLigne("", `(TAUX PERSONNALISE ${formaterMontant(profilAgent.taux_pas * 100)}%)`, null, null, null);

    // =========================================================
    // LA SOLUTION MAGIQUE : LE RESSORT QUI ABSORBE LE VIDE
    // =========================================================
    const trRessort = document.createElement('tr');
    trRessort.style.backgroundColor = "white"; // Empêche le grisé
    trRessort.innerHTML = `
        <td style="border-right: 1px solid var(--dgfip-light); height: 100%;"></td>
        <td style="border-right: 1px solid var(--dgfip-light);"></td>
        <td style="border-right: 1px solid var(--dgfip-light);"></td>
        <td style="border-right: 1px solid var(--dgfip-light);"></td>
        <td></td>
    `;
    tbody.appendChild(trRessort);

    // =========================================================

    const netFinal = arrondir(netAPayerAvantImpot - impotSource);
    const coutTotalEmployeur = arrondir(totalAPayer + totalPatronal - transfertPrimes);
    const baseSS = baseTraitementReel;

    document.getElementById('ui-total-a-payer').textContent = formaterMontant(arrondir(totalAPayer));
    document.getElementById('ui-total-a-deduire').textContent = formaterMontant(arrondir(totalADeduire));
    document.getElementById('ui-charges-patronales').textContent = formaterMontant(totalPatronal);
    document.getElementById('ui-cout-employeur').textContent = formaterMontant(coutTotalEmployeur);
    document.getElementById('ui-net-a-payer').textContent = formaterMontant(netFinal) + " €";
    document.getElementById('ui-base-ss').textContent = formaterMontant(baseSS);
    document.getElementById('ui-net-imposable').textContent = formaterMontant(netImposable);
}

window.onload = initialiserApplication;