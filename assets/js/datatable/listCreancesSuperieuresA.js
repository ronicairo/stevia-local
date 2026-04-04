window.addEventListener('DOMContentLoaded', function () {
    const table = $('#list-creances-superieures-a').DataTable({
        dom: 'lt<"bottom d-flex justify-content-between align-items-center"i p>B',
        ajax: {
            url: Routing.generate('pilotage_statistique_superieures_get_data'),
            data: function (d) {
                d.filters = getFilters('list-creances-superieures-a')
                return d;
            }
        },
        columns: [
            {
                "data": "numeroReference",
                "name": "numeroReference"
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
                "data": "numUgeDetect",
                "name": "numUgeDetect"
            },
            {
                "data": "natureCompte",
                "name": "natureCompte"
            },
            {
                "data": "dateDetect",
                "name": "dateDetect"
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
            }
        ],
        buttons: [
            {
                extend: 'csv',
                text: 'Exporter en CSV',
                action: function () {
                    $.ajax({
                        url: Routing.generate('pilotage_statistique_superieures_export'),
                        data: JSON.stringify({
                                filters: getFilters('list-creances-superieures-a')
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
                            link.download = 'creances_superieures_a.csv';
                            link.click();
                            window.URL.revokeObjectURL(link);

                            this.processing(false);
                        },
                        error: function () {
                            // En cas d'erreur, on arrête le spinner et on affiche une alerte.
                            $('#list-creances-superieures-a').DataTable().processing(false);
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

    const footers = {
        totalMontantInitial: $('#list-creances-superieures-a_wrapper .dt-scroll-foot tfoot tr th:eq(6)'),
        totalSolde: $('#list-creances-superieures-a_wrapper .dt-scroll-foot tfoot tr th:eq(7)')
    }
    const route = Routing.generate('pilotage_statistique_superieures_get_soldes')

    initializeSoldes(table, footers, route)
})