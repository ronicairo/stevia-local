const idCreanceRegroupee = document.getElementById('id_creance_regroupee').value ?? 'noId';
let errorMessages = [];
let nbFormError = 0;

window.addEventListener('DOMContentLoaded', function () {
    let isInitialSuspended = document.getElementById('suspendue').value !== '0';

    const ongletsWrapper = document.querySelector('.scroll-onglets')
    const wrapperNavOnglets = document.querySelector(".wrapper-onglets")

    document.querySelectorAll(".wrapper-nav").forEach(navigation => {
        const leftArrow = navigation.parentNode.querySelector(".left-arrow")
        const rightArrow = navigation.parentNode.querySelector(".right-arrow")
        const scrollAmount = 600

        function updateArrows() {
            leftArrow.querySelector('i').style.opacity = navigation.scrollLeft > 0 ? "1" : "0.3";
            rightArrow.querySelector('i').style.opacity =
                navigation.scrollLeft + navigation.clientWidth < navigation.scrollWidth
                    ? "1"
                    : "0.3";
        }

        leftArrow.addEventListener("click", function () {
            navigation.scrollBy({ left: -scrollAmount, behavior: "smooth" });
        });

        rightArrow.addEventListener("click", function () {
            navigation.scrollBy({ left: scrollAmount, behavior: "smooth" });
        });

        navigation.addEventListener("scroll", updateArrows);
        updateArrows()
    })

    // Liste des onglets dans lesquels le bouton suspendre ne doit pas apparaître
    const ongletsSansSuspension = [
        'details_creance',
        'aide_memoire',
        'opposition_amiable',
        'npai',
        'commentaire',
        'bloc_note'
    ];

    function updateSuspendreButton(ongletId) {
        const btnSuspendre = document.getElementById('btnSuspendre');
        if (!btnSuspendre) return;

        if (ongletsSansSuspension.includes(ongletId)) {
            btnSuspendre.style.display = 'none';
        } else {
            btnSuspendre.style.display = '';
        }
    }

    const ongletActif = document.querySelector('.tab-nav.active');
    if (ongletActif) {
        updateSuspendreButton(ongletActif.id);
    }

    document.querySelectorAll('.tab-nav').forEach(tabNavItem => {
        tabNavItem.addEventListener('click', function () {
            ongletsWrapper.scrollTop = 0;
            $(this).tab('show');

            document.getElementsByName(this.id).forEach(form => {
                if (!form.classList.contains('toSubmit')) {
                    form.classList.add('toSubmit');
                }
            });

            updateSuspendreButton(this.id);
            saveTabsQuickAccess(idCreanceRegroupee, this.id);
        });
    });

    /**
     * Ajout de la classe toSubmit pour savoir quels onglets doivent être sauvegardés
     * Et on affiche le tab correspondant (nécessaire pour le déclenchement de l'event
     * par JS juste en dessous)
     */
    for (let tabNavItem of document.getElementsByClassName('tab-nav')) {
        tabNavItem.addEventListener('click', function() {
            ongletsWrapper.scrollTop = 0
            $(this).tab('show');

            for (let form of document.getElementsByName(this.id)) {
                form.className += form.classList.contains('toSubmit') ? '' : ' toSubmit';
            }

            saveTabsQuickAccess(idCreanceRegroupee, this.id);
        });
    }

    /**
     * On clique sur l'onglet correspondant à la valeur de l'input "onglet_initial"
     */
    let ongletQuickAccess = getTabsQuickAccess(idCreanceRegroupee);
    let initialOnglet = document.getElementById('onglet_initial').value;
    if (ongletQuickAccess !== 0) {
        initialOnglet = ongletQuickAccess;
    }
    if (initialOnglet !== undefined && initialOnglet !== '') {
        const tabInitial = document.getElementById(initialOnglet)
        tabInitial.click()
        wrapperNavOnglets.scrollBy({ behavior: "smooth", left: tabInitial.offsetLeft})
    }

    /**
     * Action lors du clic sur le bouton "Valider"
     */
    let btn_valider = document.getElementById('btn_valider');

    // Empêche la soumission par Entrée
    document.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && event.target.tagName.toLowerCase() !== 'textarea') {
            event.preventDefault();
            btn_valider.click();
        }
    });

    if (btn_valider !== null) {
        btn_valider.addEventListener('click', function() {
            let isNowSuspended = isCreanceSuspended();

            if (!isNowSuspended && isInitialSuspended) {
                confirm(
                    "Vous venez de ré-activer les courriers automatiques. Si vous validez, un courrier peut se générer immédiatement. Pour que le courrier ne soit pas envoyé, il faut au préalable effectuer le report avant toutes actions sur la créance."
                ).then(response => {
                    if (response) {
                        submitForms();
                    }
                });
            } else {
                submitForms();
            }
        });
    }

    // Liste des boutons radio pouvant être décochés au clic
    const RadioGroups = [
        'opposition_amiable[accordOppo]',
        'rdd[accordRdd]',
        'anv[avisDfc]'
    ];

    RadioGroups.forEach(radioGroup => {
        const radios = document.querySelectorAll(`input[name="${radioGroup}"]`);

        radios.forEach(radio => {
            radio.addEventListener('click', function () {
                if (this.dataset.wasChecked === 'true') {
                    this.checked = false;
                    this.dataset.wasChecked = 'false';
                } else {
                    radios.forEach(r => r.dataset.wasChecked = 'false');
                    this.dataset.wasChecked = 'true';
                }
            });
        });
    });

    $.ajax({
        type: "POST",
        url: Routing.generate('creance_regroupee_workflow_history', {'crid': idCreanceRegroupee}),
        async: true,
        success: function (workflow) {
            $('#wf_name').html(workflow.name);
            $("#wf_history_list").html(workflow.tags);
        }
    });

    initContestationCheckbox();
    initAnvAvisDfc();
});

/**
 * Renvoie true / false suivant si la créance est suspendue ou non
 *
 * @returns {boolean}
 */
function isCreanceSuspended() {
    return document.getElementById('suspendue').value !== '0';
}

/**
 * Submit les formulaires qui ont été ouverts
 */
function submitForms() {
    /*
     * Affichage de la barre de chargement
     */
    const progressBarModal = $('#modal_progress_bar').modal({
        keyboard: false,
        backdrop: 'static'
    });
    progressBarModal.show();
    const modalBackdrop = document.getElementById('modalBackdrop');
    modalBackdrop.classList.add('d-block');
    modalBackdrop.classList.remove('d-none');

    const progressBarElement = document.getElementById('saveProgressBar');

    /*
     * Sauvegarde des formulaires
     */
    new Promise(function (resolve, reject) {
        progressBarElement.style.width = '0%';
        let formsToSubmit = document.querySelectorAll('.toSubmit');
        let contentieuxData = [];
        let contentieuxAction = '';
        let nbFormSaved = 0;
        nbFormError = 0;
        let nbFormContentieux = 0;
        let percentPerForm = Math.round((1 / formsToSubmit.length) * 100);
        errorMessages = [];

        for (let form of formsToSubmit) {
            if (form.name.includes('contentieuse')) {
                contentieuxData = contentieuxData.concat(
                    $(document.getElementsByName(`${form.name}`)[0]).serializeArray(),
                );
                contentieuxAction = form.action;
                nbFormContentieux++;
            } else {
                let data = $(form).serializeArray();
                data.push({
                    name: form.name + '[creanceregroupeeid]',
                    value: idCreanceRegroupee
                });

                $.ajax({
                    type: "POST",
                    url: form.action,
                    data: data,
                    async: true,
                    success: function () {
                        nbFormSaved++;
                        let newPercent = parseInt(progressBarElement.style.width) + percentPerForm;
                        progressBarElement.style.width = newPercent + '%';
                        progressBarElement.setAttribute('aria-valuenow', newPercent.toString());
                    },
                    error: formErrorHandler,
                    complete: function (jqXHR, textStatus) {
                    }
                });
            }

            $.ajax({
                type: "POST",
                url: Routing.generate('creance_trace'),
                data: {
                    onglet: form.getAttribute('onglet'),
                    creanceregroupeeid: idCreanceRegroupee
                },
                async: true,
                success: function (datas, dataType) {},
                error: function (XMLHttpRequest, textStatus, errorThrown) {},
                complete: function (jqXHR, textStatus) {}
            });
        }

        if (nbFormContentieux > 0) {
            $.ajax({
                type: "POST",
                url: contentieuxAction,
                data: contentieuxData,
                async: true,
                success: function () {
                    nbFormSaved++;
                    let newPercent = parseInt(progressBarElement.style.width) + (percentPerForm * nbFormContentieux);
                    progressBarElement.style.width = newPercent + '%';
                    progressBarElement.setAttribute('aria-valuenow', newPercent.toString());
                },
                error: formErrorHandler,
                complete: function (jqXHR, textStatus) {}
            });
        }

        let intervalSave = setInterval(function () {
            let nbForm = formsToSubmit.length;
            if (nbFormContentieux > 0) {
                nbForm -= (nbFormContentieux - 1);
            }

            if (nbFormSaved === nbForm) {
                clearInterval(intervalSave);
                resolve();
            } else if ((nbFormSaved + nbFormError) === nbForm) {
                clearInterval(intervalSave);
                reject();
            }
        }, 1000);
    }).then(function () {
        $.ajax({
            type: "POST",
            url: Routing.generate('echeance_generate'),
            data: {
                id: idCreanceRegroupee,
                isCallParCreanceForm: true
            },
            async: true,
            success: function () {
                window.location = Routing.generate('creance_reload', {
                    id: $('#id_creance').val(),
                    tab: $('.active').attr('id')
                });
            },
            error: function () {
                window.location.reload();
            },
            complete: function (jqXHR, textStatus) {}
        });
    }).catch(function() {
        progressBarModal.hide();
        let message = "Une erreur est survenue.";

        if (errorMessages.length > 0) {
            message = errorMessages.join('<br>');
        }
        alert(message, 'Erreur', 'error');
    });
}

/**
 * stockage du dernier onglet visité pour chaque créance
 */
function saveTabsQuickAccess(idcreance, tab)
{
    let quickAccess = {};
    if (typeof localStorage['tabsQuickAccess'] != 'undefined') {
        quickAccess = JSON.parse(localStorage['tabsQuickAccess']);
        quickAccess[idcreance] = tab;
    } else {
        quickAccess[idcreance] = tab;
    }

    localStorage['tabsQuickAccess'] = JSON.stringify(quickAccess);
}

/**
 * retourne le dernier onglet visité pour cette créance
 */
function getTabsQuickAccess(idcreance)
{
    if (localStorage['tabsQuickAccess']) {
        let quickAccess = JSON.parse(localStorage['tabsQuickAccess']);
        if (quickAccess[idcreance] !== undefined) {
            return quickAccess[idcreance];
        } else {
            return 0;
        }
    } else {
        return 0;
    }
}

/**
 * Handler des erreurs du traitement des formulaires
 * @param response
 */
function formErrorHandler(response)
{
    nbFormError++
    errorMessages.push(response.responseText);
}

/**
 * Gestion de l'activation/désactivation de la checkbox en fonction de la date de contestation
 */
function initContestationCheckbox() {
    const dateInput = document.querySelector('#contestation_dateContestation');
    const checkbox = document.querySelector('#contestation_rprSuspendu');

    if (!dateInput || !checkbox) return;

    function toggleCheckbox() {
        const disable = !dateInput.value;
        checkbox.disabled = disable;
        if (disable) checkbox.checked = false;
    }

    toggleCheckbox();
    dateInput.addEventListener('input', toggleCheckbox);
}

/**
 * Gestion de l'activation/désactivation des radios "Avis DFC" en fonction de la date de proposition
 */
function initAnvAvisDfc() {
    const dateInput = document.querySelector('[id$="_dateProposition"]');
    const avisDfcInputs = document.querySelectorAll(
        '[id*="_avisDfc_"] input[type="radio"], [name$="[avisDfc]"], [id^="anv_avisDfc_"]'
    );

    if (!dateInput || avisDfcInputs.length === 0) return;

    function toggleAvisDfc() {
        const disable = !dateInput.value;
        avisDfcInputs.forEach(input => {
            input.disabled = disable;
            if (disable) input.checked = false;
        });
    }

    toggleAvisDfc();
    dateInput.addEventListener('input', toggleAvisDfc);
}
