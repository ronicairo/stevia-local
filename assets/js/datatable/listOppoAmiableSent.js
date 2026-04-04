window.addEventListener('DOMContentLoaded', function () {
    const table = $('#list-oppo-amiable-sent').DataTable({
        dom: 'lt<"bottom d-flex justify-content-between align-items-center"i p>B',
        ajax: {
            url: Routing.generate('supervision_opposition_amiable_get_data'),
            data: function (d) {
                d.filters = getFilters('list-oppo-amiable-sent')
                return d;
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
                "data": "catDebiteur",
                "name": "catDebiteur"
            },
            {
                "data": "montantInitialRegroupement",
                "name": "montantInitialRegroupement",
                className: 'dt-body-right'
            },
            {
                "data": "solde",
                "name": "solde",
                className: 'dt-body-right'
            },
            {
                "data": "catOrganisme",
                "name": "catOrganisme"
            },
            {
                "data": "typeCourrier",
                "name": "typeCourrier"
            },
            {
                "data": "derDateOppo",
                "name": "derDateOppo"
            },
            {
                "data": "totalSolde",
                "name": "totalSolde"
            }
        ],
        buttons: [
            {
                extend: 'csv',
                text: 'Exporter en CSV',
                action: function () {
                    $.ajax({
                        url: Routing.generate('supervision_opposition_amiable_export'),
                        data: JSON.stringify({
                                filters: getFilters('list-oppo-amiable-sent')
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
                            link.download = 'liste_opposition_amiable_envoyees.csv';
                            link.click();
                            window.URL.revokeObjectURL(link);

                            this.processing(false);
                        },
                        error: function () {
                            // En cas d'erreur, on arrête le spinner et on affiche une alerte.
                            $('#list-oppo-amiable-sent').DataTable().processing(false);
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

    initializeFilters(table)
    initializeButtons(table)
})