window.addEventListener('DOMContentLoaded', function () {
    // num des débiteur
    const numDeb = document.getElementById('num-debiteur').value
    // id de la creance
    const idCreance = document.getElementById('id-creance').value
    // les inputs formulaire de simulation
    const montantDu = document.getElementById('form_simulateur_montantdu')
    const mode = document.getElementById('form_simulateur_modecalcul');
    const montant = document.getElementById('form_simulateur_montant');
    const duree = document.getElementById('form_simulateur_duree');
    const periodicite = document.getElementById('form_simulateur_periodicite');
    const dateeffet = document.getElementById('form_simulateur_dateeffet');
    const numsRefContent = document.getElementById('form_simulateur_numdesregroupement')
    // div qui contient la table simulation et le formulaire remarque
    const contentSimulation = document.getElementById('content-simulateur');
    // bouton de validation de remarque
    const btnSubmit = document.querySelector('#content-simulateur button[type="submit"]');
    // table simulation (resultat de la simulation)
    const tableSimulation = document.getElementById('table-simulation');
    // num de débiteur
    const debiteur = document.getElementById('debiteur');
    // id echelonnement
    const idEchelonnement = document.getElementById('id-echelonnement');
    // div qui contient la remarque
    const remarqueContent = document.getElementById('remarque-content');
    // boutton de validation de remarque
    const btnSubmitRemarque = document.getElementById('btn-submit-remarque');
    // textarea simulation
    const remarque = document.getElementById('remarque');
    // spinner afficher pendant les chargement des données
    const spinner = document.getElementById('spinner')
    const spinner2 = document.getElementById('spinner2')
    // bouton de suppression d'une d'un paiment echeloné
    const btnDelete = document.getElementById('delete-paiement')
    // bouton de confirmation de suppression
    const btnConfirmModal = document.getElementById('btn-confirme-modal')
    // div qui affiche le message Flash
    const messageFlash = document.getElementById('message-flash')
    // le modal qui s'affiche lorsqu'on souhaite supprimer un paiement
    const myModalEl = document.getElementById('exampleModal')
    const formRemarque = document.getElementById('form-remarque')
    let timeoutId;
    let confirmOpen = false;

    // Table Paiement échelonné en cours
    const tablePaiementEnCours = $('#paiement-echelonne').DataTable({
        ajax: Routing.generate('paiement_echelonne_in_progress', {numDebiteur: numDeb}),
        dom: 'ti',
        searchable: false,
        autoWidth: 'auto',
        columns: [
            {
                // colonne pour plier et déplier le subtable
                "data": null,
                "name": "child",
                "className": 'dt-control exclude-select-row',
                "orderable": false,
                "defaultContent": ''
            },
            {
                "name": "id",
                "orderable": false,
                "render": (data, type, row) => {
                    const url = Routing.generate('paiement_echelonne_print', {id: row.id})
                    return `<div class="text-center" ><a href="${url}" title="Imprimer" class="print"><i class='fs-3 bi bi-printer exclude-select-row'></i></a></div>`
                }
            },
            {
                "data": "dateAccord",
                "name": "dateAccord",
                "orderable": false
            },
            {
                "data": "dateDebutEch",
                "name": "dateDebutEch",
                "orderable": false
            },
            {
                "data": "dateFinEch",
                "name": "dateFinEch",
                "orderable": false
            },
            {
                "data": "dureeMois",
                "name": "dureeMois",
                "className": 'text-start',
                "orderable": false
            },
            {
                "data": "periodicite",
                "name": "periodicite",
                "className": 'text-start',
                "orderable": false
            },
            {
                "data": "montantEch",
                "name": "montantEch",
                "className": 'text-end',
                "orderable": false
            },
            {
                "data": "montantFinal",
                "name": "montantFinal",
                "className": 'text-end',
                "orderable": false
            },
            {
                "name": "retenuSurRente",
                "orderable": false,
                "render": (data, type, row) => {
                    const icon = row.retenuSurRente === true ? 'bi-check2-square text-success' : 'bi-x-square text-danger'
                    return `<div class="text-center"><i class="fs-3 bi ${icon}"></i></div>`
                }
            },
            {
                "data": "montantInitial",
                "name": "montantInitial",
                "className": 'text-end',
                "orderable": false
            },
            {
                "data": "solde",
                "name": "solde",
                className: 'text-end',
                "orderable": false
            }
        ],
        initComplete: (settings) => {
            const btnsPrint = settings.nTable.querySelectorAll('.print');
            printByBtn(btnsPrint)
        }

    })

    const print = (url) => {
        spinner2.classList.toggle('d-none')

        $.ajax({
            type: "POST",
            url: url,
            success: function (response) {
                const path = `${response.apiDocServer}?reference=${response.reference}&environment=${response.environment}&mode=edit&filename=${response.filename}`
                window.open(path, '_blank');
                spinner2.classList.add('d-none')
            },
            error: function () {
                showAlertTemporarily('Erreur lors de l\'impression', 'alert-danger')

            }
        });
    }

    const printByBtn = (buttonsPrint) => {
        if (!buttonsPrint) return;
        buttonsPrint.forEach((btn) => {
            btn.addEventListener('click', (event) => {
                event.preventDefault()
                print(btn.href)
            })
        })

    }

    // Cette fonction permet de plier/déplier les lignes d'un tableau
    const collapseSubTable = (table, route, col, paramRoute = 'id') => {

        table.on('click', 'tbody td.dt-control', function () {
            let tr = $(this).closest('tr');
            let row = table.row(tr);

            if (row.child.isShown()) {
                // This row is already open - close it
                row.child.hide();
            } else {

                if (spinner) {
                    spinner.classList.remove('d-none')
                    row.child(spinner).show();
                }

                remarqueContent.classList.remove('d-none')

                $.ajax({
                    url: Routing.generate(route, {[paramRoute]: row.data()[col]}),
                    method: 'GET',
                    dataType: 'json',
                    success: (response) => {
                        row.child(response.html).show();
                        // row.child(`<div class="subtable-container">${response.html}</div>`).show();
                        tr.next('tr').find('td').addClass('subtable-container');

                        tr.removeClass('selected');
                        tr.addClass('selected');
                    }
                })
            }
        });
    }
    // table créances du débiteur
    const tableCreancesDeb = $('#detail-creance').DataTable({
        ajax: Routing.generate('paiement_echelonne_creance', {idCreance: idCreance}),
        dom: 'ti',
        searchable: false,
        order: false,
        columns: [
            {
                // colonne pour plier et déplier le subtable
                "name": "checkbox",
                "className": 'select-checkbox text-center',
                "orderable": false,
                "render": (data, type, row) => {
                    const solde = parseFloat(row.solde.replace(/\s|€/g, '').replace(',', '.')) || 0
                    return `<input type="checkbox" class="form-check-input" data-num-ref="${row.numero_reference}" data-solde="${solde}">`;
                }

            },
            {
                // colonne pour plier et déplier le subtable
                "name": "child",
                "className": 'dt-control',
                "orderable": false,
                "defaultContent": ''
            },
            {
                "data": "numero_reference",
                "name": "numero_reference",
                "className": 'text-center'
            },
            {
                "data": "montantInitial",
                "name": "montantInitial",
                className: 'dt-body-right',
                "orderable": false
            },
            {
                "data": "solde",
                "name": "solde",
                className: 'dt-body-right',
                "orderable": false
            }
        ],
        preDrawCallback: function (settings) {
            // Bouton input checkbox pour cocher/décrocher les checkbox du tableau
            const inputSelectAll = settings.nTable.querySelector('.datatable-checked-all');
            // desactive le bouton 'supprimer' avant chargement de la table
            btnDelete.disabled = true
            // désactiver l'input de checké tous les checkbox du tableau
            if (inputSelectAll) inputSelectAll.checked = false
        },
        initComplete: () => {},
        footerCallback: function () {
            getSoldes(null, this.api(), null, {}, 3)
            getSoldes(null, this.api(), null, {}, 4)
        }
    })

    const disabledInput = (input) => {
        if (!input) return;
        input.disabled = true;
    }

    // cette fonction permet de saisir le montant sous la form xxx,xx (ex: 28,82)
    const formatDevise = (input) => {
        if (!input) return;
        input.addEventListener("input", () => {
            // Supprimer tout sauf les chiffres
            const value = input.value.replace(/\D/g, "");
            // Appliquer le formatage français avec 2 décimales
            input.value = formatLocalDate(parseFloat(value) / 100);
            if (input.value === "" || input.value === "0" || input.value === 'NaN' || input.value === '0,00') {
                input.value = "";
            }
        });
    };

    // Cette fonction permet de modifier la liste des numéros de référence des créances sélectionnées pour créer un paiement échelonné.
    // Elle permet aussi de faire la somme du solde des créances sélectionnées pour avoir le montant final
    const changeValueSoldeNumRef = (input) => {

        if (!debiteur.value) {
            contentSimulation.classList.remove('d-none');
            return;
        }
        const numRef = input.getAttribute('data-num-ref');
        const solde = parseFloat(input.getAttribute('data-solde'));

        let contentSolde = parseFloat(montantDu.getAttribute('data-content-solde')) || 0;

        // On addition ou on soutrait le solde
        contentSolde = input.checked ? contentSolde + solde : contentSolde - solde;
        updateMontantDu(contentSolde);

        // Mise à jour de la liste des références
        updateNumsRefContent(numRef, input.checked);

        if (numsRefContent.value) {
            contentSimulation.classList.remove('d-none')
        } else {
            contentSimulation.classList.add('d-none')
            tableSimulation.classList.add("d-none");
            disabledInput(montant)
            disabledInput(duree)
            removeValueInput()
        }
    }

    // À chaque sélection d'une ligne du tableau créances du débiteur, applique changeValueSoldeNumRef
    const checkRow = (inputs) => {
        inputs.forEach(input => {
            input.addEventListener('click', () => {
                changeValueSoldeNumRef(input)
                runSimulateur()
            })
        })
    }

    // Sélectionner toutes les lignes de la table creance du débiteur
    const selectAllRow = (masterCheckbox, childCheckboxes) => {

        masterCheckbox.disabled = false
        // Écouteur d'événement sur la checkbox principale
        masterCheckbox.addEventListener("change", function () {
            removeValueInput()
            // Vider les numRefs
            if (numsRefContent) numsRefContent.value = ''
            // mettre le montant à 0
            masterCheckbox.checked = this.checked
            childCheckboxes.forEach(input => {
                input.checked = this.checked;
                // Mettre à jour les numero de ref
                changeValueSoldeNumRef(input)
            });

            runSimulateur()

        });
        // Écouteurs sur chaque checkbox enfant pour désactiver "Tout sélectionner" si l'une est décochée
        childCheckboxes.forEach(checkbox => {
            checkbox.addEventListener("change", function () {
                if (!this.checked) {
                    masterCheckbox.checked = false;
                } else if ([...childCheckboxes].every(cb => cb.checked)) {
                    masterCheckbox.checked = true;
                }
            });
        });
    }

    // Fonction pour mettre à jour le montant dû
    const updateMontantDu = (newValue) => {
        if (!montantDu) return;
        const formattedValue = parseFloat(newValue).toFixed(2);
        montantDu.setAttribute('data-content-solde', formattedValue);
        montantDu.value = formatLocalDate(formattedValue);
    }

    // Fonction pour gérer la mise à jour des numéros de regroupement, exemple 'numRef1,numRef2, etc'
    const updateNumsRefContent = (numRef, isChecked) => {
        if (!numsRefContent) return;
        let numsList = numsRefContent.value ? numsRefContent.value.split(',') : [];
        if (isChecked) {
            if (!numsList.includes(numRef)) {
                numsList.push(numRef);
            }
        } else {
            numsList = numsList.filter(num => num !== numRef);
        }
        numsRefContent.value = numsList.join(',');
    }

    // remettre à vide tous les champs du formulaire de création d'un paiement échelonné
    const removeValueInput = () => {
        [montantDu, mode, montant, duree, periodicite, dateeffet, numsRefContent].forEach((input) => {
            if (input) input.value = ''
        })
        if (montantDu) montantDu.setAttribute('data-content-solde', 0)
    }

    // Faire une simulation
    const runSimulateur = () => {

        const disabledModeMontant = () => {
            if (mode.value === '1') {
                montant.disabled = false
                duree.disabled = true
                duree.value = ""
            } else {
                montant.disabled = true
                montant.value = ""
                duree.disabled = false
            }

        }

        const checkInputs = () => {
            if (!montantDu) return false;

            let isValid = false;

            if (montantDu.value !== "" && mode.value === '1' && montant.value !== "" && periodicite.value !== '' && dateeffet.value !== "") {
                isValid = true;
            } else if (montantDu.value !== "" && mode.value === '2' && duree.value !== '' && periodicite.value !== '' && dateeffet.value !== "") {
                isValid = true;
            }

            btnSubmit.disabled = !isValid;
            return isValid;
        };

        const checkDateCoherence = () => {
            const dateValue = dateeffet.value.trim();
            if (!dateValue || confirmOpen) return;

            const [year, month, day] = dateValue.split("-").map(Number);
            const d = new Date(year, month - 1, day);
            const isDateValid =
                !isNaN(d.getTime()) &&
                d.getFullYear() === year &&
                d.getMonth() + 1 === month &&
                d.getDate() === day;

            const today = new Date();
            const diffYears = d.getFullYear() - today.getFullYear();
            const diffMonths = diffYears * 12 + (d.getMonth() - today.getMonth());

            if (!isDateValid || Math.abs(diffYears) > 100) {
                showAlertTemporarily("Date d’effet invalide.", "alert-danger");
                btnSubmit.disabled = true;
                return;
            }

            if (diffMonths > 6 || diffYears < -1) {
                confirmOpen = true;
                const formattedDate = dateValue.split("-").reverse().join("/");

                window.confirm(`Confirmez-vous la date d'effet du ${formattedDate} ?`)
                    .then(response => {
                        confirmOpen = false;
                        if (response) {
                            checkInputs();
                        } else {
                            dateeffet.value = "";
                            btnSubmit.disabled = true;
                        }
                    })
                    .catch(() => {
                        confirmOpen = false;
                    });
                return;
            }
            checkInputs();
        };

        const callSimulation = () => {
            $.ajax({
                type: "POST",
                url: Routing.generate('paiement_echelonne_simulateur'),
                data: {
                    montantDu: parseFloat(montantDu.getAttribute('data-content-solde')) || 0,
                    mode: mode.value,
                    mensualite: montant.value ? montant.value : "",
                    duree: duree.value,
                    periodicite: periodicite.value,
                    dateeffet: dateeffet.value,
                    sum: parseFloat(montantDu.getAttribute('data-content-solde'))

                },
                success: function (response) {

                    tableSimulation.classList.remove("d-none");

                    tableSimulation.innerHTML = ''

                    tableSimulation.innerHTML = response.html
                },
                error: function () {
                    showAlertTemporarily('Erreur lors de la simulation', 'alert-danger')
                }
            });

        }

        const checkAndRun = () => {
            clearTimeout(timeoutId);
            if (checkInputs()) {
                timeoutId = setTimeout(() => {
                    callSimulation();
                }, 800);
            } else {
                tableSimulation.classList.add("d-none");
            }
        };

        ["change", "input"].forEach(event => {
            [montantDu, mode, montant, duree, periodicite].forEach(input => {
                if (!input) return;
                input.addEventListener(event, checkAndRun);
            });
        });

        if(dateeffet){
            dateeffet.addEventListener("blur", () => {
                checkDateCoherence();
            });
        }

        // à chaque changement de la valeur de l'input, on vérifie si tous les champs sont remplis et on lance ajax
        const checkInputsEvent = (event, inputs) => {

            inputs.forEach((input) => {
                if (!input) return;
                input.addEventListener(event, () => {
                    disabledModeMontant()
                    checkAndRun()
                })
            })

        }
        checkInputsEvent('change', [montantDu, mode, duree, periodicite, dateeffet])
        checkInputsEvent('blur', [montantDu, montant])

        checkAndRun()
    }

    // Soumettre le formulaire remarque
    const submitRemarque = () => {
        btnSubmitRemarque.disabled = idEchelonnement.value === '';
        // Vérifier si l'ID de paiement est vide, dans ce cas on ne fait rien
        if (!btnSubmitRemarque || idEchelonnement.value === '') return;

        // Supprimer les anciens gestionnaires d'événements pour éviter les requêtes multiples
        $(btnSubmitRemarque).off('click').on('click', function (e) {
            e.preventDefault();
            updateRemarque()

        });
    }

    const updateRemarque = (update = true) => {
        $.ajax({
            type: "POST",
            url: Routing.generate('paiement_echelonne_remarque', {
                idPaiement: idEchelonnement.value,
            }),
            data: {
                remarque: remarque.value,
                update: update
            },
            async: false,
            success: function (response) {
                // Mettre à jour le champ remarque avec la valeur récupérée
                remarque.value = response.remarque;

                update === true ? showAlertTemporarily('Remarque enregistrée avec succès') : '';
            },
            error: function () {
                showAlertTemporarily('Une erreur s\'est produite, aucune remarque n\'a été créée ou modifiée', 'alert-danger');
            }
        });
    }

    // suppression d'un paiement échelonné
    const deletePaiement = (table) => {
        // modal de bootstrap
        myModalEl.addEventListener('hide.bs.modal', () => {
            // lorsqu'on confirme la suppression on lance ajax pour supprimer
            btnConfirmModal.addEventListener('click', () => {
                if (idEchelonnement.value !== '') {

                    $.ajax({
                        type: "POST",
                        url: Routing.generate('paiement_echelonne_delete', {
                            id: idEchelonnement.value
                        }),
                        async: false,
                        success: function () {
                            // on recharge le tableau
                            table.ajax.reload();
                            showAlertTemporarily('Paiement echélonné supprimé avec succès');
                            tableCreancesDeb.ajax.reload();
                            formRemarque.classList.add('d-none');
                        },
                        error: function () {
                            showAlertTemporarily('Erreur lors de la suppression', 'alert-danger');
                        }
                    });
                }
            })
        })
    }

    // Afficher message Flash
    const showAlertTemporarily = (message, className = 'alert-success') => {
        messageFlash.innerHTML = '';
        messageFlash.innerHTML = message;
        messageFlash.classList.remove('d-none');
        messageFlash.classList.remove('alert-success');
        messageFlash.classList.remove('alert-danger');
        messageFlash.classList.add(className);

        clearTimeout(timeoutId); // Annule tout timeout précédent
        timeoutId = setTimeout(() => {
            messageFlash.classList.remove(className);
            messageFlash.classList.add('d-none');
        }, 5000);
    };

    // Soumettre le formulaire d'échelonnement
    const submitEchelonnement = () => {
        if (!btnSubmit) return;
        btnSubmit.addEventListener('click', (e) => {
            e.preventDefault();

            const formData = new FormData(e.target.form);
            const idCreance = document.getElementById('id-creance').value;

            $.ajax({
                type: 'GET',
                url: Routing.generate('verifier_suspension_creance', {id: idCreance}),
                dataType: 'json',
                success: function (response) {
                    const confirmationPromise = response.suspendue
                        ? Promise.resolve(window.confirm(
                            `Cette créance est déjà suspendue pour ${response.motif}. Voulez-vous valider le changement de suspension ? Ce changement entraînera la suspension pour paiement échelonné.`
                        ))
                        : Promise.resolve(true);

                    confirmationPromise.then((confirmed) => {
                        if (!confirmed) return;

                        $.ajax({
                            type: "POST",
                            url: Routing.generate('paiement_echelonne_create'),
                            data: formData,
                            processData: false,
                            contentType: false,
                            async: false,
                            success: function (response) {
                                // on recharge le tableau
                                tablePaiementEnCours.ajax.reload();
                                tableCreancesDeb.ajax.reload();
                                // Url ads pour la création de fichier
                                const path = `${response.apiDocServer}?reference=${response.reference}&environment=${response.environment}&mode=edit&filename=${response.filename}`
                                window.open(path, '_blank');
                                location.reload();
                            },
                            error: function () {
                                showAlertTemporarily("Une erreur s'est produite, aucun paiement échelonné n'a été créé", 'alert-danger');
                            }
                        });
                    });
                },
                error: function () {
                    alert("Erreur lors de la vérification de la suspension.");
                }
            });
        });
    };

    // A la fin du chargement du tableau creance debiteur
    tableCreancesDeb.on('draw.dt', function () {
        const settings = tableCreancesDeb.settings()[0]
        // Bouton input checkbox pour cocher/décrocher les checkbox du tableau
        const inputSelectAll = document.getElementById('selectAll');
        const inputsCheckBox = settings.nTable.querySelectorAll('td.select-checkbox input')
        checkRow(inputsCheckBox)
        formatDevise(montantDu)
        formatDevise(montant)
        runSimulateur(montantDu, mode, montant, duree, periodicite, dateeffet)
        removeValueInput()
        selectAllRow(inputSelectAll, inputsCheckBox)
        disabledInput(montant)
        disabledInput(duree)

    });

    // À la fin du chargement du tableau paiement échelonné en cours
    tablePaiementEnCours.on('draw.dt', function () {

        // Accéder aux lignes du tableau
        tablePaiementEnCours.rows().every(function () {
            // Récupérer l'élément DOM pour la ligne
            let row = this.node();
            let classList = row.classList

            // click pour sélectionner / désélectionner une ligne
            row.addEventListener('click', (event) => {

                if (classList.contains('selected') || event.target.classList.contains('exclude-select-row')) {

                    if(event.target.classList.contains('exclude-select-row') === false) formRemarque.classList.remove('d-none');

                    classList.remove('selected');
                    // on remet input de l'id de paiement échelonné en null
                    idEchelonnement.value = null;
                    // désactiver le bouton de suppression, car tant qu'aucune ligne n'est sélectionnée, on ne peut pas supprimer
                    btnDelete.disabled = true;

                } else if (tablePaiementEnCours.data().any()) { // vérifie si on a des données sur la tablea
                    // on sélectionne une ligne et on enlève la classe selected
                    tablePaiementEnCours.rows('.selected').nodes().each((row) => row.classList.remove('selected'));
                    classList.add('selected');
                    // on affiche le formulaire remarque lié à la ligne sélectionnée
                    formRemarque.classList.remove('d-none');
                    // activer la suppression
                    btnDelete.disabled = false;

                    // récupérer l'id du paiement échelonné de la ligne sélectionnée
                    let rowData = tablePaiementEnCours.row(event.currentTarget).data();
                    idEchelonnement.value = rowData.id; // Assigner l'ID à un input si nécessaire
                    // récupérer la remarque de la ligne sélectionnée et l'afficher
                    remarque.value = rowData.remarque

                    updateRemarque(false)
                    submitRemarque()

                }
            })
        });


    });

    removeValueInput()
    collapseSubTable(tablePaiementEnCours, 'paiement_echelonne_in_progress_details', 'id')
    collapseSubTable(tableCreancesDeb, 'paiement_echelonne_creance_details', 'numero_reference', 'numeroReference')
    deletePaiement(tablePaiementEnCours)
    submitEchelonnement()
})