window.addEventListener('DOMContentLoaded', function () {
    const JsVars = $("#js-vars").data('vars');

    $(document).on('click', '.modal-trigger', function () {
        const row = $('#creances-non-notifiees-dataTable').DataTable().row($(this).closest('tr')).data();

        // Insère la valeur dans le textarea de la modale
        document.getElementById('commentaire').value = row.commentaireCreance;

        // Stocke le numéro de référence dans le bouton Valider
        document.getElementById('commentaire').dataset.id = row.id
    });

    const showFlashMessage =  (idFlash) => {
        const messageFlash = document.getElementById(idFlash);
        messageFlash.classList.remove('d-none');
        setTimeout(() => {
            messageFlash.classList.add('d-none');
        }, 3000);
    }

    // Écouteur d'événement sur le bouton "Valider" de la modale
    $('#modal-creance #save-comment').click(function () {
        // Récupère le numéro de référence et le commentaire pour enregistrement
        const commentaire = document.getElementById('commentaire');

        $.ajax({
            url: Routing.generate('notification_update_commentaire'),
            data: {
                id: commentaire.dataset.id,
                commentaire: commentaire.value
            },
            global: false,
            type: "POST",
            dataType: "html",
            async: false,
            success: function () {
                $('#creances-non-notifiees-dataTable').DataTable().ajax.reload(function () {
                    showFlashMessage('flash-messages-success')
                });
            },
            error: function (){
                showFlashMessage('flash-messages-error')

            }
        });
    });

    const table = $('#creances-non-notifiees-dataTable').DataTable({
        order: [[1, 'asc']],
        dom: 'lt<"bottom d-flex justify-content-between align-items-center"i p>B',
        ajax: {
            url: Routing.generate('creance_a_notifier_get_data'),
            type: 'POST',
            data: function (d) {
                d.date_debut_prod = JsVars.data.date_debut_prod;
                d.type = JsVars.data.type;
                d.filters = getFilters('creances-non-notifiees-dataTable')
                return d;
            }
        },
        columns: [
            {
                data: null,
                orderable: false,
                render: function (data, type, row) {
                    if (JsVars.route === 'creances_non_notifiees') {
                        return null
                    }

                    const url = (JsVars.route === 'notification_mec')
                        ? Routing.generate('notification_mec_post_prod', {creanceRegroupee: row.id})
                        : Routing.generate('notification_edit', {creanceRegroupee: row.id});

                    const icon = (JsVars.route === 'notification_mec') ? 'bi-reception-4' : 'bi-file-earmark-word'

                    return `
                        <div class="btn-group">
                            <a href="${url}" class="px-2" style="cursor: pointer;">
                              <i class="${icon} fs-5"></i>
                            </a>
                            <a class="px-2 modal-trigger" style="cursor: pointer;" data-bs-toggle="modal" data-bs-target="#modal-creance">
                              <i class="bi-chat-dots-fill fs-5"></i>
                            </a>
                        </div>`;
                }
            },
            {
                "data": "numeroReference",
                "name": "numeroReference",
                "render": function (data) {
                    const url = Routing.generate('creance_reference', {id: data});
                    return '<a href="' + url + '">' + data + '</a>';
                }
            },
            {
                "data": "numeroDebiteur",
                "name": "numeroDebiteur",
                "className": "clickable-debiteur"
            },
            {
                "data": "catDebiteur",
                "name": "catDebiteur"
            },
            {
                "data": "natureCompte",
                "name": "natureCompte"
            },
            {
                "data": "montantInitial",
                "name": "montantInitial",
                className: 'dt-body-right'
            },
            {
                "data": "solde",
                "name": "solde",
                className: 'dt-body-right'
            },
            {
                "data": "numUgeGestion",
                "name": "numUgeGestion"
            },
            {
                "data": "commentaireCreance",
                "name": "commentaireCreance"
            },
            {
                "data": "dateDetect",
                "name": "dateDetect"
            },
            {
                "data": "delai",
                "name": "delai",
                className: 'dt-body-right',
                render: function (data) {
                    // Formate le nombre avec un espace comme séparateur de milliers
                    const formattedData = parseInt(data).toLocaleString();
                    return `${formattedData} jours`;
                }
            },
            {
                "data": "numUgeDetect",
                "name": "numUgeDetect"
            },
            {
                "data": "numTechnicien",
                "name": "numTechnicien"
            }
        ],
        buttons: [
            {
                extend: 'csv',
                text: 'Exporter en CSV',
                action: function () {
                    // Récupère les filtres actifs dans le localStorage.
                    const filters = getFilters('creances-non-notifiees-dataTable');

                    $.ajax({
                        url: Routing.generate('creances_non_notifiees_export'),
                        data: JSON.stringify({
                                filters: filters,
                                date_debut_prod: JsVars.data.date_debut_prod,
                                type: JsVars.data.type
                            }
                        ),
                        method: "POST",
                        success: (response) => {
                            // Si la réponse commence par le premier header attendu, on crée la fenêtre de chargement
                            if (response.startsWith('numero')) {
                                const BOM = new Uint8Array([0xEF, 0xBB, 0xBF]);
                                const link = document.createElement('a');
                                link.href = window.URL.createObjectURL(
                                    new Blob(
                                        [BOM, response],
                                        {type: 'text/csv'}
                                    )
                                );
                                link.download = 'creances_a_notifier.csv';
                                link.click();
                                window.URL.revokeObjectURL(link);

                                this.processing(false);
                            } else {
                                alert('Une erreur est survenue lors de la génération du CSV. Veuillez réessayer.');
                                this.processing(false);

                                // Supprime l'overlay qui reste persistant après fermeture de la fenêtre...
                                $('.modal-dialog .modal-footer .btn.btn-primary').click(() => $('#modalBackdrop').removeClass('d-block').addClass('d-none'));
                            }
                        },
                        error: () => {
                            // En cas d'erreur, on arrête le spinner et on affiche une alerte.
                            alert('Une erreur est survenue lors de l\'export. Veuillez réessayer plus tard.');
                            $('.modal-dialog .modal-footer .btn.btn-primary').click(() => $('#modalBackdrop').removeClass('d-block').addClass('d-none'));

                            this.processing(false);
                        },
                    });
                }
            }
        ]
    });

    initializeClickableDebiteur(table)
    initializeFilters(table)
    initializeButtons(table)
    rememberDataTable(table);

    const footers = {
        totalMontantInitial: $('#creances-non-notifiees-dataTable_wrapper .dt-scroll-foot tfoot tr th:eq(5)'),
        totalSolde: $('#creances-non-notifiees-dataTable_wrapper .dt-scroll-foot tfoot tr th:eq(6)')
    }
    const route = Routing.generate('creance_a_notifier_soldes')
    const options = {
        date_debut_prod: JsVars.data.date_debut_prod,
        type: JsVars.data.type
    }

    initializeSoldes(table, footers, route, options)
})