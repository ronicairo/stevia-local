window.addEventListener('FrontBundleLoaded', function () {
    const table = $('#list-creances-numero-og3s').DataTable({
        dom: 'lt<"bottom d-flex justify-content-between align-items-center"i p>B',
        ajax: {
            url: Routing.generate('creances_numero_og3s_data'),
            data: d => {
                d.filters = {filters: getFilters('list-creances-numero-og3s')};
            }
        },
        columns: [
            {
                "data": "numeroReference",
                "name": "numeroReference"
            },
            {
                "data": "numeroCreance",
                "name": "numeroCreance"
            },
            {
                "data": "natureCompte",
                "name": "natureCompte"
            },
            {
                "data": "numeroOg3s",
                "name": "numeroOg3s"
            },
            {
                "data": "statutCompte",
                "name": "statutCompte"
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
                "data": "dateDetect",
                "name": "dateDetect"
            },
            {
                "data": "dateCourrier",
                "name": "dateCourrier"
            },
            {
                "data": "dateDerOpe",
                "name": "dateDerOpe"
            },
            {
                "data": "numCompte",
                "name": "numCompte"
            },
            {
                "data": "commentaireCreance",
                "name": "commentaireCreance"
            }
        ],
        buttons: [
            {
                extend: 'csv',
                text: 'Exporter en CSV',
                className: 'btn btn-info',
                action: function () {
                    $.ajax({
                        url: Routing.generate('creances_numero_og3s_export'),
                        data: JSON.stringify({
                                filters: getFilters('list-creances-numero-og3s')
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
                            link.download = 'liste_creances_numero_og3s.csv';
                            link.click();
                            window.URL.revokeObjectURL(link);

                            this.processing(false);
                        },
                        error: function () {
                            // En cas d'erreur, on arrête le spinner et on affiche une alerte.
                            $('#list-creances-numero-og3s').DataTable().processing(false);
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
        },

    })

    initializeClickableDebiteur(table)
    initializeFilters(table)
    initializeButtons(table)
})