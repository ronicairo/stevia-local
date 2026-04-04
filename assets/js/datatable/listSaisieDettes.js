window.addEventListener('DOMContentLoaded', function () {
    const table = $('#list-saisie-dettes-dataTable').DataTable({
        dom: 'lt<"bottom d-flex justify-content-between align-items-center"i p>B',
        ajax: {
            url: Routing.generate('demande_saisie_dettes_get_data'),
            data: function (d) {
                d.filters = getFilters('list-saisie-dettes-dataTable')
                return d;
            }
        },
        order: [[0, 'desc']],
        columns: [
            {
                "data": "numeroIdentification",
                "name": "d.numeroIdentification",
                "render": function (data, type, row) {
                    const url = Routing.generate('demande_saisie_dettes_show', {'id': row.id})
                    return `<a href="${url}" title="Modifier">${row.numeroIdentification}</a>`
                }
            },
            {
                "data": "status",
                "name": "d.status"
            },
            {
                "data": "poleDemandeur",
                "name": "d.poleDemandeur"
            },
            {
                "data": "motif",
                "name": "m.libelle"
            },
            {
                "data": "numCreance",
                "name": "d.numCreance"
            },
            {
                "data": "typeIndu",
                "name": "d.typeIndu"
            },
            {
                "data": "typeDebuteur",
                "name": "d.typeDebuteur"
            },
            {
                "data": "nom",
                "name": "d.nom"
            },
            {
                "data": "montant",
                "name": "d.montant"
            },
            {
                "data": "dateSaisie",
                "name": "d.dateSaisie"
            },
            {
                "data": "dateTraitee",
                "name": "d.dateTraitee"
            },

            {
                "name": "update",
                "orderable": false,
                "render": function (data, type, row) {
                    if (row.status !== 'Validée' && row.status !== 'Rejetée') {
                        const url = Routing.generate('demande_saisie_dettes_edit', {'id': row.id})
                        return `<div class="text-center"><a href="${url}" title="Modifier"><i class='fs-3 bi bi-pencil-square'></i></a></div>`
                    }

                    return null
                }
            },
        ],
        buttons: [
            {
                text: 'Sélectionner toutes les lignes de la page',
                action: function () {
                    let rows = table.rows({ page: 'current' }).nodes();
                    let allSelected = true;

                    $(rows).each(function () {
                        if (!$(this).hasClass('selected')) {
                            allSelected = false;
                            return false;
                        }
                    });

                    $(rows).each(function () {
                        if (allSelected) {
                            $(this).removeClass('selected');
                        } else {
                            $(this).addClass('selected');
                        }
                    });

                    updateMassValidateButton();
                    this.text(allSelected ? 'Sélectionner toutes les lignes de la page' : 'Désélectionner toutes les lignes de la page');
                }
            },
            {
                text: 'Valider en masse',
                className: 'btn btn-success',
                attr: { id: 'massValidateBtn' },
                action: function () {
                    let selectedRows = table.rows('.selected').data().toArray();
                    let selectedIds = selectedRows.map(row => row.id);

                    if (selectedIds.length === 0) {
                        alert('Veuillez sélectionner au moins une ligne à valider.');
                        return;
                    }

                    let count = selectedIds.length;
                    confirm(`Confirmez-vous le traitement de ${count} ligne${count > 1 ? 's' : ''} sélectionné${count > 1 ? 'es' : 'e'} ?`)
                        .then(confirmed => {
                            if (confirmed) {
                                table.processing(true);

                                $.ajax({
                                    type: 'POST',
                                    url: Routing.generate('demande_saisie_dette_bulk_validation'),
                                    data: { ids: selectedIds.join() },
                                    success: function () {
                                        alert('Validation effectuée');
                                        table.ajax.reload();
                                        updateMassValidateButton();
                                    },
                                    error: function (xhr, status, error) {
                                        alert(error);
                                    },
                                    complete: function () {
                                        table.processing(false);
                                    }
                                });
                            }
                        });
                }
            },
            {
                extend: 'csv',
                text: 'Exporter en CSV',
                action: function () {
                    // Récupère les filtres actifs dans le localStorage.
                    const filters = getFilters('list-saisie-dettes-dataTable')

                    $.ajax({
                        url: Routing.generate('demande_saisie_dettes_export'),
                        data: JSON.stringify({
                                filters: filters
                            }
                        ),
                        method: "POST",
                        success: (response) => {
                            const BOM = new Uint8Array([0xEF,0xBB,0xBF]);
                            const link = document.createElement('a');
                            link.href = window.URL.createObjectURL(
                                new Blob(
                                    [BOM, response],
                                    {type: 'text/csv'}
                                )
                            );
                            link.download = 'demande_saisie_dettes.csv';
                            link.click();
                            window.URL.revokeObjectURL(link);

                            this.processing(false);
                        },
                        error: function () {
                            // En cas d'erreur, on arrête le spinner et on affiche une alerte.
                            $('#list-saisie-dettes-dataTable').DataTable().processing(false);
                            alert('Une erreur est survenue lors de l\'export. Veuillez réessayer plus tard.');
                        },
                    });
                }
            }
        ],
        initComplete: function () {
            // Déplace le message dans un autre conteneur
            const processingDiv = $('.dt-processing')
            $('#custom-container').append(processingDiv)
            updateMassValidateButton(); // on cache Valider en masse si aucune sélection
        },
        rowCallback: function (row, data) {
            // Désactiver la sélection si validée
            if (data.status === 'Validée') {
                $(row).addClass('not-selectable text-muted');
                $(row).off('click'); // Empêche le toggle
            } else {
                $(row).off('click').on('click', function () {
                    $(this).toggleClass('selected');
                    updateMassValidateButton();
                });
            }
        },
    });

    function updateMassValidateButton() {
        let count = table.rows('.selected').data().length;
        if (count > 0) {
            $('#massValidateBtn').show();
        } else {
            $('#massValidateBtn').hide();
        }
    }
    initializeFilters(table)
    initializeButtons(table)
})