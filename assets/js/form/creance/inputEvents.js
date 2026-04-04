/*
 * Calcul des échéances :
 * - Signification Contrainte
 * - Fin de contrat OSR
 */
let dateEnvoiHuissier = document.getElementById('contentieuse_tex_dateEnvoiHuissierTEX');
let dateSignifContrainte = document.getElementById('contentieuse_tex_dateSignifContrainte');
let dateFinContratOsr = document.getElementById("contentieuse_pdr_dateFinContratOsr")

if (dateEnvoiHuissier != null && dateSignifContrainte != null && dateFinContratOsr != null) {
    dateEnvoiHuissier.addEventListener('change', calculEcheanceSignifContr);
    dateSignifContrainte.addEventListener('change', calculEcheanceSignifContr);
    dateFinContratOsr.addEventListener('change', calculEcheanceFinContrat);
    document.getElementById('anv_dateProposition').addEventListener('change', function () {
        let typeAnv = $('#anv_typeanvid');
        if (typeAnv.val() === '') {
            typeAnv.val(1);
        }
    })

    if (dateEnvoiHuissier.value !== undefined) {
        dateEnvoiHuissier.addEventListener('keyup blur', calculEcheanceSignifContr);
    }
    if (dateSignifContrainte.value !== undefined) {
        dateSignifContrainte.addEventListener('keyup blur', calculEcheanceSignifContr);
    }
    if (dateFinContratOsr.value !== undefined) {
        dateFinContratOsr.addEventListener('keyup blur', calculEcheanceFinContrat);
    }
}

/*
 * Gestion de l'input Date Biennale prévue
 */
let dateBiennalePrevueUser = document.getElementById('contentieuse_tex_dateBiennalePrevueUser');
if (dateBiennalePrevueUser != null) {
    dateBiennalePrevueUser.addEventListener('change', function () {
        let dateValue = moment(this.value, "YYYY-MM-DD", true)
        let maxDateValue = document.getElementById('max_date_envoi_biennale').value;

        if (dateValue.isValid() === true) {
            // Récuperartion de la date max à ne pas depasser : max_date_envoi_biennale se trouve dans le controller
            let dateMaxEnvoiBiennale = moment(maxDateValue, "YYYY-MM-DD", true)
            // Verifier si la date depasse 600 jours
            if (moment.duration(dateMaxEnvoiBiennale.diff(dateValue)).as('minutes') < 0) {
                // Si c'est le cas on vite le champs et on demande à l'utilisateur de recommencer
                this.value = '';
                alert(`La relance biennale prévue ne doit pas dépasser 600 jours à partir de la date du jour. La date à ne pas dépasser est : ` + maxDateValue)
            }
        }
    });
}

/* Gestion de l'input Date Visa AR (contrainte) */
const dateVisaAR = document.getElementById('contentieuse_tex_dateVisaArContrainte');
const dateSendConstraint = document.getElementById('contentieuse_tex_dateenvoiele');

if (dateVisaAR !== null && dateSendConstraint !== null) {
    let sendDelay = document.getElementById('delai_envoi_biennale').value
    let scheduledDateBiennale = document.getElementById('contentieuse_tex_dateBiennalePrevueUser')

    dateVisaAR.addEventListener('change', () => {
        let dateSendConstraintValue = moment(dateSendConstraint.value, 'DD/MM/YYYY', true)
        if (dateSendConstraintValue.isValid()) {
            scheduledDateBiennale.value = dateSendConstraintValue.add(sendDelay, 'days').format('YYYY-MM-DD')
        }
    })
}

/*
 * Gestion de l'input RemiseDette Pourcent remise
 */
let pourcentRemise = document.getElementById('rdd_pourcentRemise');
if (pourcentRemise != null) {
    pourcentRemise.addEventListener('focus', function () {
        if (this.value === '') {
            this.value = '0,00';
        }
    });
}

/*
 * Gestion de la suspension
 */
let btnSuspendre = document.getElementById('btnSuspendre');
if (btnSuspendre != null) {
    if (document.getElementById('suspendue').value !== '0') {
        btnSuspendre.addEventListener('click', unsuspendCreance);
    } else {
        btnSuspendre.addEventListener('click', suspendCreance);
    }
}

/*
 * Ajout du mask monétaire sur les inputs concernés
 */
$(".inputCurrency").maskMoney({
    autoUnmask: true,
    suffix: ' €',
    decimal: ',',
    precision: 2,
    thousands: ' ',
    allowZero: false,
    allowNegative: false,
    showSymbol: true,
    symbolStay: true,
    defaultZero: false
});

let dateJugementHelp = document.getElementById('dateJugementHelp');
if (dateJugementHelp != null) {
    dateJugementHelp.addEventListener(
        'click',
        () => {
            alert('Lorsque la date de jugement est renseignée, cela entraînera l\'interruption des envois de courriers automatiques.')
        });
}

/*
 * Gestion des cases à cocher - CREANCE DOUTEUSE
 */
let passageDouteux = document.getElementById('anv_passageDouteux');
let passageNormal = document.getElementById('anv_passageNormal');

passageDouteux.addEventListener('change', checkDouteuxAndNormal)
passageNormal.addEventListener('change', checkDouteuxAndNormal)

function checkDouteuxAndNormal() {
    if (passageDouteux.checked === true && passageNormal.checked === true) {
        alert('Vous ne pouvez pas cocher les deux cases en même temps. Les deux cases vont être toutes les deux décochées.', 'Erreur', 'error')
        passageDouteux.checked = false;
        passageNormal.checked = false;
    }
}


/**
 * Calcul de l'échéance de signification Contrainte
 */
function calculEcheanceSignifContr()
{
    let dateEcheanceSignifContrainte = document.getElementById('contentieuse_tex_dateechsignifcont');

    if (dateSignifContrainte.value !== '') {
        dateEcheanceSignifContrainte.value = '';
        dateEcheanceSignifContrainte.disabled = true;
    } else {
        $.ajax({
            type: "POST",
            url: Routing.generate('date_induite_signification_contraine'),
            data: {
                dateenvoi: dateEnvoiHuissier.value
            },
            async: false,
            success: function (nouvelledate) {
                dateEcheanceSignifContrainte.value = nouvelledate;
                dateEcheanceSignifContrainte.disabled = false;
            },
            error: function () {
                alert('Anomalie lors de la génération de la date signification contrainte');
            },
            complete: function () {}
        });
    }
}

/**
 * Calcul des échéances de fin de contrat
 */
function calculEcheanceFinContrat() {
    $.ajax({
        type: "POST",
        url: Routing.generate('date_fin_contrat_fin_validite'),
        data: {
            dateFinContrat: dateFinContratOsr.value,
            creanceRegroupeeId: idCreanceRegroupee
        },
        async: true,
        success: function (nouvelledate) {
            document.getElementById('contentieuse_pdr_dateFinValiditeOsr').value = nouvelledate;
        },
        error: function () {
        },
        complete: function () {
        }
    });

    $.ajax({
        type: "POST",
        url: Routing.generate('date_induite_fin_contrat_date_echeance'),
        data: {
            dateFinContrat: dateFinContratOsr.value,
            creanceRegroupeeId: idCreanceRegroupee
        },
        async: true,
        success: function (nouvelledate) {
            document.getElementById('contentieuse_pdr_datefinvaliditesaisieecheance').value = nouvelledate;
        },
        error: function () {
        },
        complete: function () {
        }
    });
}

function verificationSuspension(callback) {
    const idCreance = $('#id_creance').val();

    $.ajax({
        type: 'GET',
        url: Routing.generate('verifier_suspension_creance', {id: idCreance}),
        dataType: 'json',
        success: function (response) {
            if (typeof callback === 'function') {
                callback(response);
            }
        },
    });
}

/**
 * Suspends la créance
 */
function suspendCreance() {
    verificationSuspension(function (resultat) {
        if (resultat.suspendue) {
            alert(`Cette créance est déjà suspendue pour ${resultat.motif}.`);

            const arretCourrierAuto = document.getElementById('arretCourrierAuto');
            if (arretCourrierAuto) {
                arretCourrierAuto.textContent = 'Suspendue pour ' + resultat.motif;
            }

            const btnSuspendre = document.getElementById('btnSuspendre');
            if (btnSuspendre) {
                if (resultat.motif === 'Paiement échelonné') {
                    btnSuspendre.remove();
                } else {
                    btnSuspendre.innerHTML = 'Dé-suspendre';
                    btnSuspendre.removeEventListener('click', suspendCreance);
                    btnSuspendre.addEventListener('click', unsuspendCreance);
                }
            }

            return;
        }

        let onglet = document.getElementsByClassName('active')[0];

        if (onglet.getAttribute('suspendable') === '1') {
            confirm('Les courriers automatiques de ce regroupement seront suspendus. Validez-vous cette action ?')
                .then(function (response) {
                    if (response) {
                        $.ajax({
                            type: "POST",
                            url: Routing.generate('creance_regroupee_suspension'),
                            data: {
                                id_motif: document.getElementsByName(onglet.id)[0].getAttribute('suspensionid'),
                                id_creance_regroupee: idCreanceRegroupee
                            },
                            async: true,
                            success: function () {
                                document.getElementById('arretCourrierAuto').innerHTML = 'Suspendue le ' + new Date().toLocaleDateString('fr-FR') + ' pour ' + onglet.innerHTML;
                                document.getElementById('btnSuspendre').innerHTML = 'Dé-suspendre';
                                document.getElementById('suspendue').value = '1';
                                document.getElementById('btnSuspendre').removeEventListener('click', suspendCreance);
                                document.getElementById('btnSuspendre').addEventListener('click', unsuspendCreance);
                            },
                            error: function (XMLHttpRequest, textStatus, errorThrown) {
                            },
                            complete: function (jqXHR, textStatus) {
                            }
                        });
                    }
                });
        } else {
            alert('Veuillez sélectionner un onglet pour lequel il est possible de suspendre les courriers automatiques.');
        }
    });
}

/**
 * Désuspends la créance
 */
function unsuspendCreance() {
    verificationSuspension(function (resultat) {
        if (resultat.suspendue && resultat.motif === 'Paiement échelonné') {
            alert(`Cette créance est déjà suspendue pour ${resultat.motif}.`);

            const arretCourrierAuto = document.getElementById('arretCourrierAuto');
            if (arretCourrierAuto) {
                arretCourrierAuto.textContent = 'Suspendue pour ' + resultat.motif;
            }

            const btnSuspendre = document.getElementById('btnSuspendre');
            if (btnSuspendre) {
                btnSuspendre.remove();
            }

            return;
        }

        confirm('Vous allez ré-activer les courriers automatiques.<br><br>Si vous validez, un courrier peut se générer immédiatement.<br>Pour que le courrier ne soit pas envoyé, il faut au préalable effectuer le report de l\'étape workflow via le suivi du workflow.<br><br>Validez-vous cette action ?', 'Confirmation de dé-suspension')
            .then(function (response) {
                if (response) {
                    $.ajax({
                        type: "POST",
                        url: Routing.generate('creance_regroupee_suspension'),
                        data: {
                            id_motif: 'null',
                            id_creance_regroupee: idCreanceRegroupee
                        },
                        async: true,
                        success: function () {
                            document.getElementById('arretCourrierAuto').innerHTML = 'Suspendre l\'envoi des courriers automatiques'
                            document.getElementById('btnSuspendre').innerHTML = 'Suspendre';
                            document.getElementById('suspendue').value = '0';

                            const btn = document.getElementById('btnSuspendre');
                            btn.removeEventListener('click', unsuspendCreance);
                            btn.addEventListener('click', suspendCreance);
                        },
                        error: function () {
                            alert('Une erreur est survenue lors de la désuspension.');
                        }
                    });
                }
            });
    });
}